// HQ — live engine for your city dashboard.
// Runs on your PC only. No packages needed. Uses zero Claude tokens.
// Start:  node server.js   then open http://localhost:4747

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.HQ_PORT || 4747);
const CLAUDE_DIR = process.env.HQ_CLAUDE_DIR || path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'hq.config.json');
const ARCHIVE_DIR = path.join(__dirname, 'logs-archive');

// ─── Config ─────────────────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(path.join(__dirname, 'hq.config.example.json'))) fs.copyFileSync(path.join(__dirname, 'hq.config.example.json'), CONFIG_PATH);
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { console.log('[HQ] hq.config.json missing or broken, using defaults.'); return { windows: {}, projects: [] }; }
}
let config = loadConfig();
fs.watchFile(CONFIG_PATH, { interval: 2000 }, () => { config = loadConfig(); broadcast(); });
fs.watchFile(path.join(__dirname, 'plan.json'), { interval: 2000 }, () => broadcast());

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const base = (p) => norm(p).split('/').pop() || '';
function windowName(cwd) {
  const b = base(cwd);
  for (const [folder, name] of Object.entries(config.windows || {})) if (folder.toLowerCase() === b) return name;
  return b || 'Unknown';
}
function projectFor(cwd) {
  const n = norm(cwd);
  for (const p of config.projects || []) for (const m of p.match || []) if (n.includes(m.toLowerCase())) return p.name;
  return base(cwd) || 'Other';
}
const firstLine = (t) => String(t || '').trim().split('\n').find((l) => l.trim()) || '';

// ─── Sessions ───────────────────────────────────────────────────────────────
// status: working | needs-you | done | idle | ended
const sessions = new Map();
const activity = [];

function getSession(id, cwd) {
  let s = sessions.get(id);
  if (!s) {
    s = { id, cwd: cwd || '', status: 'idle', doing: '', prompt: '', todos: [], jobStart: null,
      lastEvent: Date.now(), actions: [], transcriptPath: '', lastReply: '', tests: [], testsDone: false,
      queue: [], chat: [] };
    sessions.set(id, s);
  }
  // A chat belongs to the folder it STARTED in, even if it later runs "cd" into another folder.
  if (cwd && !s.cwd) s.cwd = cwd;
  return s;
}
// Claude Code saves each chat under ~/.claude/projects/<start folder with / and spaces turned into ->.
function homeFromTranscript(tp) {
  const parts = String(tp || '').split(/[\\/]/); const dir = (parts[parts.length - 2] || '').toLowerCase(); if (!dir) return '';
  let best = '';
  for (const folder of Object.keys(config.windows || {})) {
    const enc = folder.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if ((dir === enc || dir.endsWith('-' + enc)) && enc.length > best.length) best = folder;
  }
  return best;
}
function logActivity(s, text, job) {
  activity.unshift({ t: Date.now(), session: windowName(s.cwd), project: projectFor(s.cwd), text, job: job || firstLine(s.prompt).slice(0, 80) });
  if (activity.length > 200) activity.length = 200;
}
function pushChat(s, from, text) {
  s.chat.push({ from, text: String(text || '').slice(0, 1200), at: Date.now() });
  if (s.chat.length > 8) s.chat = s.chat.slice(-8);
}
const shortFile = (p) => String(p || '').replace(/\\/g, '/').split('/').slice(-2).join('/');

function describeTool(name, input) {
  input = input || {};
  if (!name) return '';
  if (name === 'Read') return `Reading ${shortFile(input.file_path)}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${shortFile(input.file_path)}`;
  if (name === 'Write') return `Writing ${shortFile(input.file_path)}`;
  if (name === 'Bash' || name === 'PowerShell') {
    const cmd = String(input.command || '');
    if (/playwright/i.test(cmd)) return 'Running a Playwright test';
    if (/^\s*git\s+commit/.test(cmd)) return 'Committing';
    if (/^\s*git\s+push/.test(cmd)) return 'Pushing to GitHub';
    if (/^\s*git\s/.test(cmd)) return 'Running git';
    if (/npm (install|i)\b|npx expo install/.test(cmd)) return 'Installing packages';
    return input.description ? String(input.description) : `Running: ${cmd.slice(0, 60)}`;
  }
  if (name === 'Grep' || name === 'Glob') return 'Searching the code';
  if (['TodoWrite', 'TaskCreate', 'TaskUpdate'].includes(name)) return 'Updating its plan';
  if (name === 'WebSearch') return 'Searching the web';
  if (name === 'WebFetch') return 'Reading a web page';
  if (name === 'Task' || name === 'Agent') return 'Running a helper agent';
  if (name.startsWith('mcp__')) return `Using ${name.split('__').pop()}`;
  return `Using ${name}`;
}

