// Content bot: makes TikTok-style slideshows for your app with Gemini, using YOUR free key.
// You pick a template and say what the slideshow is about. Gemini writes the slides and makes
// the pictures. HQ puts the text on each picture and saves finished 9:16 slides.
// Everything lives in C:\Users\arize\hq\content\ . The key lives in content\gemini.key (never on GitHub).
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, 'content');
const KEY_FILE = path.join(DIR, 'gemini.key');
const TPL_FILE = path.join(DIR, 'templates.json');
const USE_FILE = path.join(DIR, 'usage.json');
const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const APP = 'FormPal: an iPhone app that watches your reps through the camera, counts them, and tells you when your form is off, plus a personal workout plan. Made for beginner lifters.';
const DEFAULT_TEMPLATES = [
  { id: 'mistakes', name: 'Mistakes list', slides: 6,
    write: 'Slide 1: a scroll-stopping hook naming the mistakes (max 10 words). Middle slides: one mistake each, what it is and the fix (max 18 words). Last slide: FormPal checks every rep for you, link in bio (max 14 words).',
    look: 'Realistic iPhone photo, candid, slightly grainy, dim modern gym with natural light, one person in plain athletic wear doing the exercise, shot from the side at chest height. No text, no logos, not glossy, not stock-photo looking.',
    text: 'middle' },
  { id: 'pov', name: 'POV story', slides: 5,
    write: 'Slide 1: "POV:" relatable gym moment (max 10 words). Middle slides: the story, one beat each (max 16 words). Last slide: how FormPal fixed it, link in bio (max 14 words).',
    look: 'Realistic iPhone photo, candid, slightly grainy, gym or locker room, natural light, faces partly turned away. No text, no logos.',
    text: 'top' },
];

fs.mkdirSync(DIR, { recursive: true });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const getKey = () => { try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; } };
const setKey = (k) => fs.writeFileSync(KEY_FILE, String(k || '').trim());
const templates = () => readJSON(TPL_FILE, DEFAULT_TEMPLATES);
function saveTemplate(t) {
  const all = templates(); const id = t.id || ('t' + Date.now());
  const clean = { id, name: String(t.name || 'My template').slice(0, 40), slides: Math.max(3, Math.min(10, Number(t.slides) || 6)),
    write: String(t.write || '').slice(0, 1200), look: String(t.look || '').slice(0, 800), text: t.text === 'top' ? 'top' : t.text === 'bottom' ? 'bottom' : 'middle' };
  const i = all.findIndex((x) => x.id === id); if (i >= 0) all[i] = clean; else all.push(clean);
  fs.writeFileSync(TPL_FILE, JSON.stringify(all, null, 2)); return clean;
}

// Your own count of what you used today. Google doesn't tell programs how much free quota is left,
// so HQ counts it here and shows "Out of free images" the moment Google says the daily limit is hit.
const today = () => new Date().toISOString().slice(0, 10);
function usage() { const u = readJSON(USE_FILE, {}); return u.date === today() ? u : { date: today(), images: 0, writes: 0, limitHit: false }; }
function bump(k, v) { const u = usage(); if (k === 'limitHit') u.limitHit = true; else u[k] = (u[k] || 0) + (v || 1); fs.writeFileSync(USE_FILE, JSON.stringify(u)); }

function gemini(model, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({ host: 'generativelanguage.googleapis.com', path: `/v1beta/models/${model}:generateContent`, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-goog-api-key': getKey() } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch {}
        if (res.statusCode === 429) { bump('limitHit'); return reject(new Error('limit')); }
        if (res.statusCode >= 400) return reject(new Error((j.error && j.error.message) || 'Gemini error ' + res.statusCode));
        resolve(j);
      });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Gemini took too long')));
    req.end(data);
  });
}

const list = () => {
  let dirs = []; try { dirs = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'show.json'))); } catch {}
  return dirs.map((d) => readJSON(path.join(DIR, d, 'show.json'), null)).filter(Boolean).sort((a, b) => b.at - a.at);
};
const save = (s) => fs.writeFileSync(path.join(DIR, s.id, 'show.json'), JSON.stringify(s, null, 2));

