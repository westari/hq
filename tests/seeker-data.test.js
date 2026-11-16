// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../seeker/data');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();

// A pretend GitHub: a bare repo with main and outreach-data, and a clone like the one on Ari's PC.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-'));
  const remote = path.join(root, 'remote.git');
  git(root, 'init', '--quiet', '--bare', remote);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '--quiet', remote, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), 'hq');
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', 'main'); git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  git(seed, 'checkout', '--quiet', '--orphan', 'outreach-data'); git(seed, 'rm', '-rfq', '.');
  fs.writeFileSync(path.join(seed, 'places.json'), '[]\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', 'data'); git(seed, 'push', '--quiet', 'origin', 'outreach-data');
  const pc = path.join(root, 'hq');
  git(root, 'clone', '--quiet', '--branch', 'main', remote, pc);
  return { root, remote, seed, pc };
}

test('adds, changes and removes places on GitHub', async () => {
  const { pc, remote, root } = setup();
  const s = new Store(pc);
  let d = await s.load();
  assert.deepStrictEqual(d.places, []);
  d = await s.change({ type: 'add', data: { name: 'Compass Rose', city: 'DC', category: 'Nightlife' } });
  assert.strictEqual(d.places.length, 1);
  const id = d.places[0].id;
  d = await s.change({ type: 'add', data: { name: 'compass rose', city: 'DC' } });
  assert.strictEqual(d.places.length, 1, 'no duplicates');
  d = await s.change({ type: 'update', id, patch: { email: 'hi@rose.com' } });
  d = await s.change({ type: 'settings', data: { appName: 'Seeker', live: false } });
  const check = path.join(root, 'check');
  git(root, 'clone', '--quiet', '--branch', 'outreach-data', remote, check);
  const onGitHub = JSON.parse(fs.readFileSync(path.join(check, 'places.json'), 'utf8'));
  assert.strictEqual(onGitHub[0].email, 'hi@rose.com');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(check, 'settings.json'), 'utf8')).appName, 'Seeker');
  d = await s.change({ type: 'delete', id });
  assert.deepStrictEqual(d.places, []);
  assert.strictEqual(git(pc, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'HQ stays on main');
});

test('a change made while the morning run also saved is not lost', async () => {
  const { pc, seed } = setup();
  const s = new Store(pc);
  await s.change({ type: 'add', data: { name: 'A', city: 'DC' } });
  // The morning run (GitHub) saves its own update in between.
  git(seed, 'pull', '--quiet', 'origin', 'outreach-data');
  const list = JSON.parse(fs.readFileSync(path.join(seed, 'places.json'), 'utf8'));
  list[0].status = 'sent';
  fs.writeFileSync(path.join(seed, 'places.json'), JSON.stringify(list, null, 2) + '\n');
  fs.writeFileSync(path.join(seed, 'log.jsonl'), JSON.stringify({ type: 'first', place: 'A' }) + '\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '--quiet', '-m', 'run'); git(seed, 'push', '--quiet', 'origin', 'HEAD:outreach-data');
  const d = await s.change({ type: 'add', data: { name: 'B', city: 'Miami' } });
  assert.deepStrictEqual(d.places.map(p => [p.name, p.status]), [['A', 'sent'], ['B', 'todo']]);
  assert.strictEqual(d.log.length, 1);
});