function applyTodos(s, todos) {
  if (!Array.isArray(todos)) return;
  s.todos = todos.map((t) => ({ text: t.content || t.subject || t.activeForm || t.text || '', status: t.status || 'pending' }));
}
function applyTaskTool(s, name, input) {
  if (name === 'TaskCreate') s.todos.push({ id: input.taskId || String(s.todos.length + 1), text: input.subject || '', status: 'pending' });
  else if (name === 'TaskUpdate') {
    const t = s.todos.find((x) => x.id === String(input.taskId)) || s.todos[Number(input.taskId) - 1];
    if (t && input.status) { if (input.status === 'deleted') s.todos = s.todos.filter((x) => x !== t); else t.status = input.status; }
  }
}

// ─── Transcripts (full output) ──────────────────────────────────────────────
function readTranscript(fp, limit = 400) {
  let text = '';
  try { text = fs.readFileSync(fp, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const at = o.timestamp ? Date.parse(o.timestamp) : null;
    const c = o.message && o.message.content;
    if (o.type === 'user') {
      if (typeof c === 'string' && c.trim() && !c.startsWith('<')) out.push({ role: 'you', text: c, at });
      else if (Array.isArray(c)) for (const b of c) if (b.type === 'text' && b.text && !b.text.startsWith('<')) out.push({ role: 'you', text: b.text, at });
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text && b.text.trim()) out.push({ role: 'claude', text: b.text, at });
        else if (b.type === 'tool_use') out.push({ role: 'tool', text: describeTool(b.name, b.input), at });
      }
    }
  }
  return out.slice(-limit);
}
function lastReplyFrom(fp) {
  const msgs = readTranscript(fp, 2000);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'you') break;
    if (msgs[i].role === 'claude') {
      // Join the final run of Claude text blocks after the last tool call.
      const parts = [];
      for (let j = i; j >= 0 && msgs[j].role === 'claude'; j--) parts.unshift(msgs[j].text);
      return parts.join('\n\n');
    }
  }
  return '';
}

