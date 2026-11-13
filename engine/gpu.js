'use strict';
// GPU load and memory for the status bar chip, from nvidia-smi (installed with every NVIDIA driver).
// Returns null when there is no NVIDIA card or the tool is missing; the chip then shows just the card's name.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function smiPath() {
  const cands = [process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe'), 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* next */ } }
  return process.platform === 'win32' ? null : 'nvidia-smi';
}
let missing = false;
function sample() {
  return new Promise((resolve) => {
    const exe = missing ? null : smiPath(); if (!exe) return resolve(null);
    execFile(exe, ['--query-gpu=name,utilization.gpu,memory.used,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeout: 1800, windowsHide: true }, (err, out) => {
      if (err) { if (err.code === 'ENOENT') missing = true; return resolve(null); }
      const line = String(out).split(/\r?\n/).find((l) => l.trim()); if (!line) return resolve(null);
      const [name, load, used, total, driver] = line.split(',').map((x) => x.trim());
      resolve({ name: name.replace(/^NVIDIA GeForce /, ''), load: +load, memUsed: +used, memTotal: +total, driver });
    });
  });
}
module.exports = { sample, smiPath };
