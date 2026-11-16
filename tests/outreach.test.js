// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../outreach/rules');
const E = require('../outreach/email');
const { Smtp, Imap, readBody } = require('../outreach/mail');

const DAY = 86400000;
const NOW = Date.parse('2026-11-23T14:30:00Z');
const cfg = { appName: 'Seeker', fromName: 'Ari', uploadLink: 'https://up.example/s', ramp: [10, 20, 35, 50], followUpDays: 4, maxFollowUps: 1 };
const place = (o = {}) => ({ id: 'p1', name: 'Compass Rose', city: 'DC', category: 'Nightlife', email: 'hello@compassrosedc.com', reason: 'your rooftop at sunset', status: 'todo', ...o });

test('daily limit rises week by week', () => {
  assert.strictEqual(R.dailyLimit(cfg, {}, NOW), 10);
  assert.strictEqual(R.dailyLimit(cfg, { startedAt: new Date(NOW - 3 * DAY).toISOString() }, NOW), 10);
  assert.strictEqual(R.dailyLimit(cfg, { startedAt: new Date(NOW - 8 * DAY).toISOString() }, NOW), 20);
  assert.strictEqual(R.dailyLimit(cfg, { startedAt: new Date(NOW - 15 * DAY).toISOString() }, NOW), 35);
  assert.strictEqual(R.dailyLimit(cfg, { startedAt: new Date(NOW - 90 * DAY).toISOString() }, NOW), 50);
});

test('a place needs a city, a real email and a reason', () => {
  assert.deepStrictEqual(R.problems(place()), []);
  assert.deepStrictEqual(R.problems(place({ email: '' })), ['no email']);
  assert.deepStrictEqual(R.problems(place({ email: 'hello at rose' })), ['email looks wrong']);
  assert.deepStrictEqual(R.problems(place({ reason: ' ' })), ['no reason why we picked them']);
  assert.deepStrictEqual(R.problems(place({ city: 'LA' })), ['city must be DC or Miami']);
});

test('picks follow-ups first and never goes over the limit', () => {
  const places = [];
  for (let i = 0; i < 15; i++) places.push(place({ id: 't' + i, name: 'T' + i }));
  places.push(place({ id: 'f', name: 'Old', status: 'sent', sentAt: new Date(NOW - 5 * DAY).toISOString(), lastMessageId: '<x@y>' }));
  places.push(place({ id: 'g', name: 'Recent', status: 'sent', sentAt: new Date(NOW - 2 * DAY).toISOString() }));
  places.push(place({ id: 'h', name: 'Done', status: 'sent', sentAt: new Date(NOW - 9 * DAY).toISOString(), followUps: 1 }));
  const state = { sentByDay: { [R.dayKey(NOW)]: 3 } };
  const list = R.pickToSend(places, cfg, state, NOW);
  assert.strictEqual(list.length, 7);
  assert.deepStrictEqual(list[0], { place: places[15], kind: 'followup' });
  assert.ok(list.slice(1).every(x => x.kind === 'first'));
  assert.strictEqual(R.pickToSend(places, { ...cfg, maxFollowUps: 0 }, {}, NOW).filter(x => x.kind === 'followup').length, 0);
});

test('our own quoted email is never read as their answer', () => {
  const body = "Sounds great, send me the details!\n\nOn Mon, Nov 16, 2026 at 9:17 AM Ari <seeker@gmail.com>\nwrote:\n> If it's not a good fit, totally fine, just let me know and I won't reach out again.";
  assert.strictEqual(R.stripQuoted(body), 'Sounds great, send me the details!');
  assert.strictEqual(R.classifyReply({ from: 'a@b.com', body: R.stripQuoted(body) }).id, 'replied');
});