// Pull the "test on your phone" list out of Claude's final message.
function extractTests(reply) {
  const lines = String(reply || '').split('\n');
  let i = lines.findIndex((l) => /test/i.test(l) && (/^\s*(#+|\*\*)/.test(l) || /:\s*\**\s*$/.test(l)));
  if (i < 0) return [];
  const items = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    const m = l.match(/^(\s{0,3})(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (m[1].length <= 3) items.push(m[2].replace(/\*\*|`/g, '').trim()); continue; }
    if (!l.trim()) { if (items.length && !/^\s*(?:[-*•]|\d+[.)])\s/.test(lines[j + 1] || '')) break; continue; }
    if (/^\s{2,}/.test(l)) continue; // indented detail under an item
    if (items.length) break;
  }
  return items.slice(0, 12);
}

// ─── Hook events ────────────────────────────────────────────────────────────
function logsNote() {
  if (!config.attachLogs || !logState.latestArchive) return '';
  return `\n\nLogs from my last test session: ${logState.latestArchive}\nSearch that file for the lines related to this. Don't read the whole file.`;
}

const hookSeen = new Set();
function handleEvent(ev) {
  const id = ev.session_id;
  if (!id) return null;
  hookSeen.add(id);
  const s = getSession(id, ev.cwd);
  s.lastEvent = Date.now();
  if (ev.transcript_path) s.transcriptPath = ev.transcript_path;
  { const home = homeFromTranscript(ev.transcript_path); if (home) s.cwd = home; }
  const name = ev.hook_event_name;
  let reply = null;

  if (name === 'SessionStart') {
    s.status = 'idle'; logActivity(s, 'Chat opened');
  } else if (name === 'UserPromptSubmit') {
    s.status = 'working'; s.prompt = String(ev.prompt || '').trim(); s.jobStart = Date.now();
    s.todos = []; s.actions = []; s.tests = []; s.testsDone = false; s.doing = 'Reading your prompt'; s.title = s.nextTitle || ''; s.nextTitle = '';
    pushChat(s, 'you', s.prompt); logActivity(s, 'Started a new job');
  } else if (name === 'PreToolUse') {
    s.status = 'working'; s.inTool = Date.now(); s.doing = describeTool(ev.tool_name, ev.tool_input);
    s.actions.unshift({ t: Date.now(), text: s.doing }); if (s.actions.length > 100) s.actions.length = 100;
    if (ev.tool_name === 'TodoWrite') applyTodos(s, ev.tool_input && ev.tool_input.todos);
    if (ev.tool_name === 'TaskCreate' || ev.tool_name === 'TaskUpdate') applyTaskTool(s, ev.tool_name, ev.tool_input || {});
  } else if (name === 'PostToolUse') {
    s.inTool = 0;
    if (s.status !== 'done') s.status = 'working';
  } else if (name === 'Notification') {
    if (s.status === 'working') { s.status = 'needs-you'; s.doing = String(ev.message || 'Waiting for you'); logActivity(s, 'Needs you'); }
  } else if (name === 'Stop') {
    s.inTool = 0;
    const finalText = ev.last_assistant_message || (s.transcriptPath ? lastReplyFrom(s.transcriptPath) : '');
    if (finalText) { s.lastReply = finalText; s.tests = extractTests(finalText); pushChat(s, 'bot', finalText); }
    if (s.queue.length) {
      // A job you queued in HQ: hand it over right now instead of stopping.
      const next = s.queue.shift(); s.title = (s.queueTitles || []).shift() || '';
      s.prompt = next; s.jobStart = Date.now(); s.todos = []; s.actions = []; s.tests = []; s.testsDone = false;
      s.status = 'working'; s.doing = 'Starting your queued job';
      pushChat(s, 'you', next); logActivity(s, 'Started a queued job', firstLine(next));
      reply = { deliver: next };
    } else {
      s.status = 'done'; s.doing = s.tests.length ? 'Waiting for you to test' : 'Finished';
      logActivity(s, s.tests.length ? 'Ready to test' : 'Finished');
    }
  } else if (name === 'SessionEnd') {
    if (s.status === 'idle') { s.status = 'ended'; logActivity(s, 'Chat closed'); }
  }
  broadcast();
  return reply;
}

// ─── Backfill chats that started before HQ was running ─────────────────────
const fileOffsets = new Map();
function scanTranscripts() {
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return; }
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  let changed = false;
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const prev = fileOffsets.get(fp) || 0;
      if (st.size <= prev) continue;
      changed = readChunk(fp, prev, st.size, f.replace('.jsonl', '')) || changed;
      fileOffsets.set(fp, st.size);
    }
  }
  if (changed) broadcast();
}
function readChunk(fp, start, end, fallbackId) {
  let text;
  try { const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(end - start); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd); text = buf.toString('utf8'); }
  catch { return false; }
  let changed = false, lastSession = null, lastObj = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const s = getSession(o.sessionId || fallbackId, homeFromTranscript(fp) || o.cwd);
    if (!s.transcriptPath) s.transcriptPath = fp;
    const t = o.timestamp ? Date.parse(o.timestamp) : Date.now();
    if (t > s.lastEvent) s.lastEvent = t;
    const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const c of content) if (c.type === 'tool_use') {
      if (c.name === 'TodoWrite') applyTodos(s, c.input && c.input.todos);
      if (c.name === 'TaskCreate' || c.name === 'TaskUpdate') applyTaskTool(s, c.name, c.input || {});
      if (s.status !== 'done') s.doing = describeTool(c.name, c.input);
    }
    if (o.type === 'user' && typeof (o.message && o.message.content) === 'string' && !o.message.content.startsWith('<')) s.prompt = o.message.content.trim();
    changed = true;
    lastSession = s; lastObj = o;
  }
  // Chats found in files (HQ wasn't running when they started): guess where they are.
  if (lastSession && lastObj && !hookSeen.has(lastSession.id)) {
    const s = lastSession, c = lastObj.message && lastObj.message.content;
    const endsWithText = lastObj.type === 'assistant' && Array.isArray(c) && c.length && c.every((b) => b.type === 'text' || b.type === 'thinking');
    const ended = lastObj.message && lastObj.message.stop_reason === 'end_turn';
    let fresh = false; try { fresh = Date.now() - fs.statSync(fp).mtimeMs < 3 * 60 * 1000; } catch {}
    if (endsWithText && (ended || !fresh)) {
      s.lastReply = lastReplyFrom(fp); s.tests = extractTests(s.lastReply); s.status = 'done';
      s.doing = s.tests.length ? 'Waiting for you to test' : 'Finished';
    } else if (fresh) s.status = 'working';
  }
  return changed;
}

// ─── LAUNCH.md checklists ───────────────────────────────────────────────────
function readChecklist(file) {
  if (!file) return null;
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return { missing: true, file, sections: [] }; }
  const sections = []; let cur = { name: 'Tasks', items: [] };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { if (cur.items.length) sections.push(cur); cur = { name: h[1].trim(), items: [] }; continue; }
    const m = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    if (m) cur.items.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  if (cur.items.length) sections.push(cur);
  const all = sections.flatMap((s) => s.items); const done = all.filter((i) => i.done).length;
  return { file, sections, done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

// ─── Logs: keep a copy of every test session, spot errors ──────────────────
const logState = { size: 0, archive: '', latestArchive: '', errors: [], errorCount: 0, updated: 0 };
function pollLogs() {
  const file = config.logsFile;
  if (!file) return;
  let st; try { st = fs.statSync(file); } catch { return; }
  if (st.size === logState.size && logState.archive) return;
  // A new test session overwrites the file: it shrinks, or its first lines change.
  let head = '';
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(Math.min(200, st.size)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); head = b.toString('utf8'); } catch {}
  const newSession = !logState.archive || st.size < logState.size || (logState.head && !head.startsWith(logState.head.slice(0, Math.min(logState.head.length, head.length))));
  logState.head = head;
  if (newSession) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logState.archive = path.join(ARCHIVE_DIR, `test-${stamp}.log`);
  }
  logState.size = st.size;
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.copyFileSync(file, logState.archive);
    logState.latestArchive = logState.archive; logState.updated = Date.now();
    const fd = fs.openSync(file, 'r'); const len = Math.min(st.size, 300000); const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    const bad = buf.toString('utf8').split('\n').filter((l) => /\b(error|exception|fatal|crash|unhandled|failed)\b/i.test(l));
    logState.errorCount = bad.length; logState.errors = bad.slice(-6).map((l) => l.slice(0, 300));
  } catch {}
  broadcast();
}

