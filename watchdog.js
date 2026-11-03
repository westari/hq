// ─── The Watchdog ───────────────────────────────────────────────────────────
// HQ's always-on helper. Plain code, no AI, no money. Every 20 seconds it compares
// "what should be true" with "what is true" and fixes the gap, one safe step at a time.
//
// How it stays safe:
//  - Every action has a key. An action with the same key never runs twice (idempotency).
//  - Every kind of action has a budget (for example: 1 automatic build per commit).
//  - After 3 failures in a row an area "trips" and rests (circuit breaker), then tells you.
//  - Git work happens in a separate temporary copy. Your app folder only changes when
//    everything passed. Conflicts never reach your app folder.
//  - When it isn't sure, it tells you instead of acting.
//  - Everything it sees and does is written to watchdog-log.jsonl.
//  - Mode "watch" (config watchdog.mode) = only says what it WOULD do.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile, spawn } = require('child_process');
const R = require('./watchdog-rules.js');

const MIN = 60 * 1000, HOUR = 60 * MIN;

function createWatchdog(hq) {
  const dir = hq.dir;
  const now = () => (hq.now ? hq.now() : Date.now());
  const cfg = () => Object.assign({ mode: 'act', tickSeconds: 20, maxAutoBuildsPerDay: 6, autoApprove: true, guards: true, stuckMinutes: 10 }, (hq.config().watchdog || {}));
  const STATE_FILE = path.join(dir, 'watchdog-state.json');
  const LOG_FILE = path.join(dir, 'watchdog-log.jsonl');

  // ── Memory that survives restarts ──
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  st = Object.assign({ done: {}, fails: {}, budgets: {}, breakers: {}, alerted: {}, build: { good: null, records: {}, installed: null, seenRuns: {} }, tsc: {}, fp: {}, paused: null, guards: {}, lastMerge: null, ready: null }, st);
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1)); } catch {} }, 500); };
  const prune = () => { // keep the memory small
    const cut = now() - 14 * 24 * HOUR;
    for (const k of Object.keys(st.done)) if (st.done[k] < cut) delete st.done[k];
    for (const k of Object.keys(st.alerted)) if (st.alerted[k].at < cut) delete st.alerted[k];
    const recs = Object.entries(st.build.records).sort((a, b) => b[1].at - a[1].at); st.build.records = Object.fromEntries(recs.slice(0, 40));
    const tk = Object.keys(st.tsc); if (tk.length > 30) for (const k of tk.slice(0, tk.length - 30)) delete st.tsc[k];
    const fk = Object.keys(st.fp); if (fk.length > 30) for (const k of fk.slice(0, fk.length - 30)) delete st.fp[k];
  };

  // ── Audit log ──
  const log = [];
  function record(kind, area, text, extra) {
    const e = { t: now(), kind, area, text, ...(extra || {}) };
    log.unshift(e); if (log.length > 300) log.length = 300;
    try { fs.appendFileSync(LOG_FILE, JSON.stringify(e) + '\n'); } catch {}
    if (kind !== 'see') hq.changed();
    return e;
  }
  try { // last entries from before a restart, so the panel isn't empty
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-120);
    for (const l of lines) { try { const e = JSON.parse(l); if (e.kind !== 'see') log.unshift(e); } catch {} }
    log.length = Math.min(log.length, 300);
    if (fs.statSync(LOG_FILE).size > 5e6) fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n');
  } catch {}

  // ── Safety tools: once, budget, breaker ──
  const once = (key) => !st.done[key];
  const mark = (key) => { st.done[key] = now(); save(); };
  function budget(name, max, perMs) { const list = (st.budgets[name] || []).filter((t) => now() - t < perMs); st.budgets[name] = list; return list.length < max; }
  function spend(name) { (st.budgets[name] = st.budgets[name] || []).push(now()); save(); }
  function breakerOpen(name) { const b = st.breakers[name]; return !!(b && b.openUntil && now() < b.openUntil); }
  function breakerFail(name, why) {
    const b = st.breakers[name] = st.breakers[name] || { fails: 0, openUntil: 0 };
    b.fails++; b.last = why;
    if (b.fails >= 3) { b.openUntil = now() + 2 * HOUR; b.fails = 0; record('trip', name, `${name} failed 3 times in a row. Resting for 2 hours and telling Ari.`); alert('breaker:' + name, 'urgent', `HQ stopped trying to fix ${name} by itself after 3 failures. Open the Watchdog.`); }
    save();
  }
  function breakerOk(name) { if (st.breakers[name]) { st.breakers[name] = { fails: 0, openUntil: 0 }; save(); } }

  const acting = () => cfg().mode !== 'watch' && !(st.paused && now() < st.paused.until);
  // Run an action only in "act" mode. In "watch" mode, just write down what would happen.
  async function act(area, key, text, fn) {
    if (!once(key)) return false;
    if (!acting()) { if (!st.done['would:' + key]) { st.done['would:' + key] = now(); record('would', area, 'Would: ' + text); } return false; }
    mark(key);
    try { await fn(); record('act', area, text); delete st.fails[key]; save(); return true; }
    catch (e) {
      // It didn't work: write down why. Try again on a later check (max 3 times), then leave it to you.
      const n = (st.fails[key] || 0) + 1; st.fails[key] = n;
      record('error', area, 'Couldn’t: ' + text.replace(/\.$/, '') + ' (' + (e && e.message || e) + ')' + (n < 3 ? '. Will try again.' : '. Gave up after 3 tries.'));
      if (n < 3) setTimeout(() => { delete st.done[key]; save(); }, 2 * MIN);
      save(); return false;
    }
  }

  // ── Alerts: one per problem, never spam ──
  const alerts = []; let alertSeq = 0; const urgentTimes = [];
  function alert(key, level, text, kind) {
    const prev = st.alerted[key];
    if (prev && prev.text === text && now() - prev.at < 30 * MIN) return;
    if (prev && prev.text === text && level === 'info') return;
    if (level !== 'info') { while (urgentTimes.length && now() - urgentTimes[0] > HOUR) urgentTimes.shift(); if (urgentTimes.length >= 6) level = 'info'; else urgentTimes.push(now()); }
    st.alerted[key] = { text, at: now() }; save();
    alerts.unshift({ id: ++alertSeq, at: now(), level, text, kind: kind || '' }); if (alerts.length > 30) alerts.length = 30;
    hq.changed();
  }

  // ── "Needs Ari": things only you can do. Rebuilt every tick, so fixed problems disappear by themselves. ──
  let needs = new Map(), nextNeeds = new Map();
  function need(key, n) { nextNeeds.set(key, { key, at: (needs.get(key) || {}).at || now(), ...n }); }
  // Problems HQ is already fixing by itself. Shown in the Watchdog tower as "Fixing now", never as "needs you".
  let fixingNow = new Map(), nextFixing = new Map();
  function fixing(key, n) { nextFixing.set(key, { key, at: (fixingNow.get(key) || {}).at || now(), ...n }); }
  // Before HQ changes your app folder, it copies anything that could be lost into hq\backups\<time>\.
  async function backup(why, files) {
    const dst = path.join(dir, 'backups', new Date(now()).toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dst, { recursive: true });
    const d = await git(['diff', 'HEAD']); fs.writeFileSync(path.join(dst, 'changes.diff'), d.out || '');
    for (const f of files || []) { try { const src = path.join(repo(), f); if (fs.existsSync(src)) { const to = path.join(dst, 'files', f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(src, to); } } catch {} }
    fs.writeFileSync(path.join(dst, 'WHY.txt'), why + '\n');
    return dst;
  }

  // ─── Shell helpers ────────────────────────────────────────────────────────
  const GITENV = { ...process.env, GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  function run(cmd, args, opts) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: (opts && opts.timeout) || 60000, windowsHide: true, maxBuffer: 30 * 1024 * 1024, cwd: opts && opts.cwd, env: (opts && opts.env) || GITENV },
        (err, out, errOut) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(errOut || ''), text: String(out || '') + String(errOut || ''), missing: !!(err && err.code === 'ENOENT') }));
    });
  }
  const repo = () => (hq.config().git || {}).mainRepo;
  const mainBranch = () => (hq.config().git || {}).mainBranch || 'main';
  const branches = () => (hq.config().git || {}).branches || {};
  const git = (args, opts) => run('git', ['-C', (opts && opts.cwd) || repo(), ...args], opts);
  const gitv = async (args, opts) => { const r = await git(args, opts); return r.ok ? r.out.trim() : null; };

  // One git job at a time (merges, fixes). A stale lock (HQ crashed) clears after 10 minutes.
  let gitLock = 0;
  async function withGitLock(fn) {
    if (gitLock && now() - gitLock < 10 * MIN) return { busy: true };
    gitLock = now();
    try { return await fn(); } finally { gitLock = 0; }
  }

  // ─── Facts about the repo (read-only) ─────────────────────────────────────
  let lastFetch = 0;
  async function facts() {
    const dirR = repo(); if (!dirR || !fs.existsSync(dirR)) return null;
    if (now() - lastFetch > 60 * 1000) { lastFetch = now(); await git(['fetch', '--quiet', 'origin'], { timeout: 45000 }); }
    const f = { main: mainBranch() };
    f.current = await gitv(['rev-parse', '--abbrev-ref', 'HEAD']);
    f.head = await gitv(['rev-parse', 'HEAD']);
    f.originHead = await gitv(['rev-parse', '--verify', '--quiet', 'origin/' + f.main]);
    f.dirty = ((await gitv(['status', '--porcelain', '--untracked-files=no'])) || '').split('\n').filter(Boolean).map((l) => l.slice(3));
    f.mergeHead = fs.existsSync(path.join(dirR, '.git', 'MERGE_HEAD'));
    f.unmerged = f.mergeHead ? ((await gitv(['diff', '--name-only', '--diff-filter=U'])) || '').split('\n').filter(Boolean) : [];
    if (f.head && f.originHead && f.head !== f.originHead) {
      f.aheadOrigin = Number(await gitv(['rev-list', '--count', 'origin/' + f.main + '..HEAD']) || 0);
      f.behindOrigin = Number(await gitv(['rev-list', '--count', 'HEAD..origin/' + f.main]) || 0);
    } else { f.aheadOrigin = 0; f.behindOrigin = 0; }
    f.leftovers = await markerFiles(dirR);
    f.branches = [];
    for (const [win, br] of Object.entries(branches())) {
      const ref = await bestRef(br); if (!ref) continue;
      const sha = await gitv(['rev-parse', ref]);
      const ahead = Number(await gitv(['rev-list', '--count', 'HEAD..' + ref]) || 0);
      const last = ahead ? await gitv(['log', '-1', '--format=%s', ref]) : '';
      f.branches.push({ window: win, branch: br, ref, sha, ahead, last: last || '' });
    }
    return f;
  }
  // A window's newest work: its local branch, or the GitHub copy if that one is newer.
  async function bestRef(br) {
    const local = await gitv(['rev-parse', '--verify', '--quiet', br]);
    const remote = await gitv(['rev-parse', '--verify', '--quiet', 'origin/' + br]);
    if (local && remote && local !== remote) {
      const remoteNewer = (await git(['merge-base', '--is-ancestor', br, 'origin/' + br])).ok;
      return remoteNewer ? 'origin/' + br : br;
    }
    return local ? br : remote ? 'origin/' + br : null;
  }
  async function markerFiles(cwd) {
    const r = await git(['grep', '-l', '-E', R.MARKER_GREP, '--', '.', ':!node_modules', ':!*.md'], { cwd });
    return r.ok ? r.out.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30) : [];
  }

  // ─── TypeScript check (in any folder) ─────────────────────────────────────
  async function typecheck(cwd) {
    const tsc = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
    if (!fs.existsSync(tsc) || !fs.existsSync(path.join(cwd, 'tsconfig.json'))) return { skipped: true, errors: [] };
    const r = await run('node', [tsc, '--noEmit', '-p', cwd], { cwd, timeout: 6 * MIN, env: process.env });
    if (r.missing) return { skipped: true, errors: [] };
    const errors = R.tscErrors(r.text);
    // tsc crashed or timed out (no error lines, but it failed): don't trust it either way.
    if (!r.ok && !errors.length) return { skipped: true, errors: [], why: r.text.trim().split('\n').pop() };
    return { skipped: false, errors };
  }

  // ─── Safe merge: in a temporary copy, never in your app folder ────────────
  // Returns { ok, sha } or { error: 'conflict'|'markers'|'types'|'dirty'|'busy'|..., files, lines }
  async function safeMerge(item, reason) {
    return withGitLock(async () => {
      const dirR = repo(); const main = mainBranch();
      const f0cur = await gitv(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (f0cur !== main) return { error: 'wrongbranch', text: `Your app folder is on “${f0cur}”, not “${main}”.` };
      const head = await gitv(['rev-parse', 'HEAD']);
      const tmp = path.join(os.tmpdir(), 'hq-merge-' + Date.now().toString(36));
      const tmpBranch = 'hq-merge-tmp';
      const nm = path.join(tmp, 'node_modules');
      let linked = false, worktree = false, ffDone = false;
      try {
        await git(['worktree', 'prune']);
        if (await gitv(['rev-parse', '--verify', '--quiet', tmpBranch])) await git(['branch', '-D', tmpBranch]); // HQ's own scratch branch
        const add = await git(['worktree', 'add', '-q', '-b', tmpBranch, tmp, head], { timeout: 3 * MIN });
        if (!add.ok) return { error: 'git', text: 'Could not make a temporary copy: ' + add.text.trim().split('\n').pop() };
        worktree = true;
        await copyIgnoredSources(dirR, tmp);
        const realNm = path.join(dirR, 'node_modules');
        if (fs.existsSync(realNm)) { try { fs.symlinkSync(realNm, nm, process.platform === 'win32' ? 'junction' : 'dir'); linked = true; } catch {} }
        // What was already broken before this merge (so old problems don't block new work).
        const baseMarkers = await markerFiles(tmp);
        if (!st.tsc[head]) { const t = await typecheck(tmp); st.tsc[head] = { at: now(), skipped: t.skipped, errors: t.errors }; save(); }
        const base = st.tsc[head];
        const m = await git(['merge', '--no-ff', '--no-edit', '-m', `Merge ${item.branch} (${item.window}) via HQ`, item.ref], { cwd: tmp, timeout: 3 * MIN });
        if (!m.ok) {
          const files = ((await gitv(['diff', '--name-only', '--diff-filter=U'], { cwd: tmp })) || '').split('\n').filter(Boolean);
          await git(['merge', '--abort'], { cwd: tmp });
          return files.length ? { error: 'conflict', files } : { error: 'git', text: m.text.trim().split('\n').pop() };
        }
        const after = await markerFiles(tmp);
        const addedMarkers = after.filter((x) => !baseMarkers.includes(x));
        if (addedMarkers.length) return { error: 'markers', files: addedMarkers };
        const t = await typecheck(tmp);
        const added = t.skipped || base.skipped ? [] : R.newErrors(base.errors, t.errors);
        if (added.length) return { error: 'types', lines: added.slice(0, 25) };
        const sha = await gitv(['rev-parse', 'HEAD'], { cwd: tmp });
        if (!t.skipped) { st.tsc[sha] = { at: now(), skipped: false, errors: t.errors }; save(); }
        // Everything passed. Now (and only now) move your app folder forward.
        const ff = await git(['merge', '--ff-only', tmpBranch], { timeout: 3 * MIN });
        if (!ff.ok) {
          const dirty = /would be overwritten|local changes/i.test(ff.text);
          return { error: dirty ? 'dirty' : 'git', files: dirty ? ff.text.split('\n').filter((l) => /^\s+\S/.test(l)).map((l) => l.trim()) : [], text: ff.text.trim().split('\n').pop() };
        }
        ffDone = true;
        return { ok: true, sha, skippedTypes: !!t.skipped };
      } finally {
        // Unlink node_modules FIRST, so deleting the temporary copy can never touch the real one.
        if (linked) { try { fs.unlinkSync(nm); linked = false; } catch { try { fs.rmdirSync(nm); linked = false; } catch {} } }
        if (worktree && !linked) await git(['worktree', 'remove', '--force', tmp], { timeout: 2 * MIN });
        else if (worktree) record('error', 'merge', 'Left a temporary folder behind (safe to delete): ' + tmp);
        await git(['worktree', 'prune']);
        if (await gitv(['rev-parse', '--verify', '--quiet', tmpBranch])) await git(['branch', '-D', tmpBranch]);
        void ffDone; void reason;
      }
    });
  }
  // Files Git ignores but the code needs to type-check (like constants/api.ts or expo-env.d.ts).
  // Copied into the temporary copy so the check sees the same app you run. Never .env or big folders.
  async function copyIgnoredSources(from, to) {
    const r = await git(['ls-files', '-o', '-i', '--exclude-standard', '--', '.', ':!node_modules', ':!ios', ':!android', ':!dist', ':!build', ':!logs', ':!.claude', ':!.git'], { cwd: from });
    if (!r.ok) return 0;
    let n = 0;
    for (const rel of r.out.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (n >= 300 || !/\.(tsx?|jsx?|json|d\.ts)$/.test(rel) || /(^|\/)\.env/.test(rel)) continue;
      const src = path.join(from, rel), dst = path.join(to, rel);
      try { const stt = fs.statSync(src); if (!stt.isFile() || stt.size > 2e6 || fs.existsSync(dst)) continue; fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); n++; } catch {}
    }
    return n;
  }
  async function push() {
    const r = await git(['push', 'origin', mainBranch()], { timeout: 2 * MIN });
    return r.ok ? { ok: true } : { error: r.text.trim().split('\n').pop() };
  }

  // ─── Fingerprint: did the native part of the app change? ──────────────────
  // Same fingerprint as the build on your phone = just reload. Different = a new build is needed.
  let fpRunning = false;
  async function fingerprint() {
    const dirR = repo(); if (!dirR) return null;
    const head = await gitv(['rev-parse', 'HEAD']); if (!head) return null;
    const dirtyNative = ((await gitv(['status', '--porcelain', '--', 'package.json', 'app.json', 'app.config.js', 'app.config.ts', 'ios', 'plugins'])) || '').trim();
    const key = head + (dirtyNative ? ':dirty' : '');
    if (st.fp[key]) return { key, hash: st.fp[key].hash, head };
    if (fpRunning) return null; fpRunning = true;
    try {
      let r; const local = path.join(dirR, 'node_modules', '@expo', 'fingerprint', 'bin', 'cli.js');
      if (fs.existsSync(local)) r = await run('node', [local, dirR], { cwd: dirR, timeout: 4 * MIN, env: process.env });
      else r = await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@expo/fingerprint', dirR], { cwd: dirR, timeout: 6 * MIN, env: process.env });
      let hash = ''; try { hash = JSON.parse(r.out.slice(r.out.indexOf('{'))).hash; } catch {}
      if (!hash) { record('see', 'build', 'Fingerprint check failed: ' + (r.text.trim().split('\n').pop() || '').slice(0, 160)); return { key, hash: '', head, failed: true }; }
      st.fp[key] = { hash, at: now() }; save();
      return { key, hash, head };
    } finally { fpRunning = false; }
  }
  // Changed app.json / app.config plugins count as native even if the fingerprint missed it.
  async function appConfigChanged(fromSha) {
    if (!fromSha) return false;
    const r = await git(['diff', '--quiet', fromSha, 'HEAD', '--', 'app.json', 'app.config.js', 'app.config.ts', 'eas.json']);
    return !r.ok && r.code === 1;
  }

  // ─── Metro (the "npm run dev" server your phone loads the app from) ───────
  function metroStatus() {
    return new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: Number((hq.config().watchdog || {}).metroPort || 8081), path: '/status', timeout: 1500 }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(/packager-status:running|"status"\s*:\s*"running"/.test(b)));
      });
      req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // ─── Sending work to a window ─────────────────────────────────────────────
  // Free window → starts now (headless, safe allowlist). Busy → waits in that window's line.
  function sendJob(preferWin, text, title) {
    const res = hq.sendJob(preferWin, text, title) || {};
    if (res.error || (!res.started && !res.queued)) throw new Error(res.error || 'could not send the job');
    record('see', 'windows', (res.started ? `Started in ${res.started}: ` : `Waiting for ${res.queued}: `) + title);
    return res;
  }
  const branchOf = (win) => branches()[win] || 'your branch';
  const winOfBranch = (br) => Object.keys(branches()).find((w) => branches()[w] === br);

  // ═══ CHECKS ═══════════════════════════════════════════════════════════════

  // 1) Money and safety
  let regCheckedAt = 0, regKey = false;
  async function checkSafety() {
    const envKey = !!process.env.ANTHROPIC_API_KEY;
    if (process.platform === 'win32' && now() - regCheckedAt > 10 * MIN) {
      regCheckedAt = now();
      const a = await run('reg', ['query', 'HKCU\\Environment', '/v', 'ANTHROPIC_API_KEY'], { env: process.env });
      const b = await run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/v', 'ANTHROPIC_API_KEY'], { env: process.env });
      regKey = a.ok || b.ok;
    }
    let settingsKey = false;
    try { const s = JSON.parse(fs.readFileSync(path.join(hq.claudeDir, 'settings.json'), 'utf8')); settingsKey = !!((s.env && s.env.ANTHROPIC_API_KEY) || s.apiKeyHelper); } catch {}
    if (envKey || regKey || settingsKey) {
      need('apikey', { level: 'urgent', title: 'An Anthropic API key is on this PC', text: 'With it, Claude Code charges money per use instead of using your plan. HQ never uses it, but your windows might.',
        steps: settingsKey ? ['Open C:\\Users\\arize\\.claude\\settings.json and delete the ANTHROPIC_API_KEY (or apiKeyHelper) line.'] : ['Press Start, type “environment”, open “Edit environment variables for your account”.', 'Click ANTHROPIC_API_KEY → Delete → OK.', 'Restart VS Code and HQ.'] });
      alert('apikey', 'urgent', 'Warning: an Anthropic API key is on this PC. It can cost money. Open the Watchdog.');
    }
  }
  // Shown every tick while paused (checked at the END of a tick, so a pause that started this tick shows right away).
  function pausedNeed() {
    if (st.paused && now() < st.paused.until) need('paused', { level: 'urgent', title: 'Watchdog is paused', text: st.paused.why, button: { label: 'Turn it back on', action: 'unpause' } });
    else if (st.paused) { st.paused = null; save(); record('act', 'safety', 'Pause ended. Watching again.'); }
  }

  // 2) Safety guards inside each window's folder (once, then every 6 hours)
  async function checkGuards() {
    if (!cfg().guards) return;
    for (const [folder, name] of Object.entries(hq.config().windows || {})) {
      const cwd = path.join(hq.home, folder);
      if (!fs.existsSync(path.join(cwd, '.git')) || (st.guards[folder] && now() - st.guards[folder] < 6 * HOUR)) continue;
      const did = [];
      // a) Deny rules: windows can't force-push, reset, delete, or start builds.
      try {
        const fp = path.join(cwd, '.claude', 'settings.local.json');
        let s = {}; if (fs.existsSync(fp)) s = JSON.parse(fs.readFileSync(fp, 'utf8'));
        s.permissions = s.permissions || {}; const deny = Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
        const add = R.JOB_DENY.filter((d) => !deny.includes(d) && !/overnight-build|main\*|master\*/.test(d));
        if (add.length) { s.permissions.deny = deny.concat(add); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(s, null, 2)); did.push(add.length + ' safety rules'); }
        const ex = path.join(cwd, '.git', 'info', 'exclude');
        if (fs.existsSync(path.dirname(ex))) { const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : ''; if (!cur.includes('.claude/settings.local.json')) fs.appendFileSync(ex, '\n.claude/settings.local.json\n'); }
      } catch (e) { record('error', 'guards', `${name}: couldn't add safety rules (${e.message}). Your settings file was left alone.`); }
      // b) A Git check that blocks commits with merge-conflict leftovers.
      try {
        const hooksDir = (await gitv(['rev-parse', '--git-path', 'hooks'], { cwd })) || '.git/hooks';
        const hp = path.isAbsolute(hooksDir) ? path.join(hooksDir, 'pre-commit') : path.join(cwd, hooksDir, 'pre-commit');
        const ours = fs.existsSync(hp) && fs.readFileSync(hp, 'utf8').includes('Added by HQ');
        if (!fs.existsSync(hp)) {
          fs.mkdirSync(path.dirname(hp), { recursive: true });
          fs.writeFileSync(hp, '#!/bin/sh\n# Added by HQ: blocks commits that still have merge-conflict leftovers (<<<<<<< or >>>>>>>).\nbad=$(git diff --cached -U0 --diff-filter=ACM -- . ":(exclude)*.md" | grep -E "^\\+(<<<<<<<|>>>>>>>)( |$)")\nif [ -n "$bad" ]; then\n  echo "HQ blocked this commit: it still has merge-conflict lines:"\n  echo "$bad" | head -5\n  exit 1\nfi\nexit 0\n');
          try { fs.chmodSync(hp, 0o755); } catch {}
          did.push('conflict-line check');
        } else if (!ours && !st.done['guardnote:' + folder]) { mark('guardnote:' + folder); record('see', 'guards', `${name} already has its own pre-commit hook, so HQ left it alone.`); }
      } catch (e) { record('error', 'guards', `${name}: couldn't add the conflict check (${e.message}).`); }
      st.guards[folder] = now(); save();
      if (did.length) record('act', 'guards', `Safety setup for ${name}: added ${did.join(' and ')}.`);
    }
  }

  // 3) Windows: limit, waiting for you, stuck, errors
  async function checkWindows(f) {
    const usage = hq.usage() || {};
    for (const s of hq.sessions()) {
      const win = hq.windowName(s.cwd);
      if (!/^window\s+[a-z]$/i.test(win)) continue;
      const runner = hq.isRunner(win);
      // a) Usage limit
      if (s.status === 'limit' && s.limitHit) {
        if (s.limitHit.weekly) {
          if (!st.paused || st.paused.until < s.limitHit.resumeAt) { st.paused = { until: s.limitHit.resumeAt || now() + 24 * HOUR, why: 'Your weekly Claude limit is used up. Everything waits until it resets ' + new Date(s.limitHit.resumeAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '.' }; save(); record('act', 'windows', 'Weekly limit: paused all automatic jobs.'); alert('weekly', 'urgent', 'Weekly Claude limit hit. HQ is waiting until it resets.'); }
          continue;
        }
        const resumeAt = (s.limitHit.resumeAt || 0) + 2 * MIN;
        if (now() < resumeAt || usage.hit) continue;
        // Claude Code may continue by itself after the reset. If it already did, don't send a second "continue".
        if ((s.lastPromptAt || 0) > s.limitHit.at || (s.autoResumedAt || 0) > s.limitHit.at) { hq.clearLimit(s); record('see', 'windows', `${win} continued by itself after the limit.`); continue; }
        if (!budget('resume:' + win, 3, HOUR)) { need('resume:' + win, { level: 'warn', title: win + ' keeps hitting the limit', text: 'HQ restarted it 3 times this hour. It will wait for you now.' }); continue; }
        await act('windows', 'resume:' + s.id + ':' + s.limitHit.at, `${win}: the limit reset, so it continues its job.`, async () => {
          spend('resume:' + win); hq.clearLimit(s);
          hq.startJob(win, 'Claude’s usage limit has reset. Continue exactly where you stopped and finish the job from my last message. Same rules as before.', s, s.title || 'Continue after the limit');
        });
        continue;
      }
      // b) Billing / login problems: stop everything
      if (s.status === 'error' && /billing|authentication|auth/i.test(s.errorType || '')) {
        if (!st.paused) { st.paused = { until: now() + 24 * HOUR, why: `${win} says Claude has a ${/billing/i.test(s.errorType) ? 'billing' : 'login'} problem. HQ paused all automatic jobs. Open VS Code and check you're signed in.` }; save(); record('act', 'safety', 'Paused: ' + st.paused.why); alert('auth', 'urgent', 'Claude has a login or billing problem. HQ paused itself.'); }
        continue;
      }
      // c) API hiccup (overloaded / server error): continue after 1, 4, then 15 minutes. Then ask you.
      if (s.status === 'error' && s.errorAt) {
        const n = (s.errorRetries || 0); const wait = [1, 4, 15][n];
        if (wait === undefined) { need('apierr:' + win, { level: 'warn', title: win + ' stopped with a Claude error', text: 'It failed 3 times (' + (s.errorType || 'error') + '). Open it in VS Code and type “continue”.' }); continue; }
        if (now() - s.errorAt < wait * MIN || usage.hit) continue;
        await act('windows', 'apierr:' + s.id + ':' + s.errorAt + ':' + n, `${win}: Claude had a hiccup (${s.errorType || 'error'}). Continuing (try ${n + 1} of 3).`, async () => {
          s.errorRetries = n + 1; s.errorAt = now();
          hq.startJob(win, 'Claude had a temporary error. Continue exactly where you stopped and finish the job.', s, s.title || 'Continue after an error');
        });
        continue;
      }
      // d) Waiting for your OK
      if (s.status === 'needs-you') {
        const since = s.permAt || s.lastEvent;
        alert('perm:' + s.id + ':' + since, 'warn', `${win} is waiting for your OK: ${String(s.doing || '').replace(/^Wants to: /, '').slice(0, 90)}`);
        need('perm:' + win, { level: 'warn', title: win + ' is waiting for your OK', text: String(s.doing || 'It asked something in VS Code.') + ' Answer it in VS Code.' });
        if (now() - since > 5 * MIN) alert('perm2:' + s.id + ':' + since, 'urgent', `${win} has been waiting for you for 5 minutes.`);
        continue;
      }
      // e) Stuck: "working" but nothing happened for a while
      if (s.status === 'working') {
        const quiet = now() - Math.max(s.lastEvent || 0, s.lastFileAt || 0);
        const longTool = s.inTool && /Bash|PowerShell/i.test(s.inToolName || '');
        const limitMin = cfg().stuckMinutes * (longTool ? 2 : 1);
        if (quiet < limitMin * MIN) continue;
        if (runner && quiet > 2 * limitMin * MIN) {
          if (!budget('restart:' + win, 3, HOUR)) { need('stuck:' + win, { level: 'warn', title: win + ' keeps getting stuck', text: 'HQ restarted it 3 times this hour. Check it in VS Code.' }); continue; }
          await act('windows', 'restart:' + s.id + ':' + Math.floor((s.lastEvent || 0) / MIN), `${win} was stuck for ${Math.round(quiet / MIN)} minutes. Stopping it and telling it to continue.`, async () => {
            spend('restart:' + win); await hq.stopRunner(win);
            setTimeout(() => hq.startJob(win, 'You seemed stuck, so HQ stopped the last step. Continue the job from where you were. If a command hangs, try a different way.', s, s.title || 'Continue after being stuck'), 3000);
          });
        } else if (!runner) {
          alert('stuck:' + s.id + ':' + Math.floor((s.lastEvent || 0) / (10 * MIN)), 'warn', `${win} hasn't done anything for ${Math.round(quiet / MIN)} minutes. Check it in VS Code.`);
          need('stuck:' + win, { level: 'warn', title: win + ' looks stuck', text: `Nothing happened for ${Math.round(quiet / MIN)} minutes. Look at it in VS Code. If it’s waiting, press Esc and type “continue”.` });
        }
      }
      // f) A job HQ started crashed (not the limit)
      if (s.status === 'done' && s.crashedAt && !s.crashHandled) {
        s.crashHandled = true;
        if (budget('crash:' + win, 1, HOUR)) await act('windows', 'crash:' + s.id + ':' + s.crashedAt, `${win}'s job stopped with an error. Asking it to continue once.`, async () => { spend('crash:' + win); hq.startJob(win, 'Your last run stopped with an error: ' + (s.crashWhy || '') + '\nContinue the job. If the same thing fails again, explain it in plain words and stop.', s, s.title || 'Continue after an error'); });
        else need('crash:' + win, { level: 'warn', title: win + '’s job stopped with an error', text: s.crashWhy || 'Open it in VS Code to see why.' });
      }
    }
    void f;
  }

  // 4) Git: keep your app folder up to date, safely
  let mergeView = { list: [], stuck: false, conflicts: [], leftovers: [], text: '' };
  async function checkGit(f) {
    if (!f) { mergeView = { list: [], stuck: false, conflicts: [], leftovers: [], text: 'No app folder set' }; return; }
    mergeView = { list: f.branches.map((b) => ({ window: b.window, branch: b.branch, ahead: b.ahead, last: b.last })), stuck: f.mergeHead, conflicts: f.unmerged, leftovers: f.leftovers, dirty: f.dirty, current: f.current, lastMerge: st.lastMerge };
    if (f.current !== f.main && !f.mergeHead) {
      if (!f.dirty.length && f.current !== 'HEAD') {
        fixing('wrongbranch', { title: 'Switching your app folder back to ' + f.main, text: `It was on “${f.current}”.` });
        await act('merge', 'switch:' + f.current + ':' + f.head, `Your app folder was on “${f.current}”. Switched it back to “${f.main}” (nothing was lost: “${f.current}” still exists).`, async () => {
          const r = await withGitLock(() => git(['switch', f.main])); if (!r || r.ok === false) throw new Error((r && r.text.trim().split('\n').pop()) || 'git switch failed');
        });
      } else need('wrongbranch', { level: 'warn', title: 'Your app folder is on the wrong branch', text: `It’s on “${f.current}” and has unsaved changes, so HQ won’t switch it by itself. Paste this in the Terminal (Pulse):`, code: `git stash push -m "saved by Ari"\ngit switch ${f.main}` });
      return;
    }
    // A half-done merge that someone started by hand.
    if (f.mergeHead) {
      const left = f.unmerged.length ? [] : await markerFiles(repo());
      if (!f.unmerged.length && !left.length) {
        await act('merge', 'finishmerge:' + f.head, 'Finished a half-done merge in your app folder (it had no conflicts).', async () => { const r = await withGitLock(() => git(['commit', '--no-edit'])); if (!r || r.ok === false) throw new Error('git commit failed'); });
        return;
      }
      // Is the other side of the merge safe on a branch? Then undoing loses nothing.
      const mh = ((await gitv(['rev-parse', 'MERGE_HEAD'])) || '').trim();
      let safe = false;
      for (const ref of Object.values(branches()).flatMap((b) => [b, 'origin/' + b]).concat(['origin/' + f.main])) { if (mh && (await git(['merge-base', '--is-ancestor', mh, ref])).ok) { safe = true; break; } }
      if (safe) {
        fixing('halfmerge', { title: 'Undoing a half-done merge', text: 'It had conflicts. All the work is still on the windows’ branches, so HQ undoes it and merges again the safe way.' });
        await act('merge', 'abort:' + mh + ':' + f.head, 'Undid a half-done merge in your app folder (conflicts in ' + (f.unmerged.length ? f.unmerged.map(short).join(', ') : left.map(short).join(', ')) + '). Nothing was lost: it\u2019s all on the windows’ branches, and a backup is in hq\\backups.', async () => {
          await backup('A half-done merge with conflicts was undone by the Watchdog.', f.unmerged.concat(left));
          const r = await withGitLock(() => git(['merge', '--abort'])); if (!r || r.ok === false) throw new Error((r && r.text.trim().split('\n').pop()) || 'git merge --abort failed');
        });
      } else need('halfmerge', { level: 'warn', title: 'A half-done merge is in your app folder', text: 'HQ can’t find the other side of this merge on any branch, so undoing it could lose work. HQ won’t guess.', button: { label: 'Undo it anyway (makes a backup first)', action: 'abortmerge' } });
      return;
    }
    // Your app folder is behind GitHub (someone pushed): catch up if it's a simple fast-forward.
    if (f.behindOrigin && !f.aheadOrigin) {
      await act('merge', 'pull:' + f.originHead, 'Your app folder was behind GitHub. Brought it up to date.', async () => {
        const r = await withGitLock(() => git(['merge', '--ff-only', 'origin/' + f.main]));
        if (r && r.ok === false) need('pull', { level: 'warn', title: 'Couldn’t update your app folder', text: r.text.trim().split('\n').pop() });
      });
    } else if (f.behindOrigin && f.aheadOrigin) {
      fixing('diverged', { title: 'Joining your app folder with GitHub', text: `Your folder has ${f.aheadOrigin} change(s) GitHub doesn’t, and GitHub has ${f.behindOrigin}. HQ joins them the safe way.` });
      const key = 'diverge:' + f.head + ':' + f.originHead;
      if (once(key)) {
        if (!acting()) await act('merge', key, 'Join your app folder with GitHub.', async () => {});
        else {
          mark(key);
          const r = await safeMerge({ window: 'GitHub', branch: 'origin/' + f.main, ref: 'origin/' + f.main, sha: f.originHead }, 'diverged');
          if (r.ok) { const p = await withGitLock(push); record('act', 'merge', 'Joined your app folder with GitHub' + (p && p.error ? ' (push failed: ' + p.error + ')' : ' and pushed it') + '.'); }
          else if (!r.busy) need('diverged', { level: 'warn', title: 'Your app folder and GitHub clash', text: (r.error === 'conflict' ? 'Both changed ' + (r.files || []).map(short).join(', ') + '. ' : '') + 'Ask Window A: “merge origin/' + f.main + ' into ' + f.main + ' carefully, keep both sides, and push”.' });
          else delete st.done[key];
        }
      }
    }
    else if (f.aheadOrigin) {
      if (budget('push', 3, HOUR)) await act('merge', 'push:' + f.head, 'Pushed your app folder to GitHub.', async () => { spend('push'); const p = await withGitLock(push); if (p && p.error) record('error', 'merge', 'Push failed: ' + p.error); });
    }
    // Broken leftovers already in your app: ask Window A to fix them on its branch.
    if (f.leftovers.length) {
      const key = 'leftover:' + f.head;
      fixing('leftover', { title: 'Fixing broken merge lines', text: 'Your app won’t open until ' + f.leftovers.map(short).join(', ') + ' is fixed. Window A is fixing it; HQ merges the fix by itself.' });
      const win = Object.keys(branches())[0];
      if (win && budget('leftoverfix', 2, 6 * HOUR)) await act('merge', key, `Asked ${win} to fix the broken merge lines in ${f.leftovers.map(short).join(', ')}.`, async () => {
        spend('leftoverfix');
        sendJob(win, `Your app's ${f.main} branch has merge-conflict leftovers (lines starting with <<<<<<<, ======= or >>>>>>>) in: ${f.leftovers.join(', ')}. They break the app.\n\n1. Merge origin/${f.main} into your branch (${branchOf(win)}).\n2. In each of those files, combine BOTH sides correctly so nobody's work is lost. Remove every conflict line.\n3. Run npx tsc --noEmit.\n4. Commit "Fix leftover merge conflicts" and push your branch. HQ merges it into the app.` + R.jobRules(branchOf(win)), 'Fix broken merge lines');
      });
    }
    // Merge each window's finished work (only when that window isn't in the middle of a job).
    for (const b of f.branches) {
      if (!b.ahead) continue;
      const s = hq.sessionByWindow(b.window);
      if (s && (s.status === 'working' || s.status === 'needs-you')) { record('see', 'merge', `${b.window} has new work but is still busy. Merging when it’s done.`); continue; }
      const key = 'merge:' + f.head + ':' + b.sha;
      if (!once(key) || breakerOpen('merge')) continue;
      if (!acting()) { await act('merge', key, `Merge ${b.window}'s ${b.ahead} new change(s) into your app.`, async () => {}); continue; }
      mark(key);
      record('act', 'merge', `Merging ${b.window}’s ${b.ahead} new change(s) in a safe copy…`);
      const r = await safeMerge(b, 'auto');
      if (r.busy) { delete st.done[key]; continue; }
      await afterMerge(b, r, f);
      if (!r.ok) break; // one problem at a time
    }
  }
  const short = (p) => String(p).replace(/\\/g, '/').split('/').pop();
  async function afterMerge(b, r, f) {
    if (r.ok) {
      breakerOk('merge');
      const p = await push();
      st.lastMerge = { at: now(), window: b.window, sha: r.sha, text: `${b.window}: ${b.last || b.ahead + ' change(s)'}`, pushed: !p.error }; save();
      record('act', 'merge', `Merged ${b.window}’s work into your app${p.error ? ' (push failed: ' + p.error + ', will retry)' : ' and pushed it'}.${r.skippedTypes ? ' (TypeScript check skipped: not installed.)' : ' Type check passed.'}`);
      st.ready = { at: now(), sha: r.sha, from: b.window }; save();
      return;
    }
    const win = b.window, br = b.branch;
    if (r.error === 'conflict') {
      breakerFail('merge', 'conflict');
      const k = 'conflictfix:' + b.sha; // ask once per version of that window's work
      record('see', 'merge', `${win}’s work conflicts with your app in ${r.files.map(short).join(', ')}. Your app folder was not touched.`);
      if (budget('conflict:' + br, 2, 12 * HOUR)) await act('merge', k, `Asked ${win} to combine its work with the app (conflict in ${r.files.map(short).join(', ')}).`, async () => {
        spend('conflict:' + br);
        sendJob(win, `HQ tried to merge your branch (${br}) into the app (${f.main}) and Git found a conflict in: ${r.files.join(', ')}. The other window changed the same lines.\n\n1. Run git fetch, then merge origin/${f.main} into ${br}.\n2. In each conflicted file, combine BOTH sides so nobody's work is lost. Remove every conflict line.\n3. Run npx tsc --noEmit.\n4. Commit the merge and push ${br}. HQ merges it into the app after that.` + R.jobRules(br), 'Combine work after a conflict');
      });
      else need('conflict:' + br, { level: 'warn', title: `${win}’s work keeps conflicting`, text: `HQ asked twice. Conflict in ${r.files.map(short).join(', ')}. Open ${win} in VS Code and ask it to merge origin/${f.main} into ${br} carefully.` });
    } else if (r.error === 'markers') {
      breakerFail('merge', 'markers');
      if (budget('markers:' + br, 2, 12 * HOUR)) await act('merge', 'markerfix:' + b.sha, `${win}’s branch has merge-conflict lines in ${r.files.map(short).join(', ')}. Blocked it and asked ${win} to fix them.`, async () => {
        spend('markers:' + br);
        sendJob(win, `Your branch (${br}) has merge-conflict leftovers (<<<<<<< / >>>>>>> lines) in: ${r.files.join(', ')}. HQ refused to merge it, because they break the app. Combine both sides correctly, remove the conflict lines, run npx tsc --noEmit, commit and push.` + R.jobRules(br), 'Fix conflict lines on your branch');
      });
      else need('markers:' + br, { level: 'warn', title: `${win}’s branch has conflict lines`, text: r.files.map(short).join(', ') });
    } else if (r.error === 'types') {
      breakerFail('merge', 'types');
      if (budget('types:' + br, 2, 12 * HOUR)) await act('merge', 'typefix:' + b.sha, `${win}’s work would add ${r.lines.length} new code error(s). Blocked it and sent the errors to ${win}.`, async () => {
        spend('types:' + br);
        sendJob(win, `HQ test-merged your branch (${br}) into the app and TypeScript found NEW errors that aren't in the app yet:\n\n${r.lines.join('\n')}\n\nFix them on your branch (merge origin/${f.main} first if the error comes from combining both windows' work). Run npx tsc --noEmit until these are gone, then commit and push.` + R.jobRules(br), 'Fix new code errors');
      });
      else need('types:' + br, { level: 'warn', title: `${win}’s work has code errors`, text: r.lines.slice(0, 3).join('\n') });
    } else if (r.error === 'dirty') {
      // Unsaved edits in the app folder block the update. Put them aside (git stash = nothing is lost), then merge.
      const files = (r.files || []).map(short).join(', ');
      if (budget('stash', 2, 6 * HOUR)) {
        const ok = await act('merge', 'stash:' + f.head + ':' + b.sha, `Your app folder had unsaved changes (${files}) in the way. Put them aside safely (git stash; get them back with “git stash pop”) and merged.`, async () => {
          spend('stash'); await backup('Unsaved changes were put aside (git stash) so new work could be merged.', r.files || []);
          const st2 = await withGitLock(() => git(['stash', 'push', '-m', 'HQ put these aside before merging ' + new Date(now()).toLocaleString()]));
          if (!st2 || st2.ok === false) throw new Error((st2 && st2.text.trim().split('\n').pop()) || 'git stash failed');
        });
        delete st.done['merge:' + f.head + ':' + b.sha]; // merge again on the next check
        if (!ok) need('dirty', { level: 'warn', title: 'Your app folder has unsaved changes', text: 'HQ couldn’t put them aside: ' + files });
      } else need('dirty', { level: 'warn', title: 'Your app folder keeps getting unsaved changes', text: files + '. Something is editing files in your app folder directly. Ask a window what they are.' });
    } else if (r.error === 'wrongbranch') {
      need('wrongbranch', { level: 'warn', title: 'Your app folder is on the wrong branch', text: r.text });
    } else {
      breakerFail('merge', r.error);
      need('mergeerr', { level: 'warn', title: 'Merge stopped', text: r.text || r.error });
    }
  }

  // 5) Builds: only when the native part changed, max 1 automatic build per commit
  async function checkBuilds(f) {
    const runs = hq.runs() || [];
    const B = st.build;
    // a) Watch finished runs. (The first time, old runs are just remembered, not acted on.)
    if (!B.init && runs.length) { for (const run of runs) if (run.st !== 'running') B.seenRuns[run.id] = now(); B.init = true; save(); }
    // Explain the newest failed build even if it happened before HQ started (explain only, no action).
    const newest = runs.find((x) => x.st !== 'running');
    if (newest && newest.st === 'failed' && (newest.fail.length || newest.raw) && (!B.lastFail || B.lastFail.id !== newest.id)) {
      const cls = R.classifyBuild((newest.raw || '') + '\n' + newest.fail.join('\n') + '\n' + newest.note);
      B.lastFail = { id: newest.id, cls: cls.id, at: newest.at, title: cls.title, plain: cls.plain, steps: cls.steps || [], lines: newest.fail.slice(0, 8), who: cls.human ? 'you' : 'window',
        doing: cls.human ? 'Only you or Dad can fix this. HQ won\u2019t retry it (it would fail the same way).' : 'HQ sends the next failure like this to a window to fix by itself. For this older one, press \u201cSee the error\u201d.' }; save();
    }
    if (B.lastFail && B.lastFail.who === 'you') need('buildhuman:' + (B.lastFail.cls || B.lastFail.title), { level: 'urgent', title: B.lastFail.title, text: B.lastFail.plain, steps: B.lastFail.steps, lines: B.lastFail.lines });
    for (const run of runs) {
      if (run.st === 'running' || B.seenRuns[run.id]) continue;
      if (run.st === 'failed' && !run.raw && !run.fail.length) continue; // still reading the log
      B.seenRuns[run.id] = now(); save();
      const rec = run.sha && B.records[run.sha];
      if (run.st === 'done') {
        breakerOk('build'); if (B.lastFail && (B.lastFail.at || 0) < (run.at || 0)) { B.lastFail = null; save(); }
        if (rec && rec.fp) { B.good = { sha: run.sha, fp: rec.fp, at: now() }; save(); }
        else if (f && run.sha === f.head) { const fp = await fingerprint(); if (fp && fp.hash) { B.good = { sha: run.sha, fp: fp.hash, at: now() }; save(); } }
        if (now() - (run.at || 0) < 2 * HOUR) { record('act', 'build', 'A new iOS build finished. Install it on your phone.'); alert('built:' + run.id, 'warn', 'Your new iOS build is ready. Install it on your phone.', 'built'); }
        continue;
      }
      // Failed
      if (now() - (run.at || 0) > 6 * HOUR) continue; // old news
      breakerFail('build', run.note);
      const cls = R.classifyBuild((run.raw || '') + '\n' + run.fail.join('\n') + '\n' + run.note);
      record('see', 'build', `Build failed: ${cls.title}.`);
      B.lastFail = { id: run.id, cls: cls.id, at: run.at, title: cls.title, plain: cls.plain, steps: cls.steps || [], lines: run.fail.slice(0, 8),
        who: cls.human ? 'you' : cls.retry ? 'retry' : 'window', doing: cls.human ? 'Only you or Dad can fix this. HQ won\u2019t retry it (it would fail the same way).' : cls.retry ? 'HQ is trying once more.' : 'HQ sent it to a window to fix. It builds again by itself after the fix is merged.' }; save();
      if (cls.human) {
        need('buildhuman:' + cls.id, { level: 'urgent', title: cls.title, text: cls.plain, steps: cls.steps, lines: run.fail.slice(0, 6) });
        alert('buildfail:' + run.id, 'urgent', 'The build failed: ' + cls.title + '. Only you or Dad can fix this one. Open the Watchdog.');
      } else if (cls.retry) {
        if (run.sha && once('retry:' + run.sha) && budget('autobuild', cfg().maxAutoBuildsPerDay, 24 * HOUR) && !breakerOpen('build')) {
          await act('build', 'retry:' + run.sha, 'The build failed because of a GitHub/network hiccup. Trying once more.', async () => { spend('autobuild'); await startBuild('Retry after a hiccup'); });
        } else need('buildfail', { level: 'warn', title: 'Build failed (hiccup) again', text: 'HQ already retried once. Press Build in the Factory to try again.' });
      } else {
        alert('buildfail:' + run.id, 'warn', 'The build failed: ' + cls.title + '. HQ is getting it fixed.');
        await fixBuild(run, cls);
      }
    }
    // b) Should a new build start by itself?
    if (!f || f.current !== f.main) return;
    const fp = await fingerprint(); if (!fp || !fp.hash) return;
    if (!B.good) { B.good = { sha: f.head, fp: fp.hash, at: now(), assumed: true }; B.installed = f.head; save(); record('act', 'build', 'Remembered the current app as matching the build on your phone. If that’s wrong, press Build.'); }
    const native = fp.hash !== B.good.fp || (await appConfigChanged(B.good.sha));
    B.needBuild = native; B.fpNow = fp.hash;
    if (!native) return;
    const running = runs.some((x) => x.st === 'running');
    if (running || B.records[f.head]) return;
    if (f.aheadOrigin || f.dirty.length) return; // build exactly what's on GitHub
    const tc = st.tsc[f.head];
    if (tc && tc.errors && tc.errors.length && !tc.skipped) {
      const parent = (await gitv(['rev-parse', 'HEAD~1'])) || '';
      const pt = st.tsc[parent];
      if (!pt || R.newErrors(pt.errors, tc.errors).length) { fixing('typesbeforebuild', { title: 'Waiting for a code fix before building', text: 'HQ won’t waste a build on broken code. A window is fixing it.' }); return; }
    }
    if (breakerOpen('build')) { need('buildbreaker', { level: 'warn', title: 'Automatic builds are resting', text: '3 builds failed in a row. Fix the problem in the Factory, then press Build.' }); return; }
    if (!budget('autobuild', cfg().maxAutoBuildsPerDay, 24 * HOUR)) { need('buildcap', { level: 'info', title: 'Daily build limit reached', text: `HQ started ${cfg().maxAutoBuildsPerDay} builds today. Press Build if you really need another.` }); return; }
    await act('build', 'autobuild:' + f.head, 'The native part of the app changed, so a new iOS build is needed. Starting it.', async () => { spend('autobuild'); await startBuild('Native code changed'); });
  }
  async function startBuild(why) {
    const headNow = await gitv(['rev-parse', 'HEAD']);
    const r = await hq.startBuild(); // start first: the fingerprint can take a minute and you shouldn't wait for it
    if (r && r.started) {
      st.build.records[headNow] = { at: now(), fp: (st.fp[headNow] || {}).hash || null, why }; save();
      record('act', 'build', 'Started an iOS build (' + why + ').');
      if (!st.build.records[headNow].fp) fingerprint().then((fp) => { if (fp && fp.hash && fp.head === headNow && st.build.records[headNow]) { st.build.records[headNow].fp = fp.hash; save(); } }).catch(() => {});
    } else record('error', 'build', 'Couldn’t start the build: ' + ((r && r.error) || 'unknown'));
    return r;
  }
  async function fixBuild(run, cls) {
    const key = 'buildfix:' + run.id;
    if (!once(key)) return;
    if (!budget('buildfix:' + (run.sha || 'x'), 2, 24 * HOUR)) { need('buildfix', { level: 'warn', title: 'Build keeps failing', text: 'HQ asked a window to fix it twice. Look at the Factory.', lines: run.fail.slice(0, 6) }); return; }
    let diagnosis = '';
    if (cls.id === 'unknown' && hq.canAskClaude()) {
      // Unknown error: ask Claude (your plan, read-only) what it is. It only suggests; rules decide.
      const d = await hq.askClaudeJSON(`An iOS build of an Expo app failed on GitHub Actions. Here are the failed log lines:\n\n${(run.raw || run.fail.join('\n')).slice(-12000)}\n\nAnswer with ONLY JSON: {"cause":"one plain sentence","needs_human":true|false,"human_steps":["..."],"fix_prompt":"a prompt for a coding agent that will fix it in the code, or empty"}. needs_human = true if the fix is on the Apple Developer website, App Store Connect, GitHub secrets or anything outside the code.`, { cwd: repo(), maxTurns: 12 });
      if (d && d.ok && d.json) {
        record('act', 'build', 'Asked Claude what the unknown build error is: ' + String(d.json.cause || '').slice(0, 200));
        if (d.json.needs_human) { need('buildhuman:unknown', { level: 'urgent', title: 'Build needs you', text: String(d.json.cause || ''), steps: (d.json.human_steps || []).slice(0, 6), lines: run.fail.slice(0, 6) }); mark(key); return; }
        diagnosis = String(d.json.fix_prompt || d.json.cause || '');
      }
    }
    const win = (hq.freeWindow() || Object.keys(branches())[0]);
    await act('build', key, `Sent the build error to ${win} to fix (${cls.title}). HQ rebuilds after the fix is merged.`, async () => {
      spend('buildfix:' + (run.sha || 'x'));
      sendJob(win, `The iOS build on GitHub failed (${cls.title}).${diagnosis ? '\n\nWhat it probably is: ' + diagnosis : ''}\n\nThe error lines:\n${(run.fail.length ? run.fail : String(run.raw || '').split('\n').slice(-40)).join('\n')}\n\nFind the cause in the code and fix it on your branch. If the fix is NOT in the code (Apple website, GitHub secrets), don't change anything; explain what Ari must do in plain words.` + R.jobRules(branchOf(win)), 'Fix the failed build');
    });
  }

  // 6) Is the app on your phone up to date? (feeds Test Lab)
  let phone = { metro: false, text: '', ready: false };
  async function checkPhone(f) {
    const metro = await metroStatus();
    const B = st.build;
    const buildRunning = (hq.runs() || []).some((x) => x.st === 'running');
    let text, ready = false, step = '';
    if (!f) text = 'HQ can’t find your app folder.';
    else if (f.leftovers.length) { text = 'Your app is broken (merge leftovers). HQ is getting it fixed.'; step = 'wait'; }
    else if (f.branches.some((x) => x.ahead)) { text = 'New work is waiting to be merged.'; step = 'wait'; }
    else if (B.needBuild && buildRunning) { text = 'The native part changed. A new build is being made. Wait for it.'; step = 'wait'; }
    else if (B.needBuild) { text = 'The native part changed. A new iOS build is needed.'; step = 'build'; }
    else if (B.good && B.installed !== B.good.sha && !B.good.assumed) { text = 'A new build is ready. Install it on your phone first.'; step = 'install'; }
    else if (!metro) { text = 'Start the app server: open PowerShell in your app folder and run npm run dev.'; step = 'metro'; }
    else { text = 'Ready. On your phone, shake → Reload, then test.'; ready = true; step = 'ready'; }
    phone = { metro, text, ready, step, head: f && f.head, lastMerge: st.lastMerge };
    // A new version just landed and everything is ready: tell Ari (once per version).
    if (ready && st.ready && st.ready.sha && st.ready.sha === (f && f.head) && once('readytest:' + st.ready.sha)) {
      mark('readytest:' + st.ready.sha);
      alert('ready:' + st.ready.sha, 'warn', 'New version ready. Reload the app on your phone and test it.', 'ready');
    }
  }

  // 7) Jobs waiting for a free window
  function checkQueue() { hq.dispatchQueue(); }

  // 8) HQ itself is alive (a tiny file other tools can check)
  function heartbeat() { try { fs.writeFileSync(path.join(dir, 'watchdog-heartbeat.json'), JSON.stringify({ at: now(), pid: process.pid })); } catch {} }

  // ═══ THE LOOP ═════════════════════════════════════════════════════════════
  let running = false, lastTick = 0, lastGuards = 0, lastFacts = null, tickErr = '';
  const areaOk = {};
  async function tick() {
    if (running) return; running = true; lastTick = now(); nextNeeds = new Map(); nextFixing = new Map();
    const step = async (name, fn) => { try { await fn(); areaOk[name] = { ok: true, at: now() }; } catch (e) { areaOk[name] = { ok: false, at: now(), err: String(e && e.message || e) }; record('error', name, 'Check crashed: ' + (e && e.message || e)); } };
    try {
      await step('safety', checkSafety);
      if (now() - lastGuards > 30 * MIN) { lastGuards = now(); await step('guards', checkGuards); }
      let f = null; await step('facts', async () => { f = await facts(); lastFacts = f; });
      await step('windows', () => checkWindows(f));
      await step('queue', checkQueue);
      await step('merge', () => checkGit(f));
      if (f) { const f2 = await facts().catch(() => f); f = f2 || f; lastFacts = f; }
      await step('build', () => checkBuilds(f));
      await step('phone', () => checkPhone(f));
      pausedNeed(); heartbeat(); prune();
      tickErr = '';
    } catch (e) { tickErr = String(e && e.message || e); }
    finally { needs = nextNeeds; fixingNow = nextFixing; running = false; hq.changed(); }
  }
  let timer = null;
  function start() { if (timer) return; setTimeout(tick, 4000); timer = setInterval(tick, cfg().tickSeconds * 1000); }
  function stop() { clearInterval(timer); timer = null; }

  // ── Hooks: auto-approve tiny safe commands ──
  function permission(ev) {
    if (!cfg().autoApprove || !acting()) return null;
    if (R.safeToApprove(ev.tool_name, ev.tool_input, cfg().approveExtra)) {
      record('see', 'windows', `Auto-approved a safe command for ${hq.windowName(ev.cwd)}: ${String(ev.tool_input.command).trim()}`);
      return { behavior: 'allow' };
    }
    return null;
  }

  // ── Buttons from the page ──
  async function action(name, arg) {
    if (name === 'mode') { hq.setWatchdogMode(arg === 'watch' ? 'watch' : 'act'); record('act', 'safety', arg === 'watch' ? 'Switched to watch-only mode.' : 'Switched to act mode.'); return { ok: true }; }
    if (name === 'unpause') { st.paused = null; save(); record('act', 'safety', 'Ari turned the Watchdog back on.'); setTimeout(tick, 500); return { ok: true }; }
    if (name === 'abortmerge') { await backup('Ari pressed “Undo it anyway”.', ((await gitv(['diff', '--name-only', '--diff-filter=U'])) || '').split('\n').filter(Boolean)); const r = await withGitLock(() => git(['merge', '--abort'])); record('act', 'merge', 'Ari undid the half-done merge. HQ will merge again the safe way.'); setTimeout(tick, 1000); return { ok: !(r && r.ok === false) }; }
    if (name === 'installed') { st.build.installed = st.build.good && st.build.good.sha; save(); record('act', 'build', 'Ari installed the new build.'); setTimeout(tick, 500); return { ok: true }; }
    if (name === 'build') { const r = await startBuild('Ari pressed Build'); return r && r.started ? { ok: true } : { error: (r && r.error) || 'Could not start' }; }
    if (name === 'resetbreakers') { st.breakers = {}; save(); record('act', 'safety', 'Ari reset the “resting” areas.'); setTimeout(tick, 500); return { ok: true }; }
    if (name === 'checknow') { setTimeout(tick, 100); return { ok: true }; }
    if (name === 'pausefor') { st.paused = { until: now() + 24 * HOUR, why: 'A Claude job tried to use a paid API key, so HQ stopped it and paused. Remove the key (see “An Anthropic API key is on this PC”), then turn the Watchdog back on.' }; save(); record('act', 'safety', 'Paused: a job tried to use a paid API key.'); alert('paid', 'urgent', 'HQ stopped a job that would have cost money. Open the Watchdog.'); return { ok: true }; }
    return { error: 'Unknown action' };
  }
  // Manual "Merge now" (Pulse): same safe recipe, all windows, right now.
  async function mergeNow() {
    const f = await facts(); if (!f) return { error: 'No app folder set' };
    const out = [];
    for (const b of f.branches) {
      if (!b.ahead) { out.push(b.window + ' was already in'); continue; }
      const r = await safeMerge(b, 'manual');
      if (r.busy) return { error: 'HQ is already merging. Try again in a minute.' };
      await afterMerge(b, r, f);
      if (!r.ok) return { error: r.error, files: r.files || [], lines: r.lines || [], text: r.text, steps: out };
      out.push('Merged ' + b.window);
    }
    setTimeout(tick, 500);
    return { ok: true, steps: out };
  }

  function view() {
    return {
      mode: cfg().mode, acting: acting(), paused: st.paused, lastTick, tickErr, areas: areaOk,
      fixing: [...fixingNow.values()],
      needs: [...needs.values()].sort((a, b) => ({ urgent: 0, warn: 1, info: 2 }[a.level] - { urgent: 0, warn: 1, info: 2 }[b.level])),
      log: log.filter((e) => e.kind !== 'see').slice(0, 60), seen: log.filter((e) => e.kind === 'see').slice(0, 20),
      alerts, phone, merge: mergeView,
      build: { lastFail: st.build.lastFail || null, good: st.build.good, installed: st.build.installed, needBuild: !!st.build.needBuild, autoToday: (st.budgets.autobuild || []).filter((t) => now() - t < 24 * HOUR).length, max: cfg().maxAutoBuildsPerDay, resting: breakerOpen('build') },
      breakers: Object.fromEntries(Object.entries(st.breakers).filter(([, b]) => b.openUntil && now() < b.openUntil).map(([k, b]) => [k, b.openUntil])),
    };
  }

  return { start, stop, tick, view, permission, action, mergeNow, safeMerge, facts, _st: () => st, _log: log };
}

module.exports = { createWatchdog };
