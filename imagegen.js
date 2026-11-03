// Pictures for slideshows, made with FLUX.2 [klein] on Cloudflare Workers AI.
// FREE: every Cloudflare account gets 10,000 "neurons" a day. On Cloudflare's free plan it can
// never charge you: when the free amount is used up, it just stops until tomorrow.
//   A 864x1536 hook picture ≈ 156 neurons, a 512x512 how-to picture ≈ 26.
//   So one 3-slide post (1 hook + 4 small pictures) ≈ 260 neurons → about 35 posts a day for free.
// Your Cloudflare account ID + token live in content\cloudflare.json on your PC (never on GitHub).
'use strict';
const fs = require('fs');
const path = require('path');

const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const NEURONS_PER_OUT_TILE = 26.05; // per 512x512 output tile (Cloudflare pricing page, Nov 2026)
const FREE_PER_DAY = 10000;

function createImageGen(dir) {
  const CRED = path.join(dir, 'cloudflare.json');
  const USE = path.join(dir, 'neurons.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const creds = () => read(CRED, null);
  const today = () => new Date().toISOString().slice(0, 10); // Cloudflare resets at 00:00 UTC
  const used = () => { const u = read(USE, {}); return u.day === today() ? u : { day: today(), neurons: 0, images: 0, limitHit: false }; };
  const cost = (w, h) => Math.ceil(w / 512) * Math.ceil(h / 512) * NEURONS_PER_OUT_TILE;
  function count(w, h) { const u = used(); u.neurons += cost(w, h); u.images += 1; fs.writeFileSync(USE, JSON.stringify(u)); }
  function limit() { const u = used(); u.limitHit = true; fs.writeFileSync(USE, JSON.stringify(u)); }

  async function call(form) {
    const c = creds(); if (!c) throw Object.assign(new Error('Set up free pictures first'), { code: 'nocreds' });
    const r = await fetch(`${process.env.HQ_CF_BASE || 'https://api.cloudflare.com'}/client/v4/accounts/${encodeURIComponent(c.account)}/ai/run/${MODEL}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + c.token }, body: form, signal: AbortSignal.timeout(120000) });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    if (!r.ok || !j || j.success === false) {
      const msg = (j && j.errors && j.errors.map((e) => e.message).join('; ')) || text.slice(0, 200) || ('HTTP ' + r.status);
      if (r.status === 429 || /neuron|daily|quota|limit|exceeded|4006/i.test(msg)) { limit(); throw Object.assign(new Error('Out of free pictures for today. More tomorrow (it resets at 7 pm your time). Nothing was charged.'), { code: 'limit' }); }
      if (r.status === 401 || r.status === 403 || /auth|token/i.test(msg)) throw Object.assign(new Error('Cloudflare said the token or account ID is wrong. Set up free pictures again.'), { code: 'auth' });
      throw new Error('Cloudflare said: ' + msg);
    }
    const b64 = (j.result && (j.result.image || (j.result.images && j.result.images[0]))) || '';
    if (!b64) throw new Error('Cloudflare sent no picture back');
    return Buffer.from(b64, 'base64');
  }

  // prompt → PNG/JPEG bytes. refs: up to 4 small reference images (Buffers, each under 512x512).
  async function generate({ prompt, width, height, seed, refs }) {
    const w = Math.max(256, Math.min(1920, Math.round((width || 1024) / 16) * 16));
    const h = Math.max(256, Math.min(1920, Math.round((height || 1024) / 16) * 16));
    const form = new FormData();
    form.append('prompt', String(prompt).slice(0, 2000));
    form.append('width', String(w)); form.append('height', String(h));
    if (seed !== undefined) form.append('seed', String(seed));
    (refs || []).slice(0, 4).forEach((buf, i) => form.append('input_image_' + i, new Blob([buf], { type: 'image/png' }), 'ref' + i + '.png'));
    const out = await call(form);
    count(w, h);
    return out;
  }

  // Check a token works (makes one tiny 256x256 picture ≈ 26 neurons).
  async function test() { await generate({ prompt: 'a red apple on a white table, studio photo', width: 256, height: 256, seed: 1 }); return true; }

  function save(account, token) {
    const a = String(account || '').trim(), t = String(token || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(a)) return { error: 'The Account ID is 32 letters and numbers. Copy it again from Cloudflare.' };
    if (t.length < 20) return { error: 'That token looks too short. Copy the whole token.' };
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(CRED, JSON.stringify({ account: a, token: t })); return { ok: true };
  }

  return { generate, test, save, cost, has: () => !!creds(), usage: () => ({ ...used(), free: FREE_PER_DAY, postsLeft: Math.max(0, Math.floor((FREE_PER_DAY - used().neurons) / (cost(864, 1536) + 4 * cost(512, 512)))) }) };
}

module.exports = { createImageGen, MODEL };