// ─── GitHub builds (public repo, no login needed) ──────────────────────────
let runs = [];
function pollRuns() {
  const repo = config.githubRepo; if (!repo) return;
  const req = https.get({ host: 'api.github.com', path: `/repos/${repo}/actions/runs?per_page=6`, headers: { 'User-Agent': 'hq-dashboard', Accept: 'application/vnd.github+json' }, timeout: 10000 }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try {
        const j = JSON.parse(body); if (!Array.isArray(j.workflow_runs)) return;
        runs = j.workflow_runs.map((r) => ({ id: 'r' + r.id, wf: r.name, br: r.head_branch,
          st: r.status !== 'completed' ? 'running' : r.conclusion === 'success' ? 'done' : 'failed',
          note: r.status === 'completed' && r.conclusion !== 'success' ? `${r.conclusion} · open on GitHub` : '', at: Date.parse(r.updated_at), url: r.html_url }));
        broadcast();
      } catch {}
    });
  });
  req.on('error', () => {}); req.on('timeout', () => req.destroy());
}

// ─── Shipping Dock: finished work waiting to be merged ─────────────────────
let merges = [];
function git(args) {
  return new Promise((resolve) => execFile('git', ['-C', config.git.mainRepo, ...args], { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? null : String(out).trim())));
}
async function pollMerges() {
  if (!config.git || !config.git.mainRepo) return;
  const main = config.git.mainBranch || 'master';
  const out = [];
  for (const [win, br] of Object.entries(config.git.branches || {})) {
    const ahead = await git(['rev-list', '--count', `${main}..${br}`]);
    if (ahead === null) continue;
    const last = await git(['log', '-1', '--format=%s', br]);
    const stat = await git(['diff', '--shortstat', `${main}...${br}`]) || '';
    const num = (re) => { const m = re.exec(stat); return m ? Number(m[1]) : 0; };
    out.push({ window: win, branch: br, ahead: Number(ahead), last: last || '', files: num(/(\d+) files? changed/), add: num(/(\d+) insertion/), del: num(/(\d+) deletion/),
      cmd: `cd "${config.git.mainRepo}"\ngit merge ${br}\ngit push` });
  }
  if (JSON.stringify(out) !== JSON.stringify(merges)) { merges = out; broadcast(); }
}

