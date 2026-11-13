import subprocess, os, sys, time, json, shutil, re, urllib.request
from playwright.sync_api import sync_playwright
ROOT = '/tmp/e2e'; shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT + '/data'); shutil.copytree('/tmp/corpus', ROOT + '/src')
dest = ROOT + '/dest'
for f in ['Attack on Titan', 'Zelda', 'Anime', 'Games', 'Painterly', 'Pixel Art', 'Manga-Style and B&W', 'Manga', 'All Other Art', 'Average & LQ', 'Dupes', 'Connected Art', 'AI', 'Characters', 'Real/Images/Cosplay', 'Real/Images/General', 'Real/Videos/Cosplay', 'Real/Videos/General', 'Gifs & Vids', 'Games - Screenshots & Videos', 'Animations & Anime Videos', 'Photographs (Environments & Landscapes)', 'Photographs (People, Objects & Other Stuff)']:
    os.makedirs(f'{dest}/{f}/NSFW/Very', exist_ok=True)
env = dict(os.environ, CS_DATA=ROOT + '/data', CS_TOKEN='tok123')
p = subprocess.Popen(['node', 'engine/server.js'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
port = None
for line in p.stdout:
    m = re.match(r'ENGINE_PORT=(\d+)', line)
    if m: port = int(m.group(1)); break
base = f'http://127.0.0.1:{port}'
def api(path, body=None):
    r = urllib.request.Request(base + '/api' + path, data=json.dumps(body).encode() if body is not None else None, headers={'x-token': 'tok123', 'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
try:
    api('/settings', {'destinationRoot': dest, 'sources': [{'path': ROOT + '/src', 'excludes': []}], 'models': {'dir': '/tmp/dummy'}, 'tagger': {'device': 'cpu', 'model': 'swinv2'}})
    api('/run', {'refs': False})
    for _ in range(120):
        time.sleep(1)
        s = api('/state')
        if not s['job'] and s['counts']['analyzed'] >= 20: break
    print('state', s['counts'], s['message'])
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900})
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errors.append(str(e)))
        for route in ['setup', 'review', 'sets', 'dupes', 'unmapped', 'sauce', 'rules', 'undo', 'tags', 'fhq', 'unsorted']:
            pg.goto(f'{base}/?t=tok123#{route}'); pg.wait_for_timeout(1200 if route == 'review' else 700)
            pg.screenshot(path=f'{ROOT}/shot_{route}.png')
        # review interactions: select two, approve, open viewer
        pg.goto(f'{base}/?t=tok123#review'); pg.wait_for_timeout(1000)
        tiles = pg.locator('.tile'); print('tiles', tiles.count())
        tiles.nth(0).click(); tiles.nth(1).click(modifiers=['Control']); pg.click('#b_ok'); pg.wait_for_timeout(2500)
        print('approve moved them', api('/state')['counts'])
        pg.locator('.tile').nth(2).dblclick(); pg.wait_for_timeout(600); pg.screenshot(path=f'{ROOT}/shot_viewer.png'); pg.keyboard.press('Escape')
        pg.click('#b_allok'); pg.click('#cbok'); pg.wait_for_timeout(5000)
        print('after approve all', api('/state')['counts'])
        pg.goto(f'{base}/?t=tok123#undo'); pg.wait_for_timeout(1200); pg.screenshot(path=f'{ROOT}/shot_undo.png')
        pg.click('[data-undo]'); pg.click('#cbok'); pg.wait_for_timeout(3000)
        print('after undo', api('/state')['counts'])
        b.close()
    print('console errors:', errors)
    for root, d, fs in os.walk(dest):
        for f in fs: print('  in dest:', os.path.relpath(os.path.join(root, f), dest))
finally:
    p.terminate()
