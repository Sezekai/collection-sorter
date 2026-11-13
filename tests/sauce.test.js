const http = require('http'); let got = 0;
const srv = http.createServer((req, res) => { let n = 0; req.on('data', (c) => (n += c.length)); req.on('end', () => { got = n; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ header: { status: 0, short_remaining: 5, long_remaining: 190, short_limit: '6', long_limit: '200' }, results: [{ header: { similarity: '91.3', index_name: 'Pixiv' }, data: { title: 'x', material: 'attack on titan', characters: 'eren yeager, mikasa', ext_urls: ['https://x'] } }, { header: { similarity: '40' }, data: {} }] })); }); });
srv.listen(0, async () => {
  process.env.SAUCENAO_URL = `http://127.0.0.1:${srv.address().port}/search.php`;
  const s = require('../engine/saucenao'); const { buildRules } = require('../engine/rules');
  const r = await s.lookup('/tmp/corpus/G0good_jpeg.jpg', 'KEY');
  console.log('uploaded bytes>0:', got > 1000, JSON.stringify(r.results[0]), r.remaining);
  const rules = buildRules([{ name: 'Attack on Titan' }, { name: 'Zelda' }]);
  console.log(s.folderForSeries('Attack on Titan', rules), s.folderForSeries('shingeki no kyojin', rules), s.folderForSeries('Unknown thing', rules));
  srv.close();
});
