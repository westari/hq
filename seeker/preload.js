// The only things the Seeker page can ask the app to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seeker', {
  load: () => ipcRenderer.invoke('seeker:load'),
  change: (op) => ipcRenderer.invoke('seeker:change', op),
  runs: () => ipcRenderer.invoke('seeker:runs'),
  runNow: (practice) => ipcRenderer.invoke('seeker:runNow', !!practice),
  open: (url) => ipcRenderer.send('seeker:open', String(url)),
});
