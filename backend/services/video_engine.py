"""Durable submit/track/download checkpoints. Never replay an uncertain submission."""
import asyncio
from pathlib import Path
from muse_ai.media import extract_video_refs, extract_session_ids

class ReviewRequired(RuntimeError):
    pass

def restore_job(job):
    if job.status not in {'queued', 'running'}:
        return False
    if job.phase == 'prepared' and all(p.is_file() for p in job.image_paths):
        job.status = 'queued'
        job.error = None
        return True
    if job.phase == 'tracking' and job.session_id:
        job.status = 'queued'
        job.error = None
        return True
    job.status = 'failed'
    job.phase = 'review'
    job.error = 'Tác vụ bị gián đoạn khi chưa lưu được xác nhận Muse. Không tự gửi lại để tránh video trùng; hãy kiểm tra lịch sử Muse.'
    return False

async def execute(job, client, save, bind_session, output_dir: Path):
    """Called under the account lock. save() commits before any external submission."""
    if job.phase == 'prepared':
        if any(not p.is_file() for p in job.image_paths):
            raise ValueError('Ảnh tham chiếu không còn tồn tại.')
        history = await client.history(session_id=job.session_id, limit=80)
        job.baseline = [ref.identity for ref in extract_video_refs(history)]
        job.phase = 'submitting'
        save(job)
        events = await client.chat_stream(prompt=job.prompt, images=job.image_paths,
                                          session_id=job.session_id)
        ids = extract_session_ids(events)
        resolved = job.session_id or (ids[-1] if ids else None)
        # Never guess "the latest session": it could belong to another user.
        if not resolved:
            raise ReviewRequired('Muse chưa trả mã phiên chắc chắn. Hãy kiểm tra lịch sử Muse; hệ thống không tự gửi lại.')
        bind_session(resolved, job)
        job.session_id = resolved
        job.phase = 'tracking'
        save(job)
    if job.phase != 'tracking' or not job.session_id:
        raise ReviewRequired('Thiếu điểm khôi phục an toàn cho tác vụ.')
    refs, _ = await client.wait_for_videos(session_id=job.session_id,
        baseline=set(job.baseline), timeout=float(job.timeout_seconds))
    target = output_dir / job.id
    target.mkdir(parents=True, exist_ok=True)
    for partial in target.glob('*.part'):
        partial.unlink(missing_ok=True)
    downloaded = []
    # Include old files even if Muse rotates a URL or changes the returned list.
    total = sum(p.stat().st_size for p in target.iterdir() if p.is_file() and p.suffix != '.part')
    # Stable filenames and atomic replacement let recovery reuse completed files.
    for index, ref in enumerate(refs):
        import hashlib
        name = hashlib.sha256(ref.identity.encode()).hexdigest()[:24] + '.mp4'
        final = target / name
        part = target / (name + '.part')
        if not final.is_file():
            try:
                await client.download_video(ref, part, max_bytes=job.max_output_bytes - total)
                if part.stat().st_size == 0:
                    raise ValueError('Muse trả tệp video rỗng.')
                if part.stat().st_size > job.max_output_bytes - total:
                    raise ValueError('Video vượt dung lượng tối đa của một tác vụ.')
                part.replace(final)
                total += final.stat().st_size
            finally:
                part.unlink(missing_ok=True)
        if total > job.max_output_bytes:
            raise ValueError('Video vượt dung lượng tối đa của một tác vụ.')
        downloaded.append(final)
    if not downloaded:
        raise RuntimeError('Muse chưa trả tệp video.')
    job.files = downloaded
    job.status = 'completed'
    job.error = None
    save(job)
