const { app, BrowserWindow, Menu, ipcMain, session, nativeImage, clipboard, screen, webContents, net, shell } = require('electron');
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

/* ---------- 안정화: 오류 기록 + 죽지 않게 ----------
 * 예기치 못한 오류가 나도 앱 전체가 꺼지지 않게 하고, 원인 파악용으로 %APPDATA%\BungaeMultiChat\crash.log 에 남긴다. */
const LOG_FILE = path.join(app.getPath('userData'), 'crash.log');
function logLine(kind, detail) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 500000) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${kind}] ${String(detail && detail.stack || detail).slice(0, 2000)}\n`);
  } catch { /* 기록 실패는 무시 */ }
}
process.on('uncaughtException', (err) => logLine('uncaughtException', err));
process.on('unhandledRejection', (err) => logLine('unhandledRejection', err));
app.on('render-process-gone', (_e, wc, d) => {
  logLine('render-process-gone', `${wc && wc.getType && wc.getType()} ${d && d.reason} code=${d && d.exitCode}`);
  // 계정 창(webview)이 죽으면 앱 전체가 아니라 그 창만 다시 불러온다
  if (wc && !wc.isDestroyed() && wc.getType() === 'webview' && d && d.reason !== 'clean-exit') {
    setTimeout(() => { try { if (!wc.isDestroyed()) wc.reload(); } catch (err) { logLine('reload-after-crash', err); } }, 800);
  }
});
app.on('child-process-gone', (_e, d) => logLine('child-process-gone', `${d && d.type} ${d && d.reason}`));

// 로그인 유지: 번개장터 로그인 쿠키(bun_session 등)는 만료일이 없거나 마지막 접속 뒤 하루만 유지돼서,
// 앱을 끄거나 하루 넘게 안 쓰면 로그아웃된다. 이 앱 안에서만 만료일을 6개월(180일)로 늘려 둔다.
// 분석용 쿠키(_로 시작)는 건드리지 않는다. 쿠키 값은 어디로 보내거나 기록하지 않고 같은 계정 저장소에 다시 저장만 한다.
const KEEP_DAYS = 180;
const isLoginCookie = (c) => /(^|\.)bunjang\.co\.kr$/i.test(c.domain) && !c.name.startsWith('_');
function extendCookie(ses, c) {
  const want = Math.floor(Date.now() / 1000) + KEEP_DAYS * 86400;
  // 이미 충분히 길면 그대로 둔다 (다시 저장할 때 생기는 changed 이벤트로 무한 반복되지 않게)
  if (!c.session && c.expirationDate && c.expirationDate > want - 86400) return;
  const host = c.domain.replace(/^\./, '');
  const next = {
    url: `https://${host}${c.path || '/'}`, name: c.name, value: c.value, path: c.path || '/',
    secure: true, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified', expirationDate: want,
  };
  if (!c.hostOnly) next.domain = c.domain;
  ses.cookies.set(next).catch((err) => logLine('keepLogin', err.message));
}
function keepLogin(ses) {
  ses.cookies.on('changed', (_e, c, cause, removed) => {
    // 사이트가 직접 지운 경우(로그아웃 버튼 등)는 따라가고, 만료로 사라지는 것만 막는다
    if (removed || !isLoginCookie(c)) return;
    extendCookie(ses, c);
  });
  // 앱을 켤 때 이미 저장된 로그인 쿠키도 바로 늘린다
  ses.cookies.get({}).then((list) => list.filter(isLoginCookie).forEach((c) => extendCookie(ses, c)))
    .catch((err) => logLine('keepLogin-start', err.message));
}
// 켜져 있는 동안은 30분마다 계정별로 번개장터에 한 번 접속해 서버 쪽 로그인도 살아 있게 한다 (페이지 이동·클릭 없음)
function pingLogins() {
  try {
    fs.readdirSync(path.join(app.getPath('userData'), 'Partitions')).filter((p) => p.startsWith('acc-')).forEach((p) => {
      const ses = session.fromPartition(`persist:${p}`);
      ses.fetch('https://m.bunjang.co.kr/', { credentials: 'include', headers: { 'User-Agent': app.userAgentFallback } })
        .then((r) => r.arrayBuffer()).catch((err) => logLine('ping', err.message));
    });
  } catch (err) { logLine('ping', err.message); }
}
// 사이트 알림(notifications)은 Windows 알림으로 띄우지 않는다. 페이지 스크립트가 가로채 앱 알림 하나로 합친다.
const ALLOWED_PERMS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function hardenSession(ses) {
  if (ses.__hardened) return;
  ses.__hardened = true;
  keepLogin(ses);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMS.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => perm !== 'notifications');
}

