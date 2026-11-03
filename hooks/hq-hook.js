// Sends Claude Code hook events to HQ.
// Never blocks Claude Code: gives up after ~1s if HQ isn't running.
// On "Stop", if you queued a job in HQ, it hands that job to Claude so it keeps working.
const http = require('http');

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  let event = '';
  try { event = JSON.parse(body.toString('utf8')).hook_event_name || ''; } catch {}
  let finished = false;
  const done = (out) => {
    if (finished) return; finished = true;
    if (out) process.stdout.write(out);
    process.exit(0);
  };
  try {
    const req = http.request({
      host: '127.0.0.1', port: Number(process.env.HQ_PORT || 4747), path: '/event', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, timeout: 1500,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        // The Watchdog may approve a tiny, exactly-known safe command (like "git status").
        if (event === 'PermissionRequest') {
          try { const r = JSON.parse(text || '{}'); if (r.permission && r.permission.behavior === 'allow') return done(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })); } catch {}
          return done();
        }
        if (event !== 'Stop') return done();
        try {
          const reply = JSON.parse(text || '{}');
          if (reply.deliver) return done(JSON.stringify({ decision: 'block', reason: `New job from Ari (sent from HQ):\n\n${reply.deliver}` }));
        } catch {}
        done();
      });
    });
    req.on('error', () => done());
    req.on('timeout', () => { req.destroy(); done(); });
    req.end(body);
  } catch { done(); }
  setTimeout(() => done(), 2000);
});