// ─── Claude usage: tokens in your current 5-hour window (read from transcripts, free) ──
// Claude's limit resets 5 hours after the first message of a window. We can't see your
// real limit, so % is measured against your biggest 5-hour window so far
// (or "usageLimitTokens" in hq.config.json if you set it).
const usageSeen = new Map(); // file -> { size, msgs: Map(key -> {t, tok, cwd}) }
let usage = { tokens: 0, limit: 0, pct: 0, blockStart: 0, resetAt: 0, byWindow: {}, perMin: 0 };
const BLOCK = 5 * 60 * 60 * 1000;
function scanUsage() {
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return; }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const rec = usageSeen.get(fp) || { size: 0, msgs: new Map() };
      if (st.size <= rec.size) { usageSeen.set(fp, rec); continue; }
      let text = '';
      try { const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(st.size - rec.size); fs.readSync(fd, buf, 0, buf.length, rec.size); fs.closeSync(fd); text = buf.toString('utf8'); } catch { continue; }
      const cut = text.lastIndexOf('\n'); if (cut < 0) continue;
      rec.size += Buffer.byteLength(text.slice(0, cut + 1));
      for (const line of text.slice(0, cut).split('\n')) {
        if (/"isApiErrorMessage":true/.test(line) && /limit/i.test(line)) { try { const j = JSON.parse(line); rec.hits = rec.hits || []; rec.hits.push(Date.parse(j.timestamp) || st.mtimeMs); } catch {} continue; }
        if (!line.includes('"usage"')) continue;
        try {
          const j = JSON.parse(line); const u = j.message && j.message.usage; if (!u || j.type !== 'assistant') continue;
          const key = (j.message.id || '') + ':' + (j.requestId || '');
          const tok = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
          rec.msgs.set(key, { t: Date.parse(j.timestamp) || st.mtimeMs, tok, cwd: j.cwd || '' });
        } catch {}
      }
      usageSeen.set(fp, rec);
    }
  }
  const all = []; const hits = [];
  for (const r of usageSeen.values()) { for (const m of r.msgs.values()) all.push(m); for (const h of r.hits || []) hits.push(h); }
  all.sort((a, b) => a.t - b.t); hits.sort((a, b) => a - b);
  // Split into 5-hour windows the same way Claude does: a window starts at your first message after the last one ended.
  // If you ever hit the real limit, the tokens used at that moment ARE your limit.
  let start = 0, sum = 0, best = 0, cur = [], hitLimit = 0, hi = 0;
  for (const m of all) {
    if (!start || m.t >= start + BLOCK) { if (sum > best) best = sum; start = Math.floor(m.t / 3600000) * 3600000; sum = 0; cur = []; }
    while (hi < hits.length && hits[hi] < m.t) { if (hits[hi] >= start && sum > hitLimit) hitLimit = sum; hi++; }
    sum += m.tok; cur.push(m);
  }
  while (hi < hits.length) { if (hits[hi] >= start && sum > hitLimit) hitLimit = sum; hi++; }
  const now = Date.now();
  const active = start && now < start + BLOCK;
  const tokens = active ? sum : 0;
  if (!active && sum > best) best = sum;
  const known = Number(config.usageLimitTokens) || hitLimit;
  const limit = known || Math.max(best, tokens, 1);
  const byWindow = {};
  if (active) for (const m of cur) { const w = windowName(m.cwd); byWindow[w] = (byWindow[w] || 0) + m.tok; }
  const recent = active ? cur.filter((m) => now - m.t < 15 * 60000).reduce((a, m) => a + m.tok, 0) / 15 : 0;
  const next = { tokens, limit, pct: Math.min(known ? 100 : 99, Math.round((tokens / limit) * 100)), blockStart: active ? start : 0, resetAt: active ? start + BLOCK : 0, byWindow, perMin: Math.round(recent), guessed: !known };
  if (JSON.stringify(next) !== JSON.stringify(usage)) { usage = next; broadcast(); }
}

