// Put a new Claude Design export into HQ, keeping the live wiring.
// Usage:  node update-design.js "C:\Users\arize\Downloads\HQ Mission Control.html"
// (Use the STANDALONE .html export — the one that works offline.)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.log('Give me the exported .html file. Example:\n  node update-design.js "C:\\Users\\arize\\Downloads\\HQ Mission Control.html"'); process.exit(1); }

const html = fs.readFileSync(src, 'utf8');
const tag = (t) => { const m = new RegExp('<script type="__bundler/' + t + '">([\\s\\S]*?)</script>').exec(html); return m ? m[1] : null; };
const manRaw = tag('manifest'), tplRaw = tag('template');
if (!manRaw || !tplRaw) { console.log('That file is not a standalone Claude Design export.'); process.exit(1); }

const pub = path.join(__dirname, 'public');
const vdir = path.join(pub, 'v');
fs.mkdirSync(vdir, { recursive: true });
const EXT = { 'application/javascript': 'js', 'text/javascript': 'js', 'font/woff2': 'woff2', 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/css': 'css' };

const manifest = JSON.parse(manRaw);
let tpl = tplRaw.trim().startsWith('"') ? JSON.parse(tplRaw) : tplRaw;
const files = {};
for (const [uuid, e] of Object.entries(manifest)) {
  let buf = Buffer.from(e.data, 'base64');
  if (e.compressed) buf = zlib.gunzipSync(buf);
  const name = uuid + '.' + (EXT[e.mime] || 'bin');
  files[uuid] = name;
  fs.writeFileSync(path.join(vdir, name), buf);
  tpl = tpl.split('"' + uuid + '"').join('"/v/' + name + '"');
}

let ext = []; try { ext = JSON.parse(tag('ext_resources') || '[]'); } catch {}
const resources = Object.fromEntries(ext.filter((e) => files[e.uuid]).map((e) => [e.id, '/v/' + files[e.uuid]]));

// The 3D city loads a water texture from the internet. Use the local copy.
for (const name of Object.values(files)) {
  if (!name.endsWith('.js')) continue;
  const fp = path.join(vdir, name);
  const js = fs.readFileSync(fp, 'utf8');
  const fixed = require('./customize.js').js(js.replace(/https:\/\/cdn\.jsdelivr\.net\/gh\/mrdoob\/three\.js@r\d+\/examples\/textures\/waternormals\.jpg/g, '/v/waternormals.jpg'));
  if (fixed !== js) fs.writeFileSync(fp, fixed);
}

// Live wiring (the HQ-LIVE lines).
const must = (ok, what) => { if (!ok) { console.log('Could not find ' + what + ' in the new design. HQ-LIVE wiring needs a manual fix.'); process.exit(1); } };
const firstScript = /<script src="\/v\/[^"]+\.js">/.exec(tpl);
must(firstScript, 'the runtime script');
tpl = tpl.replace(firstScript[0], '<script src="/hq-live.js"></script>\n<script>window.__resources=' + JSON.stringify(resources) + ';</script>\n' + firstScript[0]);
must(tpl.includes('  componentDidMount() {\n'), 'componentDidMount');
tpl = tpl.replace('  componentDidMount() {\n', '  componentDidMount() {\n    // HQ-LIVE: connects this design to real data (see hq-live.js).\n    window.__hq = this;\n    try { window.__hqConsts = { PROJ, LISTING, SOCIAL, IDEAS, POSTS }; } catch (e) {}\n    if (window.HQLive && !/demo/.test(location.search)) window.HQLive.connect(this);\n');
must(tpl.includes('  tick() {\n'), 'tick');
tpl = tpl.replace('  tick() {\n', '  tick() {\n    // HQ-LIVE: real data drives everything, so skip the built-in demo simulation.\n    if (this.state.live) { this.setState({ now: Date.now() }); return; }\n');

// Your look changes (full width, no letter boxes, etc.) live in customize.js.
const custom = require('./customize.js')(tpl);
tpl = custom.tpl;
if (custom.skipped.length) console.log('Could not apply: ' + custom.skipped.join(', ') + ' (the new design changed that part)');

const out = path.join(pub, 'HQ.html');
if (fs.existsSync(out)) fs.copyFileSync(out, path.join(pub, 'HQ.previous.html'));
fs.writeFileSync(out, tpl);
console.log('Done. New design is in. Press Ctrl+R in HQ to see it.\n(The old one is saved as public/HQ.previous.html)');
