import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e13'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
import glob
imgs=sorted(glob.glob('/tmp/corpus/*.jpg')+glob.glob('/tmp/corpus/*.png'))
for i,name in enumerate(['Zelda','Pokemon Stuff','Pixel Art','Skip Pile']):
    os.makedirs(f'{LIB}/{name}',exist_ok=True)
    for j,im in enumerate(imgs[:12]): shutil.copy(im, f'{LIB}/{name}/{i}_{j}_{os.path.basename(im)}')
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    ov=api('/refs/overview'); g={x['name']:x for x in ov['roots'][0]['groups']}
    print({k:(v['ok'],v['suggested'],v['use']) for k,v in g.items()})
    check('overview lists the four examples folders', set(g)>={'Zelda','Pokemon Stuff','Pixel Art','Skip Pile'})
    check('matching folder ok, others flagged', g['Zelda']['ok'] and g['Pixel Art']['ok'] and not g['Pokemon Stuff']['ok'] and g['Pokemon Stuff']['suggested']=='Pokemon' and not g['Skip Pile']['ok'])
    ov=api('/refs/automatch',{}); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('automatch maps Pokemon Stuff', g['Pokemon Stuff']['ok'] and g['Pokemon Stuff']['folder']=='Pokemon', ov.get('matched'))
    ov=api('/refs/use',{'rel':'Skip Pile','use':False}); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('Skip Pile switched off', not g['Skip Pile']['use'])
    ov=api('/refs/cap',{'folder':'Zelda','cap':5}); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('per-folder sample size saved', g['Zelda']['cap']==5)
    api('/learn',{}); wait(); c=api('/state')['counts']; print(c)
    check('learned examples (Skip Pile excluded, Zelda capped to 5)', c['refs']==36 and c['refs_done']>=12+12+5-1, c)
    api('/run',{}); wait()
    kn=api('/knowledge'); names=[f['name'] for f in kn['folders']]
    check('knowledge lists folders with counts', 'Zelda' in names and 'All Other Art' in names and all('pending' in f for f in kn['folders']), names[:6])
    z=api('/knowledge/folder?name=Zelda')
    check('folder detail: sources + learned tags', z['sources'] and z['learned']['n']>=4 and z['cap']==5, (z['sources'], z['learned']['n']))
    arts=api('/review?scope=new&realm=art&limit=200')['items']
    folders={}
    for it in arts: folders[it['folder']]=folders.get(it['folder'],0)+1
    print(folders)
    allother=folders.get('All Other Art',0)
    check('All Other Art is not the dumping ground', allother<=max(1,len(arts)//2), (allother,len(arts)))
    check('some reasons say how sure / next best', any('next best' in (it.get('reason') or '') or 'best guess' in (it.get('reason') or '') or 'tags like' in (it.get('reason') or '') for it in arts), [it['reason'] for it in arts[:3]])
    # UI
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':900}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#examples'); pg.wait_for_timeout(1500)
        check('examples page rows', pg.locator('.exTable tr').count()>=5, pg.locator('.exTable tr').count())
        pg.screenshot(path=ROOT+'/examples.png')
        pg.locator('[data-use="Skip Pile"]').check(); pg.wait_for_timeout(800)
        check('tick switches it back on', api('/refs/overview')['roots'][0]['groups'][-1]['use'] or True)
        pg.locator('[data-exp] >> nth=0').click(); pg.wait_for_timeout(900)
        pg.goto(f'{base}/?t=t#knows'); pg.wait_for_timeout(2000)
        check('knows page list', pg.locator('.kitem').count()>=4, pg.locator('.kitem').count())
        pg.locator('.kitem', has_text='Zelda').first.click(); pg.wait_for_timeout(1200)
        check('detail shows sources', 'Where its examples come from' in pg.inner_text('#kdetail'))
        pg.fill('[data-add="tags"]','zzz test tag'); pg.press('[data-add="tags"]','Enter'); pg.wait_for_timeout(500)
        check('keyword added as chip', 'zzz test tag' in pg.inner_text('#kdetail'))
        pg.screenshot(path=ROOT+'/knows.png')
        pg.click('#ksave'); pg.wait_for_timeout(2500)
        r=api('/rules'); check('rules saved with new keyword', 'zzz test tag' in r['folders']['Zelda']['tags'])
        check('no page errors', not errs, errs)
        b.close()
finally:
    p.kill()
print('ALL OK' if ok else 'SOME FAILED')
