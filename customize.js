// Ari's changes to the Claude Design export. update-design.js runs these on every new export.
// If one stops matching after a redesign, it's skipped and listed so you know.
module.exports = function customize(tpl) {
  const skipped = [];
  // Never apply the same change twice (some changes contain the original text).
  const swap = (name, from, to) => { if (tpl.includes(to)) return; if (tpl.includes(from)) tpl = tpl.split(from).join(to); else skipped.push(name); };

  swap('fill the whole window',
    '<div style="position:relative; width:1440px; height:100vh;',
    '<div style="position:relative; width:100vw; height:100vh;');

  // Date pill and map sit a bit lower so the window buttons don't touch them.
  swap('date pill lower', 'position:absolute; right:28px; top:32px; z-index:6;', 'position:absolute; right:28px; top:50px; z-index:6;');
  swap('map lower', 'position:absolute; right:28px; top:82px; z-index:6;', 'position:absolute; right:28px; top:100px; z-index:6;');

  // Project pill: just the name, no letter box.
  swap('project pill letter', '<span style="width:26px; height:26px; border-radius:8px; background:#ffffff; color:#1d2128; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600;">{{ projInitial }}</span>', '');
  swap('project pill padding', 'gap:9px; height:38px; padding:0 10px 0 6px;', 'gap:9px; height:38px; padding:0 12px 0 16px;');

  // Project switcher: just the name, centered, no letter box.
  swap('switcher letter', '<span style="width:32px; height:32px; border-radius:10px; background:#ffffff; color:#1d2128; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:600;">{{ p.initial }}</span>', '');
  swap('switcher centered', '<div style="align-self:stretch; display:flex; justify-content:space-between; align-items:center;">', '<div style="align-self:stretch; display:flex; justify-content:center; align-items:center; gap:8px;">');

  // No "Arrow keys to fly" hint.
  swap('fly hint', '<sc-if value="{{ flyHint }}" hint-placeholder-val="{{ true }}">', '<sc-if value="{{ false }}" hint-placeholder-val="{{ false }}">');

  // Ari's lists: show just the title. Click a row to open the details and button.
  for (const v of ['d', 'n', 'im']) {
    const list = v === 'd' ? 'ari.doNow' : v === 'n' ? 'ari.next' : 'ari.important';
    swap('ari ' + list + ' click to open',
      '<sc-for list="{{ ' + list + ' }}" as="' + v + '" hint-placeholder-count="2">\n          <div style="display:flex; align-items:flex-start; gap:11px; padding:12px;',
      '<sc-for list="{{ ' + list + ' }}" as="' + v + '" hint-placeholder-count="2">\n          <div sc-camel-on-click="{{ ' + v + '.toggleOpen }}" style="cursor:pointer; display:flex; align-items:flex-start; gap:11px; padding:12px;');
  }

  // Ari gets his own colors (green), not Window B's blue.
  swap('ari avatar color',
    '<span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, #2b4f9e 8%, #7aa6ff 36%, #f0f5ff 50%, #a6e0ff 66%, #4a6fd0 92%);',
    '<span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, #1e6b52 8%, #5ed6a0 36%, #effff7 50%, #c8f07a 66%, #3f8a3a 92%);');

  // Window panel: a "Full output" button under the summary.
  swap('full output button',
    '<div style="font-size:15px; line-height:1.45;">{{ fs.explain }}</div>',
    '<div style="font-size:15px; line-height:1.45;">{{ fs.explain }}</div><button sc-camel-on-click="{{ fs.openOutput }}" style="align-self:flex-start; margin-top:10px; display:flex; align-items:center; gap:6px; height:32px; padding:0 12px; border:0; border-radius:10px; cursor:pointer; background:rgba(255,255,255,0.16); color:#ffffff; font-size:12.5px; font-weight:500; box-shadow:inset 0 1px 0 rgba(255,255,255,0.4);"><span style="font-family:\'Material Symbols Rounded\'; font-size:16px; line-height:1;">article</span>Full output</button>');

  // A spinning ring next to "Working" on the window cards and panel, so you can see it's alive.
  swap('card working spinner',
    '<span style="position:relative; width:7px; height:7px; border-radius:50%; background:{{ c.color }};"><span style="position:absolute; inset:0; border-radius:50%; background:{{ c.color }}; animation:{{ c.ping }};"></span></span>{{ c.label }}',
    '<span style="position:relative; width:{{ c.dotSize }}px; height:{{ c.dotSize }}px; border-radius:50%; background:{{ c.dotBg }}; animation:{{ c.dotSpin }};"><span style="position:absolute; inset:{{ c.dotInset }}px; border-radius:50%; background:{{ c.dotHole }}; animation:{{ c.ping }};"></span></span>{{ c.label }}');

  // Ari and Pulse are drawn by HQ itself (hq-live.js), so hide the design's versions.
  swap('hide design ari panel', '<sc-if value="{{ ariOn }}" hint-placeholder-val="{{ false }}">', '<sc-if value="{{ false && ariOn }}" hint-placeholder-val="{{ false }}">');
  swap('pulse subtitle', 'Usage, builds and code across your windows', 'Merges, builds and your terminal');
  swap('hide design pulse grid', '<div style="flex:1; min-height:0; display:grid; grid-template-columns:0.9fr 1fr 1.1fr;', '<div style="visibility:hidden; flex:1; min-height:0; display:grid; grid-template-columns:0.9fr 1fr 1.1fr;');

  return { tpl, skipped };
};

