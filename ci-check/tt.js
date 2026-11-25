const sharp = require('sharp'); const { Tagger, SPECS } = require('../engine/models/tagger.js');
const M = process.env.M;
const files = { haruka: ['haruka.onnx', 'haruka_meta.json'], camie: ['camie.onnx', 'camie_meta.json'], pixai: ['model_fp16.onnx', 'selected_tags.csv'] };
(async () => {
  for (const key of process.argv.slice(2)) {
    const sp = { ...SPECS[key] }; if (process.env.OUT) sp.output = process.env.OUT; const t0 = Date.now(); const t = await new Tagger(sp, { device: 'cpu', batch: 1 }).init(M + files[key][0], M + files[key][1]);
    console.log('==', key, 'loaded', Date.now() - t0, 'ms; out', t.outputName, 'tags', t.tags.length, 'ratings', t.idx.rating.map((i) => t.tags[i].name));
    for (const img of ['banner.png', 'cats.png']) {
      const { data, info } = await sharp(__dirname + '/' + img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const t1 = Date.now(); const [r] = await t.tag([{ data, width: info.width, height: info.height }]);
      console.log(img, Date.now() - t1, 'ms', JSON.stringify(r.rating, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
      console.log('  general:', r.general.slice(0, 18).map((x) => x[0] + ' ' + x[1].toFixed(2)).join(', '));
      console.log('  char:', r.character.map((x) => x[0]).join(', '), '| copy:', r.copyright.map((x) => x[0]).join(', '), '| artist:', r.artist.map((x) => x[0]).join(', '));
    }
    t.release();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
