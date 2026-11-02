// Ari's changes to the Claude Design export. update-design.js runs these on every new export.
// If one stops matching after a redesign, it's skipped and listed so you know.
module.exports = function customize(tpl) {
  const skipped = [];
  const swap = (name, from, to) => { if (tpl.includes(from)) tpl = tpl.split(from).join(to); else if (!tpl.includes(to)) skipped.push(name); };

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

  return { tpl, skipped };
};

// Same idea for the 3D city script.
module.exports.js = function customizeJs(js) {
  if (js.includes("makeRobot('pilot', 1)") && js.includes('const PALETTES = [')) {
    js = js.replace("const PALETTES = [", "const PALETTES = [\n    ['#1e6b52', '#5ed6a0', '#effff7', '#c8f07a', '#3f8a3a'],");
    // the new green palette is index 0, so every other index moves up by one
    js = js.replace(/makeRobot\(s\.id, s\.palette \|\| 0\)/, 'makeRobot(s.id, (s.palette || 0) + 1)');
    js = js.replace("makeRobot('pilot', 1)", "makeRobot('pilot', 0)");
    js = js.replace("r.label.lastChild.style.background = '#9fe6ff'; r.label.lastChild.style.boxShadow = '0 0 8px #9fe6ff';", "r.label.lastChild.style.background = '#7ff0b0'; r.label.lastChild.style.boxShadow = '0 0 8px #7ff0b0';");
  }
  return js;
};