test('replies are sorted by exact rules', () => {
  const c = (m) => R.classifyReply({ from: 'owner@place.com', subject: 'Re: x', body: '', ...m }).id;
  assert.strictEqual(c({ body: 'Thanks but not interested right now.' }), 'no');
  assert.strictEqual(c({ body: 'Please remove us from your list' }), 'no');
  assert.strictEqual(c({ body: "We'll pass, good luck!" }), 'no');
  assert.strictEqual(c({ body: 'Here you go https://drive.google.com/drive/folders/abc' }), 'videos');
  assert.strictEqual(c({ body: 'attached!', hasVideo: true }), 'videos');
  assert.strictEqual(c({ subject: 'Automatic reply: Compass Rose on a new DC app' }), 'auto');
  assert.strictEqual(c({ autoSubmitted: 'auto-replied' }), 'auto');
  assert.strictEqual(c({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)' }), 'bounce');
  assert.strictEqual(c({ body: 'How much does it cost after launch?' }), 'replied');
});

test('replies match the right place', () => {
  const ps = [place({ status: 'sent', lastMessageId: '<m1@gmail.com>' }),
    place({ id: 'p2', name: 'Joe’s', city: 'Miami', email: 'joesstonecrab@gmail.com', status: 'sent', lastMessageId: '<m2@gmail.com>' })];
  assert.strictEqual(R.matchPlace({ from: 'Rose <HELLO@compassrosedc.com>' }, ps).id, 'p1');
  assert.strictEqual(R.matchPlace({ from: 'manager@compassrosedc.com' }, ps).id, 'p1');
  assert.strictEqual(R.matchPlace({ from: 'someone@gmail.com' }, ps), null);
  assert.strictEqual(R.matchPlace({ from: 'someone@gmail.com', inReplyTo: '<m2@gmail.com>' }, ps).id, 'p2');
  assert.strictEqual(R.matchPlace({ from: 'mailer-daemon@googlemail.com', rawBody: 'Your message to joesstonecrab@gmail.com could not be delivered' }, ps, { id: 'bounce' }).id, 'p2');
});

test('statuses only move forward', () => {
  assert.ok(R.canMove('sent', 'replied'));
  assert.ok(R.canMove('replied', 'videos'));
  assert.ok(R.canMove('sent', 'passed'));
  assert.ok(!R.canMove('videos', 'replied'));
  assert.ok(!R.canMove('featured', 'passed'));
  assert.ok(!R.canMove('passed', 'replied'));
  assert.ok(!R.canMove('sent', null));
});

test('the first email is the approved text with every blank filled', () => {
  const m = E.firstEmail(place({ reason: 'your rooftop at sunset.' }), cfg);
  assert.strictEqual(m.subject, 'Compass Rose on a new DC app');
  assert.match(m.body, /^Hi Compass Rose team,/);
  assert.match(m.body, /on my list because of your rooftop at sunset\.\n/);
  assert.match(m.body, /send them here: https:\/\/up\.example\/s\./);
  assert.match(m.body, /Seeker · Washington, DC$/);
  assert.strictEqual(E.unfilled(m.subject + m.body), null);
  const miami = E.firstEmail(place({ city: 'Miami', contactName: 'Dana' }), cfg);
  assert.match(miami.subject, /new Miami app/); assert.match(miami.body, /^Hi Dana,/);
  assert.strictEqual(E.unfilled(E.firstEmail(place(), { ...cfg, uploadLink: '[upload link]' }).body), '[upload link]');
  assert.strictEqual(E.unfilled(E.firstEmail(place(), { ...cfg, appName: undefined }).body), 'undefined');
});

test('the email file is built so Gmail reads it right', () => {
  const mime = E.buildMime({ fromName: 'Ari', fromAddress: 'seeker@gmail.com', to: 'hello@compassrosedc.com', subject: 'Joe’s on a new app', body: 'Hi\n• one', messageId: '<1@gmail.com>', inReplyTo: '<0@gmail.com>' });
  assert.match(mime, /^From: Ari <seeker@gmail.com>\r\n/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /In-Reply-To: <0@gmail.com>/);
  const body = mime.split('\r\n\r\n')[1];
  assert.strictEqual(Buffer.from(body, 'base64').toString('utf8'), 'Hi\r\n• one');
});

// A pretend mail server, so the SMTP and IMAP code is tested for real without Gmail.
function fakeServer(onLine) {
  return new Promise(res => {
    const srv = net.createServer(sock => {
      let buf = '', dataMode = false, data = '';
      const say = s => sock.write(s + '\r\n');
      sock.on('data', d => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (dataMode) { if (line === '.') { dataMode = false; onLine({ data }, say); data = ''; } else data += line + '\n'; continue; }
          const r = onLine({ line }, say);
          if (r === 'data') dataMode = true;
        }
      });
      onLine({ open: true }, say);
    });
    srv.listen(0, () => res(srv));
  });
}
const plainConnect = port => (opts, cb) => net.connect(port, '127.0.0.1', cb);

