// Talks to Gmail directly (SMTP to send, IMAP to read replies). No packages needed.
// Gmail needs an "app password" (Google Account → Security → 2-Step Verification → App passwords).
'use strict';
const tls = require('tls');

// Reads a socket as a stream of bytes and hands out lines or exact byte counts.
class Reader {
  constructor(sock) {
    this.buf = Buffer.alloc(0); this.waiters = []; this.err = null;
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    sock.on('error', e => { this.err = e; this.pump(); });
    sock.on('close', () => { this.err = this.err || new Error('connection closed'); this.pump(); });
  }
  pump() {
    while (this.waiters.length) {
      const w = this.waiters[0];
      let out = null;
      if (w.bytes != null) { if (this.buf.length >= w.bytes) { out = this.buf.subarray(0, w.bytes); this.buf = this.buf.subarray(w.bytes); } }
      else { const i = this.buf.indexOf('\r\n'); if (i >= 0) { out = this.buf.subarray(0, i).toString('utf8'); this.buf = this.buf.subarray(i + 2); } }
      if (out == null) { if (this.err) { this.waiters.shift().reject(this.err); continue; } return; }
      this.waiters.shift().resolve(out);
    }
  }
  line() { return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.pump(); }); }
  bytes(n) { return new Promise((resolve, reject) => { this.waiters.push({ bytes: n, resolve, reject }); this.pump(); }); }
}

function open(host, port, connect) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port, servername: host }, () => resolve(sock));
    sock.once('error', reject);
    sock.setTimeout && sock.setTimeout(60000, () => sock.destroy(new Error('timed out')));
  });
}

// ─── Sending (SMTP) ─────────────────────────────────────────────────────────

class Smtp {
  constructor({ user, pass, host = 'smtp.gmail.com', port = 465, connect = tls.connect }) {
    Object.assign(this, { user, pass, host, port, connect });
  }
  async reply() {
    const lines = [];
    for (;;) { const l = await this.r.line(); lines.push(l); if (/^\d{3} /.test(l) || /^\d{3}$/.test(l)) break; }
    return { code: +lines[lines.length - 1].slice(0, 3), text: lines.join('\n') };
  }
  async cmd(line, ok) {
    if (line != null) this.sock.write(line + '\r\n');
    const res = await this.reply();
    if (!ok.includes(res.code)) {
      const shown = /^(AUTH|[A-Za-z0-9+/=]{12,}$)/.test(line || '') ? '(login)' : line;
      const e = new Error(`Gmail said ${res.code} to ${shown}: ${res.text}`); e.code = res.code; throw e;
    }
    return res;
  }
  async login() {
    this.sock = await open(this.host, this.port, this.connect);
    this.r = new Reader(this.sock);
    await this.cmd(null, [220]);
    await this.cmd('EHLO outreach', [250]);
    await this.cmd('AUTH LOGIN', [334]);
    await this.cmd(Buffer.from(this.user).toString('base64'), [334]);
    await this.cmd(Buffer.from(this.pass).toString('base64'), [235]);
  }
  async send(from, to, mime) {
    await this.cmd(`MAIL FROM:<${from}>`, [250]);
    await this.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await this.cmd('DATA', [354]);
    const data = mime.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    this.sock.write(data + (data.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
    await this.cmd(null, [250]);
  }
  async quit() {
    try { await this.cmd('QUIT', [221]); } catch {}
    this.sock && this.sock.end();
  }
}

// ─── Reading replies (IMAP) ─────────────────────────────────────────────────

const q = s => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';

class Imap {
  constructor({ user, pass, host = 'imap.gmail.com', port = 993, connect = tls.connect }) {
    Object.assign(this, { user, pass, host, port, connect, n: 0 });
  }
  // Runs one command and collects its answer. Literals ({123} then 123 bytes) are read exactly.
  async run(command) {
    const tag = 'a' + (++this.n);
    this.sock.write(`${tag} ${command}\r\n`);
    const items = [];
    for (;;) {
      let line = await this.r.line();
      if (line.startsWith(tag + ' ')) {
        if (!/^\S+ OK/i.test(line)) throw new Error(`Gmail said: ${command.startsWith('LOGIN') ? 'LOGIN failed' : line}`);
        return items;
      }
      const item = { line, literals: [] };
      let m;
      while ((m = line.match(/\{(\d+)\}$/))) {
        item.literals.push((await this.r.bytes(+m[1])).toString('utf8'));
        line = await this.r.line();
        item.line += ' ' + line;
      }
      items.push(item);
    }
  }
  async login() {
    this.sock = await open(this.host, this.port, this.connect);
    this.r = new Reader(this.sock);
    const hi = await this.r.line();
    if (!/^\* OK/i.test(hi)) throw new Error('Gmail did not say hello: ' + hi);
    await this.run(`LOGIN ${q(this.user)} ${q(this.pass)}`);
    await this.run('SELECT INBOX');
  }
  // Mail received since a date: [{uid, header, text}]. header/text are raw.
  async since(date, max = 300) {
    const d = new Date(date);
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const items = await this.run(`UID SEARCH SINCE ${d.getUTCDate()}-${M}-${d.getUTCFullYear()}`);
    const uids = items.flatMap(i => (i.line.match(/^\* SEARCH(.*)$/) || [, ''])[1].trim().split(/\s+/)).filter(Boolean).map(Number).slice(-max);
    const out = [];
    for (const uid of uids) {
      const res = await this.run(`UID FETCH ${uid} (BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.60000>)`);
      const f = res.find(i => /FETCH/i.test(i.line) && i.literals.length);
      if (!f) continue;
      const hi = f.line.search(/BODY\[HEADER\]/i), ti = f.line.search(/BODY\[TEXT\]/i);
      const [header, text] = hi < ti ? f.literals : [f.literals[1], f.literals[0]];
      out.push({ uid, header: header || '', text: text || '' });
    }
    return out;
  }
  async quit() {
    try { await this.run('LOGOUT'); } catch {}
    this.sock && this.sock.end();
  }
}

// ─── Making sense of a raw email ────────────────────────────────────────────

function headers(raw) {
  const h = {};
  const unfolded = String(raw).replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) { const k = m[1].toLowerCase(); if (!(k in h)) h[k] = decodeWords(m[2]); }
  }
  return h;
}

