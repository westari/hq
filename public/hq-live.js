// HQ-LIVE — connects the city design to the real HQ engine (server.js).
// The design (HQ.dc.html) only needs two small hooks, marked "HQ-LIVE".
// Everything that turns real data into the design's shapes lives here,
// so you can redesign the city in Claude Design without losing the wiring.
(function () {
  const STATUS = { working: 'working', 'needs-you': 'needs', idle: 'idle', ended: 'idle' };
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
    const sentences = plain(clean).split(/(?<=[.!?:])\s+|\n/).map((x) => x.replace(/[.!?:]+$/, '').replace(/^(please|ok|okay|hey|so|now|also)[, ]+/i, '').trim());
    let t = sentences.find((x) => x.split(' ').filter((w) => /[a-z]{2}/i.test(w)).length >= 3) || '';
    if (!t) return 'Your prompt';
    const words = t.split(' ').slice(0, 7).join(' ');
    return words.length < t.length ? words + '…' : words;
  }
  function summarize(reply) {
    const hq = /^\s*HQ:\s*(.+)$/im.exec(reply || '');
    if (hq) return short(hq[1], 220);
    const p = plain(reply);
    const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
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
    const title = s.title || shortTitle(s.prompt) || 'No job yet';
    const fileMatch = /(Editing|Writing|Reading)\s+(\S+)/.exec(s.doing || '');
    const timeline = (s.actions || []).map((a, i) => { const [k, pose] = actKind(a.text); return { k, label: a.text, pose, id: id + '-' + (s.actions.length - i), at: a.t }; });
    const nowStep = steps.find((x) => x.s === 'doing' || x.s === 'blocked');
    const doneN = steps.filter((x) => x.s === 'done').length;
    const working = status === 'working' || status === 'needs';
    const summary = working
      ? title + '.' + (nowStep ? ' Step ' + (doneN + 1) + ' of ' + steps.length + ': ' + nowStep.t + '.' : '')
      : s.lastReply ? summarize(s.lastReply) : 'Nothing right now. It’s free for a new job.';
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
    const syncSound = () => { document.documentElement.dataset.hqSound = c.state.sound === false ? '0' : '1'; };
    window.addEventListener('hq-toggle-sound', () => { c.setState({ sound: c.state.sound === false }, syncSound); });
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
      pu.upload = () => { window.open('https://github.com/' + ((last.config && last.config.githubRepo) || 'westari/FormPal') + '/actions', '_blank'); c.toast('Opening your builds on GitHub', 'open_in_new'); };
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
          meta: ready ? (m.files || 0) + ' files · ' + m.ahead + ' commits not merged' : 'All merged',
          cta: ready ? 'Copy merge' : 'Merged', icon: ready ? 'merge' : 'done_all',
          bg: ready ? '#ffffff' : 'rgba(255,255,255,0.14)', fg: ready ? '#1d2128' : '#ffffff',
          go: async () => { if (!ready) return; const ok = await copy(m.cmd); c.toast(ok ? 'Merge commands copied. Paste in PowerShell.' : 'Open Output > Merge to copy', 'content_paste'); } };
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
        A.important = [
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
      // Design rows (merge, test...) open their own thing when clicked; buttons don't double-fire.
      if (v.ari && v.ariOn) {
        const wrap = (it) => { const go = it.go; return { ...it, go: (e) => { if (e && e.stopPropagation) e.stopPropagation(); go && go(e); }, toggleOpen: it.toggleOpen || (() => go && go()) }; };
        v.ari.doNow = (v.ari.doNow || []).map(wrap);
        v.ari.next = (v.ari.next || []).map(wrap);
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
    // ── Voice alerts: so you hear it while gaming ──
    const prevStatus = {}; let firstSnap = true;
    function say(text) {
      if (c.state.sound === false) return;
      try { c.chime(); } catch (e) {}
      try {
        const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.volume = 1;
        setTimeout(() => window.speechSynthesis.speak(u), 900);
      } catch (e) {}
    }
    function announce(sessions) {
      for (const s of sessions) {
        const was = prevStatus[s.id]; prevStatus[s.id] = s.status;
        if (firstSnap || was === s.status) continue;
        if (s.status === 'testing') say(s.name + ' is done. Time to test it on your phone.');
        else if (s.status === 'done') say(s.name + ' is finished.');
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
      announce(sessions);
      fixSamples(snap.plan);
      const u = snap.usage || {};
      c.setState({ sessions, tests, chat, jobQ, merged, events: mapEvents(snap.activity), projects: withPlan(mapProjects(snap.projects, knownProjects), snap.plan), runs: snap.runs || [], usage: u.pct || 0, resetAt: u.resetAt || Date.now() + 5 * 3600000 });
      drawer.refresh(snap);
    }
    function open() {
      const es = new EventSource('/stream');
      es.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch (err) { console.error('[HQ-LIVE]', err); } };
      es.onerror = () => { drawer.setOffline(true); };
      es.onopen = () => { drawer.setOffline(false); };
    }
    const drawer = makeDrawer(() => last);

    // ── Task card: click a task in Ari's panel. Exact steps, links, and ask questions. ──
    const card = (() => {
      const css = document.createElement('style');
      css.textContent = `
        #hqc-bg{position:fixed;inset:0;z-index:99992;background:rgba(10,14,20,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:24px}
        #hqc-bg.open{display:flex}
        #hqc{width:min(620px,100%);max-height:calc(100vh - 80px);overflow:auto;border-radius:30px;padding:26px 28px 24px;color:#fff;font:14px/1.5 Geist,-apple-system,sans-serif;
          background:rgba(22,26,30,.62);backdrop-filter:blur(26px) saturate(1.7);-webkit-backdrop-filter:blur(26px) saturate(1.7);
          box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),inset 0 -1px 0 rgba(255,255,255,.14),0 30px 80px rgba(0,0,0,.35)}
        #hqc .top{display:flex;align-items:flex-start;gap:12px}
        #hqc h2{font-size:22px;font-weight:500;letter-spacing:-.02em;margin:0;flex:1;line-height:1.25}
        #hqc .x{width:36px;height:36px;border-radius:12px;border:0;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;font-size:16px}
        #hqc .tags{display:flex;gap:6px;margin:10px 0 4px;flex-wrap:wrap}
        #hqc .tag{height:26px;padding:0 10px;border-radius:999px;background:rgba(255,255,255,.14);display:inline-flex;align-items:center;font-size:12.5px}
        #hqc .why{color:rgba(255,255,255,.8);margin:10px 0 0}
        #hqc h3{font-size:12.5px;font-weight:500;color:rgba(255,255,255,.65);margin:20px 0 8px;text-transform:uppercase;letter-spacing:.06em}
        #hqc ol{margin:0;padding:0;list-style:none;counter-reset:s}
        #hqc ol li{counter-increment:s;display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}
        #hqc ol li:first-child{border-top:0}
        #hqc ol li::before{content:counter(s);flex:none;width:24px;height:24px;border-radius:8px;background:#fff;color:#1d2128;font-size:12.5px;font-weight:600;display:flex;align-items:center;justify-content:center}
        #hqc a{color:#a9d0ff}
        #hqc .btns{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
        #hqc button.b{height:40px;padding:0 16px;border:0;border-radius:13px;cursor:pointer;font:500 14px Geist,-apple-system,sans-serif}
        #hqc button.w{background:#fff;color:#1d2128}
        #hqc button.g{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
        #hqc .ask{display:flex;gap:8px;margin-top:8px}
        #hqc .ask input{flex:1;height:42px;border-radius:13px;border:0;padding:0 14px;background:rgba(255,255,255,.12);color:#fff;font:14px Geist,-apple-system,sans-serif;outline:none}
        #hqc .ans{white-space:pre-wrap;margin-top:12px;padding:14px;border-radius:16px;background:rgba(255,255,255,.08);display:none}
        #hqc pre{white-space:pre-wrap;font:12.5px/1.45 'Geist Mono',monospace;background:rgba(0,0,0,.25);border-radius:14px;padding:12px;max-height:180px;overflow:auto;margin:0}`;
      document.head.appendChild(css);
      const bg = document.createElement('div'); bg.id = 'hqc-bg';
      const el = document.createElement('div'); el.id = 'hqc'; bg.appendChild(el); document.body.appendChild(bg);
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
      const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank">$1</a>');
      const dayLabel = (k) => { const [y, m, d] = String(k).split('-').map(Number); const dt = new Date(y, m - 1, d); const t0 = new Date(); t0.setHours(0, 0, 0, 0); const n = Math.round((dt - t0) / 86400000); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : dt.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
      const close = () => bg.classList.remove('open');
      bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
      function open(t) {
        const fw = freeWindow();
        const who = { you: 'You', ai: 'AI job', dad: 'Needs Dad' }[t.who] || 'You';
        const steps = (t.steps && t.steps.length) ? t.steps
          : t.who === 'ai' ? ['Click "Send to ' + (fw ? fw.name : 'a window') + '" below.', 'HQ says when it’s done (and out loud).', 'Test what it lists on your phone, then mark this done.']
          : [];
        const links = t.links || [];
        el.innerHTML = `<div class="top"><h2>${esc(t.t)}</h2><button class="x" aria-label="Close">✕</button></div>
          <div class="tags"><span class="tag">${who}</span>${t.day ? `<span class="tag">${esc(dayLabel(t.day))}</span>` : ''}${t.done ? '<span class="tag">Done ✓</span>' : ''}</div>
          ${t.sub ? `<p class="why">${linkify(t.sub)}</p>` : ''}
          <h3>Exactly what to do</h3>
          ${steps.length ? `<ol>${steps.map((x) => `<li><span>${linkify(x)}</span></li>`).join('')}</ol>` : '<p class="why">No steps written for this one yet. Ask below and you’ll get them.</p>'}
          ${links.length ? `<h3>Links</h3>${links.map((l) => `<div><a href="${esc(l.url || l)}" target="_blank">${esc(l.t || l.url || l)}</a></div>`).join('')}` : ''}
          ${t.who === 'ai' && t.prompt ? `<h3>The prompt it sends</h3><pre>${esc(t.prompt)}</pre>` : ''}
          <div class="btns">
            ${t.who === 'ai' ? `<button class="b w" data-a="send">${fw ? 'Send to ' + esc(fw.name) : 'Copy prompt'}</button>` : ''}
            <button class="b ${t.who === 'ai' ? 'g' : 'w'}" data-a="done">${t.done ? 'Mark not done' : 'Mark done'}</button>
          </div>
          <h3>Stuck? Ask anything</h3>
          <div class="ask"><input placeholder="How do I do step 2?" /><button class="b w" data-a="ask">Ask</button></div>
          <div class="ans"></div>`;
        el.querySelector('.x').onclick = close;
        const sendB = el.querySelector('[data-a=send]');
        if (sendB) sendB.onclick = async () => { if (fw) { await queue(fw.id, t.prompt || t.t, null, t.t); close(); } else { const ok = await copy(t.prompt || t.t); sendB.textContent = ok ? 'Copied' : 'Copy failed'; } };
        el.querySelector('[data-a=done]').onclick = async () => { await post('/api/plan/done', { id: t.id, done: !t.done }); close(); };
        const inp = el.querySelector('.ask input'), ans = el.querySelector('.ans'), askB = el.querySelector('[data-a=ask]');
        const ask = async () => {
          const q = inp.value.trim(); if (!q) return;
          askB.disabled = true; ans.style.display = 'block'; ans.textContent = 'Thinking… (this uses a little of your Claude usage)';
          try { const r = await post('/api/ask', { id: t.id, title: t.t, question: q }); ans.innerHTML = r.answer ? linkify(r.answer) : esc(r.error || 'No answer.'); }
          catch (e) { ans.textContent = 'Could not reach HQ.'; }
          askB.disabled = false;
        };
        askB.onclick = ask; inp.onkeydown = (e) => { if (e.key === 'Enter') ask(); e.stopPropagation(); };
        bg.classList.add('open');
      }
      return { open, close };
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
