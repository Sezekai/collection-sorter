import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e7'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
    st=api('/state'); check('scanned', st['counts']['analyzed']>0, st['counts'])
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1700,'height':900}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#tags'); pg.wait_for_timeout(1800)
        n0=pg.locator('#grid .tile').count(); check('tiles', n0>3, n0)
        # tags on tiles: all tags incl. unsure ones, clickable
        tg=pg.locator('#grid .tile .tg[data-tag]'); check('tile tags rendered', tg.count()>10, tg.count())
        names=pg.evaluate("[...new Set([...document.querySelectorAll('#grid .tile .tg[data-tag]')].map(x=>x.dataset.tag))]")
        def sel(): return pg.evaluate("document.querySelectorAll('#tchips .tchip').length")
        a=names[0]; pg.evaluate("(t)=>{const e=[...document.querySelectorAll('#grid .tile .tg[data-tag]')].find(x=>x.dataset.tag===t); e.scrollIntoView(); e.click()}",a); pg.wait_for_timeout(700)
        check('click tag adds to selection', sel()>=1, sel())
        n1=pg.locator('#grid .tile').count()
        b2=[x for x in pg.evaluate("[...document.querySelectorAll('#grid .tile .tg[data-tag]')].map(x=>x.dataset.tag)") if x!=a]
        if b2:
            pg.evaluate("(t)=>{[...document.querySelectorAll('#grid .tile .tg[data-tag]')].find(x=>x.dataset.tag===t).click()}",b2[0]); pg.wait_for_timeout(700)
            check('second tag selected', sel()==2, sel())
            pg.go_back(); pg.wait_for_timeout(900)
            check('back returns to one tag', sel()==1, sel())
            pg.go_forward(); pg.wait_for_timeout(900)
            check('forward returns to two tags', sel()==2, sel())
            pg.go_back(); pg.wait_for_timeout(700); pg.go_back(); pg.wait_for_timeout(900)
            check('back again clears all', sel()==0, sel())
        # viewer + tag from viewer
        pg.evaluate("document.querySelector('#grid .tile').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))"); pg.wait_for_timeout(1000)
        check('viewer open', pg.evaluate("!document.querySelector('#viewer').classList.contains('hidden')"))
        vt=pg.locator('#v_tags .tg[data-tag]'); check('viewer tags clickable', vt.count()>0, vt.count())
        if vt.count():
            t0=vt.first.get_attribute('data-tag'); vt.first.click(); pg.wait_for_timeout(1000)
            check('viewer closed after tag click', pg.evaluate("document.querySelector('#viewer').classList.contains('hidden')"))
            check('tag selected from viewer', sel()==1, sel())
            pg.go_back(); pg.wait_for_timeout(1200)
            check('back returns to the picture', pg.evaluate("!document.querySelector('#viewer').classList.contains('hidden')"))
            pg.go_back(); pg.wait_for_timeout(900)
            check('back again leaves viewer', pg.evaluate("document.querySelector('#viewer').classList.contains('hidden')"))
        # close with X steps back
        pg.evaluate("document.querySelector('#grid .tile').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))"); pg.wait_for_timeout(800)
        pg.click('#v_close'); pg.wait_for_timeout(700)
        check('x closes viewer', pg.evaluate("document.querySelector('#viewer').classList.contains('hidden')"))
        check('no page errors', not errs, errs[:3])
        b.close()
except Exception as e:
    import traceback; traceback.print_exc(); ok=False
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
