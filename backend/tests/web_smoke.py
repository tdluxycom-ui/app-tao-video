"""Run after npm run export:web. Uses mocked APIs, never logs in to Muse."""
import json
import os
from pathlib import Path
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(ROOT/'backend/.playwright-browsers'))

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    fixture=[dict(job_id='waiting',status='queued',phase='prepared',can_resume=False,prompt='Video đang chờ',videos=[],error=None),
             dict(job_id='recover',status='failed',phase='tracking',can_resume=True,prompt='Video cần khôi phục',videos=[],error='Chưa lấy được kết quả.'),
             dict(job_id='done',status='completed',phase='tracking',can_resume=False,prompt='Video hoàn tất',videos=[],error=None)]
    for job in fixture:job.update(session_id=None,created_at='2026-10-07T01:00:00Z',updated_at='2026-10-07T01:00:00Z')
    actions=[]
    def route_api(route):
        path=route.request.url.split('/api/',1)[-1].split('?')[0]
        if route.request.method=='OPTIONS':data={}
        elif path=='access/status':data={'required':False,'authenticated':True}
        elif path=='auth/me':data={'user':{'id':'u','email':'preview@example.com','role':'user'}}
        elif path=='muse/jobs':data={'jobs':fixture}
        elif path=='muse/usage':data={'active':1,'daily':3,'used_bytes':1024**2,'reserved_bytes':256*1024**2,'active_limit':2,'daily_limit':20,'storage_limit_bytes':2*1024**3}
        elif path.endswith('/resume'):
            actions.append('resume');data={'ok':True}
        elif path.endswith('/cancel'):
            actions.append('cancel');data={'ok':True}
        elif route.request.method=='DELETE':
            actions.append('delete');data={'deleted':True}
        else:data={'ok':True,'authenticated':False,'connected':False}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'})
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            for width,height,label in [(1440,1000,'desktop'),(390,844,'mobile')]:
                page=browser.new_page(viewport={'width':width,'height':height})
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.add_init_script("sessionStorage.setItem('tdluxy_session_token','mock-test-token')")
                page.route('**/api/**',route_api)
                page.goto(f'http://127.0.0.1:{server.server_port}',wait_until='networkidle')
                page.get_by_text('Lịch sử',exact=True).first.click()
                page.get_by_text('Hạn mức video của bạn',exact=True).wait_for()
                page.get_by_text('Tiếp tục theo dõi',exact=True).click()
                page.get_by_text('Hủy tác vụ chưa gửi',exact=True).click()
                page.get_by_text('Xóa tác vụ',exact=True).last.click()
                page.get_by_text('Xóa tác vụ và video đã lưu?',exact=True).wait_for()
                page.get_by_text('Giữ lại',exact=True).click()
                page.get_by_text('Xóa tác vụ và video đã lưu?',exact=True).wait_for(state='hidden')
                assert 'delete' not in actions,'Deletion must require confirmation'
                screenshot=ROOT/'artifacts'/f'library-{label}.png'
                screenshot.parent.mkdir(exist_ok=True)
                page.screenshot(path=str(screenshot),full_page=True)
                assert not errors,errors
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal page overflow'
                page.close()
            browser.close()
        assert 'resume' in actions and 'cancel' in actions,actions
        print('PASS: desktop/mobile library, quota, resume, cancel, delete confirmation, no page errors or page overflow')
    finally:
        server.shutdown();server.server_close()

if __name__=='__main__':main()
