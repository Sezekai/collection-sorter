import subprocess, os, sys, time, json, shutil, re, urllib.request
from playwright.sync_api import sync_playwright
ROOT = '/tmp/e2e2'; shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT + '/data'); shutil.copytree('/tmp/corpus', ROOT + '/src'); shutil.copytree('/tmp/corpus', ROOT + '/examples/Zelda')
for i in range(40): shutil.copy('/tmp/corpus/G0good_jpeg.jpg', f'{ROOT}/examples/Zelda/x{i}.jpg')
dest = ROOT + '/dest'; os.makedirs(dest + '/Zelda/NSFW/Very'); os.makedirs(dest + '/Anime')
env = dict(os.environ, CS_DATA=ROOT + '/data', CS_TOKEN='tok123')
p = subprocess.Popen(['node', 'engine/server.js'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for line in p.stdout:
    m = re.match(r'ENGINE_PORT=(\d+)', line)
    if m: port = int(m.group(1)); break
base = f'http://127.0.0.1:{port}'
def api(path, body=None):
    r = urllib.request.Request(base + '/api' + path, data=json.dumps(body).encode() if body is not None else None, headers={'x-token': 'tok123', 'content-type': 'application/json'})
    try: return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return {'error': e.read().decode(), 'code': e.code}
def wait():
    for _ in range(180):
        time.sleep(1)
        if not api('/state')['job']: return
ok = True
def check(name, cond, info=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + name, info)
try:
    base_set = {'destinationRoot': dest, 'sources': [{'path': ROOT + '/src', 'excludes': []}], 'models': {'dir': '/tmp/dummy'}, 'tagger': {'device': 'cpu', 'model': 'swinv2'}, 'refs': {'maxPerFolder': 10}}
    api('/settings', dict(base_set, referenceRoots=[ROOT + '/examples']))
    api('/run', {}); time.sleep(1); wait()
    c = api('/state')['counts']; print(c)
    check('examples sampled to cap', c['refs_done'] <= 10 + 0 and c['refs'] > 40 and c['refs_skipped'] > 0, c)
    # remove examples folder -> cleaned
    r = api('/settings?report=1', dict(base_set, referenceRoots=[]))
    c = api('/state')['counts']; check('removing examples folder forgets them', c['refs'] == 0, (c, r.get('cleaned')))
    # remove source -> cleaned
    r = api('/settings?report=1', dict(base_set, sources=[]))
    c = api('/state')['counts']; check('removing source forgets files', c['files'] == 0, c)
    api('/settings', base_set); api('/run', {}); time.sleep(1); wait()
    c = api('/state')['counts']; check('rescan restores files', c['files'] == 23, c)
    # decisions reset
    pend0 = api('/state')['counts']['pending']
    api('/suggestion', {'filter': {}, 'action': 'reject'}); check('rejected', api('/review?state=rejected&limit=1')['total'] > 0)
    r = api('/reset', {'what': 'decisions'}); c = api('/state')['counts']; check('reset decisions', api('/review?state=rejected&limit=1')['total'] == 0 and c['pending'] == pend0, (r, c))
    api('/suggestion', {'filter': {}, 'action': 'reject'}); api('/suggestion', {'filter': {}, 'action': 'clearChoice'})
    check('clearChoice', api('/review?state=rejected&limit=1')['total'] == 0)
    for w in ['analysis', 'examples', 'examplesLearning', 'series', 'sauce', 'thumbs', 'rules']:
        r = api('/reset', {'what': w}); check('reset ' + w, 'message' in r, r)
    c = api('/state')['counts']; check('analysis reset marks unanalyzed', c['analyzed'] == 0, c)
    api('/run', {}); time.sleep(1); wait(); check('re-read after reset', api('/state')['counts']['analyzed'] == 23)
    r = api('/reset', {'what': 'everything'}); c = api('/state')['counts']; check('reset everything', c['files'] == 0, c)
    check('settings survive everything reset', api('/state')['settings']['destinationRoot'] == dest)
    api('/run', {}); time.sleep(1); wait()
    d = api('/rules/defaults'); check('rules defaults', 'order' in d and 'folders' in d)
    api('/settings/defaults'); 
    # ui prefs survive new origin (server-side)
    api('/ui', {'nav': False, 'ap': {'theme': 'Ember'}}); check('ui prefs saved', api('/ui')['ap']['theme'] == 'Ember')
    di = api('/datainfo'); check('data dir is CS_DATA', di['dataDir'] == ROOT + '/data', di)
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 900})
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errors.append(str(e)))
        api('/ui', {'nav': True, 'ap': {}, 'custom': [], 'layout': 'grid', 'tile': 168, 'slideSecs': 4, 'slideVideo': True})
        pg.goto(f'{base}/?t=tok123#settings'); pg.wait_for_timeout(1200); pg.click('[data-sec="quality"]'); pg.wait_for_timeout(600)
        # tooltip
        pg.hover('[data-tipid="quality.minBitsPerPixel"] label'); pg.wait_for_timeout(400)
        tip = pg.inner_text('#tip'); check('tooltip explains bits/pixel', 'pixel' in tip.lower() and 'Good value' in tip, tip[:150].replace('\n', ' | '))
        pg.screenshot(path=f'{ROOT}/shot_tip.png')
        # sauce key readable
        pg.click('[data-sec="sauce"]'); pg.wait_for_timeout(600)
        t = pg.get_attribute('[data-path="saucenao.apiKey"]', 'type'); check('sauce key is plain text', t == 'text', t)
        pg.fill('[data-path="saucenao.apiKey"]', 'abc123KEY'); pg.press('[data-path="saucenao.apiKey"]', 'Tab'); pg.wait_for_timeout(600)
        check('sauce key saved', api('/state')['settings']['saucenao']['apiKey'] == 'abc123KEY')
        # per-field reset
        pg.click('[data-sec="quality"]'); pg.wait_for_timeout(600)
        pg.fill('[data-path="quality.minShortSide"]', '999'); pg.press('[data-path="quality.minShortSide"]', 'Tab'); pg.wait_for_timeout(500)
        check('field changed', api('/state')['settings']['quality']['minShortSide'] == 999)
        pg.click('[data-def="quality.minShortSide"]'); pg.wait_for_timeout(600)
        check('field reset arrow', api('/state')['settings']['quality']['minShortSide'] == 500)
        # reset button with confirm
        pg.click('[data-sec="reset"]'); pg.wait_for_timeout(500); pg.click('[data-reset="decisions"]'); pg.click('#cbok'); pg.wait_for_timeout(600)
        # nav hide
        pg.keyboard.press('m'); pg.wait_for_timeout(500); check('nav hidden with M', pg.evaluate("document.body.classList.contains('nonav')"))
        pg.screenshot(path=f'{ROOT}/shot_nonav.png'); pg.click('#navtoggle'); pg.wait_for_timeout(300); check('nav toggle restores', not pg.evaluate("document.body.classList.contains('nonav')"))
        pg.keyboard.press('m'); pg.wait_for_timeout(1200)
        check('nav pref persisted server-side', api('/ui')['nav'] is False)
        # appearance persists across a new origin (new browser context)
        pg.keyboard.press('m')
        pg.click('nav a[data-r="look"]'); pg.wait_for_timeout(700); pg.screenshot(path=f'{ROOT}/shot_appearance.png')
        th = pg.locator('#a-themes .tcard'); print('themes', th.count()); th.nth(6).click(); pg.wait_for_timeout(1200)
        accent1 = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--acc')")
        pg2 = b.new_context().new_page(); pg2.goto(f'{base}/?t=tok123#review'); pg2.wait_for_timeout(1500)
        accent2 = pg2.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--acc')")
        check('appearance persists in new context', accent1 == accent2 and accent1.strip() != '', (accent1, accent2))
        pg2.close()
        # review: layouts, random, clear filters
        pg.goto(f'{base}/?t=tok123#review'); pg.wait_for_timeout(1200)
        for lay in ['masonry', 'list', 'grid']: pg.click(f'#laysw [data-lay="{lay}"]'); pg.wait_for_timeout(250)
        pg.screenshot(path=f'{ROOT}/shot_list.png')
        pg.click('#rshuf'); pg.wait_for_timeout(700); check('random sort', pg.input_value('#rsort') == 'random')
        pg.click('#rclear'); pg.wait_for_timeout(700)
        pg.keyboard.press('Control+a'); pg.wait_for_timeout(300); check('ctrl+a selects', pg.locator('.tile.sel').count() == pg.locator('.tile').count() > 0)
        pg.keyboard.press('Escape')
        # viewer
        pg.locator('.tile').nth(0).dblclick(); pg.wait_for_timeout(1000)
        z0 = pg.inner_text('#v_zoom'); pg.mouse.move(700, 400); pg.mouse.wheel(0, -300); pg.wait_for_timeout(300); z1 = pg.inner_text('#v_zoom')
        check('viewer wheel zoom', int(z1[:-1]) > int(z0[:-1]), (z0, z1))
        pg.keyboard.press('0'); pg.wait_for_timeout(200); check('viewer fit key', pg.inner_text('#v_zoom') == z0)
        pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(500); check('viewer next', pg.inner_text('#v_count').startswith('2 of'))
        pg.keyboard.press('h'); pg.wait_for_timeout(200); check('viewer hide UI', pg.evaluate("document.querySelector('#viewer').classList.contains('noui')"))
        pg.screenshot(path=f'{ROOT}/shot_viewer_noui.png'); pg.keyboard.press('h')
        pg.keyboard.press('a'); pg.wait_for_timeout(600); check('viewer A approves and moves', api('/state')['counts']['moved'] == 1)
        pg.screenshot(path=f'{ROOT}/shot_viewer2.png'); pg.keyboard.press('Escape')
        # unmapped / sets / dupes / rules render
        for route in ['sets', 'dupes', 'unmapped', 'rules', 'sauce', 'undo']:
            pg.goto(f'{base}/?t=tok123#{route}'); pg.wait_for_timeout(800)
        pg.goto(f'{base}/?t=tok123#dupes'); pg.wait_for_timeout(800)
        if pg.locator('[data-rs]').count(): pg.locator('[data-rs]').first.click(); pg.wait_for_timeout(900)
        pg.goto(f'{base}/?t=tok123#rules'); pg.wait_for_timeout(800)
        if pg.locator('[data-fr]').count(): pg.locator('[data-fr]').first.click()
        pg.click('#rord')
        pg.screenshot(path=f'{ROOT}/shot_rules.png')
        b.close()
    check('no console errors', not errors, errors)
finally:
    p.terminate()
print('ALL OK' if ok else 'SOME FAILED')