function decodeWords(s) {
  return String(s).replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, enc, txt) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(txt, 'base64').toString('utf8');
      return qp(txt.replace(/_/g, ' '));
    } catch { return txt; }
  });
}

function qp(s) {
  const bytes = [];
  const t = String(s).replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.substr(i + 1, 2))) { bytes.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(...Buffer.from(t[i], 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodePart(body, enc) {
  enc = String(enc || '').toLowerCase();
  if (enc.includes('base64')) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc.includes('quoted-printable')) return qp(body);
  return body;
}

// Finds the plain text of an email (or strips the HTML if that's all there is) and
// notes whether a video file is attached.
function readBody(headerRaw, textRaw) {
  const top = headers(headerRaw);
  const result = { text: '', hasVideo: false };
  const walk = (ctype, enc, body, depth) => {
    ctype = ctype || 'text/plain';
    if (/^video\//i.test(ctype)) { result.hasVideo = true; return; }
    const b = ctype.match(/boundary="?([^";]+)"?/i);
    if (/^multipart\//i.test(ctype) && b && depth < 5) {
      const parts = body.split('--' + b[1]).slice(1);
      for (const part of parts) {
        if (part.startsWith('--')) break;
        const i = part.search(/\r?\n\r?\n/);
        if (i < 0) continue;
        const ph = headers(part.slice(0, i).replace(/^\r?\n/, ''));
        const name = (ph['content-disposition'] || '') + ' ' + (ph['content-type'] || '');
        if (/\.(mp4|mov|m4v|avi|webm|hevc)\b/i.test(name)) result.hasVideo = true;
        walk(ph['content-type'], ph['content-transfer-encoding'], part.slice(i).replace(/^\r?\n\r?\n/, ''), depth + 1);
      }
      return;
    }
    if (/^text\/plain/i.test(ctype) && !result.text) result.text = decodePart(body, enc);
    else if (/^text\/html/i.test(ctype) && !result.html) result.html = decodePart(body, enc);
  };
  walk(top['content-type'], top['content-transfer-encoding'], String(textRaw), 0);
  if (!result.text && result.html) {
    result.text = result.html.replace(/<(br|\/p|\/div)[^>]*>/gi, '\n').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'");
  }
  return { headers: top, text: result.text, hasVideo: result.hasVideo };
}

module.exports = { Smtp, Imap, Reader, headers, readBody, decodeWords, qp };