let busy = false, lastError = '';
const errText = (e) => (e.message === 'limit' ? 'Out of free Gemini images for today. Try again tomorrow. Nothing was charged.' : 'Gemini said: ' + e.message);

// Step 1: write the slides (cheap, 1 text request). You check them before any picture is made.
async function draft(topic, templateId) {
  if (!getKey()) return { error: 'nokey' };
  const t = templates().find((x) => x.id === templateId) || templates()[0];
  const prompt = `You write viral TikTok photo slideshows for ${APP}
Write ONE slideshow about: ${topic}
Exactly ${t.slides} slides. ${t.write}
Voice: plain words a 14 year old uses, confident, true and useful, no hashtags, no emojis, no jargon.
For each slide also write "scene": what the photo shows (person, exercise, moment), under 20 words.
Return JSON: {"title": "...", "slides": [{"text": "...", "scene": "..."}]}`;
  try {
    const r = await gemini(TEXT_MODEL, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }); bump('writes');
    const txt = ((((r.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
    const j = JSON.parse(txt || '{}');
    const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
    fs.mkdirSync(path.join(DIR, id), { recursive: true });
    const s = { id, at: Date.now(), topic, template: t.id, text: t.text, title: j.title || topic, status: 'draft',
      slides: (j.slides || []).slice(0, t.slides).map((x) => ({ text: String(x.text || ''), scene: String(x.scene || ''), img: '', final: '' })) };
    save(s); return { show: s };
  } catch (e) { return { error: errText(e) }; }
}

// Step 2: you approved (and maybe edited) the slides. Now make the pictures, one per slide.
async function makePictures(id, slidesIn, onChange) {
  if (busy) return { error: 'Already making pictures. Wait for it to finish.' };
  const s = list().find((x) => x.id === id); if (!s) return { error: 'Slideshow not found.' };
  if (Array.isArray(slidesIn)) s.slides = slidesIn.map((x, i) => ({ ...(s.slides[i] || {}), text: String(x.text || ''), scene: String(x.scene || ''), final: '' }));
  const t = templates().find((x) => x.id === s.template) || templates()[0];
  s.status = 'making'; save(s); busy = true; lastError = ''; onChange();
  (async () => {
    for (let i = 0; i < s.slides.length; i++) {
      const sl = s.slides[i]; if (sl.img) continue;
      try {
        const ir = await gemini(IMAGE_MODEL, { contents: [{ parts: [{ text: `${t.look} Scene: ${sl.scene}. Vertical 9:16 photo.` }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } } });
        const part = ((((ir.candidates || [])[0] || {}).content || {}).parts || []).find((p) => p.inlineData && p.inlineData.data);
        if (!part) throw new Error('No picture came back');
        const f = `photo-${i + 1}.png`; fs.writeFileSync(path.join(DIR, s.id, f), Buffer.from(part.inlineData.data, 'base64'));
        sl.img = f; sl.err = ''; bump('images');
      } catch (e) {
        sl.err = errText(e); lastError = sl.err;
        if (e.message === 'limit') { s.status = 'limit'; break; }
      }
      save(s); onChange();
    }
    if (s.status !== 'limit') s.status = s.slides.every((x) => x.img) ? 'text' : 'partial';
    save(s); busy = false; onChange();
  })();
  return { started: true };
}

function saveFinal(id, i, b64) {
  const s = list().find((x) => x.id === id); if (!s || !s.slides[i]) return false;
  const f = `slide-${i + 1}.png`; fs.writeFileSync(path.join(DIR, id, f), Buffer.from(String(b64).replace(/^data:image\/png;base64,/, ''), 'base64'));
  s.slides[i].final = f; if (s.slides.every((x) => x.final)) s.status = 'ready'; save(s); return true;
}
function remove(id) { const s = list().find((x) => x.id === id); if (!s) return; s.status = 'deleted'; save(s); }

function state() { return { hasKey: !!getKey(), busy, error: lastError, usage: usage(), templates: templates(), shows: list().filter((x) => x.status !== 'deleted').slice(0, 30) }; }
module.exports = { DIR, state, setKey, draft, makePictures, saveFinal, saveTemplate, remove, clearError: () => { lastError = ''; } };
