// Content bot: makes TikTok photo slideshows from TEMPLATES.
//   Writing:  Gemini (your free key, text only = free).
//   Pictures: FLUX.2 [klein] on Cloudflare (free daily amount, see imagegen.js).
//   Layout:   HQ draws the text and design itself (exact, sharp, same every time). AI never draws text.
// Everything lives in C:\Users\arize\hq\content\ (keys too; never on GitHub).
'use strict';
const fs = require('fs');
const path = require('path');
const { createImageGen } = require('./imagegen.js');

const DIR = process.env.HQ_CONTENT_DIR || path.join(__dirname, 'content');
const ASSETS = path.join(DIR, 'assets');
const KEY_FILE = path.join(DIR, 'gemini.key');
const TPL_FILE = path.join(DIR, 'templates.json');
const USE_FILE = path.join(DIR, 'usage.json');
const TEXT_MODEL = 'gemini-2.5-flash';
fs.mkdirSync(ASSETS, { recursive: true });
const img = createImageGen(DIR);

// ─── Template 1: "Hack → How to → App" (built from the MenuFit example) ─────
// Slide 1 HOOK: a crazy, eye-catching photo + big white text at the bottom + app badge.
// Slide 2 HOW TO: white page, colored title, numbered steps, one picture per step, 5th-grade words.
// Slide 3 APP: your real app screen in a phone + "COMMENT <WORD> TO GET AN APP THAT ..."
const HACK = {
  id: 'hack', name: 'Hack → How to → App', layout: 'hack3', steps: 4,
  brand: { app: 'FormPal', keyword: 'FORM', accent: '#FF6B00', promise: 'WATCHES EVERY REP AND TELLS YOU WHEN YOUR FORM IS OFF',
    badges: ['COUNTS EVERY REP', 'FIXES YOUR FORM', 'MADE FOR BEGINNERS'] },
  howtoTitle: 'HOW TO DO IT',
  // How the hook picture looks. FLUX.2 rules: subject first, describe what you WANT (it has no "negative" prompts), under ~100 words.
  hookLook: 'Vertical photo for TikTok, photorealistic and candid, shot on an iPhone inside a modern gym, dramatic warm overhead light with deep shadows, vivid saturated colors, high contrast, crisp sharp focus on the main subject, main subject filling the upper two thirds of the frame, the bottom third darker and simpler, real skin texture and natural body proportions, plain unbranded clothes and equipment',
  itemLook: 'single subject centered, isolated on a pure white seamless background, bright even studio softbox lighting, soft natural shadow underneath, crisp detail, commercial product photography, slight three-quarter angle, whole subject in frame with white space around it, plain unbranded equipment',
  personLook: 'plain athletic clothes, face looking away from the camera',
};
const DEFAULT_TEMPLATES = [HACK];