// ─── Your launch plan: spreads what's left across the days left, every day ──
// Skip a day and the leftover work flows into the next days automatically.
const PLAN_PATH = path.join(__dirname, 'plan.json');
const PLAN_STATE = path.join(__dirname, 'plan-state.json');
const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const parseDay = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
function readJSON(fp, fallback) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; } }
function planState() { const st = readJSON(PLAN_STATE, {}); st.done = st.done || {}; st.extra = st.extra || []; return st; }
function savePlanState(st) { fs.writeFileSync(PLAN_STATE, JSON.stringify(st, null, 2)); }
function buildPlan() {
  const plan = readJSON(PLAN_PATH, null); if (!plan || !Array.isArray(plan.tasks)) return null;
  const st = planState();
  const today = dayKey(Date.now());
  const cap = (d) => { const w = parseDay(d).getDay(); return (w === 0 || w === 6) ? (plan.capacity && plan.capacity.weekend) || 7 : (plan.capacity && plan.capacity.weekday) || 3; };
  const days = []; for (let d = parseDay(today); dayKey(d) <= plan.submitBy; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  if (!days.length) days.push(today);
  const tasks = plan.tasks.map((t, i) => ({ ...t, order: i, done: !!st.done[t.id], doneOn: st.done[t.id] || null }));
  const open = tasks.filter((t) => !t.done && t.group !== 'Later');
  const need = open.filter((t) => t.group === 'Blocking').reduce((a, t) => a + (t.pts || 1), 0);
  const have = days.reduce((a, d) => a + cap(d), 0);
  // Behind? Every day gets heavier by the same amount so you still make the date.
  const squeeze = need > have ? need / have : 1;
  const load = Object.fromEntries(days.map((d) => [d, 0]));
  // Work you already finished today still counts as today's work (so finishing early doesn't pile on more).
  load[today] = tasks.filter((t) => t.doneOn === today).reduce((x, t) => x + (t.pts || 1), 0);
  const dayOf = {};
  const place = (t) => {
    const pre = (t.needs || []).map((id) => dayOf[id]).filter(Boolean).sort().pop();
    for (const d of days) {
      if (t.after && d < t.after) continue;
      if (pre && d < pre) continue;
      if (load[d] + (t.pts || 1) <= cap(d) * squeeze + 0.001 || (load[d] === 0)) { load[d] += t.pts || 1; dayOf[t.id] = d; return; }
    }
    dayOf[t.id] = days[days.length - 1];
  };
  open.filter((t) => t.group === 'Blocking').forEach(place);
  open.filter((t) => t.group !== 'Blocking').forEach(place);
  const view = (t) => ({ id: t.id, t: t.t, sub: t.sub || '', steps: Array.isArray(t.steps) ? t.steps : [], links: Array.isArray(t.links) ? t.links : [], who: t.who, pts: t.pts || 1, group: t.group, done: t.done, day: dayOf[t.id] || t.doneOn || null, prompt: t.prompt || '' });
  const todayTasks = tasks.filter((t) => (!t.done && dayOf[t.id] === today) || t.doneOn === today).map(view);
  const extra = st.extra.filter((x) => x.day === today).map((x) => ({ id: x.id, t: x.t, sub: '', who: 'you', pts: 0, group: 'Extra', done: !!x.done, day: today, prompt: '' }));
  const nextTasks = open.filter((t) => dayOf[t.id] && dayOf[t.id] > today).sort((a, b) => (dayOf[a.id] < dayOf[b.id] ? -1 : dayOf[a.id] > dayOf[b.id] ? 1 : a.order - b.order)).slice(0, 6).map(view);
  const msDay = 86400000;
  return {
    project: plan.project, launch: plan.launch, submitBy: plan.submitBy, today,
    daysToLaunch: Math.max(0, Math.round((parseDay(plan.launch) - parseDay(today)) / msDay)),
    daysToSubmit: Math.max(0, Math.round((parseDay(plan.submitBy) - parseDay(today)) / msDay)),
    behind: squeeze > 1, squeeze: Math.round(squeeze * 100) / 100, needPts: need, havePts: have,
    todayTasks: [...todayTasks, ...extra], next: nextTasks,
    tasks: tasks.map(view), ideas: plan.ideas || [],
  };
}

// ─── Start jobs straight from HQ ───────────────────────────────────────────
// If a window is free, HQ runs Claude Code in that window's folder and continues
// that window's latest chat. It uses "acceptEdits" mode: Claude Code can edit
// files, and anything else follows your normal Claude Code permission rules
// (settings.json). It never uses bypass mode.
const runners = new Map(); // window name -> running Claude Code process
const STALE = 8 * 60 * 1000; // "working" with no news for 6 min = not really working
function isBusy(s) {
  if (!s) return false;
  if (runners.has(windowName(s.cwd))) return true;
  if (s.status === 'working' && s.inTool && Date.now() - s.inTool < 60 * 60 * 1000) return true; // a long command is running
  return (s.status === 'working' || s.status === 'needs-you') && Date.now() - s.lastEvent < STALE;
}
function findClaude() {
  if (config.claudePath && fs.existsSync(config.claudePath)) return config.claudePath;
  const roots = [path.join(os.homedir(), '.vscode', 'extensions')];
  let best = null;
  for (const root of roots) {
    let dirs = []; try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const d of dirs) {
      if (!/^anthropic\.claude-code-/i.test(d)) continue;
      for (const name of ['claude.exe', 'claude']) {
        const p = path.join(root, d, 'resources', 'native-binary', name);
        try { const st = fs.statSync(p); if (!best || st.mtimeMs > best.t) best = { p, t: st.mtimeMs }; } catch {}
      }
    }
  }
  return best ? best.p : null;
}
function folderForWindow(win) {
  for (const [folder, name] of Object.entries(config.windows || {})) if (name === win) return path.join(os.homedir(), folder);
  return null;
}
function startJob(win, text, s, title) {
  if (config.startJobs === false) return { error: 'Starting jobs from HQ is turned off.' };
  const exe = findClaude(); const cwd = folderForWindow(win);
  if (!exe) return { error: 'Could not find Claude Code on this PC.' };
  if (!cwd || !fs.existsSync(cwd)) return { error: 'Could not find the folder for ' + win + '.' };
  const args = ['-p', '--permission-mode', 'acceptEdits'];
  if (s && s.id && !String(s.id).startsWith('hooktest')) args.push('--resume', s.id);
  let child;
  try { child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }); }
  catch (e) { return { error: 'Could not start Claude Code: ' + e.message }; }
  runners.set(win, child);
  let err = '';
  child.stderr.on('data', (c) => { err += c; if (err.length > 4000) err = err.slice(-4000); });
  child.on('error', (e) => { runners.delete(win); activity.unshift({ t: Date.now(), session: win, project: projectFor(cwd), text: 'Could not start: ' + e.message, job: '' }); broadcast(); });
  child.on('exit', (code) => {
    runners.delete(win);
    if (code) activity.unshift({ t: Date.now(), session: win, project: projectFor(cwd), text: 'Stopped with an error', job: firstLine(err).slice(0, 120) });
    broadcast();
  });
  child.stdin.end(text);
  if (s) {
    s.status = 'working'; s.prompt = text; s.jobStart = Date.now(); s.lastEvent = Date.now();
    s.todos = []; s.actions = []; s.tests = []; s.testsDone = false; s.doing = 'Starting your job';
    s.title = String(title || ''); s.nextTitle = s.title;
    pushChat(s, 'you', text); logActivity(s, 'Started from HQ', s.title || firstLine(text));
  }
  broadcast();
  return { started: true };
}

