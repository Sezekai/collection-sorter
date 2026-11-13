process.env.CS_DATA = '/tmp/cs_test_decide'; require('fs').rmSync('/tmp/cs_test_decide', { recursive: true, force: true });
const settings = require('../engine/settings'); const db = require('../engine/db');
const { buildRules } = require('../engine/rules'); const { decideAll } = require('../engine/decide'); const { toBlob } = require('../engine/analyze');
db.open(); const S = settings.load();
const names = ['Manga-Style and B&W','Manga','Attack on Titan','ReZero','Zelda','Painterly','Pixel Art','Mecha','Anime','Games','Anime Style','Characters','AI','All Other Art','Average & LQ','Dupes','Real','Connected Art'].map((name) => ({ name, ignored: false }));
const rules = buildRules(names);
const vec = () => { const v = new Float32Array(512).map(() => Math.random() - 0.5); let n = 0; for (const x of v) n += x * x; return v.map((x) => x / Math.sqrt(n)); };
const cases = [
  ['aot char',      { g: [['1girl', 0.99]], c: [['mikasa ackerman', 0.93]] }, { grey: 0.02 }, [0.01, 0.02, 0.01, 0.0]],
  ['rem paren',     { g: [['solo', 0.9]], c: [['rem (re:zero)', 0.88]] }, { grey: 0.05 }, [0.3, 0.5, 0.05, 0.01]],
  ['mono wins',     { g: [['monochrome', 0.97], ['greyscale', 0.95]], c: [['eren yeager', 0.9]] }, { grey: 0.99 }, [0.9, 0.05, 0.02, 0.0]],
  ['pixel',         { g: [['pixel art', 0.9]], c: [] }, { grey: 0.1 }, [0.9, 0.05, 0.02, 0.0]],
  ['unmapped char', { g: [['1girl', 0.9]], c: [['some girl (obscure game)', 0.8]] }, { grey: 0.1 }, [0.9, 0.05, 0.02, 0.0]],
  ['nsfw',          { g: [['1girl', 0.9]], c: [['link', 0.85]] }, { grey: 0.1 }, [0.1, 0.1, 0.6, 0.2]],
  ['very',          { g: [['1girl', 0.9]], c: [['link', 0.85]] }, { grey: 0.1 }, [0.0, 0.0, 0.2, 0.8]],
  ['nothing',       { g: [], c: [] }, { grey: 0.1 }, [0.9, 0.05, 0.02, 0.0]],
  ['lowq',          { g: [['1girl', 0.9]], c: [['mikasa ackerman', 0.93]] }, { grey: 0.1, w: 300, h: 200 }, [0.9, 0.05, 0.02, 0.0]],
];
const ins = db.get().prepare(`insert into files(path,pkey,kind,ext,size,w,h,sharp,bpp,blk,grey,colorful,rating_g,rating_s,rating_q,rating_e,tags,analyzed) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
for (const [name, t, m, rt] of cases) {
  const id = Number(ins.run('/x/' + name + '.jpg', '/x/' + name, 'image', '.jpg', 400000, m.w || 1400, m.h || 1000, 300, 2, 1, m.grey, 0.3, rt[0], rt[1], rt[2], rt[3], JSON.stringify({ g: t.g, c: t.c, y: [] })).lastInsertRowid);
  db.get().prepare('insert into emb values(?,?)').run(id, toBlob(vec()));
}
decideAll(S, rules, null, {}, null).then((r) => {
  console.log('unmapped', JSON.stringify(r.unmapped));
  for (const x of db.get().prepare('select f.path,s.lane,s.folder,s.rating,s.score,s.reason,s.series,s.fallback from suggestions s join files f on f.id=s.file_id order by f.id').all()) console.log(x.path.split('/').pop().padEnd(18), x.lane.padEnd(8), String(x.folder).padEnd(22), x.rating.padEnd(8), x.score, '|', x.reason, x.series ? '| series=' + x.series : '', x.fallback ? '| fallback=' + x.fallback : '');
});
