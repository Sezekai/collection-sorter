import subprocess, os, time, json, shutil, re, urllib.request, sys, threading, glob, sqlite3
from playwright.sync_api import sync_playwright
# Build 1.7: tag sets per tagger + Tag again, Look Up / Find Higher Quality folders (+ the one-time tidy-up), Delete, G/N/V, right-click menu,
# viewer tag tabs and video overlay, Make folder from Examples, real-life tags from JoyTag, responsiveness of the engine.
ROOT='/tmp/e2e19'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
DEST=ROOT+'/dest'; SORT=ROOT+'/Sort'
for f in ['Zelda','Anime','Pokemon','All Other Art']: os.makedirs(f'{DEST}/{f}/NSFW/Very',exist_ok=True)
# two downloaded taggers (the dummy WD model under both folders)
M=ROOT+'/models'; os.makedirs(M)
for d in ['clip','joytag','wd14']: shutil.copytree('/tmp/dummy/'+d, M+'/'+d)
shutil.copytree('/tmp/dummy/wd14', M+'/wd14-vit-large')
LIB=ROOT+'/lib'; imgs=sorted(glob.glob('/tmp/corpus/*.jpg')+glob.glob('/tmp/corpus/*.png'))
for name in ['Zelda','Brand New Folder']:
    os.makedirs(LIB+'/'+name,exist_ok=True)
    for j,im in enumerate(imgs[:4]): shutil.copy(im, f'{LIB}/{name}/{j}_{os.path.basename(im)}')
