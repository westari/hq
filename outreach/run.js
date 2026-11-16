// Seeker outreach: checks replies, then sends today's emails. No AI. Runs every weekday on GitHub.
//   node outreach/run.js          does a practice run unless config.live is true and Gmail is set up
//   node outreach/run.js --dry    practice run: prints the emails, sends nothing, changes nothing
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./rules');
const E = require('./email');
const { Smtp, Imap, readBody } = require('./mail');

const ROOT = __dirname;
let DATA = path.resolve(process.env.OUTREACH_DATA || path.join(ROOT, 'data'));
const FILES = { places: path.join(DATA, 'places.json'), state: path.join(DATA, 'state.json'), log: path.join(DATA, 'log.jsonl') };

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main({ argv = process.argv.slice(2), env = process.env, now = Date.now(), smtp, imap, wait = sleep } = {}) {
  fs.mkdirSync(DATA, { recursive: true });
  // Settings changed in the Seeker app (saved on the data branch) win over config.json.
  const fromApp = readJson(path.join(DATA, 'settings.json'), {}) || {};
  const config = readJson(path.join(ROOT, 'config.json'), {});
  for (const k of ['appName', 'uploadLink', 'live', 'mailingAddress', 'followUpDays', 'followUpApproved']) {
    if (fromApp[k] !== undefined && fromApp[k] !== '') config[k] = fromApp[k];
  }
  const places = readJson(FILES.places, []);
  const state = readJson(FILES.state, {});
  state.sentByDay = state.sentByDay || {};
  state.seenUids = state.seenUids || [];
  const user = env.GMAIL_ADDRESS, pass = env.GMAIL_APP_PASSWORD;
  const practice = argv.includes('--dry');
  const summary = [];
  const log = (event) => {
    const line = JSON.stringify({ at: new Date(now).toISOString(), ...event });
    if (!practice) fs.appendFileSync(FILES.log, line + '\n');
  };
  const save = () => {
    if (practice) return;
    fs.writeFileSync(FILES.places, JSON.stringify(places, null, 2) + '\n');
    fs.writeFileSync(FILES.state, JSON.stringify(state, null, 2) + '\n');
  };

  // Is real sending allowed today? Every reason it isn't gets printed.
  const blockers = [];
  if (!config.live) blockers.push('"live" is false in outreach/config.json');
  if (!user || !pass) blockers.push('Gmail is not connected (GMAIL_ADDRESS and GMAIL_APP_PASSWORD secrets)');
  if (!config.appName) blockers.push('no app name in config.json');
  if (!config.uploadLink) blockers.push('no upload link in config.json');
  const live = !practice && blockers.length === 0;
  if (!live) summary.push(`Practice run (nothing sent): ${practice ? 'you asked for --dry' : blockers.join('; ')}.`);
  if (!config.mailingAddress) summary.push('Note: no mailing address in the emails (US law asks for one).');

  // ── 1. Replies ──
  let replies = 0;
  if (user && pass && !practice) {
    const client = imap || new Imap({ user, pass });
    try {
      await client.login();
      const oldest = places.filter(p => p.sentAt).map(p => Date.parse(p.sentAt)).sort((a, b) => a - b)[0];
      const mails = oldest ? await client.since(Math.max(oldest - 86400000, now - 60 * 86400000)) : [];
      const seen = new Set(state.seenUids);
      for (const mail of mails) {
        if (seen.has(mail.uid)) continue;
        seen.add(mail.uid);
        const { headers: h, text, hasVideo } = readBody(mail.header, mail.text);
        if (R.addressOf(h.from) === user.toLowerCase()) continue;
        const m = { from: h.from || '', subject: h.subject || '', autoSubmitted: h['auto-submitted'] || '',
          inReplyTo: h['in-reply-to'] || '', references: h.references || '', body: R.stripQuoted(text), rawBody: text, hasVideo };
        const rule = R.classifyReply(m);
        const place = R.matchPlace(m, places, rule);
        if (!place) continue;
        if (!R.canMove(place.status, rule.status)) { log({ type: 'reply', place: place.name, rule: rule.id, moved: false }); continue; }
        const at = new Date(now).toISOString();
        place.status = rule.status; place.updatedAt = at;
        if (!place.repliedAt) place.repliedAt = at;
        if (rule.status === 'videos') place.yesAt = at;
        place.notes = [place.notes, `${at.slice(0, 10)}: ${rule.note}`].filter(Boolean).join('\n');
        replies++;
        log({ type: 'reply', place: place.name, city: place.city, rule: rule.id, status: rule.status });
        summary.push(`${place.name}: ${rule.note}`);
      }
      state.seenUids = [...seen].slice(-3000);
      save();
    } catch (e) {
      summary.push(`Couldn't check replies: ${e.message}`);
      log({ type: 'error', step: 'replies', message: e.message });
    } finally { await client.quit().catch(() => {}); }
  }

  // ── 2. Sending ──
  // Follow-ups only go out once Ari approves their wording (config.followUpApproved).
  const list = R.pickToSend(places, config.followUpApproved ? config : { ...config, maxFollowUps: 0 }, state, now);
  const skipped = places.filter(p => p.status === 'todo' && R.problems(p).length);
  for (const p of skipped) summary.push(`Skipped ${p.name}: ${R.problems(p).join(', ')}`);

  let sent = 0, client = null;
  try {
    for (const { place, kind } of list) {
      const mail = kind === 'first' ? E.firstEmail(place, config) : E.followUpEmail(place, config);
      const gap = E.unfilled(mail.subject + '\n' + mail.body);
      if (live && gap) { summary.push(`Skipped ${place.name}: "${gap}" wasn't filled in`); continue; }
      if (!live) {
        console.log(`\n──── ${kind === 'first' ? 'Email' : 'Follow-up'} to ${place.name} <${place.email}> ────\nSubject: ${mail.subject}\n\n${mail.body}`);
        sent++;
        continue;
      }
      if (!client) { client = smtp || new Smtp({ user, pass }); await client.login(); }
      const messageId = E.newMessageId(user);
      const mime = E.buildMime({ fromName: config.fromName || 'Ari', fromAddress: user, to: place.email,
        subject: mail.subject, body: mail.body, messageId, inReplyTo: kind === 'followup' ? place.lastMessageId : null, date: new Date(now) });
      try {
        await client.send(user, place.email, mime);
      } catch (e) {
        if (e.code >= 500 && e.code < 600 && e.code !== 535 && e.code !== 530) {
          place.status = 'passed'; place.updatedAt = new Date(now).toISOString();
          place.notes = [place.notes, `Gmail refused the address: ${e.message.slice(0, 120)}`].filter(Boolean).join('\n');
          summary.push(`${place.name}: address refused, marked as no`);
          log({ type: 'refused', place: place.name, message: e.message });
          save();
          continue;
        }
        throw e;
      }
      const at = new Date(now).toISOString();
      if (kind === 'first') { place.status = 'sent'; place.sentAt = at; place.subject = mail.subject; }
      else place.followUps = (place.followUps || 0) + 1;
      place.lastEmailAt = at; place.updatedAt = at; place.lastMessageId = messageId;
      place.messageIds = (place.messageIds || []).concat(messageId);
      state.startedAt = state.startedAt || at;
      const k = R.dayKey(now); state.sentByDay[k] = (state.sentByDay[k] || 0) + 1;
      sent++;
      log({ type: kind, place: place.name, city: place.city, to: place.email });
      save();
      const [a, b] = config.secondsBetweenEmails || [20, 45];
      if (sent < list.length) await wait((a + Math.random() * (b - a)) * 1000);
    }
  } catch (e) {
    summary.push(`Stopped sending: ${e.message}`);
    log({ type: 'error', step: 'send', message: e.message });
  } finally { if (client) await client.quit().catch(() => {}); }

  const limit = R.dailyLimit(config, state, now);
  const head = `${live ? 'Sent' : 'Would send'} ${sent} email${sent === 1 ? '' : 's'} (today's limit ${limit}). ${replies} new repl${replies === 1 ? 'y' : 'ies'}. ` +
    `${places.filter(p => p.status === 'todo').length} places waiting.`;
  const text = [head, ...summary].join('\n');
  console.log('\n' + text);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text.split('\n').map(l => `- ${l}`).join('\n') + '\n');
  return { sent, replies, live, summary, places, state };
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main, FILES };
