process.env.CS_DATA = '/tmp/cs_test_data';
const settings = require('../engine/settings'); const db = require('../engine/db');
const { findDupes, findSets } = require('../engine/groups'); const { toBlob } = require('../engine/analyze');
db.open(); const s = settings.load();
// stand-in embeddings: unique random vector per file, except the comic set which shares a base style and the resized copy of one image
const rnd = () => { const v = new Float32Array(512); for (let i = 0; i < 512; i++) v[i] = Math.random() - 0.5; return v; };
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n); return v.map((x) => x / n); };
const base = rnd(), baseSet = rnd(); const embByName = {};
for (const r of db.get().prepare('select id,path from files').all()) {
  const nm = r.path.split('/').pop(); let v;
  if (nm.startsWith('GJ73xV')) { v = baseSet.map((x) => x + (Math.random() - 0.5) * 0.35); }
  else if (nm.startsWith('G0sharp_big')) { v = base.map((x) => x + (Math.random() - 0.5) * 0.02); }
  else v = rnd();
  db.get().prepare('insert or replace into emb(file_id,v) values(?,?)').run(r.id, toBlob(norm(v)));
}
(async () => {
  console.log('dupe groups', await findDupes(s));
  for (const g of db.get().prepare('select g.id,g.kind,m.file_id,m.keep,f.path from dupe_groups g join dupe_members m on m.group_id=g.id join files f on f.id=m.file_id order by g.id,m.keep desc').all()) console.log(' ', g.id, g.kind, g.keep, g.path.split('/').pop());
  console.log('sets', findSets(s));
  for (const g of db.get().prepare('select s.id,s.name,s.score,f.path from sets_ s join set_members m on m.set_id=s.id join files f on f.id=m.file_id order by s.id').all()) console.log(' ', g.id, g.name, g.score, g.path.split('/').pop());
})();
