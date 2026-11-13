const fs = require('fs'), path = require('path');
for (const force of ['0', '1']) {
  process.env.CS_FORCE_COPY = force;
  const root = '/tmp/mv_' + force; fs.rmSync(root, { recursive: true, force: true });
  const src = root + '/src', dst = root + '/dst'; fs.mkdirSync(src, { recursive: true }); fs.mkdirSync(dst + '/Zelda/NSFW/Very', { recursive: true });
  fs.writeFileSync(src + '/a.jpg', 'AAA'); fs.writeFileSync(src + '/b.jpg', 'BBBB'); fs.writeFileSync(dst + '/Zelda/a.jpg', 'existing');
  process.env.CS_DATA = root + '/data';
  delete require.cache[require.resolve('../engine/settings')]; delete require.cache[require.resolve('../engine/db')]; delete require.cache[require.resolve('../engine/mover')];
  const db = require('../engine/db'); const mover = require('../engine/mover'); db.open();
  const d = db.get();
  const add = (p, folder, rating, state = 'approved') => { const id = Number(d.prepare(`insert into files(path,pkey,kind,ext,size,analyzed) values(?,?,?,?,?,1)`).run(p, p.toLowerCase(), 'image', '.jpg', fs.statSync(p).size).lastInsertRowid); d.prepare(`insert into suggestions(file_id,lane,folder,rating,state) values(?,?,?,?,?)`).run(id, 'art', folder, rating, state); return id; };
  add(src + '/a.jpg', 'Zelda', 'general'); add(src + '/b.jpg', 'Zelda', 'very');
  (async () => {
    const S = { destinationRoot: dst };
    const r = await mover.applyBatch ? null : await mover.applyApproved(S, { note: 'test' });
    console.log('force', force, JSON.stringify(r), fs.readdirSync(dst + '/Zelda'), fs.readdirSync(dst + '/Zelda/NSFW/Very'), fs.readdirSync(src));
    console.log('history', JSON.stringify(mover.history()));
    const u = await mover.undoBatch(r.batch);
    console.log('undo', JSON.stringify(u), fs.readdirSync(src), fs.readdirSync(dst + '/Zelda'), fs.readFileSync(dst + '/Zelda/a.jpg', 'utf8'));
  })().catch((e) => { console.error(e); process.exit(1); });
}
