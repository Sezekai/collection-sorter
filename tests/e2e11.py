import subprocess, os, time, json, shutil, re, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT='/tmp/e2e11'; shutil.rmtree(ROOT, ignore_errors=True); os.makedirs(ROOT+'/data'); shutil.copytree('/tmp/corpus', ROOT+'/src')
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
    import sqlite3
    con=sqlite3.connect(ROOT+'/data/sorter.db'); rows=con.execute("select count(*), sum(realness is not null), sum(p_clip is not null), sum(p_joy is not null), sum(jtags is not null), sum(realness='real') from files").fetchone(); con.close()
    check('every file classified with both opinions', rows[0]>0 and rows[1]==rows[0] and rows[2]==rows[0] and rows[3]==rows[0] and rows[4]==rows[0], rows)
    st=api('/state'); print(st['classifier'])
    check('classifier info in state', st['classifier']['using'] in ('both','clip','joytag') and 'scoreboard' in st['classifier'])
    art=api('/review?scope=new&realm=art&limit=100'); real=api('/review?scope=new&realm=real&limit=100')
    check('realms split the files', 0<art['total']+real['total']<=rows[0], (art['total'], real['total']))
    # correct one: the first art file is really a photo
    if art['items']:
        i=art['items'][0]['id']; api('/suggestion',{'ids':[i],'action':'setReal','real':True}); time.sleep(1.5)
        a2=api('/review?scope=new&realm=art&limit=100'); r2=api('/review?scope=new&realm=real&limit=100')
        check('P moves it to Real', any(x['id']==i for x in r2['items']) and not any(x['id']==i for x in a2['items']))
        sb=api('/state')['classifier']['scoreboard']; check('scoreboard counts the correction', sb['corrections']==1 and sb['clip']['checked']==1 and sb['joytag']['checked']==1, sb)
        api('/suggestion',{'ids':[i],'action':'setReal','real':False}); time.sleep(1.5)
        a3=api('/review?scope=new&realm=art&limit=100'); check('and back to Art', any(x['id']==i for x in a3['items']))
    # tag source follows realness: real files show joytag tags only
    if real['items']:
        rid=real['items'][0]['id']; tg=api('/tags/file?id='+str(rid)); names={t['tag'] for t in tg}; print('real tags',sorted(names)[:8])
        check('real picture shows JoyTag tags', names and names <= {'1girl','solo','photorealistic','photo','realistic','smile','outdoors','sword','monochrome','blue hair','long hair','sky','looking at viewer','breasts','nude','city','tree','dress','weapon','building'}, sorted(names)[:6])
    api('/settings',{**api('/settings'),'tagSource':{'art':'both','real':'both'}}); time.sleep(1)
    if real['items']:
        tg=api('/tags/file?id='+str(real['items'][0]['id'])); check('both source merges WD + JoyTag tags', any(t['tag'] in ('rem (re:zero)','greyscale','link (zelda)') for t in tg) and any(t['tag']=='photo' for t in tg), [t['tag'] for t in tg][:8])
    b2=None
except Exception as e:
    import traceback; traceback.print_exc(); ok=False
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
