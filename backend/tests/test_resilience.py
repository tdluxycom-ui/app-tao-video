from __future__ import annotations
import asyncio
import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from starlette.requests import Request
from fastapi import HTTPException

from backend import main
from backend.services.jobs import JobStore, VideoJob
from backend.services import limits, video_engine
from backend.services.worker_lease import WorkerLease
from muse_ai.media import VideoRef

class FakeClient:
    def __init__(self):
        self.submits = 0
        self.tracks = 0
        self.downloads = 0
    async def history(self, **kwargs):
        return []
    async def chat_stream(self, **kwargs):
        self.submits += 1
        return [{"session_id": "remote-session"}]
    async def wait_for_videos(self, **kwargs):
        self.tracks += 1
        return [VideoRef(path="clip.mp4")], []
    async def download_video(self, ref, path, *, max_bytes=None):
        self.downloads += 1
        Path(path).write_bytes(b'video')
        return path

class DurableJobsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = JobStore(self.root/'jobs.db')
        self.client = FakeClient()
    def tearDown(self):
        self.temp.cleanup()
    async def test_restart_tracks_existing_request_without_resubmitting(self):
        job = VideoJob(id='one', phase='prepared', user_id='u', account_id='a')
        async def interrupt(**kwargs):
            raise asyncio.CancelledError()
        self.client.wait_for_videos = interrupt
        with self.assertRaises(asyncio.CancelledError):
            await video_engine.execute(job,self.client,self.store.save,lambda *args: None,self.root)
        restored = self.store.load()[0]
        self.assertEqual(restored.phase, 'tracking')
        self.assertEqual(restored.session_id, 'remote-session')
        self.client.wait_for_videos = FakeClient().wait_for_videos
        self.assertTrue(video_engine.restore_job(restored))
        await video_engine.execute(restored,self.client,self.store.save,lambda *args: None,self.root)
        self.assertEqual(self.client.submits, 1)
        self.assertEqual(restored.status, 'completed')
        self.assertEqual(restored.files[0].read_bytes(), b'video')
    async def test_crash_during_submit_does_not_replay(self):
        job=VideoJob(id='uncertain',phase='prepared')
        async def broken(**kwargs):
            raise asyncio.CancelledError()
        self.client.chat_stream=broken
        with self.assertRaises(asyncio.CancelledError):
            await video_engine.execute(job,self.client,self.store.save,lambda *args: None,self.root)
        restored=self.store.load()[0]
        self.assertEqual(restored.phase,'submitting')
        self.assertFalse(video_engine.restore_job(restored))
        self.assertEqual(restored.phase,'review')
    async def test_missing_session_does_not_guess_latest_session(self):
        self.client.chat_stream=AsyncMock(return_value=[])
        job=VideoJob(id='no-session',phase='prepared')
        with self.assertRaises(video_engine.ReviewRequired):
            await video_engine.execute(job,self.client,self.store.save,lambda *args:None,self.root)
        self.assertEqual(self.client.tracks,0)
    async def test_download_recovery_reuses_file(self):
        job=VideoJob(id='reuse',phase='tracking',session_id='s')
        await video_engine.execute(job,self.client,self.store.save,lambda *args:None,self.root)
        job.status='running'
        await video_engine.execute(job,self.client,self.store.save,lambda *args:None,self.root)
        self.assertEqual(self.client.downloads,1)
        self.assertEqual(self.client.submits,0)
    async def test_oversized_download_is_not_published(self):
        job=VideoJob(id='large',phase='tracking',session_id='s',max_output_bytes=2)
        with self.assertRaises(ValueError):
            await video_engine.execute(job,self.client,self.store.save,lambda *args:None,self.root)
        self.assertEqual(job.files,[])
        self.assertEqual(list((self.root/'large').iterdir()),[])
    async def test_rotated_media_still_counts_previous_files_against_quota(self):
        target=self.root/'rotated';target.mkdir()
        (target/'previous.mp4').write_bytes(b'old-video')
        job=VideoJob(id='rotated',phase='tracking',session_id='s',max_output_bytes=10)
        with self.assertRaises(ValueError):
            await video_engine.execute(job,self.client,self.store.save,lambda *args:None,self.root)
        self.assertEqual(sum(p.stat().st_size for p in target.iterdir()),9)
    async def test_graceful_shutdown_preserves_tracking_checkpoint(self):
        job=VideoJob(id='shutdown',phase='prepared',user_id='u',account_id='a')
        entered=asyncio.Event()
        async def tracking(**kwargs):
            entered.set()
            await asyncio.Event().wait()
        self.client.wait_for_videos=tracking
        account=SimpleNamespace(client=self.client,lock=asyncio.Lock())
        with patch.object(main,'job_store',self.store), patch.object(main,'OUTPUT_DIR',self.root), \
             patch.object(main,'_get_muse_account',AsyncMock(return_value=account)), \
             patch.object(main,'_bind_video_session',lambda *args:None):
            task=asyncio.create_task(main._run_video_job(job))
            await asyncio.wait_for(entered.wait(),2)
            task.cancel()
            await asyncio.gather(task,return_exceptions=True)
        restored=self.store.load()[0]
        self.assertEqual(restored.status,'queued')
        self.assertEqual(restored.phase,'tracking')
        self.assertEqual(restored.session_id,'remote-session')
    async def test_lifespan_schedules_restored_queue(self):
        job=VideoJob(id='restart',phase='tracking',status='running',session_id='s',account_id='a')
        self.store.save(job)
        launched=asyncio.Event()
        async def worker(restored):
            self.assertEqual(restored.id,job.id)
            self.assertEqual(restored.phase,'tracking')
            launched.set()
            await asyncio.Event().wait()
        state=main.BridgeState()
        with patch.object(main,'job_store',self.store), patch.object(main,'state',state), \
             patch.object(main,'STATE_DIR',self.root), patch.object(main.user_store,'initialize'), \
             patch.object(main,'_run_video_job',worker):
            async with main.lifespan(main.app):
                await asyncio.wait_for(launched.wait(),2)
        self.assertTrue(state.jobs[job.id].task.done())
    def test_checkpoint_and_images_survive_restart(self):
        image=self.root/'ref.png';image.write_bytes(b'image')
        job=VideoJob(id='queued',phase='prepared',image_paths=[image],timeout_seconds=120,
                     request_id='idempotency-key',request_hash='hash',baseline=['old'])
        self.store.save(job)
        restored=self.store.load()[0]
        self.assertTrue(video_engine.restore_job(restored))
        self.assertEqual(restored.image_paths,[image])
        self.assertEqual(restored.timeout_seconds,120)
        self.assertEqual(restored.request_id,job.request_id)
    def test_legacy_running_job_requires_review(self):
        job=VideoJob(id='legacy',status='running')
        self.assertFalse(video_engine.restore_job(job))
        self.assertEqual(job.phase,'review')
    def test_legacy_schema_migrates_without_data_loss(self):
        with sqlite3.connect(self.store.path) as db:
            db.execute('CREATE TABLE muse_video_jobs (id TEXT PRIMARY KEY, status TEXT, prompt TEXT, session_id TEXT, files_json TEXT, error TEXT, created_at TEXT, updated_at TEXT)')
            db.execute("INSERT INTO muse_video_jobs VALUES ('old','running','keep me',NULL,'[]',NULL,'2026-01-01','2026-01-01')")
        db.close()
        job=self.store.load()[0]
        self.assertEqual(job.prompt,'keep me')
        self.assertEqual(job.phase,'legacy')
    def test_worker_lease_rejects_second_process_owner(self):
        with WorkerLease(self.root):
            with self.assertRaises(RuntimeError):
                with WorkerLease(self.root):
                    pass
        with WorkerLease(self.root):
            pass

