import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e12'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime','Photography/Real','All Other Art']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very',exist_ok=True)
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
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    api('/run',{}); wait()
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':900}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        check('nav has Art and Real', pg.locator('nav a[data-r="review"]').count()==1 and pg.locator('nav a[data-r="real"]').count()==1)
        na=pg.locator('#grid .tile').count(); pg.goto(f'{base}/?t=t#real'); pg.wait_for_timeout(1500); nr=pg.locator('#grid .tile').count()
        check('art and real lists differ', na>0 and nr>0 and na+nr>=10, (na,nr))
        check('real list has only real', all(i['realness']=='real' for i in api('/review?scope=new&realm=real&limit=100')['items']))
        t=pg.locator('#grid .tile').first; i0=int(t.get_attribute('data-id')); t.click()
        check('button says Move to Art', 'Move to Art' in pg.inner_text('#b_real'))
        pg.keyboard.press('p'); pg.wait_for_timeout(1500)
        it=api('/review?scope=any&ids=%d'%i0)['items'][0]
        check('P moved it to art', it['realness']=='art' and it['realBy']=='you', it['realness'])
        check('gone from real list', pg.locator(f'#grid .tile[data-id="{i0}"]').count()==0)
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        check('shows in art list', pg.locator(f'#grid .tile[data-id="{i0}"]').count()==1)
        pg.goto(f'{base}/?t=t#tags'); pg.wait_for_timeout(1500)
        a=pg.locator('#tlist .fitem').count(); pg.select_option('#trealm','real'); pg.wait_for_timeout(1200); r=pg.locator('#tlist .fitem').count()
        check('tags realm selector', a>0 and r>0, (a,r))
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1500)
        check('setup shows scoreboard', 'how the two AIs are doing' in pg.inner_text('#view'))
        pg.goto(f'{base}/?t=t#settings'); pg.wait_for_timeout(1200); pg.click('[data-sec="realart"]'); pg.wait_for_timeout(600)
        check('settings show the art-or-real options', pg.locator('[data-path="classify.model"]').count()==1 and pg.locator('[data-path="tagSource.real"]').count()==1)
        pg.screenshot(path=ROOT+'/setup.png'); pg.goto(f'{base}/?t=t#real'); pg.wait_for_timeout(1500); pg.screenshot(path=ROOT+'/real.png')
        check('no page errors', not errs, errs)
        b.close()
finally:
    p.kill()
print('ALL OK' if ok else 'SOME FAILED')
