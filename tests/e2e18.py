import subprocess, os, time, json, shutil, re, urllib.request, sys, threading, glob
from playwright.sync_api import sync_playwright
# Build 7: Change folders (test -> real destination keeps what the app learned), Sizes, Setup in sections, resizable columns
ROOT='/tmp/e2e18'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
A=ROOT+'/destA'; B=ROOT+'/destB'
for f in ['Zelda','Anime','Pokemon','Pixel Art','All Other Art','Dupes']: os.makedirs(f'{A}/{f}/NSFW/Very',exist_ok=True)
for f in ['Zelda','Anime','pokemon','All Other Art','New Stuff']: os.makedirs(f'{B}/{f}/NSFW',exist_ok=True)
os.makedirs(ROOT+'/src2',exist_ok=True); shutil.copy(sorted(glob.glob('/tmp/corpus/*.jpg'))[0], ROOT+'/src2/real_one.jpg')
LIB=ROOT+'/lib'; imgs=sorted(glob.glob('/tmp/corpus/*.jpg')+glob.glob('/tmp/corpus/*.png'))
for name in ['Zelda','Pokemon','Pixel Art']:
    os.makedirs(LIB+'/'+name,exist_ok=True)
    for j,im in enumerate(imgs[:6]): shutil.copy(im, f'{LIB}/{name}/{j}_{os.path.basename(im)}')
