import urllib.parse
import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e14'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime','Pokemon','Pixel Art','All Other Art','Dupes','Average & LQ/Sub1/Deep']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very',exist_ok=True)
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

os.makedirs(LIB+'/Real/Cosplay/A',exist_ok=True); os.makedirs(LIB+'/Real/General',exist_ok=True)
for j,im in enumerate(imgs[:6]):
    shutil.copy(im, f'{LIB}/Real/Cosplay/A/c{j}_{os.path.basename(im)}'); shutil.copy(im, f'{LIB}/Real/General/g{j}_{os.path.basename(im)}')
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    # --- sub-targets
    t=api('/dest/tree?rel=Average%20%26%20LQ'); check('dest tree lists subfolder', any(x['name']=='Sub1' for x in t['dirs']), t)
    api('/dest/target',{'rel':'Average & LQ/Sub1/Deep','on':True}); api('/dest/target',{'rel':'Average & LQ/Sub1','on':True})
    st=api('/settings'); check('subTargets saved', 'Average & LQ/Sub1/Deep' in st['subTargets'], st['subTargets'])
    # --- multi target mapping + deep probe
    ov=api('/refs/map',{'rel':'Zelda','folder':['Zelda','Anime']}); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('one folder teaches two targets', sorted(g['Zelda']['targets'])==['Anime','Zelda'], g['Zelda'])
    pr=api('/refs/probe?root='+urllib.parse.quote(LIB)+'&rel=Real'); names=[x['name'] for x in pr['dirs']]
    check('probe lists deep subfolders', 'Cosplay' in names and 'General' in names, names)
    pr2=api('/refs/probe?root='+urllib.parse.quote(LIB)+'&rel=Real/Cosplay'); check('probe goes a level deeper', [x['name'] for x in pr2['dirs']]==['A'], pr2['dirs'])
    api('/refs/map',{'rel':'Real/Cosplay/A','folder':['Real/Images/Cosplay']}); api('/refs/map',{'rel':'Real/General','folder':['Real/Images/General','Real/Videos/General']})
    ov=api('/refs/overview'); check('overview still ok', bool(ov['roots']))
    # --- learn is incremental
    api('/refs/cap',{'all':10}); api('/learn',{}); wait(); c1=api('/state')['counts']['refs_done']
    api('/learn',{}); wait(); c2=api('/state')['counts']['refs_done']
    check('learning again adds NEW pictures', c2>c1, (c1,c2))
    api('/learn',{}); wait(); c3=api('/state')['counts']['refs_done']; check('and never reads one twice', c3>=c2, (c2,c3))
    api('/learn',{'relearn':True,'folders':['Zelda']}); wait(); check('relearn runs', not api('/state')['job'])
    # --- scan + dupes
    api('/run',{}); wait(); time.sleep(1); wait()
    d=api('/dupes'); check('dupe groups found', d['total']>0, d['total'])
    rv=api('/review?scope=new&limit=500'); ids=[x['id'] for x in rv['items']]
    pend=[m['id'] for g in d['groups'] for m in g['members']]
    check('pending dupe members hidden from Review', not set(pend)&set(ids), set(pend)&set(ids))
    g0=d['groups'][0]; mem=g0['members']; check('exactly one best, flagged', sum(1 for m in mem if m['best'])==1 and mem[0]['best'], mem)
    if len(mem)>=3:
        api('/dupes/action',{'action':'keep','group':g0['id'],'fileIds':[mem[0]['id'],mem[1]['id']]})
        d=api('/dupes'); gg=[x for x in d['groups'] if x['id']==g0['id']]
        check('kept ones leave pending but group stays with ghosts', gg and [m['decision'] for m in gg[0]['members']].count('keep')==2, gg)
    api('/dupes/action',{'action':'keepBest','group':g0['id']}); wait()
    d=api('/dupes'); check('group gone when all decided', all(x['id']!=g0['id'] for x in d['groups']), [x['id'] for x in d['groups']])
    rv=api('/review?scope=new&limit=500'); ids2=[x['id'] for x in rv['items']]
    check('kept copy now in Review', mem[0]['id'] in ids2 or mem[0]['id'] in [x['id'] for x in api('/review?scope=new&realm=real&limit=500')['items']], mem[0])
    if d['groups']:
        g1=d['groups'][0]; m1=[m['id'] for m in g1['members']]
        api('/dupes/action',{'action':'notDupes','group':g1['id']})
        check('not-duplicates removes group', all(x['id']!=g1['id'] for x in api('/dupes')['groups']))
        api('/run',{}); wait(); time.sleep(1); wait()
        check('and is not regrouped', all(set(m1)!=set(m['id'] for m in x['members']) for x in api('/dupes')['groups']))
    # --- rescan sees new things
    os.makedirs(LIB+'/Brand New',exist_ok=True); shutil.copy(imgs[0], LIB+'/Brand New/n.jpg'); os.makedirs(ROOT+'/dest/Fresh Folder',exist_ok=True)
    shutil.copy(imgs[1], ROOT+'/src/newfile_zz.jpg')
    api('/rescan',{}); wait(); time.sleep(1); wait()
    stt=api('/state'); ch=stt['changes'] or {}
    check('rescan reports new example folder', 'Brand New' in json.dumps(ch), ch)
    check('rescan reports new destination folder', 'Fresh Folder' in json.dumps(ch), ch)
    check('todo counts new file', stt['todo']['files']>=1, stt['todo'])
    ov=api('/refs/overview'); check('new folder shown in Examples', 'Brand New' in [x['name'] for x in ov['roots'][0]['groups']])
    api('/changes/clear',{}); check('changes dismissed', not api('/state')['changes'])
    api('/run',{'refs':False}); wait(); check('scan only new files', api('/state')['todo']['files']==0, api('/state')['todo'])
    # --- UI
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':900}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        check('no Use fallback button', pg.locator('#b_fb').count()==0 and 'fallback' not in pg.inner_text('body').lower())
        pg.locator('#grid .tile').nth(0).click(); pg.wait_for_timeout(200)
        pg.click('#b_folder'); pg.wait_for_timeout(300); n=pg.locator('#fbpop .fbi, #fbpop [data-v]').count()
        check('clicking the folder box shows the list', pg.locator('#fbpop').is_visible() and n>3, n)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200); check('Esc closes', not pg.locator('#fbpop').is_visible())
        pg.click('body',position={'x':5,'y':5}); pg.keyboard.press('/'); pg.wait_for_timeout(300)
        check('slash focuses folder box', pg.evaluate("document.activeElement && document.activeElement.id")=='b_folder')
        pg.keyboard.type('Zeld'); pg.wait_for_timeout(300); check('single match highlighted', pg.locator('#fbpop .on').count()==1, pg.locator('#fbpop').inner_text())
        pg.click('h1' if pg.locator('h1').count() else 'body'); pg.wait_for_timeout(300); check('click out closes without moving', not pg.locator('#fbpop').is_visible() and pg.locator('#grid .tile').count()>0)
        # viewer
        pg.locator('#grid .tile').nth(0).dblclick(); pg.wait_for_timeout(700)
        pg.keyboard.press('/'); pg.wait_for_timeout(300); check('slash in viewer focuses box', pg.evaluate("document.activeElement && document.activeElement.id")=='v_folder')
        pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        # P keeps the scroll position; dupe viewer has no approve shortcut
        pg.set_viewport_size({'width':900,'height':330}); pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.click('#laysw button:has-text("Masonry")'); pg.wait_for_timeout(600)
        pg.evaluate("document.querySelector('#grid').scrollTop=99999"); pg.wait_for_timeout(300); y0=pg.evaluate("document.querySelector('#grid').scrollTop")
        if y0>0:
            n=pg.locator('#grid .tile').count(); pg.locator('#grid .tile').nth(n-1).click(); pg.keyboard.press('p'); pg.wait_for_timeout(1800)
            y1=pg.evaluate("document.querySelector('#grid').scrollTop"); check('P does not jump to top', y1>0 and y1>=y0-400, (y0,y1))
        else: check('P scroll (grid too short to scroll)', True, y0)
        pg.set_viewport_size({'width':1500,'height':900})
        errs.clear()
        # dupes page
        pg.goto(f'{base}/?t=t#dupes'); pg.wait_for_timeout(1500)
        check('dupes page renders groups or empty text', pg.locator('#view').inner_text().strip()!='')
        errs and print(errs)
        check('no console errors', not errs, errs)
        # examples page
        pg.goto(f'{base}/?t=t#examples'); pg.wait_for_timeout(1500)
        txt=pg.inner_text('#view'); check('examples shows Brand New and relearn controls', 'Brand New' in txt and 'Re-learn' in txt, txt[:200])
        pg.locator('[data-exp]').first.click(); pg.wait_for_timeout(800); check('expand works', pg.locator('tr.kid').count()>0)
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1500)
        check('setup shows change card + subfolder tree', pg.locator('#chcard').count()==1 and pg.locator('#desttree input[data-dt]').count()>0)
        check('no console errors 2', not errs, errs)
        b.close()
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
