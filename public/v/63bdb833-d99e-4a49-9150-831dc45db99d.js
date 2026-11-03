const THREE = await import(window.__resources.threeLib);

const STATUS = { working: 0x4cc983, needs: 0xf5934a, testing: 0x8fc2ff, done: 0xffffff, idle: 0x9aa3ad };
const HEX = (n) => '#' + n.toString(16).padStart(6, '0');
const pol = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
const DESK_ANG = [211, 239];
const THEMES = {
  morning: { hemi: [0xfff0e0, 0x5c665e, 1.0], sun: [0xffd8b0, 2.5, [-9, 10, 8]], exp: 1.0, lamp: 0.4 },
  afternoon: { hemi: [0xffffff, 0x6a7a6c, 1.1], sun: [0xffffff, 2.6, [7, 16, 9]], exp: 1.05, lamp: 0 },
  evening: { hemi: [0xffd2b4, 0x4a4658, 0.85], sun: [0xff9d62, 2.2, [-11, 6, 5]], exp: 1.0, lamp: 3.5 },
  night: { hemi: [0x8a9ac8, 0x141a26, 0.5], sun: [0xa9b8ff, 0.7, [5, 14, 7]], exp: 1.1, lamp: 6 },
};

function rbox(w, h, d, r, mat) {
  const bs = Math.min(r * 0.85, h * 0.45, w * 0.45, d * 0.45);
  const rr = Math.max(0.0005, r - bs);
  const sw = w - 2 * bs, sd = d - 2 * bs;
  const s = new THREE.Shape(); const x = -sw / 2, y = -sd / 2;
  s.moveTo(x + rr, y); s.lineTo(x + sw - rr, y); s.quadraticCurveTo(x + sw, y, x + sw, y + rr);
  s.lineTo(x + sw, y + sd - rr); s.quadraticCurveTo(x + sw, y + sd, x + sw - rr, y + sd);
  s.lineTo(x + rr, y + sd); s.quadraticCurveTo(x, y + sd, x, y + sd - rr); s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
  const depth = Math.max(0.0005, h - 2 * bs);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bs, bevelSize: bs, bevelSegments: 10, curveSegments: 20 });
  g.rotateX(-Math.PI / 2); g.translate(0, -depth / 2, 0); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
function disc(r, h, edge, mat, seg = 128) {
  const pts = []; const n = 10;
  pts.push(new THREE.Vector2(0, -h / 2));
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(r - edge + Math.cos(a) * edge, -h / 2 + edge + Math.sin(a) * edge)); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(r - edge + Math.cos(a) * edge, h / 2 - edge + Math.sin(a) * edge)); }
  pts.push(new THREE.Vector2(0, h / 2));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat); m.castShadow = true; m.receiveShadow = true; return m;
}

function makeEnv(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), new THREE.MeshBasicMaterial({ color: 0x8c949c, side: THREE.BackSide })));
  const panel = (w, h, c, p, r) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(...p); m.rotation.set(...r); s.add(m); };
  panel(14, 14, 0xffffff, [0, 9.5, 0], [Math.PI / 2, 0, 0]);
  panel(10, 6, 0xfff1e0, [-14.5, 4, 0], [0, Math.PI / 2, 0]);
  panel(10, 6, 0xe8f0ff, [14.5, 4, 0], [0, -Math.PI / 2, 0]);
  panel(12, 5, 0xffffff, [0, 4, 14.5], [0, Math.PI, 0]);
  const pm = new THREE.PMREMGenerator(renderer); const tex = pm.fromScene(s, 0.03).texture; pm.dispose(); return tex;
}

