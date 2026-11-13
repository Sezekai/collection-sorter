import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e16'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
for f in ['Zelda','Anime','Pokemon','Pixel Art','All Other Art','Dead Folder']: os.makedirs(f'{ROOT}/dest/{f}/NSFW/Very',exist_ok=True)
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
import glob, urllib.parse
imgs=sorted(glob.glob('/tmp/corpus/*.jpg')+glob.glob('/tmp/corpus/*.png'))
for i,name in enumerate(['Zelda','Pokemon','Pixel Art']):
    os.makedirs(f'{LIB}/{name}',exist_ok=True)
    for j,im in enumerate(imgs[:8]): shutil.copy(im, f'{LIB}/{name}/{i}_{j}_{os.path.basename(im)}')
def sql(q):
    import sqlite3; c=sqlite3.connect(ROOT+'/data/collection.db') if os.path.exists(ROOT+'/data/collection.db') else None; return c
try:
    api('/settings',{'destinationRoot':ROOT+'/dest','sources':[{'path':ROOT+'/src','excludes':[]}],'referenceRoots':[LIB],'models':{'dir':'/tmp/dummy'},'tagger':{'device':'cpu','model':'swinv2'}})
    api('/run',{}); wait(); time.sleep(1); wait()
    r=api('/rules'); rules=r.get('rules',r)
    rules['folders']['Zelda']['series']=list(rules['folders']['Zelda'].get('series',[]))+['zeldaword']; rules['folders']['Pokemon']['series']=list(rules['folders']['Pokemon'].get('series',[]))+['pokeword']
    rules['folders']['Pixel Art']['tags']=list(rules['folders']['Pixel Art'].get('tags',[]))+['pixword']
    api('/rules',rules)
    check('nothing pending at first', api('/destchanges')['gone']==[])
    # --- rename Zelda
    os.rename(ROOT+'/dest/Zelda',ROOT+'/dest/Legend of Zelda'); os.makedirs(ROOT+'/dest/Legend of Zelda/NSFW/Very',exist_ok=True)
    api('/rescan',{}); wait(); time.sleep(1); wait()
    ch=api('/destchanges'); print(ch['gone'])
    check('rename detected with suggestion', [g['name'] for g in ch['gone']]==['Zelda'] and ch['gone'][0]['suggest'] and ch['gone'][0]['suggest']['to']=='Legend of Zelda', ch['gone'])
    check('gone folder kept its rule', ch['gone'][0]['hasRule'] and ch['gone'][0]['examples']>0, ch['gone'][0])
    check('state flags folder changes', api('/state')['folderChanges']==1)
    out=api('/destchanges/resolve',{'actions':[{'type':'merge','from':['Zelda'],'to':'Legend of Zelda'}]})
    check('resolved list empty', out['gone']==[], out)
    r=api('/rules'); rules=r.get('rules',r)
    check('rule carried over to the new name', 'zeldaword' in rules['folders'].get('Legend of Zelda',{}).get('series',[]) and 'Zelda' not in rules['folders'] and 'Zelda' not in rules['order'] and 'Legend of Zelda' in rules['order'], rules['folders'].get('Legend of Zelda'))
    ov=api('/refs/overview'); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('examples now teach the new name', g['Zelda']['targets']==['Legend of Zelda'] and g['Zelda']['ok'], g['Zelda'])
    # --- merge Pokemon + Pixel Art into Anime (existing), delete Dead Folder
    shutil.rmtree(ROOT+'/dest/Pokemon'); shutil.rmtree(ROOT+'/dest/Pixel Art'); shutil.rmtree(ROOT+'/dest/Dead Folder')
    api('/rescan',{}); wait(); time.sleep(1); wait()
    ch=api('/destchanges'); names=sorted(g['name'] for g in ch['gone']); check('three gone', names==['Dead Folder','Pixel Art','Pokemon'], names)
    api('/destchanges/resolve',{'actions':[{'type':'deleted','name':'Dead Folder'},{'type':'merge','from':['Pokemon'],'to':'Anime'},{'type':'merge','from':['Pixel Art'],'to':'Anime','keep':{'rules':True,'examples':False,'mappings':True}}]})
    ch=api('/destchanges'); check('all resolved', ch['gone']==[], ch)
    r=api('/rules'); rules=r.get('rules',r); an=rules['folders']['Anime']
    check('merged rule has words of both', 'pokeword' in an.get('series',[]) and 'pixword' in an.get('tags',[]), an)
    check('merged-away rules gone', 'Pokemon' not in rules['folders'] and 'Pixel Art' not in rules['folders'])
    st=api('/state')['counts']; print(st)
    ov=api('/refs/overview'); g={x['name']:x for x in ov['roots'][0]['groups']}
    check('Pokemon examples teach Anime, Pixel Art examples dropped', g['Pokemon']['targets']==['Anime'] and st['refs']>0, (g['Pokemon'], st))
    sugg=api('/review?scope=new&limit=500')['items']; bad=[x for x in sugg if x.get('folder') in ('Zelda','Pokemon','Pixel Art')]
    check('no suggestion points at a vanished folder', not bad, bad[:2])
    # --- a ticked subfolder is renamed
    os.makedirs(ROOT+'/dest/All Other Art/Sub1/Deep'); api('/dest/target',{'rel':'All Other Art/Sub1/Deep','on':True}); api('/rescan',{}); wait(); time.sleep(1); wait(); api('/destchanges/resolve',{'actions':[{'type':'new'}]})
    os.rename(ROOT+'/dest/All Other Art/Sub1/Deep',ROOT+'/dest/All Other Art/Sub1/Deeper'); api('/rescan',{}); wait(); time.sleep(1); wait()
    ch=api('/destchanges'); sg=[g for g in ch['gone'] if g['name'].endswith('Deep')]
    check('sub-target rename suggested', sg and sg[0]['suggest'] and sg[0]['suggest']['to']=='All Other Art/Sub1/Deeper', ch['gone'])
    api('/destchanges/resolve',{'actions':[{'type':'merge','from':['All Other Art/Sub1/Deep'],'to':'All Other Art/Sub1/Deeper'}]})
    check('sub-target list follows the rename', 'All Other Art/Sub1/Deeper' in api('/settings')['subTargets'] and 'All Other Art/Sub1/Deep' not in api('/settings')['subTargets'], api('/settings')['subTargets'])
    check('nothing left', api('/destchanges')['gone']==[], api('/destchanges'))
    # --- popup
    os.rename(ROOT+'/dest/Anime',ROOT+'/dest/Anime Stuff'); os.rename(ROOT+'/dest/Legend of Zelda',ROOT+'/dest/Zelda Games')
    api('/rescan',{}); wait(); time.sleep(1); wait()
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1300,'height':800}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(f'{base}/?t=t#review'); pg.wait_for_timeout(2500); pg.screenshot(path=ROOT+'/popup.png')
        check('popup appears at start', pg.locator('#modal:not(.hidden) .mbox').count()==1 and 'Folders changed' in pg.inner_text('#modal'))
        txt=pg.inner_text('#modal'); check('suggestions pre-filled', pg.locator('#modal select').first.input_value()!='' and 'Accept all suggestions (2)' in txt, txt[:300])
        pg.locator('[data-ok="0"]').click(); pg.wait_for_timeout(900); check('one confirmed, one left', pg.locator('[data-ok]').count()==1 and api('/state')['folderChanges']==1)
        pg.click('#fcall'); pg.wait_for_timeout(1200); check('all done closes popup', pg.locator('#modal:not(.hidden)').count()==0 and api('/destchanges')['gone']==[])
        check('no console errors', not errs, errs)
        b.close()
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
