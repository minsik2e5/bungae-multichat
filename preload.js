const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setUnread: (total, icon) => ipcRenderer.send('unread', total, icon),
  notify: (payload) => ipcRenderer.send('notify', payload),
  setStatus: (s) => ipcRenderer.send('status', s),
  talkState: (wcId) => ipcRenderer.invoke('talk-state', wcId),
  copy: (text) => ipcRenderer.send('copy', text),
  clearAccount: (id) => ipcRenderer.invoke('clear-account', id),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, key) => fn(key)),
  onFocusAccount: (fn) => ipcRenderer.on('focus-account', (_e, id) => fn(id)),
});