const F = (wt, px) => `${wt} ${px}px Geist, -apple-system, Helvetica, sans-serif`;
const trunc = (c, t, w) => { if (c.measureText(t).width <= w) return t; while (t.length > 1 && c.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
const LABEL = { working: 'Working', needs: 'Needs you', testing: 'Ready to test', done: 'Done', idle: 'Away' };

function drawScreen(cv, s) {
  const c = cv.getContext('2d'); const w = cv.width, h = cv.height;
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1a1e24'); g.addColorStop(1, '#0c0e12');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (!s) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.beginPath(); c.arc(w / 2, h / 2, 8, 0, 7); c.fill(); return; }
  const col = HEX(STATUS[s.status]);
  c.textBaseline = 'middle'; c.fillStyle = col; c.beginPath(); c.arc(42, 46, 9, 0, 7); c.fill();
  c.fillStyle = '#e9edf2'; c.font = F(500, 26); c.fillText(s.name, 62, 47);
  c.textBaseline = 'alphabetic';
  if (s.status === 'working') {
    c.font = F(300, 110); c.fillStyle = '#ffffff'; const p = String(s.pct); c.fillText(p, 36, 196);
    const tw = c.measureText(p).width; c.font = F(300, 42); c.fillStyle = '#8c95a1'; c.fillText('%', 44 + tw, 196);
    c.font = F(400, 24); c.fillStyle = '#aab2bd'; c.fillText(trunc(c, s.action || '', w - 72), 38, 236);
    c.fillStyle = '#262b33'; c.beginPath(); c.roundRect(38, 258, w - 76, 10, 5); c.fill();
    c.fillStyle = col; c.beginPath(); c.roundRect(38, 258, Math.max(10, (w - 76) * s.pct / 100), 10, 5); c.fill();
  } else {
    c.font = F(500, 44); c.fillStyle = col; c.fillText(LABEL[s.status], 36, 160);
    c.font = F(400, 24); c.fillStyle = '#aab2bd'; c.fillText(trunc(c, s.action || '', w - 72), 38, 210);
  }
}

function drawRingLabel(cv, name, pct) {
  const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
  c.textAlign = 'center'; c.fillStyle = '#ffffff';
  c.shadowColor = 'rgba(20,30,40,0.35)'; c.shadowBlur = 18;
  c.font = F(300, 150); c.fillText(String(pct), cv.width / 2 - 22, 190);
  const tw = c.measureText(String(pct)).width; c.font = F(300, 56); c.textAlign = 'left'; c.fillText('%', cv.width / 2 - 22 + tw / 2 + 6, 190);
  c.textAlign = 'center'; c.font = F(500, 40); c.fillText(name, cv.width / 2, 262);
}

function drawShow(cv, t, sessions, tv) {
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
  c.font = F(600, 40); c.fillStyle = '#ffffff'; c.fillText((tv.name || 'HQ') + ' \u00b7 ' + (tv.pct ?? 0) + '% to App Store', 42, h - 120);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, h - 72, w, 72);
  const items = sessions.map((s) => s.name + ': ' + (s.status === 'working' ? 'working ' + s.pct + '%' : LABEL[s.status])).concat([(tv.name || 'HQ') + ' launch ' + (tv.pct ?? 0) + '%']);
  const msg = items.join('   \u2022   ') + '   \u2022   '; c.font = F(500, 28); const mw = c.measureText(msg).width || 1; const off = (t * 90) % mw;
  c.fillStyle = '#ffffff'; for (let x = -off; x < w; x += mw) c.fillText(msg, 24 + x, h - 26);
}
function drawTV(cv, sessions, tv) {
  const c = cv.getContext('2d'); const w = cv.width, h = cv.height;
  const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1b2230'); g.addColorStop(1, '#0d1118');
  c.fillStyle = g; c.fillRect(0, 0, w, h); c.textBaseline = 'alphabetic';
  c.font = F(500, 34); c.fillStyle = '#ffffff'; c.fillText(tv.name || 'HQ', 54, 82);
  c.font = F(300, 120); const p = String(tv.pct ?? ''); c.fillText(p, 54, 230);
  const pw = c.measureText(p).width; c.font = F(300, 44); c.fillStyle = '#8c95a1'; c.fillText('%', 62 + pw, 230);
  c.font = F(400, 26); c.fillStyle = '#8c95a1'; c.fillText('to App Store', 56, 278);
  const x0 = 470;
  sessions.slice(0, 4).forEach((s, i) => {
    const y = 74 + i * 82; const col = HEX(STATUS[s.status]);
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.roundRect(x0, y - 4, w - x0 - 44, 66, 18); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(x0 + 30, y + 29, 9, 0, 7); c.fill();
    c.font = F(500, 26); c.fillStyle = '#ffffff'; c.fillText(s.name, x0 + 54, y + 38);
    c.font = F(400, 24); c.fillStyle = '#9aa3ad'; c.textAlign = 'right';
    c.fillText(s.status === 'working' ? s.pct + '%' : LABEL[s.status], w - 72, y + 38); c.textAlign = 'left';
  });
}

const CITY_THEME = {
  morning: { fog: 0xf0dccb, tint: 0xfff0e2, ground: 0xf2e8de, lit: 0.1, near: 110, far: 260, tree: 0x86a96a },
  afternoon: { fog: 0xd3e6f4, tint: 0xffffff, ground: 0xf1f3f4, lit: 0, near: 120, far: 280, tree: 0x6fa25a },
  evening: { fog: 0xd99c86, tint: 0xf2d4c8, ground: 0xd4c4bd, lit: 0.9, near: 90, far: 230, tree: 0x6d7f58 },
  night: { fog: 0x1a2340, tint: 0x5d667e, ground: 0x2a3144, lit: 1.7, near: 80, far: 210, tree: 0x2b3a33 },
};
function buildCity(scene) {
  const g = new THREE.Group(); scene.add(g);
  const GY = -46;
  let seed = 11; const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const cvs = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); return c; };
  const tex = (cv, rep) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) t.repeat.set(rep, rep); return t; };
  const facade = (wall, g1, g2, mull) => cvs(512, 512, (c) => {
    c.fillStyle = wall; c.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 8; r++) {
      const gr = c.createLinearGradient(0, r * 64 + 12, 0, r * 64 + 52); gr.addColorStop(0, g1); gr.addColorStop(1, g2);
      c.fillStyle = gr; c.fillRect(0, r * 64 + 12, 512, 40);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, r * 64 + 12, 512, 3);
      c.fillStyle = mull; for (let k = 0; k <= 16; k++) c.fillRect(k * 32, r * 64 + 12, 1.5, 40);
    }
  });
  const FACADES = [
    facade('#fbfbfc', '#a9cbe6', '#6f9fc8', 'rgba(255,255,255,0.75)'),
    facade('#f3ebe0', '#e3c49d', '#bf9466', 'rgba(255,248,236,0.7)'),
    facade('#eef2f4', '#a7d6cf', '#6aa9a0', 'rgba(255,255,255,0.7)'),
    facade('#e9edf2', '#c7d3e0', '#8c9fb5', 'rgba(255,255,255,0.6)'),
    facade('#f6e3d8', '#f2d0b8', '#d49a7a', 'rgba(255,250,244,0.7)'),
  ];
  const lit = cvs(512, 512, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 16; k++) if (rand() < 0.4) { c.fillStyle = rand() < 0.8 ? '#ffd9a0' : '#cfe3ff'; c.fillRect(k * 32 + 2, r * 64 + 16, 28, 32); }
  });
  const litTex = tex(lit);
  const bMats = FACADES.map((f) => new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(f), emissiveMap: litTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35, metalness: 0.08 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xeceef1, roughness: 0.7 });
  const gardenMat = new THREE.MeshStandardMaterial({ color: 0x7fae66, roughness: 0.9 });
  const poolMat = new THREE.MeshPhysicalMaterial({ color: 0x6cc4e6, roughness: 0.05, clearcoat: 1 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x9cc685, roughness: 1 });
  const road = cvs(256, 256, (c) => {
    c.fillStyle = '#e6e9ec'; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#f6f7f8'; c.fillRect(69, 0, 118, 256); c.fillRect(0, 69, 256, 118);
    c.fillStyle = '#c6cbd2'; c.fillRect(90, 0, 76, 256); c.fillRect(0, 90, 256, 76);
    c.fillStyle = '#ffffff'; for (let i = 0; i < 256; i += 32) { if (i < 84 || i > 172) { c.fillRect(127, i, 2, 16); c.fillRect(i, 127, 16, 2); } }
    for (let i = 0; i < 6; i++) { c.fillRect(92 + i * 13, 70, 7, 18); c.fillRect(70, 92 + i * 13, 18, 7); }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(720, 720), new THREE.MeshStandardMaterial({ color: 0xeef0f2, map: tex(road, 60), roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = GY; g.add(ground);
  const scaleUV = (geo, w, h, d, off) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const f = Math.floor(i / 4);
      if (f === 2 || f === 3) { uv.setXY(i, 0.002, 0.002); continue; }
      const span = f < 2 ? d : w; uv.setXY(i, off + (uv.getX(i) * span) / 12.8, (uv.getY(i) * h) / 16);
    }
  };
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x6fa25a, roughness: 0.8 });
  const LM = [
    { key: 'formpal', name: 'FormPal', icon: 'hub', gx: 0, gz: 0, h: 16, w: 11, col: 0x8b7bff },
    { key: 'lab', name: 'Test Lab', icon: 'science', gx: -5, gz: -5, h: 9, col: 0x5fc8ff },
    { key: 'dock', name: 'Shipping Dock', icon: 'local_shipping', gx: 5, gz: -5, h: 9, col: 0x4cd98a },
    { key: 'factory', name: 'Factory', icon: 'precision_manufacturing', gx: 5, gz: 5, h: 11, col: 0xffa64a },
    { key: 'vault', name: 'Content', icon: 'slideshow', gx: -5, gz: 5, h: 7, col: 0xff7ab8 },
  ];
  const lmGlass = new THREE.MeshPhysicalMaterial({ color: 0xeef3f8, roughness: 0.06, metalness: 0.4, clearcoat: 1, envMapIntensity: 1.6 });
  const GREY = new THREE.Color(0x8a929c);
  const landmarks = LM.map((l) => {
    const x = l.gx * 12, z = l.gz * 12, w = l.w || 6, rr = w * 0.3;
    const col = new THREE.Color(l.col), dim = col.clone().lerp(GREY, 0.7);
    const pod = rbox(w + 4, 0.6, w + 4, 0.6, new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.6 })); pod.position.set(x, GY + 0.3, z); g.add(pod);
    const glassM = new THREE.MeshPhysicalMaterial({ color: l.col, roughness: 0.08, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.72, emissive: l.col, emissiveIntensity: 0.6, envMapIntensity: 1.6 });
    const tower = rbox(w, l.h, w, rr, glassM); tower.position.set(x, GY + 0.6 + l.h / 2, z); g.add(tower);
    const coreM = new THREE.MeshBasicMaterial({ color: l.col });
    const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, l.h - 1, w * 0.6), coreM); core.position.copy(tower.position); g.add(core);
    const bandM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let y = 2.5; y < l.h - 1; y += 2.5) { const b = rbox(w + 0.08, 0.12, w + 0.08, rr, bandM); b.position.set(x, GY + 0.6 + y, z); g.add(b); }
    const crownM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const crown = new THREE.Mesh(new THREE.TorusGeometry(w * 0.52, 0.2, 16, 96), crownM); crown.rotation.x = Math.PI / 2; crown.position.set(x, GY + 0.6 + l.h + 0.4, z); g.add(crown);
    const padM = new THREE.MeshBasicMaterial({ color: l.col });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(w * 0.36, 64), padM); pad.rotation.x = -Math.PI / 2; pad.position.set(x, GY + 0.62 + l.h, z); g.add(pad);
    const light = { intensity: 0 };
    const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 256; const c = sc.getContext('2d');
    const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
    const big = l.key === 'formpal';
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(big ? 18 : 14, big ? 4.5 : 3.5), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    if (big) sign.position.set(x + w * 0.5, GY + 0.6 + l.h * 0.86, z + w * 0.5); else sign.position.set(x, GY + 0.6 + l.h + 2.6, z); sign.userData.lm = l.key; g.add(sign);
    const glowHex = l.col === 0xffffff ? '#bfe9ff' : HEX(l.col);
    const draw = (on, badge) => {
      c.clearRect(0, 0, 1024, 256); c.font = '600 120px Geist, -apple-system, sans-serif'; c.textBaseline = 'middle';
      const tw = c.measureText(l.name).width, bw = badge ? 150 : 0, x0 = 512 - (tw + bw) / 2;
      c.textAlign = 'left'; c.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.55)';
      if (on) { c.shadowColor = glowHex; c.shadowBlur = 40; c.fillText(l.name, x0, 128); c.shadowBlur = 14; }
      c.fillText(l.name, x0, 128); c.shadowBlur = 0;
      if (badge) { const bx = x0 + tw + 40 + 55; c.fillStyle = '#ff8a3d'; c.shadowColor = '#ff8a3d'; c.shadowBlur = 30; c.beginPath(); c.arc(bx, 128, 58, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = '#ffffff'; c.font = '700 80px Geist, -apple-system, sans-serif'; c.textAlign = 'center'; c.fillText(String(badge), bx, 132); }
      st.needsUpdate = true;
    };
    const edge = (w / 2 - rr) * Math.SQRT2 + rr, dock = (6.3 + edge + 0.6) / Math.SQRT2;
    const o = { key: l.key, name: l.name, icon: l.icon, col: l.col, x, z, top: GY + 0.6 + l.h + 0.55, sign, meshes: [tower, core, pod, sign], dock, on: true, badge: -1, crown, crownM, padM, light, signScale: big ? 1.15 : 1 };
    o.setOn = (on, badge) => {
      if (o.on === on && o.badge === badge) return; o.on = on; o.badge = badge;
      glassM.color.copy(on ? col : dim); glassM.emissive.copy(on ? col : dim); glassM.emissiveIntensity = on ? 0.7 : 0.04; glassM.opacity = on ? 0.75 : 0.5;
      coreM.color.copy(on ? col : dim).multiplyScalar(on ? 1 : 0.7); bandM.color.setHex(on ? 0xffffff : 0x9aa1a9); crownM.color.setHex(on ? 0xffffff : 0x8a929c); padM.color.copy(on ? col : dim);
      light.intensity = on ? 40 : 0; sign.material.opacity = on ? 1 : 0.7; draw(on, on ? badge : 0);
    };
    o.setOn(false, 0);
    return o;
  });
  const treePos = [];
  const lmCells = new Set(LM.map((l) => l.gx + ',' + l.gz));
  for (let gx = -11; gx <= 11; gx++) for (let gz = -11; gz <= 11; gz++) {
    const cx = gx * 12, cz = gz * 12; const d = Math.hypot(cx, cz);
    if (d > 128 || lmCells.has(gx + ',' + gz)) continue;
    const nearLM = LM.some((l) => Math.hypot(cx - l.gx * 12, cz - l.gz * 12) < 26);
    const dot = d ? (cx + cz) / (d * Math.SQRT2) : 0;
    if (d < 14 || rand() < 0.38) {
      if (rand() < 0.5) continue;
      { const p = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 8.6), parkMat); p.rotation.x = -Math.PI / 2; p.position.set(cx, GY + 0.05, cz); g.add(p); }
      for (let t = 0; t < 7; t++) treePos.push([cx + (rand() - 0.5) * 5, GY + 1.2, cz + (rand() - 0.5) * 5, 0.9 + rand() * 0.7]);
      continue;
    }
    const n = rand() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const w = n === 2 ? 2.5 + rand() * 0.5 : 4 + rand() * 2.2, dd = 4 + rand() * 2.2;
      const ox = n === 2 ? (i ? 1.65 : -1.65) : 0;
      let h = dot > 0.3 && d < 75 ? 3 + rand() * 6 : 5 + Math.pow(rand(), 1.6) * (dot < -0.3 ? 22 : 14);
      if (nearLM) h = Math.min(h, 5);
      h = Math.max(2, Math.round(h / 2) * 2);
      const geo = new THREE.BoxGeometry(w, h, dd); scaleUV(geo, w, h, dd, rand());
      const m = new THREE.Mesh(geo, bMats[Math.floor(rand() * bMats.length)]); m.position.set(cx + ox, GY + h / 2, cz); g.add(m);
      const rr = rand();
      if (rr < 0.2) { const r = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.25, dd * 0.8), gardenMat); r.position.set(cx + ox, GY + h + 0.12, cz); g.add(r); }
      else if (rr < 0.27) { const r = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.12, dd * 0.4), poolMat); r.position.set(cx + ox, GY + h + 0.06, cz); g.add(r); }
      else if (rr < 0.6) { const r = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.8, dd * 0.5), roofMat); r.position.set(cx + ox, GY + h + 0.4, cz); g.add(r); }
    }
  }
  { const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), treeMat, treePos.length); const o2 = new THREE.Object3D();
    treePos.forEach(([x, y, z, r], i) => { o2.position.set(x, y, z); o2.scale.setScalar(r); o2.updateMatrix(); im.setMatrixAt(i, o2.matrix); }); g.add(im); }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); } });
  landmarks.forEach((b) => { b.sign.matrixAutoUpdate = true; });
  const N = 120;
  const carMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const cars = new THREE.InstancedMesh(rbox(0.85, 0.5, 1.8, 0.22, carMat).geometry, carMat, N);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xfff4dc }), N);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xff453a }), N);
  const pal = [0xffffff, 0xf0f1f3, 0x1d2128, 0x8a929c, 0xc9d6e3, 0xd9503f, 0x2f6fdb, 0xffffff];
  const C = [];
  for (let i = 0; i < N; i++) {
    const axis = rand() < 0.5 ? 0 : 1, dir = rand() < 0.5 ? 1 : -1, roadC = (Math.floor(rand() * 18) - 9) * 12 + 6;
    C.push({ axis, dir, coord: roadC + dir * 0.85, t: (rand() * 2 - 1) * 120, v: 5 + rand() * 6 });
    cars.setColorAt(i, new THREE.Color(pal[Math.floor(rand() * pal.length)]));
  }
  cars.instanceColor.needsUpdate = true;
  g.add(cars, heads, tails);
  const o = new THREE.Object3D();
  const tick = (dt) => {
    C.forEach((c, i) => {
      c.t += c.dir * c.v * dt; if (c.t > 125) c.t = -125; if (c.t < -125) c.t = 125;
      o.position.set(c.axis ? c.coord : c.t, GY + 0.3, c.axis ? c.t : c.coord);
      o.rotation.set(0, c.axis ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
      o.updateMatrix(); cars.setMatrixAt(i, o.matrix);
      o.translateZ(0.91); o.updateMatrix(); heads.setMatrixAt(i, o.matrix);
      o.translateZ(-1.82); o.updateMatrix(); tails.setMatrixAt(i, o.matrix);
    });
    cars.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = tails.instanceMatrix.needsUpdate = true;
  };
  const fog = new THREE.Fog(0xcfe0ec, 72, 160);
  const setTheme = (name) => { const t = CITY_THEME[name] || CITY_THEME.afternoon; bMats.forEach((m) => { m.color.setHex(t.tint); m.emissiveIntensity = t.lit; }); roofMat.color.setHex(t.tint); gardenMat.color.setHex(t.tree); parkMat.color.setHex(t.tree); treeMat.color.setHex(t.tree); poolMat.color.setHex(name === 'night' ? 0x2c4a6a : 0x6cc4e6); ground.material.color.setHex(t.ground); fog.color.setHex(t.fog); fog.near = t.near; fog.far = t.far; };
  tick(0);
  return { group: g, fog, tick, setTheme, landmarks };
}