def start():
    env=dict(os.environ, CS_DATA=ROOT+'/data', CS_TOKEN='t', CS_ROOT=ROOT+'/root')
    p=subprocess.Popen(['node','engine/server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    for l in p.stdout:
        m=re.match(r'ENGINE_PORT=(\d+)',l)
        if m: port=int(m.group(1)); break
    threading.Thread(target=lambda: [None for _ in p.stdout], daemon=True).start()
    return p, f'http://127.0.0.1:{port}'
p, base = start()
def api(path,body=None):
    r=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'x-token':'t','content-type':'application/json'})
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return {'httpError': e.code, **json.loads(e.read() or b'{}')}
def wait(t=300):
    time.sleep(1)
    for _ in range(t):
        s=api('/state')
        if not s['job'] and not s.get('queue'): return
        time.sleep(1)
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,'' if c else i); sys.stdout.flush()
try:
    api('/settings',{'destinationRoot':A,'sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'},'autoRescan':False})
    api('/run',{'refs':True}); wait()
    rules0=api('/rules')
    order0=rules0['rules']['order'] if 'rules' in rules0 else rules0['order']
    items=api('/review?scope=new&limit=100')['items']
    check('test files were read', len(items)>=10, len(items))
    ids=[i['id'] for i in items[:6]]
    for i in ids[:3]: api('/suggestion',{'ids':[i],'action':'setFolder','folder':'Pokemon'})
    for i in ids[3:6]: api('/suggestion',{'ids':[i],'action':'setFolder','folder':'Pixel Art'})
    wait(); st=api('/state'); moved=st['counts']['moved']
    check('six test approvals moved into the test destination', moved==6, st['counts'])
    refs0=st['counts']['refs_done']
    # ---- preview
    pv=api('/switch/preview',{'dest':B,'sources':[{'path':ROOT+'/src2'}]})
    F=pv['folders']
    check('same names recognised', F['same']>=3, F)
    check('capital-letter difference is carried over automatically', any(r['from']=='Pokemon' and r['to']=='pokemon' for r in F['renamed']), F['renamed'])
    check('missing folder listed with what it knows', [m['name'] for m in F['missing']]==['Pixel Art'] and F['missing'][0]['examples']>0, F['missing'])
    check('Dupes (made by the app) is not reported missing', not any(m['name']=='Dupes' for m in F['missing']))
    check('new-only folder listed', F['added']==['New Stuff'], F['added'])
    check('old files counted', pv['old']['files']==len(api('/review?scope=any&limit=1000')['items']) or pv['old']['files']>=10, pv['old'])
    check('approvals that can be kept counted', pv['old']['movedLearnable']==6 and pv['old']['history']>=6, pv['old'])
    check('a source inside the destination is refused', api('/switch/preview',{'dest':B,'sources':[{'path':B+'/Zelda'}]}).get('httpError')==400)
    check('a missing destination is refused', api('/switch/preview',{'dest':ROOT+'/nope'}).get('httpError')==400)
    # ---- apply
    r=api('/switch',{'dest':B,'sources':[{'path':ROOT+'/src2','excludes':[]}],'map':{'Pixel Art':'New Stuff'},'forget':True,'keepApprovals':True})
    check('change applied', r.get('examplesKept')==6 and r.get('filesForgotten')>=10 and r.get('renamed')>=2, r)
    wait(); st=api('/state'); s=st['settings']
    check('new destination and sources saved', s['destinationRoot']==B and [x['path'] for x in s['sources']]==[ROOT+'/src2'], (s['destinationRoot'], s['sources']))
    check('old destination kept as a learned-examples folder', A in s.get('keptReferenceRoots',[]), s.get('keptReferenceRoots'))
    check('approvals became examples', st['counts']['refs_done']==refs0+6, (refs0, st['counts']['refs_done']))
    h=api('/history'); check('old history forgotten', not h['batches'] and not h['singles'], h)
    check('no false "folders changed" after the switch', st['folderChanges']==0, st['folderChanges'])
    rules1=api('/rules'); order1=rules1['rules']['order'] if 'rules' in rules1 else rules1['order']
    check('priority keeps its place for the renamed folder', 'pokemon' in order1 and 'Pokemon' not in order1 and order1.index('pokemon')==order0.index('Pokemon'), (order0, order1))
    check('mapped folder takes the old one\'s place', 'New Stuff' in order1 and 'Pixel Art' not in order1 and order1.index('New Stuff')==order0.index('Pixel Art'), order1)
    check('the real source got scanned', st['counts']['files']==1, st['counts'])
    check('test files still on disk', len(os.listdir(A+'/Pokemon'))>=1 and len(os.listdir(ROOT+'/src'))>=10)
    thumbs=os.listdir(ROOT+'/data/thumbs') if os.path.exists(ROOT+'/data/thumbs') else []
    check('old thumbnails removed', len(thumbs)<=1, len(thumbs))
    # ---- checking for changes: examples only when asked, and only folders that changed are listed again
    shutil.copy(imgs[0], LIB+'/Zelda/new_example.jpg'); shutil.copy(imgs[1], ROOT+'/src2/new_file.jpg')
    api('/rescan',{'examples':False}); wait(); lr=api('/state')['lastRescan']
    check('a quick check finds new files but leaves the examples alone', lr['newFiles']==1 and lr['newExamples']==0, lr)
    api('/rescan',{}); wait(); lr=api('/state')['lastRescan']
    check('Check for changes now finds the new example', lr['newExamples']==1, lr)
    api('/rescan',{}); wait(); lr=api('/state')['lastRescan']
    check('nothing new the second time', lr['newExamples']==0 and lr['newFiles']==0, lr)
    os.makedirs(LIB+'/Zelda/Deeper',exist_ok=True); shutil.copy(imgs[2], LIB+'/Zelda/Deeper/deep.jpg')
    api('/rescan',{}); wait(); lr=api('/state')['lastRescan']
    check('a new subfolder is found too', lr['newExamples']==1, lr)
    n0=api('/state')['counts']['refs']; api('/reset',{'what':'examples'}); api('/rescan',{}); wait()
    check('after forgetting the examples everything is listed again', api('/state')['counts']['refs']>=n0-6, (n0, api('/state')['counts']['refs']))
    # ---- UI
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':940}); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(1800)
        items=pg.eval_on_selector_all('#setupnav [data-part]','e=>e.map(x=>x.dataset.part)')
        check('Setup has sections on the left', items==['sources','dest','examples','changes','models','learn','learned'], items)
        vis=pg.eval_on_selector_all('[data-partbody]','e=>e.filter(x=>!x.classList.contains("hidden")).length'); check('one section shown at a time', vis==1, vis)
        pg.click('[data-part="dest"]'); pg.wait_for_timeout(300)
        check('clicking a section shows it', pg.is_visible('#dest') and pg.is_visible('#swopen'))
        pg.screenshot(path=f'{ROOT}/setup.png')
        w0=pg.eval_on_selector('#setupnav','e=>e.getBoundingClientRect().width')
        h=pg.query_selector('#setupnav > .rz').bounding_box(); pg.mouse.move(h['x']+3,h['y']+60); pg.mouse.down(); pg.mouse.move(h['x']+103,h['y']+60,steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
        w1=pg.eval_on_selector('#setupnav','e=>e.getBoundingClientRect().width'); check('section column resizes', w1>w0+80, (w0,w1))
        pg.click('#swopen'); pg.wait_for_timeout(400)
        check('Change folders dialog opens with the current destination', pg.input_value('#sw_dest')==B)
        pg.fill('#sw_dest', A); pg.click('#sw_next'); pg.wait_for_timeout(800)
        txt=pg.inner_text('#modal'); check('dialog shows what carries over', 'folder names match' in txt and 'priority order' in txt, txt[:300])
        pg.screenshot(path=f'{ROOT}/switch.png'); pg.click('#sw_back'); pg.wait_for_timeout(200); pg.click('#sw_cancel')
        # settings column
        pg.goto(f'{base}/?t=t#settings'); pg.wait_for_timeout(1200)
        w2=pg.eval_on_selector('#settingsnav','e=>e.getBoundingClientRect().width'); check('Settings uses the same resizable column', abs(w2-w1)<2 and pg.query_selector('#settingsnav > .rz') is not None, (w1,w2))
        pg.screenshot(path=f'{ROOT}/settings.png')
        # one text size for controls
        def sizes(route):
            pg.goto(f'{base}/?t=t#{route}'); pg.wait_for_timeout(1300)
            return pg.evaluate('''()=>{const o={};for(const e of document.querySelectorAll('#view button:not(.sm):not(.more),#view select,#view input[type=text],#view .seg button,#view .tab,#view label.chk,#view .fitem')){if(!e.offsetParent)continue;const f=getComputedStyle(e).fontSize;o[f]=(o[f]||0)+1}return o}''')
        fs=pg.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()')
        for route in ['setup','settings','review','look','knows']:
            got=sizes(route); check(f'{route}: buttons, drop-downs, fields and lists share one text size', list(got.keys())==[fs], got)
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1300); pg.screenshot(path=f'{ROOT}/review.png')
        navfs=pg.eval_on_selector('#nav a[data-r="setup"]','e=>getComputedStyle(e).fontSize'); ic=pg.eval_on_selector('#nav a[data-r="setup"] svg','e=>e.getBoundingClientRect().width')
        brand=pg.eval_on_selector('#nav .brand','e=>getComputedStyle(e).fontSize'); logo=pg.eval_on_selector('#nav .logo','e=>e.getBoundingClientRect().width')
        check('menu text, icons and logo are bigger than the text', float(navfs[:-2])>float(fs[:-2]) and ic>=20 and float(brand[:-2])>float(navfs[:-2]) and logo>=34, (navfs, ic, brand, logo))
        # Sizes on Look
        pg.goto(f'{base}/?t=t#look'); pg.wait_for_timeout(1300)
        check('Look has a Sizes section', pg.is_visible('#a-sizes'))
        pg.click('#a-zpre [data-v="xlarge"]'); pg.wait_for_timeout(300)
        check('Extra large preset applies', pg.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()')=='17px')
        pg.screenshot(path=f'{ROOT}/look_xl.png')
        pg.evaluate('''()=>{const i=document.querySelector('[data-z="menuText"]');i.value=22;i.dispatchEvent(new Event('input',{bubbles:true}))}'''); pg.wait_for_timeout(200)
        check('a single size can be changed', pg.eval_on_selector('#nav a[data-r="setup"]','e=>getComputedStyle(e).fontSize')=='22px')
        pg.keyboard.press('Control+Equal'); pg.wait_for_timeout(300)
        check('Ctrl + = makes everything bigger', pg.evaluate('document.documentElement.style.zoom')=='1.1')
        pg.keyboard.press('Control+0'); pg.wait_for_timeout(300)
        check('Ctrl + 0 goes back to 100%', pg.evaluate('document.documentElement.style.zoom') in ('','1'))
        pg.wait_for_timeout(600)
        ap=json.load(open(ROOT+'/data/appearance.json'))
        check('sizes are saved', ap.get('sizes',{}).get('text')==17 and ap['sizes']['menuText']==22, ap.get('sizes'))
        pg.click('.tcard[data-id="cs-ocean"]'); pg.wait_for_timeout(300)
        check('another theme keeps the sizes', pg.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()')=='17px')
        for w in (1100, 1920):
            pg.set_viewport_size({'width':w,'height':900})
            for route in ['setup','settings','look','review','knows']:
                pg.goto(f'{base}/?t=t#{route}'); pg.wait_for_timeout(900)
                side=pg.evaluate('document.querySelector("#view").scrollWidth > document.querySelector("#view").clientWidth+1')
                check(f'{route} at {w}px (extra large) has no sideways scrolling', not side)
        pg.set_viewport_size({'width':1500,'height':940}); pg.goto(f'{base}/?t=t#setup'); pg.wait_for_timeout(900); pg.screenshot(path=f'{ROOT}/setup_xl.png')
        check('no page errors', not errs, errs[:5])
        b.close()
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
