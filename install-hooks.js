// Adds HQ's hooks to C:\Users\<you>\.claude\settings.json.
// Keeps every hook you already have (like block-delete.js).
// Makes a backup copy first. Safe to run more than once.
//   Install:  node install-hooks.js
//   Remove:   node install-hooks.js --remove
const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS = [
  { name: 'SessionStart' },
  { name: 'UserPromptSubmit' },
  { name: 'PreToolUse', matcher: '*' },
  { name: 'PostToolUse', matcher: '*' },
  { name: 'PostToolUseFailure', matcher: '*' },
  { name: 'PermissionRequest', matcher: '*' },
  { name: 'Notification' },
  { name: 'Stop' },
  { name: 'StopFailure' },
  { name: 'SessionEnd' },
];
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('hq-hook.js');

// Returns 'installed' | 'removed' | 'unchanged' | 'error: ...'. Keeps every hook that isn't HQ's.
function install(opts) {
  const o = Object.assign({ remove: false, onlyIfMissing: false, quiet: false, claudeDir: path.join(os.homedir(), '.claude') }, opts || {});
  const settingsPath = path.join(o.claudeDir, 'settings.json');
  const hookScript = path.join(__dirname, 'hooks', 'hq-hook.js').replace(/\\/g, '/');
  const command = `node "${hookScript}"`;
  let settings = {}; let raw = '';
  if (fs.existsSync(settingsPath)) {
    raw = fs.readFileSync(settingsPath, 'utf8');
    try { settings = JSON.parse(raw); } catch (e) { return 'error: your settings.json has a JSON error, so nothing was changed'; }
  } else fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  settings.hooks = settings.hooks || {};
  if (o.onlyIfMissing) {
    const anyOurs = Object.values(settings.hooks).some((l) => Array.isArray(l) && l.some((g) => (g.hooks || []).some(isOurs)));
    if (!anyOurs) return 'unchanged'; // HQ hooks were never installed (or you removed them): respect that
    const missing = EVENTS.filter((ev) => !(Array.isArray(settings.hooks[ev.name]) && settings.hooks[ev.name].some((g) => (g.hooks || []).some((h) => isOurs(h) && h.command === command))));
    if (!missing.length) return 'unchanged';
  }
  if (raw) { const backup = settingsPath.replace(/\.json$/, `.backup-${Date.now()}.json`); fs.writeFileSync(backup, raw); if (!o.quiet) console.log(`Backup saved: ${backup}`); }
  for (const ev of EVENTS) {
    const list = Array.isArray(settings.hooks[ev.name]) ? settings.hooks[ev.name] : [];
    const cleaned = list.map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isOurs(h)) })).filter((group) => group.hooks.length > 0);
    if (!o.remove) { const group = { hooks: [{ type: 'command', command }] }; if (ev.matcher) group.matcher = ev.matcher; cleaned.push(group); }
    if (cleaned.length) settings.hooks[ev.name] = cleaned; else delete settings.hooks[ev.name];
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return o.remove ? 'removed' : 'installed';
}
module.exports = { install, EVENTS };

if (require.main === module) {
  const r = install({ remove: process.argv.includes('--remove') });
  if (r.startsWith('error')) { console.log(r); process.exit(1); }
  console.log(r === 'removed' ? 'HQ hooks removed.' : 'HQ hooks installed.');
  console.log('Start a NEW Claude Code chat for them to take effect.');
}
