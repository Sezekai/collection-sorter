import subprocess, os, time, json, shutil, re, urllib.request
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e3'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very')
for i in range(30): os.makedirs(f'{ROOT}/ex/Zelda',exist_ok=True); shutil.copy('/tmp/corpus/G0good_jpeg.jpg', f'{ROOT}/ex/Zelda/x{i}.jpg')
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
    for _ in range(120):
        if not api('/state')['job']: return
        time.sleep(1)
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,i)
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[ROOT+'/ex'],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'},'refs':{'maxPerFolder':12}})
    api('/run',{}); wait(); c=api('/state')['counts']; print(c); check('learned', c['refs_done']==12)
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1400,'height':900}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1200)
        pg.click('[data-rmref]'); pg.wait_for_timeout(300); pg.screenshot(path=ROOT+'/dlg.png'); pg.click('#rk_keep'); pg.wait_for_timeout(1000)
        c=api('/state')['counts']; check('keep: learned data kept, rest dropped', c['refs']==12 and c['refs_done']==12, c)
        s=api('/state')['settings']; check('root removed + kept listed', s['referenceRoots']==[] and len(s['keptReferenceRoots'])==1)
        check('kept row shown', pg.locator('[data-forgetkept]').count()==1); pg.screenshot(path=ROOT+'/kept.png')
        api('/run',{}); wait(); c=api('/state')['counts']; check('rescan does not touch kept folder', c['refs']==12, c)
        pg.click('[data-forgetkept]'); pg.click('#cbok'); pg.wait_for_timeout(800)
        c=api('/state')['counts']; check('forget kept', c['refs']==0 and api('/state')['settings']['keptReferenceRoots']==[], c)
        # option 2: remove + forget
        api('/settings',{'referenceRoots':[ROOT+'/ex']}); api('/run',{}); wait(); check('relearn', api('/state')['counts']['refs_done']==12)
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1000); pg.click('[data-rmref]'); pg.click('#rk_forget'); pg.wait_for_timeout(900)
        check('forget option', api('/state')['counts']['refs']==0)
        # removal during a running scan stops learning
        api('/settings',{'referenceRoots':[ROOT+'/ex'],'refs':{'maxPerFolder':30}}); api('/reset',{'what':'examples'}); api('/run',{}); 
        time.sleep(0.2); api('/refs/remove',{'path':ROOT+'/ex','keep':False}); wait()
        check('mid-scan removal leaves nothing', api('/state')['counts']['refs']==0, api('/state')['counts'])
        check('no page errors', not errs, errs); b.close()
finally: p.terminate()
print('ALL OK' if ok else 'FAILED')