/* ---------- 창 크기·위치 기억 ---------- */
const WIN_FILE = path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() {
  try {
    const s = JSON.parse(fs.readFileSync(WIN_FILE, 'utf8'));
    const b = s && s.bounds;
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    // 저장된 위치가 지금 연결된 모니터 안에 있을 때만 사용 (모니터를 뺐을 때 화면 밖으로 사라짐 방지)
    const onScreen = screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return b.x + 100 > w.x && b.x < w.x + w.width - 100 && b.y + 50 > w.y && b.y < w.y + w.height - 50;
    });
    return onScreen ? { bounds: b, maximized: !!s.maximized } : null;
  } catch { return null; }
}
let winSaveTimer = null;
function saveWinState() {
  clearTimeout(winSaveTimer);
  winSaveTimer = setTimeout(() => {
    try {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      fs.writeFileSync(WIN_FILE, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch (err) { logLine('window-state', err); }
  }, 400);
}

const APP_ICON = path.join(__dirname, 'build', 'icon.png');

function createWindow() {
  const saved = loadWinState();
  win = new BrowserWindow({
    ...(saved ? saved.bounds : {}),
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    width: saved ? saved.bounds.width : 1600,
    height: saved ? saved.bounds.height : 1000,
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
  if (saved && saved.maximized) win.maximize();
  ['resize', 'move', 'maximize', 'unmaximize', 'close'].forEach((ev) => win.on(ev, saveWinState));
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
  // 응답 없음 / 화면 프로세스 종료 시 기록하고, 셸 화면이 죽었으면 다시 불러온다 (앱은 유지)
  win.on('unresponsive', () => logLine('shell-unresponsive', 'main window'));
  win.webContents.on('render-process-gone', (_e, d) => {
    logLine('shell-render-gone', d && d.reason);
    setTimeout(() => { try { if (win && !win.isDestroyed()) win.reload(); } catch (err) { logLine('shell-reload', err); } }, 500);
  });
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
      let handled = false;
      child.webContents.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
        const url = e?.url || legacyUrl;
        const isMain = e?.isMainFrame ?? legacyMain;
        if (handled || !isMain || !isInPaneUrl(url)) return;
        handled = true;
        // 이벤트 처리 도중에 창을 바로 destroy 하면 앱이 죽을 수 있어서, 한 박자 뒤에 안전하게 닫는다
        setImmediate(() => {
          try { if (!child.isDestroyed()) child.close(); } catch (err) { logLine('child-close', err); }
          try { if (!contents.isDestroyed()) contents.loadURL(url); } catch (err) { logLine('child-load', err); }
        });
      });
    });
  }

  if (type !== 'webview') return;

  // 편의점택배 예약 같은 페이지가 "나가기 확인(beforeunload)"을 걸면 Electron은 창 없이 이동을 막아
  // 뒤로·홈·새로고침이 모두 먹통이 된다. 확인 없이 이동하게 한다.
  contents.on('will-prevent-unload', (e) => e.preventDefault());

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

/* ---------- 새 버전 알림 · 자동 실행 ---------- */
const REPO = 'minsik2e5/bungae-multichat';
const verNum = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
const isNewer = (a, b) => {
  const x = verNum(a), y = verNum(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
let updateInfo = null;
async function checkUpdate() {
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BungaeMultiChat' } });
    if (!r.ok) return { ok: false, current: app.getVersion() };
    const j = await r.json();
    const latest = String(j.tag_name || '');
    updateInfo = { ok: true, current: app.getVersion(), latest, newer: isNewer(latest, app.getVersion()), url: `https://github.com/${REPO}/releases/latest` };
    if (updateInfo.newer && win && !win.isDestroyed()) win.webContents.send('update-available', updateInfo);
    return updateInfo;
  } catch (err) { logLine('update-check', err.message); return { ok: false, current: app.getVersion() }; }
}
ipcMain.handle('update-check', (e) => (win && e.sender === win.webContents ? checkUpdate() : null));
ipcMain.on('open-release', (e) => { if (win && e.sender === win.webContents) shell.openExternal(`https://github.com/${REPO}/releases/latest`); });
const loginItemPath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; // 포터블은 실제 exe 위치
ipcMain.handle('settings-get', (e) => {
  if (!win || e.sender !== win.webContents) return null;
  let autoStart = false;
  try { autoStart = app.getLoginItemSettings({ path: loginItemPath() }).openAtLogin; } catch { /* 무시 */ }
  return { version: app.getVersion(), autoStart, update: updateInfo };
});
ipcMain.handle('autostart-set', (e, on) => {
  if (!win || e.sender !== win.webContents) return false;
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: loginItemPath() }); return !!on; } catch (err) { logLine('autostart', err.message); return false; }
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
  setTimeout(checkUpdate, 15000);
  setInterval(pingLogins, 30 * 60 * 1000);
  setInterval(checkUpdate, 6 * 3600 * 1000);
  startBridge({
    version: app.getVersion(),
    getStatus: () => status,
    focus: (id) => (id && !status.accounts.some((a) => a.id === id) ? false : focusAccount(id)),
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (popup && !popup.isDestroyed()) popup.destroy();
  // 끄기 직전에 로그인 쿠키·저장소를 디스크에 확실히 기록
  try { session.defaultSession.flushStorageData(); } catch { /* 무시 */ }
  try { fs.readdirSync(path.join(app.getPath('userData'), 'Partitions')).forEach((p) => {
    const ses = session.fromPartition(`persist:${p}`);
    ses.flushStorageData(); ses.cookies.flushStore();
  }); } catch { /* 무시 */ }
});
