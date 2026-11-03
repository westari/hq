// Real-sounding voice for HQ alerts, made on your PC with Piper (free, open source, works offline).
// First use downloads Piper (~25 MB) and one voice (~60-110 MB) into C:\Users\arize\hq\voice\ . No account, no API.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile, spawn } = require('child_process');

const DIR = path.join(__dirname, 'voice');
const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const VOICES = [
  { id: 'ryan', name: 'Ryan', path: 'en/en_US/ryan/high/en_US-ryan-high' },
  { id: 'lessac', name: 'Lessac', path: 'en/en_US/lessac/high/en_US-lessac-high' },
  { id: 'amy', name: 'Amy', path: 'en/en_US/amy/medium/en_US-amy-medium' },
  { id: 'alan', name: 'Alan (British)', path: 'en/en_GB/alan/medium/en_GB-alan-medium' },
];
let status = { ready: false, busy: '', error: '' };

fs.mkdirSync(DIR, { recursive: true });
const exe = () => path.join(DIR, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
const modelFile = (v) => path.join(DIR, path.basename(v.path) + '.onnx');

function download(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'hq-voice' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), dest, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Download failed (' + res.statusCode + ')')); }
      const tmp = dest + '.part'; const out = fs.createWriteStream(tmp);
      res.pipe(out); out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); })); out.on('error', reject);
    }).on('error', reject);
  });
}

async function ensure(voiceId) {
  const v = VOICES.find((x) => x.id === voiceId) || VOICES[0];
  if (fs.existsSync(exe()) && fs.existsSync(modelFile(v)) && fs.existsSync(modelFile(v) + '.json')) { status.ready = true; return v; }
  if (status.busy) return null;
  try {
    if (!fs.existsSync(exe())) {
      if (process.platform !== 'win32') throw new Error('Piper setup is Windows-only here');
      status.busy = 'Downloading the voice engine (one time)';
      const zip = path.join(DIR, 'piper.zip'); await download(PIPER_ZIP, zip);
      await new Promise((res, rej) => execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath "${zip}" -DestinationPath "${DIR}"`], { windowsHide: true }, (e) => (e ? rej(e) : res())));
      fs.unlinkSync(zip);
    }
    if (!fs.existsSync(modelFile(v))) { status.busy = 'Downloading the ' + v.name + ' voice (one time)'; await download(VOICE_BASE + v.path + '.onnx', modelFile(v)); }
    if (!fs.existsSync(modelFile(v) + '.json')) await download(VOICE_BASE + v.path + '.onnx.json', modelFile(v) + '.json');
    status = { ready: true, busy: '', error: '' }; return v;
  } catch (e) { status = { ready: false, busy: '', error: e.message }; return null; }
}

// Makes a WAV of the text. Returns null if the voice isn't ready yet (it starts downloading).
async function speak(text, voiceId) {
  const v = await ensure(voiceId); if (!v) return null;
  const out = path.join(DIR, 'say-' + Date.now() + '.wav');
  await new Promise((resolve, reject) => {
    const p = spawn(exe(), ['--model', modelFile(v), '--output_file', out], { cwd: path.dirname(exe()), windowsHide: true });
    p.on('error', reject); p.on('exit', (code) => (code ? reject(new Error('Piper stopped (' + code + ')')) : resolve()));
    p.stdin.end(String(text).slice(0, 400));
  });
  const buf = fs.readFileSync(out); fs.unlink(out, () => {}); return buf;
}

module.exports = { download, VOICES, speak, ensure, status: () => ({ ...status, voices: VOICES.map((v) => ({ id: v.id, name: v.name, have: fs.existsSync(modelFile(v)) })) }) };
