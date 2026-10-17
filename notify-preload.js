const { contextBridge, ipcRenderer } = require('electron');

// 화면 오른쪽 아래 알림 팝업 창 전용
contextBridge.exposeInMainWorld('popup', {
  onAdd: (fn) => ipcRenderer.on('add', (_e, n) => fn(n)),
  setHeight: (h) => ipcRenderer.send('popup-size', h),
  open: (id) => ipcRenderer.send('popup-click', id),
});
