// End-to-end Watchdog tests with REAL git repos (in a temp folder) and a fake HQ around them.
// Fake "tsc" and fake "@expo/fingerprint" are put in node_modules so type checks and native checks are real code paths.
// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createWatchdog } = require('../watchdog.js');

const G = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_EDITOR: 'true' } }).trim();
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// A fake TypeScript: every line containing "BROKEN" in a .ts/.tsx file is an error.
const FAKE_TSC = `const fs=require('fs'),path=require('path');const root=process.argv[process.argv.indexOf('-p')+1];let out='';
function walk(d){for(const f of fs.readdirSync(d)){if(f==='node_modules'||f==='.git')continue;const p=path.join(d,f);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\\.tsx?$/.test(f)){fs.readFileSync(p,'utf8').split('\\n').forEach((l,i)=>{if(l.includes('BROKEN'))out+=path.relative(root,p)+'('+(i+1)+',1): error TS2304: Cannot find name BROKEN.\\n';if(l.includes('uses-api')&&!fs.existsSync(path.join(root,'constants','api.ts')))out+=path.relative(root,p)+'('+(i+1)+',1): error TS2307: Cannot find module constants/api.\\n';});}}}
walk(root);process.stdout.write(out);process.exit(out?2:0);`;
// A fake fingerprint: the hash is package.json's "native" field.
const FAKE_FP = `const fs=require('fs'),path=require('path');const pj=JSON.parse(fs.readFileSync(path.join(process.argv[2],'package.json'),'utf8'));console.log(JSON.stringify({hash:'fp-'+(pj.native||0)}));`;

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wdtest-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const origin = path.join(home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'overnight-build', origin]);
  const app = path.join(home, 'gym app');
  G(home, 'init', '-q', '-b', 'overnight-build', app);
  W(path.join(app, 'package.json'), JSON.stringify({ name: 'x', native: 1 }));
  W(path.join(app, 'tsconfig.json'), '{}');
  W(path.join(app, 'app', 'index.tsx'), 'line1\nline2\nline3\n');
  W(path.join(app, 'app', 'other.tsx'), 'a\nb\nc\n');
  W(path.join(app, '.gitignore'), 'node_modules\n');
  G(app, 'add', '.'); G(app, 'commit', '-qm', 'init');
  G(app, 'remote', 'add', 'origin', origin); G(app, 'push', '-q', '-u', 'origin', 'overnight-build');
  G(app, 'branch', 'work-a'); G(app, 'branch', 'work-b');
  W(path.join(app, 'node_modules', 'typescript', 'bin', 'tsc'), FAKE_TSC);
  W(path.join(app, 'node_modules', '@expo', 'fingerprint', 'bin', 'cli.js'), FAKE_FP);
  for (const w of ['gym-app-a', 'gym-app-b']) { fs.mkdirSync(path.join(home, w)); G(home, 'init', '-q', path.join(home, w)); }

  const calls = { sent: [], started: [], builds: [], cleared: [] };
  const sessions = [];
  let runs = [];
  const config = { windows: { 'gym-app-a': 'Window A', 'gym-app-b': 'Window B', 'gym app': 'Main folder' },
    git: { mainRepo: app, mainBranch: 'overnight-build', branches: { 'Window A': 'work-a', 'Window B': 'work-b' } },
    watchdog: { mode: 'act' } };
  let clock = Date.now();
  const hq = {
    dir: home, home, claudeDir: path.join(home, '.claude'), now: () => clock,
    config: () => config, changed: () => {},
    sessions: () => sessions, sessionByWindow: (w) => sessions.find((s) => s.win === w) || null,
    windowName: (cwd) => (cwd || '').includes('gym-app-a') ? 'Window A' : (cwd || '').includes('gym-app-b') ? 'Window B' : 'Main folder',
    isRunner: () => false, stopRunner: async () => {},
    startJob: (w, text, s, title) => { calls.started.push({ w, text, title }); return { started: true }; },
    sendJob: (w, text, title) => { calls.sent.push({ w, text, title }); return { started: w }; },
    dispatchQueue: () => {}, freeWindow: () => 'Window A',
    clearLimit: (s) => { calls.cleared.push(s.id); s.limitHit = null; s.status = 'done'; },
    usage: () => ({}), runs: () => runs,
    startBuild: async () => { calls.builds.push(G(app, 'rev-parse', 'HEAD')); return { started: true }; },
    canAskClaude: () => false, askClaudeJSON: async () => ({ ok: false }),
    setWatchdogMode: (m) => { config.watchdog.mode = m; },
  };
  const wd = createWatchdog(hq);
  const onWork = (br, file, content, msg) => { G(app, 'checkout', '-q', br); W(path.join(app, file), content); G(app, 'add', '.'); G(app, 'commit', '-qm', msg || 'work on ' + br); G(app, 'checkout', '-q', 'overnight-build'); };
  return { home, app, origin, wd, calls, sessions, config, setRuns: (r) => { runs = r; }, tick: () => wd.tick(), advance: (ms) => { clock += ms; }, onWork };
}
const needKeys = (env) => env.wd.view().needs.map((n) => n.key);
const head = (env) => G(env.app, 'rev-parse', 'HEAD');
const has = (env, re) => env.wd.view().log.some((e) => re.test(e.text));

