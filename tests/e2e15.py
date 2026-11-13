import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e15'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime','Pokemon','Pixel Art','All Other Art']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very',exist_ok=True)
env=dict(os.environ, CS_DATA=ROOT+'/data', CS_TOKEN='t')
p=subprocess.Popen(['node','engine/server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
for l in p.stdout:
    m=re.match(r'ENGINE_PORT=(\d+)',l)
    if m: port=int(m.group(1)); break
base=f'http://127.0.0.1:{port}'
def api(path,body=None):
    r=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'x-token':'t','content-type':'application/json'}); return json.loads(urllib.request.urlopen(r).read())
def wait():
    time.sleep(1)
    for _ in range(180):
        if not api('/state')['job']: return
        time.sleep(1)
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,i); sys.stdout.flush()
LIB=ROOT+'/lib'

try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    api('/run',{}); wait(); time.sleep(1); wait()
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1300,'height':800}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#dupes'); pg.wait_for_timeout(1800); pg.screenshot(path=ROOT+'/dupes.png')
        t=pg.inner_text('#view'); print(t[:600])
        check('highest quality labelled', 'ighest quality' in t, t[:200])
        for w in ['Not duplicates','Keep','Dupes']: check('button text '+w, w in t)
        pg.locator('#view img').first.dblclick(); pg.wait_for_timeout(900); pg.screenshot(path=ROOT+'/dupeviewer.png')
        v=pg.inner_text('#viewer'); check('viewer has dupe panel', 'Not duplicates' in v and 'ighest quality' in v, v[:300])
        before=api('/state')['counts']['approved']; pg.keyboard.press('a'); pg.wait_for_timeout(500); check('A does nothing in dupe viewer', api('/state')['counts']['approved']==before)
        pg.locator('#viewer button:has-text("Not duplicates")').first.click(); pg.wait_for_timeout(1000)
        check('viewer closes after Not duplicates', pg.locator('#viewer').count()==0 or not pg.locator('#viewer').is_visible())
        check('group gone', api('/dupes')['total']==0, api('/dupes')['total'])
        check('no console errors', not errs, errs)
        b.close()
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
