// Watchdog rules: plain, exact checks. No AI. Every rule here is tested in tests/watchdog.test.js.
// If a message matches a rule, HQ knows exactly what it means. If nothing matches, HQ says "unknown"
// and never guesses.
'use strict';

// ─── Why a GitHub iOS build failed ──────────────────────────────────────────
// Checked in this order. The first match wins.
//   retry: true  = the problem can go away by itself (network, GitHub hiccup), so one retry is worth it
//   human: true  = only you or Dad can fix it (Apple website, GitHub secrets). Retrying is pointless.
//   window: true = it's a code problem a Claude Code window can fix
const BUILD_RULES = [
  { id: 'signing', human: true, title: 'Apple signing problem',
    re: /doesn'?t include the .{0,80}entitlement|doesn'?t support the .{0,60}capability|No profiles for|Provisioning profile .{0,120}doesn'?t (match|include)|requires a provisioning profile|No signing certificate|Code Signing Error|errSecInternalComponent|certificate .{0,40}(expired|revoked)/i,
    plain: 'Apple won’t sign the app. The app asks for something (like Sign in with Apple) that isn’t turned on for your App ID, or the signing files are old.',
    steps: ['Dad: go to developer.apple.com → Certificates, IDs & Profiles → Identifiers.', 'Open the app’s ID (com.athlt.formpal) and turn on the capability the error names (for example “Sign In with Apple”). Save.', 'Make the provisioning profile again (Profiles → the app’s profile → Edit → Save), then press Build in HQ.'] },
  { id: 'secret', human: true, title: 'A GitHub secret is missing',
    re: /EXPO_TOKEN|Input required and not supplied|secret.{0,40}(not set|missing|empty)|not logged in to EAS|An Expo user account is required/i,
    plain: 'The build needs a password-like setting (a “secret”) on GitHub, and it’s missing or wrong.',
    steps: ['Open github.com → your FormPal repo → Settings → Secrets and variables → Actions.', 'Check the secret the error names (usually EXPO_TOKEN). Add it again if it’s missing.', 'Then press Build in HQ.'] },
  { id: 'pods', window: true, title: 'iOS packages (CocoaPods) don’t fit together',
    re: /CocoaPods could not find compatible versions|pod install.{0,40}(failed|error)|\[!\] .{0,80}pod|Unable to find a specification for/i,
    plain: 'Two app packages need different versions of the same iOS piece. A window can fix the versions.' },
  { id: 'code', window: true, title: 'A code error stopped the build',
    re: /Unable to resolve module|SyntaxError|TypeError:|error TS\d{3,5}|Cannot find module|is not exported from|Transform Error|BUNDLE.{0,40}failed|Metro.{0,40}error/i,
    plain: 'Something in the app’s code is broken, so the app couldn’t be packed up. A window can fix it.' },
  { id: 'temporary', retry: true, title: 'GitHub or the network had a hiccup',
    re: /ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|\b50[234]\b|runner (has )?lost communication|The operation was canceled|Unable to boot (the )?simulator|rate limit exceeded|Could not resolve host/i,
    plain: 'Not your fault. GitHub or the internet glitched. One retry usually works.' },
];
function classifyBuild(text) {
  const t = String(text || '');
  for (const r of BUILD_RULES) if (r.re.test(t)) return r;
  return { id: 'unknown', title: 'Unknown build error', plain: 'HQ doesn’t recognize this error. It won’t retry blindly.' };
}

// ─── Claude usage-limit messages ────────────────────────────────────────────
// "5-hour limit reached - resets 3pm", "You've hit your session limit · resets 2am",
// "You've hit your weekly limit · resets Oct 9, 10am", "Claude AI usage limit reached|1700000000"
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseLimit(text, base) {
  const t = String(text || '');
  if (!/hit your .{0,20}limit|usage limit|limit reached|limit (has been )?reached/i.test(t)) return null;
  if (/used \d+% of your/i.test(t) && !/hit your|reached/i.test(t)) return null; // just a warning
  const weekly = /weekly/i.test(t);
  const now = new Date(base || Date.now());
  // Unix time after a pipe (older Claude Code format)
  const unix = /limit reached\|(\d{10})/i.exec(t);
  if (unix) return { weekly, resetAt: Number(unix[1]) * 1000 };
  const m = /resets\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+)?(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(t);
  if (!m) return { weekly, resetAt: 0 };
  let h = Number(m[4]) % 12; if (/pm/i.test(m[6])) h += 12;
  const d = new Date(now); d.setSeconds(0, 0); d.setHours(h, Number(m[5] || 0));
  if (m[1]) {
    d.setMonth(MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]));
    if (d <= now) d.setFullYear(d.getFullYear() + 1);
  } else if (m[3]) {
    const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[3].toLowerCase().slice(0, 3));
    while (d.getDay() !== want || d <= now) d.setDate(d.getDate() + 1);
  } else if (d <= now) d.setDate(d.getDate() + 1);
  return { weekly, resetAt: d.getTime() };
}