test('SMTP: logs in and sends with dot-stuffing', async () => {
  const got = [];
  const srv = await fakeServer(({ open, line, data }, say) => {
    if (open) return say('220 hi');
    if (data != null) { got.push(data); return say('250 ok queued'); }
    got.push(line);
    if (line.startsWith('EHLO')) { say('250-smtp.gmail.com'); return say('250 AUTH LOGIN PLAIN'); }
    if (line === 'AUTH LOGIN') return say('334 VXNlcm5hbWU6');
    if (line === Buffer.from('me@gmail.com').toString('base64')) return say('334 UGFzc3dvcmQ6');
    if (line === Buffer.from('app pass').toString('base64')) return say('235 accepted');
    if (line.startsWith('MAIL FROM')) return say('250 ok');
    if (line === 'RCPT TO:<bad@nowhere.com>') return say('550 5.1.1 no such user');
    if (line.startsWith('RCPT TO')) return say('250 ok');
    if (line === 'DATA') { say('354 go'); return 'data'; }
    if (line === 'QUIT') return say('221 bye');
  });
  const s = new Smtp({ user: 'me@gmail.com', pass: 'app pass', host: 'x', port: srv.address().port, connect: plainConnect(srv.address().port) });
  await s.login();
  await s.send('me@gmail.com', 'a@b.com', 'Subject: x\r\n\r\n.hidden dot\r\nend');
  await assert.rejects(s.send('me@gmail.com', 'bad@nowhere.com', 'x'), e => e.code === 550);
  await s.quit();
  srv.close();
  assert.ok(got.includes('Subject: x\n\n..hidden dot\nend\n'));
});

test('IMAP: finds new mail and reads exact byte counts', async () => {
  const header = 'From: Rose <hello@compassrosedc.com>\r\nSubject: Re: Compass Rose on a new DC app\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n';
  const text = 'Love it — here: https://drive.google.com/x\r\n';
  const srv = await fakeServer(({ open, line }, say) => {
    if (open) return say('* OK ready');
    const [tag, ...rest] = line.split(' '); const cmd = rest.join(' ');
    if (cmd.startsWith('LOGIN')) return say(cmd.includes('"me@gmail.com"') ? `${tag} OK in` : `${tag} NO`);
    if (cmd === 'SELECT INBOX') { say('* 3 EXISTS'); return say(`${tag} OK`); }
    if (cmd.startsWith('UID SEARCH SINCE')) { say('* SEARCH 41 42'); return say(`${tag} OK`); }
    if (cmd.startsWith('UID FETCH 41')) {
      const hb = Buffer.byteLength(header), tb = Buffer.byteLength(text);
      say(`* 1 FETCH (UID 41 BODY[HEADER] {${hb}}`); sockWrite(say, header + ` BODY[TEXT]<0> {${tb}}`); sockWrite(say, text + ')'); return say(`${tag} OK`);
    }
    if (cmd.startsWith('UID FETCH 42')) return say(`${tag} OK`);
    if (cmd === 'LOGOUT') { say('* BYE'); return say(`${tag} OK`); }
  });
  function sockWrite(say, s) { say(s.replace(/\r\n$/, '')); }
  // say() adds \r\n; the literal sizes above count those same bytes
  const c = new Imap({ user: 'me@gmail.com', pass: 'p', port: srv.address().port, connect: plainConnect(srv.address().port) });
  await c.login();
  const mails = await c.since(NOW);
  await c.quit(); srv.close();
  assert.strictEqual(mails.length, 1);
  const b = readBody(mails[0].header, mails[0].text);
  assert.strictEqual(b.headers.from, 'Rose <hello@compassrosedc.com>');
  assert.match(b.text, /drive\.google\.com/);
});

