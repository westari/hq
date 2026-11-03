// HQ-LIVE — connects the city design to the real HQ engine (server.js).
// The design (HQ.dc.html) only needs two small hooks, marked "HQ-LIVE".
// Everything that turns real data into the design's shapes lives here,
// so you can redesign the city in Claude Design without losing the wiring.
(function () {
  const STATUS = { working: 'working', 'needs-you': 'needs', idle: 'idle', ended: 'idle', limit: 'idle' };
  const letter = (name) => { const m = /window\s+([a-z0-9])/i.exec(name || ''); return m ? m[1].toUpperCase() : (name || '?')[0].toUpperCase(); };
  const firstLine = (t) => String(t || '').trim().split('\n').find((l) => l.trim()) || '';
  const short = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  function actKind(text) {
    if (/^Reading/.test(text)) return ['Read', 'read'];
    if (/^Searching/.test(text)) return ['Search', 'read'];
    if (/^(Editing|Writing)/.test(text)) return ['Edit', 'edit'];
    if (/^(Running|Committing|Pushing|Installing)/.test(text)) return ['Run', 'run'];
    return ['Think', 'think'];
  }

  // Turn Claude Code's long final message into 1-2 plain sentences.
  // Best: Claude ends with a line "HQ: <one sentence>" (see CLAUDE.md). Otherwise: its first sentences.
  const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\*\*|__|^#+\s*/gm, '').replace(/^\s*[-*\d.]+\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  function shortTitle(prompt) {
    const clean = String(prompt || '').replace(/\[(Pasted text|Image)[^\]]*\]/gi, ' ').replace(/[#*_>`~|{}\[\]<>]+/g, ' ');
    // First real sentence (3+ words). Skips things like "FormPal." or "Window A:".
    const sentences = plain(clean).replace(/(?:[A-Za-z]:)?(?:[\\/][\w .-]+)+[\\/]([\w.-]+)/g, '$1').split(/(?<=[.!?:])\s+|\n/).map((x) => x.replace(/[.!?:]+$/, '').replace(/^(please|ok|okay|hey|so|now|also)[, ]+/i, '').trim());
    // Prompts like "1. TRAIN TAB ... 2. PROGRESS ..." -> "Fix Train tab, Progress, Profile".
    const labels = [...String(prompt || '').matchAll(/^\s*\d+[.)]\s+([A-Z][A-Z0-9 '&/-]{2,40}?)(?::|\s{2}|\s*$|\s+[a-z(])/gm)].map((m) => m[1].trim().toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));
    if (labels.length >= 2) { const t0 = 'Fix ' + labels.slice(0, 5).join(', '); return t0.length > 140 ? t0.slice(0, 138) + '\u2026' : t0; }
    const BORING = /^(i (just )?tested|i'?m testing|fix all of this|read my|my latest logs|here('| i)s|update|continue|thanks|thank you)/i;
    let t = sentences.find((x) => !BORING.test(x) && x.split(' ').filter((w) => /[a-z]{2}/i.test(w)).length >= 2) || sentences.find((x) => x.split(' ').length >= 2) || '';
    if (!t) return 'Your prompt';
    return t.length > 140 ? t.slice(0, 138).replace(/\s+\S*$/, '') + '…' : t;
  }
  // Your messages without "[Pasted text #1 +40 lines]", <pasted ...> tags, or long ID strings.
  function cleanYou(t) {
    return String(t || '')
      .replace(/\[(Pasted (text|content)|Image)[^\]]*\]/gi, '')
      .replace(/<\/?pasted[^>]*>/gi, '')
      .replace(/^\s*pasted[ _-]?(text|content)\b.*$/gim, '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function summarize(reply, title) {
    const hq = /^\s*\**HQ:\**\s*(.+)$/im.exec(reply || '');
    if (hq) return short(plain(hq[1]), 160);
    if (title) return 'Finished: ' + title;
    // Paths like C:\Users\arize\hq\plan.json become just plan.json.
    const p = plain(reply).replace(/(?:[A-Za-z]:)?(?:[\\/][\w .-]+)+[\\/]([\w.-]+)/g, '$1').replace(/\s+/g, ' ');
    const sentences = (p.match(/[^.!?]+[.!?]+/g) || [p]).map((x) => x.trim())
      .filter((x) => x.split(' ').length >= 4 && !/^(here|summary|done|ok|okay)\b[^a-z]*$/i.test(x));
    let out = '';
    for (const x of sentences) { if ((out + x).length > 200) break; out += x; }
    return short(out || p, 200);
  }
  function mapSession(s, now) {
    const id = letter(s.window);
    const hasTests = (s.tests || []).length > 0;
    const status = s.status === 'done' ? (hasTests ? 'testing' : 'done') : (STATUS[s.status] || 'idle');
    const todos = s.todos || [];
    const finished = status === 'done' || status === 'testing';
    const steps = todos.map((t) => ({ t: t.text, s: t.status === 'completed' || finished ? 'done' : t.status === 'in_progress' ? (status === 'needs' ? 'blocked' : 'doing') : 'todo' }));
    if (finished && !steps.length) steps.push({ t: 'Done', s: 'done' });
    let cur = steps.findIndex((x) => x.s === 'doing' || x.s === 'blocked');
    if (cur < 0) cur = steps.filter((x) => x.s === 'done').length;
    const title = s.jobLine || s.title || shortTitle(s.prompt) || 'No job yet';
    const fileMatch = /(Editing|Writing|Reading)\s+(\S+)/.exec(s.doing || '');
    const timeline = (s.actions || []).map((a, i) => { const [k, pose] = actKind(a.text); return { k, label: a.text, pose, id: id + '-' + (s.actions.length - i), at: a.t }; });
    const nowStep = steps.find((x) => x.s === 'doing' || x.s === 'blocked');
    const doneN = steps.filter((x) => x.s === 'done').length;
    const working = status === 'working' || status === 'needs';
    const summary = working
      ? title + '.' + (nowStep ? ' Step ' + (doneN + 1) + ' of ' + steps.length + ': ' + nowStep.t + '.' : '')
      : s.lastReply ? summarize(s.lastReply, title) : 'Nothing right now. It’s free for a new job.';
    return {
      id, name: s.window, project: s.project, status, steps, cur, partial: status === 'working' ? 0.5 : 0,
      action: s.doing || (status === 'idle' ? 'Waiting for a job' : 'Thinking'),
      timeline: timeline.length ? timeline : [{ k: 'Think', label: s.doing || 'Waiting', pose: 'think', id: id + '-0', at: s.lastEvent }],
      started: s.jobStart || s.lastEvent, doneAt: s.status === 'done' ? s.lastEvent : null, since: 0, actIdx: 0, seq: timeline.length,
      job: { title, item: null, explain: summary, checks: s.tests || [], steps: steps.map((x) => x.t), file: fileMatch ? fileMatch[2] : 'App',
        doneLabel: hasTests ? 'Waiting for you to test' : 'Finished', waitLabel: s.doing || 'Needs you', question: s.doing || 'Check VS Code', pool: [], secs: 30 },
      _raw: s,
    };
  }

  function mapEvents(activity) {
    const kindOf = (t) => /needs/i.test(t) ? 'needs' : /ready to test/i.test(t) ? 'testing' : /finished|passed/i.test(t) ? 'done' : /started|queued/i.test(t) ? 'working' : 'working';
    return activity.map((e, i) => ({ id: 'le' + i + '-' + e.t, who: e.session, kind: kindOf(e.text), job: e.job || e.text, project: e.project, at: e.t }));
  }

  function mapProjects(projects, known) {
    const out = {};
    // The design always expects exactly 3 groups: Blocking, Should ship, Later.
    const three = (sections, fallback) => {
      const g = [{ title: 'Blocking', items: [] }, { title: 'Should ship', items: [] }, { title: 'Later', items: [] }];
      for (const sec of sections) {
        const i = /should/i.test(sec.name) ? 1 : /later|nice|after|v1\.1|1\.1/i.test(sec.name) ? 2 : 0;
        for (const it of sec.items) g[i].items.push({ t: it.text, done: it.done, by: null });
      }
      if (!g.some((x) => x.items.length)) g[0].items.push({ t: fallback, done: false, by: null });
      return g;
    };
    for (const p of projects) {
      const c = p.checklist;
      out[p.name] = three(c && !c.missing ? c.sections : [], 'Ask a window to create LAUNCH.md for ' + p.name);
    }
    for (const k of known) if (!out[k]) out[k] = three([], 'Add ' + k + ' to hq.config.json');
    return out;
  }

  // The launch tower for your plan's project comes from plan.json (always 3 groups).
  function withPlan(projects, plan) {
    if (!plan || !plan.tasks) return projects;
    const g = ['Blocking', 'Should ship', 'Later'].map((title) => ({ title, items: plan.tasks.filter((t) => (t.group || 'Blocking') === title).map((t) => ({ t: t.t, done: t.done, by: null })) }));
    g.forEach((x) => { if (!x.items.length) x.items.push({ t: 'Nothing here', done: true, by: null }); });
    return { ...projects, [plan.project]: g };
  }

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

  function connect(c) {
    let last = null;
    const knownProjects = Object.keys(c.state.projects || {});
    // Mute button in the top bar (preload.js) talks to us through a data attribute.
    // Mute = no talking and no chimes at all (remembered after restarts). Windows pop-ups still show, silently.
    const isMuted = () => c.state.sound === false;
    const syncSound = () => { document.documentElement.dataset.hqSound = isMuted() ? '0' : '1'; try { localStorage.setItem('hq-muted', isMuted() ? '1' : '0'); } catch (e) {} if (isMuted() && window.__hqAudio) { try { window.__hqAudio.pause(); } catch (e) {} } };
    try { if (localStorage.getItem('hq-muted') === '1') c.setState({ sound: false }); } catch (e) {}
    window.addEventListener('hq-toggle-sound', () => { c.setState({ sound: isMuted() }, () => { syncSound(); c.toast(isMuted() ? 'Muted. HQ won\u2019t talk.' : 'Sound on', isMuted() ? 'volume_off' : 'volume_up'); }); });
    setInterval(syncSound, 1000);
    c.setState({ live: true, runs: [], events: [], tests: [], chat: {}, jobQ: {}, usage: 0, resetAt: Date.now() });

    // ── Real actions replace the demo ones ──
    const winName = (id) => { const s = (c.state.sessions || []).find((x) => x.id === id); return s ? s.name : 'Window ' + id; };
    async function queue(id, text, label, title) {
      const t = String(text || '').trim(); if (!t) return;
      const r = await post('/api/queue', { window: winName(id), text: t, title: title || '' });
      if (r.started) c.toast(winName(id) + ' started working on it.', 'play_arrow');
      else if (r.queued) c.toast(winName(id) + ' is busy. It starts this the second it finishes.', 'playlist_add');
      else if (r.copy) { const ok = await copy(r.text); c.toast(ok ? 'Copied. Paste it into ' + winName(id) + ' in VS Code.' : 'Could not copy. Open Output to copy it.', 'content_paste'); }
      else c.toast(r.error || 'Could not send', 'error');
    }
    c.queueJob = (id, text) => queue(id, text);
    const planTask = (title) => ((last && last.plan && last.plan.tasks) || []).find((t) => t.t === title);
    c.assign = (id, item) => { const t = planTask(item); queue(id, t && t.prompt ? t.prompt : item, null, t ? t.t : ''); };
    c.send = (id, text, kind) => {
      const t = kind === 'shot' ? 'Take a Playwright screenshot of the screen you are working on and save it in the project.' : kind === 'explain' ? 'In 2 plain sentences: what are you doing right now and why?' : text;
      queue(id, t);
    };
    c.approve = (id) => c.toast('Answer it in ' + winName(id) + ' in VS Code.', 'front_hand');
    c.passTest = async (tid) => {
      const t = (c.state.tests || []).find((x) => x.id === tid); if (!t) return;
      await post('/api/tests/pass', { window: t.from }); c.toast(t.title + ' marked as working', 'thumb_up');
    };
    c.sendFeedback = async (tid, text) => {
      const t = (c.state.tests || []).find((x) => x.id === tid); if (!t) return;
      const msg = 'I tested "' + t.title + '" on my phone.\n\nWhat\'s wrong:\n' + (String(text || '').trim() || 'It didn\'t work.') + '\n\nReproduce it first, fix it, prove it, then commit and push. Give me ONE short list to test.';
      c.setState({ fbOpen: null });
      queue(t.win, msg, 'Feedback queued for ');
    };

    async function copyFix(prompt) { if (await copy(prompt)) c.toast('Fix prompt copied. Paste it into Window A in VS Code.', 'content_copy'); }
    async function mergeNow() {
      c.toast('Merging…', 'merge');
      const r = await post('/api/merge', {});
      const plain = { conflict: 'Both windows changed the same lines. The Watchdog asked the window to combine them.', markers: 'That branch has broken merge lines. The Watchdog asked the window to fix them.', types: 'That work would add code errors. The Watchdog sent them to the window.', dirty: 'Your app folder has unsaved changes, so HQ didn’t touch it. See the Watchdog.', wrongbranch: r.text };
      if (r.ok) c.toast((r.steps || []).join(' · ') + '.', 'done_all');
      else c.toast(plain[r.error] || ('Merge stopped: ' + (r.text || r.error)), 'warning');
    }
    // Start the iOS build on GitHub from HQ.
    async function startBuild() {
      c.toast('Starting your iOS build\u2026', 'rocket_launch');
      const r = await post('/api/build', {});
      if (r.started) c.toast('iOS build started on ' + r.ref + '. HQ tells you when it\u2019s done.', 'rocket_launch');
      else if (r.error === 'nogh') c.toast('Install GitHub CLI first (see HQ README)', 'error');
      else c.toast('Build didn\u2019t start: ' + r.error, 'error');
    }
    // Test buttons: go straight into Test Lab (open it right away, the UFO still flies there).
    const origOpenB = c.openBuilding.bind(c);
    c.openBuilding = (k) => { origOpenB(k); if (k === 'lab') setTimeout(() => { if (c.state.bld === 'lab') c.setState({ bldOpen: true }); }, 1200); };
    // ── Pulse: swap the design's sample numbers for real ones ──
    const origVals = c.renderVals.bind(c);
    const fmtT = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
    const freeWindow = () => (c.state.sessions || []).find((s) => s.status === 'idle' || s.status === 'done' || s.status === 'testing') || (c.state.sessions || [])[0];
    c.renderVals = function () {
      const v = origVals();
      const pu = v && v.pu; if (!pu || !last) return v;
      const u = last.usage || {};
      pu.pct = u.pct || 0;
      pu.reset = u.resetAt ? fmtT(u.resetAt) : 'when you start';
      const left = Math.max(0, (u.limit || 0) - (u.tokens || 0));
      pu.pace = u.resetAt && left <= 0 ? (u.guessed ? 'Your busiest 5 hours yet' : 'Limit reached') : !u.resetAt ? 'No Claude use in the last 5 hours' : !u.perMin ? 'Idle right now' : (left / u.perMin) > (u.resetAt - Date.now()) / 60000 ? 'You’ll make it to the reset' : 'At this pace, limit at ' + fmtT(Date.now() + (left / u.perMin) * 60000);
      const byW = u.byWindow || {};
      pu.wins = (pu.wins || []).map((w) => ({ ...w, pct: u.limit ? Math.round(((byW[w.name] || 0) / u.limit) * 100) : 0 }));
      const builds = (last.runs || []).slice(0, 3);
      pu.builds = builds.length ? builds.map((r) => ({
        name: r.wf + (r.br ? ' · ' + r.br : ''), sub: ago(r.at) + ' · GitHub',
        status: r.st === 'running' ? 'Building' : r.st === 'done' ? 'Built' : 'Failed',
        icon: r.st === 'running' ? 'progress_activity' : r.st === 'done' ? 'check_circle' : 'error',
        ic: r.st === 'done' ? '#9ee2bd' : r.st === 'failed' ? 'oklch(0.78 0.16 30)' : 'rgba(255,255,255,0.7)',
        anim: r.st === 'running' ? 'hq-breathe 1.2s ease-in-out infinite' : 'none' }))
        : [{ name: 'No builds yet', sub: 'Builds from GitHub show here', status: '', icon: 'history', ic: 'rgba(255,255,255,0.7)', anim: 'none' }];
      pu.upload = startBuild;
      const lg = last.logs || {}; const n = lg.errorCount || 0; const fw = freeWindow();
      pu.crashFree = n ? n + (n === 1 ? ' error' : ' errors') : 'No errors';
      pu.crash = n ? 'In your last test log: ' + String((lg.errors || [])[0] || '').slice(0, 120) : lg.file ? 'Your last test log is clean.' : 'Start the app with npm run dev to log tests.';
      pu.hasCrash = n > 0 && !!fw;
      pu.fixLabel = fw ? 'Send to ' + fw.name : '';
      pu.fixCrash = () => { if (fw) queue(fw.id, 'My last test log has errors. Find them in the attached log, reproduce, fix, prove it, then commit and push. Give me ONE short list to test.'); };
      const merges = last.merges || [];
      pu.branches = (pu.branches || []).map((b) => {
        const m = merges.find((x) => x.window === b.name);
        if (!m) return { ...b, branch: '–', add: 0, del: 0, meta: 'No branch', cta: 'Output', icon: 'terminal', go: () => drawer.open(b.name) };
        const ready = m.ahead > 0;
        return { ...b, branch: m.branch, add: m.add || 0, del: m.del || 0,
          meta: ready ? m.ahead + ' new change' + (m.ahead === 1 ? '' : 's') + ' not in your app yet' : '✓ Everything is in your app',
          cta: ready ? 'Merge now' : 'Merged', icon: ready ? 'merge' : 'done_all',
          bg: ready ? '#ffffff' : 'rgba(255,255,255,0.14)', fg: ready ? '#1d2128' : '#ffffff',
          go: () => { if (ready) mergeNow(); } };
      });
      // ── Ari: Do now, Next up, Good to know, Today's goals — from your plan ──
      const plan = last.plan;
      const dayName = (k) => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); const t = new Date(); t.setHours(0, 0, 0, 0); const n = Math.round((dt - t) / 86400000); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : dt.toLocaleDateString([], { weekday: 'long' }); };
      const shortDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
      const WHO = { you: 'person', ai: 'smart_toy', dad: 'escalator_warning' };
      const fw2 = freeWindow();
      const setDone = (id, done) => post('/api/plan/done', { id, done });
      const taskBtn = (t) => t.who === 'ai' && fw2 ? { hasBtn: true, btn: 'Send to ' + fw2.name, go: () => { queue(fw2.id, t.prompt || t.t, null, t.t); } }
        : t.who === 'ai' ? { hasBtn: true, btn: 'Copy prompt', go: async () => { const ok = await copy(t.prompt || t.t); c.toast(ok ? 'Prompt copied' : 'Could not copy', 'content_copy'); } }
        : { hasBtn: true, btn: 'Done', go: () => setDone(t.id, true) };
      const firstSentence = (t) => { t = String(t || '').trim(); const m = /^(.+?[.!?])(\s|$)/.exec(t); t = m ? m[1] : t; return t.length > 80 ? t.slice(0, 78).trim() + '…' : t; };
      const taskRow = (t, when) => {
        const who = t.who === 'dad' ? 'Needs Dad' : t.who === 'ai' ? 'AI job' : '';
        const sub = [when, who, firstSentence(t.sub)].filter(Boolean).join(' · ');
        const b = t.who === 'ai' ? taskBtn(t) : { hasBtn: false, btn: '', go: () => {} };
        return { icon: WHO[t.who] || 'flag', t: t.t, sub, ...b, toggleOpen: () => card.open(t) };
      };
      if (plan && v.ari && v.ariOn) {
        const A = v.ari;
        const today = plan.todayTasks || [];
        const dn = today.filter((t) => t.done).length;
        A.todos = today.map((t) => ({ t: (t.who === 'ai' ? 'AI: ' : '') + t.t, op: t.done ? 0.45 : 1, bg: t.done ? '#ffffff' : 'transparent', bd: t.done ? '0' : '1.5px solid rgba(255,255,255,0.6)', glyph: t.done ? '✓' : '', toggle: () => setDone(t.id, !t.done) }));
        A.goalsLabel = dn + ' of ' + today.length + ' done'; A.goalsPct = today.length ? Math.round((dn / today.length) * 100) : 0;
        const add = () => { const el = c.ariInput && c.ariInput.current; const val = el && el.value.trim(); if (!val) return; post('/api/plan/add', { text: val }); el.value = ''; };
        A.add = add; A.key = (e) => { if (e.key === 'Enter') add(); };
        const firstOpen = today.find((t) => !t.done && t.group !== 'Extra');
        if (firstOpen) A.doNow = [...A.doNow, taskRow(firstOpen, '')];
        A.doN = String(A.doNow.length); A.noDo = !A.doNow.length;
        A.next = (plan.next || []).slice(0, 4).map((t) => { const d = dayName(t.day); return taskRow(t, d === 'Tomorrow' || d === 'Today' ? '' : d); });
        const Y = last.yesterday;
        const yRow = Y && (Y.commits.length || Y.tasks.length) ? [{ icon: 'history', t: 'Yesterday: ' + Y.commits.length + ' changes, ' + Y.tasks.length + ' tasks done', sub: 'Click to see everything', toggleOpen: () => card.info('Yesterday on ' + plan.project, [
            ...(Y.tasks.length ? [{ h: 'Tasks you finished', items: Y.tasks }] : []),
            ...(Y.commits.length ? [{ h: 'What changed in the app (' + Y.commits.length + ')', items: Y.commits }] : []),
          ]) }] : [{ icon: 'history', t: 'Yesterday: nothing logged', sub: 'No app changes or finished tasks yesterday' }];
        A.important = [...yRow,
          { icon: 'rocket_launch', t: plan.daysToLaunch + ' days to launch', sub: plan.project + ' on the App Store ' + shortDate(plan.launch) + '. Dad submits ' + shortDate(plan.submitBy) + '.' },
          plan.behind ? { icon: 'warning', t: 'You’re behind', sub: 'Every day until ' + shortDate(plan.submitBy) + ' got ' + Math.round((plan.squeeze - 1) * 100) + '% heavier so you still make it.' }
                      : { icon: 'check_circle', t: 'On track', sub: 'Skip a day and HQ moves the work to the next days.' },
          { icon: 'data_usage', t: 'Claude usage ' + pu.pct + '%', sub: 'Resets ' + pu.reset + '. ' + pu.pace + '.' },
          { icon: 'flag', t: plan.tasks.filter((t) => !t.done && t.group === 'Blocking').length + ' launch tasks left', sub: plan.tasks.filter((t) => t.done).length + ' done so far' },
        ];
      }
      // Launch tower: checking an item really marks it done.
      if (plan && v.pr && v.pr.block) v.pr.block = v.pr.block.map((it) => { const t = plan.tasks.find((x) => x.t === it.t); return t ? { ...it, toggle: () => setDone(t.id, !t.done) } : it; });
      // Social: no fake numbers. Not connected yet.
      if (v.so) {
        v.so.accounts = (v.so.accounts || []).map((a) => ({ ...a, count: '–', delta: 'Not connected', spark: (a.spark || []).map(() => ({ h: 8, o: 0.3 })) }));
        v.so.total = '–'; v.so.top = 'No posts yet. Make your first slideshows from the ideas list.';
      }
      // Merge: always visible in Do now when your phone would run old code.
      if (v.ari && v.ariOn && last.mergeState) {
        const M = last.mergeState; const behind = (M.list || []).filter((m) => m.ahead > 0);
        const autoErr = null;
        const mergeRow = autoErr ? autoErr : M.stuck ? { icon: 'warning', t: 'Your merge is stuck', sub: M.conflicts && M.conflicts.length ? 'Conflict in ' + M.conflicts.join(', ') + '. Paste this to Claude.' : 'Your phone runs old code until it’s finished.', hasBtn: !(M.conflicts && M.conflicts.length), btn: 'Fix and merge', go: mergeNow }
          : behind.length ? { icon: 'merge', t: 'Merge ' + behind.map((m) => m.window).join(' and '), sub: 'Your phone runs old code until you merge.', hasBtn: true, btn: 'Merge now', go: mergeNow } : null;
        if (mergeRow) { v.ari.doNow = [{ ...mergeRow, toggleOpen: () => {} }, ...(v.ari.doNow || []).filter((d) => !/^Merge /.test(d.t))]; v.ari.doN = String(v.ari.doNow.length); v.ari.noDo = false; }
      }
      // Working = spinning ring. Anything else = the normal dot.
      if (v.cards) v.cards = v.cards.map((cd) => {
        const working = cd.label === 'Working';
        return { ...cd, dotSize: working ? 12 : 7, dotInset: working ? 2.5 : 0, dotBg: working ? `conic-gradient(${cd.color} 0 70%, rgba(255,255,255,0.18) 0)` : cd.color,
          dotSpin: working ? 'hqspin .9s linear infinite' : 'none', dotHole: working ? 'rgba(22,26,30,0.75)' : cd.color, ping: working ? 'none' : cd.ping };
      });
      // Design rows (merge, test...) open their own thing when clicked; buttons don't double-fire.
      if (v.ari && v.ariOn) {
        const wrap = (it) => { const go = it.go; return { ...it, go: (e) => { if (e && e.stopPropagation) e.stopPropagation(); go && go(e); }, toggleOpen: it.toggleOpen || (() => go && go()) }; };
        v.ari.doNow = (v.ari.doNow || []).map(wrap);
        v.ari.next = (v.ari.next || []).map(wrap);
        v.ari.important = (v.ari.important || []).map((it) => ({ ...it, toggleOpen: it.toggleOpen || (() => {}) }));
      }
      // Factory: your iOS builds in plain words. The Watchdog decides when a build is needed and what a failure means.
      if (v.bp && v.bp.name === 'Factory') {
        const base = { hasChip: false, chipT: '', chipC: '', chipA: 'none', hasChecks: false, checks: [], hasCmds: false, cmds: [], bg: 'rgba(255,255,255,0.14)', fg: '#ffffff', icon: '', hasBtn: false, btn: '', go: () => {} };
        const W = last.watchdog || {}; const Bd = W.build || {}; const runs = last.runs || []; const running = runs.find((r) => r.st === 'running');
        const tm2 = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const L = [];
        L.push(running ? { ...base, t: 'Building now', sub: 'Started ' + tm2(running.at) + '. Takes about 20–30 minutes. HQ tells you when it’s done.', hasChip: true, chipT: 'Building', chipC: '#ffcf70' }
          : Bd.needBuild ? { ...base, t: 'A new build is needed', sub: 'The part of the app that needs a build changed. HQ starts it by itself once the code is ready.', hasChip: true, chipT: 'Needed', chipC: '#ffcf70', hasBtn: true, btn: 'Start it now', icon: 'rocket_launch', bg: '#ffffff', fg: '#1d2128', go: startBuild }
          : { ...base, t: 'No build needed', sub: 'Your changes reach your phone without one: just reload the app. HQ builds by itself when it’s really needed.', hasChip: true, chipT: 'Up to date', chipC: '#8fe3b4', hasBtn: true, btn: 'Build anyway', icon: 'rocket_launch', go: startBuild });
        runs.slice(0, 4).forEach((r) => L.push({ ...base, t: r.st === 'done' ? '✓ Built' : r.st === 'failed' ? '✕ Failed' : '● Building', sub: tm2(r.at) + (r.st === 'failed' ? ' · ' + (Bd.lastFail && Bd.lastFail.id === r.id ? Bd.lastFail.title : (r.note || '')).slice(0, 90) : r.st === 'done' ? ' · install it from Expo on your phone' : '') }));
        v.bp.L = { title: 'iOS builds', icon: 'deployed_code', hv: String(runs.filter((r) => r.st === 'done').length), hl: 'built', items: L, empty: false };
        const F = Bd.lastFail;
        if (F) {
          v.bp.hasR = true;
          v.bp.R = { title: 'Last problem', icon: 'build', hv: '1', hl: F.who === 'you' ? 'needs you' : 'HQ is on it', empty: false, items: [
            { ...base, t: F.title, sub: F.plain, hasChip: true, chipT: F.who === 'you' ? 'Needs you or Dad' : 'HQ is fixing it', chipC: F.who === 'you' ? '#ff9a8a' : '#8fe3b4' },
            { ...base, t: 'What HQ is doing', sub: F.doing, hasBtn: true, btn: F.who === 'you' ? 'Show me what to do' : 'See the error', icon: 'help', bg: '#ffffff', fg: '#1d2128',
              go: () => card.need({ title: F.title, level: F.who === 'you' ? 'urgent' : 'warn', text: F.plain + ' ' + F.doing, steps: F.steps, lines: F.lines }) }] };
        } else v.bp.hasR = false;
      }
      // Content building (was the Ideas building): your slideshow bot.
      if (v.mapTowers) v.mapTowers = v.mapTowers.map((t) => (t.short === 'Ideas' ? { ...t, short: 'Content', name: 'Content' } : t));
      if (v.bp && v.bp.name === 'Idea Vault') {
        const C = (last && last.content) || { shows: [], templates: [], usage: {}, pictures: {}, assets: {} };
        const base = { hasChip: false, chipT: '', chipC: '', chipA: 'none', hasChecks: false, checks: [], hasCmds: false, cmds: [], bg: '#ffffff', fg: '#1d2128', icon: '', hasBtn: false, btn: '', go: () => {} };
        const items = [];
        const A2 = C.assets || {};
        const setup = [['Writing', C.hasKey, () => card.keyBox()], ['Pictures', C.hasPictures, () => card.cfBox()], ['App screenshot', !!A2.screenshot, () => card.assetBox()]];
        const todo = setup.find((x) => !x[1]);
        if (todo) items.push({ ...base, t: 'Set up (once, about 3 minutes)', sub: setup.map((x) => (x[1] ? '✓ ' : '○ ') + x[0]).join('   ') + '. Next: ' + { Writing: 'add your free Gemini key (it writes the words).', Pictures: 'turn on free pictures (Cloudflare makes them).', 'App screenshot': 'add a screenshot of FormPal (one app screen, not your logo).' }[todo[0]],
          hasBtn: true, btn: 'Do the next step', icon: 'checklist', go: todo[2] });
        if (C.hasKey) items.push({ ...base, t: 'Make a TikTok slideshow', sub: 'Type what it’s about (like “leg day”). HQ writes it, makes the pictures and builds all 3 slides. You check the words first.', hasBtn: true, btn: 'Make one', icon: 'add', go: () => card.newShow() });
        const P = C.pictures || {};
        if (C.hasPictures) items.push({ ...base, t: 'Free pictures left today: about ' + (P.postsLeft || 0) + ' posts', sub: P.limitHit ? 'Used up for today. More at 7 pm. Nothing is charged.' : (P.images || 0) + ' pictures made today. Resets at 7 pm.' });
        if (C.error) items.push({ ...base, t: 'Last problem', sub: C.error });
        for (const sh of C.shows || []) {
          const v2 = sh.v === 2; const im = sh.images || {}; const n = v2 ? 1 + sh.spec.steps.length : sh.slides.length;
          const pics = v2 ? Object.values(im).filter((x) => x && x.file).length : sh.slides.filter((x) => x.img).length;
          const map = {
            draft: ['Check the words, then make the pictures', 'Check', () => card.draftEditor(sh)],
            making: ['Making pictures: ' + pics + ' of ' + n, 'View', () => card.slides(sh)],
            layout: ['Putting the slides together…', 'View', () => card.slides(sh)],
            text: ['Putting the slides together…', 'View', () => card.slides(sh)],
            partial: ['Some pictures failed: ' + pics + ' of ' + n, 'Fix', () => card.slides(sh)],
            stopped: ['Paused: ' + pics + ' of ' + n + ' pictures', 'Fix', () => card.slides(sh)],
            limit: ['Paused: free limit hit', 'View', () => card.slides(sh)],
            ready: ['Ready to post · ' + (v2 ? 3 : n) + ' slides', 'View', () => card.slides(sh)],
          }[sh.status] || ['', 'View', () => card.slides(sh)];
          items.push({ ...base, t: sh.title, sub: map[0], hasBtn: true, btn: map[1], icon: 'slideshow', bg: 'rgba(255,255,255,0.14)', fg: '#ffffff', go: map[2] });
        }
        v.bp.name = 'Content'; v.bp.icon = 'slideshow';
        v.bp.L = { title: 'Slideshows', icon: 'slideshow', hv: String((C.shows || []).filter((x) => x.status === 'ready').length), hl: 'slideshows ready to post', items, empty: false };
      }
      // Watchdog building (was the Shipping Dock): what needs you, and everything it did by itself.
      if (v.mapTowers) v.mapTowers = v.mapTowers.map((t) => (t.short === 'Dock' ? { ...t, short: 'Watchdog', name: 'Watchdog' } : t));
      if (v.bp && v.bp.name === 'Shipping Dock') {
        const W = (last && last.watchdog) || { needs: [], log: [] };
        const base = { hasChip: false, chipT: '', chipC: '', chipA: 'none', hasChecks: false, checks: [], hasCmds: false, cmds: [], bg: '#ffffff', fg: '#1d2128', icon: '', hasBtn: false, btn: '', go: () => {} };
        const wd = (name, arg) => () => post('/api/watchdog', { name, arg }).then((r) => c.toast(r.ok ? 'Done' : (r.error || 'Didn’t work'), r.ok ? 'done' : 'error'));
        const L = [];
        const sinceTick = W.lastTick ? Math.round((Date.now() - W.lastTick) / 1000) : null;
        L.push({ ...base, t: W.paused ? 'Paused' : W.acting ? 'Watching and fixing' : 'Watch only', sub: W.paused ? W.paused.why : (W.acting ? 'Checks your windows, merges and builds every 20 seconds, and fixes what it safely can.' : 'It only writes down what it WOULD do. Nothing is changed.') + (sinceTick !== null ? ' Last check: ' + (sinceTick < 60 ? sinceTick + ' s ago' : Math.round(sinceTick / 60) + ' min ago') + '.' : ''),
          hasChip: true, chipT: W.paused ? 'Paused' : W.acting ? 'On' : 'Watching', chipC: W.paused ? '#ffcf70' : W.acting ? '#8fe3b4' : 'rgba(255,255,255,.6)', chipA: 'none',
          hasBtn: true, btn: W.paused ? 'Turn back on' : W.acting ? 'Switch to watch only' : 'Let it fix things', icon: W.paused ? 'play_arrow' : W.acting ? 'visibility' : 'build', bg: 'rgba(255,255,255,0.14)', fg: '#ffffff', go: W.paused ? wd('unpause') : wd('mode', W.acting ? 'watch' : 'act') });
        for (const n of W.needs || []) L.push({ ...base, t: n.title, sub: n.text, hasChip: true, chipT: n.level === 'urgent' ? 'Important' : 'Needs you', chipC: n.level === 'urgent' ? '#ff9a8a' : '#ffcf70', chipA: 'none',
          hasBtn: true, btn: n.button && !(n.steps || n.code) ? n.button.label : 'Show me how', icon: n.button && !(n.steps || n.code) ? 'bolt' : 'help', go: n.button && !(n.steps || n.code) ? wd(n.button.action, n.button.arg) : () => card.need(n) });
        for (const fx of W.fixing || []) L.push({ ...base, t: fx.title, sub: fx.text, hasChip: true, chipT: 'HQ is fixing it', chipC: '#8fe3b4', chipA: 'none', bg: 'rgba(255,255,255,0.14)', fg: '#ffffff' });
        if (!(W.needs || []).length && !(W.fixing || []).length) L.push({ ...base, t: 'All good', sub: 'Nothing needs you. You don\u2019t have to open this tower: HQ tells you out loud when something needs you.', hasChip: true, chipT: '\u2713', chipC: '#8fe3b4', chipA: 'none', bg: 'rgba(255,255,255,0.14)', fg: '#ffffff' });
        const ph = W.phone || {};
        L.push({ ...base, t: 'Your phone', sub: ph.text || 'Checking…', hasChip: true, chipT: ph.ready ? 'Ready to test' : ph.metro ? 'App server on' : 'App server off', chipC: ph.ready ? '#8fe3b4' : 'rgba(255,255,255,.6)', chipA: 'none',
          hasBtn: ph.step === 'install', btn: 'I installed it', icon: 'install_mobile', go: wd('installed') });
        const Bd = W.build || {};
        L.push({ ...base, t: 'Builds', sub: (Bd.needBuild ? 'The native part changed since your last build. ' : 'No new build needed: changes reach your phone with a reload. ') + `Automatic builds today: ${Bd.autoToday || 0} of ${Bd.max || 6}.` + (Bd.resting ? ' Resting after 3 failures.' : ''),
          hasBtn: !!Bd.resting, btn: 'Start trying again', icon: 'restart_alt', bg: 'rgba(255,255,255,0.14)', fg: '#ffffff', go: wd('resetbreakers') });
        v.bp.name = 'Watchdog'; v.bp.icon = 'shield';
        v.bp.L = { title: 'Needs you', icon: 'shield', hv: String((W.needs || []).length), hl: (W.needs || []).length ? ((W.needs || []).length === 1 ? 'thing needs you' : 'things need you') : 'all good', items: L, empty: false };
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const acts = (W.log || []).filter((e) => e.kind !== 'see');
        v.bp.hasR = true;
        v.bp.R = { title: 'What I did', icon: 'history', hv: String(acts.filter((e) => e.t >= dayStart.getTime() && e.kind === 'act').length), hl: 'things today',
          items: acts.slice(0, 12).map((e) => ({ ...base, t: e.text, sub: new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · ' + ({ merge: 'Merging', build: 'Builds', windows: 'Windows', safety: 'Safety', guards: 'Safety setup' }[e.area] || e.area) + (e.kind === 'would' ? ' · would do (watch only)' : e.kind === 'error' ? ' · problem' : ''),
            hasChip: e.kind === 'error' || e.kind === 'trip', chipT: 'Problem', chipC: '#ff9a8a', chipA: 'none' })), empty: !acts.length };
      }
      // Test Lab: plain words. ✓ = works, ✗ = broken. Sends what's broken straight to the window.
      // Test Lab: what each window just did (left) + your feedback box with Talk (right, drawn by HQ).
      if (v.bp && v.bp.name === 'Test Lab') {
        const base = { hasChip: false, chipT: '', chipC: '', chipA: 'none', hasChecks: false, checks: [], hasCmds: false, cmds: [], bg: '#ffffff', fg: '#1d2128', icon: '', hasBtn: false, btn: '', go: () => {} };
        const W = last.watchdog || {}; const ph = W.phone || {};
        const wins = (c.state.sessions || []).filter((x) => /^Window [A-Z]$/.test(x.name));
        const items = wins.map((ss) => {
          const raw = ss._raw || {}; const working = ss.status === 'working' || ss.status === 'needs';
          const what = raw.jobLine || raw.title || (raw.prompt ? shortTitle(raw.prompt) : '');
          const cut = (t, n) => { t = String(t || '').replace(/^Finished:\s*/, ''); if (t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, c.lastIndexOf(' ') > n * 0.6 ? c.lastIndexOf(' ') : n).replace(/[,.;:\s]+$/, '') + '\u2026'; };
          return { ...base, t: ss.name + (what ? ' \u00b7 ' + cut(what, 34) : ''), sub: working ? 'Working on it' : raw.status === 'limit' ? 'Paused by the Claude limit' : cut((ss.job && ss.job.explain) || 'No finished job yet', 70),
            hasChip: true, chipT: working ? 'Working' : raw.status === 'limit' ? 'Paused' : raw.lastReply ? 'Done' : 'Free', chipC: working ? '#ffcf70' : raw.lastReply ? '#8fe3b4' : 'rgba(255,255,255,.6)', chipA: 'none' };
        });
        const lm = (W.merge || {}).lastMerge;
        void lm;
        items.push({ ...base, t: ph.ready ? 'Your phone is ready' : 'Your phone', sub: ph.ready ? 'Shake your phone \u2192 Reload, then test.' : (ph.text || 'Checking\u2026'),
          hasChip: true, chipT: ph.ready ? 'Ready' : ph.step === 'metro' ? 'App server off' : ph.step === 'install' ? 'Install build' : 'Wait', chipC: ph.ready ? '#8fe3b4' : '#ffcf70', chipA: 'none',
          hasBtn: ph.step === 'install' || ph.step === 'build', btn: ph.step === 'install' ? 'I installed it' : 'Start the build', icon: ph.step === 'install' ? 'install_mobile' : 'rocket_launch',
          go: ph.step === 'install' ? () => post('/api/watchdog', { name: 'installed' }) : startBuild });
        v.bp.L = { title: 'What changed', icon: 'science', hv: String(wins.filter((x) => (x._raw || {}).lastReply).length), hl: 'windows finished', items, empty: false };
        v.bp.hasR = false;
      }
      if (v.nx && /^Test /.test(v.nx.title || '')) v.nx.go = () => c.openBuilding('lab');
      if (v.nx) {
        const sendAny = async () => { const el2 = c.nxInput && c.nxInput.current; const t = el2 && el2.value.trim(); if (!t) return; el2.value = '';
          const r = await post('/api/queue-any', { text: t, title: shortTitle(t) }); c.toast(r.started ? r.started + ' started it.' : 'Waiting. The first window to finish picks it up.', r.started ? 'play_arrow' : 'playlist_add'); };
        const Q = last.anyQueue || [];
        if (last.anyError && Q.length) v.nx.sub = 'Waiting job can\u2019t start: ' + last.anyError;
        v.nx.hasWin = true; v.nx.placeholder = Q.length ? 'Job for the next free window (' + Q.length + ' waiting)\u2026' : 'Job for the next free window\u2026';
        v.nx.send = sendAny; v.nx.key = (e) => { if (e.key === 'Enter') sendAny(); };
      }
      if (v.fs && v.focusOn && v.fs.isTesting) v.fs.goTest = () => c.openBuilding('lab');
      if (v.fs && v.focusOn) {
        const ss = (c.state.sessions || []).find((x) => x.name === v.fs.name);
        if (ss && (ss.status === 'done' || ss.status === 'idle' || ss.status === 'testing')) {
          const lastJob = ss._raw && ss._raw.lastReply ? ss.job.explain : '';
          v.fs.explain = ss.status === 'testing' ? 'Done. Test it on your phone.' : 'Free for a new job.';
          v.fs.action = lastJob ? 'Last job: ' + lastJob.replace(/^Finished: /, '') : 'No jobs yet';
          v.fs.actIcon = 'history';
        }
      }
      if (v.fs && v.focusOn) {
        const nm = v.fs.name;
        v.fs.openOutput = () => drawer.open(nm);
      }
      return v;
    };
    // ── Replace the design's sample data with yours ──
    function fixSamples(plan) {
      const K = window.__hqConsts; if (!K) return;
      if (!fixSamples.done) {
        fixSamples.done = true;
        (K.SOCIAL || []).forEach((x) => { x.base = 0; x.wk = 0; x.spark = [0, 0, 0, 0, 0, 0, 0]; });
        c.setState({ queue: [], ariTodos: [], prs: {}, crashSent: false });
      }
      if (!plan) return;
      const fmtD = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
      if (K.PROJ && K.PROJ[plan.project]) K.PROJ[plan.project].target = fmtD(plan.launch);
      const ideas = plan.ideas || [];
      if (K.IDEAS) K.IDEAS[plan.project] = ideas.map((i) => ({ format: (i.d || '').split(' · ')[0] || 'Slideshow', plats: ['tt', 'ig'], title: i.t, hook: (i.d || '').split(' · ').slice(1).join(' · ') || i.t, win: null }));
      if (K.POSTS) K.POSTS[plan.project] = ideas.map((i) => i.t + '. ' + ((i.d || '').split(' · ')[1] || ''));
      const done = (id) => !!(plan.tasks.find((t) => t.id === id) || {}).done;
      const L = { icon: 'icon', name: 'store-text', desc: 'store-text', keywords: 'store-text', shots67: 'screenshots', privacy: 'privacy-labels', review: 'review-notes' };
      (K.LISTING || []).forEach((l) => { if (L[l.k]) l.st = done(L[l.k]) ? 'ready' : 'missing'; else if (l.k === 'shots61') l.st = 'optional'; else if (l.k === 'video') l.st = 'optional'; else if (l.k === 'age') l.st = done('submit') ? 'ready' : 'missing'; });
      const vault = ideas.map((i) => ({ t: i.t, d: i.d }));
      if (JSON.stringify(vault) !== JSON.stringify(c.state.vault)) c.setState({ vault });
    }
    // Put each slide's text on its picture (1080x1920) and send the finished slide back to HQ.
    const drawing = new Set();
    // Load the slide designer once.
    const slidesLib = new Promise((res) => { if (window.HQSlides) return res(); const sc = document.createElement('script'); sc.src = '/slides-render.js?t=' + Date.now(); sc.onload = () => res(); sc.onerror = () => res(); document.head.appendChild(sc); });
    const rendered = new Set();
    async function finishSlides(C) {
      if (!C) return;
      for (const sh of C.shows || []) {
        if (sh.v !== 2) continue;
        const im = sh.images || {}; const slots = ['hook', ...sh.spec.steps.map((_, i) => 'step' + i)];
        if (!slots.every((k) => im[k] && im[k].file) || (sh.finals || []).filter(Boolean).length === 3) continue;
        const key = sh.id + ':' + slots.map((k) => im[k].file).join(',') + ':' + JSON.stringify(sh.spec) + ':' + JSON.stringify(C.assets);
        if (rendered.has(key)) continue; rendered.add(key);
        try {
          await slidesLib; const T = (C.templates || []).find((t) => t.id === sh.template) || C.templates[0];
          const cvs = await window.HQSlides.render(sh, T, C.assets);
          for (let i = 0; i < cvs.length; i++) await post('/api/content/final', { id: sh.id, i, png: cvs[i].toDataURL('image/png') });
        } catch (e) { rendered.delete(key); console.error('HQ slides:', e); }
      }
    }
    // Watchdog alerts: each one once. "ready" = new version to test → the UFO flies to Test Lab.
    let wdSeen = -1;
    function announceWatchdog(W) {
      if (!W || !W.alerts) return;
      const fresh = W.alerts.filter((a) => a.id > wdSeen).reverse();
      const first = wdSeen < 0; wdSeen = Math.max(wdSeen, ...W.alerts.map((a) => a.id), 0);
      if (first) return; // don't replay old alerts after a reload
      for (const a of fresh) {
        c.toast(a.text, a.level === 'urgent' ? 'warning' : a.kind === 'ready' ? 'science' : a.kind === 'built' ? 'install_mobile' : 'shield');
        if (a.level !== 'info') say(a.text);
        if (a.kind === 'ready' && !c.state.focus && !c.state.bld) setTimeout(() => c.openBuilding('lab'), 1500);
      }
    }
    const showSeen = {}; let firstShows = true;
    function announceContent(C) {
      for (const sh of (C && C.shows) || []) { const was = showSeen[sh.id]; showSeen[sh.id] = sh.status;
        if (!firstShows && was && was !== 'ready' && sh.status === 'ready') say('Your slideshow is ready: ' + sh.title + '.'); }
      firstShows = false;
    }
    // ── Voice alerts: so you hear it while gaming ──
    const prevStatus = {}; let firstSnap = true;
    // Voice: real neural voices made on your PC (Piper). No robotic Windows voices.
    const VOICE_IDS = ['ryan', 'lessac', 'amy', 'alan'];
    const VOICE_NAMES = { ryan: 'Ryan', lessac: 'Lessac', amy: 'Amy', alan: 'Alan (British)' };
    const myVoice = () => { try { return localStorage.getItem('hq-piper') || 'ryan'; } catch (e) { return 'ryan'; } };
    let playing = Promise.resolve();
    async function playVoice(text, vid) {
      const r = await fetch('/api/say?voice=' + encodeURIComponent(vid || myVoice()) + '&text=' + encodeURIComponent(text));
      if (r.status === 202) { const st = await r.json(); c.toast(st.busy || 'Getting the voice ready', 'downloading'); return; }
      if (!r.ok) return;
      if (c.state.sound === false && !vid) return;
      const url = URL.createObjectURL(await r.blob()); const a = new Audio(url); window.__hqAudio = a;
      await new Promise((res) => { a.onended = res; a.onerror = res; a.play().catch(res); }); URL.revokeObjectURL(url);
    }
    window.addEventListener('hq-next-voice', () => {
      const next = VOICE_IDS[(VOICE_IDS.indexOf(myVoice()) + 1) % VOICE_IDS.length];
      try { localStorage.setItem('hq-piper', next); } catch (e) {}
      c.toast('Voice: ' + VOICE_NAMES[next], 'record_voice_over');
      playing = playing.then(() => playVoice('Window A is done. Test it on your phone.', next));
    });
    function say(text) {
      // A Windows notification too, when HQ isn't the window you're looking at.
      try { if (document.hidden || !document.hasFocus()) new Notification('HQ', { body: text, silent: true }); } catch (e) {}
      if (c.state.sound === false || window.__hqRecording) return;
      try { c.chime(); } catch (e) {}
      playing = playing.then(() => new Promise((r) => setTimeout(r, 700))).then(() => (c.state.sound === false ? null : playVoice(text))).catch(() => {});
    }

    const runSeen = {}; let firstRuns = true;
    let lastFailSaid = 0;
    function announceRuns(runs) { // build done/failed alerts now come from the Watchdog (no duplicates)
      for (const r of runs || []) runSeen[r.id] = r.st; firstRuns = false; void lastFailSaid;
    }
    const saidDone = new Set();
    function announce(sessions) {
      for (const s of sessions) {
        const rawSt = s._raw && s._raw.status === 'limit' ? 'limit' : s.status;
        const was = prevStatus[s.id]; prevStatus[s.id] = rawSt;
        if (firstSnap || was === rawSt) continue;
        if (rawSt === 'limit') { say(s.name + ' hit the Claude limit. ' + String(s._raw.doing || '').replace('Hit the Claude limit. ', '') + '.'); continue; }
        const what = String((s.job && s.job.explain) || '').replace(/^Finished: /, '').replace(/[.]+$/, '');
        // Only ONE "done" alert per finished job, even if the status flickers.
        const jobKey = s.id + ':' + ((s._raw && s._raw.jobStart) || '') + ':' + String((s._raw && s._raw.lastReply) || '').length;
        if ((s.status === 'testing' || s.status === 'done') && saidDone.has(jobKey)) continue;
        if (s.status === 'testing' || s.status === 'done') saidDone.add(jobKey);
        if (s.status === 'testing') say(s.name + ' is done' + (what ? ': ' + what : '') + '. Test it on your phone.');
        else if (s.status === 'done') say(s.name + ' is done' + (what ? ': ' + what : '') + '.');
        else if (s.status === 'needs') say(s.name + ' needs you.');
      }
      firstSnap = false;
    }
    // ── Live data in ──
    function apply(snap) {
      last = snap;
      const now = Date.now();
      // Only Window A and Window B. Chats in other folders (like the main gym app folder) don't get an alien.
      const known = new Set((snap.projects || []).map((p) => p.name));
      const order = (w) => { const m = /window\s+([a-z])/i.exec(w || ''); return m ? m[1].toUpperCase().charCodeAt(0) : 200; };
      const seen = new Set();
      const sessions = snap.sessions
        .filter((s) => known.has(s.project) && s.status !== 'ended' && /^window\s+[a-z]$/i.test(s.window || ''))
        .sort((x, y) => order(x.window) - order(y.window))
        .map((s) => mapSession(s, now))
        .filter((s) => (seen.has(s.id) ? false : seen.add(s.id)))
        .slice(0, 2); // the room has 2 desks: Window A and Window B
      const tests = sessions.filter((s) => s.job.checks.length && s.status === 'testing').map((s) => ({ id: 't-' + s._raw.id, win: s.id, from: s.name, title: s.job.title, project: s.project, checks: s.job.checks }));
      const chat = {}; const jobQ = {};
      for (const s of sessions) {
        chat[s.id] = (s._raw.chat || []).slice(-6).map((m, i) => ({ id: s.id + 'c' + i + m.at, from: m.from, text: short(m.text, 600) }));
        jobQ[s.id] = (s._raw.queue || []).map((q) => short(q, 120));
      }
      const merged = {};
      for (const m of snap.merges || []) { const id = letter(m.window); merged[id] = m.ahead === 0; }
      announce(sessions); announceRuns(snap.runs); finishSlides(snap.content); announceContent(snap.content); announceWatchdog(snap.watchdog);
      fixSamples(snap.plan);
      const u = snap.usage || {};
      c.setState({ sessions, tests, chat, jobQ, merged, events: mapEvents(snap.activity), projects: withPlan(mapProjects(snap.projects, knownProjects), snap.plan), runs: snap.runs || [], usage: u.pct || 0, resetAt: u.resetAt || Date.now() + 5 * 3600000 });
      drawer.refresh(snap); ui.refresh();
    }
    function open() {
      const es = new EventSource('/stream');
      es.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch (err) { console.error('[HQ-LIVE]', err); } };
      es.onerror = () => { drawer.setOffline(true); };
      es.onopen = () => { drawer.setOffline(false); };
    }

    // ── Task card: click a task in Ari's panel. Steps on the left, actions + questions on the right. ──
    const card = (() => {
      const css = document.createElement('style');
      css.textContent = `
        #hqc-bg{position:fixed;inset:0;z-index:99992;background:rgba(10,14,20,.28);display:none;align-items:center;justify-content:center;padding:32px}
        #hqc-bg.open{display:flex}
        #hqc{position:relative;width:min(1020px,100%);max-height:calc(100vh - 96px);display:flex;flex-direction:column;border-radius:34px;padding:28px 30px;color:#fff;
          font:14px/1.5 Geist,-apple-system,sans-serif;background:rgba(22,26,30,.44);
          -webkit-backdrop-filter:blur(18px) saturate(1.7);backdrop-filter:blur(6px) url(#lg) saturate(1.7) brightness(1.05);
          box-shadow:inset 0 1.5px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.16),inset 1.5px 0 0 rgba(255,255,255,.2),inset -1.5px 0 0 rgba(255,255,255,.2),0 30px 80px rgba(0,0,0,.3)}
        #hqc *{scrollbar-width:none}#hqc *::-webkit-scrollbar{display:none}
        #hqc .top{display:flex;align-items:flex-start;gap:14px}
        #hqc h2{font-size:26px;font-weight:500;letter-spacing:-.025em;margin:0;flex:1;line-height:1.2}
        #hqc .x{width:38px;height:38px;flex:none;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;box-shadow:inset 0 1px 0 rgba(255,255,255,.45)}
        #hqc .tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
        #hqc .tag{height:26px;padding:0 11px;border-radius:999px;background:rgba(255,255,255,.14);display:inline-flex;align-items:center;font-size:12.5px;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
        #hqc .why{color:rgba(255,255,255,.82);margin:12px 0 0;font-size:15px}
        #hqc .grid{display:grid;grid-template-columns:1.25fr 1fr;gap:22px;margin-top:20px;min-height:0;flex:1}
        @media (max-width:820px){#hqc .grid{grid-template-columns:1fr}}
        #hqc .col{min-height:0;overflow:auto}
        #hqc h3{font-size:12px;font-weight:500;color:rgba(255,255,255,.62);margin:0 0 10px;text-transform:uppercase;letter-spacing:.07em}
        #hqc .steps{display:flex;flex-direction:column;gap:8px}
        #hqc .step{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.2);cursor:pointer;transition:opacity .2s}
        #hqc .step .n{flex:none;width:26px;height:26px;border-radius:9px;background:#fff;color:#1d2128;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center}
        #hqc .step.ok{opacity:.45}#hqc .step.ok .n{background:#9ee2bd}
        #hqc a{color:#bfe0ff}
        #hqc .side{display:flex;flex-direction:column;gap:14px}
        #hqc .panel{border-radius:22px;padding:16px;background:rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
        #hqc .btns{display:flex;gap:8px;flex-wrap:wrap}
        #hqc button.b{height:42px;padding:0 18px;border:0;border-radius:14px;cursor:pointer;font:500 14px Geist,-apple-system,sans-serif}
        #hqc button.w{background:#fff;color:#1d2128}
        #hqc button.g{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
        #hqc .links a{display:block;padding:4px 0}
        #hqc details summary{cursor:pointer;color:rgba(255,255,255,.75);font-size:13px;list-style:none}
        #hqc pre{white-space:pre-wrap;font:12.5px/1.45 'Geist Mono',monospace;background:rgba(0,0,0,.22);border-radius:14px;padding:12px;max-height:160px;overflow:auto;margin:10px 0 0}
        #hqc .chat{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto;margin-bottom:10px}
        #hqc .q{align-self:flex-end;max-width:85%;padding:9px 13px;border-radius:16px 16px 4px 16px;background:#fff;color:#1d2128}
        #hqc .a{align-self:flex-start;max-width:95%;padding:10px 13px;border-radius:16px 16px 16px 4px;background:rgba(255,255,255,.12);white-space:normal}
        #hqc .a ol,#hqc .a ul{margin:4px 0;padding-left:20px}
        #hqc .ask{display:flex;gap:8px}
        #hqc .ask input{flex:1;min-width:0;height:42px;border-radius:14px;border:0;padding:0 14px;background:rgba(255,255,255,.14);color:#fff;font:14px Geist,-apple-system,sans-serif;outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
        #hqc .ask input::placeholder{color:rgba(255,255,255,.55)}
        #hqc .wk{align-self:stretch;border-radius:14px;background:rgba(255,255,255,.06);padding:8px 12px}
        #hqc .wk summary{cursor:pointer;font-size:12.5px;color:rgba(255,255,255,.7);list-style:none}
        #hqc .wt{font:12px/1.5 'Geist Mono',monospace;opacity:.6;padding:2px 0}
        #hqc .wn{font-size:13px;opacity:.8;padding:4px 0}
        #hqc .spin{display:inline-block;width:11px;height:11px;margin-right:7px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:hqspin .8s linear infinite;vertical-align:-1px}
        @keyframes hqspin{to{transform:rotate(360deg)}}
        #hqc .verb{color:#fff;font-weight:500}
        #hqc .tm{font-size:11.5px;opacity:.6;margin-bottom:4px}
        #hqc .cp{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
        #hqc .cp button{height:28px;padding:0 10px;border:0;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.16);color:#fff;font:500 12px Geist,-apple-system,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
        #hqc .note{font-size:12px;color:rgba(255,255,255,.55);margin-top:8px}`;
      document.head.appendChild(css);
      const bg = document.createElement('div'); bg.id = 'hqc-bg';
      const el = document.createElement('div'); el.id = 'hqc'; bg.appendChild(el); document.body.appendChild(bg);
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
      const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank">$1</a>');
      // Tiny markdown: numbered/bullet lists, **bold**, `code`, links.
      const md = (t) => {
        const lines = String(t || '').replace(/^#+\s*/gm, '').split('\n'); let html = '', list = null;
        const inline = (x) => linkify(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<b>$1</b>');
        for (const raw of lines) {
          const line = raw.trim(); const ol = /^\d+[.)]\s+(.*)/.exec(line), ul = /^[-*•]\s+(.*)/.exec(line);
          const want = ol ? 'ol' : ul ? 'ul' : null;
          if (list && want !== list) { html += '</' + list + '>'; list = null; }
          if (want) { if (!list) { html += '<' + want + '>'; list = want; } html += '<li>' + inline((ol || ul)[1]) + '</li>'; }
          else if (line) html += '<div>' + inline(line) + '</div>';
        }
        if (list) html += '</' + list + '>';
        return html;
      };
      const dayLabel = (k) => { const [y, m, d] = String(k).split('-').map(Number); const dt = new Date(y, m - 1, d); const t0 = new Date(); t0.setHours(0, 0, 0, 0); const n = Math.round((dt - t0) / 86400000); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : dt.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
      const ticks = {}; const chats = {};
      const close = () => bg.classList.remove('open');
      bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bg.classList.contains('open')) { close(); e.stopPropagation(); } }, true);
      // Wheel inside the card scrolls the card, not the city.
      el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      function open(t) {
        const fw = freeWindow();
        const who = { you: 'You', ai: 'AI job', dad: 'Needs Dad' }[t.who] || 'You';
        const steps = (t.steps && t.steps.length) ? t.steps
          : t.who === 'ai' ? ['Click "Send to ' + (fw ? fw.name : 'a window') + '".', 'HQ tells you out loud when it’s done.', 'Test what it lists on your phone, then click Mark done.']
          : [];
        const tk = ticks[t.id] = ticks[t.id] || {};
        const chat = chats[t.id] = chats[t.id] || [];
        const links = t.links || [];
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(t.t)}</h2>
            <div class="tags"><span class="tag">${who}</span>${t.day ? `<span class="tag">${esc(dayLabel(t.day))}</span>` : ''}${t.done ? '<span class="tag">Done ✓</span>' : ''}</div>
            ${t.sub ? `<p class="why">${linkify(t.sub)}</p>` : ''}</div>
            <button class="x" aria-label="Close">✕</button></div>
          <div class="grid">
            <div class="col">
              <h3>Exactly what to do</h3>
              ${steps.length ? `<div class="steps">${steps.map((x, i) => `<div class="step ${tk[i] ? 'ok' : ''}" data-i="${i}"><span class="n">${tk[i] ? '✓' : i + 1}</span><span>${linkify(x)}</span></div>`).join('')}</div>`
                : '<div class="panel">No steps written for this one yet. Ask on the right and you’ll get them.</div>'}
            </div>
            <div class="col side">
              <div class="btns">
                ${t.who === 'ai' ? `<button class="b w" data-a="send">${fw ? 'Send to ' + esc(fw.name) : 'Copy prompt'}</button>` : ''}
                <button class="b ${t.who === 'ai' ? 'g' : 'w'}" data-a="done">${t.done ? 'Mark not done' : 'Mark done'}</button>
              </div>
              ${links.length ? `<div class="panel links"><h3>Links</h3>${links.map((l) => `<a href="${esc(l.url || l)}" target="_blank">${esc(l.t || l.url || l)}</a>`).join('')}</div>` : ''}
              ${t.who === 'ai' && t.prompt ? `<div class="panel"><details><summary>Show the prompt it sends ›</summary><pre>${esc(t.prompt)}</pre></details></div>` : ''}
              <div class="panel">
                <h3>Stuck? Ask</h3>
                <div class="chat">${chat.map((m) => `<div class="${m.q ? 'q' : 'a'}">${m.q ? esc(m.q) : md(m.a)}</div>`).join('')}</div>
                <div class="ask"><input placeholder="What do I do after step 1?" /><button class="b w" data-a="ask">Ask</button></div>
                <div class="note">Answered by Claude Code on your PC. It can read your app’s code but can’t change anything. Uses a little of your Claude usage.</div>
              </div>
            </div>
          </div>`;
        el.querySelector('.x').onclick = close;
        el.querySelectorAll('.step').forEach((row) => (row.onclick = () => { const i = row.dataset.i; tk[i] = !tk[i]; open(t); }));
        const sendB = el.querySelector('[data-a=send]');
        if (sendB) sendB.onclick = async () => { if (fw) { await queue(fw.id, t.prompt || t.t, null, t.t); close(); } else { const ok = await copy(t.prompt || t.t); sendB.textContent = ok ? 'Copied' : 'Copy failed'; } };
        el.querySelector('[data-a=done]').onclick = async () => { await post('/api/plan/done', { id: t.id, done: !t.done }); close(); };
        const inp = el.querySelector('.ask input'), askB = el.querySelector('[data-a=ask]'), box = el.querySelector('.chat');
        box.scrollTop = box.scrollHeight;
        const ask = async () => {
          const q = inp.value.trim(); if (!q) return;
          chat.push({ q }); chat.push({ a: 'Thinking…' }); const slot = chat[chat.length - 1]; open(t);
          try { const r = await post('/api/ask', { id: t.id, title: t.t, question: q + (steps.length ? '\n\n(Steps on my card: ' + steps.map((x, i) => (i + 1) + '. ' + x).join(' ') + ')' : '') }); slot.a = r.answer || r.error || 'No answer.'; }
          catch (e) { slot.a = 'Could not reach HQ.'; }
          if (bg.classList.contains('open')) open(t);
        };
        askB.onclick = ask; inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') ask(); };
        bg.classList.add('open'); if (chat.length) setTimeout(() => el.querySelector('.ask input').focus(), 0);
      }
      function info(title, groups) {
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(title)}</h2></div><button class="x" aria-label="Close">\u2715</button></div>
          <div class="col" style="margin-top:18px">${groups.map((g) => `<h3 style="margin-top:14px">${esc(g.h)}</h3><div class="steps">${g.items.map((x) => `<div class="step" style="cursor:default"><span>${esc(x)}</span></div>`).join('')}</div>`).join('')}</div>`;
        el.querySelector('.x').onclick = close;
        bg.classList.add('open');
      }
      // ── A window's full output, in the same glass card. Summary first, then the chat. ──
      const VERBS = ['Working', 'Thinking', 'Cooking', 'Building', 'Tinkering', 'Wiring it up', 'Testing', 'Figuring it out', 'Crunching', 'Polishing'];
      let liveTimer = null;
      async function output(win) {
        clearInterval(liveTimer);
        const snap = last || { sessions: [] };
        const raw = snap.sessions.find((x) => x.window === win) || {};
        const ses = (c.state.sessions || []).find((x) => x.name === win) || {};
        const label = { working: 'Working', needs: 'Needs you', testing: 'Ready to test', done: 'Done', idle: 'Free' }[ses.status] || 'Free';
        const m = (snap.merges || []).find((x) => x.window === win);
        const L = snap.logs || {};
        // Copy buttons: plain text, in pieces under ~3,500 characters. Claude.ai turns a paste of
        // about 3,860+ characters into a "pasted text" attachment, so each piece stays normal text.
        const LIMIT = 3500; const copies = [];
        const pieces = (t) => { t = String(t || '').trim(); const out = []; while (t.length > LIMIT) { let cut = t.lastIndexOf('\n\n', LIMIT); if (cut < LIMIT * 0.5) cut = t.lastIndexOf('\n', LIMIT); if (cut < LIMIT * 0.5) cut = t.lastIndexOf(' ', LIMIT); if (cut <= 0) cut = LIMIT; out.push(t.slice(0, cut).trim()); t = t.slice(cut).trim(); } if (t) out.push(t); return out; };
        // Remember what you already copied (so you know what you sent to Claude), per message.
        const keyOf = (t) => { let h = 0; t = String(t || ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return 'hqcp' + h; };
        const copiedAt = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } };
        const when = (t) => { if (!t) return ''; const d = new Date(t), now = new Date(); const day = d.toDateString() === now.toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); return day + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
        const copyBtns = (t, at) => { const ps = pieces(t); if (ps.length) ps[0] = win + '\u2019s report' + (at ? ' (' + when(at) + ')' : '') + ':\n\n' + ps[0]; return '<div class="cp">' + ps.map((x, i) => { copies.push(x); const k = keyOf(x); const was = copiedAt(k); return `<button data-cp="${copies.length - 1}" data-k="${k}">${ps.length > 1 ? 'Copy part ' + (i + 1) + ' of ' + ps.length : 'Copy'}${was ? ' \u00b7 copied ' + when(was) : ''}</button>`; }).join('') + '</div>'; };
        const render = (msgs) => {
          copies.length = 0;
          // Group tool steps between messages into one quiet line.
          // Like VS Code: your message, then ONE "Worked: N steps" line (click to open), then Claude's final answer.
          const rows = []; let turn = null;
          const flush = () => { if (!turn) return; const texts = turn.items.filter((x) => x.role === 'claude');
            const final = turn.done ? texts[texts.length - 1] : null; const work = turn.items.filter((x) => x !== final);
            if (work.length) rows.push({ work, n: turn.items.filter((x) => x.role === 'tool').length, live: !turn.done });
            if (final) rows.push(final); turn = null; };
          msgs.forEach((x) => {
            if (x.role === 'you') { flush(); rows.push(x); turn = { items: [], done: true }; return; }
            if (!turn) turn = { items: [], done: true };
            turn.items.push(x);
          });
          if (turn) { const lastIsText = turn.items.length && turn.items[turn.items.length - 1].role === 'claude'; turn.done = !!lastIsText && !(ses.status === 'working' || ses.status === 'needs'); }
          flush();
          el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(win)}</h2>
              <div class="tags"><span class="tag">${label}</span>${ses.job && ses.job.title ? `<span class="tag">${esc(ses.job.title)}</span>` : ''}</div></div>
              <button class="x" aria-label="Close">✕</button></div>
            <div class="grid">
              <div class="col">
                <h3>Summary</h3>
                <div class="panel" style="font-size:15px">${raw.lastEvent && (ses.status === 'done' || ses.status === 'testing') ? `<div class="tm">Finished ${when(raw.lastEvent)}</div>` : ''}${esc((ses.job && ses.job.explain) || 'Nothing yet.')}${raw.lastReply ? '<div style="margin-top:8px;font-size:12.5px;color:rgba(255,255,255,.6)">Its full last message:</div>' + copyBtns(raw.lastReply, raw.lastEvent) : ''}</div>
                ${(raw.tests || []).length ? `<h3 style="margin-top:18px">Test on your phone</h3><div class="steps">${raw.tests.map((x, i) => `<div class="step" style="cursor:default"><span class="n">${i + 1}</span><span>${esc(x)}</span></div>`).join('')}</div>` : ''}
                <h3 style="margin-top:18px">Conversation</h3>
                <div class="chat" style="max-height:none">${rows.length ? rows.slice(-40).map((x) => x.work ? `<details class="wk"><summary>${x.live ? `<span class="spin"></span><span class="verb">${VERBS[Math.floor(Date.now() / 3000) % VERBS.length]}\u2026</span> ${x.n} step${x.n === 1 ? '' : 's'}${(x.work.filter((w) => w.role === 'tool').pop() || {}).text ? ' \u00b7 ' + esc((x.work.filter((w) => w.role === 'tool').pop() || {}).text) : ''}` : 'Worked: ' + x.n + ' step' + (x.n === 1 ? '' : 's')} \u203a</summary>${x.work.filter((w) => w.role === 'tool' || String(w.text).replace(/^\s*\**HQ-JOB:.*$/im, '').trim()).map((w) => w.role === 'tool' ? `<div class="wt">› ${esc(w.text)}</div>` : `<div class="wn">${esc(String(w.text).replace(/^\s*\**HQ-JOB:.*$/im, '').trim().slice(0, 600))}</div>`).join('')}</details>` : `<div class="${x.role === 'you' ? 'q' : 'a'}">${x.at ? `<div class="tm">${x.role === 'you' ? 'You' : 'Claude'} \u00b7 ${when(x.at)}</div>` : ''}${x.role === 'you' ? esc(cleanYou(x.text).slice(0, 600)) + (cleanYou(x.text).length > 600 ? '…' : '') : md(String(x.text).replace(/^\s*\**HQ:.*$/im, '')) + copyBtns(x.text, x.at)}</div>`).join('') : '<div class="panel">No messages yet.</div>'}</div>
              </div>
              <div class="col side">
                <div class="panel">
                  <h3>Message ${esc(win)}</h3>
                  <div class="ask" style="flex-direction:column"><textarea rows="4" style="resize:none;border-radius:14px;border:0;padding:12px 14px;background:rgba(255,255,255,.14);color:#fff;font:14px/1.45 Geist,-apple-system,sans-serif;outline:none" placeholder="${ses.status === 'working' ? 'It starts this when it finishes' : 'What should it do next?'}"></textarea>
                  <button class="b w" data-a="msg" style="align-self:flex-end">Send</button></div>
                  <div class="note">Your latest test logs are added for you.</div>
                </div>
                ${m && m.ahead ? `<div class="panel"><h3>Merge</h3><div>${m.ahead} new change${m.ahead === 1 ? '' : 's'} not on your phone yet.</div><div class="btns" style="margin-top:10px"><button class="b g" data-a="merge">Copy merge commands</button></div></div>` : ''}
                <div class="panel"><h3>Test logs</h3><div>${L.file ? (L.errorCount ? L.errorCount + ' errors in your last test.' : 'Your last test had no errors.') : 'No logs yet. Start the app with npm run dev.'}</div></div>
              </div>
            </div>`;
          el.querySelector('.x').onclick = close;
          const ta = el.querySelector('textarea'), sb = el.querySelector('[data-a=msg]');
          ta.onkeydown = (e) => e.stopPropagation();
          sb.onclick = async () => { const t = ta.value.trim(); if (!t) return; const id = ses.id || (/window\s+([a-z])/i.exec(win) || [])[1]; await queue(id, t); ta.value = ''; close(); };
          const mb = el.querySelector('[data-a=merge]'); if (mb) mb.onclick = async () => { mb.textContent = (await copy(m.cmd)) ? 'Copied. Paste in PowerShell.' : 'Copy failed'; };
          el.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = async () => { const ok = await copy(copies[Number(b.dataset.cp)]); if (ok) { try { localStorage.setItem(b.dataset.k, String(Date.now())); } catch (e) {} } const base = b.textContent.split(' \u00b7 ')[0]; b.textContent = ok ? 'Copied \u2713' : 'Copy failed'; setTimeout(() => (b.textContent = base + (ok ? ' \u00b7 copied ' + when(Date.now()) : '')), 1500); }));
          const chatEl = el.querySelector('.chat'); const col = chatEl && chatEl.parentElement; if (col) col.scrollTop = col.scrollHeight;
        };
        render([]); bg.classList.add('open');
        const load = async () => { try { const r = await (await fetch('/api/transcript?window=' + encodeURIComponent(win))).json(); if (bg.classList.contains('open') && !(document.activeElement && document.activeElement.tagName === 'TEXTAREA')) { const keep = el.querySelector('.grid .col'); const y = keep ? keep.scrollTop : 0; const opened = [...el.querySelectorAll('details[open]')].length; render(r.messages || []); const k2 = el.querySelector('.grid .col'); if (k2 && y) k2.scrollTop = y; if (opened) el.querySelectorAll('details.wk').forEach((d, i, all) => { if (i === all.length - 1) d.open = true; }); } } catch (e) {} };
        await load();
        // While the window is working, keep this view live (like Claude Code's spinner).
        liveTimer = setInterval(() => { if (!bg.classList.contains('open')) return clearInterval(liveTimer); const st = ((c.state.sessions || []).find((x) => x.name === win) || {}).status; if (st === 'working' || st === 'needs') load(); }, 3000);
      }
      function keyBox() {
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Add your Gemini key</h2><p class="why">Make it free at aistudio.google.com → Get API key → Create API key. Don’t turn on billing, then it can never cost money. The key is saved only on this PC.</p></div><button class="x" aria-label="Close">✕</button></div>
          <div class="ask" style="margin-top:18px"><input type="password" placeholder="Paste your key" /><button class="b w" data-a="save">Save</button></div>`;
        el.querySelector('.x').onclick = close;
        const inp = el.querySelector('input'); inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') sv(); };
        const sv = async () => { const k = inp.value.trim(); if (!k) return; await post('/api/content/key', { key: k }); close(); c.toast('Gemini key saved', 'key'); };
        el.querySelector('[data-a=save]').onclick = sv; bg.classList.add('open'); setTimeout(() => inp.focus(), 50);
      }
      const fileToData = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(f); });
      // Free pictures: Cloudflare account ID + token.
      function cfBox() {
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Turn on free pictures</h2><p class="why">Cloudflare gives every account a free amount of AI pictures each day (about 35 posts). On the free plan it can never charge you: when it’s used up, it just waits until tomorrow. No credit card.</p></div><button class="x" aria-label="Close">✕</button></div>
          <div class="steps" style="margin-top:16px">${['Go to dash.cloudflare.com and make a free account (or sign in).', 'On the left, click <b>AI</b> → <b>Workers AI</b>.', 'Click <b>Use REST API</b>.', 'Click <b>Create a Workers AI API Token</b> → <b>Create API Token</b>. Copy the token (it’s only shown once).', 'On the same page, copy your <b>Account ID</b>.', 'Paste both below and press Save. HQ makes 1 tiny test picture to check.'].map((x, i) => `<div class="step" style="cursor:default"><span class="n">${i + 1}</span><span>${x}</span></div>`).join('')}</div>
          <h3 style="margin-top:16px">Account ID</h3><div class="ask"><input data-k="a" placeholder="32 letters and numbers" /></div>
          <h3 style="margin-top:12px">API token</h3><div class="ask"><input data-k="t" type="password" placeholder="Paste the token" /></div>
          <div class="btns"><button class="b w" data-a="save">Save and test</button><button class="b g" data-a="open">Open Cloudflare</button></div><div class="note">Saved only on this PC, in content\\cloudflare.json.</div>`;
        el.querySelector('.x').onclick = close;
        el.querySelectorAll('input').forEach((t) => (t.onkeydown = (e) => e.stopPropagation()));
        el.querySelector('[data-a=open]').onclick = () => window.open('https://dash.cloudflare.com/?to=/:account/ai/workers-ai');
        el.querySelector('[data-a=save]').onclick = async (e) => {
          e.target.textContent = 'Testing…'; e.target.disabled = true;
          const r = await post('/api/content/cloudflare', { account: el.querySelector('[data-k=a]').value, token: el.querySelector('[data-k=t]').value });
          if (r.ok) { close(); c.toast('Free pictures are on', 'image'); } else { e.target.disabled = false; e.target.textContent = 'Save and test'; el.querySelector('.note').textContent = r.error || 'That didn’t work.'; }
        };
        bg.classList.add('open');
      }
      // Your real app screenshot (slide 3 phone) and app icon (badge on slide 1).
      function assetBox() {
        const A = ((last && last.content) || {}).assets || {};
        const slot = (k, label, why) => `<div class="step" style="cursor:default;align-items:center"><div style="width:64px;height:${k === 'icon' ? 64 : 120}px;border-radius:12px;background:rgba(255,255,255,.12) center/cover no-repeat ${A[k] ? `url(${A[k]}?t=${Date.now()})` : ''};flex:none"></div><div style="flex:1"><b>${label}</b><div style="font-size:13px;opacity:.75">${why}</div></div><label class="b ${A[k] ? 'g' : 'w'}" style="display:inline-flex;align-items:center;cursor:pointer">${A[k] ? 'Change' : 'Choose'}<input type="file" accept="image/*" data-k="${k}" style="display:none"></label></div>`;
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Your app pictures</h2><p class="why">These make the slides look real. Use real screens from FormPal only.</p></div><button class="x" aria-label="Close">✕</button></div>
          <div class="steps" style="margin-top:16px">${slot('screenshot', 'Screenshot of FormPal (not your logo)', 'Take a normal iPhone screenshot of your best FormPal screen (like the form check with a good score). It goes inside the phone on slide 3.')}${slot('icon', 'Logo / app icon (optional)', 'A square picture. It shows next to “FormPal” on slide 1.')}</div>
          <div class="note">Saved only on this PC.</div>`;
        el.querySelector('.x').onclick = close;
        el.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const png = await fileToData(f); const r = await post('/api/content/upload', { kind: inp.dataset.k, png }); c.toast(r.ok ? 'Saved' : 'That picture didn’t work', r.ok ? 'check' : 'error'); setTimeout(assetBox, 400); }));
        bg.classList.add('open');
      }
      function newShow() {
        const C = (last && last.content) || { templates: [] }; const T = C.templates[0] || {};
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>New slideshow</h2><p class="why">${esc(T.name || '')}: a crazy hook photo, a simple how-to with a picture for each step, then your app. Gemini writes the words first and you check them. Pictures are made only after you say go.</p></div><button class="x" aria-label="Close">✕</button></div>
          <h3 style="margin-top:18px">What is it about?</h3>
          <div class="ask"><input placeholder="A 4-move leg day for beginners" /><button class="b g" data-a="ideas">Give me ideas</button></div>
          <div class="btns" data-ideas style="margin-top:10px"></div>
          <div class="btns"><button class="b w" data-a="go">Write it</button></div><div class="note">Writing is free (your Gemini key). HQ checks it’s 5th-grade reading level and fixes it if not.</div>`;
        el.querySelector('.x').onclick = close;
        const inp = el.querySelector('input'); inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); };
        el.querySelector('[data-a=ideas]').onclick = async (e) => {
          e.target.textContent = 'Thinking…'; const r = await post('/api/content/ideas', { template: T.id }); e.target.textContent = 'More ideas';
          const box = el.querySelector('[data-ideas]');
          box.innerHTML = r.ideas ? r.ideas.map((x) => `<button class="b g" style="height:auto;min-height:36px;padding:8px 12px;text-align:left;white-space:normal">${esc(x)}</button>`).join('') : `<div class="note">${esc(r.error === 'nokey' ? 'Add your Gemini key first.' : r.error || '')}</div>`;
          box.querySelectorAll('button').forEach((b) => (b.onclick = () => { inp.value = b.textContent; inp.focus(); }));
        };
        const go = async () => {
          const topic = inp.value.trim(); if (!topic) { inp.focus(); return; }
          const b = el.querySelector('[data-a=go]'); b.textContent = 'Writing…'; b.disabled = true;
          const r = await post('/api/content/draft', { topic, template: T.id });
          if (r.show) draftEditor(r.show); else { b.disabled = false; b.textContent = 'Write it'; el.querySelector('.note').textContent = r.error === 'nokey' ? 'Add your Gemini key first.' : r.error; }
        };
        el.querySelector('[data-a=go]').onclick = go;
        bg.classList.add('open'); setTimeout(() => inp.focus(), 50);
      }
      const ta = (k, val, rows, small) => `<textarea data-k="${k}" rows="${rows}" style="width:100%;box-sizing:border-box;resize:none;border:0;border-radius:12px;padding:${small ? '8px 10px' : '10px 12px'};background:rgba(255,255,255,${small ? '.08' : '.14'});color:#fff;font:${small ? '13px' : '15px'}/1.4 Geist,-apple-system,sans-serif;outline:none">${esc(val)}</textarea>`;
      function draftEditor(sh) {
        if (sh.v !== 2) return slides(sh);
        const S = sh.spec; const C = (last && last.content) || {};
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(sh.title)}</h2><div class="tags"><span class="tag">Reading level: grade ${sh.grade}${sh.grade <= 5 ? ' ✓' : ''}</span><span class="tag">${S.steps.length} steps</span></div><p class="why">Change anything. “Picture” = what the photo shows. The words are drawn by HQ, never by the AI, so they’ll be spelled exactly like this.</p></div><button class="x" aria-label="Close">✕</button></div>
          ${(sh.warnings || []).length ? `<div class="panel" style="margin-top:12px;font-size:13px">Heads up: ${esc(sh.warnings.join('; '))}</div>` : ''}
          <h3 style="margin-top:16px">Slide 1 · Hook</h3>${ta('hook.text', S.hook.text, 2)}<div class="note" style="margin:6px 0 4px">Picture</div>${ta('hook.picture', S.hook.picture, 2, 1)}
          <h3 style="margin-top:16px">Slide 2 · ${esc(S.howtoTitle)}</h3>
          <div class="steps">${S.steps.map((st, i) => `<div class="step" style="cursor:default;flex-direction:column;gap:6px;align-items:stretch"><div style="display:flex;gap:10px;align-items:center"><span class="n">${i + 1}</span><b>Step</b></div>${ta('s' + i + '.title', st.title, 1)}<div class="note" style="margin:0">Bullets (one per line)</div>${ta('s' + i + '.bullets', st.bullets.join('\n'), 2, 1)}<div class="note" style="margin:0">Picture</div>${ta('s' + i + '.picture', st.picture, 1, 1)}</div>`).join('')}</div>
          <h3 style="margin-top:16px">Slide 3 · Your app</h3><div class="panel" style="font-size:14px">${esc(S.cta)}</div>
          <h3 style="margin-top:16px">Caption</h3>${ta('caption', S.caption + (S.hashtags.length ? '\n' + S.hashtags.join(' ') : ''), 2, 1)}
          <div class="btns"><button class="b w" data-a="pics">${C.hasPictures ? 'Make the ' + (1 + S.steps.length) + ' pictures' : 'Turn on free pictures first'}</button><button class="b g" data-a="del">Delete</button></div>
          <div class="note">Free (Cloudflare). Each picture gets checked for weird text or bodies and is redone once if needed.</div>`;
        el.querySelector('.x').onclick = close;
        el.querySelectorAll('textarea').forEach((t) => (t.onkeydown = (e) => e.stopPropagation()));
        const val = (k) => el.querySelector(`[data-k="${k}"]`).value.trim();
        el.querySelector('[data-a=pics]').onclick = async () => {
          if (!C.hasPictures) return cfBox();
          const capLines = val('caption').split('\n'); const tags = capLines.join(' ').match(/#\w+/g) || [];
          const spec = { hook: { text: val('hook.text').toUpperCase(), picture: val('hook.picture') },
            steps: S.steps.map((_, i) => ({ title: val('s' + i + '.title').toUpperCase(), bullets: val('s' + i + '.bullets').split('\n').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 2), picture: val('s' + i + '.picture') })),
            caption: capLines.join(' ').replace(/#\w+/g, '').trim(), hashtags: tags.slice(0, 5) };
          const r = await post('/api/content/pictures', { id: sh.id, spec });
          if (r.started) { close(); c.toast('Making the pictures. HQ tells you when it’s ready.', 'auto_awesome'); }
          else if (r.error === 'nocf') cfBox(); else el.querySelector('.note').textContent = r.error || 'Could not start.';
        };
        el.querySelector('[data-a=del]').onclick = async () => { await post('/api/content/delete', { id: sh.id }); close(); };
        bg.classList.add('open');
      }
      function templateEditor() { return newShow(); }
      function anyJob() {
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Job for the next free window</h2><p class="why">Whichever window is free first starts it. If both are busy, it waits and the first one to finish picks it up.</p></div><button class="x" aria-label="Close">✕</button></div>
          <h3 style="margin-top:16px">Short name</h3><div class="ask"><input placeholder="Fix the build" /></div>
          <h3 style="margin-top:16px">The job</h3><textarea rows="8" style="width:100%;box-sizing:border-box;resize:none;border:0;border-radius:14px;padding:12px;background:rgba(255,255,255,.14);color:#fff;font:14px/1.45 Geist,-apple-system,sans-serif;outline:none" placeholder="Paste or write the prompt"></textarea>
          <div class="btns"><button class="b w" data-a="go">Send</button>${(last.anyQueue || []).length ? '<button class="b g" data-a="clr">Clear waiting jobs</button>' : ''}</div><div class="note">Your latest test logs are added for you.</div>`;
        el.querySelector('.x').onclick = close;
        el.querySelectorAll('input,textarea').forEach((t) => (t.onkeydown = (e) => e.stopPropagation()));
        el.querySelector('[data-a=go]').onclick = async () => {
          const text = el.querySelector('textarea').value.trim(); if (!text) return;
          const r = await post('/api/queue-any', { text, title: el.querySelector('input').value.trim() || shortTitle(text) });
          close(); c.toast(r.started ? r.started + ' started it.' : 'Waiting. The first window to finish picks it up.', r.started ? 'play_arrow' : 'playlist_add');
        };
        const clr = el.querySelector('[data-a=clr]'); if (clr) clr.onclick = async () => { await post('/api/queue-any/clear', {}); close(); };
        bg.classList.add('open');
      }
      function buildFail(r) {
        const lines = r.fail || [];
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Why the build failed</h2><div class="tags"><span class="tag">${esc(r.wf)}</span><span class="tag">${esc(r.br || '')}</span></div></div><button class="x" aria-label="Close">✕</button></div>
          <div class="panel" style="margin-top:16px;font-size:15px">${esc(r.note || '')}</div>
          ${lines.length ? `<h3 style="margin-top:16px">The error lines</h3><pre style="max-height:300px">${esc(lines.join('\n'))}</pre>` : ''}
          <div class="btns"><button class="b w" data-a="fix">Send to the next free window</button><button class="b g" data-a="copy">Copy</button></div>`;
        el.querySelector('.x').onclick = close;
        const prompt = 'The iOS build "' + r.wf + '" on ' + r.br + ' failed. The error lines:\n\n' + lines.join('\n') + '\n\nFind the cause and fix it in the code on your branch. Run npx tsc --noEmit, commit and push your branch. Do NOT start a build yourself (no gh workflow run, no eas build): HQ starts builds. If the fix is NOT in the code (Apple website, GitHub secrets), change nothing and tell me exactly what to do in plain words. End with one line that starts with HQ:';
        el.querySelector('[data-a=fix]').onclick = async () => { const res = await post('/api/queue-any', { text: prompt, title: 'Fix the failed build' }); close(); c.toast(res.started ? res.started + ' is fixing the build.' : 'Waiting for a free window.', 'build'); };
        el.querySelector('[data-a=copy]').onclick = async (e) => { e.target.textContent = (await copy(prompt)) ? 'Copied' : 'Copy failed'; };
        bg.classList.add('open');
      }
      // Terminal: run PowerShell commands right here, in one of your folders.
      let termTimer = null; let termFolder = null; let termJob = null;
      async function terminal() {
        clearInterval(termTimer);
        const H = { 'Content-Type': 'application/json', 'x-hq-token': window.__hqToken || '' };
        const api = async (u, body) => (await fetch(u, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H })).json();
        const L = await api('/api/shell/list');
        if (L.error) { c.toast(L.error, 'error'); return; }
        termFolder = termFolder || L.folders.find((f) => /main/i.test(f)) || L.folders[0];
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>Terminal</h2><p class="why">Runs PowerShell in the folder you pick. Long ones (like npm run dev) keep running here. Stop ends them.</p></div><button class="x" aria-label="Close">\u2715</button></div>
          <div class="btns" style="margin-top:12px">${L.folders.map((f) => `<button class="b ${f === termFolder ? 'w' : 'g'}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>
          <pre class="term" style="height:46vh;max-height:none;margin-top:14px;background:rgba(0,0,0,.45);font-size:12.5px">Pick a folder above, type a command below, press Enter.
Try: git status
</pre>
          <div class="ask" style="margin-top:10px"><span style="align-self:center;font:12.5px 'Geist Mono',monospace;opacity:.7">PS ${esc(termFolder)}&gt;</span><input placeholder="git status" style="font-family:'Geist Mono',monospace" /><button class="b w" data-a="run">Run</button><button class="b g" data-a="stop">Stop</button></div>
          ${L.jobs.length ? `<div class="btns">${L.jobs.slice(-6).reverse().map((j) => `<button class="b g" data-j="${j.id}" style="height:32px;font-size:12px">${j.done ? '' : '\u25cf '}${esc(j.cmd.slice(0, 28))}</button>`).join('')}</div>` : ''}`;
        el.querySelector('.x').onclick = () => { clearInterval(termTimer); close(); };
        const pre = el.querySelector('.term'), inp = el.querySelector('input');
        let len = 0;
        const show = async (id) => { termJob = id; len = 0; pre.textContent = ''; clearInterval(termTimer); const tick = async () => { const r = await api('/api/shell/job?id=' + id + '&from=' + len); if (!r || r.out === undefined) return; if (r.out) { pre.textContent += r.out; len = r.len; pre.scrollTop = pre.scrollHeight; } if (r.done) { pre.textContent += '\n[done' + (r.code ? ', exit ' + r.code : '') + ']\n'; clearInterval(termTimer); } }; await tick(); termTimer = setInterval(tick, 700); };
        const run = async () => { const cmd = inp.value.trim(); if (!cmd) return; inp.value = ''; const r = await api('/api/shell', { cmd, folder: termFolder }); if (r.id) { await show(r.id); pre.textContent = 'PS ' + termFolder + '> ' + cmd + '\n' + pre.textContent; } };
        inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') run(); };
        el.querySelector('[data-a=run]').onclick = run;
        el.querySelector('[data-a=stop]').onclick = () => termJob && api('/api/shell/stop', { id: termJob });
        el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { termFolder = b.dataset.f; terminal(); }));
        el.querySelectorAll('[data-j]').forEach((b) => (b.onclick = () => show(Number(b.dataset.j))));
        if (termJob) show(termJob);
        bg.classList.add('open'); setTimeout(() => inp.focus(), 50);
      }
      function slides(shIn) {
        const C = (last && last.content) || {}; const sh = (C.shows || []).find((x) => x.id === shIn.id) || shIn;
        if (sh.v !== 2) { // older slideshows
          const src = (x) => '/content/' + sh.id + '/' + (x.final || x.img) + '?t=' + Date.now();
          el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(sh.title)}</h2></div><button class="x" aria-label="Close">✕</button></div><div style="display:grid;grid-template-columns:repeat(${Math.min(6, sh.slides.length)},1fr);gap:10px;margin-top:18px">${sh.slides.map((x) => (x.img ? `<img src="${src(x)}" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:14px">` : '<div class="panel" style="aspect-ratio:9/16"></div>')).join('')}</div><div class="btns"><button class="b w" data-a="folder">Open folder</button></div>`;
          el.querySelector('.x').onclick = close; el.querySelector('[data-a=folder]').onclick = () => post('/api/content/open', { id: sh.id }); bg.classList.add('open'); return;
        }
        const im = sh.images || {}; const slots = ['hook', ...sh.spec.steps.map((_, i) => 'step' + i)];
        el.dataset.show = sh.id; el.dataset.sig = sh.status + JSON.stringify(im) + JSON.stringify(sh.finals || []);
        const names = { hook: 'Hook photo' }; sh.spec.steps.forEach((st, i) => (names['step' + i] = 'Step ' + (i + 1)));
        const fin = sh.finals || [];
        const caption = [sh.spec.caption, (sh.spec.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(sh.title)}</h2><div class="tags"><span class="tag">${sh.status === 'ready' ? 'Ready to post' : sh.status === 'making' ? 'Making pictures…' : sh.status === 'layout' ? 'Putting it together…' : 'Needs a fix'}</span><span class="tag">Grade ${sh.grade} reading</span></div></div><button class="x" aria-label="Close">✕</button></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px">${[0, 1, 2].map((i) => fin[i] ? `<img src="/content/${sh.id}/${fin[i]}?t=${Date.now()}" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:14px">` : `<div class="panel" style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px">${sh.status === 'making' ? 'Making pictures…' : 'Waiting for pictures'}</div>`).join('')}</div>
          <h3 style="margin-top:18px">Pictures</h3>
          <div style="display:grid;grid-template-columns:repeat(${slots.length},1fr);gap:10px">${slots.map((k) => { const x = im[k] || {}; return `<div style="display:flex;flex-direction:column;gap:6px"><div style="aspect-ratio:${k === 'hook' ? '9/16' : '1/1'};border-radius:12px;background:rgba(255,255,255,.1) center/cover no-repeat ${x.file ? `url(/content/${sh.id}/${x.file})` : ''};display:flex;align-items:center;justify-content:center;font-size:11px;text-align:center;padding:6px;box-sizing:border-box">${x.file ? '' : esc(x.err || (sh.status === 'making' ? 'Making…' : 'Not made yet'))}</div><div style="font-size:12px;opacity:.75">${names[k]}${x.note ? ' · ' + esc(x.note) : ''}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap"><button class="b g" data-redo="${k}" style="height:28px;padding:0 9px;font-size:12px">Redo</button><label class="b g" style="height:28px;padding:0 9px;font-size:12px;display:inline-flex;align-items:center;cursor:pointer">Mine<input type="file" accept="image/*" data-own="${k}" style="display:none"></label><button class="b g" data-prompt="${k}" style="height:28px;padding:0 9px;font-size:12px">Prompt</button></div></div>`; }).join('')}</div>
          <div class="btns"><button class="b w" data-a="folder">Open folder</button><button class="b g" data-a="cap">Copy caption</button><button class="b g" data-a="edit">Change words</button>${['partial', 'stopped'].includes(sh.status) ? '<button class="b g" data-a="retry">Make missing pictures</button>' : ''}<button class="b g" data-a="del">Delete</button></div>
          <div class="note">Post slide-1, slide-2, slide-3 from the folder in that order, then add a trending sound. “Mine” = use your own picture. “Prompt” copies the exact picture prompt (you can paste it in the Gemini app).</div>`;
        el.querySelector('.x').onclick = close;
        el.querySelector('[data-a=folder]').onclick = () => post('/api/content/open', { id: sh.id });
        el.querySelector('[data-a=cap]').onclick = async (e) => { e.target.textContent = (await copy(caption)) ? 'Copied' : 'Copy failed'; };
        el.querySelector('[data-a=edit]').onclick = () => draftEditor(sh);
        el.querySelector('[data-a=del]').onclick = async () => { await post('/api/content/delete', { id: sh.id }); close(); };
        const rt = el.querySelector('[data-a=retry]'); if (rt) rt.onclick = async () => { const r = await post('/api/content/pictures', { id: sh.id }); c.toast(r.started ? 'Making the missing pictures' : (r.error === 'nocf' ? 'Turn on free pictures first' : r.error), 'image'); setTimeout(() => slides(sh), 800); };
        el.querySelectorAll('[data-redo]').forEach((b) => (b.onclick = async () => { const r = await post('/api/content/pictures', { id: sh.id, only: b.dataset.redo }); c.toast(r.started ? 'Making a new ' + names[b.dataset.redo].toLowerCase() : (r.error === 'nocf' ? 'Turn on free pictures first' : r.error), 'refresh'); setTimeout(() => slides(sh), 800); }));
        el.querySelectorAll('[data-own]').forEach((inp) => (inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const png = await fileToData(f); const r = await post('/api/content/upload', { id: sh.id, slot: inp.dataset.own, png }); c.toast(r.ok ? 'Using your picture' : 'That picture didn’t work', r.ok ? 'check' : 'error'); setTimeout(() => slides(sh), 600); }));
        el.querySelectorAll('[data-prompt]').forEach((b) => (b.onclick = async () => { const x = im[b.dataset.prompt] || {}; b.textContent = (await copy(x.prompt || 'Make the pictures once first, then the prompt is here.')) ? 'Copied' : 'Copy failed'; }));
        bg.classList.add('open');
      }
      // A Watchdog "needs you" item: what's wrong, exactly what to do, and one button.
      function need(n) {
        el.innerHTML = `<div class="top"><div style="flex:1"><h2>${esc(n.title)}</h2><div class="tags"><span class="tag">Watchdog</span><span class="tag">${n.level === 'urgent' ? 'Important' : 'Needs you'}</span></div></div><button class="x" aria-label="Close">\u2715</button></div>
          <div class="panel" style="margin-top:16px;font-size:15px">${esc(n.text)}</div>
          ${(n.steps || []).length ? `<h3 style="margin-top:16px">What to do</h3><div class="steps">${n.steps.map((x, i) => `<div class="step"><span class="n">${i + 1}</span><span>${esc(x)}</span></div>`).join('')}</div>` : ''}
          ${n.code ? `<h3 style="margin-top:16px">Paste this in PowerShell</h3><pre>${esc(n.code)}</pre>` : ''}
          ${(n.lines || []).length ? `<h3 style="margin-top:16px">The error</h3><pre style="max-height:220px">${esc(n.lines.join('\n'))}</pre>` : ''}
          <div class="btns">${n.button ? `<button class="b w" data-a="act">${esc(n.button.label)}</button>` : ''}${n.code ? '<button class="b g" data-a="copy">Copy</button>' : ''}<button class="b g" data-a="close">Close</button></div>`;
        el.querySelector('.x').onclick = close; el.querySelector('[data-a=close]').onclick = close;
        const a = el.querySelector('[data-a=act]'); if (a) a.onclick = async () => { a.textContent = 'Working\u2026'; const r = await post('/api/watchdog', { name: n.button.action, arg: n.button.arg }); close(); c.toast(r.ok ? 'Done' : (r.error || 'Didn\u2019t work'), r.ok ? 'done' : 'error'); };
        const cp = el.querySelector('[data-a=copy]'); if (cp) cp.onclick = async () => { cp.textContent = (await copy(n.code)) ? 'Copied' : 'Copy failed'; };
        bg.classList.add('open');
      }
      // Keep an open slideshow card up to date while pictures are being made.
      setInterval(() => {
        if (!bg.classList.contains('open') || !el.dataset.show || !el.querySelector('[data-redo]')) return;
        const sh = (((last && last.content) || {}).shows || []).find((x) => x.id === el.dataset.show); if (!sh) return;
        if (sh.status + JSON.stringify(sh.images || {}) + JSON.stringify(sh.finals || []) !== el.dataset.sig) slides(sh);
      }, 1500);
      return { open, close, info, output, keyBox, cfBox, assetBox, slides, newShow, draftEditor, templateEditor, anyJob, buildFail, terminal, need };
    })();
    const drawer = { open: (w) => card.output(w), refresh() {}, setOffline() {} };
    window.addEventListener('hq-terminal', () => card.terminal());

    // ── Ari and Pulse, drawn by HQ (cleaner than the design's versions) ──
    const ui = (() => {
      const css = document.createElement('style');
      css.textContent = `
        #hqp{position:fixed;left:138px;right:138px;bottom:54px;height:416px;z-index:7;display:grid;grid-template-columns:1fr 1.25fr 1fr;gap:16px;color:#fff;font:14px/1.45 Geist,-apple-system,sans-serif;opacity:0;pointer-events:none;transition:opacity .5s}
        #hqp.on{opacity:1;pointer-events:auto}
        #hqp .col{border-radius:24px;padding:18px;background:rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.22);display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden}
        #hqp h4{margin:0;font-size:15px;font-weight:500;display:flex;align-items:center;gap:8px}
        #hqp .row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.08)}
        #hqp .row .t{flex:1;min-width:0}
        #hqp .row .s{font-size:12.5px;opacity:.7}
        #hqp .ok{color:#8fe3b4}#hqp .warn{color:#ffd27a}#hqp .bad{color:#ff9a8a}
        #hqp button{height:36px;padding:0 14px;border:0;border-radius:12px;cursor:pointer;font:500 13.5px Geist,-apple-system,sans-serif;background:#fff;color:#1d2128}
        #hqp button.g{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
        #hqp pre{flex:1;margin:0;min-height:0;overflow:auto;white-space:pre-wrap;font:12px/1.45 'Geist Mono',monospace;background:rgba(0,0,0,.35);border-radius:14px;padding:10px;scrollbar-width:none}
        #hqp input{flex:1;min-width:0;height:36px;border:0;border-radius:12px;padding:0 12px;background:rgba(255,255,255,.14);color:#fff;font:13px 'Geist Mono',monospace;outline:none}
        #hqp .chips{display:flex;gap:6px;flex-wrap:wrap}#hqp .chips button{height:28px;padding:0 10px;font-size:12px}
        #hqp .bar{height:8px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden}#hqp .bar i{display:block;height:100%;background:#fff;border-radius:4px}
        #hqa .goal{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.08);cursor:pointer}
        #hqa .box{width:20px;height:20px;flex:none;border-radius:7px;border:1.5px solid rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;font-size:13px}
        #hqa .goal.d{opacity:.45}#hqa .goal.d .box{background:#fff;color:#1d2128;border:0}
        #hqa .item{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.2);cursor:pointer}
        #hqa .item .s{font-size:12.5px;opacity:.7}
        #hqa .ms{font-family:'Material Symbols Rounded';font-size:20px;line-height:1}`;
      document.head.appendChild(css);
      const P = document.createElement('div'); P.id = 'hqp'; document.body.appendChild(P);
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
      const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
      const H = () => ({ 'Content-Type': 'application/json', 'x-hq-token': window.__hqToken || '' });
      let tFolder = 'Main folder', tJob = null, tLen = 0, tTimer = null, built = false;
      function buildPulse() {
        P.innerHTML = `<div class="col" id="hqp-merge"></div>
          <div class="col"><h4><span class="ms" style="font-family:'Material Symbols Rounded'">terminal</span>Terminal</h4>
            <div class="chips" id="hqp-folders"></div><pre id="hqp-out">Pick a folder, type a command, press Enter.\nTry: git status\n</pre>
            <div style="display:flex;gap:8px"><input id="hqp-in" placeholder="git status" /><button id="hqp-run">Run</button><button class="g" id="hqp-stop">Stop</button></div></div>
          <div class="col" id="hqp-builds"></div>`;
        const inp = P.querySelector('#hqp-in'), out = P.querySelector('#hqp-out');
        const poll = async () => { if (!tJob) return; const r = await (await fetch('/api/shell/job?id=' + tJob + '&from=' + tLen, { headers: H() })).json(); if (r.out) { out.textContent += r.out; tLen = r.len; out.scrollTop = out.scrollHeight; } if (r.done) { out.textContent += '\n[done' + (r.code ? ', exit ' + r.code : '') + ']\n'; out.scrollTop = out.scrollHeight; clearInterval(tTimer); tTimer = null; } };
        const run = async () => { const cmd = inp.value.trim(); if (!cmd) return; inp.value = '';
          const r = await (await fetch('/api/shell', { method: 'POST', headers: H(), body: JSON.stringify({ cmd, folder: tFolder }) })).json();
          if (!r.id) { out.textContent += '\n' + (r.error || 'Could not run') + '\n'; return; }
          out.textContent += '\nPS ' + tFolder + '> ' + cmd + '\n'; tJob = r.id; tLen = 0; clearInterval(tTimer); tTimer = setInterval(poll, 600); poll(); };
        inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') run(); };
        P.querySelector('#hqp-run').onclick = run;
        P.querySelector('#hqp-stop').onclick = () => tJob && fetch('/api/shell/stop', { method: 'POST', headers: H(), body: JSON.stringify({ id: tJob }) });
        P.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        fetch('/api/shell/list', { headers: H() }).then((r) => r.json()).then((L) => {
          const fs = P.querySelector('#hqp-folders'); const draw = () => { fs.innerHTML = (L.folders || []).map((f) => `<button class="${f === tFolder ? '' : 'g'}" data-f="${esc(f)}">${esc(f)}</button>`).join(''); fs.querySelectorAll('button').forEach((b) => (b.onclick = () => { tFolder = b.dataset.f; draw(); inp.placeholder = 'PS ' + tFolder + '>'; })); };
          if (!(L.folders || []).includes(tFolder)) tFolder = (L.folders || [])[0]; draw();
        }).catch(() => {});
        built = true;
      }
      function drawPulse(snap) {
        if (!built) buildPulse();
        const M = snap.mergeState || {}; const list = M.list || []; const W = snap.watchdog || {};
        const rows = list.map((m) => `<div class="row"><div class="t">${esc(m.window)}<div class="s ${m.ahead ? 'warn' : 'ok'}">${m.ahead ? m.ahead + ' new change' + (m.ahead === 1 ? '' : 's') + ' waiting' : '\u2713 In your app'}</div></div></div>`).join('');
        const allIn = !M.stuck && list.every((m) => !m.ahead) && !(M.leftovers || []).length;
        const mergeNeeds = (W.needs || []).filter((n) => /^(leftover|halfmerge|conflict|markers|types|dirty|wrongbranch|diverged|mergeerr|pull)/.test(n.key));
        const lm = M.lastMerge;
        const lastWd = (W.log || []).find((e) => e.area === 'merge');
        P.querySelector('#hqp-merge').innerHTML = `<h4><span class="ms" style="font-family:'Material Symbols Rounded'">merge</span>Your app</h4>
          ${mergeNeeds.length ? mergeNeeds.map((n) => `<div class="row" style="background:rgba(255,140,120,.18);display:block"><b>${esc(n.title)}</b><div class="s" style="opacity:.9;margin-top:3px">${esc(n.text)}</div></div>`).join('')
            : `<div class="row" style="background:${allIn ? 'rgba(143,227,180,.14)' : 'rgba(255,210,122,.14)'}"><div class="t"><b>${allIn ? 'Everything is in your app' : 'New work is waiting'}</b><div class="s">${allIn ? 'The Watchdog merges new work by itself, safely' : 'The Watchdog merges it when that window is done'}</div></div></div>`}
          ${rows}
          ${lastWd ? `<div class="s" style="font-size:12.5px;opacity:.75">Watchdog ${ago(lastWd.t)}: ${esc(lastWd.text)}</div>` : lm ? `<div class="s" style="font-size:12.5px;opacity:.75">Last merge ${ago(lm.at)}: ${esc(lm.text)}</div>` : ''}
          <div style="margin-top:auto;display:flex;gap:8px"><button id="hqp-mergebtn" class="${allIn ? 'g' : ''}">Merge now</button></div>`;
        P.querySelector('#hqp-mergebtn').onclick = mergeNow;
        const runs = snap.runs || []; const r0 = runs[0]; const u = snap.usage || {};
        P.querySelector('#hqp-builds').innerHTML = `<h4><span class="ms" style="font-family:'Material Symbols Rounded'">deployed_code</span>iOS builds</h4>
          ${r0 ? `<div class="row"><div class="t">${esc(r0.wf)} · ${esc(r0.br)}<div class="s ${r0.st === 'failed' ? 'bad' : r0.st === 'done' ? 'ok' : 'warn'}">${r0.st === 'running' ? 'Building… ' + ago(r0.at) : r0.st === 'done' ? '✓ Built ' + ago(r0.at) + '. Install it on your phone.' : 'Failed: ' + esc(r0.note || '')}</div></div>${r0.st === 'failed' ? '<button class="g" id="hqp-why">Why</button>' : ''}</div>` : '<div class="row"><div class="t s">No builds yet</div></div>'}
          ${runs.slice(1, 3).map((r) => `<div class="s" style="font-size:12.5px">${r.st === 'failed' ? '✕' : r.st === 'done' ? '✓' : '●'} ${esc(r.br)} · ${ago(r.at)}</div>`).join('')}
          <button id="hqp-build">Start a new build</button>
          <h4 style="margin-top:6px"><span class="ms" style="font-family:'Material Symbols Rounded'">data_usage</span>Claude usage ${u.pct || 0}%</h4>
          <div class="bar"><i style="width:${Math.min(100, u.pct || 0)}%"></i></div>
          <div class="s" style="font-size:12.5px">${u.hit ? 'You hit the limit. ' : ''}${u.resetAt ? 'Resets ' + new Date(u.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'No use in the last 5 hours'}</div>
          <div class="s" style="font-size:11.5px;opacity:.55">Counts Claude Code only. Chats on claude.ai use the same limit but HQ can't see them${u.guessed ? '. Gets exact after you hit the limit once' : ''}.</div>`;
        P.querySelector('#hqp-build').onclick = startBuild;
        const why = P.querySelector('#hqp-why'); if (why) why.onclick = () => card.buildFail(r0);
      }
      // ── Ari: a side panel (the city stays visible and clickable) ──
      // Built like an agent inbox: 1) what needs you, each with ONE button, 2) today's goals that
      // Claude picks from what really happened, 3) one honest line per window.
      const A = document.createElement('div'); A.id = 'hqari'; document.body.appendChild(A);
      const acss = document.createElement('style');
      acss.textContent = `
        #hqari{position:fixed;left:110px;top:96px;bottom:28px;width:410px;z-index:8;color:#fff;font:14px/1.45 Geist,-apple-system,sans-serif;border-radius:30px;padding:20px;box-sizing:border-box;
          background:rgba(40,48,58,.42);backdrop-filter:blur(26px) saturate(1.4);-webkit-backdrop-filter:blur(26px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 20px 60px rgba(0,0,0,.18);
          display:flex;flex-direction:column;gap:14px;overflow:auto;scrollbar-width:none;transform:translateX(-30px);opacity:0;pointer-events:none;transition:opacity .35s,transform .35s}
        #hqari.on{opacity:1;transform:none;pointer-events:auto}
        #hqari h2{margin:0;font-size:24px;font-weight:500;letter-spacing:-.02em}
        #hqari h3{margin:4px 0 0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.6;display:flex;align-items:center;gap:8px}
        #hqari .x{margin-left:auto;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:14px}
        #hqari .tag{height:24px;padding:0 10px;border-radius:999px;background:rgba(255,255,255,.14);display:inline-flex;align-items:center;font-size:12px;margin-right:6px}
        #hqari .card{border-radius:18px;padding:12px 14px;background:rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.2);display:flex;gap:12px;align-items:flex-start}
        #hqari .card.red{background:rgba(255,120,100,.22)}#hqari .card.yel{background:rgba(255,205,110,.18)}
        #hqari .card .t{flex:1;min-width:0}#hqari .card .s{font-size:12.5px;opacity:.75;margin-top:2px}
        #hqari .ms{font-family:'Material Symbols Rounded';font-size:20px;line-height:1.2}
        #hqari button.b{height:32px;padding:0 12px;border:0;border-radius:11px;background:#fff;color:#1d2128;font:500 13px Geist,-apple-system,sans-serif;cursor:pointer;margin-top:8px}
        #hqari button.g{background:rgba(255,255,255,.16);color:#fff}
        #hqari .goal{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.08);cursor:pointer}
        #hqari .goal.d{opacity:.45}#hqari .goal.d .gt{text-decoration:line-through}
        #hqari .box{width:20px;height:20px;flex:none;border-radius:7px;border:1.5px solid rgba(255,255,255,.65);display:flex;align-items:center;justify-content:center;font-size:13px;margin-top:1px}
        #hqari .goal.d .box{background:#fff;color:#1d2128;border:0}
        #hqari .who{font-size:11.5px;opacity:.6}
        #hqari .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden}#hqari .bar i{display:block;height:100%;background:#fff}
        #hqari .win{display:flex;gap:10px;align-items:center;font-size:13.5px}
        #hqari .dot{width:9px;height:9px;border-radius:50%;flex:none}
        #hqari .spin{width:11px;height:11px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:hqspin .8s linear infinite;flex:none}
        @keyframes hqspin{to{transform:rotate(360deg)}}
        #hqari input{width:100%;box-sizing:border-box;height:38px;border:0;border-radius:12px;padding:0 12px;background:rgba(255,255,255,.13);color:#fff;font:13.5px Geist,-apple-system,sans-serif;outline:none}
        #hqari input::placeholder{color:rgba(255,255,255,.55)}`;
      document.head.appendChild(acss);
      const tm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      let ariKey = '';
      function inbox(snap) {
        const W = snap.watchdog || {}; const out = [];
        for (const n of W.needs || []) out.push({ c: n.level === 'urgent' ? 'red' : n.level === 'warn' ? 'yel' : '', i: n.level === 'urgent' ? 'error' : 'shield', t: n.title, s: n.text, b: n.button ? n.button.label : (n.steps || n.code || n.lines) ? 'Show me how' : '', go: () => (n.button && !(n.steps || n.code) ? post('/api/watchdog', { name: n.button.action, arg: n.button.arg }) : card.need(n)) });
        for (const t of c.state.tests || []) out.push({ c: '', i: 'phone_iphone', t: 'Test ' + t.from + '\u2019s work on your phone', s: t.checks.length + ' things to check' + (t.title ? ': ' + t.title : ''), b: 'Open the test list', go: () => { c.setState({ focus: null }); c.openBuilding('lab'); } });
        const ph = W.phone || {};
        if (ph.step === 'install') out.push({ c: 'yel', i: 'install_mobile', t: 'Install the new build', s: ph.text, b: 'I installed it', go: () => post('/api/watchdog', { name: 'installed' }) });
        const u = snap.usage || {}; if (u.hit) out.push({ c: '', i: 'hourglass', t: 'Claude limit hit', s: 'Windows wait and keep going by themselves at ' + tm(u.resetAt) + '.', b: '', go: null });
        return out;
      }
      function winLine(s) {
        const raw = s._raw || {}; const what = s.title || s.name;
        if (raw.status === 'limit') return { d: '#ffcf70', t: 'Paused by the Claude limit', s: String(raw.doing || '').replace('Hit the Claude limit. ', '') };
        if (s.status === 'working') return { spin: true, t: 'Working: ' + (raw.title || raw.jobLine || what), s: raw.doing || '' };
        if (s.status === 'needs') return { d: '#ffcf70', t: 'Waiting for your answer', s: raw.doing || '' };
        if (s.status === 'testing' || s.status === 'done') return { d: '#8fe3b4', t: 'Done: ' + (raw.jobLine || raw.title || what), s: 'Finished ' + tm(raw.lastEvent || Date.now()) };
        return { d: 'rgba(255,255,255,.4)', t: 'Free', s: 'Give it a job' };
      }
      function drawAri(force) {
        const snap = last; if (!snap) return;
        const plan = snap.plan || {}; const today = plan.todayTasks || []; const dn = today.filter((t) => t.done).length;
        const items = inbox(snap); const rp = plan.replan || {};
        const did = ((snap.watchdog || {}).log || []).filter((e) => e.kind !== 'see').slice(0, 5);
        const wins = (c.state.sessions || []).filter((x) => /^Window [A-Z]$/.test(x.name));
        const key = JSON.stringify([today, did.map((e) => e.t + e.text), items.map((x) => x.t + x.s), wins.map((w) => [w.status, w._raw && w._raw.status, w._raw && w._raw.doing, w.title]), rp, plan.planned, (plan.next || []).map((x) => x.id)]);
        if (!force && key === ariKey) return; ariKey = key;
        const hr = new Date().getHours();
        A.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px"><div><h2>${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, Ari</h2>
            <div style="margin-top:8px">${plan.launch ? `<span class="tag">${plan.daysToLaunch} days to launch</span><span class="tag">Send to Apple in ${plan.daysToSubmit} days</span>` : ''}</div></div>
            <button class="x" data-a="close">✕</button></div>
          <h3>Needs you${items.length ? ' · ' + items.length : ''}</h3>
          ${items.length ? items.map((x, i) => `<div class="card ${x.c}"><span class="ms">${x.i}</span><div class="t"><div>${esc(x.t)}</div><div class="s">${esc(x.s)}</div>${x.b ? `<button class="b" data-i="${i}">${esc(x.b)}</button>` : ''}</div></div>`).join('')
            : '<div class="card"><span class="ms">check_circle</span><div class="t">Nothing needs you right now<div class="s">Work on today’s goals below</div></div></div>'}
          ${did.length ? `<h3>What HQ did by itself</h3>${did.map((e) => `<div class="win"><span class="dot" style="background:${e.kind === 'error' || e.kind === 'trip' ? '#ff9a8a' : e.kind === 'would' ? 'rgba(255,255,255,.45)' : '#8fe3b4'}"></span><div style="flex:1;min-width:0">${esc(e.text)}<div class="who">${tm(e.t)}</div></div></div>`).join('')}` : ''}
          <h3>Today’s goals · ${dn} of ${today.length}</h3>
          <div class="bar"><i style="width:${today.length ? Math.round(dn / today.length * 100) : 0}%"></i></div>
          ${plan.planned && plan.planned.why ? `<div style="font-size:12.5px;opacity:.75">${esc(plan.planned.why)}</div>` : ''}
          ${today.map((t) => `<div class="goal ${t.done ? 'd' : ''}" data-g="${esc(t.id)}"><span class="box" data-check="1">${t.done ? '✓' : ''}</span><div style="flex:1"><div class="gt">${esc(t.t)}</div>${t.sub ? `<div class="who">${esc(t.sub)}</div>` : ''}<div class="who">${t.who === 'ai' ? 'A window does this' : t.who === 'dad' ? 'Needs Dad' : 'You'}</div></div><span class="ms" style="opacity:.5">chevron_right</span></div>`).join('') || '<div class="card"><div class="t s">No goals yet. Press Plan my day.</div></div>'}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="b ${rp.running ? 'g' : ''}" data-a="replan" style="margin:0">${rp.running ? 'Planning…' : 'Plan my day'}</button>
            <span style="font-size:12px;opacity:.65;flex:1">${rp.running ? 'Claude is looking at what really happened' : rp.error ? esc(rp.error) : plan.planned ? 'Planned ' + tm(plan.planned.at) + ' from what really happened' : 'Picks today’s goals from your real progress'}</span></div>
          <h3>Your windows</h3>
          ${wins.map((w) => { const l = winLine(w); return `<div class="win">${l.spin ? '<span class="spin"></span>' : `<span class="dot" style="background:${l.d}"></span>`}<div style="flex:1;min-width:0"><b style="font-weight:500">${esc(w.name)}</b> · ${esc(l.t)}${l.s ? `<div class="who" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.s)}</div>` : ''}</div></div>`; }).join('') || '<div class="who">No windows open</div>'}
          ${(plan.next || []).length ? `<h3>Coming up</h3>${plan.next.slice(0, 3).map((t) => `<div class="goal" data-n="${esc(t.id)}" style="opacity:.8"><div style="flex:1"><div>${esc(t.t)}</div><div class="who">${t.day ? new Date(t.day + 'T12:00').toLocaleDateString([], { weekday: 'long' }) : ''}</div></div></div>`).join('')}` : ''}
          <div id="hqari-add"></div>`;
        if (!addInp) { addInp = document.createElement('input'); addInp.placeholder = 'Add your own goal for today, press Enter';
          addInp.onkeydown = async (e) => { e.stopPropagation(); if (e.key === 'Enter' && addInp.value.trim()) { await post('/api/plan/add', { text: addInp.value.trim() }); addInp.value = ''; } }; }
        A.querySelector('#hqari-add').appendChild(addInp);
        A.querySelector('[data-a=close]').onclick = () => c.setState({ focus: null });
        A.querySelector('[data-a=replan]').onclick = async () => { if (rp.running) return; const r = await post('/api/replan', {}); if (r.error) c.toast(r.error, 'error'); };
        A.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => items[Number(b.dataset.i)].go()));
        const all = plan.tasks || [];
        A.querySelectorAll('[data-g]').forEach((g) => (g.onclick = async (e) => { const id = g.dataset.g; const t = today.find((x) => x.id === id);
          if (e.target.closest('[data-check]')) { await post('/api/plan/done', { id, done: !t.done }); return; } card.open(all.find((x) => x.id === id) || t); }));
        A.querySelectorAll('[data-n]').forEach((n) => (n.onclick = () => card.open(all.find((x) => x.id === n.dataset.n))));
      }
      let addInp = null;

      // ── Test Lab: tell HQ what you found (Talk or type) → one prompt per window → send → UFO flies home ──
      const L = document.createElement('div'); L.id = 'hqlab'; document.body.appendChild(L);
      const lcss = document.createElement('style');
      lcss.textContent = `
        #hqlab{position:fixed;right:98px;top:120px;bottom:28px;width:min(440px,calc(100vw - 560px));min-width:340px;z-index:8;color:#fff;font:14px/1.45 Geist,-apple-system,sans-serif;border-radius:30px;padding:20px;box-sizing:border-box;
          background:rgba(40,48,58,.42);backdrop-filter:blur(26px) saturate(1.4);-webkit-backdrop-filter:blur(26px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 20px 60px rgba(0,0,0,.18);
          display:flex;flex-direction:column;gap:12px;overflow:auto;scrollbar-width:none;opacity:0;pointer-events:none;transform:translateX(30px);transition:opacity .35s,transform .35s}
        #hqlab.on{opacity:1;pointer-events:auto;transform:none}
        #hqlab h2{margin:0;font-size:22px;font-weight:500;letter-spacing:-.02em}
        #hqlab .s{font-size:12.5px;opacity:.72}
        #hqlab textarea{width:100%;box-sizing:border-box;border:0;border-radius:16px;padding:12px 14px;background:rgba(255,255,255,.13);color:#fff;font:14px/1.5 Geist,-apple-system,sans-serif;outline:none;resize:none}
        #hqlab textarea::placeholder{color:rgba(255,255,255,.55)}
        #hqlab .main{flex:1;min-height:140px}
        #hqlab .row{display:flex;gap:8px;align-items:center}
        #hqlab button{height:42px;padding:0 16px;border:0;border-radius:14px;cursor:pointer;font:500 14px Geist,-apple-system,sans-serif;background:#fff;color:#1d2128;display:inline-flex;align-items:center;gap:8px}
        #hqlab button.g{background:rgba(255,255,255,.16);color:#fff}
        #hqlab button:disabled{opacity:.5;cursor:default}
        #hqlab .talk.rec{background:#e5484d;color:#fff;animation:hqpulse 1.2s ease-in-out infinite}
        @keyframes hqpulse{50%{box-shadow:0 0 0 8px rgba(229,72,77,.25)}}
        #hqlab .ms{font-family:'Material Symbols Rounded';font-size:20px;line-height:1}
        #hqlab .win{border-radius:18px;padding:12px;background:rgba(255,255,255,.09);display:flex;flex-direction:column;gap:8px}
        #hqlab .win textarea{min-height:150px;font-size:12.5px;line-height:1.45;background:rgba(0,0,0,.22)}
        #hqlab .spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:hqspin .8s linear infinite;display:inline-block;vertical-align:-2px}`;
      document.head.appendChild(lcss);
      let lab = { stage: 'write', busy: '', error: '', result: null, draft: '' };
      try { lab.draft = localStorage.getItem('hq-lab-draft') || ''; } catch (e) {}
      const saveDraft = (t) => { lab.draft = t; try { localStorage.setItem('hq-lab-draft', t); } catch (e) {} };
      // Recording: raw mic sound → 16 kHz mono WAV → Whisper on your PC → words.
      const rec = { on: false };
      async function recStart() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1); const bufs = [];
        proc.onaudioprocess = (e) => bufs.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        src.connect(proc); proc.connect(ctx.destination);
        Object.assign(rec, { on: true, stream, ctx, src, proc, bufs, rate: ctx.sampleRate, started: Date.now() });
        window.__hqRecording = true;
        rec.timer = setTimeout(() => rec.on && recStop(), 5 * 60 * 1000); // 5 minutes max
      }
      function toWav(bufs, rate) {
        let n = 0; for (const b of bufs) n += b.length;
        const all = new Float32Array(n); let o = 0; for (const b of bufs) { all.set(b, o); o += b.length; }
        const ratio = rate / 16000; const len = Math.floor(n / ratio); const pcm = new Int16Array(len);
        for (let i = 0; i < len; i++) { // average the samples that fall into each 16 kHz step
          const a = Math.floor(i * ratio), z = Math.min(n, Math.floor((i + 1) * ratio)); let sum = 0; for (let j = a; j < z; j++) sum += all[j];
          const v = Math.max(-1, Math.min(1, sum / Math.max(1, z - a))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        const buf = new ArrayBuffer(44 + pcm.length * 2); const d = new DataView(buf);
        const str = (p, t) => { for (let i = 0; i < t.length; i++) d.setUint8(p + i, t.charCodeAt(i)); };
        str(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
        d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, pcm.length * 2, true);
        new Int16Array(buf, 44).set(pcm); return new Blob([buf], { type: 'audio/wav' });
      }
      window.__hqToWav = toWav; // (for tests)
      async function recStop() {
        clearTimeout(rec.timer); rec.on = false; window.__hqRecording = false;
        try { rec.src.disconnect(); rec.proc.disconnect(); } catch (e) {}
        rec.stream.getTracks().forEach((t) => t.stop()); rec.ctx.close().catch(() => {});
        if (Date.now() - rec.started < 600) { lab.busy = ''; drawLab(); return; }
        lab.busy = 'Writing down what you said…'; lab.error = ''; drawLab();
        try {
          const r = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-hq-token': window.__hqToken || '' }, body: toWav(rec.bufs, rec.rate) });
          const j = await r.json();
          if (j.busy) lab.error = j.busy + '. Try again in a minute (your recording is safe to redo).';
          else if (j.error) lab.error = j.error;
          else if (!j.text) lab.error = 'I didn’t hear anything. Check your microphone and try again.';
          else saveDraft((lab.draft ? lab.draft.replace(/\s*$/, '') + ' ' : '') + j.text);
        } catch (e) { lab.error = 'The Talk button had a problem: ' + e.message; }
        lab.busy = ''; drawLab();
      }
      async function talk() {
        if (rec.on) return recStop();
        lab.error = '';
        try { await recStart(); drawLab(); } catch (e) { lab.error = 'HQ can’t use your microphone: ' + (e.message || e.name) + '. Check Windows Settings → Privacy → Microphone.'; drawLab(); }
      }
      async function split() {
        const ta = L.querySelector('.main'); if (ta) saveDraft(ta.value);
        if (!lab.draft.trim()) { lab.error = 'Press Talk and say what you found first.'; return drawLab(); }
        lab.busy = 'Claude is turning that into prompts for Window A and B… (about a minute)'; lab.error = ''; drawLab();
        const r = await post('/api/feedback', { text: lab.draft });
        lab.busy = '';
        if (r.error) lab.error = r.error; else { lab.result = r; lab.stage = 'review'; }
        drawLab();
      }
      async function sendAll() {
        const pick = (k) => { const t = L.querySelector('[data-p=' + k + ']'); return lab.result[k] && t && t.value.trim() ? { title: lab.result[k].title, prompt: t.value } : null; };
        const body = { A: pick('A'), B: pick('B') };
        if (!body.A && !body.B) { lab.error = 'Both prompts are empty.'; return drawLab(); }
        lab.busy = 'Sending…'; drawLab();
        const r = await post('/api/feedback/send', body);
        const res = Object.values(r.sent || {});
        if (!res.length || res.every((v) => v !== 'started' && v !== 'queued')) { lab.busy = ''; lab.error = 'Couldn\u2019t send: ' + (res.join(' ') || r.error || 'unknown problem') + ' Your prompts are still here.'; return drawLab(true); }
        const said = Object.entries(r.sent || {}).map(([k, v]) => 'Window ' + k + (v === 'started' ? ' started' : v === 'queued' ? ' will start when it’s free' : ': ' + v)).join(', ');
        c.toast('Sent. ' + said + '.', 'send');
        lab = { stage: 'write', busy: '', error: '', result: null, draft: '' }; saveDraft('');
        setTimeout(() => c.closeBuilding(), 600); // the UFO flies home
      }
      let labKey = '';
      function drawLab(force) {
        const k = JSON.stringify([lab.stage, lab.busy, lab.error, !!lab.result, rec.on]);
        if (!force && k === labKey) return; labKey = k;
        if (lab.stage === 'review' && lab.result) {
          const R2 = lab.result;
          L.innerHTML = `<h2>Check the prompts</h2><div class="s">HQ heard: ${esc(R2.heard)}</div>
            ${['A', 'B'].filter((x) => R2[x]).map((x) => `<div class="win"><b>Window ${x} · ${esc(R2[x].title)}</b><textarea data-p="${x}">${esc(R2[x].prompt)}</textarea></div>`).join('')}
            ${['A', 'B'].filter((x) => !R2[x]).map((x) => `<div class="s">Window ${x}: nothing to fix from this.</div>`).join('')}
            ${(R2.unsure || []).length ? `<div class="win"><b>Not sure about</b>${R2.unsure.map((u) => `<div class="s">• ${esc(u)}</div>`).join('')}<div class="s">Fix the prompt above if HQ got it wrong.</div></div>` : ''}
            ${lab.error ? `<div class="s" style="color:#ffb4a6;opacity:1">${esc(lab.error)}</div>` : ''}
            <div class="row"><button data-a="send" ${lab.busy ? 'disabled' : ''}><span class="ms">send</span>${lab.busy ? esc(lab.busy) : 'Send to the windows'}</button><button class="g" data-a="back">Back</button></div>`;
          L.querySelector('[data-a=send]').onclick = sendAll;
          L.querySelector('[data-a=back]').onclick = () => { lab.stage = 'write'; drawLab(true); };
          return;
        }
        L.innerHTML = `<h2>What did you find?</h2>
          <div class="s">Test the app, then press Talk and say everything: what’s broken, what looks wrong, what you want changed. HQ splits it into prompts for Window A and B and adds your test logs.</div>
          <textarea class="main" placeholder="Press Talk, or type here…">${esc(lab.draft)}</textarea>
          ${lab.busy ? `<div class="s" style="opacity:1"><span class="spin"></span> ${esc(lab.busy)}</div>` : ''}
          ${lab.error ? `<div class="s" style="color:#ffb4a6;opacity:1">${esc(lab.error)}</div>` : ''}
          <div class="row"><button class="talk ${rec.on ? 'rec' : 'g'}" data-a="talk" ${lab.busy ? 'disabled' : ''}><span class="ms">${rec.on ? 'stop' : 'mic'}</span>${rec.on ? 'Stop' : 'Talk'}</button>
            <button data-a="split" ${lab.busy || rec.on ? 'disabled' : ''} style="flex:1;justify-content:center"><span class="ms">auto_awesome</span>Make the prompts</button></div>
          <div class="s">${rec.on ? 'Listening… press Stop when you’re done.' : 'Uses a little of your Claude limit (one short Sonnet message). Talking is free and stays on your PC.'}</div>`;
        const ta = L.querySelector('.main');
        ta.oninput = () => saveDraft(ta.value);
        ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) split(); };
        L.querySelector('[data-a=talk]').onclick = talk;
        L.querySelector('[data-a=split]').onclick = split;
      }
      L.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      L.addEventListener('keydown', (e) => e.stopPropagation());
      function syncLab() {
        const on = c.state.bld === 'lab' && c.state.bldOpen && !c.state.focus;
        if (on && !L.classList.contains('on')) { drawLab(true); L.classList.add('on'); }
        if (!on && L.classList.contains('on')) { L.classList.remove('on'); if (rec.on) recStop(); }
      }

      function sync() {
        try { syncLab(); } catch (e) { console.error('HQ Test Lab:', e); }
        const on = c.state.layer === 4 && !c.state.focus && !c.state.bld;
        P.classList.toggle('on', on);
        if (on && last && last !== drawnSnap) { drawnSnap = last; drawPulse(last); }
        if (!on) drawnSnap = null;
        const ariOn = c.state.focus === 'pilot';
        try { if (ariOn && !A.classList.contains('on')) { drawAri(true); A.classList.add('on'); } else if (ariOn) drawAri(false); }
        catch (e) { console.error('HQ Ari panel:', e && e.stack || e); A.classList.add('on'); }
        if (!ariOn) A.classList.remove('on');
      }
      let drawnSnap = null;
      setInterval(sync, 300);
      return { refresh() {} };
    })();
    open();
  }

  // ── "Output" drawer: full output, summary, tests, merge commands, logs ──
  function makeDrawer(getSnap) {
    const css = document.createElement('style');
    css.textContent = `
      #hqd-btn{display:none!important}
      #hqd-btn-x{position:fixed;left:18px;bottom:18px;z-index:99990;height:44px;padding:0 16px;border-radius:22px;border:1px solid rgba(255,255,255,.35);background:rgba(20,24,32,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#fff;font:600 14px Geist,-apple-system,sans-serif;cursor:pointer;display:flex;align-items:center;gap:8px}
      #hqd-btn .d{width:8px;height:8px;border-radius:50%;background:#46d68b}
      #hqd-btn.off .d{background:#ff6b5e}
      #hqd{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);z-index:99991;background:rgba(14,17,23,.94);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);color:#eef1f5;font:14px/1.5 Geist,-apple-system,sans-serif;transform:translateX(105%);transition:transform .35s cubic-bezier(.22,1,.36,1);display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,.1)}
      #hqd.open{transform:none}
      #hqd header{display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
      #hqd header b{font-size:16px;margin-right:auto}
      #hqd button{font:inherit;color:inherit;cursor:pointer}
      .hqd-tab{height:36px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:transparent}
      #hqd .hqd-tab.on{background:#eef1f5;color:#0e1117;border-color:#eef1f5}
      .hqd-x{width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:transparent}
      #hqd main{flex:1;overflow:auto;padding:16px 18px 40px}
      .hqd-h{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9aa3af;margin:18px 0 8px;font-weight:600}
      .hqd-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 14px;white-space:pre-wrap;word-break:break-word}
      .hqd-msg{padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);white-space:pre-wrap;word-break:break-word}
      .hqd-msg .r{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px}
      .hqd-you .r{color:#8fc2ff}.hqd-claude .r{color:#46d68b}.hqd-tool{color:#9aa3af;font-size:12.5px;padding:3px 0;font-family:ui-monospace,Menlo,monospace}
      #hqd .hqd-copy{margin-top:8px;height:36px;padding:0 12px;border-radius:10px;border:0;background:#eef1f5;color:#0e1117;font-weight:600}
      .hqd-mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
      .hqd-err{color:#ffb3aa}
      #hqd textarea{width:100%;box-sizing:border-box;min-height:90px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04);color:#eef1f5;padding:10px;font:inherit}
    `;
    document.head.appendChild(css);
    const btn = document.createElement('button');
    btn.id = 'hqd-btn'; btn.type = 'button'; btn.innerHTML = '<span class="d"></span>Output';
    const el = document.createElement('aside');
    el.id = 'hqd'; el.setAttribute('aria-label', 'HQ output');
    document.body.appendChild(btn); document.body.appendChild(el);
    let tab = 'output', win = null, cache = null, isOpen = false;
    btn.onclick = () => { isOpen = !isOpen; el.classList.toggle('open', isOpen); if (isOpen) render(true); };
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

    async function render(fetchTranscript) {
      const snap = getSnap(); if (!snap) { el.innerHTML = '<main>Connecting…</main>'; return; }
      const wins = snap.sessions.map((s) => s.window);
      if (!win || !wins.includes(win)) win = wins[0] || null;
      const tabs = ['output', 'merge', 'logs'].map((t) => `<button type="button" class="hqd-tab ${tab === t ? 'on' : ''}" data-tab="${t}">${{ output: 'Output', merge: 'Merge', logs: 'Logs' }[t]}</button>`).join('');
      let body = '';
      if (tab === 'output') {
        const winBtns = wins.map((w) => `<button type="button" class="hqd-tab ${w === win ? 'on' : ''}" data-win="${esc(w)}">${esc(w)}</button>`).join(' ') || 'No windows yet. Start a chat in VS Code.';
        if (fetchTranscript && win) { try { cache = await (await fetch('/api/transcript?window=' + encodeURIComponent(win))).json(); } catch { cache = null; } }
        const s = snap.sessions.find((x) => x.window === win);
        body = `<div>${winBtns}</div>`;
        if (s) {
          body += `<div class="hqd-h">Message ${esc(win)}</div><textarea id="hqd-msg" placeholder="Type a job or feedback. If ${esc(win)} is working, it waits and sends when it finishes. Your latest test logs are added for you."></textarea><button type="button" class="hqd-copy" id="hqd-send">Send to ${esc(win)}</button>`;
          body += `<div class="hqd-h">Summary (its last message)</div><div class="hqd-card">${esc(s.lastReply || 'No finished job yet.')}</div>`;
          if (s.tests && s.tests.length) body += `<div class="hqd-h">What to test</div><div class="hqd-card">${s.tests.map((t, i) => (i + 1) + '. ' + esc(t)).join('\n')}</div>`;
          if (s.queue && s.queue.length) body += `<div class="hqd-h">Waiting to send (${s.queue.length})</div><div class="hqd-card">${s.queue.map((q) => esc(firstLine(q))).join('\n')}</div><button type="button" class="hqd-tab" id="hqd-clear">Clear queue</button>`;
          const msgs = (cache && cache.window === win && cache.messages) || [];
          body += `<div class="hqd-h">Full output (${msgs.length})</div>` + (msgs.length ? msgs.slice().reverse().map((m) => m.role === 'tool' ? `<div class="hqd-tool">› ${esc(m.text)}</div>` : `<div class="hqd-msg hqd-${m.role}"><div class="r">${m.role === 'you' ? 'You' : 'Claude'}</div>${esc(m.text)}</div>`).join('') : '<div class="hqd-card">Nothing yet.</div>');
        }
      } else if (tab === 'merge') {
        const ms = snap.merges || [];
        body = ms.length ? ms.map((m, i) => `<div class="hqd-h">${esc(m.window)} · ${esc(m.branch)}</div><div class="hqd-card">${m.ahead ? `${m.ahead} new commit${m.ahead === 1 ? '' : 's'} to merge.\nLatest: ${esc(m.last)}` : 'Nothing new to merge.'}</div>${m.ahead ? `<div class="hqd-card hqd-mono" style="margin-top:8px">${esc(m.cmd)}</div><button type="button" class="hqd-copy" data-copy="${i}">Copy commands</button>` : ''}`).join('') : '<div class="hqd-card">Merge info shows up once "git" is set in hq.config.json.</div>';
      } else {
        const L = snap.logs || {};
        body = `<div class="hqd-h">Latest test logs</div><div class="hqd-card hqd-mono">${esc(L.file || 'No logs yet. Start the app with npm run dev and test on your phone.')}</div>`;
        body += `<div class="hqd-h">Errors in the last test (${L.errorCount || 0})</div><div class="hqd-card hqd-mono hqd-err">${esc((L.errors || []).join('\n') || 'None.')}</div>`;
        body += `<div class="hqd-h">How this works</div><div class="hqd-card">Every message you send from HQ gets this log file added, so Claude Code can search it. Old test logs are kept in the logs-archive folder.</div>`;
      }
      el.innerHTML = `<header><b>HQ</b>${tabs}<button type="button" class="hqd-x" aria-label="Close" id="hqd-close">✕</button></header><main>${body}</main>`;
      el.querySelector('#hqd-close').onclick = () => { isOpen = false; el.classList.remove('open'); };
      el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(tab === 'output'); }));
      el.querySelectorAll('[data-win]').forEach((b) => (b.onclick = () => { win = b.dataset.win; render(true); }));
      el.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { const m = (getSnap().merges || [])[Number(b.dataset.copy)]; if (m && (await copy(m.cmd))) b.textContent = 'Copied'; }));
      const send = el.querySelector('#hqd-send');
      if (send) send.onclick = async () => {
        const ta = el.querySelector('#hqd-msg'); const t = ta.value.trim(); if (!t) return;
        const r = await post('/api/queue', { window: win, text: t });
        if (r.started) { send.textContent = 'Started.'; ta.value = ''; }
        else if (r.queued) { send.textContent = 'Busy. Starts when it finishes.'; ta.value = ''; }
        else if (r.copy) { const ok = await copy(r.text); send.textContent = ok ? 'Copied. Paste it into ' + win + '.' : 'Copy failed'; }
      };
      const clear = el.querySelector('#hqd-clear');
      if (clear) clear.onclick = async () => { await post('/api/queue/clear', { window: win }); };
    }
    let lastKey = '';
    return {
      refresh(snap) {
        if (!isOpen) return;
        // Don't wipe what you're typing.
        const typing = document.activeElement && document.activeElement.id === 'hqd-msg';
        const key = JSON.stringify([snap.sessions.map((s) => [s.window, s.status, s.lastReply.length, s.queue.length, s.tests.length]), snap.merges, snap.logs && snap.logs.errorCount]);
        if (typing || key === lastKey) return; lastKey = key; render(tab === 'output');
      },
      open(w) { if (w) win = w; tab = 'output'; isOpen = true; el.classList.add('open'); render(true); },
      setOffline(off) { btn.classList.toggle('off', off); btn.lastChild.textContent = off ? 'HQ is off' : 'Output'; },
    };
  }

  window.HQLive = { connect, _test: { mapSession, mapEvents, mapProjects, letter } };
})();
