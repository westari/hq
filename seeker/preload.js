// The only things the Seeker page can ask the app to do, plus the glass window buttons
// (get updates, minimize, bigger/smaller, close) in the top right corner.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seeker', {
  load: () => ipcRenderer.invoke('seeker:load'),
  change: (op) => ipcRenderer.invoke('seeker:change', op),
  runs: () => ipcRenderer.invoke('seeker:runs'),
  runNow: (practice) => ipcRenderer.invoke('seeker:runNow', !!practice),
  open: (url) => ipcRenderer.send('seeker:open', String(url)),
});

window.addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = `
    #swdrag{position:fixed;left:0;right:0;top:0;height:10px;z-index:2147483646;-webkit-app-region:drag}
    .top{-webkit-app-region:drag}
    .top input,.top button,.top label,.top a,.top select{-webkit-app-region:no-drag}
    @media (max-width:1560px){.top{padding-right:168px}}
    #swin{position:fixed;top:12px;right:14px;z-index:2147483647;display:flex;gap:2px;padding:4px;border-radius:999px;
      -webkit-app-region:no-drag;
      background:radial-gradient(120% 140% at 30% 0%,rgba(255,255,255,.14),rgba(255,255,255,.04) 55%),rgba(28,28,32,.42);
      backdrop-filter:blur(22px) saturate(1.7);-webkit-backdrop-filter:blur(22px) saturate(1.7);
      border:1px solid rgba(255,255,255,.14);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(255,255,255,.04),0 8px 24px rgba(0,0,0,.35)}
    #swin button{width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:rgba(255,255,255,.72);
      cursor:pointer;display:grid;place-items:center;padding:0;transition:background .15s,color .15s}
    #swin button:hover{background:rgba(255,255,255,.12);color:#fff}
    #swin button.x:hover{background:#e5484d;color:#fff}
    #swin button.busy{opacity:.4;pointer-events:none}
    #swin svg{width:13px;height:13px;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
    #swin i{width:1px;margin:7px 3px;background:rgba(255,255,255,.16)}`;
  document.head.appendChild(css);
  const drag = document.createElement('div'); drag.id = 'swdrag';
  const box = document.createElement('div'); box.id = 'swin';
  const btn = (title, svg, cls, fn) => {
    const b = document.createElement('button'); b.title = title; b.setAttribute('aria-label', title);
    b.className = cls || ''; b.innerHTML = svg; b.onclick = fn; box.appendChild(b); return b;
  };
  const upd = btn('Get updates and restart', '<svg viewBox="0 0 12 12"><path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.8v2.6H7.4"/></svg>', '',
    () => { upd.classList.add('busy'); ipcRenderer.send('seeker:win', 'update'); });
  box.appendChild(document.createElement('i'));
  btn('Minimize', '<svg viewBox="0 0 12 12"><path d="M2.5 6h7"/></svg>', '', () => ipcRenderer.send('seeker:win', 'min'));
  const mid = btn('Smaller window', '', '', () => ipcRenderer.send('seeker:win', 'max'));
  btn('Close', '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>', 'x', () => ipcRenderer.send('seeker:win', 'close'));
  const setMid = (big) => {
    mid.title = big ? 'Smaller window' : 'Fill the screen'; mid.setAttribute('aria-label', mid.title);
    mid.innerHTML = big
      ? '<svg viewBox="0 0 12 12"><rect x="2" y="4" width="6" height="6" rx="1.2"/><path d="M4 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8"/></svg>'
      : '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.5"/></svg>';
  };
  ipcRenderer.on('seeker:big', (_e, big) => setMid(big));
  setMid(true);
  document.body.appendChild(drag); document.body.appendChild(box);
});