test('clean work is merged safely, pushed, and never merged twice', async (t) => {
  const env = setup(t);
  env.onWork('work-a', 'app/index.tsx', 'line1\nA\nline3\n');
  await env.tick();
  assert.strictEqual(fs.readFileSync(path.join(env.app, 'app/index.tsx'), 'utf8'), 'line1\nA\nline3\n');
  assert.strictEqual(G(env.app, 'rev-parse', 'HEAD'), G(env.origin, 'rev-parse', 'overnight-build'), 'pushed to GitHub');
  assert.strictEqual(G(env.app, 'worktree', 'list').split('\n').length, 1, 'temporary copy removed');
  assert.ok(fs.existsSync(path.join(env.app, 'node_modules', 'typescript')), 'real node_modules untouched');
  const h = head(env);
  await env.tick(); await env.tick();
  assert.strictEqual(head(env), h, 'nothing new merged on later ticks');
  assert.ok(env.wd.view().phone.text.length > 0);
});

test('a conflict never touches the app folder; the window is asked once to combine', async (t) => {
  const env = setup(t);
  env.onWork('work-a', 'app/index.tsx', 'line1\nAAA\nline3\n');
  env.onWork('work-b', 'app/index.tsx', 'line1\nBBB\nline3\n');
  await env.tick();
  assert.strictEqual(fs.readFileSync(path.join(env.app, 'app/index.tsx'), 'utf8'), 'line1\nAAA\nline3\n', 'A merged, B blocked');
  assert.ok(!fs.existsSync(path.join(env.app, '.git', 'MERGE_HEAD')), 'no half-done merge left');
  assert.ok(!/<<<<<<</.test(fs.readFileSync(path.join(env.app, 'app/index.tsx'), 'utf8')), 'no conflict lines in the app');
  const toB = env.calls.sent.filter((s) => s.w === 'Window B');
  assert.strictEqual(toB.length, 1); assert.match(toB[0].text, /conflict in: app\/index\.tsx/);
  assert.match(toB[0].text, /Never start iOS builds/);
  await env.tick(); await env.tick();
  assert.strictEqual(env.calls.sent.filter((s) => s.w === 'Window B').length, 1, 'not asked again for the same work');
});

test('a branch with committed conflict lines is blocked', async (t) => {
  const env = setup(t);
  env.onWork('work-b', 'app/other.tsx', 'a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> work-a\n');
  const before = head(env);
  await env.tick();
  assert.strictEqual(head(env), before, 'app folder not moved');
  assert.ok(env.calls.sent.some((s) => s.w === 'Window B' && /conflict leftovers/.test(s.text)));
});

