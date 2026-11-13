import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e4'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':2000,'height':1100}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        n=pg.locator('#grid .tile').count(); check('tiles shown', n>5, n)
        pg.screenshot(path=ROOT+'/grid.png')
        def hscroll(): return pg.evaluate("[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+2 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>e.id||e.className).slice(0,5)")
        # grid tile height sane
        hs=pg.evaluate("[...document.querySelectorAll('#grid .tile')].slice(0,4).map(t=>Math.round(t.getBoundingClientRect().height))")
        check('grid tiles have height', all(h>100 for h in hs), hs)
        # layouts
        for lay in ['Masonry','Cards']:
            pg.click(f'#laysw button:has-text("{lay}")'); pg.wait_for_timeout(700); pg.screenshot(path=ROOT+f'/{lay}.png')
            hs=pg.evaluate("[...document.querySelectorAll('#grid .tile')].slice(0,4).map(t=>Math.round(t.getBoundingClientRect().height))")
            check(lay+' tiles have height', all(h>60 for h in hs), hs)
            check(lay+' no horizontal scroll', pg.evaluate("document.querySelector('#grid').scrollWidth<=document.querySelector('#grid').clientWidth+1"))
        pg.click('#laysw button:has-text("Grid")'); pg.wait_for_timeout(500)
        # selection: click, ctrl-wheel unaffected, marquee, deselect all
        tiles=pg.locator('#grid .tile'); tiles.nth(0).click(); check('click selects', pg.locator('#grid .tile.sel').count()==1)
        tiles.nth(2).click(); check('click while selected adds', pg.locator('#grid .tile.sel').count()==2)
        check('deselect button present', pg.locator('#b_none').count()==1)
        pg.click('#b_none'); check('deselect all', pg.locator('#grid .tile.sel').count()==0)
        r0=tiles.nth(0).bounding_box(); r3=tiles.nth(3).bounding_box()
        pg.mouse.move(r0['x']+6, r0['y']+6); pg.mouse.down(); pg.mouse.move(r3['x']+r3['width']-5, r3['y']+r3['height']-5, steps=8); pg.mouse.up()
        check('marquee selects several', pg.locator('#grid .tile.sel').count()>=3, pg.locator('#grid .tile.sel').count())
        # drag more while one selected adds
        pg.keyboard.press('Escape'); check('Esc deselects', pg.locator('#grid .tile.sel').count()==0)
        # additive marquee: with one selected, dragging over more adds them
        tiles.nth(0).click(); b3=tiles.nth(5).bounding_box(); b4=tiles.nth(6).bounding_box()
        pg.mouse.move(b3['x']-1, b3['y']+b3['height']+2); pg.mouse.down(); pg.mouse.move(b4['x']+b4['width']-6, b4['y']+b4['height']-6, steps=8); pg.mouse.up()
        check('drag adds to existing selection', pg.locator('#grid .tile.sel').count()>=3 and tiles.nth(0).evaluate("e=>e.classList.contains('sel')"), pg.locator('#grid .tile.sel').count())
        pg.keyboard.press('Escape')
        # ctrl+wheel size, ctrl+shift+wheel columns (cards)
        t0=PREFS=pg.evaluate('PREFS.tile'); gb=pg.locator('#grid').bounding_box(); pg.mouse.move(gb['x']+gb['width']/2, gb['y']+gb['height']/2); pg.keyboard.down('Control'); pg.mouse.wheel(0,-200); pg.keyboard.up('Control'); pg.wait_for_timeout(300)
        check('ctrl+wheel changes size', pg.evaluate('PREFS.tile')!=t0, (t0, pg.evaluate('PREFS.tile')))
        pg.click('#laysw button:has-text("Cards")'); pg.wait_for_timeout(400); c0=pg.evaluate('PREFS.cols'); h0=pg.evaluate('PREFS.cardh')
        pg.mouse.move(gb['x']+gb['width']/2, gb['y']+gb['height']/2); pg.keyboard.down('Control'); pg.keyboard.down('Shift'); pg.mouse.wheel(0,200); pg.keyboard.up('Shift'); pg.keyboard.up('Control'); pg.wait_for_timeout(300)
        check('ctrl+shift+wheel changes columns', pg.evaluate('PREFS.cols')!=c0, (c0, pg.evaluate('PREFS.cols')))
        pg.keyboard.down('Control'); pg.mouse.wheel(0,-200); pg.keyboard.up('Control'); pg.wait_for_timeout(300)
        check('ctrl+wheel changes card height', pg.evaluate('PREFS.cardh')!=h0)
        pg.click('#laysw button:has-text("Grid")'); pg.wait_for_timeout(300)
        # panel resizers
        w0=pg.evaluate("document.querySelector('#sidebar').getBoundingClientRect().width"); rz=pg.locator('#sidebar .rz').bounding_box()
        pg.mouse.move(rz['x']+3, rz['y']+300); pg.mouse.down(); pg.mouse.move(rz['x']+143, rz['y']+300, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
        w1=pg.evaluate("document.querySelector('#sidebar').getBoundingClientRect().width"); check('folder panel resizable', w1>w0+100, (w0,w1))
        n0=pg.evaluate("document.querySelector('#nav').getBoundingClientRect().width"); rz=pg.locator('#nav .rz').bounding_box()
        pg.mouse.move(rz['x']+3, rz['y']+300); pg.mouse.down(); pg.mouse.move(rz['x']-60, rz['y']+300, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
        n1=pg.evaluate("document.querySelector('#nav').getBoundingClientRect().width"); check('menu resizable', n1<n0-40, (n0,n1))
        time.sleep(0.6); check('widths saved', 'sb' in (api('/ui').get('widths') or {}))
        # display options
        pg.click('#rinfo'); pg.click('[data-all="0"]'); pg.wait_for_timeout(200)
        vis=pg.evaluate("[...document.querySelectorAll('#grid .tile .meta,#grid .tile .badges,#grid .tile .sc')].filter(e=>getComputedStyle(e).display!='none').length")
        check('all info off = only pictures', vis==0, vis); pg.click('[data-all="1"]'); pg.keyboard.press('Escape'); pg.mouse.click(900,5)
        # sort optgroups
        check('sort has reverse pairs', pg.locator('#rsort option').count()>=10)
        # keys: M menu, H cycle
        pg.mouse.click(1000,700); pg.keyboard.press('Escape')
        pg.keyboard.press('m'); pg.wait_for_timeout(400); check('M hides menu', pg.evaluate("document.body.classList.contains('nonav')")); pg.screenshot(path=ROOT+'/nonav.png')
        sbx=pg.evaluate("document.querySelector('#sidebar').getBoundingClientRect().left"); check('sidebar fills freed space', sbx<30, sbx)
        pg.keyboard.press('m'); pg.wait_for_timeout(300)
        pg.keyboard.press('h'); check('H1 hides folder panel only', pg.evaluate("document.body.classList.contains('nosb') && !document.body.classList.contains('hideui')"))
        pg.keyboard.press('h'); check('H2 hides all', pg.evaluate("document.body.classList.contains('hideui')"))
        pg.keyboard.press('h'); check('H3 restores', pg.evaluate("!document.body.classList.contains('hideui') && !document.body.classList.contains('nosb')"))
        pg.keyboard.press('k'); check('K opens shortcuts', pg.locator('#modal:not(.hidden)').count()==1); pg.keyboard.press('k'); check('K closes', pg.locator('#modal.hidden').count()==1)
        # viewer: T opens first
        pg.keyboard.press('t'); pg.wait_for_timeout(1200); check('T opens viewer', pg.locator('#viewer:not(.hidden)').count()==1); pg.screenshot(path=ROOT+'/viewer.png')
        check('viewer has select button', pg.locator('#v_sel').count()==1)
        pg.keyboard.press('x'); check('X selects in viewer', pg.locator('#v_sel').inner_text().startswith('✓'))
        check('no slideshow', pg.locator('#v_slide').count()==0)
        pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(500); pg.keyboard.press('x')
        pg.keyboard.press('t'); pg.wait_for_timeout(300); check('T closes viewer', pg.locator('#viewer.hidden').count()==1)
        check('2 selected carried to the list', pg.locator('#grid .tile.sel').count()==2, pg.locator('#grid .tile.sel').count())
        # rating select keeps selection and shows current
        pg.select_option('#b_rate','nsfw'); pg.wait_for_timeout(800)
        check('rating change keeps selection', pg.locator('#grid .tile.sel').count()==2)
        check('rating select shows value', pg.eval_on_selector('#b_rate','e=>e.value')=='nsfw')
        # Q toggles FHQ, approve moves
        ids=[int(x) for x in pg.eval_on_selector_all('#grid .tile.sel','els=>els.map(e=>e.dataset.id)')]
        pg.keyboard.press('q'); pg.wait_for_timeout(700)
        pg.keyboard.press('a'); pg.wait_for_timeout(2500)
        for i in ids:
            it=api('/review?scope=any&ids=%d'%i)['items'][0]; print(it['status'], it['path'])
        moved=[api('/review?scope=any&ids=%d'%i)['items'][0] for i in ids]
        check('approve moved them', all(m['status']=='moved' for m in moved))
        check('FHQ + NSFW path', all('find higher quality' in m['path'].lower() for m in moved) and '/nsfw/find higher quality/' in moved[0]['path'].lower(), [m['path'] for m in moved])
        check('moved leave review', all(pg.locator(f'#grid .tile[data-id="{i}"]').count()==0 for i in ids))
        # videos: hover preview + viewer controls + volume
        pg.goto(f'{base}/?t=t#real'); pg.wait_for_timeout(1500)
        vt=pg.locator('#grid .tile[data-kind="video"]').filter(has_text='clip.mp4').first; vid=vt.get_attribute('data-id')
        import urllib.request as U
        try:
            r=U.urlopen(U.Request(base+'/api/sprite/'+vid+'?t=t')); check('sprite endpoint', r.status==200 and r.headers['content-type']=='image/jpeg')
        except Exception as e: check('sprite endpoint', False, str(e))
        vt.hover(); pg.wait_for_timeout(1500); check('hover preview shown', pg.locator('.tile .vprev').count()==1); pg.screenshot(path=ROOT+'/hover.png')
        pg.mouse.move(5,5); pg.wait_for_timeout(300); check('hover preview removed', pg.locator('.tile .vprev').count()==0)
        vt.click(); pg.keyboard.press('t'); pg.wait_for_timeout(1500)
        check('viewer opened on video', pg.locator('#viewer video').count()==1); pg.screenshot(path=ROOT+'/vidviewer.png')
        v0=pg.evaluate('PREFS.volume'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(200); v1=pg.evaluate('PREFS.volume'); check('up arrow +3%', abs(v1-v0-0.03)<0.001, (v0,v1))
        pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowDown'); v2=pg.evaluate('PREFS.volume'); check('down arrow -3%', abs(v1-v2-0.06)<0.001)
        pg.keyboard.press('u'); check('U mutes', pg.evaluate('PREFS.muted')==True); pg.keyboard.press('u'); check('U restores', pg.evaluate('PREFS.muted')==False and abs(pg.evaluate('PREFS.volume')-v2)<0.001)
        check('video controls sit in the side panel, not over the video', pg.locator('#vside .vcontrols').count()==1 and pg.locator('#stage .vcontrols, #stage .vctl').count()==0)
        time.sleep(0.6); ui=api('/ui'); check('volume saved on engine', abs(ui.get('volume',-1)-v2)<0.001, ui.get('volume'))
        pg.keyboard.press('t'); pg.wait_for_timeout(900)
        # move via the folder box, SauceNAO send / waiting list
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        t0=pg.locator('#grid .tile').nth(min(8, pg.locator('#grid .tile').count()-1)); i0=int(t0.get_attribute('data-id')); t0.click()
        pg.fill('#b_folder','Zelda'); pg.keyboard.press('Enter'); pg.wait_for_timeout(2000)
        m=api('/review?scope=any&ids=%d'%i0)['items'][0]; check('folder box moves at once', m['status']=='moved' and '/dest/Zelda/' in m['path'].replace('\\','/'), m['path'])
        check('moved item left the list', pg.locator(f'#grid .tile[data-id="{i0}"]').count()==0)
        t1=pg.locator('#grid .tile').nth(min(9, pg.locator('#grid .tile').count()-1)); i1=int(t1.get_attribute('data-id')); t1.click(); pg.click('#b_sn'); pg.wait_for_timeout(800)
        st=api('/sauce/stats'); check('sent to SauceNAO queue', st['queued']>=1, st)
        pg.goto(f'{base}/?t=t#sauce'); pg.wait_for_timeout(800); pg.click('#stabs button[data-t="waiting"]'); pg.wait_for_timeout(1200)
        check('waiting list shows only sent pictures', pg.locator('#grid .tile').count()==st['queued'], pg.locator('#grid .tile').count())
        pg.locator('#grid .tile').first.click(); pg.click('#b_dq'); pg.wait_for_timeout(800); check('dequeue removes from waiting', pg.locator('#grid .tile').count()==st['queued']-1)
        # sets: reject one, tells where pictures go
        pg.goto(f'{base}/?t=t#sets'); pg.wait_for_timeout(1200); nsets=pg.locator('.setcard').count()
        if nsets:
            pg.locator('[data-a="reject"]').first.click(); pg.wait_for_timeout(1500); check('rejected set leaves section', pg.locator('.setcard').count()==nsets-1)
            check('toast says where they went', 'going to' in pg.inner_text('#toasts'), pg.inner_text('#toasts'))
        # FHQ view
        pg.goto(f'{base}/?t=t#fhq'); pg.wait_for_timeout(1800); check('FHQ shows moved', pg.locator('#grid .tile').count()==len(ids), pg.locator('#grid .tile').count()); pg.screenshot(path=ROOT+'/fhq.png')
        # tags view
        pg.goto(f'{base}/?t=t#tags'); pg.wait_for_timeout(1500); check('tags list', pg.locator('#tlist .fitem').count()>0, pg.locator('#tlist .fitem').count()); pg.screenshot(path=ROOT+'/tags.png')
        if pg.locator('#tlist .fitem').count():
            pg.locator('#tlist .fitem').first.click(); pg.wait_for_timeout(700); check('tag include chip', pg.locator('#tchips .tchip.inc').count()==1)
        # sauce view + undo + sets
        pg.goto(f'{base}/?t=t#sauce'); pg.wait_for_timeout(1200); pg.screenshot(path=ROOT+'/sauce.png')
        pg.goto(f'{base}/?t=t#undo'); pg.wait_for_timeout(1200); pg.screenshot(path=ROOT+'/undo.png'); check('undo shows singles/batches', pg.locator('.single, table tr').count()>1)
        pg.goto(f'{base}/?t=t#sets'); pg.wait_for_timeout(1000); pg.goto(f'{base}/?t=t#unsorted'); pg.wait_for_timeout(1000)
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1200); pg.screenshot(path=ROOT+'/setup.png')
        check('no page errors', not errs, errs[:5]); b.close()
finally: p.terminate()
print('ALL OK' if ok else 'FAILED')
