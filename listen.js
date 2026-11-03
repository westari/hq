// Speech to text for the Talk button, made on your PC with Whisper (whisper.cpp). Free, offline, no account.
// First use downloads the Whisper program (~4 MB) and an English model (~60 MB) into C:\Users\arize\hq\voice\ .
// The words you say never leave your PC.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { download } = require('./voice.js');

const DIR = path.join(__dirname, 'voice');
// Pinned version: the newest release that ships the Windows program (checked Nov 2026).
const ZIP_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip';
const MODEL_NAME = 'ggml-base.en-q5_1.bin'; // good accuracy, fast on a normal PC
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/' + MODEL_NAME;
// Words Whisper should expect (it spells them right more often).
const HINT = 'FormPal, HQ, Window A, Window B, Train tab, Progress tab, Profile tab, Test Lab, reps, sets, squat, shoulder press, bicep curl, deadlift, onboarding, paywall, muscle map, Workout Complete.';

let status = { ready: false, busy: '', error: '' };
fs.mkdirSync(DIR, { recursive: true });
const exe = () => {
  if (process.env.HQ_WHISPER_EXE) return process.env.HQ_WHISPER_EXE; // tests
  return path.join(DIR, 'whisper', 'Release', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
};
const model = () => process.env.HQ_WHISPER_MODEL || path.join(DIR, MODEL_NAME);

async function ensure() {
  if (fs.existsSync(exe()) && fs.existsSync(model())) { status = { ready: true, busy: '', error: '' }; return true; }
  if (status.busy) return false;
  try {
    if (!fs.existsSync(exe())) {
      if (process.platform !== 'win32') throw new Error('The Talk button setup is Windows-only');
      status.busy = 'Setting up the Talk button (one time, ~4 MB)';
      const zip = path.join(DIR, 'whisper.zip'); await download(ZIP_URL, zip);
      const into = path.join(DIR, 'whisper');
      await new Promise((res, rej) => execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath "${zip}" -DestinationPath "${into}"`], { windowsHide: true }, (e) => (e ? rej(e) : res())));
      try { fs.unlinkSync(zip); } catch {}
      if (!fs.existsSync(exe())) throw new Error('The Whisper download didn’t have whisper-cli.exe in it');
    }
    if (!fs.existsSync(model())) { status.busy = 'Downloading the speech model (one time, ~60 MB)'; await download(MODEL_URL, model()); }
    status = { ready: true, busy: '', error: '' }; return true;
  } catch (e) { status = { ready: false, busy: '', error: e.message }; return false; }
}

// Whisper writes things like "[BLANK_AUDIO]" or "(keyboard clicking)" for sounds. Drop those.
function clean(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ').replace(/\((?:[^)]*?(?:music|noise|silence|clicking|typing|laugh|inaudible|blank)[^)]*)\)/gi, ' ')
    .replace(/^\s*-\s*/gm, '').replace(/\s+/g, ' ').trim();
}

// wav: a 16 kHz mono 16-bit WAV (the page makes it). Returns { text } or { busy } or { error }.
async function transcribe(wav) {
  if (!wav || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return { error: 'That recording didn’t work. Try again.' };
  if (wav.length < 44 + 16000 * 2 * 0.3) return { text: '' }; // under 0.3 seconds: nothing said
  if (!(await ensure())) return status.busy ? { busy: status.busy } : { error: 'The Talk button isn’t ready: ' + (status.error || 'unknown problem') };
  const file = path.join(os.tmpdir(), 'hq-talk-' + Date.now() + '.wav');
  fs.writeFileSync(file, wav);
  const threads = String(Math.max(2, Math.min(8, (os.cpus() || []).length - 1)));
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(exe(), ['-m', model(), '-f', file, '-l', 'en', '-nt', '-np', '-t', threads, '--prompt', HINT], { windowsHide: true });
      let o = '', e = ''; const timer = setTimeout(() => { try { p.kill(); } catch {} reject(new Error('Whisper took too long')); }, 120000);
      p.stdout.on('data', (c) => { o += c; }); p.stderr.on('data', (c) => { e += c; });
      p.on('error', (er) => { clearTimeout(timer); reject(er); });
      p.on('exit', (code) => { clearTimeout(timer); code ? reject(new Error((e.trim().split('\n').pop() || 'Whisper stopped (' + code + ')').slice(0, 200))) : resolve(o); });
    });
    return { text: clean(out) };
  } catch (e) { return { error: 'Couldn’t turn your voice into words: ' + e.message }; }
  finally { fs.unlink(file, () => {}); }
}

module.exports = { ensure, transcribe, clean, status: () => ({ ...status, have: fs.existsSync(exe()) && fs.existsSync(model()) }) };
