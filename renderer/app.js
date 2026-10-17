'use strict';

const STORE_KEY = 'bmc:v1';
const COLORS = ['#E5484D', '#3E63DD', '#30A46C', '#F76B15', '#8E4EC6', '#0090FF', '#D6409F', '#5B6472'];
const DEFAULT_START = 'https://m.bunjang.co.kr/talk'; // 채팅 목록 (알림은 이 화면에서만 감지됨)
const OLD_HOME = /^https:\/\/m\.bunjang\.co\.kr\/?$/i;
const BUNJANG_RE = /^https:\/\/([a-z0-9-]+\.)*bunjang\.co\.kr(\/|$)/i;
const DESKTOP_UA = navigator.userAgent;
// 이 폭 기준으로 PC 레이아웃을 그린 뒤 창 크기에 맞춰 축소 (작을수록 글자가 큼). 모든 계정 공통.
const DESIGN_W = 1000, W_MIN = 700, W_MAX = 1600, W_STEP = 100;
const clampW = (w) => Math.min(W_MAX, Math.max(W_MIN, Math.round(Number(w) / W_STEP) * W_STEP || DESIGN_W));
const SITE_HOME = 'https://m.bunjang.co.kr/';
const MAX_ACCOUNTS = 5;
// 알림 설정 기본값: 알림음 종류·볼륨, 화면 하단 팝업, 지금 보고 있는 계정도 알릴지
const DEFAULT_ALERT = { sound: 'dingdong', volume: 0.7, popup: true, whenVisible: true };

const ICON = {
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  reload: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/></svg>',
  home: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 8 3l5.5 4.5"/><path d="M4 6.5V13h8V6.5"/></svg>',
  expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>',
  shrink: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14"/></svg>',
  bellOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5h8.5M5 6.5a3 3 0 0 1 5.6-1.5M11 7v2.5l1.5 2M4 11.5 5 9.5V8M6.8 13.5a1.4 1.4 0 0 0 2.4 0M2.5 2.5l11 11"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
};

const $ = (id) => document.getElementById(id);
const grid = $('grid'), chips = $('chips'), empty = $('empty'), menu = $('menu');
const modal = $('modal'), form = $('form'), toastEl = $('toast');

