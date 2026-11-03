// Content bot: the template rules, the 5th-grade check, picture prompts, and the whole
// write → pictures pipeline against fake Gemini + fake Cloudflare servers.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-'));
process.env.HQ_CONTENT_DIR = dir;
process.env.HQ_GEMINI_BASE = 'http://127.0.0.1:4798';
process.env.HQ_CF_BASE = 'http://127.0.0.1:4798';
const C = require('../content.js');
const T = C._test;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let writer = null; const calls = [];
const server = http.createServer((req, res) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => {
  const body = Buffer.concat(b).toString('latin1');
  if (req.url.includes('generateContent')) {
    const kind = /You check AI pictures/.test(body) ? 'check' : /topic ideas/.test(body) ? 'ideas' : 'write'; calls.push(kind);
    const out = kind === 'check' ? { ok: true } : kind === 'ideas' ? { ideas: ['a', 'b'] } : writer(calls.filter((x) => x === 'write').length);
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
  }
  if (req.url.includes('/ai/run/')) { calls.push('image ' + ((/name="width"\r\n\r\n(\d+)/.exec(body) || [])[1])); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: true, result: { image: PNG.toString('base64') } })); }
  res.writeHead(404); res.end();
}); });
test.before(() => new Promise((r) => server.listen(4798, r)));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const good = { title: 'Leg day', hook: { text: 'This 4-move leg day hits every leg muscle in 25 minutes', picture: 'a man at the bottom of a barbell squat' },
  steps: [{ title: '1. Do 3 sets of goblet squats', bullets: ['10 reps each', 'Keep your chest up'], picture: 'a black kettlebell' }, { title: 'Do 3 sets of lunges', bullets: ['8 reps each leg'], picture: 'a woman doing a lunge' },
    { title: 'Do 3 sets of glute bridges', bullets: ['12 reps'], picture: 'a yoga mat' }, { title: "That's it", bullets: ['25 minutes total'], picture: 'a stopwatch' }], caption: 'Save this', hashtags: ['legday', '#gym'] };

test('reading level: simple slide words pass, hard words fail', () => {
  assert.ok(T.grade('DO 3 SETS OF GOBLET SQUATS\n10 REPS EACH') <= 5);
  assert.ok(T.grade('UTILIZE PROGRESSIVE OVERLOAD METHODOLOGY FOR HYPERTROPHY') > 5);
  assert.deepStrictEqual(T.hardWords('use progressive overload'), ['PROGRESSIVE', 'OVERLOAD']);
});

test('the writer\'s answer is cleaned up into the exact template shape', () => {
  const s = T.tidy(T.HACK, good);
  assert.strictEqual(s.hook.text, 'THIS 4-MOVE LEG DAY HITS EVERY LEG MUSCLE IN 25 MINUTES');
  assert.strictEqual(s.steps[0].title, 'DO 3 SETS OF GOBLET SQUATS', 'numbers are drawn by HQ, so they are removed from titles');
  assert.strictEqual(s.cta, 'COMMENT "FORM" TO GET AN APP THAT WATCHES EVERY REP AND TELLS YOU WHEN YOUR FORM IS OFF');
  assert.deepStrictEqual(s.hashtags, ['#legday', '#gym']);
  assert.deepStrictEqual(T.problems(T.HACK, s), []);
});

test('problems are caught: wrong step count, missing THAT\'S IT, false claims, hard words', () => {
  const s = T.tidy(T.HACK, { ...good, steps: good.steps.slice(0, 3) });
  const p = T.problems(T.HACK, s).join(' | ');
  assert.match(p, /exactly 4 steps/); assert.match(p, /THAT'S IT/);
  const s2 = T.tidy(T.HACK, { ...good, hook: { text: 'Burn 500 calories with this workout', picture: 'x' } });
  assert.match(T.problems(T.HACK, s2).join(' '), /calories/);
});

test('picture prompts: subject first, the template look after, faces turned away for people', () => {
  const s = T.tidy(T.HACK, good);
  const hook = T.promptFor(T.HACK, 'hook', s), item = T.promptFor(T.HACK, 'step1', s), obj = T.promptFor(T.HACK, 'step0', s);
  assert.ok(hook.startsWith('a man at the bottom of a barbell squat')); assert.match(hook, /face looking away/);
  assert.match(item, /pure white seamless background/); assert.match(item, /face looking away/);
  assert.doesNotMatch(obj, /face looking away/);
  assert.ok(hook.split(/\s+/).length < 110, 'FLUX works best under ~100 words');
});

test('whole pipeline: write (with an automatic fix), pictures, checks, free-picture counter', async () => {
  // The first answer has a hard word; HQ must ask once more with the exact problem.
  writer = (n) => (n === 1 ? { ...good, hook: { text: 'Utilize progressive overload methodology for hypertrophy gains', picture: 'x' } } : good);
  fs.writeFileSync(path.join(dir, 'gemini.key'), 'k');
  const r = await C.draft('leg day', 'hack');
  assert.ok(r.show, JSON.stringify(r)); assert.strictEqual(calls.filter((x) => x === 'write').length, 2);
  assert.ok(r.show.grade <= 5); assert.deepStrictEqual(r.show.warnings, []);
  assert.strictEqual((await C.makePictures(r.show.id, null, () => {})).error, 'nocf', 'needs Cloudflare first');
  assert.deepStrictEqual(C.setPictures('0123456789abcdef0123456789abcdef', 'tok-aaaaaaaaaaaaaaaaaaaaaa'), { ok: true });
  assert.ok((await C.makePictures(r.show.id, null, () => {})).started);
  for (let i = 0; i < 50 && C.state().busy; i++) await new Promise((res) => setTimeout(res, 50));
  const sh = C.state().shows.find((x) => x.id === r.show.id);
  assert.strictEqual(sh.status, 'layout'); assert.strictEqual(Object.values(sh.images).filter((x) => x.file).length, 5);
  assert.deepStrictEqual(calls.filter((x) => x.startsWith('image')), ['image 864', 'image 512', 'image 512', 'image 512', 'image 512']);
  assert.strictEqual(calls.filter((x) => x === 'check').length, 5);
  assert.ok(C.state().pictures.neurons > 250 && C.state().pictures.neurons < 300);
  // Finished slides arrive from the page → ready.
  for (const i of [0, 1, 2]) C.saveFinal(r.show.id, i, 'data:image/png;base64,' + PNG.toString('base64'));
  assert.strictEqual(C.state().shows.find((x) => x.id === r.show.id).status, 'ready');
  // Editing one picture's description remakes only that picture.
  const spec = JSON.parse(JSON.stringify(sh.spec)); spec.steps[2].picture = 'a foam roller';
  const before = calls.length; assert.ok((await C.makePictures(r.show.id, spec, () => {})).started);
  for (let i = 0; i < 50 && C.state().busy; i++) await new Promise((res) => setTimeout(res, 50));
  assert.deepStrictEqual(calls.slice(before).filter((x) => x.startsWith('image')), ['image 512']);
});