test('leftover conflict lines already in the app: Window A is asked to fix them, once', async (t) => {
  const env = setup(t);
  W(path.join(env.app, 'app/other.tsx'), 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n'); G(env.app, 'commit', '-qam', 'bad merge'); G(env.app, 'push', '-q');
  await env.tick(); await env.tick();
  assert.ok(needKeys(env).includes('leftover'));
  assert.strictEqual(env.calls.sent.filter((s) => /leftovers/.test(s.text)).length, 1);
});

test('new TypeScript errors block a merge; old errors do not', async (t) => {
  const env = setup(t);
  W(path.join(env.app, 'app/other.tsx'), 'a\nBROKEN old\nc\n'); G(env.app, 'commit', '-qam', 'old error'); G(env.app, 'push', '-q');
  G(env.app, 'branch', '-f', 'work-a', 'HEAD'); G(env.app, 'branch', '-f', 'work-b', 'HEAD');
  env.onWork('work-a', 'app/index.tsx', 'line1\nfine change\nline3\n');
  env.onWork('work-b', 'app/index2.tsx', 'BROKEN new\n');
  await env.tick();
  assert.strictEqual(fs.readFileSync(path.join(env.app, 'app/index.tsx'), 'utf8'), 'line1\nfine change\nline3\n', 'A merged despite the old error');
  assert.ok(!fs.existsSync(path.join(env.app, 'app/index2.tsx')), 'B blocked: it adds a new error');
  assert.ok(env.calls.sent.some((s) => s.w === 'Window B' && /NEW errors/.test(s.text) && /index2\.tsx/.test(s.text)));
});

test('git-ignored source files (like constants/api.ts) are used by the type check', async (t) => {
  const env = setup(t);
  fs.appendFileSync(path.join(env.app, '.gitignore'), 'constants/api.ts\n'); G(env.app, 'commit', '-qam', 'ignore api'); G(env.app, 'push', '-q');
  G(env.app, 'branch', '-f', 'work-a', 'HEAD');
  W(path.join(env.app, 'constants', 'api.ts'), 'export const KEY = 1;\n');
  env.onWork('work-a', 'app/new.tsx', 'uses-api\n');
  await env.tick();
  assert.ok(fs.existsSync(path.join(env.app, 'app/new.tsx')), 'merged: the ignored file was there for the check');
});

test('unsaved changes in the app folder are never overwritten', async (t) => {
  const env = setup(t);
  env.onWork('work-a', 'app/index.tsx', 'line1\nA\nline3\n');
  W(path.join(env.app, 'app/index.tsx'), 'my unsaved edit\n');
  await env.tick();
  assert.strictEqual(fs.readFileSync(path.join(env.app, 'app/index.tsx'), 'utf8'), 'my unsaved edit\n');
  assert.ok(needKeys(env).includes('dirty'));
});

test('a busy window is not merged until it is done', async (t) => {
  const env = setup(t);
  env.sessions.push({ id: 's1', win: 'Window A', cwd: path.join(env.home, 'gym-app-a'), status: 'working', lastEvent: Date.now() });
  env.onWork('work-a', 'app/index.tsx', 'line1\nA\nline3\n');
  const before = head(env);
  await env.tick();
  assert.strictEqual(head(env), before);
  env.sessions[0].status = 'done';
  await env.tick();
  assert.notStrictEqual(head(env), before);
});

test('a half-done merge with conflicts: Ari can undo it, then HQ merges the safe way', async (t) => {
  const env = setup(t);
  env.onWork('work-a', 'app/index.tsx', 'line1\nAAA\nline3\n');
  W(path.join(env.app, 'app/index.tsx'), 'line1\nMAIN\nline3\n'); G(env.app, 'commit', '-qam', 'main change'); G(env.app, 'push', '-q');
  try { G(env.app, 'merge', 'work-a'); } catch {}
  assert.ok(fs.existsSync(path.join(env.app, '.git', 'MERGE_HEAD')));
  await env.tick();
  assert.ok(needKeys(env).includes('halfmerge'));
  await env.wd.action('abortmerge');
  assert.ok(!fs.existsSync(path.join(env.app, '.git', 'MERGE_HEAD')));
});

test('watch mode changes nothing and only says what it would do', async (t) => {
  const env = setup(t);
  env.config.watchdog.mode = 'watch';
  env.onWork('work-a', 'app/index.tsx', 'line1\nA\nline3\n');
  const before = head(env);
  await env.tick();
  assert.strictEqual(head(env), before);
  assert.ok(env.wd.view().log.some((e) => e.kind === 'would'));
});

test('builds: only when the native part changes, max one per commit', async (t) => {
  const env = setup(t);
  await env.tick(); // remembers the current app as "on your phone"
  env.onWork('work-a', 'app/index.tsx', 'line1\nJS only\nline3\n');
  await env.tick(); await env.tick();
  assert.strictEqual(env.calls.builds.length, 0, 'JS-only change: no build');
  env.onWork('work-a', 'package.json', JSON.stringify({ name: 'x', native: 2 }));
  await env.tick(); await env.tick(); await env.tick();
  assert.strictEqual(env.calls.builds.length, 1, 'native change: exactly one build');
  assert.strictEqual(env.calls.builds[0], head(env));
});

test('failed builds: Apple signing → you; hiccup → one retry; code error → a window, once', async (t) => {
  const env = setup(t);
  const sha = head(env);
  env.setRuns([{ id: 'r0', st: 'done', sha, at: Date.now() - 60000, fail: [], note: '' }]);
  await env.tick();
  const now = Date.now();
  env.setRuns([{ id: 'r1', st: 'failed', sha, at: now, fail: ["error: Provisioning profile doesn't include the com.apple.developer.applesignin entitlement"], note: 'x', raw: '' }]);
  await env.tick();
  assert.ok(needKeys(env).includes('buildhuman:signing'));
  assert.strictEqual(env.calls.builds.length, 0, 'never retries signing');
  env.setRuns([{ id: 'r2', st: 'failed', sha, at: now, fail: ['npm ERR! network ECONNRESET'], note: 'x', raw: '' }]);
  await env.tick();
  assert.strictEqual(env.calls.builds.length, 1, 'hiccup: one retry');
  env.setRuns([{ id: 'r3', st: 'failed', sha, at: now, fail: ['npm ERR! network ECONNRESET'], note: 'x', raw: '' }]);
  await env.tick();
  assert.strictEqual(env.calls.builds.length, 1, 'no second retry for the same commit');
  env.setRuns([{ id: 'r4', st: 'failed', sha, at: now, fail: ['Unable to resolve module ../lib/foo'], note: 'x', raw: '' }]);
  await env.tick(); await env.tick();
  assert.strictEqual(env.calls.sent.filter((s) => /iOS build on GitHub failed/.test(s.text)).length, 1);
});

test('usage limit: continues once after the reset; weekly limit pauses everything', async (t) => {
  const env = setup(t);
  const s = { id: 'sA', win: 'Window A', cwd: path.join(env.home, 'gym-app-a'), status: 'limit', limitHit: { at: Date.now() - 3 * 3600000, resumeAt: Date.now() - 10 * 60000 }, lastEvent: Date.now() - 3 * 3600000 };
  env.sessions.push(s);
  await env.tick();
  assert.strictEqual(env.calls.started.length, 1);
  assert.match(env.calls.started[0].text, /limit has reset/);
  s.status = 'limit'; s.limitHit = { at: Date.now(), resumeAt: Date.now() + 3 * 86400000, weekly: true };
  await env.tick();
  assert.ok(env.wd.view().paused, 'paused for the weekly limit');
  assert.ok(needKeys(env).includes('paused'));
});

test('safety rules are added to each window folder without touching other settings', async (t) => {
  const env = setup(t);
  W(path.join(env.home, 'gym-app-a', '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'], deny: ['Bash(foo)'] }, model: 'x' }));
  await env.tick();
  const s = JSON.parse(fs.readFileSync(path.join(env.home, 'gym-app-a', '.claude', 'settings.local.json'), 'utf8'));
  assert.deepStrictEqual(s.permissions.allow, ['Bash(ls)']);
  assert.strictEqual(s.model, 'x');
  assert.ok(s.permissions.deny.includes('Bash(foo)') && s.permissions.deny.includes('Bash(gh workflow run*)') && s.permissions.deny.includes('Bash(git reset --hard*)'));
  assert.ok(fs.existsSync(path.join(env.home, 'gym-app-b', '.git', 'hooks', 'pre-commit')));
});

test('the pre-commit guard blocks committing conflict lines', { skip: process.platform === 'win32' }, async (t) => {
  const env = setup(t);
  await env.tick();
  const a = path.join(env.home, 'gym-app-a');
  W(path.join(a, 'x.ts'), '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n'); G(a, 'add', '.');
  assert.throws(() => G(a, 'commit', '-qm', 'bad'));
  W(path.join(a, 'x.ts'), 'fine\n'); G(a, 'add', '.'); G(a, 'commit', '-qm', 'good');
});