const state = load();
const panes = new Map(); // id -> { el, wv, unread }

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.accounts)) {
      // 예전 계정별 글자 크기 → 전체 하나로 (가장 크게 보던 값 기준)
      const oldW = s.accounts.map((a) => Number(a.designW)).filter((w) => w >= W_MIN && w <= W_MAX);
      s.accounts.forEach((a) => {
        delete a.mobile; delete a.zoom; delete a.designW; delete a.chatOnly;
        if (!a.startUrl || OLD_HOME.test(a.startUrl)) a.startUrl = DEFAULT_START; // 홈 → 채팅 목록
      });
      return {
        accounts: s.accounts, cols: s.cols || 'auto', focusId: null,
        alert: { ...DEFAULT_ALERT, ...s.alert },
        view: s.view === 'site' ? 'site' : 'talk',
        designW: clampW(s.designW || (oldW.length ? Math.min(...oldW) : DESIGN_W)),
      };
    }
  } catch { /* 저장값 없음 */ }
  return { accounts: [], cols: 'auto', focusId: null, alert: { ...DEFAULT_ALERT }, view: 'talk', designW: DESIGN_W };
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    accounts: state.accounts, cols: state.cols, alert: state.alert, view: state.view, designW: state.designW,
  }));
}
const acc = (id) => state.accounts.find((a) => a.id === id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- 창 만들기 ---------- */
function createPane(a) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.id = a.id;
  el.innerHTML = `
    <header class="pane-head">
      <button class="title" data-act="focus" title="크게 보기"><span class="dot"></span><span class="name"></span><span class="muted" title="이 계정 알림 꺼짐" hidden>${ICON.bellOff}</span></button>
      <span class="badge" hidden></span>
      <div class="tools">
        <button data-act="back" title="뒤로">${ICON.back}</button>
        <button data-act="reload" title="새로고침">${ICON.reload}</button>
        <button data-act="home" title="시작 페이지로">${ICON.home}</button>
        <button data-act="focus" class="focus-btn" title="크게 보기">${ICON.expand}</button>
        <button data-act="more" title="더보기" aria-haspopup="menu">${ICON.more}</button>
      </div>
    </header>
    <div class="pane-body">
      <div class="loading" hidden></div>
      <div class="pane-error" hidden><p></p><button class="ghost" data-act="reload">다시 불러오기</button></div>
    </div>`;

  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:acc-${a.id}`);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('useragent', DESKTOP_UA);
  wv.setAttribute('src', a.startUrl || DEFAULT_START);
  el.querySelector('.pane-body').prepend(wv);

  const loading = el.querySelector('.loading');
  const err = el.querySelector('.pane-error');

  const body = el.querySelector('.pane-body');
  const pane = { el, wv, body, unread: 0, ready: false, scan: null, titleN: 0, chats: null, mode: null };
  const inject = () => wv.executeJavaScript(
    `(${pageScript.toString()})(${JSON.stringify({ chatOnly: state.view === 'talk' })})`
  ).catch(() => {});
  wv.addEventListener('dom-ready', () => { pane.ready = true; fit(a.id); inject(); });
  wv.addEventListener('did-navigate', () => fit(a.id));
  wv.addEventListener('did-navigate-in-page', () => fit(a.id));
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fit(a.id)); }).observe(body);

  wv.addEventListener('did-start-loading', () => { loading.hidden = false; err.hidden = true; });
  wv.addEventListener('did-stop-loading', () => { loading.hidden = true; });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    err.querySelector('p').textContent = `페이지를 불러오지 못했습니다. 인터넷 연결을 확인하세요. (${e.errorDescription || e.errorCode})`;
    err.hidden = false;
  });
  wv.addEventListener('page-title-updated', (e) => { pane.titleN = parseUnread(e.title); refreshUnread(a.id); });

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'back') { if (wv.canGoBack()) wv.goBack(); }
    else if (act === 'reload') wv.reload();
    else if (act === 'home') wv.loadURL(state.view === 'talk' ? DEFAULT_START : SITE_HOME);
    else if (act === 'focus') toggleFocus(a.id);
    else if (act === 'more') openMenu(a.id, btn);
  });

  panes.set(a.id, pane);
  updatePaneHead(a);
  grid.appendChild(el);
}

function fit(id) {
  const p = panes.get(id), a = acc(id);
  if (!p || !a || !p.ready) return;
  const w = p.body.clientWidth;
  if (!w) return;
  p.wv.setZoomFactor(Math.max(0.3, Math.min(1, w / state.designW)));
}

function updatePaneHead(a) {
  const p = panes.get(a.id);
  if (!p) return;
  p.el.style.setProperty('--c', a.color);
  p.el.querySelector('.name').textContent = a.name;
  p.el.querySelector('.muted').hidden = !a.muted;
}

function parseUnread(title = '') {
  const m = String(title).match(/^\s*[([](\d{1,3})\+?[)\]]/);
  return m ? Number(m[1]) : 0;
}

function refreshUnread(id) {
  const p = panes.get(id);
  if (!p) return;
  const n = p.scan ?? p.titleN ?? 0;
  p.unread = n;
  const b = p.el.querySelector('.badge');
  b.hidden = n <= 0;
  b.textContent = n > 99 ? '99+' : String(n);
  p.el.classList.toggle('alert', n > 0);
  renderChips();
  updateTotal();
}

function badgeIcon(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#D93036';
  g.beginPath(); g.arc(16, 16, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 20px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n > 99 ? '99+' : String(n), 16, 17);
  return c.toDataURL('image/png');
}

let lastTotal = -1;
function updateTotal() {
  let total = 0;
  panes.forEach((x) => { total += x.unread; });
  if (total === lastTotal) return;
  lastTotal = total;
  window.api?.setUnread(total, total > 0 ? badgeIcon(total) : null);
}

// 페이지 스크립트가 보낸 채팅 목록 상태: 안 읽음 합계 갱신 + 새 메시지 알림
function onReport(id, d) {
  const p = panes.get(id), a = acc(id);
  if (!p || !a || !d) return;
  p.mode = d.mode || null;
  if (!d.chat) { p.scan = null; refreshUnread(id); return; }
  const cur = new Map();
  (Array.isArray(d.chats) ? d.chats : []).slice(0, 100).forEach((c) => {
    cur.set(String(c.name).slice(0, 40), { n: Number(c.n) || 0, text: String(c.text || '').slice(0, 120) });
  });
  if (p.chats) { // 첫 수신은 기준선으로만 쓰고 알리지 않음
    const fresh = [];
    cur.forEach((c, name) => { if (c.n > (p.chats.get(name)?.n || 0)) fresh.push({ name, text: c.text, n: c.n }); });
    if (fresh.length) alertNew(a, fresh);
  }
  p.chats = cur;
  p.scan = Number(d.total) || 0;
  refreshUnread(id);
}

/* ---------- 새 메시지 알림: 알림음 + 화면 오른쪽 아래 팝업 ---------- */
// 음 하나 = [주파수 Hz, 시작 초, 길이 초, 파형]
const SOUNDS = {
  dingdong: { label: '딩동', notes: [[988, 0, 0.55], [740, 0.2, 0.8]] },
  ting: { label: '띠링', notes: [[1319, 0, 0.3], [1760, 0.09, 0.5]] },
  pop: { label: '톡', notes: [[660, 0, 0.12], [990, 0.05, 0.16]] },
  beep: { label: '삑삑', notes: [[1046, 0, 0.12, 'square'], [1046, 0.18, 0.12, 'square']] },
};
let audioCtx = null;
let lastSoundAt = 0;

function playSound(kind = state.alert.sound, volume = state.alert.volume) {
  const s = SOUNDS[kind];
  if (!s || volume <= 0) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + 0.02;
    const master = audioCtx.createGain();
    master.gain.value = Math.min(1, volume) * 0.5;
    master.connect(audioCtx.destination);
    s.notes.forEach(([f, at, dur, type]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(1, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(master);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.05);
    });
  } catch { /* 오디오 장치 없음 */ }
}

// 번개장터 자체 알림을 받은 경우: 대화방 알림만 (광고 제외)
function onNotes(id, notes) {
  const a = acc(id);
  if (!a) return;
  const fresh = notes
    .map((n) => ({ name: String(n.title || '').slice(0, 40), text: String(n.body || '').slice(0, 120), n: 1 }))
    .filter((c) => c.name && !/\(광고\)/.test(c.name + c.text));
  if (fresh.length) alertNew(a, fresh);
}

// 같은 메시지 하나가 두 경로(숫자 증가·번개장터 알림)로 잡힌 경우만 한 번으로 친다.
// 같은 대화방이라도 내용이 다른 메시지는 매번 울린다.
const recentAlerts = new Map();
const msgKey = (s) => String(s || '').replace(/\s+/g, '').replace(/(\.\.\.|…)$/, '').slice(0, 20);
function alertNew(a, list) {
  if (a.muted) return;
  const now0 = Date.now();
  recentAlerts.forEach((t, k) => { if (now0 - t > 8000) recentAlerts.delete(k); });
  const fresh = list.filter((c) => {
    const key = `${a.id}|${c.name}|${msgKey(c.text)}`;
    if (recentAlerts.has(key)) return false;
    recentAlerts.set(key, now0);
    return true;
  });
  if (!fresh.length) return;
  const visible = document.hasFocus() && (!state.focusId || state.focusId === a.id);
  if (visible && !state.alert.whenVisible) return; // 지금 보고 있는 계정은 알리지 않음
  const now = Date.now();
  if (now - lastSoundAt > 1200) { lastSoundAt = now; playSound(); } // 여러 개가 한꺼번에 와도 한 번만 울림
  const base = { id: a.id, account: a.name, color: a.color, popup: state.alert.popup };
  if (fresh.length > 3) {
    window.api?.notify({ ...base, title: '새 메시지', body: `${fresh.length}개 대화방에 새 메시지가 왔습니다.` });
  } else {
    fresh.forEach((c) => window.api?.notify({ ...base, title: c.name, body: c.text || `안 읽은 메시지 ${c.n}개` }));
  }
}

/* ---------- 알림 설정 ---------- */
const alertModal = $('alertModal');
function openAlertSettings() {
  const sel = $('aSound');
  sel.innerHTML = '';
  Object.entries(SOUNDS).forEach(([k, s]) => sel.add(new Option(s.label, k)));
  sel.add(new Option('소리 끄기', 'off'));
  sel.value = SOUNDS[state.alert.sound] ? state.alert.sound : 'off';
  $('aVolume').value = Math.round(state.alert.volume * 100);
  $('aPopup').checked = state.alert.popup;
  $('aVisible').checked = state.alert.whenVisible;
  alertModal.hidden = false;
  sel.focus();
}
function closeAlertSettings() { alertModal.hidden = true; }
function readAlertSettings() {
  state.alert = {
    sound: $('aSound').value,
    volume: Number($('aVolume').value) / 100,
    popup: $('aPopup').checked,
    whenVisible: $('aVisible').checked,
  };
  save();
  renderBell();
}
function renderBell() {
  const off = !SOUNDS[state.alert.sound] && !state.alert.popup;
  $('alertBtn').classList.toggle('off', off);
  $('alertBtn').title = off ? '알림 꺼짐' : '알림 설정';
}
['aSound', 'aPopup', 'aVisible'].forEach((k) => $(k).addEventListener('change', readAlertSettings));
$('aVolume').addEventListener('change', () => { readAlertSettings(); playSound(); });
$('aSound').addEventListener('change', () => playSound());
$('aTest').addEventListener('click', () => {
  playSound();
  const a = state.accounts[0];
  if (state.alert.popup) {
    window.api?.notify({ id: a?.id || '', account: a?.name || '번장 멀티챗', color: a?.color || COLORS[0], title: '테스트 상점', body: '안녕하세요! 이 상품 아직 판매 중인가요?' });
  }
});
$('aClose').addEventListener('click', closeAlertSettings);
alertModal.addEventListener('mousedown', (e) => { if (e.target === alertModal) closeAlertSettings(); });
$('alertBtn').addEventListener('click', openAlertSettings);

/* ---------- 동기화·레이아웃 ---------- */
function sync() {
  const ids = new Set(state.accounts.map((a) => a.id));
  panes.forEach((p, id) => {
    if (!ids.has(id)) { p.el.remove(); panes.delete(id); }
  });
  // 이미 붙은 webview는 옮기면 새로고침되므로 새 계정만 끝에 추가
  state.accounts.forEach((a) => { panes.has(a.id) ? updatePaneHead(a) : createPane(a); });
  if (state.focusId && !ids.has(state.focusId)) state.focusId = null;
  renderChips();
  applyLayout();
}

function applyLayout() {
  const n = state.accounts.length;
  // 가로: 모든 계정을 한 줄로 나란히 (창이 좁으면 옆으로 스크롤)
  const row = state.cols === 'auto';
  const cols = row ? Math.max(n, 1) : Number(state.cols);
  grid.classList.toggle('row', row);
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', Math.max(1, Math.ceil(n / cols)));
  const focusing = Boolean(state.focusId && panes.has(state.focusId));
  if (focusing) { grid.scrollTop = 0; grid.scrollLeft = 0; }
  grid.classList.toggle('has-focus', focusing);
  panes.forEach((p, id) => {
    const on = id === state.focusId;
    p.el.classList.toggle('focused', on);
    const fb = p.el.querySelector('.focus-btn');
    fb.innerHTML = on ? ICON.shrink : ICON.expand;
    fb.title = on ? '전체 보기로' : '크게 보기';
  });
  empty.hidden = n > 0;
  grid.hidden = n === 0;
  const add = $('addBtn');
  add.textContent = `계정 추가 ${Math.min(n, MAX_ACCOUNTS)}/${MAX_ACCOUNTS}`;
  add.disabled = n >= MAX_ACCOUNTS;
  add.title = n >= MAX_ACCOUNTS ? `계정은 최대 ${MAX_ACCOUNTS}개까지 연동할 수 있습니다` : '';
  document.querySelectorAll('#cols button').forEach((b) => b.classList.toggle('on', b.dataset.cols === String(state.cols)));
}

function renderChips() {
  chips.innerHTML = '';
  state.accounts.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (a.id === state.focusId ? ' on' : '');
    b.style.setProperty('--c', a.color);
    b.title = i < 9 ? `Ctrl+${i + 1}` : '';
    const unread = panes.get(a.id)?.unread || 0;
    b.innerHTML = `<span class="dot"></span><span class="n"></span>${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}`;
    b.querySelector('.n').textContent = a.name;
    b.addEventListener('click', () => toggleFocus(a.id));
    chips.appendChild(b);
  });
}

function toggleFocus(id) {
  state.focusId = state.focusId === id ? null : id;
  renderChips();
  applyLayout();
  if (state.focusId) panes.get(id)?.wv.focus();
}

/* ---------- 더보기 메뉴 ---------- */
const MODE_TEXT = { applied: '적용 중', fallback: '적용 중(대체 방식)', failed: '적용 실패', none: '채팅 화면 아님', off: '꺼짐' };

function openMenu(id, anchor) {
  const a = acc(id);
  const p = panes.get(id);
  if (!a || !p) return;
  const items = [
    ['이름·색 바꾸기', () => openForm(a)],
    ['지금 페이지를 시작 페이지로', () => {
      const url = p.wv.getURL();
      if (!BUNJANG_RE.test(url)) return toast('번개장터 페이지에서만 저장할 수 있습니다.');
      a.startUrl = url; save(); toast('시작 페이지를 저장했습니다.');
    }],
    [a.muted ? '이 계정 알림 켜기' : '이 계정 알림 끄기', () => {
      a.muted = !a.muted;
      save();
      updatePaneHead(a);
      toast(a.muted ? `'${a.name}' 알림을 껐습니다.` : `'${a.name}' 알림을 켰습니다.`);
    }],
    '-',
    [`채팅 화면 진단 정보 복사  (${MODE_TEXT[p.mode] || '스크립트 미동작'})`, async () => {
      try {
        const t = await p.wv.executeJavaScript('window.__bmcDiag ? window.__bmcDiag() : "script not loaded"');
        window.api?.copy(String(t));
        toast('복사했습니다. 대화창에 붙여넣어 주세요.');
      } catch { toast('복사하지 못했습니다.'); }
    }],
    '-',
    ['로그아웃 (로그인 정보 지우기)', async () => {
      if (!confirm(`'${a.name}'의 로그인 정보를 지웁니다. 계속할까요?`)) return;
      await window.api?.clearAccount(a.id);
      p.wv.loadURL(DEFAULT_START);
      toast('로그인 정보를 지웠습니다.');
    }],
    ['계정 삭제', () => removeAccount(a), 'danger-item'],
  ];
  menu.innerHTML = '';
  items.forEach((it) => {
    if (it === '-') { menu.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button');
    b.textContent = it[0];
    b.setAttribute('role', 'menuitem');
    if (it[2]) b.className = it[2];
    b.addEventListener('click', () => { closeMenu(); it[1](); });
    menu.appendChild(b);
  });
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.min(r.bottom + 4, innerHeight - h - 8) + 'px';
  menu.querySelector('button')?.focus();
}
function closeMenu() { menu.hidden = true; }
document.addEventListener('mousedown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);

/* ---------- 화면 모드·글자 크기 (모든 계정 공통) ---------- */
function setView(v) {
  state.view = v === 'site' ? 'site' : 'talk';
  save();
  const on = state.view === 'talk';
  panes.forEach((p) => p.wv.executeJavaScript(`window.__bmcSet && window.__bmcSet(${on})`).catch(() => {}));
  renderTopControls();
}

function changeTextSize(dir) { // dir: +1 크게, -1 작게
  const next = clampW(state.designW - dir * W_STEP);
  if (next === state.designW) return toast(dir > 0 ? '가장 큰 글자입니다.' : '가장 작은 글자입니다.');
  state.designW = next;
  save();
  panes.forEach((_p, id) => fit(id));
  renderTopControls();
}

function renderTopControls() {
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('textSize').textContent = `${Math.round((DESIGN_W / state.designW) * 100)}%`;
  $('textDown').disabled = state.designW >= W_MAX;
  $('textUp').disabled = state.designW <= W_MIN;
}

async function removeAccount(a) {
  if (!confirm(`'${a.name}' 계정 창을 삭제합니다. 로그인 정보도 함께 지워집니다.`)) return;
  await window.api?.clearAccount(a.id);
  state.accounts = state.accounts.filter((x) => x.id !== a.id);
  save();
  sync();
  updateTotal();
}

/* ---------- 추가·수정 폼 ---------- */
let editing = null;
let pickedColor = COLORS[0];

function openForm(a = null) {
  if (!a && state.accounts.length >= MAX_ACCOUNTS) return toast(`계정은 최대 ${MAX_ACCOUNTS}개까지 연동할 수 있습니다.`);
  editing = a;
  $('formTitle').textContent = a ? '계정 수정' : '계정 추가';
  $('fSubmit').textContent = a ? '저장' : '추가';
  $('fDelete').hidden = !a;
  $('fName').value = a ? a.name : `계정 ${state.accounts.length + 1}`;
  const used = new Set(state.accounts.map((x) => x.color));
  pickedColor = a ? a.color : (COLORS.find((c) => !used.has(c)) || COLORS[state.accounts.length % COLORS.length]);
  renderSwatches();
  modal.hidden = false;
  $('fName').select();
  $('fName').focus();
}
function closeForm() { modal.hidden = true; editing = null; }

function renderSwatches() {
  const wrap = $('swatches');
  wrap.innerHTML = '';
  COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch' + (c === pickedColor ? ' on' : '');
    s.style.setProperty('--c', c);
    s.setAttribute('aria-label', `색상 ${c}`);
    s.addEventListener('click', () => { pickedColor = c; renderSwatches(); });
    wrap.appendChild(s);
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('fName').value.trim();
  if (!name) return;
  if (editing) {
    editing.name = name;
    editing.color = pickedColor;
  } else {
    if (state.accounts.length >= MAX_ACCOUNTS) { closeForm(); return; }
    state.accounts.push({ id: newId(), name, color: pickedColor, startUrl: DEFAULT_START });
  }
  save();
  closeForm();
  sync();
});
$('fCancel').addEventListener('click', closeForm);
$('fDelete').addEventListener('click', () => { const a = editing; closeForm(); if (a) removeAccount(a); });
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeForm(); });

/* ---------- 상단 컨트롤 ---------- */
$('addBtn').addEventListener('click', () => openForm());
$('emptyAdd').addEventListener('click', () => openForm());
$('reloadAll').addEventListener('click', () => panes.forEach((p) => p.wv.reload()));
$('viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('textUp').addEventListener('click', () => changeTextSize(+1));
$('textDown').addEventListener('click', () => changeTextSize(-1));
$('cols').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cols]');
  if (!b) return;
  state.cols = b.dataset.cols;
  state.focusId = null;
  save();
  renderChips();
  applyLayout();
});

/* ---------- 단축키: Ctrl+1~9 계정 크게 보기, Ctrl+0·Esc 전체 보기 ---------- */
function hotkey(key) {
  if (key === '0') { state.focusId = null; renderChips(); applyLayout(); return; }
  const a = state.accounts[Number(key) - 1];
  if (a) toggleFocus(a.id);
}
window.api?.onHotkey(hotkey);
window.api?.onFocusAccount((id) => {
  if (!panes.has(id)) return;
  state.focusId = id;
  renderChips();
  applyLayout();
  panes.get(id).wv.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!menu.hidden) return closeMenu();
    if (!modal.hidden) return closeForm();
    if (!alertModal.hidden) return closeAlertSettings();
    if (state.focusId) hotkey('0');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && /^[0-9]$/.test(e.key)) { e.preventDefault(); hotkey(e.key); }
});

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

// 매물헌터 연결 창구로 넘길 계정별 안 읽음 현황
function pushStatus() {
  window.api?.setStatus({
    accounts: state.accounts.map((a) => {
      const p = panes.get(a.id);
      const chats = p?.chats && p.scan != null ? Array.from(p.chats, ([name, c]) => ({ name, text: c.text, n: c.n })).filter((c) => c.n > 0) : [];
      return { id: a.id, name: a.name, color: a.color, unread: p?.unread || 0, muted: !!a.muted, chatOpen: p?.scan != null, chats };
    }),
  });
}

// 번개장터가 콘솔 출력을 막아도 동작하도록, 페이지 스크립트의 상태를 주기적으로 직접 읽어 온다
setInterval(() => {
  pushStatus();
  panes.forEach((p, id) => {
    if (!p.ready) return;
    let wcId = 0;
    try { wcId = p.wv.getWebContentsId(); } catch { return; }
    // 바깥 페이지(채팅 전용 보기 상태) + 안쪽 채팅 프레임(안 읽음 수)을 함께 본다
    Promise.all([
      p.wv.executeJavaScript('({ s: window.__bmcState || null, n: window.__bmcTakeNotes ? window.__bmcTakeNotes() : [] })').catch(() => null),
      window.api ? window.api.talkState(wcId).catch(() => null) : null,
    ]).then(([top, frame]) => {
      // 번개장터가 띄우려던 알림 (대화방이 열려 있어 숫자가 안 늘어도 잡힘)
      const notes = [...((top && top.n) || []), ...((frame && frame.notes) || [])];
      if (notes.length) onNotes(id, notes);
      const ts = top && top.s;
      const fs = frame && frame.state;
      const d = fs && fs.chat ? { ...fs, mode: ts && ts.frame ? ts.mode : fs.mode } : ts;
      if (d) onReport(id, d);
    });
  });
}, 2000);

renderBell();
renderTopControls();
sync();
pushStatus();
