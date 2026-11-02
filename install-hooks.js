// Adds HQ's hooks to C:\Users\<you>\.claude\settings.json.
// Keeps every hook you already have (like block-delete.js).
// Makes a backup copy first. Safe to run more than once.
//   Install:  node install-hooks.js
//   Remove:   node install-hooks.js --remove
const fs = require('fs');
const path = require('path');
const os = require('os');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hookScript = path.join(__dirname, 'hooks', 'hq-hook.js').replace(/\\/g, '/');
const command = `node "${hookScript}"`;
const remove = process.argv.includes('--remove');

const EVENTS = [
  { name: 'SessionStart' },
  { name: 'UserPromptSubmit' },
  { name: 'PreToolUse', matcher: '*' },
  { name: 'PostToolUse', matcher: '*' },
  { name: 'Notification' },
  { name: 'Stop' },
  { name: 'SessionEnd' },
];

let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    console.log('Your settings.json has a JSON error, so nothing was changed. Fix it first:');
    console.log(settingsPath);
    process.exit(1);
  }
  const backup = settingsPath.replace(/\.json$/, `.backup-${Date.now()}.json`);
  fs.writeFileSync(backup, raw);
  console.log(`Backup saved: ${backup}`);
} else {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
}

settings.hooks = settings.hooks || {};
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('hq-hook.js');

for (const ev of EVENTS) {
  const list = Array.isArray(settings.hooks[ev.name]) ? settings.hooks[ev.name] : [];
  // Take out any old HQ entries first, so running twice never duplicates.
  const cleaned = list
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((group) => group.hooks.length > 0);
  if (!remove) {
    const group = { hooks: [{ type: 'command', command }] };
    if (ev.matcher) group.matcher = ev.matcher;
    cleaned.push(group);
  }
  if (cleaned.length) settings.hooks[ev.name] = cleaned;
  else delete settings.hooks[ev.name];
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(remove ? 'HQ hooks removed.' : 'HQ hooks installed.');
console.log('Start a NEW Claude Code chat for them to take effect.');
