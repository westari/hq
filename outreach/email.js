// The emails, word for word. The first email is the one Ari approved on Nov 16, 2026
// (also saved in the ATHLT Claude Project as local-app/outreach-email.md).
'use strict';
const crypto = require('crypto');

function hello(place) {
  return place.contactName ? `Hi ${place.contactName},` : `Hi ${place.name} team,`;
}

function signature(config) {
  const lines = ['Thanks,', config.fromName || 'Ari', `${config.appName} · Washington, DC`];
  if (config.mailingAddress) lines.push(config.mailingAddress);
  return lines.join('\n');
}

function firstEmail(place, config) {
  const city = place.city === 'Miami' ? 'Miami' : 'DC';
  const subject = `${place.name} on a new ${city} app`;
  const body = `${hello(place)}

My name is Ari. I'm building ${config.appName}, an app where people in ${city} scroll short videos of local spots to decide where to go. Every video is a real place in the city, with the address, hours, and a directions button right below it.

I'm choosing the first places to feature at launch, and ${place.name} is on my list because of ${place.reason.trim().replace(/[.!]+$/, '')}.

Here's how it would work:
• Getting featured is free. I just want great places in the app from day one.
• You send 2 or 3 short videos you already have, like your food, your space, or a busy night.
• They go on your own page in the app with your name, and people can tap straight to directions or your website.

You can send them here: ${config.uploadLink}. Or just reply if you have questions first.

If it's not a good fit, totally fine, just let me know and I won't reach out again.

${signature(config)}`;
  return { subject, body };
}

// Draft. Ari has not approved this one yet (config.followUpApproved must be true to send it).
function followUpEmail(place, config) {
  const city = place.city === 'Miami' ? 'Miami' : 'DC';
  const subject = `Re: ${place.subject || `${place.name} on a new ${city} app`}`;
  const body = `${hello(place)}

Just bumping this in case it got buried. I'd love to have ${place.name} in ${config.appName} when it launches in ${city}. If you have 2 or 3 short videos, you can send them here: ${config.uploadLink}.

If it's not a fit, no worries. I won't follow up again.

${signature(config)}`;
  return { subject, body };
}

// Leftover [brackets] or "undefined" mean a blank was never filled in. Such an email is never sent.
function unfilled(text) {
  const m = String(text).match(/\[[^\]\n]{1,40}\]|\bundefined\b|\bnull\b/);
  return m ? m[0] : null;
}

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function newMessageId(fromAddress) {
  const dom = String(fromAddress).split('@')[1] || 'localhost';
  return `<${Date.now().toString(36)}.${crypto.randomBytes(8).toString('hex')}@${dom}>`;
}

// A plain-text email in the exact format mail servers expect.
function buildMime({ fromName, fromAddress, to, subject, body, messageId, inReplyTo, date = new Date() }) {
  const b64 = Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const h = [
    `From: ${encodeHeader(fromName)} <${fromAddress}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
  ];
  if (inReplyTo) h.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  h.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  return h.join('\r\n') + '\r\n\r\n' + b64 + '\r\n';
}

module.exports = { firstEmail, followUpEmail, unfilled, buildMime, newMessageId, encodeHeader };