test('reading bodies: multipart, quoted-printable, video attachments', () => {
  const header = 'Content-Type: multipart/mixed; boundary="BB"\r\n';
  const text = '--BB\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nSure, here=E2=80=99s our video=\r\n!\r\n--BB\r\nContent-Type: application/octet-stream; name="night.MOV"\r\nContent-Disposition: attachment; filename="night.MOV"\r\n\r\nAAAA\r\n--BB--\r\n';
  const b = readBody(header, text);
  assert.strictEqual(b.text.trim(), 'Sure, here’s our video!');
  assert.strictEqual(b.hasVideo, true);
  const html = readBody('Content-Type: text/html\r\n', '<div>Yes please!</div><blockquote>If it\'s not a good fit</blockquote>');
  assert.strictEqual(html.text.trim(), 'Yes please!');
});

test('a full run: reads replies, sends within the limit, saves everything', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-'));
  process.env.OUTREACH_DATA = dir;
  delete require.cache[require.resolve('../outreach/run')];
  const { main } = require('../outreach/run');
  const places = [place({ status: 'sent', sentAt: new Date(NOW - 1 * DAY).toISOString(), lastMessageId: '<m1@gmail.com>' })];
  for (let i = 0; i < 12; i++) places.push(place({ id: 'n' + i, name: 'New ' + i, email: `hi${i}@place${i}.com` }));
  places.push(place({ id: 'bad', name: 'No Email', email: '' }));
  fs.writeFileSync(path.join(dir, 'places.json'), JSON.stringify(places));
  const sent = [];
  const smtp = { login: async () => {}, quit: async () => {}, send: async (f, to, mime) => { if (to === 'hi3@place3.com') { const e = new Error('550 no'); e.code = 550; throw e; } sent.push({ to, mime }); } };
  const imap = { login: async () => {}, quit: async () => {}, since: async () => [
    { uid: 7, header: 'From: hello@compassrosedc.com\r\nSubject: Re: hi\r\n', text: 'Yes! Videos: https://www.dropbox.com/s/abc\r\n\r\nOn Mon, Nov 16, 2026 Ari wrote:\r\n> not a good fit' }] };
  const cfgPath = path.join(__dirname, '..', 'outreach', 'config.json');
  const saved = fs.readFileSync(cfgPath, 'utf8');
  fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(saved), live: true, uploadLink: 'https://up.example/s' }));
  try {
    const r = await main({ argv: [], env: { GMAIL_ADDRESS: 'seeker@gmail.com', GMAIL_APP_PASSWORD: 'x' }, now: NOW, smtp, imap, wait: async () => {} });
    assert.strictEqual(r.live, true);
    assert.strictEqual(r.replies, 1);
    assert.strictEqual(sent.length, 9); // limit 10, one address refused
    const saved2 = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8'));
    assert.strictEqual(saved2[0].status, 'videos');
    assert.strictEqual(saved2.find(p => p.id === 'n3').status, 'passed');
    assert.strictEqual(saved2.filter(p => p.status === 'sent').length, 9);
    assert.strictEqual(saved2.find(p => p.id === 'bad').status, 'todo');
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.strictEqual(state.sentByDay['2026-11-23'], 9);
    assert.deepStrictEqual(state.seenUids, [7]);
    // a second run the same day sends only what's left of the limit, and skips mail it already read
    const again = await main({ argv: [], env: { GMAIL_ADDRESS: 'seeker@gmail.com', GMAIL_APP_PASSWORD: 'x' }, now: NOW + 3600000, smtp, imap, wait: async () => {} });
    assert.strictEqual(again.sent, 1);
    assert.strictEqual(again.replies, 0);
  } finally { fs.writeFileSync(cfgPath, saved); }
});

test('practice run sends nothing and changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-'));
  process.env.OUTREACH_DATA = dir;
  delete require.cache[require.resolve('../outreach/run')];
  const { main } = require('../outreach/run');
  fs.writeFileSync(path.join(dir, 'places.json'), JSON.stringify([place()]));
  const log = console.log; console.log = () => {};
  try {
    const r = await main({ argv: [], env: {}, now: NOW });
    assert.strictEqual(r.live, false);
    assert.strictEqual(r.sent, 1);
  } finally { console.log = log; }
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8'))[0].status, 'todo');
  assert.ok(!fs.existsSync(path.join(dir, 'state.json')));
});
