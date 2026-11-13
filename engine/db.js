'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./settings');

const SCHEMA = `
create table if not exists files(
  id integer primary key,
  path text not null,
  pkey text not null unique,
  source text,
  size integer, mtime real,
  kind text, ext text,
  fp text,                       -- fast fingerprint: size + head + tail
  sha text,                      -- full sha256 (only when needed)
  w integer, h integer, duration real,
  dhash text, phash text,
  sharp real, bpp real, grey real, colorful real,
  qscore real,
  rating_g real, rating_s real, rating_q real, rating_e real,
  tags text,                     -- json [[tag,prob,cat],...]
  vtags text,                    -- json for videos: per-frame labels
  analyzed integer default 0,    -- 0 pending, 1 done, 2 failed
  err text,
  status text default 'new'      -- new | moved | gone
);
create index if not exists files_fp on files(fp);
create index if not exists files_analyzed on files(analyzed);
create table if not exists emb(file_id integer primary key, v blob);

create table if not exists refs(
  id integer primary key,
  path text unique,
  folder text,                   -- destination folder this example belongs to
  fp text, kind text,
  tags text, v blob
);
create index if not exists refs_folder on refs(folder);

create table if not exists suggestions(
  file_id integer primary key,
  lane text,                     -- art | photo | video | lowq | dupe | set | unsorted
  folder text, score real, reason text, rating text,
  fallback text, fallback_score real, fallback_rating text,
  alt text,                      -- json of runner-up folders
  series text,                   -- detected series (for unmapped screen)
  state text default 'pending',  -- pending | approved | rejected | moved
  set_id integer,
  user_folder text, user_rating text,
  updated real
);
create index if not exists sugg_folder on suggestions(folder);
create index if not exists sugg_state on suggestions(state);
create index if not exists sugg_lane on suggestions(lane);

create table if not exists sets_(
  id integer primary key, name text, score real, kind text,
  state text default 'pending'   -- pending | approved | rejected
);
create table if not exists dupe_groups(
  id integer primary key, kind text, state text default 'pending'
);
create table if not exists dupe_members(
  group_id integer, file_id integer, keep integer default 0,
  primary key(group_id, file_id)
);
create table if not exists dupe_ignore(file_id integer primary key);
create table if not exists refs_extra(ref_id integer, folder text, primary key(ref_id, folder));   -- an example that teaches more than one destination folder
create table if not exists series_map(series text primary key, folder text);
create table if not exists hq_log(
  id integer primary key, ts real, file_id integer, fp text, name text, path text, event text, detail text
);
create table if not exists sauce(
  fp text primary key, state text, result text, ts real
);
create table if not exists batches(
  id integer primary key, ts real, kind text, note text
);
create table if not exists journal(
  id integer primary key,
  batch_id integer, file_id integer,
  src text, dst text, size integer, fp text,
  ts real, status text,          -- moved | undone | failed
  err text
);
create index if not exists journal_batch on journal(batch_id);
create index if not exists journal_file on journal(file_id);
create table if not exists set_members(set_id integer, file_id integer, primary key(set_id,file_id));
create table if not exists kv(k text primary key, v text);
create table if not exists labels(fp text primary key, real integer, ts real);   -- your "this is a real photo/video" / "this is art" corrections
create table if not exists file_tags(file_id integer, tag text, conf real, cat integer, primary key(file_id, tag));
create index if not exists ft_tag on file_tags(tag, conf);
`;

function migrate(d) {
  const add = (table, col, type) => {
    const has = d.prepare(`pragma table_info(${table})`).all().some((c) => c.name === col);
    if (!has) d.exec(`alter table ${table} add column ${col} ${type}`);
  };
  add('files', 'blk', 'real');
  add('files', 'thumb_ok', 'integer');
  add('dupe_members', 'decision', 'text');        // null = undecided | keep | dupes
  add('refs', 'metrics', 'text');
  add('refs', 'analyzed', 'integer default 0');
  add('refs', 'size', 'integer');
  add('refs', 'rating', 'text');
  add('refs', 'label', 'text');                 // general | nsfw | very (taken from the example's folder path)
  add('suggestions', 'fhq', 'integer default 0'); // 1 = put it in the "Find Higher Quality" subfolder
  add('files', 'moved_at', 'real');
  add('refs', 'err', 'text');
  add('files', 'jtags', 'text');                 // JoyTag's tags (json), kept next to the WD tags so you can mix and match
  add('files', 'realness', 'text');              // art | real  (the app's decision, or yours)
  add('files', 'p_clip', 'real');                // how real-life CLIP thinks it is (0..1)
  add('files', 'p_joy', 'real');                 // how real-life JoyTag thinks it is (0..1)
  add('files', 'real_by', 'text');               // what decided realness: clip | joytag | both | you
  add('refs', 'jtags', 'text');
  add('files', 'tagger', 'text');                // which tagging model read this picture
  add('refs', 'tagger', 'text');
  // backfill the NSFW / Very label of examples learned before this column existed
  for (const r of d.prepare(`select id,path from refs where label is null`).all()) {
    const p = r.path.replace(/\\/g, '/').toLowerCase();
    d.prepare('update refs set label=? where id=?').run(/\/very(\/|$)/.test(p) ? 'very' : /\/nsfw(\/|$)/.test(p) ? 'nsfw' : 'general', r.id);
  }
}

let db = null;
function open(file) {
  if (db) return db;
  db = new DatabaseSync(file || path.join(DATA_DIR, 'sorter.db'));
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = off;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
function close() { if (db) { db.close(); db = null; } }
function get() { return db || open(); }

function tx(fn) {
  const d = get();
  d.exec('begin');
  try { const r = fn(d); d.exec('commit'); return r; } catch (e) { d.exec('rollback'); throw e; }
}
function kvGet(k, def = null) {
  const r = get().prepare('select v from kv where k=?').get(k);
  if (!r) return def;
  try { return JSON.parse(r.v); } catch { return def; }
}
function kvSet(k, v) { get().prepare('insert into kv(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k, JSON.stringify(v)); }

module.exports = { open, close, get, tx, kvGet, kvSet };
