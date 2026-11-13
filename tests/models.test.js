const { WD14 } = require('../engine/models/wd14');
const { Clip, dot } = require('../engine/models/clip');
const { decodeWork } = require('../engine/metrics');
const fs = require('fs');
(async () => {
  const D = process.argv[2] || '/tmp/dummy';
  const works = [];
  for (const f of ['G0good_jpeg.jpg', 'G0blurry.jpg', 'G0grey.png']) { const r = await decodeWork('/tmp/corpus/' + f); works.push(r.work || r); }
  const wd = await new WD14({ device: 'cpu', batch: 4 }).init(D + '/wd14/model.onnx', D + '/wd14/selected_tags.csv');
  const t = await wd.tag(works);
  console.log('wd14', wd.provider, t.length, JSON.stringify(t[0].rating), t[0].general.length, t[0].character.length);
  const c = await new Clip({ device: 'cpu', batch: 4 }).init(D + '/clip/vision_model.onnx', D + '/clip/text_model.onnx');
  const e = await c.embedImages(works);
  console.log('clip img', e.length, e[0].length, dot(e[0], e[0]).toFixed(3), dot(e[0], e[1]).toFixed(3));
  const te = await c.embedTexts(['a photo of a cat', 'a painting']);
  console.log('clip txt', te.length, te[0].length, dot(te[0], te[1]).toFixed(3));
})().catch((e) => { console.error(e); process.exit(1); });
