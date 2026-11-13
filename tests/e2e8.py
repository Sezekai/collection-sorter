import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e8'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
    items=api('/review?scope=new&limit=50')['items']; ids=[i['id'] for i in items]
    # put six pictures into Find Higher Quality folders
    for i in ids[:6]: api('/move-to',{'ids':[i],'folder':'Anime','fhq':1})
    time.sleep(1.5)
    fh=api('/review?scope=fhq&limit=50'); check('fhq list has 6', fh['total']==6, fh['total'])
    import os
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1700,'height':900}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        def pytrash(files):
            out=[]
            for f in files:
                try: os.remove(f); out.append({'file':f,'ok':True})
                except Exception as e: out.append({'file':f,'ok':False,'error':str(e)})
            return out
        pg.expose_function('pyTrash', pytrash)
        pg.add_init_script("window.csNative={trash:(f)=>window.pyTrash(f),startDrag(){}}")
        pg.goto(f'{base}/?t=t#fhq'); pg.wait_for_timeout(1800)
        check('fhq tiles', pg.locator('#grid .tile').count()==6, pg.locator('#grid .tile').count())
        check('fhq buttons present', pg.locator('#b_found').count()==1 and pg.locator('#b_manual').count()==1)
        # manual folder
        pg.locator('#grid .tile').nth(0).click(); pg.locator('#grid .tile').nth(1).click(); pg.wait_for_timeout(300)
        pg.click('#b_manual'); pg.wait_for_timeout(1800)
        fh=api('/review?scope=fhq&limit=50'); check('manual: removed from fhq section', fh['total']==4, fh['total'])
        man=ROOT+'/dest/Find Higher Quality Manually'; check('manual folder created in main directory', os.path.isdir(man) and len(os.listdir(man))==2, os.listdir(man) if os.path.isdir(man) else None)
        # found higher quality -> recycle (mock deletes) + log
        pg.locator('#grid .tile').nth(0).click(); pg.wait_for_timeout(300)
        pg.click('#b_found'); pg.wait_for_timeout(1500)
        fh=api('/review?scope=fhq&limit=50'); check('found: removed from fhq section', fh['total']==3, fh['total'])
        import sqlite3
        con=sqlite3.connect(ROOT+'/data/sorter.db'); ev=[r[0] for r in con.execute("select event from hq_log order by id")]; con.close()
        check('log has manual + trashed', ev.count('manual')==2 and ev.count('trashed')==1, ev)
        lg=api('/lookup-log'); check('lookup-log endpoint ok', 'rows' in lg, lg)
        # send to lookup: one picture goes to the section, several do too
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.locator('#grid .tile').nth(0).click(); pg.wait_for_timeout(300); pg.click('#b_sn'); pg.wait_for_timeout(1200)
        check('one picture: goes to source lookup', pg.evaluate("location.hash")=='#sauce', pg.evaluate("location.hash"))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.locator('#grid .tile').nth(0).click(); pg.locator('#grid .tile').nth(1).click(); pg.wait_for_timeout(300); pg.click('#b_sn'); pg.wait_for_timeout(1200)
        check('several: also go there', pg.evaluate("location.hash")=='#sauce')
        pg.click('#stabs button[data-t=log]'); pg.wait_for_timeout(800)
        check('log tab shows', pg.locator('.logtable').count()==1)
        # approve label
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(1500)
        pg.locator('#grid .tile').nth(0).click(); pg.wait_for_timeout(300)
        lab=pg.inner_text('#b_ok'); check('approve button names the folder', 'Approve →' in lab, lab)
        check('no unmapped nav', pg.locator('nav a[data-r=unmapped]').count()==0)
        check('no page errors', not errs, errs[:3])
        b.close()
except Exception as e:
    import traceback; traceback.print_exc(); ok=False
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
