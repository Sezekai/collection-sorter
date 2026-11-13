import subprocess, os, time, json, shutil, re, urllib.request, threading, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
IQ=open('tests/lookup.test.js').read().split('const IQDB = `')[1].split('`;')[0]; AS=open('tests/lookup.test.js').read().split('const ASCII = `')[1].split('`;')[0]
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length',0))); self.send_response(200); self.send_header('content-type','text/html'); self.end_headers(); self.wfile.write((IQ if self.path.startswith('/iq') else AS).encode())
    def log_message(self,*a): pass
srv=HTTPServer(('127.0.0.1',0),H); threading.Thread(target=srv.serve_forever,daemon=True).start(); mp=srv.server_port
ROOT='/tmp/e2e5'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src'); os.makedirs(ROOT+'/dest')
env=dict(os.environ, CS_DATA=ROOT+'/data', CS_TOKEN='t', IQDB_URL=f'http://127.0.0.1:{mp}/iq', ASCII2D_URL=f'http://127.0.0.1:{mp}')
p=subprocess.Popen(['node','engine/server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
for l in p.stdout:
    m=re.match(r'ENGINE_PORT=(\d+)',l)
    if m: port=int(m.group(1)); break
base=f'http://127.0.0.1:{port}'
def api(path,body=None):
    r=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'x-token':'t','content-type':'application/json'}); return json.loads(urllib.request.urlopen(r).read())
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,i); sys.stdout.flush()
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    api('/run',{}); time.sleep(1)
    for _ in range(120):
        if not api('/state')['job']: break
        time.sleep(1)
    its=api('/review?limit=500')['items']; small=[i for i in its if i['w'] and i['w']<=800][:2]; print([(i['name'],i['w'],i['h']) for i in small])
    r=api('/sauce/queue',{'ids':[i['id'] for i in small]}); check('queued, no key needed', r['queued']==2 and r['started'], r)
    for _ in range(90):
        st=api('/sauce/stats')
        if st['done']>=2: break
        time.sleep(1)
    check('both looked up (IQDB + Ascii2D only, no key)', st['done']==2, st)
    res=api('/review?scope=sauce&sstate=done&sort=hq&limit=10')['items']
    check('results listed', len(res)==2)
    r0=res[0]['sauce']['result']; print(json.dumps(r0)[:300])
    check('bigger copy detected', r0['hq'] and r0['hq']['w']>res[0]['w'] and r0['hq']['certain'], r0.get('hq'))
    check('filter bigger copy', api('/review?scope=sauce&sstate=done&hq=1&limit=10')['total']>=1)
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1800,'height':1000}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#sauce'); pg.wait_for_timeout(1500); pg.screenshot(path=ROOT+'/sauce.png')
        check('tile shows bigger copy', '⬆' in pg.inner_text('#grid'), pg.inner_text('#grid')[:200])
        pg.locator('#grid .tile').first.dblclick(); pg.wait_for_timeout(1200); pg.screenshot(path=ROOT+'/sauce_viewer.png')
        check('viewer lists matches', pg.locator('.mrow').count()>=2 and 'Bigger copy' in pg.inner_text('#vside'))
        check('no page errors', not errs, errs); b.close()
finally: p.terminate()
print('ALL OK' if ok else 'FAILED')
