const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setUnread: (total, icon) => ipcRenderer.send('unread', total, icon),
  notify: (payload) => ipcRenderer.send('notify', payload),
  setStatus: (s) => ipcRenderer.send('status', s),
  talkState: (wcId) => ipcRenderer.invoke('talk-state', wcId),
  copy: (text) => ipcRenderer.send('copy', text),
  clearAccount: (id) => ipcRenderer.invoke('clear-account', id),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setAutoStart: (on) => ipcRenderer.invoke('autostart-set', !!on),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  openRelease: () => ipcRenderer.send('open-release'),
  onUpdate: (fn) => ipcRenderer.on('update-available', (_e, info) => fn(info)),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, key) => fn(key)),
  onFocusAccount: (fn) => ipcRenderer.on('focus-account', (_e, id) => fn(id)),
});
