// Draws the finished 1080x1920 slides for the "Hack → How to → App" template.
// All text is drawn here (never by AI), so it's always sharp and spelled right.
// TikTok covers the edges with buttons, so text stays inside the safe area:
//   top 150 px, bottom 320 px (caption), right 120 px (like/comment buttons).
(function () {
  const W = 1080, H = 1920;
  const SAFE = { top: 150, bottom: H - 320, left: 80, right: W - 140 };
  const FONT = '"Bricolage Grotesque", "Arial Black", "Segoe UI Black", sans-serif';
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    if (!document.querySelector('link[data-hq-slides]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.hqSlides = '1';
      l.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap';
      document.head.appendChild(l);
    }
    // Wait up to 4 s for the font; if offline, the fallback (Arial Black) is used.
    fontsReady = Promise.race([Promise.all([document.fonts.load('800 80px "Bricolage Grotesque"'), document.fonts.load('700 40px "Bricolage Grotesque"')]), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
    return fontsReady;
  }
  const load = (src) => new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  function cover(g, im, x, y, w, h) { const s = Math.max(w / im.width, h / im.height); const sw = w / s, sh = h / s; g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h); }
  function contain(g, im, x, y, w, h) { const s = Math.min(w / im.width, h / im.height); const dw = im.width * s, dh = im.height * s; g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // Word-wrap at a size; shrink until it fits maxLines and maxH.
  function fit(g, text, weight, maxW, start, min, maxLines, maxH, lh) {
    for (let size = start; size >= min; size -= 2) {
      g.font = `${weight} ${size}px ${FONT}`;
      const lines = []; let line = '';
      for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line);
      const tooWide = lines.some((l) => g.measureText(l).width > maxW);
      if (lines.length <= maxLines && lines.length * size * lh <= maxH && !tooWide) return { size, lines };
    }
    g.font = `${weight} ${min}px ${FONT}`; return { size: min, lines: [String(text)] };
  }
  function badge(g, cx, y, app, icon, accent) {
    g.font = `800 46px ${FONT}`; const tw = g.measureText(app).width; const iw = icon ? 54 : 22; const total = iw + 14 + tw;
    let x = cx - total / 2;
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16;
    if (icon) { g.save(); rr(g, x, y - 27, 54, 54, 14); g.clip(); g.drawImage(icon, x, y - 27, 54, 54); g.restore(); }
    else { g.fillStyle = accent; g.beginPath(); g.arc(x + 11, y, 11, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(app, x + iw + 14, y + 2); g.restore();
  }
  function bottomText(g, text, topLimit) {
    const maxW = SAFE.right - SAFE.left - 40;
    const f = fit(g, text, 800, maxW, 82, 46, 5, SAFE.bottom - topLimit, 1.08);
    const lh = f.size * 1.08; const y0 = SAFE.bottom - f.lines.length * lh;
    g.save(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'top'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 18; g.shadowOffsetY = 3;
    const cx = (SAFE.left + SAFE.right) / 2;
    f.lines.forEach((l, i) => g.fillText(l, cx, y0 + i * lh)); g.restore();
    return y0;
  }
  function darkBottom(g, from) { const gr = g.createLinearGradient(0, from, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.45, 'rgba(0,0,0,.62)'); gr.addColorStop(1, 'rgba(0,0,0,.9)'); g.fillStyle = gr; g.fillRect(0, from, W, H - from); }

  // Slide 1: crazy photo + badge + big caps text.
  function hook(spec, T, I) {
    const c = canvas(), g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    if (I.hook) cover(g, I.hook, 0, 0, W, H);
    darkBottom(g, 900);
    const y0 = bottomText(g, spec.hook.text, 1060);
    badge(g, (SAFE.left + SAFE.right) / 2, y0 - 52, T.brand.app, I.icon, T.brand.accent);
    return c;
  }
  // Slide 2: white page, colored title, numbered steps with one picture each.
  function howto(spec, T, I) {
    const c = canvas(), g = c.getContext('2d'); const A = T.brand.accent;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = A;
    const tf = fit(g, spec.howtoTitle || 'HOW TO DO IT', 800, SAFE.right - SAFE.left, 92, 60, 1, 120, 1.05);
    g.fillText(tf.lines[0], (SAFE.left + SAFE.right) / 2, SAFE.top + 30);
    const top = SAFE.top + 30 + tf.size * 1.05 + 50, bottom = SAFE.bottom, n = spec.steps.length;
    const rowH = (bottom - top) / n; const imgW = 340, textX = SAFE.left + imgW + 36, textW = SAFE.right - textX;
    spec.steps.forEach((st, i) => {
      const y = top + i * rowH;
      const im = I['step' + i];
      if (im) { g.save(); g.globalCompositeOperation = 'multiply'; contain(g, im, SAFE.left, y + 8, imgW, rowH - 16); g.restore(); } // white backgrounds melt into the page
      // Title (colored) + bullets (dark), sized to fit the row.
      const titleText = (i + 1) + '. ' + st.title;
      let ts = 48, bs = 30, tl, bl;
      for (;; ts -= 2, bs = Math.max(22, bs - 1)) {
        g.font = `800 ${ts}px ${FONT}`; tl = fit(g, titleText, 800, textW, ts, ts, 3, 999, 1.08);
        const bh = st.bullets.length * bs * 1.35; const th = tl.lines.length * ts * 1.08;
        if (th + 14 + bh <= rowH - 20 || ts <= 30) { bl = bh; break; }
      }
      const blockH = tl.lines.length * ts * 1.08 + 14 + bl; let ty = y + (rowH - blockH) / 2;
      g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = A; g.font = `800 ${ts}px ${FONT}`;
      tl.lines.forEach((l) => { g.fillText(l, textX, ty); ty += ts * 1.08; }); ty += 14;
      g.fillStyle = '#1A1A1C'; g.font = `700 ${bs}px ${FONT}`;
      st.bullets.forEach((b) => { g.fillText('\u2022 ' + b, textX + 6, ty); ty += bs * 1.35; });
    });
    return c;
  }
  // Slide 3: real app screen in a phone, honest badges, "COMMENT <WORD> ..." text.
  function laurel(g, cx, cy, text) {
    g.save(); g.fillStyle = '#1A1A1C';
    const R = 80;
    for (const side of [-1, 1]) for (let k = 0; k < 7; k++) { // a little wreath of leaves around the words
      const deg = 115 + k * 21; const t = (side < 0 ? deg : 180 - deg) * Math.PI / 180;
      g.save(); g.translate(cx + R * Math.cos(t), cy + R * 0.92 * Math.sin(t)); g.rotate(t + Math.PI / 2 + side * 0.35);
      g.beginPath(); g.ellipse(0, 0, 13, 5.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const f = fit(g, text, 800, 112, 22, 14, 3, 84, 1.1);
    f.lines.forEach((l, i) => g.fillText(l, cx, cy + (i - (f.lines.length - 1) / 2) * f.size * 1.1));
    g.restore();
  }
  function cta(spec, T, I) {
    const c = canvas(), g = c.getContext('2d');
    const bgG = g.createLinearGradient(0, 0, 0, H); bgG.addColorStop(0, '#FBFBFD'); bgG.addColorStop(1, '#E9E9EF'); g.fillStyle = bgG; g.fillRect(0, 0, W, H);
    // Phone
    const pw = 600, ph = 1240, px = 360, py = 210, r = 92;
    g.save(); g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 60; g.shadowOffsetY = 24; g.fillStyle = '#111'; rr(g, px, py, pw, ph, r); g.fill(); g.restore();
    g.save(); rr(g, px + 16, py + 16, pw - 32, ph - 32, r - 16); g.clip(); g.fillStyle = '#fff'; g.fillRect(px, py, pw, ph);
    const screen = I.screenshot || I.hook; if (screen) cover(g, screen, px + 16, py + 16, pw - 32, ph - 32);
    g.restore();
    g.fillStyle = '#111'; rr(g, px + pw / 2 - 70, py + 34, 140, 40, 20); g.fill(); // dynamic island
    // Honest badges on the left (things FormPal really does — never fake awards)
    (T.brand.badges || []).slice(0, 3).forEach((b, i) => laurel(g, 190, 420 + i * 230, b));
    darkBottom(g, 1180);
    bottomText(g, spec.cta, 1300);
    return c;
  }

  async function render(show, T, assets) {
    await loadFonts();
    const s = show.spec; const im = show.images || {};
    const I = { hook: await load(im.hook && im.hook.file ? '/content/' + show.id + '/' + im.hook.file : ''), icon: await load(assets && assets.icon), screenshot: await load(assets && assets.screenshot) };
    for (let i = 0; i < s.steps.length; i++) I['step' + i] = await load(im['step' + i] && im['step' + i].file ? '/content/' + show.id + '/' + im['step' + i].file : '');
    return [hook(s, T, I), howto(s, T, I), cta(s, T, I)];
  }
  window.HQSlides = { render, SAFE, W, H };
})();
