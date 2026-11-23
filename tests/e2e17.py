import subprocess, os, time, json, shutil, re, urllib.request, sys, threading
from playwright.sync_api import sync_playwright
# Build 6: the redesign (frame, status bar, pills, queue, log, Look, Settings / Storage, Diagnose, keys, List view, safe mode)
ROOT='/tmp/e2e17'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime','Pokemon','Pixel Art','All Other Art','Dupes']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very',exist_ok=True)
LIB=ROOT+'/lib'
import glob
imgs=sorted(glob.glob('/tmp/corpus/*.jpg')+glob.glob('/tmp/corpus/*.png'))
for name in ['Zelda','Pokemon']:
    os.makedirs(LIB+'/'+name,exist_ok=True)
    for j,im in enumerate(imgs[:8]): shutil.copy(im, f'{LIB}/{name}/{j}_{os.path.basename(im)}')
def start(extra=None):
    env=dict(os.environ, CS_DATA=ROOT+'/data', CS_TOKEN='t', CS_ROOT=ROOT+'/root', **(extra or {}))
    p=subprocess.Popen(['node','engine/server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    for l in p.stdout:
        m=re.match(r'ENGINE_PORT=(\d+)',l)
        if m: port=int(m.group(1)); break
    threading.Thread(target=lambda: [None for _ in p.stdout], daemon=True).start()   # keep reading the log so the engine never blocks
    return p, f'http://127.0.0.1:{port}'
p, base = start()
def api(path,body=None):
    r=urllib.request.Request(base+'/api'+path,data=json.dumps(body).encode() if body is not None else None,headers={'x-token':'t','content-type':'application/json'}); return json.loads(urllib.request.urlopen(r).read())
def wait(t=240):
    time.sleep(1)
    for _ in range(t):
        s=api('/state')
        if not s['job'] and not s.get('queue'): return
        time.sleep(1)
ok=True
def check(n,c,i=''):
    global ok; ok&=bool(c); print('PASS' if c else 'FAIL',n,i); sys.stdout.flush()
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'},'autoRescan':False})
    # ---- the queue
    r1=api('/run',{}); r2=api('/learn',{}); r3=api('/rescan',{}); r4=api('/rescan',{})
    check('first job starts', r1.get('started'), r1)
    check('second job is queued, not refused', r2.get('queued'), r2)
    q=api('/state')['queue']; check('queue lists the waiting jobs once each', [x['name'] for x in q]==['learn','rescan'], q)
    wait(); st=api('/state')
    check('queued jobs ran after it', not st['queue'] and st['last'] and st['last']['ok'], st['last'])
    check('finished message says what happened', st['last']['text'].startswith('Finished'), st['last']['text'])
    api('/run',{}); api('/rescan',{}); api('/job',{'action':'cancel'}); time.sleep(0.5)
    check('Stop empties the queue', api('/state')['queue']==[]); wait()
    # ---- storage
    s=api('/storage'); keys=[x['key'] for x in s['places']]
    check('storage lists every place', keys==['data','models','thumbs','cache','logs'], keys)
    check('big cache lives under the root', s['places'][3]['path'].startswith(ROOT+'/root'), s['places'][3]['path'])
    time.sleep(1.5); s=api('/storage'); th=[x for x in s['places'] if x['key']=='thumbs'][0]
    check('sizes worked out', th['size'] is not None and th['files']>0, th)
    old=th['path']; nd=ROOT+'/elsewhere'
    r=api('/storage/move',{'key':'thumbs','dest':nd}); check('move starts', r.get('started'), r); wait()
    s=api('/storage'); th=[x for x in s['places'] if x['key']=='thumbs'][0]
    check('thumbnails moved and switched', th['path'].startswith(nd) and len(os.listdir(th['path']))>0 and not os.path.exists(old), (th['path'], os.path.exists(old)))
    check('thumbnails still served', urllib.request.urlopen(base+'/api/thumb/1?t=t').status==200)
    r=api('/storage/clear',{'key':'cache'}); check('cache clears', 'freed' in r, r)
    # ---- diagnose
    r=api('/diagnose',{}); wait(); d=api('/diagnose')
    check('diagnose lists findings', d and len(d['findings'])>=4, d and [f['title'] for f in d['findings']])
    check('each finding has evidence, problems have a Fix', all('evidence' in f for f in d['findings']) and all(f.get('fix') for f in d['findings'] if f['level'] in ('warn','danger')))
    check('report saved in logs', d['file'] and os.path.exists(d['file']), d['file'])
    # ---- log
    lg=api('/log?lines=200'); check('engine log reaches the app', any('Finished' in l['text'] for l in lg['lines']), len(lg['lines']))
    # ---- appearance file
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1800)
        check('title bar names the screen', pg.inner_text('#tscr').endswith('Art'))
        check('default look is Obsidian + Blue → Cyan', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()")=='#0a0a0b' and '#6b98ff' in pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--grad')"))
        check('status bar on the screen', 'Ready' in pg.inner_text('#statusbar') or 'Finished' in pg.inner_text('#statusbar'), pg.inner_text('#statusbar'))
        # List view
        pg.click('#laysw [data-lay="table"]'); pg.wait_for_timeout(900)
        check('List view is a table with a header', pg.locator('#grid .thead').count()==1 and pg.locator('#grid .tile').count()>3)
        pg.click('#grid .thead [data-sa="size"]'); pg.wait_for_timeout(900)
        sz=pg.evaluate("[...document.querySelectorAll('#grid .tile .c.m:last-child')].map(e=>e.textContent)")
        check('clicking a header sorts', pg.evaluate("RV.sort")=='size', sz[:4])
        pg.click('#grid .thead [data-sa="size"]'); pg.wait_for_timeout(700); check('clicking again reverses', pg.evaluate("RV.sort")=='size_asc')
        pg.click('#laysw [data-lay="grid"]'); pg.wait_for_timeout(600)
        # Approve is the accent button, Reject plain with red text (the owner's choice)
        pg.locator('#grid .tile').first.click(); pg.wait_for_timeout(300)
        bg=pg.evaluate("getComputedStyle(document.querySelector('#b_ok')).backgroundImage"); rj=pg.evaluate("[getComputedStyle(document.querySelector('#b_no')).backgroundColor, getComputedStyle(document.querySelector('#b_no')).color]")
        check('Approve uses the accent, Reject is plain', 'gradient' in bg and rj[0] in ('rgba(0, 0, 0, 0)','transparent'), (bg[:40], rj))
        pg.keyboard.press('Escape')
        # status bar during a job: %, elapsed, steps; pills in the title bar
        api('/reset',{'what':'analysis'}); api('/run',{})
        seen={'bar':False,'pill':False,'pct':False}
        for _ in range(300):
            t=pg.inner_text('#statusbar')
            if 'elapsed' in t or 'working out' in t: seen['bar']=True
            if '%' in t: seen['pct']=True
            if pg.locator('#pills .pill').count(): seen['pill']=True
            if all(seen.values()): break
            pg.wait_for_timeout(40)
        check('status bar shows the job with time', seen['bar'], seen)
        check('title bar shows a pill while it runs', seen['pill'], seen)
        wait(); pg.wait_for_timeout(800)
        check('finished result stays in the status bar', 'Finished' in pg.inner_text('#statusbar'), pg.inner_text('#statusbar'))
        # the progress rules, checked on the status logic itself
        r=pg.evaluate("""(()=>{ Status.p={phase:'analyze',total:100,done:100,elapsed:30,eta:0}; Status.lastAt=Date.now(); Status.lastDone=100; const a=Status.info();
            Status.p={phase:'scan',seen:500,added:20,elapsed:12}; const b=Status.info();
            Status.p={phase:'analyze',total:100,done:40,elapsed:90,eta:50}; Status.lastAt=Date.now()-25000; const c=Status.info();
            Status.p={phase:'analyze',total:1000,done:2,elapsed:2}; Status.lastAt=Date.now(); const d=Status.info();
            Status.p={phase:'download',file:'model.onnx',got:2.5e8,total:1e9,rate:1.2e7,elapsed:20,eta:60}; const e=Status.info();
            Status.p=null; Status.draw(); return {cap:a.pct, unknown:b.unknown, bon:b.on, stall:c.stalled, stallText:c.times, early:d.times, dl:e.on}; })()""")
        check('capped at 99% until really finished', r['cap']==99, r['cap'])
        check('unknown size: sliding bar and says so', r['unknown'] and 'size not known yet' in r['bon'], r['bon'])
        check('stall warning after 20 s', r['stall'] and 'No progress for' in r['stallText'] and 'log' in r['stallText'], r['stallText'])
        check('working out time left at the start', 'working out time left' in r['early'], r['early'])
        check('downloads show bytes and speed', 'MB/s' in r['dl'] and 'of' in r['dl'], r['dl'])
        # pills: full text when there is room, cut short when not; a click shows everything
        pg.evaluate("Status.p={phase:'analyze',total:2130,done:1240,note:'IMG_2041_with_a_long_name.jpg',elapsed:192,eta:194}; Status.lastAt=Date.now(); Status.pills()")
        full=pg.evaluate("(()=>{const t=document.querySelector('#pills .pt'); return t.scrollWidth<=t.clientWidth+1})()")
        check('pill shows its full text when there is room', full)
        pg.set_viewport_size({'width':1100,'height':680}); pg.evaluate("Status.p.note='x'.repeat(200)+' a very long file name that cannot fit in the title bar at this window width.jpg'; Status.p.total=0; Status.pills()"); pg.wait_for_timeout(200)
        cut=pg.evaluate("(()=>{const t=document.querySelector('#pills .pt'); return t.scrollWidth>t.clientWidth+1})()")
        check('pill is cut short when there is no room', cut)
        nowrap=pg.evaluate("document.querySelector('#titlebar').scrollWidth<=document.querySelector('#titlebar').clientWidth+1")
        check('title bar never scrolls sideways', nowrap)
        pg.click('#pills .pill'); pg.wait_for_timeout(300)
        pop=pg.inner_text('#pillpop') if pg.locator('#pillpop').count() else ''
        check('clicking the pill shows the whole text', 'cannot fit in the title bar' in pop, pop[:200])
        pg.click('#pills .pill'); pg.wait_for_timeout(200); check('clicking again closes it', pg.locator('#pillpop').count()==0)
        pg.evaluate("Status.p=null; Status.pills(); Status.draw()"); pg.set_viewport_size({'width':1440,'height':900})
        # log drawer
        pg.keyboard.press('Control+l'); pg.wait_for_timeout(700); check('Ctrl+L opens the log', pg.locator('#logdrawer:not(.hidden)').count()==1 and 'Finished' in pg.inner_text('#logdrawer'))
        pg.keyboard.press('Control+l'); pg.wait_for_timeout(200); check('Ctrl+L closes it', pg.locator('#logdrawer.hidden').count()==1)
        pg.evaluate("logLine('Something failed (test)','e')"); pg.wait_for_timeout(300); check('an error opens the log by itself', pg.locator('#logdrawer:not(.hidden)').count()==1); pg.keyboard.press('Escape')
        # keys
        pg.keyboard.press('s'); pg.wait_for_timeout(1200); check('S opens Settings', pg.evaluate("location.hash")=='#settings')
        pg.keyboard.press('k'); pg.wait_for_timeout(400)
        cols=pg.evaluate("(()=>{const g=[...document.querySelectorAll('.kgrp')].map(x=>Math.round(x.getBoundingClientRect().left)); return new Set(g).size})()")
        fits=pg.evaluate("(()=>{const m=document.querySelector('.mbox').getBoundingClientRect(); return m.right<=innerWidth && m.bottom<=innerHeight})()")
        check('shortcuts popup flows into columns and fits the window', cols>=2 and fits, (cols, fits))
        pg.mouse.click(5, 450); pg.wait_for_timeout(200); check('click outside closes it', pg.locator('#modal.hidden').count()==1)
        # Settings → Storage / GPU in the UI
        pg.click('[data-sec="storage"]'); pg.wait_for_timeout(2500)
        check('storage table shows sizes', 'MB' in pg.inner_text('#st_body') or 'KB' in pg.inner_text('#st_body'), pg.inner_text('#st_body')[:200])
        pg.click('[data-sec="gpu"]'); pg.wait_for_timeout(900)
        check('GPU section: Use Auto / GPU / CPU and Diagnose findings', pg.locator('#st_dev [data-v]').count()==3 and pg.locator('#st_body .rlist .it').count()>=4)
        # Ctrl+Z undoes the last move
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.locator('#grid .tile').first.click(); n0=api('/state')['counts']['moved']; pg.keyboard.press('a'); pg.wait_for_timeout(1500)
        n1=api('/state')['counts']['moved']; pg.keyboard.press('Control+z'); time.sleep(2); wait(); n2=api('/state')['counts']['moved']
        check('A moves, Ctrl+Z puts it back', n1==n0+1 and n2==n0, (n0,n1,n2))
        # Look screen: presets, a saved theme, extras, persistence in appearance.json
        pg.goto(f'{base}/?t=t#look'); pg.wait_for_timeout(1200)
        pg.click('[data-bg="aubergine"]'); pg.wait_for_timeout(600)
        check('background preset applies', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()")=='#110d16')
        pg.click('#a-pat [data-v="dots"]'); pg.wait_for_timeout(500)
        check('extras: pattern applies', 'svg' in pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bgpat')"))
        pg.click('#a-btn [data-v="glow"]'); pg.wait_for_timeout(400); check('Glow button style', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--glow').trim()")!='none')
        pg.click('#a-save'); pg.wait_for_timeout(300); pg.fill('#atv','Test theme'); pg.click('#atok'); pg.wait_for_timeout(800)
        time.sleep(0.6); ap=json.load(open(ROOT+'/data/appearance.json'))
        check('saved theme in appearance.json', any(s['name']=='Test theme' for s in ap['saved']) and ap['current']['extras']['pattern']=='dots', [s['name'] for s in ap['saved']])
        check('old themes kept as ready-made themes', pg.locator('#a-themes .tcard').count()>=13, pg.locator('#a-themes .tcard').count())
        pg2=b.new_page(); pg2.goto(f'{base}/?t=t#review'); pg2.wait_for_timeout(1500)
        check('look persists for a new window', pg2.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()")=='#110d16'); pg2.close()
        pg.click('#a-reset'); pg.wait_for_timeout(300); pg.click('#cbok'); pg.wait_for_timeout(800)
        check('reset to default', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()")=='#0a0a0b')
        # every screen renders with the one-line header and no errors, at the minimum window size too
        for w,h in [(1100,680),(1920,1080)]:
            pg.set_viewport_size({'width':w,'height':h})
            for r in ['setup','review','real','unsorted','tags','sets','dupes','knows','examples','rules','undo','look','settings']:
                pg.goto(f'{base}/?t=t#'+r); pg.wait_for_timeout(900)
                hd=pg.locator('#view .hd').count(); side=pg.evaluate("document.querySelector('#view').scrollWidth<=document.querySelector('#view').clientWidth+1")
                if not (hd>=1 or r=='sauce') or not side: check(f'{r} at {w}: header line and no sideways scroll', False, (hd, side))
            pg.screenshot(path=f'{ROOT}/settings_{w}.png')
        check('every screen has the header line and no sideways scrolling', True)
        check('no page errors', not errs, errs[:5])
        b.close()
    p.terminate(); time.sleep(0.5)
    # ---- safe mode: the engine started after two crashes keeps the graphics card off and says so
    p, base = start({'CS_SAFE':'1'})
    st=api('/state'); check('safe mode reported', st.get('safeMode') is True)
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
        pg.goto(f'{base}/?t=t#settings'); pg.wait_for_timeout(1200)
        check('safe mode banner with a way back', 'Safe mode' in pg.inner_text('#view') and pg.locator('#st_safeoff').count()==1)
        b.close()
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
