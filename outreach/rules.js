// Outreach rules: plain, exact checks. No AI.
// Every rule here is tested in tests/outreach.test.js.
// If a reply doesn't match a rule, it is marked "replied" so Ari reads it himself. Nothing is guessed.
'use strict';

const DAY = 86400000;

// Email providers anyone can sign up for. A reply from the same domain as a place only counts
// as that place when the domain is the business's own (like compassrosedc.com), never these.
const FREE_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'msn.com', 'proton.me', 'protonmail.com', 'comcast.net', 'verizon.net']);

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;

// ─── Who gets an email today ────────────────────────────────────────────────

// How many emails go out today. Starts small so Gmail trusts the new address.
// ramp = [10, 20, 35, 50] means week 1: 10 a day, week 2: 20, week 3: 35, week 4 and after: 50.
function dailyLimit(config, state, now) {
  const ramp = config.ramp && config.ramp.length ? config.ramp : [10];
  if (!state.startedAt) return ramp[0];
  const weeks = Math.floor((now - Date.parse(state.startedAt)) / (7 * DAY));
  return ramp[Math.max(0, Math.min(weeks, ramp.length - 1))];
}

function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

function sentToday(state, now) { return (state.sentByDay && state.sentByDay[dayKey(now)]) || 0; }

// Why a place can't be emailed yet. Empty list = ready.
function problems(place) {
  const p = [];
  if (!place.name || !String(place.name).trim()) p.push('no name');
  if (place.city !== 'DC' && place.city !== 'Miami') p.push('city must be DC or Miami');
  if (!place.email) p.push('no email');
  else if (!EMAIL_RE.test(place.email)) p.push('email looks wrong');
  if (!place.reason || !String(place.reason).trim()) p.push('no reason why we picked them');
  return p;
}

// Places waiting for their first email.
function firstEmails(places) {
  return places.filter(p => p.status === 'todo' && problems(p).length === 0);
}

// Places that got one email, never replied, and are due a single follow-up.
function followUps(places, config, now) {
  const days = Number(config.followUpDays) || 0;
  const max = config.maxFollowUps == null ? 1 : Number(config.maxFollowUps);
  if (!days || !max) return [];
  return places.filter(p => p.status === 'sent' && !p.repliedAt && (p.followUps || 0) < max &&
    p.sentAt && now - Date.parse(p.lastEmailAt || p.sentAt) >= days * DAY);
}

// The list to send today, follow-ups first, never more than today's limit.
function pickToSend(places, config, state, now) {
  const left = Math.max(0, dailyLimit(config, state, now) - sentToday(state, now));
  const fu = followUps(places, config, now).map(place => ({ place, kind: 'followup' }));
  const first = firstEmails(places).map(place => ({ place, kind: 'first' }));
  return fu.concat(first).slice(0, left);
}

// ─── What a reply means ─────────────────────────────────────────────────────

// Remove the part of a reply that quotes our own email, so words in our email
// ("If it's not a good fit…") are never read as their answer.
function stripQuoted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*On .{0,200}wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  // "On Mon, Nov 16, 2026 at 9:17 AM Ari <x@y.com>" can wrap onto two lines
  const joined = out.join('\n');
  const cut = joined.search(/\nOn [^\n]{0,200}\n?[^\n]{0,120}wrote:/i);
  return (cut >= 0 ? joined.slice(0, cut) : joined).trim();
}

const REPLY_RULES = [
  { id: 'bounce', status: 'passed', note: 'Email bounced (address doesn’t work)',
    test: m => /mailer-daemon|postmaster@/i.test(m.from) || /^(Delivery Status Notification|Undeliverable|Mail delivery failed|Returned mail)/i.test(m.subject || '') },
  { id: 'auto', status: null, note: 'Automatic reply (out of office), ignored',
    test: m => /auto-replied|auto-generated/i.test(m.autoSubmitted || '') ||
      /^(Automatic reply|Auto[- ]?reply|Out of (the )?office)/i.test(m.subject || '') ||
      /\b(I am|I'm|we are|we're) (currently )?(out of (the )?office|away from (the )?office)\b/i.test(m.body || '') && (m.body || '').length < 600 },
  { id: 'no', status: 'passed', note: 'Said no',
    test: m => /\b(not interested|no,? thanks?|no thank you|unsubscribe|remove (me|us)|take (me|us) off|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact)|not a (good )?fit|we'?ll pass|we will pass|pass on this|please stop)\b/i.test(m.body || '') },
  { id: 'videos', status: 'videos', note: 'Sent videos',
    test: m => m.hasVideo || /\b(drive\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|box\.com|icloud\.com\/(iclouddrive|photos)|photos\.app\.goo\.gl|1drv\.ms|onedrive\.live\.com)\//i.test(m.body || '') },
  { id: 'replied', status: 'replied', note: 'Replied (read it yourself)', test: () => true },
];

// m = { from, subject, body (already without the quoted part), hasVideo, autoSubmitted }
function classifyReply(m) {
  for (const r of REPLY_RULES) if (r.test(m)) return r;
}

function addressOf(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

// Which place a reply belongs to. Exact address first, then the business's own domain,
// then the email it answers (In-Reply-To). For bounces, the address named inside the bounce.
function matchPlace(m, places, rule) {
  const sent = places.filter(p => p.email && p.lastMessageId);
  if (rule && rule.id === 'bounce') {
    const raw = String(m.rawBody || m.body || '').toLowerCase();
    return sent.find(p => raw.includes(p.email.toLowerCase())) || null;
  }
  const addr = addressOf(m.from);
  let p = sent.find(x => x.email.toLowerCase() === addr);
  if (p) return p;
  const dom = addr.split('@')[1];
  if (dom && !FREE_DOMAINS.has(dom)) {
    const same = sent.filter(x => x.email.toLowerCase().split('@')[1] === dom);
    if (same.length === 1) return same[0];
  }
  const ids = String(m.inReplyTo || '') + ' ' + String(m.references || '');
  return sent.find(x => (x.messageIds || [x.lastMessageId]).some(id => id && ids.includes(id))) || null;
}

// Statuses only move forward. A reply never undoes "videos", "featured" or "passed".
const RANK = { todo: 0, sent: 1, replied: 2, videos: 3, featured: 4, passed: 4 };
function canMove(from, to) {
  if (!to) return false;
  if (from === 'featured' || from === 'passed') return false;
  return (RANK[to] ?? 0) > (RANK[from] ?? 0) || (to === 'passed' && from !== 'featured');
}

module.exports = { dailyLimit, dayKey, sentToday, problems, firstEmails, followUps, pickToSend,
  stripQuoted, classifyReply, matchPlace, addressOf, canMove, REPLY_RULES, FREE_DOMAINS };
