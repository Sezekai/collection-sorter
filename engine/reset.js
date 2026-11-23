'use strict';
// Cleanup after settings change, plus every "reset" the app offers. Nothing here ever touches your media files.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settingsMod = require('./settings');
const { pkey } = require('./util');
const thumbsDir = () => require('./thumbs').DIR;

function delFiles(ids) {
  const d = db.get();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400), q = chunk.map(() => '?').join(',');
    db.tx(() => {
      for (const t of ['emb:file_id', 'file_tags:file_id', 'tagsets:file_id', 'suggestions:file_id', 'set_members:file_id', 'dupe_members:file_id']) { const [tb, col] = t.split(':'); d.prepare(`delete from ${tb} where ${col} in (${q})`).run(...chunk); }
      d.prepare(`delete from files where id in (${q})`).run(...chunk);
    });
    for (const id of chunk) { try { fs.unlinkSync(path.join(thumbsDir(), id + '.jpg')); } catch { /* none */ } }
  }
  dropEmptyGroups();
}
function dropEmptyGroups() {
  const d = db.get();
  d.exec(`delete from dupe_groups where id not in (select group_id from dupe_members); delete from sets_ where id not in (select set_id from set_members);`);
}

// Forget files/examples that belong to folders that are no longer in Settings (or are now excluded).
function cleanup(settings) {
  const d = db.get();
  const srcs = (settings.sources || []).filter((s) => s.path).map((s) => ({ key: pkey(s.path), ex: (s.excludes || []).map((e) => pkey(s.path + '/' + e.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))) }));
  const gone = [];
  for (const r of d.prepare(`select id,path from files where status='new'`).all()) {
    const k = pkey(r.path);
    const s = srcs.find((x) => k.startsWith(x.key + '/'));
    if (!s || s.ex.some((e) => k === e || k.startsWith(e + '/'))) gone.push(r.id);
  }
  delFiles(gone);
  const roots = [...(settings.referenceRoots || []), ...(settings.keptReferenceRoots || [])].filter(Boolean).map(pkey);
  const badRefs = d.prepare('select id,path from refs').all().filter((r) => { const k = pkey(r.path); return !roots.some((x) => k.startsWith(x + '/')); }).map((r) => r.id);
  for (let i = 0; i < badRefs.length; i += 400) { const c = badRefs.slice(i, i + 400); d.prepare(`delete from refs where id in (${c.map(() => '?').join(',')})`).run(...c); d.prepare(`delete from ref_tagsets where ref_id in (${c.map(() => '?').join(',')})`).run(...c); }
  return { filesRemoved: gone.length, examplesRemoved: badRefs.length };
}

function clearThumbs() { let n = 0; for (const D of [thumbsDir(), require('./storage').cacheDir()]) { try { for (const f of fs.readdirSync(D)) { try { fs.unlinkSync(path.join(D, f)); n++; } catch { /* skip */ } } } catch { /* none */ } } return n; }

const WHAT = {
  // review decisions only: approvals, rejections, folder/rating overrides. The analysis is kept.
  decisions() { const d = db.get(); d.exec(`update suggestions set state='pending', user_folder=null, user_rating=null where state!='moved'; update sets_ set state='pending'; update dupe_groups set state='pending';`); return 'All approvals, rejections and manual folder choices were cleared.'; },
  // suggestions: delete them all (they are rebuilt by "Re-run suggestions")
  suggestions() { db.get().exec(`delete from suggestions where state!='moved'`); return 'Suggestions cleared. Press "Re-run suggestions" to rebuild them.'; },
  // forget how every file was read (tags, embeddings) so it is read again
  analysis() { db.kvSet('taggerUsed', null); const d = db.get(); d.exec(`delete from emb; delete from file_tags; delete from tagsets where file_id in (select id from files where status='new'); delete from suggestions where state!='moved'; delete from set_members; delete from sets_; delete from dupe_members; delete from dupe_groups; update files set analyzed=0, err=null, tags=null, fp=null, sha=null where status='new'`); clearThumbs(); return 'Every file will be read again on the next "Scan & analyse".'; },
  // forget the file list itself (full re-scan)
  files() { db.kvSet('taggerUsed', null); const d = db.get(); d.exec(`delete from emb; delete from file_tags; delete from tagsets where file_id in (select id from files where status='new'); delete from suggestions where state!='moved'; delete from set_members; delete from sets_; delete from dupe_members; delete from dupe_groups; delete from files where status='new'`); clearThumbs(); return 'The file list was cleared. The next scan starts from nothing.'; },
  examples() { db.get().exec('delete from refs; delete from ref_tagsets'); return 'All learned examples were cleared.'; },
  examplesLearning() { db.get().exec('update refs set analyzed=0, tags=null, v=null, metrics=null, rating=null; delete from ref_tagsets'); return 'Examples will be re-learned on the next "Scan & analyse".'; },
  series() { db.get().exec('delete from series_map'); return 'Series-to-folder assignments cleared.'; },
  rules() { db.kvSet('rules', null); return 'Rules and ranking are back to the built-in defaults.'; },
  thumbs() { return `Removed ${clearThumbs()} cached thumbnails (they rebuild when needed).`; },
  prompts() { db.kvSet('promptEmbs', null); return 'Cached text descriptions cleared.'; },
  history() { db.get().exec('delete from journal; delete from batches'); return 'Move history cleared. Files already moved can no longer be undone from the app.'; },
  settings() { settingsMod.replace({}); return 'Settings are back to the recommended values.'; },
  everything() {
    const d = db.get();
    for (const t of ['files', 'emb', 'file_tags', 'labels', 'refs', 'suggestions', 'sets_', 'set_members', 'dupe_groups', 'dupe_members', 'series_map', 'sauce', 'tagsets', 'ref_tagsets', 'kv']) d.exec(`delete from ${t}`);
    clearThumbs();
    return 'Everything the app learned was cleared (settings, models and move history were kept).';
  },
  everythingAndHistory() { const m = WHAT.everything(); db.get().exec('delete from journal; delete from batches'); return m + ' Move history was cleared too.'; },
};

module.exports = { cleanup, WHAT, delFiles, clearThumbs };
