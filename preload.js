// Window buttons (minimize, small/big, close) and a drag bar at the top of HQ.
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = `
    #hqbar{position:fixed;left:220px;right:600px;top:0;height:26px;z-index:2147483646;-webkit-app-region:drag}
    #hqwin{position:fixed;top:6px;right:8px;z-index:2147483647;display:flex;gap:4px;padding:3px;border-radius:12px;
      background:rgba(22,26,30,.32);backdrop-filter:blur(14px) saturate(1.6);-webkit-app-region:no-drag;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 6px 16px rgba(0,0,0,.18);opacity:.55;transition:opacity .2s}
    #hqwin:hover{opacity:1}
    #hqwin button{width:30px;height:22px;border:0;border-radius:8px;background:transparent;color:#fff;cursor:pointer;
      display:flex;align-items:center;justify-content:center;padding:0}
    #hqwin button:hover{background:rgba(255,255,255,.18)}
    #hqwin button.x:hover{background:#e5484d}
    #hqwin svg{width:12px;height:12px;stroke:#fff;stroke-width:1.4;fill:none}`;
  document.head.appendChild(css);
  const bar = document.createElement('div'); bar.id = 'hqbar';
  const box = document.createElement('div'); box.id = 'hqwin';
  const btn = (title, svg, cls, fn) => { const b = document.createElement('button'); b.title = title; b.className = cls || ''; b.innerHTML = svg; b.onclick = fn; box.appendChild(b); return b; };
  const reload = btn('Get updates and restart', '<svg viewBox="0 0 12 12"><path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.8v2.6H7.4"/></svg>', '', () => { reload.style.opacity = '.4'; ipcRenderer.send('hq-win', 'update'); });
  const mute = btn('Sound on/off', '', '', () => window.dispatchEvent(new Event('hq-toggle-sound')));
  const setMute = () => {
    const on = document.documentElement.dataset.hqSound !== '0';
    mute.title = on ? 'Mute' : 'Unmute';
    mute.innerHTML = on ? '<svg viewBox="0 0 12 12"><path d="M2 4.5h2l3-2.5v8l-3-2.5H2z"/><path d="M8.8 4.2a2.5 2.5 0 0 1 0 3.6"/></svg>'
                        : '<svg viewBox="0 0 12 12"><path d="M2 4.5h2l3-2.5v8l-3-2.5H2z"/><path d="M8.5 4.5l3 3M11.5 4.5l-3 3"/></svg>';
  };
  setMute(); new MutationObserver(setMute).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hq-sound'] });
  const gap = document.createElement('span'); gap.style.cssText = 'width:1px;margin:3px 3px;background:rgba(255,255,255,.25)'; box.appendChild(gap);
  btn('Minimize', '<svg viewBox="0 0 12 12"><path d="M2 6.5h8"/></svg>', '', () => ipcRenderer.send('hq-win', 'min'));
  const mid = btn('Smaller window', '', '', () => ipcRenderer.send('hq-win', 'max'));
  btn('Close', '<svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>', 'x', () => ipcRenderer.send('hq-win', 'close'));
  const setMid = (big) => {
    mid.title = big ? 'Smaller window' : 'Fill the screen';
    mid.innerHTML = big
      ? '<svg viewBox="0 0 12 12"><rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4 4V2.8c0-.4.3-.8.8-.8H9.2c.4 0 .8.4.8.8v4.4c0 .4-.4.8-.8.8H8"/></svg>'
      : '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';
  };
  ipcRenderer.on('hq-big', (_e, big) => setMid(big));
  setMid(true);
  document.body.appendChild(bar); document.body.appendChild(box);
});
