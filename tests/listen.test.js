// Talk button: Whisper output cleanup and the WAV checks. (Whisper itself only runs on Windows.)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wav = (seconds) => { const n = Math.round(16000 * seconds); const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };

test('Whisper sound tags are removed', () => {
  const { clean } = require('../listen.js');
  assert.strictEqual(clean(' The train tab [BLANK_AUDIO] crashes (keyboard clicking) when I open it. '), 'The train tab crashes when I open it.');
  assert.strictEqual(clean('[Music]'), '');
  assert.strictEqual(clean('Squat (the deep one) is wrong'), 'Squat (the deep one) is wrong');
});

test('recordings: bad file refused, too short = nothing, normal = words', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'listen-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'whisper.sh'); fs.writeFileSync(exe, '#!/bin/sh\necho " Fix the [BLANK_AUDIO] weight graph."\n'); fs.chmodSync(exe, 0o755);
  const model = path.join(dir, 'm.bin'); fs.writeFileSync(model, 'x');
  process.env.HQ_WHISPER_EXE = exe; process.env.HQ_WHISPER_MODEL = model;
  delete require.cache[require.resolve('../listen.js')];
  const L = require('../listen.js');
  assert.ok((await L.transcribe(Buffer.from('nope'))).error);
  assert.deepStrictEqual(await L.transcribe(wav(0.1)), { text: '' });
  assert.deepStrictEqual(await L.transcribe(wav(1)), { text: 'Fix the weight graph.' });
});
