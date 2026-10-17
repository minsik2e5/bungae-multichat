const { app, BrowserWindow, Menu, ipcMain, session, nativeImage, clipboard, screen, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { startBridge } = require('./bridge');

const TITLE = '번장 멀티챗';
const BUNJANG_RE = /^https:\/\/([a-z0-9-]+\.)*bunjang\.co\.kr(\/|$)/i;

// Electron 표시가 없는 일반 크롬 UA (소셜 로그인 차단 방지)
const osPart = process.platform === 'darwin'
  ? 'Macintosh; Intel Mac OS X 10_15_7'
  : 'Windows NT 10.0; Win64; x64';
app.userAgentFallback =
  `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// 로그인 과정은 팝업 그대로 두고, 그 외 번개장터 페이지만 계정 창 안에서 연다
const LOGIN_RE = /\/(login|logout|auth|oauth|signin|signup|join|callback)(\/|\?|$)/i;
const isInPaneUrl = (url) => BUNJANG_RE.test(url) && !LOGIN_RE.test(url);

// 알림음은 사용자가 클릭하지 않아도 바로 울려야 함
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform === 'win32') app.setAppUserModelId('kr.sumus.bungaemultichat');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
// 사이트 알림(notifications)은 Windows 알림으로 띄우지 않는다. 페이지 스크립트가 가로채 앱 알림 하나로 합친다.
const ALLOWED_PERMS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function hardenSession(ses) {
  if (ses.__hardened) return;
  ses.__hardened = true;
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMS.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => perm !== 'notifications');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: TITLE,
    backgroundColor: '#E9EBEE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false, // 최소화돼 있어도 새 메시지 감지가 느려지지 않게
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 셸 페이지는 이동 금지
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // webview 부착 시 보안 옵션 강제 + 번개장터 주소·계정 파티션만 허용
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.backgroundThrottling = false;
    const okSrc = BUNJANG_RE.test(params.src || '');
    const okPart = (params.partition || '').startsWith('persist:acc-');
    if (!okSrc || !okPart) e.preventDefault();
  });

  win.on('focus', () => win.flashFrame(false));
  // 알림 팝업 창이 남아 있어도 메인 창을 닫으면 앱 종료
  win.on('closed', () => { win = null; app.quit(); });
  win.on('page-title-updated', (e) => e.preventDefault());
}

app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type !== 'webview' && type !== 'window') return;
  hardenSession(contents.session);

  // 번개장터 페이지(채팅 등)는 새 창 대신 해당 계정 창 안에서 열고,
  // 카카오·네이버 등 로그인 팝업만 같은 세션을 쓰는 새 창으로 연다
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^(https?:|about:blank)/i.test(url)) return { action: 'deny' };
    if (type === 'webview' && isInPaneUrl(url)) {
      contents.loadURL(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 780,
        autoHideMenuBar: true,
        parent: win || undefined,
        webPreferences: {
          session: contents.session,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    };
  });

  // 빈 창을 먼저 열고 나중에 주소를 넣는 방식이면, 번개장터 주소가 들어오는 순간 창을 닫고 계정 창에서 연다
  if (type === 'webview') {
    contents.on('did-create-window', (child, details) => {
      const first = details?.url || '';
      if (first && first !== 'about:blank') return;
      child.webContents.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
        const url = e?.url || legacyUrl;
        const isMain = e?.isMainFrame ?? legacyMain;
        if (!isMain || !isInPaneUrl(url)) return;
        child.destroy();
        contents.loadURL(url);
      });
    });
  }

  if (type !== 'webview') return;

  // Ctrl+0~9 단축키는 webview 안에서 눌러도 셸로 전달
  contents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && /^[0-9]$/.test(input.key)) {
      win?.webContents.send('hotkey', input.key);
      e.preventDefault();
    }
  });

  // 우클릭 메뉴 (복사·붙여넣기)
  contents.on('context-menu', (_ev, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { label: '잘라내기', click: () => contents.cut(), enabled: params.editFlags.canCut },
        { label: '복사', click: () => contents.copy(), enabled: params.editFlags.canCopy },
        { label: '붙여넣기', click: () => contents.paste(), enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: '모두 선택', click: () => contents.selectAll() },
      );
    } else if (params.selectionText) {
      items.push({ label: '복사', click: () => contents.copy() });
    }
    if (params.mediaType === 'image') {
      items.push({ label: '이미지 복사', click: () => contents.copyImageAt(params.x, params.y) });
    }
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: '뒤로', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: '새로고침', click: () => contents.reload() },
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });
});

ipcMain.on('unread', (_e, total, icon) => {
  if (!win) return;
  const n = Number(total) || 0;
  win.setTitle(n > 0 ? `(${n}) ${TITLE}` : TITLE);
  if (n > 0 && !win.isFocused()) win.flashFrame(true);
  if (process.platform === 'win32') {
    const img = n > 0 && typeof icon === 'string' && icon.startsWith('data:image/png')
      ? nativeImage.createFromDataURL(icon) : null;
    win.setOverlayIcon(img, n > 0 ? `안 읽은 메시지 ${n}개` : '');
  } else if (process.platform === 'darwin') {
    app.setBadgeCount(n);
  }
});

/* ---------- 화면 오른쪽 아래 알림 팝업 ----------
 * Windows 기본 알림은 설치형 앱이 아니면(바로가기 없음) 안 뜨는 경우가 많아서,
 * 테두리 없는 항상 위 창을 작업표시줄 바로 위에 직접 띄운다. */
const POPUP_W = 380;
let popup = null;
let popupReady = false;
const popupQueue = [];

function ensurePopup() {
  if (popup && !popup.isDestroyed()) return popup;
  popupReady = false;
  popup = new BrowserWindow({
    width: POPUP_W,
    height: 100,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'notify-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.webContents.on('will-navigate', (e) => e.preventDefault());
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.on('did-finish-load', () => {
    popupReady = true;
    popupQueue.splice(0).forEach((n) => popup.webContents.send('add', n));
  });
  popup.on('closed', () => { popup = null; popupReady = false; });
  popup.loadFile(path.join(__dirname, 'renderer', 'notify.html'));
  return popup;
}

function showPopup(n) {
  const p = ensurePopup();
  if (popupReady) p.webContents.send('add', n); else popupQueue.push(n);
}

function focusAccount(id) {
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (id) win.webContents.send('focus-account', id);
  return true;
}

// 화면이 보내 주는 계정별 안 읽음 현황 (Hunter 연결 창구에서 읽어 감)
let status = { accounts: [], total: 0, updatedAt: null };
ipcMain.on('status', (e, s) => {
  if (!win || e.sender !== win.webContents || !s || !Array.isArray(s.accounts)) return;
  const accounts = s.accounts.slice(0, 5).map((a) => ({
    id: String(a.id || '').slice(0, 20),
    name: String(a.name || '').slice(0, 20),
    color: String(a.color || '').slice(0, 9),
    unread: Math.max(0, Number(a.unread) || 0),
    muted: !!a.muted,
    chatOpen: !!a.chatOpen,
    chats: (Array.isArray(a.chats) ? a.chats : []).slice(0, 20).map((c) => ({
      name: String(c.name || '').slice(0, 40),
      text: String(c.text || '').slice(0, 120),
      n: Math.max(0, Number(c.n) || 0),
    })),
  }));
  status = { accounts, total: accounts.reduce((t, a) => t + a.unread, 0), updatedAt: new Date().toISOString() };
});

ipcMain.on('popup-size', (e, h) => {
  if (!popup || popup.isDestroyed() || e.sender !== popup.webContents) return;
  const H = Math.ceil(Number(h) || 0);
  if (H <= 0) { popup.hide(); return; }
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const wa = display.workArea; // 작업표시줄을 뺀 영역
  const height = Math.min(H, wa.height - 16);
  popup.setBounds({ x: wa.x + wa.width - POPUP_W - 8, y: wa.y + wa.height - height - 8, width: POPUP_W, height });
  if (!popup.isVisible()) popup.showInactive();
  popup.moveTop();
});

ipcMain.on('popup-click', (e, id) => {
  if (!popup || e.sender !== popup.webContents) return;
  focusAccount(/^[a-z0-9]+$/i.test(String(id)) ? String(id) : null);
});

ipcMain.on('notify', (_e, p) => {
  if (!win || !p) return;
  if (!win.isFocused()) win.flashFrame(true);
  if (p.popup === false) return;
  showPopup({
    id: String(p.id || ''),
    account: String(p.account || '').slice(0, 40),
    color: String(p.color || ''),
    title: String(p.title || '새 메시지').slice(0, 80),
    body: String(p.body || '').slice(0, 160),
  });
});

/* ---------- 채팅 프레임 읽기 ----------
 * 번개장터 채팅 화면은 목록을 별도 프레임(talk.bunjang.co.kr) 안에 그린다.
 * 화면 쪽 webview는 바깥 페이지만 볼 수 있어서, 안쪽 프레임은 여기서 직접 스크립트를 넣고 상태를 읽어 준다. */
const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, 'renderer', 'page-script.js'), 'utf8');
const TALK_RE = /^https:\/\/talk\.bunjang\.co\.kr\//i;
const FRAME_PROBE = `(function () {
  if (!window.__bmcSet) { ${PAGE_SCRIPT}
    pageScript({ chatOnly: false }); }
  return { state: window.__bmcState || null, notes: window.__bmcTakeNotes ? window.__bmcTakeNotes() : [] };
})()`;

ipcMain.handle('talk-state', async (e, wcId) => {
  if (!win || e.sender !== win.webContents) return null;
  const wc = webContents.fromId(Number(wcId));
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents !== win.webContents) return null;
  let frames = [];
  try { frames = wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame && TALK_RE.test(f.url)); } catch { /* 로딩 중 */ }
  let state = null;
  const notes = [];
  for (const f of frames) {
    try {
      const r = await f.executeJavaScript(FRAME_PROBE);
      if (r && r.state && r.state.chat && !state) state = r.state;
      if (r && Array.isArray(r.notes)) notes.push(...r.notes.slice(0, 20));
    } catch { /* 프레임이 바뀌는 중 */ }
  }
  return { state, notes };
});

ipcMain.on('copy',(_e, text) => clipboard.writeText(String(text).slice(0, 20000)));

ipcMain.handle('clear-account', async (_e, id) => {
  if (!/^[a-z0-9]+$/i.test(String(id))) return false;
  await session.fromPartition(`persist:acc-${id}`).clearStorageData();
  return true;
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  createWindow();
  startBridge({
    version: app.getVersion(),
    getStatus: () => status,
    focus: (id) => (id && !status.accounts.some((a) => a.id === id) ? false : focusAccount(id)),
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (popup && !popup.isDestroyed()) popup.destroy(); });
