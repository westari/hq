// Seeker's list of places, kept on GitHub (the "outreach-data" branch of this repo).
// The app keeps its own copy in hq/.seeker-data and never keeps changes that aren't on GitHub:
// every change is made on the newest copy, saved, and sent to GitHub right away.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BRANCH = 'outreach-data';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

class Store {
  constructor(repoDir, { dir } = {}) {
    this.repo = repoDir;
    this.dir = dir || path.join(repoDir, '.seeker-data');
    this.queue = Promise.resolve();
  }
  git(args, cwd = this.dir) {
    return new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: 30000, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) { err.message = (stderr || err.message).trim(); reject(err); } else resolve(stdout);
    }));
  }
  async ensure() {
    if (fs.existsSync(path.join(this.dir, '.git'))) return;
    await this.git(['worktree', 'prune'], this.repo).catch(() => {});
    await this.git(['fetch', '--quiet', 'origin', BRANCH], this.repo);
    await this.git(['worktree', 'add', '--quiet', '-B', BRANCH, this.dir, `origin/${BRANCH}`], this.repo);
  }
  // Get the newest copy from GitHub.
  async pull() {
    await this.ensure();
    await this.git(['fetch', '--quiet', 'origin', BRANCH]);
    await this.git(['reset', '--quiet', '--hard', `origin/${BRANCH}`]);
  }
  read() {
    const f = n => path.join(this.dir, n);
    let log = [];
    try { log = fs.readFileSync(f('log.jsonl'), 'utf8').trim().split('\n').slice(-300).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
    return { places: readJson(f('places.json'), []), settings: readJson(f('settings.json'), null), state: readJson(f('state.json'), {}), log };
  }
  // Every call waits its turn, so two clicks never trip over each other.
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  load() { return this.serial(async () => { await this.pull(); return this.read(); }); }

  // op = { type: 'add', data } | { type: 'update', id, patch } | { type: 'delete', id } | { type: 'settings', data }
  change(op) {
    return this.serial(async () => {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.pull();
        const d = this.read();
        const msg = apply(d, op);
        if (!msg) return d;
        fs.writeFileSync(path.join(this.dir, 'places.json'), JSON.stringify(d.places, null, 2) + '\n');
        if (d.settings) fs.writeFileSync(path.join(this.dir, 'settings.json'), JSON.stringify(d.settings, null, 2) + '\n');
        await this.git(['add', '-A']);
        await this.git(['-c', 'user.name=Seeker app', '-c', 'user.email=seeker@users.noreply.github.com', 'commit', '--quiet', '-m', msg]);
        try { await this.git(['push', '--quiet', 'origin', `HEAD:${BRANCH}`]); return this.read(); }
        catch (e) { lastErr = e; } // GitHub got a newer copy first (the morning run). Try again on top of it.
      }
      await this.pull().catch(() => {});
      throw lastErr || new Error('Could not save to GitHub');
    });
  }
}

// Makes one change to the list. Returns a short note for GitHub, or null if nothing changed.
function apply(d, op) {
  const now = new Date().toISOString();
  if (op.type === 'add') {
    const data = { ...op.data };
    const dup = d.places.find(p => p.name.trim().toLowerCase() === String(data.name).trim().toLowerCase() && p.city === data.city);
    if (dup) return null;
    d.places.push({ id: crypto.randomBytes(5).toString('hex'), status: 'todo', videos: 0, addedAt: now, updatedAt: now, ...data });
    return `Add ${data.name} (${data.city})`;
  }
  if (op.type === 'update') {
    const p = d.places.find(x => x.id === op.id);
    if (!p) return null;
    Object.assign(p, op.patch, { updatedAt: now });
    return `Update ${p.name}`;
  }
  if (op.type === 'delete') {
    const i = d.places.findIndex(x => x.id === op.id);
    if (i < 0) return null;
    const [p] = d.places.splice(i, 1);
    return `Remove ${p.name}`;
  }
  if (op.type === 'settings') {
    d.settings = { ...(d.settings || {}), ...op.data };
    return 'Update settings';
  }
  return null;
}

module.exports = { Store, apply, BRANCH };
