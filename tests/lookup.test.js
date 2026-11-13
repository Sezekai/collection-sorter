// IQDB / Ascii2D parsing and the combined "is there a bigger copy" decision, against mock servers that mimic those sites' markup.
const http = require('http'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const IQDB = `<html><body><div id="pages"><div><table><tr><th>Your image</th></tr><tr><td class='image'><a href="#"><img src='/thu/a.jpg'></a></td></tr><tr><td>800×600 [Safe]</td></tr></table></div>
<div><table><tr><th>Best match</th></tr><tr><td class='image'><a href="//danbooru.donmai.us/post/show/123"><img src='/d/1.jpg' alt="Rating: s Score: 5 Tags: rem_(re:zero) re:zero_kara_hajimeru_isekai_seikatsu 1girl" width=150 height=112></a></td></tr><tr><td><img alt="icon" src="/i/d.png" class="service-icon"> Danbooru</td></tr><tr><td>2400×1800 [Safe]</td></tr><tr><td>94% similarity</td></tr></table></div>
<div><table><tr><th>Possible match</th></tr><tr><td class='image'><a href="https://gelbooru.com/index.php?id=9"><img src='/g/1.jpg' alt="Tags: 1girl"></a></td></tr><tr><td>Gelbooru</td></tr><tr><td>800×600 [Safe]</td></tr><tr><td>71% similarity</td></tr></table></div></div></body></html>`;
const ASCII = `<html><body><div class="row item-box"><div class="col image-box"><img src="/thumb/own.jpg"></div><div class="col info-box"><div class="hash">aaa</div><small class="text-muted">800x600 JPG 120.5KB</small></div></div>
<div class="row item-box"><div class="col-xs-12 col-sm-12 col-md-4 col-xl-4 text-xs-center image-box"><img src="/thumb/1.jpg"></div><div class="col info-box"><div class="hash">bbb</div><small class="text-muted">3200x2400 PNG 4.2MB</small><div class="detail-box gray-link"><h6><a href="https://www.pixiv.net/artworks/1">Rem</a> <small><a href="https://www.pixiv.net/users/2">artistX</a></small></h6></div></div></div></body></html>`;
const NOMATCH = '<html><body><div id="pages"><div><table><tr><th>Your image</th></tr></table></div><div>No relevant matches</div></div></body></html>';
const iq = require('../engine/lookup/iqdb'), as = require('../engine/lookup/ascii2d'), s = require('../engine/saucenao'); const { buildRules } = require('../engine/rules');
const a = iq.parse(IQDB);
assert.strictEqual(a.length, 2); assert.deepStrictEqual([a[0].w, a[0].h, a[0].similarity, a[0].url], [2400, 1800, 94, 'https://danbooru.donmai.us/post/show/123']); assert.ok(a[0].tags.includes('1girl'));
assert.strictEqual(iq.parse(NOMATCH).length, 0);
const b = as.parse(ASCII); assert.strictEqual(b.length, 1); assert.deepStrictEqual([b[0].w, b[0].h, b[0].site, b[0].title, b[0].artist], [3200, 2400, 'pixiv.net', 'Rem', 'artistX']);
const rules = buildRules([{ name: 'Re Zero' }]);
const c = s.combine({ iqdb: a, ascii2d: b, saucenao: [{ similarity: 91, title: 'x', series: 'Re:Zero', characters: [], urls: ['https://p'] }] }, { w: 800, h: 600 }, { minSimilarity: 80, biggerFactor: 1.2 }, rules);
assert.strictEqual(c.hq.w, 2400); assert.strictEqual(c.hq.certain, true); // trusted IQDB match wins over the bigger but unscored Ascii2D one
const c0 = s.combine({ ascii2d: b }, { w: 800, h: 600 }, { minSimilarity: 80 }, rules); assert.strictEqual(c0.hq.w, 3200); assert.strictEqual(c0.hq.certain, false);
const c2 = s.combine({ iqdb: a }, { w: 800, h: 600 }, { minSimilarity: 80 }, rules); assert.strictEqual(c2.hq.w, 2400); assert.strictEqual(c2.hq.certain, true); assert.strictEqual(c2.top.similarity, 94);
const c3 = s.combine({ iqdb: a }, { w: 2400, h: 1800 }, { minSimilarity: 80 }, rules); assert.strictEqual(c3.hq, null);
const c4 = s.combine({ iqdb: a }, { w: 800, h: 600 }, { minSimilarity: 95 }, rules); assert.strictEqual(c4.hq, null); assert.strictEqual(c4.top, null); // below the trusted similarity
// over the wire: upload goes to the mock, nothing else
let hits = [];
const srv = http.createServer((req, res) => { let n = 0; req.on('data', (d) => (n += d.length)); req.on('end', () => { hits.push(req.method + ' ' + req.url + ' ' + (n > 500)); res.setHeader('content-type', 'text/html'); res.end(req.url.startsWith('/iq') ? IQDB : ASCII); }); });
srv.listen(0, async () => {
  const port = srv.address().port; process.env.IQDB_URL = `http://127.0.0.1:${port}/iq`; process.env.ASCII2D_URL = `http://127.0.0.1:${port}`;
  const r1 = await iq.lookup('/tmp/corpus/G0good_jpeg.jpg'); const r2 = await as.lookup('/tmp/corpus/G0good_jpeg.jpg');
  assert.strictEqual(r1.length, 2); assert.strictEqual(r2.length, 1); assert.deepStrictEqual(hits, ['POST /iq true', 'GET / false', 'POST /search/file true']);
  console.log('lookup OK', hits); srv.close();
});