class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(); self.root=Path(self.temp.name)
        self.state=main.BridgeState()
        self.store=JobStore(self.root/'jobs.db')
        self.account=SimpleNamespace(id='a',lock=asyncio.Lock(),client=FakeClient())
        self.patches=[patch.object(main,'state',self.state),patch.object(main,'job_store',self.store),
          patch.object(main,'OUTPUT_DIR',self.root/'outputs'),patch.object(main,'ROOT',self.root),
          patch.object(main,'admission_lock',asyncio.Lock()),
          patch.object(main,'video_limits',limits.VideoLimits(min_free_bytes=1)),
          patch.object(main,'_select_muse_account',AsyncMock(return_value=self.account)),
          patch.object(main,'_run_video_job',self.wait_worker)]
        for p in self.patches:p.start()
    async def asyncTearDown(self):
        for job in self.state.jobs.values():
            if job.task:job.task.cancel()
        await asyncio.gather(*(j.task for j in self.state.jobs.values() if j.task),return_exceptions=True)
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    async def wait_worker(self,*args):
        await asyncio.Event().wait()
    def request(self,user='u'):
        req=Request({'type':'http','headers':[]})
        req.state.user={'id':user,'role':'user'}
        return req
    async def test_duplicate_requests_create_one_job(self):
        body=main.VideoRequest(prompt='test',request_id='request-123')
        results=await asyncio.gather(*(main.create_video(body,self.request()) for _ in range(5)))
        self.assertEqual(len(self.state.jobs),1)
        self.assertEqual(len({r['job_id'] for r in results}),1)
    async def test_parallel_admission_cannot_exceed_user_limit(self):
        results=await asyncio.gather(*(main.create_video(main.VideoRequest(prompt='test',request_id=f'request-{i}'),self.request()) for i in range(5)),return_exceptions=True)
        self.assertEqual(sum(isinstance(r,dict) for r in results),2)
        self.assertEqual(len(self.state.jobs),2)
        self.assertTrue(all(r.status_code==429 for r in results if isinstance(r,HTTPException)))
    async def test_idempotency_key_cannot_change_payload(self):
        await main.create_video(main.VideoRequest(prompt='one',request_id='request-123'),self.request())
        with self.assertRaises(HTTPException) as exc:
            await main.create_video(main.VideoRequest(prompt='two',request_id='request-123'),self.request())
        self.assertEqual(exc.exception.status_code,409)
    async def test_other_user_cannot_cancel_job(self):
        result=await main.create_video(main.VideoRequest(prompt='one'),self.request())
        with self.assertRaises(HTTPException) as exc:
            await main.cancel_video(result['job_id'],self.request('other'))
        self.assertEqual(exc.exception.status_code,404)
    async def test_resume_is_tracking_only_and_does_not_add_daily_request(self):
        job=VideoJob(id='resume',user_id='u',phase='tracking',status='failed',session_id='s')
        self.state.jobs[job.id]=job
        self.store.save(job)
        result=await main.resume_video(job.id,self.request())
        self.assertEqual(result['status'],'queued')
        self.assertEqual(job.phase,'tracking')
        self.assertEqual((await main.video_usage(self.request()))['daily'],1)
    async def test_resume_rejects_uncertain_submission(self):
        job=VideoJob(id='review',user_id='u',phase='review',status='failed')
        self.state.jobs[job.id]=job
        with self.assertRaises(HTTPException) as exc:
            await main.resume_video(job.id,self.request())
        self.assertEqual(exc.exception.status_code,409)
    async def test_cancel_queued_preserves_daily_usage(self):
        result=await main.create_video(main.VideoRequest(prompt='one'),self.request())
        await main.cancel_video(result['job_id'],self.request())
        current=await main.video_usage(self.request())
        self.assertEqual(current['active'],0)
        self.assertEqual(current['daily'],1)
    async def test_delete_reclaims_disk_but_retains_idempotency(self):
        job=VideoJob(id='safe',user_id='u',status='completed',request_id='request-123')
        folder=main.OUTPUT_DIR/job.id;folder.mkdir(parents=True)
        f=folder/'result.mp4';f.write_bytes(b'video');job.files=[f]
        self.state.jobs[job.id]=job
        self.store.save(job)
        await main.delete_video(job.id,self.request())
        self.assertFalse(folder.exists())
        self.assertTrue(self.store.load()[0].deleted)
        self.assertEqual((await main.video_usage(self.request()))['daily'],1)
    async def test_busy_chat_fails_fast_without_sending(self):
        await self.account.lock.acquire()
        started=asyncio.get_running_loop().time()
        with self.assertRaises(HTTPException) as exc:
            async with main._chat_slot(self.account):
                self.fail('Busy account must not be used')
        self.assertEqual(exc.exception.status_code,409)
        self.assertLess(asyncio.get_running_loop().time()-started,1)
        self.assertTrue(self.account.lock.locked())
        self.account.lock.release()
    def test_storage_reservations_prevent_overbooking(self):
        config=limits.VideoLimits(storage_bytes=300,output_bytes=200,min_free_bytes=1)
        jobs=[VideoJob(id='held',user_id='u',max_output_bytes=200)]
        with self.assertRaises(HTTPException) as exc:
            limits.check_admission(jobs,'u',main.OUTPUT_DIR,config)
        self.assertEqual(exc.exception.status_code,413)
    def test_global_daily_and_disk_limits(self):
        for config,jobs,code in [
            (limits.VideoLimits(active_global=1),[VideoJob(id='other',user_id='other')],429),
            (limits.VideoLimits(daily_per_user=1),[VideoJob(id='today',user_id='u',status='failed',deleted=True)],429),
            (limits.VideoLimits(min_free_bytes=10**18),[],507),
        ]:
            with self.subTest(code=code,config=config):
                with self.assertRaises(HTTPException) as exc:
                    limits.check_admission(jobs,'u',main.OUTPUT_DIR,config)
                self.assertEqual(exc.exception.status_code,code)