// Same idea for the 3D city script.
module.exports.js = function customizeJs(js) {
  if (js.includes("makeRobot('pilot', 1)") && js.includes('const PALETTES = [')) {
    js = js.replace("const PALETTES = [", "const PALETTES = [\n    ['#1e6b52', '#5ed6a0', '#effff7', '#c8f07a', '#3f8a3a'],");
    // the new green palette is index 0, so every other index moves up by one
    js = js.replace(/makeRobot\(s\.id, s\.palette \|\| 0\)/, 'makeRobot(s.id, (s.palette || 0) + 1)');
    js = js.replace("makeRobot('pilot', 1)", "makeRobot('pilot', 0)");
    js = js.replace("{ key: 'vault', name: 'Idea Vault', icon: 'lightbulb'", "{ key: 'vault', name: 'Content', icon: 'slideshow'");
    js = js.replace("{ key: 'dock', name: 'Shipping Dock', icon: 'local_shipping'", "{ key: 'dock', name: 'Watchdog', icon: 'shield'");
    js = js.replace("r.label.lastChild.style.background = '#9fe6ff'; r.label.lastChild.style.boxShadow = '0 0 8px #9fe6ff';", "r.label.lastChild.style.background = '#7ff0b0'; r.label.lastChild.style.boxShadow = '0 0 8px #7ff0b0';");
  }
  // The TV on the UFO plays a live "space show" with a news ticker of your real windows.
  if (js.includes('function drawTV(cv, sessions, tv) {') && !js.includes('function drawShow(')) {
    js = js.replace('function drawTV(cv, sessions, tv) {', `function drawShow(cv, t, sessions, tv) {
  const c = cv.getContext('2d'); const w = cv.width, h = cv.height;
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0b1030'); g.addColorStop(1, '#1a0f2e'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { const sp = 8 + (i % 5) * 9; const x = ((i * 137.5 + t * sp) % (w + 20)) - 10, y = (i * 61.7) % (h - 90); c.fillStyle = 'rgba(255,255,255,' + (0.25 + (i % 4) * 0.18) + ')'; c.fillRect(w - x, y, i % 7 === 0 ? 3 : 2, i % 7 === 0 ? 3 : 2); }
  const px = w * 0.72, py = h * 0.42, pr = 92;
  const pg = c.createRadialGradient(px - 30, py - 30, 10, px, py, pr); pg.addColorStop(0, '#ffd59a'); pg.addColorStop(1, '#c4683a'); c.fillStyle = pg; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill();
  c.save(); c.translate(px, py); c.rotate(-0.35); c.strokeStyle = 'rgba(255,225,180,0.75)'; c.lineWidth = 9; c.beginPath(); c.ellipse(0, 0, pr * 1.7, pr * 0.42, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke(); c.restore();
  const ux = ((t * 70) % (w + 260)) - 130, uy = h * 0.3 + Math.sin(t * 2.2) * 18;
  c.fillStyle = 'rgba(180,255,170,0.18)'; c.beginPath(); c.moveTo(ux - 26, uy + 10); c.lineTo(ux + 26, uy + 10); c.lineTo(ux + 52, uy + 120); c.lineTo(ux - 52, uy + 120); c.fill();
  c.fillStyle = '#d8e2ec'; c.beginPath(); c.ellipse(ux, uy, 56, 15, 0, 0, 7); c.fill(); c.fillStyle = '#b6e07a'; c.beginPath(); c.ellipse(ux, uy - 12, 24, 20, 0, Math.PI, 0); c.fill();
  c.fillStyle = '#ff4d4f'; c.beginPath(); c.arc(42, 44, 9, 0, 7); c.fill(); c.font = F(600, 24); c.fillStyle = '#ffffff'; c.fillText('LIVE', 60, 53);
  c.font = F(500, 24); c.fillStyle = 'rgba(255,255,255,0.75)'; c.textAlign = 'right'; c.fillText('HQ TV', w - 36, 53); c.textAlign = 'left';
  c.font = F(600, 40); c.fillStyle = '#ffffff'; c.fillText((tv.name || 'HQ') + ' \\u00b7 ' + (tv.pct ?? 0) + '% to App Store', 42, h - 120);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, h - 72, w, 72);
  const items = sessions.map((s) => s.name + ': ' + (s.status === 'working' ? 'working ' + s.pct + '%' : LABEL[s.status])).concat([(tv.name || 'HQ') + ' launch ' + (tv.pct ?? 0) + '%']);
  const msg = items.join('   \\u2022   ') + '   \\u2022   '; c.font = F(500, 28); const mw = c.measureText(msg).width || 1; const off = (t * 90) % mw;
  c.fillStyle = '#ffffff'; for (let x = -off; x < w; x += mw) c.fillText(msg, 24 + x, h - 26);
}
function drawTV(cv, sessions, tv) {`);
    js = js.replace('if (tk !== tvKey) { tvKey = tk; drawTV(tvCv, data.sessions || [], data.tv || {}); tvTex.needsUpdate = true; }', 'tvKey = tk;');
    js = js.replace('    ENVS[loc].tick(dt, t);\n', '    ENVS[loc].tick(dt, t);\n    if (!frame._tv || t - frame._tv > 1 / 15) { frame._tv = t; drawShow(tvCv, t, data.sessions || [], data.tv || {}); tvTex.needsUpdate = true; }\n');
  }
  return js;
};
