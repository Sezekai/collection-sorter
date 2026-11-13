import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e6'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
    api('/run',{}); wait(); c=api('/state')['counts']; print(c)
    bad=ROOT+'/dest/Zelda'; [open(f'{bad}/z{i}.jpg','wb').write(b'not a picture') for i in range(20)]
    api('/settings',{'destinationRoot':ROOT+'/dest','referenceRoots':[ROOT+'/dest']}); api('/run',{}); wait()
    pr=api('/state')['problems']; check('unreadable examples are reported', pr['refs'] and pr['refs'][0]['n']>=1, pr)
    st=api('/state'); check('scan survived broken examples', st['counts']['analyzed']>0, st['counts']); check('files tagged', st['counts']['analyzed']>0, st['counts'])
    t=api('/models/test',{}); check('model self test', t.get('ok'), t)
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1100,'height':680}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.click('#laysw button:has-text("Masonry")'); pg.wait_for_timeout(800)
        r=pg.evaluate("(()=>{const g=document.querySelector('#grid');return {sh:g.scrollHeight,ch:g.clientHeight,sw:g.scrollWidth,cw:g.clientWidth}})()")
        check('masonry scrolls vertically', r['sh']>r['ch']+20 and r['sw']<=r['cw']+1, r)
        pg.evaluate("document.querySelector('#grid').scrollTop=400"); check('masonry scrollTop moves', pg.evaluate("document.querySelector('#grid').scrollTop")>0)
        pg.click('#laysw button:has-text("Grid")'); pg.wait_for_timeout(500)
        check('grid tiles back', pg.locator('#grid .tile').count()>3)
        for route in ['sets','dupes']:
            pg.goto(f'{base}/?t=t#{route}'); pg.wait_for_timeout(1500)
            n=pg.locator('img[data-view]').count()
            if n==0: print('no',route,'in corpus'); continue
            pg.locator('img[data-view]').first.click(); pg.wait_for_timeout(800)
            check(route+' viewer opens', pg.evaluate("!document.querySelector('#viewer').classList.contains('hidden')") and pg.locator('#v_media').count()==1)
            pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300)
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            check(route+' viewer closes', pg.evaluate("document.querySelector('#viewer').classList.contains('hidden')"))
        check('no page errors', not errs, errs[:3])
        b.close()
except Exception as e:
    import traceback; traceback.print_exc(); ok=False
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