// Make sure Claude Code ends every job with a one-line summary for HQ ("HQ: ...").
// Adds 3 lines to the end of your CLAUDE.md once. Never changes anything else in it.
(function ensureSummaryRule() {
  const fp = path.join(CLAUDE_DIR, 'CLAUDE.md');
  try {
    const cur = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
    if (/^HQ:|starts with HQ:/m.test(cur)) return;
    fs.appendFileSync(fp, '\n\n## HQ\nEnd every final message with one line that starts with HQ: and says in one plain sentence (under 15 words, no file paths) what you did.\n');
  } catch {}
})();

// ─── Snapshot sent to the page ──────────────────────────────────────────────
function snapshot() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.status === 'ended' && now - s.lastEvent > 30 * 60 * 1000) sessions.delete(id);
    else if (now - s.lastEvent > 6 * 60 * 60 * 1000) sessions.delete(id);
  }
  // One entry per window: the most recently active chat in that folder.
  const byWindow = new Map();
  for (const s of sessions.values()) {
    if (s.status === 'ended') continue;
    const w = windowName(s.cwd); const cur = byWindow.get(w);
    if (!cur || s.lastEvent > cur.lastEvent) byWindow.set(w, s);
  }
  const list = [...byWindow.entries()].map(([w, s]) => {
    let status = s.status;
    if ((status === 'working' || status === 'needs-you') && !isBusy(s)) status = 'idle';
    return { id: s.id, window: w, project: projectFor(s.cwd), status, doing: s.doing, prompt: s.prompt.slice(0, 2000),
      todos: s.todos, actions: s.actions.slice(0, 40), lastEvent: s.lastEvent, jobStart: s.jobStart,
      title: s.title || '', lastReply: s.lastReply.slice(0, 6000), tests: s.testsDone ? [] : s.tests, queue: s.queue, chat: s.chat };
  }).sort((a, b) => a.window.localeCompare(b.window));

  const projects = (config.projects || []).map((p) => ({ name: p.name, target: p.target || '', checklist: readChecklist(p.launchFile) }));
  return { now, sessions: list, projects, activity: activity.slice(0, 40), runs, merges, usage, plan: buildPlan(),
    logs: { file: logState.latestArchive, errors: logState.errors, errorCount: logState.errorCount, updated: logState.updated } };
}

// ─── Live updates ───────────────────────────────────────────────────────────
const clients = new Set(); let bTimer = null;
function broadcast() {
  if (bTimer) return;
  bTimer = setTimeout(() => {
    bTimer = null; const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) { try { res.write(data); } catch {} }
  }, 150);
}