function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.02; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const COAST_THEME = {
  morning: { fog: 0xf0dcc8, sky: 0xf6d9bf, deep: 0x1d5b78, shallow: 0x58c9c6, sun: [-0.7, 0.32, 0.55], sunC: 0xffcf9a, tint: 0xfff0e2, lit: 0.15, near: 150, far: 420 },
  afternoon: { fog: 0xd4e8f5, sky: 0xc4e3f6, deep: 0x0b5a8a, shallow: 0x2fd3cf, sun: [0.45, 0.75, 0.4], sunC: 0xfffbef, tint: 0xffffff, lit: 0, near: 170, far: 460 },
  evening: { fog: 0xe8a88e, sky: 0xf4b48f, deep: 0x2f5a85, shallow: 0x4a9fae, sun: [-0.85, 0.16, 0.35], sunC: 0xffa25c, tint: 0xf2d2c4, lit: 0.9, near: 130, far: 380 },
  night: { fog: 0x141c34, sky: 0x26365e, deep: 0x060c1b, shallow: 0x10364c, sun: [0.4, 0.6, 0.45], sunC: 0xc4d0ff, tint: 0x5a6480, lit: 1.6, near: 110, far: 330 },
};
function buildCoast(scene) {
  const g = new THREE.Group(); scene.add(g); const GY = -34, EXT = 600;
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const B = [[-44, -44, 34, 1.5], [-70, -6, 24, 1.3], [-6, -72, 24, 1.3], [-54, -52, 12, 6], [-38, 30, 9, 2.2], [36, -30, 8, 2.4], [40, 40, 6, 1.6]];
  for (let i = 0; i < 18; i++) { const a = ((196 + i * 4 + rand() * 3) * Math.PI) / 180, d = 84 + rand() * 26; B.push([Math.cos(a) * d, Math.sin(a) * d, 16 + rand() * 14, 10 + rand() * 20]); }
  const H = (x, z) => { let h = -8, inf = 0; for (const [bx, bz, r, bh] of B) { const q = ((x - bx) ** 2 + (z - bz) ** 2) / (r * r); if (q < 9) { const e = Math.exp(-q); h += (bh + 8) * e; inf = Math.max(inf, e); } } return h + (fbm(x * 0.05 + 3, z * 0.05, 4) - 0.5) * 8 * Math.min(1, inf * 2.4); };

  const TS = 230, tg = new THREE.PlaneGeometry(EXT, EXT, TS, TS); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, GY + H(tp.getX(i), tp.getZ(i)));
  tg.computeVertexNormals();
  const tn = tg.attributes.normal, tc = new Float32Array(tp.count * 3), c = new THREE.Color();
  const SAND = new THREE.Color(0xf3e2bf), WET = new THREE.Color(0xd9c49c), GRASS = new THREE.Color(0x86b562), GRASS2 = new THREE.Color(0x5e9248), ROCK = new THREE.Color(0xcfc6b8);
  for (let i = 0; i < tp.count; i++) {
    const h = tp.getY(i) - GY, ny = tn.getY(i), n = fbm(tp.getX(i) * 0.08, tp.getZ(i) * 0.08, 2);
    if (h < 0.15) c.copy(WET).lerp(SAND, smooth(-2, 0.15, h));
    else if (h < 1.6) c.copy(SAND);
    else c.copy(SAND).lerp(GRASS, smooth(1.6, 3.2, h)).lerp(GRASS2, smooth(0.35, 0.75, n) * smooth(3, 8, h));
    if (h > 1.6) c.lerp(ROCK, smooth(0.86, 0.62, ny));
    tc[i * 3] = c.r; tc[i * 3 + 1] = c.g; tc[i * 3 + 2] = c.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const tMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const terrain = new THREE.Mesh(tg, tMat); terrain.receiveShadow = true; g.add(terrain);

  const HM = 256, hd = new Uint8Array(HM * HM * 4);
  for (let j = 0; j < HM; j++) for (let i = 0; i < HM; i++) { const x = (i / (HM - 1) - 0.5) * EXT, z = (j / (HM - 1) - 0.5) * EXT; const v = Math.max(0, Math.min(1, (H(x, z) + 10) / 20)); const k = (j * HM + i) * 4; hd[k] = v * 255; hd[k + 3] = 255; }
  const hTex = new THREE.DataTexture(hd, HM, HM); hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.needsUpdate = true;
  const nTex = new THREE.TextureLoader().load('/v/waternormals.jpg');
  nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping;
  const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uN: { value: null }, uH: { value: null }, uExt: { value: EXT }, uSun: { value: new THREE.Vector3(0.45, 0.75, 0.4) }, uSunC: { value: new THREE.Color(0xfffbef) }, uSky: { value: new THREE.Color(0xc4e3f6) }, uDeep: { value: new THREE.Color(0x0b5a8a) }, uShal: { value: new THREE.Color(0x2fd3cf) } }]);
  U.uN.value = nTex; U.uH.value = hTex;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), new THREE.ShaderMaterial({
    fog: true, uniforms: U,
    vertexShader: `#include <fog_pars_vertex>
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uExt; uniform sampler2D uN, uH; uniform vec3 uSun, uSunC, uSky, uDeep, uShal; varying vec3 vW;
      vec3 nrm(vec2 p){
        vec4 s = texture2D(uN, p / 103.0 + vec2(uTime / 17.0, uTime / 29.0)) + texture2D(uN, p / 107.0 - vec2(uTime / -19.0, uTime / 31.0))
               + texture2D(uN, p / vec2(897.0, 983.0) + vec2(uTime / 101.0, uTime / 97.0)) + texture2D(uN, p / vec2(991.0, 877.0) - vec2(uTime / 109.0, uTime / -113.0));
        vec3 n = (s * 0.5 - 1.0).xzy; return normalize(n * vec3(1.6, 1.0, 1.6));
      }
      void main(){
        vec3 n = nrm(vW.xz * 1.4);
        vec3 V = normalize(cameraPosition - vW);
        vec2 huv = vW.xz / uExt + 0.5;
        float h = texture2D(uH, huv).r * 20.0 - 10.0;
        float depth = max(0.0, -h);
        float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 L = normalize(uSun); vec3 R = reflect(-V, n);
        float spec = pow(max(dot(R, L), 0.0), 260.0) * 4.0 + pow(max(dot(R, L), 0.0), 24.0) * 0.18;
        vec3 body = mix(uShal, uDeep, smoothstep(0.0, 7.0, depth));
        body *= 0.85 + 0.25 * max(dot(n, L), 0.0);
        vec3 col = mix(body, uSky, fr * 0.75) + uSunC * spec;
        float band = 1.0 - smoothstep(0.0, 1.1, depth);
        float wave = 0.5 + 0.5 * sin(uTime * 1.6 - depth * 7.0 + n.x * 6.0);
        float foam = band * smoothstep(0.35, 0.9, wave + n.z * 0.6) * (1.0 - smoothstep(0.0, 0.25, -h));
        col = mix(col, vec3(1.0), clamp(foam, 0.0, 0.85));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = GY; g.add(water);

  const o = new THREE.Object3D();
  const winCv = document.createElement('canvas'); winCv.width = winCv.height = 64; { const x = winCv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffcf8a'; x.fillRect(12, 22, 14, 20); x.fillRect(38, 22, 14, 20); }
  const winTex = new THREE.CanvasTexture(winCv);
  const houseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0 });
  const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x2f6fc0, roughness: 0.3, clearcoat: 0.6 });
  const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), houseMat, 420);
  const domes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 120);
  let hn = 0, dn = 0;
  for (let t = 0; t < 6000 && hn < 420; t++) {
    const a = ((194 + rand() * 76) * Math.PI) / 180, d = 66 + rand() * 50, x = Math.cos(a) * d, z = Math.sin(a) * d, h = H(x, z);
    if (h < 2.4 || h > 24) continue;
    const hx = (H(x + 1, z) - H(x - 1, z)) / 2, hz = (H(x, z + 1) - H(x, z - 1)) / 2; if (Math.hypot(hx, hz) > 1.1) continue;
    const w = 1.4 + rand() * 1.3, hh = 1.1 + rand() * 1.3, dd = 1.4 + rand() * 1.2;
    o.position.set(x, GY + h + hh / 2 - 0.35, z); o.rotation.set(0, -a + (rand() - 0.5) * 0.3, 0); o.scale.set(w, hh, dd); o.updateMatrix(); houses.setMatrixAt(hn++, o.matrix);
    if (rand() < 0.16 && dn < 120) { const r2 = Math.min(w, dd) * 0.75; o.position.set(x, GY + h + hh - 0.35, z); o.scale.set(r2, r2 * 0.9, r2); o.updateMatrix(); domes.setMatrixAt(dn++, o.matrix); }
  }
  houses.count = hn; domes.count = dn; houses.castShadow = true; g.add(houses, domes);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xb79d7c, roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x5f9c52, roughness: 0.75, side: THREE.DoubleSide });
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 2.4, 0), new THREE.Vector3(0.2, 4.6, 0));
  const trunkGeo = new THREE.TubeGeometry(curve, 16, 0.16, 10, false);
  const frondGeo = (() => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(1.2, 0.5, 2.6, 0); sh.quadraticCurveTo(1.2, -0.5, 0, 0); const gg = new THREE.ShapeGeometry(sh, 10); gg.rotateX(-Math.PI / 2); const p = gg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, -0.12 * x * x); } gg.computeVertexNormals(); return gg; })();
  const NP = 120, trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, NP), fronds = new THREE.InstancedMesh(frondGeo, frondMat, NP * 8);
  let pn = 0, fn = 0; const top = new THREE.Vector3();
  for (let t = 0; t < 8000 && pn < NP; t++) {
    const x = (rand() - 0.5) * EXT * 0.75, z = (rand() - 0.5) * EXT * 0.75, h = H(x, z);
    if (h < 0.7 || h > 3.4 || Math.hypot(x, z) < 12 || x + z > -8) continue;
    const s2 = 0.7 + rand() * 0.6, ry = rand() * 6.28;
    o.position.set(x, GY + h - 0.2, z); o.rotation.set(0, ry, 0); o.scale.setScalar(s2); o.updateMatrix(); trunks.setMatrixAt(pn++, o.matrix);
    top.set(0.2, 4.6, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).multiplyScalar(s2).add(o.position);
    for (let f = 0; f < 8; f++) { o.position.copy(top); o.rotation.set(0, (f / 8) * 6.28 + rand() * 0.3, -0.15 - rand() * 0.25); o.scale.setScalar(s2); o.updateMatrix(); fronds.setMatrixAt(fn++, o.matrix); }
  }
  trunks.count = pn; fronds.count = fn; g.add(trunks, fronds);
  const umbCols = [0xff7a5c, 0xffffff, 0x4fb3e8, 0xffd25a, 0xff9fb8];
  const umbMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  const umbs = new THREE.InstancedMesh(new THREE.ConeGeometry(1.1, 0.45, 16, 1, true), umbMat, 60);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }), 60);
  const towels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.04, 1.6), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 60);
  let un = 0;
  for (let t2 = 0; t2 < 9000 && un < 60; t2++) {
    const x = (rand() - 0.5) * 220, z = (rand() - 0.5) * 220, h = H(x, z); if (h < 0.35 || h > 1.25 || x + z > -12 || Math.hypot(x, z) < 22) continue;
    const col = new THREE.Color(umbCols[Math.floor(rand() * umbCols.length)]);
    o.position.set(x, GY + h + 1.75, z); o.rotation.set(0, 0, 0.08); o.scale.setScalar(1); o.updateMatrix(); umbs.setMatrixAt(un, o.matrix); umbs.setColorAt(un, col);
    o.position.set(x, GY + h + 0.9, z); o.rotation.set(0, 0, 0.08); o.updateMatrix(); poles.setMatrixAt(un, o.matrix);
    o.position.set(x + 0.9, GY + h + 0.03, z + 0.4); o.rotation.set(0, rand() * 0.6, 0); o.updateMatrix(); towels.setMatrixAt(un, o.matrix); towels.setColorAt(un, new THREE.Color(umbCols[Math.floor(rand() * umbCols.length)]));
    un++;
  }
  umbs.count = poles.count = towels.count = un; g.add(umbs, poles, towels);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x6aa257, roughness: 0.85 });
  const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), bushMat, 500); let bn = 0;
  for (let t = 0; t < 9000 && bn < 500; t++) { const x = (rand() - 0.5) * EXT * 0.8, z = (rand() - 0.5) * EXT * 0.8, h = H(x, z); if (h < 3.4 || h > 20 || x + z > -8 || fbm(x * 0.06, z * 0.06, 2) < 0.45) continue; const sc = 0.6 + rand() * 1.1; o.position.set(x, GY + h + sc * 0.3, z); o.rotation.set(0, 0, 0); o.scale.set(sc, sc * 0.75, sc); o.updateMatrix(); bushes.setMatrixAt(bn++, o.matrix); }
  bushes.count = bn; g.add(bushes);

  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1 });
  const teak = new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 0.6 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.7, side: THREE.DoubleSide });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1c2733, roughness: 0.1, clearcoat: 1 });
  const wakeCv = document.createElement('canvas'); wakeCv.width = 64; wakeCv.height = 256; { const x = wakeCv.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.beginPath(); x.moveTo(26, 0); x.lineTo(38, 0); x.lineTo(64, 256); x.lineTo(0, 256); x.fill(); }
  const wakeMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(wakeCv), transparent: true, depthWrite: false, opacity: 0.55 });
  const boats = [];
  const mkBoat = (yacht) => {
    const b = new THREE.Group(); g.add(b);
    const hull = rbox(yacht ? 2.2 : 1.3, 0.6, yacht ? 6.2 : 4, yacht ? 0.5 : 0.35, white); hull.position.y = 0.25; b.add(hull);
    const deck = rbox(yacht ? 1.9 : 1.0, 0.06, yacht ? 4.8 : 3.0, 0.3, teak); deck.position.y = 0.56; b.add(deck);
    if (yacht) { const cab = rbox(1.5, 0.7, 2.4, 0.3, white); cab.position.set(0, 0.95, -0.4); b.add(cab); const w = rbox(1.52, 0.3, 2.0, 0.15, glass); w.position.set(0, 1.05, -0.3); b.add(w); }
    else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 6, 10), white); mast.position.set(0, 3.5, 0.3); b.add(mast);
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 5.4); sh.quadraticCurveTo(1.2, 2.4, 1.9, 0); sh.lineTo(0, 0);
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sh, 12), sailMat); sail.rotation.y = Math.PI / 2; sail.position.set(0, 0.7, 0.35); b.add(sail);
      const jib = new THREE.Mesh(new THREE.ShapeGeometry((() => { const j = new THREE.Shape(); j.moveTo(0, 0); j.lineTo(0, 4.6); j.lineTo(1.5, 0); j.lineTo(0, 0); return j; })(), 4), sailMat); jib.rotation.y = -Math.PI / 2; jib.position.set(0, 0.7, 0.25); b.add(jib);
    }
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(yacht ? 5 : 3, yacht ? 26 : 14), wakeMat); wake.rotation.x = -Math.PI / 2; wake.position.set(0, -0.15, yacht ? -15 : -8.5); b.add(wake);
    return b;
  };
  for (let i = 0; i < 10; i++) { const yacht = i < 3; const bb = mkBoat(yacht); bb.scale.setScalar(0.62); boats.push({ b: bb, r: yacht ? 18 + i * 7 : 15 + rand() * 30, a: rand() * 6.28, v: (yacht ? 0.05 : 0.025 + rand() * 0.02) * (rand() < 0.5 ? 1 : -1), ph: rand() * 6 }); }

  const lh = new THREE.Group(); { const [bx, bz] = B[1]; lh.position.set(bx + 4, GY + H(bx + 4, bz - 3) - 0.3, bz - 3); } g.add(lh);
  const red = new THREE.MeshStandardMaterial({ color: 0xd9503f, roughness: 0.5 });
  { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.05, 8, 32), white); b.position.y = 4; lh.add(b);
    [2.2, 5.2].forEach((y) => { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.92, 1.0, 32), red); band.position.y = y; lh.add(band); });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 24), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xfff1c8, emissiveIntensity: 0.4 })); lamp.position.y = 8.45; lh.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.8, 32), red); cap.position.y = 9.3; lh.add(cap); }
  const beamPivot = new THREE.Group(); beamPivot.position.y = 8.45; lh.add(beamPivot);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(5, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.rotation.z = Math.PI / 2; beam.position.x = 30; beamPivot.add(beam);

  const gullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
  const gulls = [];
  for (let i = 0; i < 9; i++) {
    const gg = new THREE.Group(); g.add(gg);
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.22); wingGeo.translate(0.45, 0, 0);
    const wl = new THREE.Mesh(wingGeo, gullMat), wr = new THREE.Mesh(wingGeo, gullMat); wr.rotation.y = Math.PI; gg.add(wl, wr);
    const bd = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), gullMat); bd.scale.set(0.8, 0.8, 2.2); gg.add(bd);
    gulls.push({ gg, wl, wr, r: 12 + rand() * 22, a: rand() * 6.28, y: -6 + rand() * 12, v: 0.15 + rand() * 0.12, ph: rand() * 6 });
  }

  const fog = new THREE.Fog(0xd4e8f5, 170, 460);
  let lit = 0;
  const tick = (dt, t) => {
    U.uTime.value += dt * 0.32;
    boats.forEach((o2) => { o2.a += (o2.v * dt * 20) / o2.r; const s3 = Math.sign(o2.v); o2.b.position.set(Math.cos(o2.a) * o2.r, GY + 0.05 * Math.sin(t * 1.3 + o2.ph), Math.sin(o2.a) * o2.r); o2.b.rotation.set(0.02 * Math.sin(t * 1.1 + o2.ph), -o2.a + (s3 > 0 ? Math.PI : 0), 0.03 * Math.sin(t * 0.9 + o2.ph)); });
    gulls.forEach((q) => { q.a += (q.v * dt * 10) / q.r; q.gg.position.set(Math.cos(q.a) * q.r, q.y + Math.sin(t * 0.7 + q.ph) * 0.6, Math.sin(q.a) * q.r); q.gg.rotation.set(0, -q.a, 0.15); const f = Math.sin(t * 7 + q.ph) * 0.5; q.wl.rotation.z = f; q.wr.rotation.z = -f; });
    beamPivot.rotation.y = t * 0.7; beam.material.opacity = lit > 0.5 ? 0.16 : 0;
  };
  const setTheme = (name) => {
    const th = COAST_THEME[name] || COAST_THEME.afternoon; lit = th.lit;
    U.uSky.value.setHex(th.sky); U.uDeep.value.setHex(th.deep); U.uShal.value.setHex(th.shallow); U.uSunC.value.setHex(th.sunC); U.uSun.value.set(...th.sun);
    const tint = new THREE.Color(th.tint); tMat.color.copy(tint); houseMat.color.copy(tint); frondMat.color.setHex(0x5f9c52).multiply(tint); bushMat.color.setHex(0x6aa257).multiply(tint); trunkMat.color.setHex(0xb79d7c).multiply(tint);
    houseMat.emissiveIntensity = th.lit * 0.9; fog.color.setHex(th.fog); fog.near = th.near; fog.far = th.far; U.fogColor.value.setHex(th.fog);
  };
  return { group: g, fog, tick, setTheme };
}

export function mountRoom(container, opts = {}) {
  const W = () => container.clientWidth || 1, H = () => container.clientHeight || 1;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; 
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  container.appendChild(renderer.domElement);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  container.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.environment = makeEnv(renderer);
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 400);
  const DIR = new THREE.Vector3(1, 0.95, 1).normalize();

  const M = {
    deck: new THREE.MeshPhysicalMaterial({ color: 0xf5f5f4, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    inlay: new THREE.MeshPhysicalMaterial({ color: 0xeae8e4, roughness: 0.6 }),
    white: new THREE.MeshPhysicalMaterial({ color: 0xf8f8f8, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
    oak: new THREE.MeshPhysicalMaterial({ color: 0xe3d1b6, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xeef4fb, roughness: 0.02, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.4 }),
    graphite: new THREE.MeshPhysicalMaterial({ color: 0x2c3036, roughness: 0.3, clearcoat: 0.7 }),
    alu: new THREE.MeshPhysicalMaterial({ color: 0xd9dce0, roughness: 0.22, metalness: 0.65 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x08090c, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    bot: new THREE.MeshPhysicalMaterial({ color: 0xfbfbfc, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.4, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff) }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xe9e3da, roughness: 0.95 }),
    fabric2: new THREE.MeshStandardMaterial({ color: 0xdcd3c6, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x6f9062, roughness: 0.7 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xfdfcf8, roughness: 0.9 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0xbfd8e6, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }),
  };
  const emis = (hex, i = 2.2) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: i, roughness: 0.35 });

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6a7a6c, 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025;
  scene.add(sun); scene.add(sun.target);
  const lamp = new THREE.PointLight(0xffc58a, 0, 9, 1.6); lamp.position.set(-1.6, 2.4, 4.4); scene.add(lamp);
  const ringLight = new THREE.PointLight(0xffffff, 0, 6, 2); ringLight.position.set(0, 2.2, 0); scene.add(ringLight);

  const room = new THREE.Group(); scene.add(room);
  const ufoLights = [], ufoBeam = {}; let flyTo = null; const fly = { x: 34, z: 34, y: 0 }; const man = { x: 34, z: 34 }; let manualT = -99, dockFired = false, dockReady = null, nearKey = null; const keys = {}; const camOff = { x: 0, z: 0 };
  let coolKey = null, mapGo = false, boarding = false, homeGo = false;
  const setFly = (k) => { if (k !== flyTo) { if (flyTo && !k) coolKey = flyTo; flyTo = k; dockFired = false; } };
  const KM = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r' };
  const onKD = (e) => { const tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return; const k = KM[e.key]; if (!k) return; e.preventDefault(); keys[k] = true; };
  const onKU = (e) => { const k = KM[e.key]; if (k) keys[k] = false; };
  window.addEventListener('keydown', onKD); window.addEventListener('keyup', onKU); const sunBase = new THREE.Vector3(7, 16, 9);
  const ENVS = { city: buildCity(scene) };
  const city = ENVS.city;
  let loc = 'city';
  function setLocation(l) { loc = ENVS[l] ? l : 'city'; Object.entries(ENVS).forEach(([k, e]) => { e.group.visible = k === loc; }); scene.fog = ENVS[loc].fog; try { update(); } catch (e) {} }
  setLocation('city');
  const add = (mesh, p, r) => { if (p) mesh.position.set(...p); if (r) mesh.rotation.set(...r); room.add(mesh); return mesh; };
  const cyl = (rt, rb, h, mat, p, seg = 64) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return add(m, p); };
  const sph = (r, mat, p, s) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), mat); m.castShadow = true; if (s) m.scale.set(...s); return add(m, p); };
  const at = (deg, r, y = 0) => { const [x, z] = pol(deg, r); return [x, y, z]; };
  const faceCenter = (deg) => -((deg * Math.PI) / 180) - Math.PI / 2;

  { // soft shadow below the floating deck
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    const g = c.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, 'rgba(10,18,22,0.5)'); g.addColorStop(1, 'rgba(10,18,22,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = -2.3; m.visible = false; room.add(m);
  }
  add(disc(6.3, 0.5, 0.22, M.deck), [0, -0.25, 0]);
  {
    const hull = new THREE.MeshPhysicalMaterial({ color: 0xe4e8ee, roughness: 0.18, metalness: 0.75, clearcoat: 1, clearcoatRoughness: 0.08 });
    const sc2 = new THREE.SplineCurve([new THREE.Vector2(6.3, -0.48), new THREE.Vector2(6.9, -0.72), new THREE.Vector2(6.4, -1.05), new THREE.Vector2(4.2, -1.55), new THREE.Vector2(2.4, -1.85), new THREE.Vector2(2.2, -2.05), new THREE.Vector2(0.0001, -2.15)]);
    const keel = new THREE.Mesh(new THREE.LatheGeometry(sc2.getPoints(80), 200), hull); keel.receiveShadow = true; keel.castShadow = true; add(keel);
    add(new THREE.Mesh(new THREE.TorusGeometry(6.88, 0.06, 20, 256), M.white), [0, -0.72, 0], [Math.PI / 2, 0, 0]);
    ufoLights.length = 0;
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x9fe6ff, emissiveIntensity: 1 })); m.position.set(Math.cos(a) * 6.62, -0.92, Math.sin(a) * 6.62); room.add(m); ufoLights.push(m); }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.12, 96), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x9fe6ff, emissiveIntensity: 2.2 })); add(core, [0, -2.0, 0]);
    const bc = document.createElement('canvas'); bc.width = 4; bc.height = 256; { const x = bc.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(200,245,255,0.9)'); gr.addColorStop(0.5, 'rgba(170,230,255,0.3)'); gr.addColorStop(1, 'rgba(170,230,255,0.04)'); x.fillStyle = gr; x.fillRect(0, 0, 4, 256); }
    ufoBeam.m = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 11, 44, 64, 1, true), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    add(ufoBeam.m, [0, -24, 0]);
    { const gc = document.createElement('canvas'); gc.width = gc.height = 128; const x = gc.getContext('2d'); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(200,245,255,0.9)'); gr.addColorStop(1, 'rgba(200,245,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      ufoBeam.pool = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); ufoBeam.pool.rotation.x = -Math.PI / 2; add(ufoBeam.pool, [0, -45.8, 0]); }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(6.16, 6.16, 0.62, 200, 1, true), M.glass); add(rail, [0, 0.31, 0]);
    add(new THREE.Mesh(new THREE.TorusGeometry(6.16, 0.035, 20, 256), M.white), [0, 0.62, 0], [Math.PI / 2, 0, 0]);
  }
  add(new THREE.Mesh(new THREE.TorusGeometry(6.22, 0.018, 16, 256), emis(0xffffff, 0.8)), [0, 0.0, 0], [Math.PI / 2, 0, 0]);
  // one long curved desk along the back, one screen per window
  {
    const A0 = 194, A1 = 256, RI = 3.85, RO = 4.85, N = 56;
    const sh = new THREE.Shape();
    for (let i = 0; i <= N; i++) { const a = (A0 + ((A1 - A0) * i) / N) * Math.PI / 180; const x = Math.cos(a) * RO, y = -Math.sin(a) * RO; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }
    for (let i = N; i >= 0; i--) { const a = (A0 + ((A1 - A0) * i) / N) * Math.PI / 180; sh.lineTo(Math.cos(a) * RI, -Math.sin(a) * RI); }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 8, curveSegments: 24 });
    geo.rotateX(-Math.PI / 2); geo.computeVertexNormals();
    const top = new THREE.Mesh(geo, M.oak); top.position.y = 0.75; top.castShadow = true; top.receiveShadow = true; room.add(top);
    [A0 + 2.5, (A0 + A1) / 2, A1 - 2.5].forEach((a) => { const [x, z] = pol(a, 4.35); const leg = rbox(0.05, 0.74, 0.8, 0.025, M.white); leg.position.set(x, 0.37, z); leg.rotation.y = Math.PI / 2 - (a * Math.PI) / 180; room.add(leg); });
  }
  const desks = DESK_ANG.map((deg) => {
    const [x, z] = pol(deg, 4.5);
    const mon = new THREE.Group(); mon.position.set(x, 0.79, z); mon.rotation.y = faceCenter(deg); room.add(mon);
    const stand = rbox(0.12, 0.44, 0.04, 0.02, M.alu); stand.position.set(0, 0.22, -0.08); stand.rotation.x = -0.12; mon.add(stand);
    const base = rbox(0.34, 0.02, 0.26, 0.05, M.alu); base.position.set(0, 0.01, -0.06); mon.add(base);
    const frame = rbox(1.5, 0.05, 0.92, 0.07, M.dark); frame.rotation.x = Math.PI / 2; frame.position.set(0, 0.78, 0); mon.add(frame);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.83), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 0.78, 0.027); mon.add(scr);
    const kb = rbox(0.66, 0.02, 0.22, 0.04, M.white); kb.position.set(0, 0.0, 0.4); mon.add(kb);
    const arcG = new THREE.Group(); arcG.rotation.y = ((deg - 9) * Math.PI) / 180 * -1; room.add(arcG);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(3.84, 0.012, 10, 60, (18 * Math.PI) / 180), emis(0x4cc983, 2)); edge.rotation.x = Math.PI / 2; edge.position.y = 0.73; arcG.add(edge);
    drawScreen(cv, null); tex.needsUpdate = true;
    return { cv, tex, edge, key: '' };
  });

  // writing table, front
  {
    const [x, z] = pol(70, 4.3);
    add(disc(0.62, 0.06, 0.03, M.oak), [x, 0.78, z]);
    cyl(0.04, 0.04, 0.74, M.alu, [x, 0.38, z], 24);
    add(disc(0.28, 0.02, 0.01, M.alu), [x, 0.01, z]);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.004, 0.56), M.paper), [x - 0.05, 0.814, z], [0, 0.4, 0]).receiveShadow = true;
    for (let i = 0; i < 5; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.28 - (i % 2) * 0.08, 0.002, 0.012), new THREE.MeshBasicMaterial({ color: 0xb9c0c8 })), [x - 0.12 + i * 0.03, 0.818, z - 0.2 + i * 0.08], [0, 0.4, 0]);
  }

  // lounge: sofa faces the TV at a 3/4 angle to the viewer
  const CAMF = new THREE.Vector3(1, 0, 1).normalize(), PERP = new THREE.Vector3(1, 0, -1).normalize();
  const sofaC = pol(150, 3.7);
  const tvx = sofaC[0] - CAMF.x * 2.3 + PERP.x * 0.2, tvz = sofaC[1] - CAMF.z * 2.3 + PERP.z * 0.2;
  const SF = new THREE.Vector3(tvx - sofaC[0], 0, tvz - sofaC[1]).normalize(), SR = new THREE.Vector3(SF.z, 0, -SF.x);
  {
    const g = new THREE.Group(); g.position.set(sofaC[0], 0, sofaC[1]); g.lookAt(tvx, 0, tvz); room.add(g);
    const seat = rbox(2.4, 0.4, 0.95, 0.2, M.fabric); seat.position.set(0, 0.22, 0); g.add(seat);
    const back = rbox(2.4, 0.75, 0.3, 0.15, M.fabric); back.position.set(0, 0.6, -0.42); g.add(back);
    [-1, 1].forEach((sd) => { const arm = rbox(0.3, 0.58, 0.95, 0.14, M.fabric); arm.position.set(sd * 1.18, 0.4, 0); g.add(arm); });
    [-0.55, 0.55].forEach((sx) => { const c = rbox(1.05, 0.14, 0.85, 0.12, M.fabric2); c.position.set(sx, 0.48, 0.05); g.add(c); });
  }
  const tvG = new THREE.Group(); tvG.position.set(tvx, 1.35, tvz); tvG.lookAt(tvx + CAMF.x, 1.35, tvz + CAMF.z); room.add(tvG);
  { const f = rbox(2.3, 0.06, 1.3, 0.08, M.dark); f.rotation.x = Math.PI / 2; tvG.add(f); }
  { const con = new THREE.Group(); con.position.set(tvx, 0, tvz); con.lookAt(tvx + CAMF.x, 0, tvz + CAMF.z); room.add(con); const c1 = rbox(2.4, 0.44, 0.5, 0.1, M.white); c1.position.y = 0.22; con.add(c1); const st = rbox(0.1, 0.22, 0.06, 0.03, M.alu); st.position.set(0, 0.55, -0.02); con.add(st); }
  const tvCv = document.createElement('canvas'); tvCv.width = 1024; tvCv.height = 560;
  const tvTex = new THREE.CanvasTexture(tvCv); tvTex.colorSpace = THREE.SRGBColorSpace; tvTex.anisotropy = 8;
  { const sc = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false })); sc.position.z = 0.034; tvG.add(sc); }
  { const x = (sofaC[0] + tvx) / 2, z = (sofaC[1] + tvz) / 2; add(disc(0.38, 0.05, 0.025, M.oak), [x, 0.42, z]); cyl(0.03, 0.03, 0.4, M.alu, [x, 0.2, z], 16); cyl(0.055, 0.045, 0.1, M.white, [x + 0.1, 0.5, z - 0.05], 32); }
  const shade = { material: { emissiveIntensity: 0 } };

  // two plants flanking the desk
  const plant = (deg, r, s = 1) => {
    const [x, z] = pol(deg, r);
    add(disc(0.32 * s, 0.56 * s, 0.1 * s, M.white), [x, 0.28 * s, z]);
    [[0, 0.95, 0, 0.42], [0.18, 1.25, 0.1, 0.3], [-0.16, 1.2, -0.08, 0.32], [0.05, 1.5, -0.05, 0.22]].forEach(([dx, y, dz, rr]) => sph(rr * s, M.leaf, [x + dx * s, y * s, z + dz * s]));
  };


  // robots: round body, long round limbs
  const robots = new Map();
  const PALETTES = [
    ['#1e6b52', '#5ed6a0', '#effff7', '#c8f07a', '#3f8a3a'],
    ['#6a3a16', '#f0a24a', '#fbe9cc', '#7fb6cc', '#2f6a80'],
    ['#2b4f9e', '#7aa6ff', '#f0f5ff', '#a6e0ff', '#4a6fd0'],
    ['#7a3a4a', '#ef9a80', '#fdeade', '#d2abef', '#8a4a86'],
  ];
  const washCache = {};
  function washMat(i) {
    if (washCache[i]) return washCache[i];
    const p = PALETTES[i % PALETTES.length];
    const sm = document.createElement('canvas'); sm.width = sm.height = 24; const c = sm.getContext('2d');
    const bg = c.createLinearGradient(0, 0, 0, 24); bg.addColorStop(0, p[0]); bg.addColorStop(0.55, p[4]); bg.addColorStop(1, p[0]);
    c.fillStyle = bg; c.fillRect(0, 0, 24, 24); c.lineCap = 'round';
    const st = (y, a, w, col, al) => { c.globalAlpha = al; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(-6, y); c.bezierCurveTo(6, y - a, 18, y + a, 30, y); c.stroke(); };
    st(17, 4, 4.5, p[3], 0.85); st(13, 5, 2.2, p[2], 0.9); st(10, 6, 3.5, p[1], 0.75); st(22, 3, 5, p[1], 0.8); st(4, 4, 3, p[3], 0.45);
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high'; c2.drawImage(sm, 0, 0, 512, 512);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return (washCache[i] = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 }));
  }
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const alienSkin = new THREE.MeshPhysicalMaterial({ color: 0xa6dc4e, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xe8ffb0), envMapIntensity: 1.2 });
  const headGeo = (() => {
    const c = new THREE.SplineCurve([new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.12, 0.03), new THREE.Vector2(0.27, 0.15), new THREE.Vector2(0.4, 0.36), new THREE.Vector2(0.47, 0.58), new THREE.Vector2(0.44, 0.8), new THREE.Vector2(0.3, 0.96), new THREE.Vector2(0.0001, 1.02)]);
    const g = new THREE.LatheGeometry(c.getPoints(64), 96); g.computeVertexNormals(); return g;
  })();
  function makeRobot(id, pal) {
    const root = new THREE.Group(); root.userData.robotId = id; root.scale.setScalar(1.3); room.add(root);
    const body = new THREE.Group(); root.add(body);
    const shorts = washMat(pal);
    const skin = alienSkin;
    const glow = emis(0x4cc983, 2.4);
    const mk = (geo, mat, parent, p, r, sc) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(...p); if (r) m.rotation.set(...r); if (sc) m.scale.set(...sc); m.castShadow = true; m.userData.robotId = id; parent.add(m); return m; };
    const leg = (sx) => { const p = new THREE.Group(); p.position.set(sx, 0.3, 0); body.add(p); mk(new THREE.CapsuleGeometry(0.058, 0.12, 16, 32), skin, p, [0, -0.11, 0]); mk(new THREE.CylinderGeometry(0.082, 0.078, 0.1, 32), shorts, p, [0, -0.02, 0]); mk(new THREE.SphereGeometry(0.08, 40, 28), skin, p, [0, -0.25, 0.035], null, [1, 0.62, 1.35]); return p; };
    const lL = leg(-0.095), lR = leg(0.095);
    mk(new THREE.CapsuleGeometry(0.15, 0.16, 24, 48), skin, body, [0, 0.49, 0], null, [1, 1, 0.86]);
    mk(new THREE.CapsuleGeometry(0.168, 0.05, 24, 48), shorts, body, [0, 0.36, 0], null, [1, 0.95, 0.88]);
    const halo = mk(new THREE.TorusGeometry(0.168, 0.014, 16, 72), glow, body, [0, 0.44, 0], [Math.PI / 2, 0, 0], [1, 0.88, 1]);
    const arm = (sx) => {
      const p = new THREE.Group(); p.position.set(sx * 0.165, 0.58, 0); p.rotation.z = sx * 0.12; body.add(p);
      mk(new THREE.CapsuleGeometry(0.042, 0.16, 16, 32), skin, p, [0, -0.11, 0]);
      const hand = new THREE.Group(); hand.position.set(0, -0.23, 0); p.add(hand);
      mk(new THREE.SphereGeometry(0.062, 32, 24), skin, hand); return { p, hand };
    };
    const A = arm(-1), Bm = arm(1);
    const head = new THREE.Group(); head.position.set(0, 0.68, 0); body.add(head);
    mk(new THREE.CapsuleGeometry(0.05, 0.05, 8, 24), skin, head, [0, -0.01, 0]);
    mk(headGeo, skin, head, [0, 0.0, 0], null, [1.0, 1.0, 0.94]);
    mk(new THREE.SphereGeometry(0.022, 20, 14), skin, head, [0, 0.2, 0.3], null, [1, 0.7, 0.8]);
    const eye = (sx) => {
      const e = mk(new THREE.SphereGeometry(0.1, 48, 32), eyeMat, head, [sx * 0.175, 0.36, 0.33], [0, sx * 0.48, sx * 0.42], [1.65, 0.92, 0.42]);
      mk(new THREE.SphereGeometry(0.02, 16, 12), glintMat, e, [sx * -0.03, 0.035, 0.088], null, [1, 1.4, 0.6]);
      return e;
    };
    const eyeL = eye(-1), eyeR = eye(1);
    const tip = new THREE.Object3D();
    const book = new THREE.Group(); book.position.set(0, 0.56, 0.26); book.rotation.x = -0.9; body.add(book);
    const cover = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7 });
    mk(new THREE.BoxGeometry(0.16, 0.016, 0.22), cover, book, [-0.08, 0, 0], [0, 0, 0.16]);
    mk(new THREE.BoxGeometry(0.16, 0.016, 0.22), cover, book, [0.08, 0, 0], [0, 0, -0.16]);
    const phone = new THREE.Group(); phone.position.set(0.02, -0.04, 0.07); phone.rotation.x = 1.25; A.hand.add(phone);
    { const pb = rbox(0.12, 0.016, 0.24, 0.03, M.dark); pb.rotation.x = Math.PI / 2; pb.userData.robotId = id; phone.add(pb); }
    mk(new THREE.PlaneGeometry(0.1, 0.21), emis(0x8fc2ff, 1.4), phone, [0, 0, 0.009]);
    const pen = new THREE.Group(); Bm.hand.add(pen);
    mk(new THREE.CapsuleGeometry(0.01, 0.16, 8, 16), M.graphite, pen, [0, -0.05, 0.03], [0.5, 0, 0]);
    const vp = new THREE.Group(); vp.position.set(0, 0.36, 0); head.add(vp);
    const vpc = [];
    { const shell = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
      const soft = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.95 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6 });
      const front = rbox(0.6, 0.3, 0.24, 0.12, shell); front.position.set(0, -0.03, 0.43); vp.add(front);
      const gasket = rbox(0.56, 0.26, 0.06, 0.1, dark); gasket.position.set(0, -0.04, 0.3); vp.add(gasket);
      [[-0.2, -0.1], [0.2, -0.1], [-0.25, 0.06], [0.25, 0.06]].forEach(([x, y]) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), dark); d.position.set(x, y - 0.03, 0.553); d.scale.z = 0.4; vp.add(d); });
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const sidePts = [[0.27, 0.43], [0.4, 0.28], [0.455, 0.05], [0.42, -0.2], [0.26, -0.39], [0, -0.45]];
      const sc = new THREE.CatmullRomCurve3([...sidePts.map(([x, z]) => V(x, -0.03, z)), ...sidePts.slice(0, -1).reverse().map(([x, z]) => V(-x, -0.03, z))], false, 'centripetal');
      vp.add(new THREE.Mesh(new THREE.TubeGeometry(sc, 120, 0.022, 12, false), soft));
      const tc = new THREE.CatmullRomCurve3([V(0, -0.03, -0.45), V(0, 0.25, -0.36), V(0, 0.41, -0.1), V(0, 0.41, 0.12), V(0, 0.27, 0.34), V(0, 0.13, 0.43)], false, 'centripetal');
      vp.add(new THREE.Mesh(new THREE.TubeGeometry(tc, 80, 0.02, 10, false), soft));
      vp.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.robotId = id; } });
      [A.hand, Bm.hand].forEach((hd) => { const c = new THREE.Group(); hd.add(c);
        const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.09, 8, 16), shell); grip.position.set(0, -0.02, 0.04); grip.rotation.x = 0.4; c.add(grip);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 12, 40), shell); ring.position.set(0, 0.06, 0.06); ring.rotation.x = -0.6; c.add(ring);
        c.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.robotId = id; } }); c.visible = false; vpc.push(c); }); }
    vp.visible = false;
    const excl = new THREE.Group(); excl.position.set(0, 1.15, 0); head.add(excl);
    const orange = emis(0xf5934a, 2.6);
    mk(new THREE.CapsuleGeometry(0.045, 0.14, 16, 32), orange, excl, [0, 0.13, 0]);
    mk(new THREE.SphereGeometry(0.05, 32, 24), orange, excl, [0, -0.05, 0]);
    const dots = new THREE.Group(); dots.position.set(0.4, 0.95, 0.1); head.add(dots);
    const dotMat = emis(0xffffff, 1.4);
    const dotMeshes = [0, 1, 2].map((i) => mk(new THREE.SphereGeometry(0.04, 32, 24), dotMat, dots, [i * 0.12, i * 0.07, 0]));
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4cc983, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.385, 128), ringMat); ring.rotation.x = -Math.PI / 2; root.add(ring);
    const pingMat = ringMat.clone();
    const ping = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.378, 128), pingMat); ping.rotation.x = -Math.PI / 2; root.add(ping);
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:7px;padding:6px 12px 6px 7px;border-radius:999px;white-space:nowrap;font:500 13px Geist,-apple-system,sans-serif;color:#fff;background:rgba(22,26,30,0.28);-webkit-backdrop-filter:blur(14px) saturate(1.7);backdrop-filter:blur(2px) url(#lgs) saturate(1.7);box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),inset 0 -1px 0 rgba(255,255,255,0.15),inset 1px 0 0 rgba(255,255,255,0.18),inset -1px 0 0 rgba(255,255,255,0.18),0 8px 20px rgba(0,0,0,0.18);transition:opacity .25s;will-change:transform;';
    const p = PALETTES[pal % PALETTES.length];
    label.innerHTML = '<span style="width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,' + p[0] + ' 8%,' + p[1] + ' 36%,' + p[2] + ' 50%,' + p[3] + ' 66%,' + p[4] + ' 92%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.5);"></span><span></span><span style="width:6px;height:6px;border-radius:50%;margin-left:2px;"></span>';
    label.addEventListener('click', (e) => { e.stopPropagation(); opts.onSelect && opts.onSelect(id); });
    overlay.appendChild(label);
    return { id, root, body, head, vp, vpc, glow, eyeL, eyeR, tip, halo, aL: A.p, aR: Bm.p, lL, lR, book, phone, pen, excl, dots, dotMeshes, ring, ringMat, ping, pingMat, label,
      pos: new THREE.Vector3(), y: 0, yaw: 0, phase: Math.random() * 6, pose: 'idle', status: 'idle', spot: null, placed: false };
  }

  const spotDesk = (i) => { const a = DESK_ANG[i % DESK_ANG.length]; const [x, z] = pol(a, 3.3); const [fx, fz] = pol(a, 6); return { x, z, fx, fz, y: 0 }; };
  function spotFor(pose, desk, k) {

    const front = (deg, r) => { const [x, z] = pol(deg, r); return { x, z, fx: x + 10, fz: z + 10, y: 0 }; };
    switch (pose) {
      case 'write': return spotDesk(desk);
      case 'think': return front(328 + k * 16, 3.5);
      case 'ask': return front(30 + k * 18, 4.0);
      case 'test': return front(2 + k * 18, 3.9);
      case 'done': case 'idle': { const x = sofaC[0] + SR.x * (k - 0.5) * 0.95 + SF.x * 0.05, z = sofaC[1] + SR.z * (k - 0.5) * 0.95 + SF.z * 0.05; return { x, z, fx: tvx, fz: tvz, y: 0.2, sit: true }; }
      default: return spotDesk(desk);
    }
  }

  const bridge = new THREE.Group(); { const [bx, bz] = pol(45, 5.6); bridge.position.set(bx, 0.0, bz); bridge.rotation.y = Math.PI / 4; room.add(bridge);
    const plank = rbox(1.3, 0.06, 3.4, 0.12, M.white); plank.position.set(0, 0.01, 1.7); bridge.add(plank);
    [-0.63, 0.63].forEach((x) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 3.3), emis(0x9fe6ff, 2)); e.position.set(x, 0.05, 1.7); bridge.add(e); });
    bridge.scale.z = 0; bridge.visible = false; }
  const pilot = (() => {
    const g = new THREE.Group(); room.add(g);
    const metal = new THREE.MeshPhysicalMaterial({ color: 0xe4e7eb, roughness: 0.18, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.05 });
    const base = disc(1.62, 0.3, 0.14, metal); base.position.y = 0.15; g.add(base);
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.032, 16, 180), emis(0x9fe6ff, 2)); glowRing.rotation.x = Math.PI / 2; glowRing.position.y = 0.305; g.add(glowRing);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.52, 128, 64, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xf2f9ff, roughness: 0.0, transparent: true, opacity: 0.12, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 3.2, depthWrite: false }));
    dome.position.y = 0.3; dome.renderOrder = 10; g.add(dome);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.53, 0.04, 16, 180), metal); rim.rotation.x = Math.PI / 2; rim.position.y = 0.32; g.add(rim);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 32, 24), emis(0x9fe6ff, 2.2)); cap.position.y = 0.3 + 1.54; g.add(cap);
    const cab = new THREE.Group(); cab.position.y = 0.3; cab.rotation.y = Math.PI / 4; g.add(cab);
    const seatM = new THREE.MeshPhysicalMaterial({ color: 0xf8f8f9, roughness: 0.32, clearcoat: 0.9 });
    const PZ = -0.28;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.18, 32), metal); stem.position.set(0, 0.09, PZ); cab.add(stem);
    const seat = rbox(0.5, 0.12, 0.46, 0.12, seatM); seat.position.set(0, 0.24, PZ); cab.add(seat);
    const back = rbox(0.5, 0.62, 0.12, 0.12, seatM); back.position.set(0, 0.58, PZ - 0.26); back.rotation.x = -0.15; cab.add(back);
    const dashM = new THREE.MeshPhysicalMaterial({ color: 0x16181d, roughness: 0.2, clearcoat: 1 });
    const oakM = new THREE.MeshPhysicalMaterial({ color: 0xe3d1b6, roughness: 0.5, clearcoat: 0.3 });
    const desk = rbox(1.25, 0.04, 0.46, 0.06, oakM); desk.position.set(0, 0.5, PZ + 0.46); cab.add(desk);
    [-0.56, 0.56].forEach((x) => { const lg = rbox(0.04, 0.48, 0.38, 0.02, metal); lg.position.set(x, 0.25, PZ + 0.46); cab.add(lg); });
    const holo = [];
    const mon = (x, ry) => { const m = new THREE.Group(); m.position.set(x, 0.52, PZ + 0.6); m.rotation.y = ry; cab.add(m);
      const st = rbox(0.05, 0.16, 0.02, 0.01, metal); st.position.set(0, 0.08, -0.02); m.add(st);
      const fr = rbox(0.5, 0.02, 0.3, 0.03, dashM); fr.rotation.x = Math.PI / 2; fr.position.y = 0.3; m.add(fr);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9, toneMapped: false })); sc.position.set(0, 0.3, -0.012); sc.rotation.y = Math.PI; m.add(sc); holo.push(sc); };
    mon(-0.27, -0.3); mon(0.27, 0.3);
    const lap = new THREE.Group(); lap.position.set(0, 0.525, PZ + 0.36); cab.add(lap);
    const lb = rbox(0.3, 0.015, 0.2, 0.02, metal); lap.add(lb);
    const lid = new THREE.Group(); lid.position.set(0, 0.008, 0.1); lid.rotation.x = -0.35; lap.add(lid);
    const lt = rbox(0.3, 0.012, 0.2, 0.02, metal); lt.rotation.x = Math.PI / 2; lt.position.set(0, 0.1, 0); lid.add(lt);
    const ls = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.17), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false })); ls.position.set(0, 0.1, -0.008); ls.rotation.y = Math.PI; lid.add(ls); holo.push(ls);
    const yoke = new THREE.Group();
    const r = makeRobot('pilot', 0); r.label.children[1].textContent = 'Ari'; r.label.lastChild.style.background = '#7ff0b0'; r.label.lastChild.style.boxShadow = '0 0 8px #7ff0b0';
    cab.add(r.root); r.root.position.set(0, 0.29, PZ); r.root.rotation.y = 0; r.root.scale.setScalar(0.72);
    r.lL.rotation.x = r.lR.rotation.x = -1.45; r.aL.rotation.set(-1.35, 0, -0.2); r.aR.rotation.set(-1.35, 0, 0.2);
    [r.book, r.phone, r.pen, r.excl, r.dots, r.vp].forEach((m) => { m.visible = false; }); r.vpc.forEach((c) => { c.visible = false; });
    r.ring.visible = r.ping.visible = false; r.halo.visible = false;
    r.holo = holo; r.glowRing = glowRing; r.cap = cap; r.yoke = yoke;
    { const hs = new THREE.MeshPhysicalMaterial({ color: 0x2a2e36, roughness: 0.4, clearcoat: 0.6 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.028, 12, 64, Math.PI), hs); band.position.y = 0.36; r.head.add(band);
      [-1, 1].forEach((sd) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 32), hs); cup.rotation.z = Math.PI / 2; cup.position.set(sd * 0.44, 0.34, 0); r.head.add(cup); });
                  r.head.traverse((m) => { if (m.isMesh) m.userData.robotId = 'pilot'; }); }
    return r;
  })();
  let data = { sessions: [], ring: {}, tv: {} };
  let ringKey = '', tvKey = '';
  function update(next) {
    data = next || data;
    const seen = new Set(); const counts = {};
    (data.sessions || []).forEach((s) => {
      seen.add(s.id);
      let r = robots.get(s.id);
      if (!r) { r = makeRobot(s.id, (s.palette || 0) + 1); robots.set(s.id, r); }
      const group = s.pose === 'idle' ? 'done' : ['edit', 'read', 'run'].includes(s.pose) ? 'edit' : s.pose;
      const k = group === 'edit' ? 0 : (counts[group] = (counts[group] || 0) + 1) - 1;
      r.pose = s.pose; r.status = s.status;
      r.spot = spotFor(s.pose, s.desk, k);
      if (!r.placed) { r.pos.set(r.spot.x, 0, r.spot.z); r.y = r.spot.y; r.yaw = Math.atan2(r.spot.fx - r.spot.x, r.spot.fz - r.spot.z); r.placed = true; }
      const col = STATUS[s.status];
      r.glow.color.setHex(col); r.glow.emissive.setHex(col); r.glow.emissiveIntensity = s.status === 'idle' ? 0.5 : s.status === 'done' ? 1.2 : 2.3;
      r.ringMat.color.setHex(col); r.pingMat.color.setHex(col);
      r.label.lastChild.style.background = HEX(col); r.label.lastChild.style.boxShadow = `0 0 8px ${HEX(col)}`;
      r.label.children[1].textContent = s.name;
    });
    for (const [id, r] of robots) if (!seen.has(id)) { scene.remove(r.root); r.label.remove(); robots.delete(id); }
    desks.forEach((d, i) => {
      const s = (data.sessions || []).find((x) => x.desk === i && x.pose === 'edit') || (data.sessions || []).find((x) => x.desk === i);
      const key = s ? `${s.name}|${s.status}|${s.pct}|${s.action}` : '';
      if (key !== d.key) { d.key = key; drawScreen(d.cv, s || null); d.tex.needsUpdate = true; }
      const on = s && (s.status === 'working' || s.status === 'needs');
      d.edge.visible = !!on;
      if (on) { d.edge.material.color.setHex(STATUS[s.status]); d.edge.material.emissive.setHex(STATUS[s.status]); }
    });
    const tk = JSON.stringify([data.tv, (data.sessions || []).map((s) => [s.name, s.status, s.pct])]);
    tvKey = tk;
    setTheme(themeName);
  }

  let themeName = 'afternoon';
  function setTheme(name) {
    themeName = THEMES[name] ? name : 'afternoon';
    const th = THEMES[themeName];
    hemi.color.setHex(th.hemi[0]); hemi.groundColor.setHex(th.hemi[1]); hemi.intensity = th.hemi[2];
    sun.color.setHex(th.sun[0]); sun.intensity = th.sun[1]; sunBase.set(...th.sun[2]); sun.position.copy(sunBase);
    renderer.toneMappingExposure = th.exp; lamp.intensity = th.lamp; ringLight.intensity = th.lamp ? 2.2 : 0;
    shade.material.emissiveIntensity = th.lamp ? 1.2 : 0;
    Object.values(ENVS).forEach((e) => e.setTheme(themeName));
  }

  const view = { k: 1, ty: 0, focus: null, hideLabels: false };
  const cam = { k: 1, ty: 0, ftx: 0, fty: 0, ftz: 0, f: 0, yaw: 0, zoom: 1 };
  const orbit = { yaw: 0, zoom: 1 };
  function baseDist() {
    const aspect = W() / H(); const frac = 0.5;
    const vis = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    return 15.5 / (frac * vis);
  }
  function setView(v) { Object.assign(view, v); }
  function focus(id) { if ((id || null) !== view.focus) { orbit.yaw = 0; orbit.zoom = 1; } view.focus = id || null; }

  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const pick = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...robots.values()].map((x) => x.root).concat([pilot.root]), true);
    if (hits.length) return hits[0].object.userData.robotId;
    if (loc === 'city') { const lh = ray.intersectObjects(ENVS.city.landmarks.flatMap((b) => b.meshes), false); if (lh.length) return 'lm:' + lh[0].object.userData.lm; }
    return null;
  };
  let down = null, dragging = false;
  const onDown = (e) => { down = [e.clientX, e.clientY]; dragging = false; if (view.focus) renderer.domElement.setPointerCapture(e.pointerId); };
  const onUp = (e) => {
    if (!down) return; const d = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
    renderer.domElement.style.cursor = view.focus ? 'grab' : 'default';
    if (d > 6) return; const id = pick(e); if (!id) return; if (id.startsWith('lm:')) { setFly(id.slice(3)); opts.onBuilding && opts.onBuilding(id.slice(3)); } else if (opts.onSelect) opts.onSelect(id);
  };
  let lastMove = 0;
  const onMove = (e) => {
    if (down && view.focus) {
      if (Math.abs(e.clientX - down[0]) > 3) dragging = true;
      if (dragging) { orbit.yaw -= e.movementX * 0.006; renderer.domElement.style.cursor = 'grabbing'; }
      return;
    }
    const t = performance.now(); if (t - lastMove < 60) return; lastMove = t;
    renderer.domElement.style.cursor = pick(e) ? 'pointer' : view.focus ? 'grab' : 'default';
  };
  const onWheel = (e) => { if (!view.focus || e.target !== renderer.domElement) return; e.preventDefault(); const nz = orbit.zoom * (1 + e.deltaY * 0.0012); if (nz > 1.9 && e.deltaY > 0) { if (!outT) { outT = setTimeout(() => { outT = 0; }, 700); opts.onZoomOut && opts.onZoomOut(); } return; } orbit.zoom = Math.max(0.5, Math.min(1.9, nz)); };
  let outT = 0;
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);
  window.addEventListener('wheel', onWheel, { passive: false });

  const lmLabels = ENVS.city.landmarks.map((b) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;display:none;align-items:center;gap:8px;padding:7px 13px 7px 8px;border-radius:999px;white-space:nowrap;font:500 13px Geist,-apple-system,sans-serif;color:#fff;background:rgba(22,26,30,0.3);-webkit-backdrop-filter:blur(14px) saturate(1.7);backdrop-filter:blur(2px) url(#lgs) saturate(1.7);box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),inset 0 -1px 0 rgba(255,255,255,0.15),inset 1px 0 0 rgba(255,255,255,0.18),inset -1px 0 0 rgba(255,255,255,0.18),0 8px 20px rgba(0,0,0,0.18);transition:opacity .4s;will-change:transform;';
    el.innerHTML = '<span style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:' + HEX(b.col) + ';"><span style="font-family:\'Material Symbols Rounded\';font-size:15px;line-height:1;color:#fff;">' + b.icon + '</span></span>' + b.name + '<span style="font-size:12px;color:rgba(255,255,255,0.7);"></span>';
    el.addEventListener('click', (e) => { e.stopPropagation(); setFly(b.key); opts.onBuilding && opts.onBuilding(b.key); });
    overlay.appendChild(el); return { b, el, count: el.lastChild };
  });
  const resize = () => { renderer.setSize(W(), H(), false); camera.aspect = W() / H(); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * t; };
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3(); const dir = new THREE.Vector3(); const up = new THREE.Vector3(0, 1, 0); const v3 = new THREE.Vector3();
  let raf = 0, alive = true;
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime;
    ENVS[loc].tick(dt, t);
    if (!frame._tv || t - frame._tv > 1 / 15) { frame._tv = t; drawShow(tvCv, t, data.sessions || [], data.tv || {}); tvTex.needsUpdate = true; }
    { const ft = t * 0.045; const amp = Math.max(0, Math.min(1, (t - manualT - 4) / 8));
      let px = man.x + amp * (4 * Math.sin(ft) + 3 * Math.sin(ft * 1.6 + 0.8)), pz = man.z + amp * (4 * Math.sin(ft) - 3 * Math.sin(ft * 1.6 + 0.8)), py = 0;
      const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), ky = (keys.u ? 1 : 0) - (keys.d ? 1 : 0);
      if (kx || ky) {
        if (!mapGo && t - manualT > 4) { man.x = fly.x; man.z = fly.z; }
        mapGo = false; homeGo = false; manualT = t; if (flyTo) { setFly(null); opts.onLeave && opts.onLeave(); }
        man.x += (kx * 0.707 - ky * 0.707) * dt * 16; man.z += (-kx * 0.707 - ky * 0.707) * dt * 16;
        const mr = Math.hypot(man.x, man.z); if (mr > 95) { man.x *= 95 / mr; man.z *= 95 / mr; }
        px = man.x; pz = man.z;
      }
      const tb = loc === 'city' && flyTo && ENVS.city.landmarks.find((b) => b.key === flyTo);
      if (dockReady && tb !== dockReady) dockReady = null;
      if (tb) { px = tb.x - tb.dock; pz = tb.z - tb.dock; py = tb.top - 0.55; }
      if (boarding) { px = fly.x; pz = fly.z; py = fly.y; }
      const sp2 = Math.min(1, dt * (tb ? 0.8 : mapGo ? 0.9 : t - manualT < 1 ? 3 : 0.5));
      const ox = fly.x, oz = fly.z;
      fly.x += (px - fly.x) * sp2; fly.z += (pz - fly.z) * sp2; fly.y += (py - fly.y) * Math.min(1, dt * (tb && Math.hypot(px - fly.x, pz - fly.z) < 6 ? 0.9 : 0.35));
      const vx = (fly.x - ox) / Math.max(dt, 0.001) * 0.04, vz = (fly.z - oz) / Math.max(dt, 0.001) * 0.04;
      { const ddx = fly.x - ox, ddz = fly.z - oz; if (Math.hypot(ddx, ddz) > 0.004) fly.a = lerpAngle(fly.a || 0, Math.atan2(ddx - ddz, -(ddx + ddz)), Math.min(1, dt * 4)); }
      const docked = tb && Math.hypot(px - fly.x, pz - fly.z) < 0.5 && Math.abs(py - fly.y) < 0.5;
      if (docked && !dockFired) { dockFired = true; dockReady = tb; opts.onDock && opts.onDock(tb.key); }
      if (!tb) dockReady = null;
      camOff.x += ((dockReady ? 5.6 : 0) - camOff.x) * Math.min(1, dt * 1.5); camOff.z += ((dockReady ? 5.6 : 0) - camOff.z) * Math.min(1, dt * 1.5);
      if (loc === 'city' && !tb) { let nk = null, nd = 1e9; ENVS.city.landmarks.forEach((b) => { const d2 = Math.hypot(b.x - fly.x, b.z - fly.z); if (d2 < nd) { nd = d2; nk = b.key; } }); if (coolKey) { const cb = ENVS.city.landmarks.find((b) => b.key === coolKey); if (!cb || Math.hypot(cb.x - fly.x, cb.z - fly.z) > 20) coolKey = null; }
        if (nd < 10 && nk !== coolKey && !homeGo && (t - manualT < 2 || mapGo)) { mapGo = false; setFly(nk); opts.onBuilding && opts.onBuilding(nk); }
        nk = nd < 16 ? nk : null; if (nk !== nearKey) { nearKey = nk; opts.onNear && opts.onNear(nk); } }
      else if (nearKey) { nearKey = null; opts.onNear && opts.onNear(null); }
      px = fly.x; pz = fly.z;
      room.position.set(px, fly.y + (dockReady || boarding ? 0 : 0.18 * Math.sin(t * 0.7)), pz);
      bridge.scale.z += ((dockReady ? 1 : 0) - bridge.scale.z) * Math.min(1, dt * 3); bridge.visible = bridge.scale.z > 0.02;
      const calm = dockReady || boarding ? 0 : 1; room.rotation.z = (-Math.max(-0.08, Math.min(0.08, vx)) * 0.5 + 0.006 * Math.sin(t * 0.45)) * calm; room.rotation.x = (Math.max(-0.08, Math.min(0.08, vz)) * 0.5 + 0.005 * Math.sin(t * 0.6 + 1)) * calm;
      sun.target.position.copy(room.position); sun.position.set(sunBase.x + px, sunBase.y, sunBase.z + pz); }
    pilot.body.position.y = -0.18 + 0.01 * Math.sin(t * 1.4);  pilot.cap.scale.setScalar(1 + 0.15 * Math.sin(t * 3)); pilot.yoke.rotation.z = Math.max(-0.35, Math.min(0.35, (room.rotation.z || 0) * 6)) + 0.04 * Math.sin(t * 0.6); pilot.head.rotation.y = 0.25 * Math.sin(t * 0.35); pilot.aR.rotation.x = -1.35 + 0.04 * Math.sin(t * 2.2); pilot.aL.rotation.x = -1.35 + 0.04 * Math.sin(t * 1.7 + 1); pilot.eyeL.scale.y = pilot.eyeR.scale.y = ((t % 5.1) < 0.12 ? 0.1 : 0.9);
    ufoLights.forEach((m, i) => { m.material.emissiveIntensity = 0.5 + 2.2 * Math.max(0, Math.sin(t * 3 - i * 0.45)); });
    if (ufoBeam.m) { ufoBeam.m.material.opacity = 0.2 + 0.08 * Math.sin(t * 1.7); ufoBeam.m.rotation.y = t * 0.2; ufoBeam.pool.material.opacity = 0.6 + 0.25 * Math.sin(t * 1.7); ufoBeam.pool.position.y = (loc === 'coast' ? -33.9 : -45.8) - room.position.y; ufoBeam.m.scale.y = loc === 'coast' ? 0.73 : 1; ufoBeam.m.position.y = loc === 'coast' ? -18 : -24; }

    let rIdx = 0, boardingNow = false;
    for (const r of robots.values()) {
      const rI = rIdx++;
      let sp = r.spot; if (!sp) continue;
      { const BH = pol(45, 5.0), BE = pol(45, 7.9); const near = (p) => Math.hypot(p[0] - r.pos.x, p[1] - r.pos.z) < 0.12;
        let tgt = null, face = null;
        if (dockReady) {
          if (!r.dockStage || r.dockStage > 3) r.dockStage = 1;
          const DO = [[-1.0, 1.1], [1.1, -1.0], [0.8, 0.8]][rI % 3];
          const roof = [dockReady.x - room.position.x + DO[0], dockReady.z - room.position.z + DO[1]];
          if (r.dockStage === 1) { tgt = BH; if (near(BH)) r.dockStage = 2; }
          if (r.dockStage === 2) { tgt = BE; if (near(BE)) r.dockStage = 3; }
          if (r.dockStage === 3) { tgt = roof; face = [roof[0] + 10, roof[1] + 10]; }
        } else if (r.dockStage) {
          if (r.dockStage === 1) r.dockStage = 0;
          else { if (r.dockStage === 3 || r.dockStage === 2) r.dockStage = 4; if (r.dockStage === 4) { tgt = BE; if (near(BE)) r.dockStage = 5; } if (r.dockStage === 5) { tgt = BH; if (near(BH)) r.dockStage = 0; } }
        }
        if (tgt) { sp = r.dockSp || (r.dockSp = {}); sp.x = tgt[0]; sp.z = tgt[1]; sp.y = 0; sp.fx = face ? face[0] : tgt[0] + (tgt[0] - r.pos.x) * 10; sp.fz = face ? face[1] : tgt[1] + (tgt[1] - r.pos.z) * 10; sp.sit = false; sp.bld = null; sp.walk = true; }
        if (r.dockStage && !dockReady) boardingNow = true; }
      if (sp.bld) { sp.x = sp.bld.x - room.position.x; sp.z = sp.bld.z - room.position.z; sp.y = sp.bld.top - room.position.y; }
      const dx = sp.x - r.pos.x, dz = sp.z - r.pos.z; const dist = Math.hypot(dx, dz);
      const travelling = !sp.walk && dist > 0.6;
      const wantY = travelling ? 2.4 : sp.y;
      r.y += (wantY - r.y) * Math.min(1, dt * 2.4);
      const canMove = !travelling || r.y > 1.9;
      if (canMove && dist > 0.002) { const step = Math.min(dist, sp.walk ? dt * 1.5 : dt * Math.max(2.8, dist * 0.9)); r.pos.x += (dx / dist) * step; r.pos.z += (dz / dist) * step; }
      r.moving = dist > 0.05;
      const yawT = travelling || (sp.walk && dist > 0.05) ? Math.atan2(dx, dz) : view.focus === r.id && !r.moving ? Math.atan2(camera.position.x - room.position.x - r.pos.x, camera.position.z - room.position.z - r.pos.z) : Math.atan2(sp.fx - r.pos.x, sp.fz - r.pos.z);
      r.yaw = lerpAngle(r.yaw, yawT, Math.min(1, dt * 4));
      const arrived = sp.bld && !travelling && Math.abs(r.y - sp.y) < 0.4;
      r.inside = (r.inside || 0) + ((arrived ? 1 : 0) - (r.inside || 0)) * Math.min(1, dt * 2.5);
      let ox = 0, oz = 0, vr = r.pose === 'test' && !travelling && !sp.bld && !sp.walk;
      if (vr) { const wa = t * 0.45 + r.phase; ox = Math.cos(wa) * 0.75; oz = Math.sin(wa) * 0.75; r.yaw = lerpAngle(r.yaw, Math.atan2(-Math.sin(wa), Math.cos(wa)), Math.min(1, dt * 5)); }
      r.root.position.set(r.pos.x + ox, r.y, r.pos.z + oz); r.root.rotation.y = r.yaw; r.root.scale.setScalar(1.3 * Math.max(0.001, 1 - (r.inside || 0)));

      const pose = r.moving ? 'move' : r.dockStage === 3 ? 'stand' : r.pose; const ph = r.phase;
      let aL = [0, 0, -0.12], aR = [0, 0, 0.12], lgL = 0, lgR = 0, tilt = 0, hx = 0, hy = 0, hz = 0, bobA = 0.012, bobS = 1.6, sitY = 0;
      switch (pose) {
        case 'move': aL = [0.45, 0, -0.4]; aR = [0.45, 0, 0.4]; lgL = 0.25 * Math.sin(t * 6); lgR = -lgL; tilt = 0.12; bobA = 0.02; bobS = 3; break;
        case 'edit': aL = [-1.2 + 0.1 * Math.sin(t * 16 + ph), 0, -0.25]; aR = [-1.2 + 0.1 * Math.sin(t * 16 + ph + Math.PI), 0, 0.25]; hx = 0.18; break;
        case 'write': aL = [-0.95, 0, -0.3]; aR = [-1.15 + 0.06 * Math.sin(t * 14), 0.12 * Math.sin(t * 7), 0.2]; hx = 0.4; tilt = 0.14; bobA = 0.006; break;
        case 'read': aL = [-1.1, 0, -0.35]; aR = [-1.1, 0, 0.35]; hx = 0.3; bobA = 0.008; break;
        case 'think': aL = [-0.25, 0, -0.15]; aR = [-2.2, 0, 0.5]; hz = 0.1 * Math.sin(t * 0.6); hx = -0.15; bobS = 1; break;
        case 'ask': aL = [0, 0, -0.18]; aR = [0, 0, 2.5 + 0.35 * Math.sin(t * 7)]; bobA = 0.03; bobS = 4; break;
        case 'test': aL = [-1.5 + 0.06 * Math.sin(t * 2 + 1), 0.12 * Math.sin(t * 1.1), -0.12]; aR = [-1.5 + 0.06 * Math.sin(t * 2), -0.12 * Math.sin(t * 1.3), 0.12]; lgL = 0.3 * Math.sin(t * 5); lgR = -lgL; hy = 0.3 * Math.sin(t * 0.8); bobA = 0.015; bobS = 5; break;
        case 'run': aL = [-1.3, 0, -0.1]; aR = [-1.2, 0, 0.3]; hx = 0.28; break;
        case 'done': aL = [-0.5, 0, -0.32]; aR = [-0.5, 0, 0.32]; hz = 0.05 * Math.sin(t * 0.4 + ph); bobA = 0.005; bobS = 0.8; break;
        case 'idle': aL = [-0.45, 0, -0.3]; aR = [-0.45, 0, 0.3]; hy = 0.3 * Math.sin(t * 0.3 + ph); bobA = 0.005; bobS = 0.7; break;
      }
      const sitting = sp.sit && !r.moving;
      if (sitting) { lgL = -1.45; lgR = -1.45; sitY = -0.18; }
      const k = Math.min(1, dt * 7);
      const ez = (o, v) => o + (v - o) * k;
      r.aL.rotation.set(ez(r.aL.rotation.x, aL[0]), ez(r.aL.rotation.y, aL[1]), ez(r.aL.rotation.z, aL[2]));
      r.aR.rotation.set(ez(r.aR.rotation.x, aR[0]), ez(r.aR.rotation.y, aR[1]), ez(r.aR.rotation.z, aR[2]));
      r.lL.rotation.x = ez(r.lL.rotation.x, lgL); r.lR.rotation.x = ez(r.lR.rotation.x, lgR);
      r.head.rotation.set(ez(r.head.rotation.x, hx), ez(r.head.rotation.y, hy), ez(r.head.rotation.z, hz));
      r.body.rotation.x = ez(r.body.rotation.x, tilt);
      r.baseY = ez(r.baseY || 0, sitY); r.body.position.y = r.baseY + bobA * Math.sin(t * bobS + ph);
      const P = r.moving ? '' : r.pose;
      r.book.visible = P === 'read'; r.phone.visible = P === 'run'; r.vp.visible = P === 'test'; r.vpc.forEach((c) => { c.visible = r.vp.visible; }); r.eyeL.visible = r.eyeR.visible = !r.vp.visible; r.pen.visible = P === 'write';
      r.excl.visible = r.status === 'needs'; r.excl.position.y = 1.15 + 0.05 * Math.sin(t * 5);
      r.dots.visible = P === 'think';
      r.dotMeshes.forEach((m, i) => m.scale.setScalar(0.6 + 0.5 * Math.max(0, Math.sin(t * 3 - i * 0.7))));
      const blink = ((t + ph) % 4.3) < 0.12; const happy = r.status === 'done' || r.status === 'idle';
      const ey = 0.92 * (blink ? 0.12 : happy ? 0.5 : 1);
      r.eyeL.scale.y = ez(r.eyeL.scale.y, ey); r.eyeR.scale.y = r.eyeL.scale.y;
      r.halo.scale.setScalar(1 + 0.04 * Math.sin(t * 3 + ph)); r.tip.scale.setScalar(1 + 0.2 * Math.sin(t * 4 + ph));
      const ringOn = !sp.sit && !travelling && !sp.bld;
      r.ring.visible = ringOn; r.ring.position.y = (0.012 - r.y + sp.y) / 1.3;
      const live = r.status === 'working' || r.status === 'needs' || r.status === 'testing';
      r.ping.visible = ringOn && live; r.ping.position.y = r.ring.position.y + 0.001;
      const fr = ((t * (r.status === 'needs' ? 0.9 : 0.55)) + ph) % 1;
      r.ping.scale.setScalar(1 + fr * 1.1); r.pingMat.opacity = (1 - fr) * 0.7;

      r.labelY = 2.25 * (r.inside ? 1 - r.inside : 1) + (r.inside || 0) * 1.5;
    }

    boarding = boardingNow;
    ENVS.city.landmarks.forEach((b) => { b.sign.visible = dockReady !== b; b.sign.quaternion.copy(camera.quaternion); b.sign.scale.setScalar(b.signScale * (b.on ? 1 + 0.04 * Math.sin(t * 3) : 1)); if (b.on) { b.crownM.color.setScalar(0.75 + 0.25 * Math.sin(t * 3)); b.light.intensity = 32 + 12 * Math.sin(t * 3); } });
    lmLabels.forEach(({ b, el, count }) => {
      tmp.set(b.x, b.top + 6.2, b.z).project(camera);
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * W()}px, ${(-tmp.y * 0.5 + 0.5) * H()}px) translate(-50%, -100%)`;
      const vis = false;
      el.style.opacity = vis ? '1' : '0'; el.style.pointerEvents = vis ? 'auto' : 'none';
      const n = [...robots.values()].filter((r) => r.spot && r.spot.bld === b).length; count.textContent = n ? n + ' inside' : '';
    });
    pilot.labelY = 1.55;
    if (false) { const ph = 0;
      pilot.label.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * W()}px, ${(-tmp.y * 0.5 + 0.5) * H()}px) translate(-50%, -100%)`; pilot.label.style.opacity = ph ? '0' : '1'; pilot.label.style.pointerEvents = ph ? 'none' : 'auto'; }
    const fr = view.focus === 'pilot' ? pilot : view.focus && robots.get(view.focus);
    const ease = Math.min(1, dt * 2.6);
    cam.f += ((fr ? 1 : 0) - cam.f) * ease;
    cam.k += (view.k - cam.k) * ease; cam.ty += (view.ty - cam.ty) * ease;
    cam.yaw += ((fr ? orbit.yaw : 0) - cam.yaw) * Math.min(1, dt * 6);
    cam.zoom += ((fr ? orbit.zoom : 1) - cam.zoom) * Math.min(1, dt * 6);
    if (fr) { fr.root.getWorldPosition(v3); cam.ftx += (v3.x - room.position.x - cam.ftx) * ease; cam.fty += (fr.y + 1.25 - cam.fty) * ease; cam.ftz += (v3.z - room.position.z - cam.ftz) * ease; }
    const bd = baseDist() * cam.k;
    const dist = bd + (12.5 * cam.zoom - bd) * cam.f;
    const tx = cam.ftx * cam.f, ty = cam.ty * (1 - cam.f) + cam.fty * cam.f, tz = cam.ftz * cam.f;
    dir.copy(DIR).applyAxisAngle(up, cam.yaw);
    tmp.set(tx + room.position.x + camOff.x * (1 - cam.f), ty + room.position.y, tz + room.position.z + camOff.z * (1 - cam.f));
    camera.position.copy(tmp).addScaledVector(dir, dist); camera.lookAt(tmp);
    camera.updateMatrixWorld(); scene.updateMatrixWorld();
    const Wd = W(), Hd = H();
    [...robots.values(), pilot].forEach((r) => {
      r.root.getWorldPosition(tmp); tmp.y += r.labelY || 2.25; tmp.project(camera);
      const lx = Math.round((tmp.x * 0.5 + 0.5) * Wd), ly = Math.round((-tmp.y * 0.5 + 0.5) * Hd);
      r.label.style.transform = `translate3d(${lx}px, ${ly}px, 0) translate(-50%, -100%)`;
      const hide = view.focus || view.hideLabels || tmp.z > 1 || Math.abs(tmp.x) > 1.02 || Math.abs(tmp.y) > 1.02;
      r.label.style.opacity = hide ? '0' : '1'; r.label.style.pointerEvents = hide ? 'none' : 'auto';
    });
    renderer.render(scene, camera);
  }
  setTheme('afternoon');
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => { desks.forEach((d) => (d.key = '#')); tvKey = ''; update(data); });
  frame();

  return {
    update, setTheme, setView, focus, setLocation, flyTo: (k) => setFly(k || null),
    landmarks: ENVS.city.landmarks.map((b) => ({ key: b.key, name: b.name, icon: b.icon, col: HEX(b.col), x: b.x, z: b.z })),
    getPos: () => ({ x: fly.x, z: fly.z, a: fly.a || 0 }),
    setAttention: (a) => { ENVS.city.landmarks.forEach((b) => { const n = (a && a[b.key]) || 0; b.setOn(n > 0, n); }); },
    goHome: () => { setFly(null); man.x = 34; man.z = 34; manualT = clock.elapsedTime; mapGo = true; homeGo = true; },
    goTo: (x, z) => { homeGo = false; if (flyTo) { setFly(null); opts.onLeave && opts.onLeave(); } man.x = x; man.z = z; manualT = clock.elapsedTime; mapGo = true; },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointermove', onMove);
      window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKD); window.removeEventListener('keyup', onKU);
      renderer.dispose(); container.innerHTML = '';
    },
  };
}