// ─── Merge-conflict leftovers ───────────────────────────────────────────────
// Only the two lines that can't appear in normal code: "<<<<<<< " and ">>>>>>> ".
// ("=======" alone is skipped on purpose: it's also a Markdown heading underline.)
const MARKER_RE = /^(<<<<<<<|>>>>>>>)( |$)/m;
const MARKER_GREP = '^(<<<<<<<|>>>>>>>)( |$)';

// ─── TypeScript errors, made comparable ─────────────────────────────────────
// "app/x.tsx(12,5): error TS2322: Type ..." → "app/x.tsx: TS2322: Type ..." (line numbers move around,
// so they're dropped; that way "same error, shifted line" doesn't count as new).
function tscErrors(out) {
  const set = new Set();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line.trim());
    if (m) set.add(m[1].replace(/\\/g, '/') + ': ' + m[2] + ': ' + m[3].trim());
  }
  return [...set];
}
function newErrors(before, after) { const b = new Set(before || []); return (after || []).filter((e) => !b.has(e)); }

// ─── Commands HQ may approve for a window, by itself ────────────────────────
// EXACT text only. Anything with chaining, pipes, redirects or $(...) is never auto-approved.
const SAFE_EXACT = ['git status', 'git diff', 'git diff --stat', 'git log --oneline -20', 'git log --oneline -10', 'git branch', 'npx tsc --noEmit', 'npm test', 'npm run test', 'npx expo-doctor'];
function safeToApprove(tool, input, extra) {
  if (tool !== 'Bash' && tool !== 'PowerShell') return false;
  const cmd = String((input && input.command) || '').trim().replace(/\s+/g, ' ');
  if (!cmd || /[;&|<>`$(){}\n\\]/.test(cmd)) return false;
  return SAFE_EXACT.concat(extra || []).includes(cmd);
}

// ─── What HQ-started jobs may do (Claude Code "dontAsk" mode: everything else is refused) ──
const JOB_ALLOW = [
  'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'Task', 'WebSearch', 'WebFetch', 'NotebookEdit',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)', 'Bash(git add *)', 'Bash(git commit *)',
  'Bash(git merge *)', 'Bash(git fetch*)', 'Bash(git pull*)', 'Bash(git push)', 'Bash(git push origin work-*)', 'Bash(git push -u origin work-*)',
  'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git branch*)', 'Bash(git rev-parse*)', 'Bash(git grep *)', 'Bash(git ls-files*)',
  'Bash(npx tsc*)', 'Bash(npm test*)', 'Bash(npm run test*)', 'Bash(npm run lint*)', 'Bash(npx jest*)', 'Bash(npx playwright*)',
  'Bash(npx expo-doctor*)', 'Bash(npx expo install *)', 'Bash(npm install*)', 'Bash(npm ls*)', 'Bash(node *)', 'Bash(ls*)', 'Bash(dir*)',
];
// Never, in any mode. Deny rules beat allow rules.
const JOB_DENY = [
  'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push * --force*)', 'Bash(git push * -f*)', 'Bash(git push origin overnight-build*)',
  'Bash(git push origin main*)', 'Bash(git push origin master*)', 'Bash(git reset --hard*)', 'Bash(git clean*)', 'Bash(git checkout -- *)',
  'Bash(git branch -D*)', 'Bash(git stash drop*)', 'Bash(git stash clear*)', 'Bash(rm -rf*)', 'Bash(rm -r *)', 'Bash(del /s*)', 'Bash(rmdir*)',
  'Bash(gh workflow run*)', 'Bash(gh run rerun*)', 'Bash(eas build*)', 'Bash(npx eas*)', 'Bash(eas submit*)',
];

// ─── The prompt every Watchdog fix job ends with ────────────────────────────
function jobRules(branch) {
  return `\n\nRules for this job:\n- Work only on your branch (${branch}). Never push to overnight-build, main or master.\n- Never start iOS builds (no gh workflow run, no eas build). HQ starts builds itself.\n- Never force push, reset, clean, or delete anyone's work.\n- Check your work with npx tsc --noEmit before you commit.\n- Commit with a clear message and push your branch.\n- End with one line that starts with HQ: and says in plain words what you did.`;
}

module.exports = { BUILD_RULES, classifyBuild, parseLimit, MARKER_RE, MARKER_GREP, tscErrors, newErrors, safeToApprove, SAFE_EXACT, JOB_ALLOW, JOB_DENY, jobRules };