// ─── Phone access (off unless you turn it on in hq.config.json) ────────────
const KEY_FILE = path.join(__dirname, '.phone-key');
let phoneKey = '';
if (config.allowPhone) {
  try { phoneKey = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {}
  if (!phoneKey) { phoneKey = crypto.randomBytes(6).toString('hex'); fs.writeFileSync(KEY_FILE, phoneKey); }
}
function allowed(req) {
  const ip = req.socket.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (!config.allowPhone) return false;
  const cookie = /hqkey=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const q = /[?&]key=([a-f0-9]+)/.exec(req.url);
  return (cookie && cookie[1] === phoneKey) || (q && q[1] === phoneKey);
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function sessionByWindow(win) {
  let best = null;
  for (const s of sessions.values()) if (s.status !== 'ended' && windowName(s.cwd) === win && (!best || s.lastEvent > best.lastEvent)) best = s;
  return best;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // Claude Code hooks (localhost only).
  if (req.method === 'POST' && url === '/event') {
    const ev = await readBody(req);
    let reply = null; try { reply = handleEvent(ev); } catch {}
    return json(res, 200, reply || {});
  }
  if (!allowed(req)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Add ?key=YOUR_KEY to the address. The key is shown in the HQ window on your PC.'); }
  if (config.allowPhone && /[?&]key=/.test(req.url)) res.setHeader('Set-Cookie', `hqkey=${phoneKey}; Path=/; Max-Age=31536000; SameSite=Strict`);

  if (url === '/api/state') return json(res, 200, snapshot());
  if (url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (url === '/api/transcript') {
    const win = decodeURIComponent((/[?&]window=([^&]+)/.exec(req.url) || [])[1] || '');
    const s = sessionByWindow(win);
    if (!s) return json(res, 404, { error: 'No chat for that window yet.' });
    return json(res, 200, { window: win, summary: s.lastReply, prompt: s.prompt, tests: s.tests, messages: s.transcriptPath ? readTranscript(s.transcriptPath) : [] });
  }
  if (req.method === 'POST' && url === '/api/queue') {
    const { window: win, text, title } = await readBody(req);
    const t = String(text || '').trim(); if (!t) return json(res, 400, { error: 'Empty message.' });
    const full = t + logsNote();
    const s = sessionByWindow(win);
    if (isBusy(s)) {
      s.queue.push(full); s.queueTitles = s.queueTitles || []; s.queueTitles[s.queue.length - 1] = String(title || ''); logActivity(s, 'Job queued', title || firstLine(t)); broadcast();
      return json(res, 200, { queued: true, text: full });
    }
    // Free: start it right now.
    const r = startJob(win, full, s, title);
    if (r.started) return json(res, 200, { started: true });
    return json(res, 200, { copy: true, text: full, error: r.error });
  }
  if (req.method === 'POST' && url === '/api/queue/clear') {
    const { window: win } = await readBody(req); const s = sessionByWindow(win);
    if (s) { s.queue = []; s.queueTitles = []; broadcast(); } return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url === '/api/tests/pass') {
    const { window: win } = await readBody(req); const s = sessionByWindow(win);
    if (s) { s.testsDone = true; logActivity(s, 'You passed the test'); broadcast(); }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/api/plan/done') {
    const b = await readBody(req); const st = planState();
    const ex = st.extra.find((x) => x.id === b.id);
    if (ex) ex.done = !!b.done; else if (b.done) st.done[b.id] = dayKey(Date.now()); else delete st.done[b.id];
    savePlanState(st); broadcast(); return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url === '/api/plan/add') {
    const b = await readBody(req); const t = String(b.text || '').trim().slice(0, 200);
    if (!t) return json(res, 400, { error: 'empty' });
    const st = planState(); st.extra.push({ id: 'x' + Date.now(), t, day: dayKey(Date.now()), done: false });
    savePlanState(st); broadcast(); return json(res, 200, { ok: true });
  }
  // Ask a question about a task. Runs Claude Code in read-only "plan" mode in your main
  // app folder (it can read your code but can't change anything). Uses your Claude usage.
  if (req.method === 'POST' && url === '/api/ask') {
    const b = await readBody(req);
    const q = String(b.question || '').trim().slice(0, 2000); if (!q) return json(res, 400, { error: 'Empty question.' });
    const exe = findClaude(); if (!exe) return json(res, 200, { error: 'Could not find Claude Code on this PC.' });
    const plan = buildPlan() || { tasks: [] };
    const t = plan.tasks.find((x) => x.id === b.id) || {};
    const cwd = (config.git && config.git.mainRepo && fs.existsSync(config.git.mainRepo)) ? config.git.mainRepo : os.homedir();
    const prompt = [
      'I\'m Ari. I\'m launching my iOS app ' + (plan.project || '') + ' on the App Store. Answer my question about one task on my launch plan.',
      'Rules: plain simple words, like you\'re explaining to a smart 10 year old. Exact click-by-click steps with real links when it\'s a website. Short. Don\'t change any files.',
      '', 'TASK: ' + (t.t || b.title || ''), t.sub ? 'DETAIL: ' + t.sub : '',
      (t.steps && t.steps.length) ? 'STEPS IN MY PLAN:\n' + t.steps.map((x, i) => (i + 1) + '. ' + x).join('\n') : '',
      '', 'MY QUESTION: ' + q,
    ].filter(Boolean).join('\n');
    let out = '', err = '', done = false;
    let child;
    try { child = spawn(exe, ['-p', '--permission-mode', 'plan'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return json(res, 200, { error: 'Could not start Claude Code: ' + e.message }); }
    const finish = (obj) => { if (done) return; done = true; json(res, 200, obj); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: 'That took too long. Try a shorter question.' }); }, 4 * 60 * 1000);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); finish({ error: e.message }); });
    child.on('exit', () => { clearTimeout(timer); finish(out.trim() ? { answer: out.trim() } : { error: firstLine(err) || 'No answer.' }); });
    child.stdin.end(prompt);
    return;
  }
  // Static files from /public. "/" opens the city.
  const rel = url === '/' ? '/HQ.html' : decodeURIComponent(url);
  const fp = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/v/') ? 'max-age=31536000' : 'no-store' }); res.end(data);
  });
});

server.on('error', (e) => { if (e.code === 'EADDRINUSE') console.log('[HQ] Already running on port ' + PORT + '. Using that one.'); else console.error('[HQ]', e.message); });
server.listen(PORT, config.allowPhone ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`\n  HQ is running →  http://localhost:${PORT}`);
  if (config.allowPhone) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`  On your phone  →  http://${ip}:${PORT}/?key=${phoneKey}`);
  }
  console.log('\n  Leave this window open. Ctrl+C to stop.\n');
});

scanTranscripts(); setInterval(scanTranscripts, 3000);
pollLogs(); setInterval(pollLogs, 3000);
pollRuns(); setInterval(pollRuns, 90000);
pollMerges(); setInterval(pollMerges, 20000);
scanUsage(); setInterval(scanUsage, 20000);
setInterval(broadcast, 15000);
