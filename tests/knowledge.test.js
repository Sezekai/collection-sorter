process.env.CS_DATA = '/tmp/cs_test_know'; require('fs').rmSync('/tmp/cs_test_know', { recursive: true, force: true });
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs');
const settings = require('../engine/settings'); const db = require('../engine/db');
const K = require('../engine/knowledge');
// an examples library with two folders that match destination names and one that doesn't
const R = '/tmp/cs_know_lib'; fs.rmSync(R, { recursive: true, force: true });
for (const f of ['Zelda', 'Pixel Art', 'Pokemon Stuff', 'Skip Me']) { fs.mkdirSync(`${R}/${f}`, { recursive: true }); }
settings.replace({ referenceRoots: [R], destinationRoot: '/tmp/none', referenceMap: {} });
db.open();
const ins = db.get().prepare('insert into refs(path,folder,kind,tags,analyzed,label) values(?,?,?,?,1,?)');
const mk = (folder, tags, n) => { for (let i = 0; i < n; i++) ins.run(`${R}/${folder}/${i}.jpg`, folder, 'image', JSON.stringify({ g: tags.map((t) => [t, 0.9]), c: [], y: [] }), 'general'); };
mk('Zelda', ['sword', 'hylian shield', 'pointy ears', 'green tunic'], 8);
mk('Pixel Art', ['pixel art', 'lowres', 'sprite'], 8);
mk('Pokemon Stuff', ['pikachu', 'electricity'], 8);
test('suggestMap finds the destination folder', () => {
  const d = ['Zelda', 'Pixel Art', 'Pokemon', 'Games'];
  assert.strictEqual(K.suggestMap('pixel art', d), 'Pixel Art');
  assert.strictEqual(K.suggestMap('Pokemon Stuff', d), 'Pokemon');
  assert.strictEqual(K.suggestMap('Zzz Unknown', d), null);
});
test('fingerprint prefers the folder whose examples share the tags', () => {
  const P = K.build();
  const s = K.score(P, new Map([['sword', 0.8], ['pointy ears', 0.7], ['1girl', 0.9]]), new Map());
  assert.ok((s.get('Zelda') || 0) > (s.get('Pixel Art') || 0), JSON.stringify([...s]));
  assert.ok((s.get('Zelda') || 0) > 0.3);
  assert.deepStrictEqual(K.explain(P, new Map([['sword', 0.8], ['pointy ears', 0.7]]), new Map(), 'Zelda', 2).sort(), ['pointy ears', 'sword']);
  const L = K.learnedSummary('Zelda'); assert.strictEqual(L.n, 8); assert.ok(L.tags.some(([t, sh]) => t === 'sword' && sh === 1));
});
test('overview flags unmatched folders and remap follows the map', () => {
  const S = settings.load(); const dests = ['Zelda', 'Pixel Art', 'Pokemon'];
  const o = K.overview(S, dests); const g = Object.fromEntries(o.roots[0].groups.map((x) => [x.name, x]));
  assert.strictEqual(g['Zelda'].ok, true); assert.strictEqual(g['Pokemon Stuff'].ok, false); assert.strictEqual(g['Pokemon Stuff'].suggested, 'Pokemon');
  settings.save({ referenceMap: { 'Pokemon Stuff': 'Pokemon', 'Pixel Art': null } });
  const r = K.remap(settings.load());
  assert.strictEqual(r.moved, 8); assert.strictEqual(r.dropped, 8);
  const left = db.get().prepare('select folder,count(*) c from refs group by folder').all();
  assert.deepStrictEqual(left.map((x) => x.folder).sort(), ['Pokemon', 'Zelda']);
});
test('probe lists subfolders with counts', () => {
  fs.writeFileSync(`${R}/Zelda/a.jpg`, 'x'); fs.writeFileSync(`${R}/Zelda/b.jpg`, 'x');
  const p = K.probe(R, '', 2000); assert.ok(p.dirs.find((x) => x.name === 'Zelda' && x.n === 2));
});
