process.env.CS_DATA = '/tmp/cs_test_data'; require('fs').rmSync('/tmp/cs_test_data', { recursive: true, force: true });
const settings = require('../engine/settings'); const db = require('../engine/db');
const { scanSources } = require('../engine/scanner'); const { analyzeFiles } = require('../engine/analyze');
const { loadModels } = require('../engine/models');
(async () => {
  settings.replace({ sources: [{ path: '/tmp/corpus', excludes: [] }], destinationRoot: '/tmp/none', tagger: { model: 'swinv2' } });
  db.open();
  console.log(await scanSources(settings.load()));
  const models = await loadModels(settings.load(), '/tmp/dummy');
  console.log(await analyzeFiles(models, settings.load(), {}, null));
  const rows = db.get().prepare('select id,path,w,h,sharp,qscore,analyzed,err,substr(tags,1,60) t from files').all();
  for (const r of rows) console.log(r.id, r.path.split('/').slice(-2).join('/'), r.w, r.h, r.sharp, r.qscore, r.analyzed, r.err || '', r.t);
})().catch((e) => { console.error(e); process.exit(1); });