procs=[]
def start():
    env=dict(os.environ, CS_DATA=ROOT+'/data', CS_TOKEN='t', CS_ROOT=ROOT+'/root')
    p=subprocess.Popen(['node','engine/server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    logs=[]
    for l in p.stdout:
        logs.append(l); m=re.match(r'ENGINE_PORT=(\d+)',l)
        if m: port=int(m.group(1)); break
    threading.Thread(target=lambda: [logs.append(x) for x in p.stdout], daemon=True).start()
    procs.append(p); return p, f'http://127.0.0.1:{port}', logs
p, base, logs = start()
def api(path,body=None):
    r=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'x-token':'t','content-type':'application/json'})
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return {'httpError': e.code, **json.loads(e.read() or b'{}')}
lat=[]
def wait(t=300):
    time.sleep(1)
    for _ in range(t):
        a=time.time(); s=api('/state'); lat.append(time.time()-a)
        if not s['job'] and not s.get('queue'): return s
        time.sleep(0.5)
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,'' if c else i); sys.stdout.flush()
def db(): return sqlite3.connect(ROOT+'/data/sorter.db')
def item(i): return api('/review?scope=any&ids=%d'%i)['items'][0]
try:
    api('/settings',{'destinationRoot':DEST,'sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':M},'tagger':{'device':'cpu','model':'swinv2'},'autoRescan':False,
                     'lookupRoot':SORT+'/Look Up','fhqRoot':SORT+'/Find Higher Quality'})
    wait()
    st=api('/state'); opts={o['key']:o for o in st['tagger']['options']}
    check('six taggers offered, Haruka first', list(opts)[:3]==['haruka','pixai','camie'] and len(opts)==6, list(opts))
    check('downloaded taggers show as ready', opts['swinv2']['ready'] and opts['vit-large']['ready'] and not opts['haruka']['ready'], {k:o['ready'] for k,o in opts.items()})
    api('/run',{'refs':True}); wait()
    c=db(); nfiles=c.execute("select count(*) from files where analyzed=1 and status='new'").fetchone()[0]
    sets=dict(c.execute("select tagger,count(*) from tagsets group by tagger").fetchall())
    check('scan stores a tag set per tagger', sets.get('swinv2')==nfiles and sets.get('joytag')==nfiles, (sets,nfiles))
    check('the sorting uses the chosen tagger', c.execute("select count(*) from files where analyzed=1 and status='new' and tagger='swinv2'").fetchone()[0]==nfiles)
    # ---- tag again with another tagger (all files) keeps both
    r=api('/retag',{'tagger':'vit-large','scope':'files'}); check('tag again starts', r.get('started') or r.get('queued'), r); wait()
    sets=dict(c.execute("select tagger,count(*) from tagsets group by tagger").fetchall())
    check('tagging again adds a set and keeps the old one', sets.get('vit-large')==nfiles and sets.get('swinv2')==nfiles, sets)
    check('…and the sorting still uses the chosen one', c.execute("select count(*) from files where analyzed=1 and status='new' and tagger='swinv2'").fetchone()[0]==nfiles)
    r=api('/retag',{'tagger':'haruka','scope':'files'}); check('a tagger that is not downloaded is refused with a reason', r.get('httpError')==400 and 'download' in r.get('error','').lower(), r)
    one=api('/review?scope=new&limit=100')['items']; fid=one[0]['id']
    tf=api('/tags/file?id=%d'%fid); srcs=[x['src'] for x in tf['sets']]
    check('a picture has the sorting tags plus every tagger’s set', srcs[0]=='' and {'swinv2','vit-large','joytag'}<=set(srcs), srcs)
    tv=api('/tags?tsrc=vit-large&scope=new'); check('the Tags list can show another tagger’s tags', tv.get('tags') and len(tv['tags'])>0, tv)
    # ---- switch the sorting tagger in Settings
    api('/settings',{'tagger':{'model':'vit-large'}}); time.sleep(1); wait()
    check('choosing another tagger switches the sorting tags', c.execute("select count(*) from files where analyzed=1 and status='new' and tagger='vit-large'").fetchone()[0]==nfiles)
    check('…without losing the others', dict(c.execute("select tagger,count(*) from tagsets group by tagger").fetchall()).get('swinv2')==nfiles)
    # ---- real life is read with JoyTag
    vid=[i for i in api('/review?scope=new&limit=200')['items'] if i['kind']=='video'][0]
    api('/suggestion',{'ids':[vid['id']],'action':'setReal','real':True}); time.sleep(0.5)
    real=[i for i in api('/review?scope=new&limit=200&realm=real')['items']]
    if real:
        t0=api('/tags/file?id=%d'%real[0]['id'])['sets'][0]; jt=[x for x in api('/tags/file?id=%d'%real[0]['id'])['sets'] if x['src']=='joytag'][0]
        check('real-life sorting tags are JoyTag’s', {x['tag'] for x in t0['tags']} <= {x['tag'] for x in jt['tags']}, (t0['tags'][:5], jt['tags'][:5]))
    else: check('a real-life file in the test set', False)
    # ---- Make the folder an example set points to
    kn=api('/refs/mkdir',{'name':'Brand New Folder','src':'Brand New Folder'})
    check('Make folder creates it in the destination', os.path.isdir(DEST+'/Brand New Folder'), kn)
    # ---- the window
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1920,'height':1080}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)+' @ '+(e.stack or '')[:300])); pg.on('console',lambda m: errs.append(m.text+' '+str(m.location)) if m.type=='error' else None); pg.on('response', lambda r: errs.append('404 '+r.url) if r.status==404 else None)
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        check('bulk bar fits on one line at 1920', pg.evaluate("(()=>{const b=document.querySelector('#bulk');return b.scrollWidth<=b.clientWidth+1})()"))
        wide=pg.evaluate("[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.getBoundingClientRect().width>innerWidth*0.6).map(b=>b.id||b.textContent.trim().slice(0,30))")
        check('no button stretches across the screen', not wide, wide)
        # colour-coded rating buttons
        cols=pg.evaluate("['general','nsfw','very'].map(k=>getComputedStyle(document.querySelector('#b_rate [data-r='+k+']')).color)")
        check('General / NSFW / Very buttons have three different colours', len(set(cols))==3, cols)
        # G N V on a selection
        tiles=pg.locator('#grid .tile'); t1=tiles.nth(0); i1=int(t1.get_attribute('data-id')); t1.click()
        for key,val in [('n','nsfw'),('v','very'),('g','general')]:
            pg.keyboard.press(key); pg.wait_for_timeout(500); r=item(i1); eff=r.get('userRating') or r.get('user_rating') or r.get('rating')
            check(f'{key.upper()} sets {val}', eff==val, r)
        # right-click menu
        tiles.nth(1).click(button='right'); pg.wait_for_timeout(300)
        menu=pg.inner_text('#ctxmenu') if pg.locator('#ctxmenu').count() else ''
        check('right-click opens a menu with Tag again, Look Up and Delete', all(x in menu for x in ['Tag again','Look Up','Recycle Bin']), menu)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # select two and right-click: Tag again for both
        tiles.nth(1).click(); tiles.nth(2).click(modifiers=['Control']); ids2=[int(tiles.nth(k).get_attribute('data-id')) for k in (1,2)]
        tiles.nth(2).click(button='right'); pg.wait_for_timeout(300)
        check('right-click on a selection acts on all of it', '2' in pg.inner_text('#ctxmenu'), pg.inner_text('#ctxmenu'))
        pg.locator('#ctxmenu button', has_text='Tag again with WD SwinV2').first.click(); pg.wait_for_timeout(600); wait()
        ts=[c.execute("select ts from tagsets where file_id=? and tagger='swinv2'",(i,)).fetchone()[0] for i in ids2]
        check('Tag again from the menu re-tags just those', all(t>time.time()*1000-60000 for t in ts), ts)
        # L sends to Look Up (NSFW kept), Delete asks Windows (here: the browser has no Recycle Bin → clear error, nothing deleted)
        pg.goto(f'{base}/?t=t#review'); pg.reload(); pg.wait_for_timeout(1500); tiles=pg.locator('#grid .tile')
        tl=tiles.nth(0); il=int(tl.get_attribute('data-id')); tl.click(); pg.keyboard.press('n'); pg.wait_for_timeout(400); pg.keyboard.press('l'); pg.wait_for_timeout(1500)
        r=item(il); check('L moves it to Look Up/NSFW', r['path'].replace('\\','/').startswith(SORT+'/Look Up/NSFW/'), r['path'])
        tdel=pg.locator('#grid .tile').nth(0); idel=int(tdel.get_attribute('data-id')); pdel=item(idel)['path']; tdel.click(); pg.keyboard.press('Delete'); pg.wait_for_timeout(800)
        check('without a Recycle Bin, Delete shows an error and deletes nothing', os.path.exists(pdel) and ('Recycle Bin' in pg.inner_text('#toasts') or pg.locator('#modal:not(.hidden)').count()), pg.inner_text('#toasts'))
        pg.keyboard.press('Escape')
        # the window's own Recycle Bin path: pretend the shell sent it and check the engine forgets it
        os.makedirs(ROOT+'/bin',exist_ok=True); shutil.move(pdel, ROOT+'/bin/x'); rr=api('/deleted',{'ids':[idel]})
        check('a recycled file leaves the app', rr.get('recorded')==1 and item(idel)['status']=='deleted', rr)
        # Q then approve: Find Higher Quality/<folder>/NSFW
        pg.goto(f'{base}/?t=t#review'); pg.reload(); pg.wait_for_timeout(1500); tq=pg.locator('#grid .tile').nth(0); iq=int(tq.get_attribute('data-id')); tq.click()
        pg.keyboard.press('n'); pg.wait_for_timeout(300); pg.keyboard.press('q'); pg.wait_for_timeout(500); api('/suggestion',{'ids':[iq],'action':'setFolder','folder':'Anime'}); pg.wait_for_timeout(1500)
        r=item(iq); folder=r.get('userFolder') or r.get('folder')
        check('Find HQ + approve goes to Find Higher Quality/<folder>/NSFW', r['path'].replace('\\','/').startswith(f'{SORT}/Find Higher Quality/') and '/NSFW/' in r['path'], (r['path'], folder))
        # viewer: tag tabs, G N V, L
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1200); pg.locator('#grid .tile').nth(0).dblclick(); pg.wait_for_timeout(1500)
        tabs=pg.locator('#v_ttabs .tab'); check('viewer shows a tab per tagger', tabs.count()>=3, tabs.count())
        if tabs.count()>=2:
            tabs.nth(1).click(); pg.wait_for_timeout(300); check('clicking a tab shows that tagger', 'on' in (pg.locator('#v_ttabs .tab').nth(1).get_attribute('class') or ''))
        check('viewer rating buttons are colour-coded', pg.locator('#v_rate .r-general').count()==1 and pg.locator('#v_rate .r-very').count()==1)
        pg.screenshot(path=ROOT+'/viewer.png'); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        # video overlay: hidden with the cursor when the mouse rests, shown while it moves
        pg.goto(f'{base}/?t=t#real'); pg.wait_for_timeout(1200)
        vt=pg.locator('#grid .tile[data-kind="video"]').first
        if vt.count():
            vt.dblclick(); pg.wait_for_timeout(1200); box=pg.locator('#stage').bounding_box()
            pg.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2); pg.mouse.move(box['x']+box['width']/2+10, box['y']+box['height']/2+5); pg.wait_for_timeout(300)
            check('video controls show while the mouse moves', pg.locator('#stage.vidle').count()==0)
            pg.wait_for_timeout(2300); check('…and hide with the cursor when it rests', pg.locator('#stage.vidle').count()==1 and pg.evaluate("getComputedStyle(document.querySelector('#stage')).cursor")=='none')
            ov=pg.locator('#vov').bounding_box(); pg.mouse.move(ov['x']+ov['width']/2, ov['y']+ov['height']/2); pg.wait_for_timeout(2500)
            check('…but stay while the mouse is over the controls', pg.locator('#stage.vidle').count()==0)
            sb=pg.locator('#stage').bounding_box(); vb=pg.locator('#v_media').bounding_box(); vbot=min(vb['y']+vb['height'], sb['y']+sb['height']); check('controls sit on the bottom edge of the video', abs(ov['y']+ov['height']-vbot)<3 and ov['x']>=max(vb['x'],sb['x'])-1, (ov, vb, sb))
            pg.screenshot(path=ROOT+'/video.png'); pg.keyboard.press('Escape')
        else: check('a video in the test set', False)
        # Tags section: choose the tagger
        pg.goto(f'{base}/?t=t#tags'); pg.wait_for_timeout(1500)
        check('Tags section has a tagger chooser', pg.locator('#tsrc').count()==1)
        opts=pg.eval_on_selector_all('#tsrc option','o=>o.map(x=>x.value)'); check('…listing the taggers that have tags', {'','swinv2','vit-large','joytag'}<=set(opts), opts)
        pg.select_option('#tsrc','swinv2'); pg.wait_for_timeout(1200); check('…and it lists that tagger’s tags', pg.locator('#tlist .fitem').count()>0)
        # Setup: AI models card
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1500)
        pg.click('[data-part="models"]'); pg.wait_for_timeout(300); txt=pg.inner_text('[data-partbody="models"]'); check('Setup lists the taggers with the sorting one chosen', 'Haruka' in txt and 'PixAI' in txt and 'Camie' in txt, '')
        check('Setup has the Look Up and Find Higher Quality folders', pg.locator('#lookroot').count()==1 and pg.locator('#fhqroot').count()==1)
        for w in [1280, 2560]:
            pg.set_viewport_size({'width':w,'height':1000})
            for r in ['review','tags','setup','knows','settings']:
                pg.goto(f'{base}/?t=t#{r}'); pg.wait_for_timeout(900)
                side=pg.evaluate("document.documentElement.scrollWidth<=innerWidth+1"); check(f'{r} at {w}: no sideways scroll', side)
            pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(900); pg.screenshot(path=f'{ROOT}/review_{w}.png')
        check('the removed sections are gone', pg.evaluate("!document.querySelector('[href=\"#sauce\"],[href=\"#fhq\"]')"))
        check('no page errors', not errs, errs[:5]); b.close()
    # ---- the one-time tidy-up of the old folders (needs a fresh start)
    p.terminate(); p.wait()
    os.makedirs(DEST+'/Anime/Find Higher Quality',exist_ok=True); os.makedirs(DEST+'/Anime/NSFW/Find Higher Quality',exist_ok=True)
    shutil.copy(imgs[0], DEST+'/Anime/Find Higher Quality/old1.jpg'); shutil.copy(imgs[1], DEST+'/Anime/NSFW/Find Higher Quality/old2.jpg')
    c.execute("delete from kv where k='migrated17'"); c.commit()
    p, base, logs = start(); time.sleep(3); wait()
    check('old Find Higher Quality files moved by folder', os.path.exists(SORT+'/Find Higher Quality/Anime/old1.jpg') and os.path.exists(SORT+'/Find Higher Quality/Anime/NSFW/old2.jpg'), glob.glob(SORT+'/Find Higher Quality/**',recursive=True))
    check('…and the old folders removed', not os.path.exists(DEST+'/Anime/Find Higher Quality') and not os.path.exists(DEST+'/Anime/NSFW/Find Higher Quality'))
    check('engine answered quickly throughout', max(lat)<0.5, max(lat))
finally:
    for x in procs:
        try: x.terminate()
        except Exception: pass
print('ALL OK' if ok else 'FAILED')