// ─── 5th-grade check (Flesch–Kincaid grade, computed in code, not guessed) ──
function syllables(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, ''); if (!w) return 0; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1);
}
function grade(text) {
  // Every slide line is its own sentence; numbers count as 1-syllable words.
  const sentences = String(text).split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const words = sentences.join(' ').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!words.length) return 0;
  const syl = words.reduce((a, w) => a + (/^\d/.test(w) ? 1 : syllables(w)), 0);
  return Math.max(0, Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59) * 10) / 10);
}
const hardWords = (text) => [...new Set(String(text).split(/[^a-zA-Z']+/).filter((w) => syllables(w) >= 3).map((w) => w.toUpperCase()))];
const allText = (s) => [s.hook.text, s.howtoTitle, ...s.steps.flatMap((x) => [x.title, ...x.bullets]), s.cta].join('\n');

// ─── Files ──────────────────────────────────────────────────────────────────
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const getKey = () => { try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; } };
const setKey = (k) => fs.writeFileSync(KEY_FILE, String(k || '').trim());
function templates() {
  const saved = readJSON(TPL_FILE, []);
  // Your edits to a built-in template are kept; old-style templates from before are dropped.
  return DEFAULT_TEMPLATES.map((d) => { const s = (Array.isArray(saved) ? saved : []).find((x) => x.id === d.id && x.layout === d.layout); return s ? { ...d, ...s, brand: { ...d.brand, ...(s.brand || {}) } } : d; })
    .concat((Array.isArray(saved) ? saved : []).filter((x) => x.layout === 'hack3' && !DEFAULT_TEMPLATES.some((d) => d.id === x.id)));
}
function saveTemplate(t) {
  const all = readJSON(TPL_FILE, []).filter((x) => x && x.layout); const base = templates().find((x) => x.id === t.id) || HACK;
  const b = t.brand || {};
  const clean = { ...base, id: base.id, layout: 'hack3', name: String(t.name || base.name).slice(0, 40), steps: Math.max(2, Math.min(5, Number(t.steps) || base.steps)),
    brand: { app: String(b.app || base.brand.app).slice(0, 30), keyword: String(b.keyword || base.brand.keyword).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'FORM',
      accent: /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : base.brand.accent, promise: String(b.promise || base.brand.promise).toUpperCase().slice(0, 90),
      badges: (Array.isArray(b.badges) ? b.badges : base.brand.badges).map((x) => String(x).toUpperCase().slice(0, 22)).filter(Boolean).slice(0, 3) },
    hookLook: String(t.hookLook || base.hookLook).slice(0, 700), itemLook: String(t.itemLook || base.itemLook).slice(0, 500) };
  const i = all.findIndex((x) => x.id === clean.id); if (i >= 0) all[i] = clean; else all.push(clean);
  fs.writeFileSync(TPL_FILE, JSON.stringify(all, null, 2)); return clean;
}
// Your real app screenshot (for the phone on slide 3) and app icon (for the badge).
function saveAsset(kind, b64) {
  if (!['screenshot', 'icon'].includes(kind)) return false;
  const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64'); if (buf.length < 100) return false;
  fs.writeFileSync(path.join(ASSETS, kind + '.png'), buf); return true;
}
const assets = () => ({ screenshot: fs.existsSync(path.join(ASSETS, 'screenshot.png')) ? '/content/assets/screenshot.png' : '', icon: fs.existsSync(path.join(ASSETS, 'icon.png')) ? '/content/assets/icon.png' : '' });

const today = () => new Date().toISOString().slice(0, 10);
function usage() { const u = readJSON(USE_FILE, {}); return u.date === today() ? u : { date: today(), writes: 0, checks: 0, limitHit: false }; }
function bump(k) { const u = usage(); if (k === 'limitHit') u.limitHit = true; else u[k] = (u[k] || 0) + 1; fs.writeFileSync(USE_FILE, JSON.stringify(u)); }

// ─── Gemini (text only, free) ────────────────────────────────────────────────
async function gemini(body) {
  const base = process.env.HQ_GEMINI_BASE || 'https://generativelanguage.googleapis.com';
  let r;
  try { r = await fetch(`${base}/v1beta/models/${TEXT_MODEL}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }); }
  catch (e) { throw new Error(/abort|timeout/i.test(e.name + e.message) ? 'Gemini took too long' : 'Can\u2019t reach Gemini (' + e.message + ')'); }
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 429) { bump('limitHit'); throw new Error('limit'); }
  if (r.status >= 400) throw new Error((j.error && j.error.message) || 'Gemini error ' + r.status);
  return ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
}
const askJSON = async (prompt, images) => {
  const parts = [{ text: prompt }, ...(images || []).map((b) => ({ inlineData: { mimeType: 'image/png', data: b.toString('base64') } }))];
  const t = await gemini({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } });
  return JSON.parse(t);
};
const errText = (e) => (e.message === 'limit' ? 'Out of free Gemini writing for now. Try again in a while. Nothing was charged.' : 'Gemini said: ' + e.message);

// ─── Writing a slideshow ─────────────────────────────────────────────────────
function writerPrompt(t, topic, fix) {
  const n = t.steps; const B = t.brand;
  return `You write viral TikTok photo slideshows for ${B.app}: an iPhone app that ${B.promise.toLowerCase()}. It's for beginners in the gym.

FORMAT (copy it exactly, it's proven):
Slide 1 = HOOK. A crazy, eye-catching photo + one big line of text in CAPS.
  Text formula: "THIS [very specific workout, move or fix] [a surprising but TRUE result with a number]".
  Examples of the shape (don't copy): "THIS 4-MOVE LEG DAY HITS EVERY LEG MUSCLE IN 25 MINUTES" / "THIS 1 SQUAT FIX MAKES EVERY REP COUNT".
  It's about training and form (our app's world). Never about food.
Slide 2 = HOW TO. Exactly ${n} numbered steps. Steps 1 to ${n - 1} are actions ("DO 3 SETS OF GOBLET SQUATS") with 1 or 2 short bullets each (reps, or one form tip). Step ${n} is always "THAT'S IT" with 1 bullet giving the total (minutes, sets or reps).
  Every step has a "picture": ONE thing shown alone on a white background (a piece of equipment, or one person doing the move, side view).
Slide 3 = APP. (HQ writes this slide. You don't.)

RULES:
- 5th-grade reading level. Short, common words. Most words 1 or 2 syllables. Numbers as digits.
- ALL CAPS for every slide line. No emojis, no hashtags on the slides.
- Hook: max 14 words. Step titles: max 7 words. Bullets: max 6 words.
- Only say things that are TRUE for any healthy beginner. No calories, no "lose X pounds", no medical claims, no made-up studies or stats. Numbers can only be sets, reps, minutes, moves or days.
- The hook picture: the most dramatic real-gym version of the hook (the move at its hardest point, close up, intense). Describe only WHAT is in the photo (subject + action), max 25 words. No text or logos in it.
- Step pictures: max 15 words each, just the object or the person + move.
- Caption: 1 short line that makes people comment, then 4 hashtags.

TOPIC: ${topic}
${fix ? '\nFIX THIS FROM YOUR LAST TRY: ' + fix + '\n' : ''}
Return ONLY JSON:
{"title":"short name for this post","hook":{"text":"...","picture":"..."},"steps":[{"title":"...","bullets":["..."],"picture":"..."}],"caption":"...","hashtags":["#..."]}`;
}
function tidy(t, j) {
  const caps = (x, max) => String(x || '').toUpperCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, max).join(' ');
  const steps = (Array.isArray(j.steps) ? j.steps : []).slice(0, t.steps).map((s, i, arr) => ({
    title: caps(s.title, 8).replace(/^\d+[.)]\s*/, ''), bullets: (Array.isArray(s.bullets) ? s.bullets : [s.bullets]).filter(Boolean).slice(0, 2).map((b) => caps(b, 7).replace(/^[•\-–]\s*/, '')),
    picture: String(s.picture || '').slice(0, 160) || (i === arr.length - 1 ? 'a black stopwatch' : 'a pair of black dumbbells') }));
  return { title: String(j.title || 'Slideshow').slice(0, 60), hook: { text: caps(j.hook && j.hook.text, 16), picture: String((j.hook && j.hook.picture) || '').slice(0, 240) },
    howtoTitle: t.howtoTitle, steps, cta: `COMMENT "${t.brand.keyword}" TO GET AN APP THAT ${t.brand.promise}`,
    caption: String(j.caption || '').slice(0, 300), hashtags: (Array.isArray(j.hashtags) ? j.hashtags : []).map((h) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).slice(0, 5) };
}
function problems(t, s) {
  const p = [];
  if (!s.hook.text) p.push('the hook text is missing');
  if (s.steps.length !== t.steps) p.push(`there must be exactly ${t.steps} steps`);
  if (s.steps.length && !/THAT.?S IT/.test(s.steps[s.steps.length - 1].title)) p.push(`step ${t.steps} must be "THAT'S IT"`);
  if (/CALORIE|POUND|LBS|KG|STUDY|SCIENCE|DOCTOR|INJUR/.test(allText(s))) p.push('remove claims about calories, weight loss, studies or injuries');
  // 5th grade: the whole post AND every single line (one hard line hides in an average).
  const g = grade(allText(s)); const hardLines = allText(s).split('\n').filter((l) => l.trim() && !/^COMMENT "/.test(l) && grade(l) > 9);
  if (g > 5 || hardLines.length) p.push(`reading level is too hard${hardLines.length ? ' in: ' + hardLines.slice(0, 3).map((l) => '"' + l + '"').join(', ') : ' (grade ' + g + ')'}; it must be 5th grade. Swap long words for short ones: ${hardWords(hardLines.join(' ') || allText(s)).slice(0, 8).join(', ')}`);
  return p;
}

const list = () => {
  let dirs = []; try { dirs = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'show.json'))); } catch {}
  return dirs.map((d) => readJSON(path.join(DIR, d, 'show.json'), null)).filter(Boolean).sort((a, b) => b.at - a.at);
};
const save = (s) => fs.writeFileSync(path.join(DIR, s.id, 'show.json'), JSON.stringify(s, null, 2));
let busy = false, lastError = '';

async function draft(topic, templateId) {
  if (!getKey()) return { error: 'nokey' };
  const t = templates().find((x) => x.id === templateId) || templates()[0];
  try {
    let s = tidy(t, await askJSON(writerPrompt(t, topic))); bump('writes');
    let p = problems(t, s);
    if (p.length) { // one automatic second try with the exact problems
      const s2 = tidy(t, await askJSON(writerPrompt(t, topic, p.join('; ')))); bump('writes');
      if (problems(t, s2).length <= p.length) { s = s2; p = problems(t, s2); }
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
    fs.mkdirSync(path.join(DIR, id), { recursive: true });
    const show = { id, at: Date.now(), v: 2, topic, template: t.id, title: s.title, status: 'draft', spec: s, images: {}, finals: [], grade: grade(allText(s)), warnings: p };
    save(show); return { show };
  } catch (e) { return { error: errText(e) }; }
}
async function ideas(templateId) {
  if (!getKey()) return { error: 'nokey' };
  const t = templates().find((x) => x.id === templateId) || templates()[0];
  try {
    const j = await askJSON(`Give 8 topic ideas for TikTok slideshows in this format: a hook "THIS [specific workout/move/form fix] [true result with a number]", then a ${t.steps}-step how-to. For beginners in the gym. Mix: leg day, chest, back, arms, glutes, form fixes, home dumbbell workouts, 20-minute workouts. 5th-grade words. Return ONLY JSON {"ideas":["..."]}`); bump('writes');
    return { ideas: (j.ideas || []).map(String).slice(0, 8) };
  } catch (e) { return { error: errText(e) }; }
}

// ─── Pictures ────────────────────────────────────────────────────────────────
const PERSON = /\b(person|man|woman|guy|girl|lifter|athlete|someone|he|she|they)\b/i;
function promptFor(t, slot, s) {
  if (slot === 'hook') return `${s.hook.picture}. ${t.hookLook}${PERSON.test(s.hook.picture) ? ', ' + t.personLook : ''}.`;
  const st = s.steps[Number(slot.slice(4))]; const what = st.picture;
  return `${what}, ${t.itemLook}${PERSON.test(what) ? ', full body visible, ' + t.personLook : ''}.`;
}
const slotsOf = (s) => ['hook', ...s.steps.map((_, i) => 'step' + i)];
const sizeOf = (slot) => (slot === 'hook' ? [864, 1536] : [512, 512]);

// Free picture check with Gemini's eyes: text, broken bodies, wrong background. One redo max.
async function check(slot, buf) {
  if (!getKey()) return { ok: true };
  try {
    const j = await askJSON(`You check AI pictures for a TikTok slideshow. Look for: any readable text, letters, numbers, logos or watermarks; a person with extra, missing or bent-wrong arms, legs, hands or fingers; warped or melted gym equipment${slot === 'hook' ? '' : '; a background that is not plain white; the subject cut off at the edge'}. Small imperfections are fine. Return ONLY JSON {"ok":true|false,"problem":"short, or empty"}`, [buf]);
    bump('checks'); return { ok: j.ok !== false, problem: String(j.problem || '') };
  } catch (e) { return { ok: true }; } // if the checker can't run, don't block
}

async function makePictures(id, specIn, onChange, only) {
  if (busy) return { error: 'Already making pictures. Wait for it to finish.' };
  const sh = list().find((x) => x.id === id); if (!sh || sh.v !== 2) return { error: 'Slideshow not found.' };
  if (!img.has()) return { error: 'nocf' };
  const t = templates().find((x) => x.id === sh.template) || templates()[0];
  if (specIn) { // your edits: changed pictures get remade, finished slides get redrawn
    const old = sh.spec; sh.spec = { ...old, ...specIn, cta: old.cta, howtoTitle: old.howtoTitle };
    for (const sl of slotsOf(sh.spec)) if (promptFor(t, sl, sh.spec) !== (sh.images[sl] || {}).prompt) delete sh.images[sl];
    sh.grade = grade(allText(sh.spec)); sh.warnings = problems(t, sh.spec);
  }
  if (only) delete sh.images[only];
  sh.finals = []; sh.status = 'making'; save(sh); busy = true; lastError = ''; onChange();
  (async () => {
    for (const sl of slotsOf(sh.spec)) {
      if (sh.images[sl] && sh.images[sl].file) continue;
      const [w, h] = sizeOf(sl); const prompt = promptFor(t, sl, sh.spec);
      try {
        let buf = null, note = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const seed = Math.floor(Math.random() * 1e9);
          buf = await img.generate({ prompt, width: w, height: h, seed });
          const q = await check(sl, buf);
          if (q.ok) { note = ''; break; }
          note = q.problem;
        }
        const file = `${sl}-${Date.now().toString(36)}.png`; fs.writeFileSync(path.join(DIR, sh.id, file), buf);
        sh.images[sl] = { file, prompt, note };
      } catch (e) {
        sh.images[sl] = { file: '', prompt, err: e.message }; lastError = e.message;
        if (e.code === 'limit' || e.code === 'auth' || e.code === 'nocreds') { sh.status = 'stopped'; break; }
      }
      save(sh); onChange();
    }
    if (sh.status !== 'stopped') sh.status = slotsOf(sh.spec).every((sl) => sh.images[sl] && sh.images[sl].file) ? 'layout' : 'partial';
    save(sh); busy = false; onChange();
  })();
  return { started: true };
}
// Use your own picture for one spot (from your phone, Gemini app, anywhere).
function uploadPicture(id, slot, b64) {
  const sh = list().find((x) => x.id === id); if (!sh || sh.v !== 2 || !slotsOf(sh.spec).includes(slot)) return false;
  const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64'); if (buf.length < 100) return false;
  const file = `${slot}-own-${Date.now().toString(36)}.png`; fs.writeFileSync(path.join(DIR, sh.id, file), buf);
  sh.images[slot] = { file, prompt: (sh.images[slot] || {}).prompt || '', own: true }; sh.finals = [];
  sh.status = slotsOf(sh.spec).every((sl) => sh.images[sl] && sh.images[sl].file) ? 'layout' : sh.status === 'draft' ? 'draft' : 'partial';
  save(sh); return true;
}

function saveFinal(id, i, b64) {
  const sh = list().find((x) => x.id === id); if (!sh) return false;
  const f = `slide-${i + 1}.png`; fs.writeFileSync(path.join(DIR, id, f), Buffer.from(String(b64).replace(/^data:image\/png;base64,/, ''), 'base64'));
  if (sh.v === 2) { sh.finals = sh.finals || []; sh.finals[i] = f; if ([0, 1, 2].every((k) => sh.finals[k])) sh.status = 'ready'; }
  else { if (!sh.slides[i]) return false; sh.slides[i].final = f; if (sh.slides.every((x) => x.final)) sh.status = 'ready'; }
  save(sh); return true;
}
function remove(id) { const s = list().find((x) => x.id === id); if (!s) return; s.status = 'deleted'; save(s); }

function state() {
  return { hasKey: !!getKey(), hasPictures: img.has(), busy, error: lastError, usage: usage(), pictures: img.usage(), assets: assets(),
    templates: templates(), shows: list().filter((x) => x.status !== 'deleted').slice(0, 30) };
}
module.exports = { DIR, ASSETS, state, setKey, draft, ideas, makePictures, uploadPicture, saveAsset, saveFinal, saveTemplate, remove,
  setPictures: (a, t) => img.save(a, t), testPictures: () => img.test(), clearError: () => { lastError = ''; },
  _test: { grade, syllables, hardWords, tidy, problems, writerPrompt, promptFor, HACK } };
