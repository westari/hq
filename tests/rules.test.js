// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const R = require('../watchdog-rules.js');

test('build errors are classified exactly', () => {
  const c = (t) => R.classifyBuild(t).id;
  assert.strictEqual(c('error: Provisioning profile "x" doesn\'t include the com.apple.developer.applesignin entitlement.'), 'signing');
  assert.strictEqual(c('No profiles for \'com.athlt.formpal\' were found'), 'signing');
  assert.strictEqual(c('Error: Input required and not supplied: token'), 'secret');
  assert.strictEqual(c('[!] CocoaPods could not find compatible versions for pod "ExpoModulesCore"'), 'pods');
  assert.strictEqual(c('Unable to resolve module ../lib/foo from app/index.tsx'), 'code');
  assert.strictEqual(c('error TS2322: Type string is not assignable'), 'code');
  assert.strictEqual(c('The runner has received a shutdown signal. runner lost communication'), 'temporary');
  assert.strictEqual(c('npm ERR! network ECONNRESET'), 'temporary');
  assert.strictEqual(c('##[error]Process completed with exit code 65.'), 'unknown');
  // signing beats "code" words in the same log
  assert.strictEqual(c('SyntaxError somewhere\nNo profiles for x'), 'signing');
});

test('usage-limit messages: reset time and weekly', () => {
  const base = new Date(2026, 10, 3, 13, 0).getTime(); // Tue Nov 3, 1:00 pm
  const at = (t) => { const r = R.parseLimit(t, base); return r && r.resetAt ? new Date(r.resetAt) : r; };
  let d = at('5-hour limit reached - resets 3pm'); assert.strictEqual(d.getHours(), 15); assert.strictEqual(d.getDate(), 3);
  d = at("You've hit your session limit · resets 2am"); assert.strictEqual(d.getHours(), 2); assert.strictEqual(d.getDate(), 4);
  d = at("You've hit your session limit · resets 3:45pm"); assert.strictEqual(d.getMinutes(), 45);
  const w = R.parseLimit("You've hit your weekly limit · resets Nov 9, 10am", base); assert.strictEqual(w.weekly, true); assert.strictEqual(new Date(w.resetAt).getDate(), 9);
  assert.strictEqual(R.parseLimit("You've used 85% of your session limit · resets 3:45pm", base), null);
  assert.strictEqual(R.parseLimit('All tests passed', base), null);
  assert.strictEqual(R.parseLimit('Claude AI usage limit reached|1793750400', base).resetAt, 1793750400000);
});

test('TypeScript errors compare without line numbers', () => {
  const a = R.tscErrors('app/a.tsx(10,5): error TS2322: Type X\napp/b.ts(1,1): error TS1005: ; expected');
  const b = R.tscErrors('app/a.tsx(12,5): error TS2322: Type X\napp/c.ts(3,3): error TS2304: Cannot find name Y');
  assert.deepStrictEqual(R.newErrors(a, b), ['app/c.ts: TS2304: Cannot find name Y']);
});

test('only exact tiny commands are auto-approved', () => {
  assert.ok(R.safeToApprove('Bash', { command: 'git status' }));
  assert.ok(R.safeToApprove('Bash', { command: '  npx  tsc   --noEmit ' }));
  assert.ok(!R.safeToApprove('Bash', { command: 'git status && rm -rf /' }));
  assert.ok(!R.safeToApprove('Bash', { command: 'git status; echo hi' }));
  assert.ok(!R.safeToApprove('Bash', { command: 'git status $(whoami)' }));
  assert.ok(!R.safeToApprove('Bash', { command: 'git push' }));
  assert.ok(!R.safeToApprove('Edit', { command: 'git status' }));
});

test('conflict markers are found, Markdown underlines are not', () => {
  assert.ok(R.MARKER_RE.test('a\n<<<<<<< HEAD\nb'));
  assert.ok(R.MARKER_RE.test('>>>>>>> work-a'));
  assert.ok(!R.MARKER_RE.test('Title\n=======\ntext'));
});
