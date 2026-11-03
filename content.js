// Content bot: makes TikTok-style slideshows for your app with Gemini.
// Gemini writes the slides (text model) and makes the pictures (image model), using YOUR free key.
// HQ then puts the text on each picture (in the HQ window) and saves finished 9:16 slides.
// Everything lives in C:\Users\arize\hq\content\ . The key lives in content\gemini.key (never on GitHub).
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, 'content');
const KEY_FILE = path.join(DIR, 'gemini.key');
const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// The locked template. Change these words to change every future slideshow.
const BRIEF = {
  app: 'FormPal',
  what: 'an iPhone app that watches your reps through the camera, counts them, and tells you when your form is off, plus a personal workout plan',
  who: 'beginner lifters (teens to 30s) who are new to the gym',
  slides: 6,
  formula: 'Slide 1 is a scroll-stopping hook (max 10 words). Slides 2 to 5 each give ONE concrete, useful point (max 18 words each). Slide 6 says FormPal checks every rep for you, link in bio (max 14 words).',
  voice: 'plain words a 14 year old uses, confident, no hashtags, no emojis, no jargon',
  look: 'Realistic iPhone photo, candid, slightly grainy, dim modern gym with natural light, one person in plain athletic wear, shot from the side at chest height, no text, no logos, no watermarks, not glossy, not stock-photo looking',
};

fs.mkdirSync(DIR, { recursive: true });
const getKey = () => { try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; } };
const setKey = (k) => fs.writeFileSync(KEY_FILE, String(k || '').trim());

function gemini(model, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({ host: 'generativelanguage.googleapis.com', path: `/v1beta/models/${model}:generateContent`, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-goog-api-key': getKey() } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch {}
        if (res.statusCode === 429) return reject(new Error('limit'));
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
  return dirs.map((d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, d, 'show.json'), 'utf8')); } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.at - a.at);
};
const save = (s) => fs.writeFileSync(path.join(DIR, s.id, 'show.json'), JSON.stringify(s, null, 2));

let busy = false;
async function make(count, onChange) {
  if (busy) return { error: 'Already making slideshows.' };
  if (!getKey()) return { error: 'nokey' };
  busy = true;
  (async () => {
    try {
      const past = list().slice(0, 30).map((s) => s.title);
      const prompt = `You write viral TikTok photo slideshows for ${BRIEF.app}: ${BRIEF.what}. Audience: ${BRIEF.who}.
Write ${count} different slideshows. Each has exactly ${BRIEF.slides} slides. ${BRIEF.formula}
Voice: ${BRIEF.voice}. Every point must be true and useful. Pick a different exercise or lifting mistake for each slideshow.
Don't repeat these past titles: ${past.join(' | ') || 'none'}.
For each slide also write "scene": what the photo shows (the person, the exercise, the moment), in under 20 words.
Return JSON: [{"title": "...", "exercise": "...", "slides": [{"text": "...", "scene": "..."}]}]`;
      const r = await gemini(TEXT_MODEL, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } });
      const txt = (((r.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '[]';
      let shows = []; try { shows = JSON.parse(txt); } catch {}
      for (const sh of shows.slice(0, count)) {
        const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
        fs.mkdirSync(path.join(DIR, id), { recursive: true });
        const s = { id, at: Date.now(), title: sh.title, exercise: sh.exercise, status: 'making', slides: (sh.slides || []).slice(0, BRIEF.slides).map((x) => ({ text: x.text, scene: x.scene, img: '', final: '' })) };
        save(s); onChange();
        for (let i = 0; i < s.slides.length; i++) {
          const sl = s.slides[i];
          try {
            const ir = await gemini(IMAGE_MODEL, { contents: [{ parts: [{ text: `${BRIEF.look}. Scene: ${sl.scene}. Vertical 9:16.` }] }],
              generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } } });
            const part = ((((ir.candidates || [])[0] || {}).content || {}).parts || []).find((p) => p.inlineData && p.inlineData.data);
            if (!part) throw new Error('No image came back');
            const f = `photo-${i + 1}.png`; fs.writeFileSync(path.join(DIR, id, f), Buffer.from(part.inlineData.data, 'base64'));
            sl.img = f;
          } catch (e) {
            sl.err = e.message === 'limit' ? 'Out of free images for today' : e.message;
            if (e.message === 'limit') { s.status = 'limit'; save(s); onChange(); throw e; }
          }
          save(s); onChange();
        }
        s.status = s.slides.every((x) => x.img) ? 'needs-text' : 'partial'; save(s); onChange();
      }
    } catch (e) { lastError = e.message === 'limit' ? 'Out of free Gemini images for today. Try again tomorrow.' : e.message; }
    busy = false; onChange();
  })();
  return { started: true };
}
let lastError = '';

// The HQ window sends back each finished slide (picture + text drawn on it).
function saveFinal(id, i, b64) {
  const s = list().find((x) => x.id === id); if (!s || !s.slides[i]) return false;
  const f = `slide-${i + 1}.png`; fs.writeFileSync(path.join(DIR, id, f), Buffer.from(String(b64).replace(/^data:image\/png;base64,/, ''), 'base64'));
  s.slides[i].final = f; if (s.slides.every((x) => x.final || !x.img)) s.status = 'ready'; save(s); return true;
}

function state() { return { hasKey: !!getKey(), busy, error: lastError, shows: list().slice(0, 30) }; }
function clearError() { lastError = ''; }

module.exports = { DIR, state, make, setKey, saveFinal, clearError, BRIEF };
