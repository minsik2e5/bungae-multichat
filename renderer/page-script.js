'use strict';
/*
 * 번개장터 페이지 안에서 실행되는 스크립트 (webview에 주입됨).
 * - 채팅 화면이 열려 있으면 상단 배너·헤더를 가리고 채팅 영역만 창 가득 채운다 (표시만 바꿈)
 * - 채팅 목록의 빨간 안 읽음 숫자를 읽어 앱에 알린다 (광고 채팅 제외)
 * 사이트 동작을 자동으로 누르거나 입력하지 않는다.
 */
function pageScript(opts) {
  // 번개장터가 띄우는 알림을 Windows 알림 대신 앱으로 넘긴다 (앱이 소리·팝업 하나로 알림)
  if (!window.__bmcNoteHook) {
    window.__bmcNoteHook = true;
    const notes = [];
    const push = (title, o) => {
      notes.push({ title: String(title || '').slice(0, 80), body: String((o && o.body) || '').slice(0, 160) });
      if (notes.length > 20) notes.shift();
    };
    const Fake = function (title, o) {
      push(title, o);
      this.title = String(title || '');
      this.body = (o && o.body) || '';
      this.onclick = this.onclose = this.onshow = this.onerror = null;
    };
    Fake.prototype.close = function () {};
    Fake.prototype.addEventListener = function () {};
    Fake.prototype.removeEventListener = function () {};
    Object.defineProperty(Fake, 'permission', { get: () => 'granted' });
    Fake.requestPermission = (cb) => { if (typeof cb === 'function') cb('granted'); return Promise.resolve('granted'); };
    try { window.Notification = Fake; } catch (e) { /* 덮어쓰기 불가 */ }
    try {
      if (window.ServiceWorkerRegistration) {
        ServiceWorkerRegistration.prototype.showNotification = function (title, o) { push(title, o); return Promise.resolve(); };
      }
    } catch (e) { /* 지원 안 함 */ }
    try {
      const q = navigator.permissions && navigator.permissions.query.bind(navigator.permissions);
      if (q) {
        navigator.permissions.query = (d) => (d && d.name === 'notifications'
          ? Promise.resolve({ state: 'granted', status: 'granted', onchange: null })
          : q(d));
      }
    } catch (e) { /* 지원 안 함 */ }
    window.__bmcTakeNotes = () => notes.splice(0);
  }
  if (window.__bmcSet) { window.__bmcSet(opts.chatOnly); return; }

  let chatOnly = !!opts.chatOnly;
  let applied = null;     // { root, saved: [[el, styleAttr]], html }
  let failedRoot = null;  // 전체 채우기가 실패한 요소 (재시도 방지)
  let lastSize = '';
  let mode = 'none';      // none | off | applied | fallback | failed

  const xp = (label) => document.evaluate(
    "//*[text()[normalize-space()='" + label + "']]", document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

  // '대화종료' 탭에서 위로 올라가며, 목록+대화창을 함께 담은 가장 가까운 넓은 요소를 찾는다
  function findRoot() {
    let el = xp('대화종료');
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      if (r.width >= 700 && r.height >= 300) return el;
      el = el.parentElement;
    }
    return null;
  }

  function save(el) {
    if (!applied.saved.some((s) => s[0] === el)) applied.saved.push([el, el.getAttribute('style')]);
  }

  function restore() {
    if (!applied) return;
    applied.saved.reverse().forEach(([el, st]) => {
      if (st === null) el.removeAttribute('style'); else el.setAttribute('style', st);
    });
    document.documentElement.style.overflow = applied.html;
    if (applied.bg) applied.bg.remove();
    applied = null;
  }

  // 목록·대화창 스크롤 영역이 높이가 고정돼 있으면 창 끝까지 늘린다
  function stretch(root) {
    const H = innerHeight;
    root.querySelectorAll('*').forEach((s) => {
      if (!/(auto|scroll)/.test(getComputedStyle(s).overflowY)) return;
      if (s.scrollHeight <= s.clientHeight + 4) return;
      const delta = H - 8 - s.getBoundingClientRect().bottom;
      if (delta < 20) return;
      for (let el = s; el && el !== root; el = el.parentElement) {
        save(el);
        const rect = el.getBoundingClientRect();
        el.style.height = Math.min(rect.height + delta, H - rect.top) + 'px';
        el.style.maxHeight = 'none';
      }
    });
  }

  function apply(root) {
    const r = root.getBoundingClientRect();
    // 1) 채팅 영역을 화면에 고정해서 덮는 방식
    applied = { root, saved: [], html: document.documentElement.style.overflow, bg: null };
    save(root);
    Object.assign(root.style, {
      position: 'fixed', top: '0px', left: r.left + 'px', width: r.width + 'px',
      height: '100vh', maxHeight: 'none', margin: '0px', zIndex: '2147483000',
      background: '#fff', boxSizing: 'border-box',
    });
    document.documentElement.style.overflow = 'hidden';
    // 채팅 영역 양옆으로 원래 페이지(배너·푸터)가 비치지 않도록 흰 배경을 깐다
    const bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147482999';
    document.body.appendChild(bg);
    applied.bg = bg;
    if (Math.abs(root.getBoundingClientRect().top) <= 2) { stretch(root); return 'applied'; }

    // 2) 상위 요소 때문에 고정이 안 되면, 채팅 영역보다 앞에 있는 배너·헤더를 숨기는 방식
    restore();
    applied = { root, saved: [], html: document.documentElement.style.overflow, bg: null };
    for (let el = root; el && el !== document.documentElement; el = el.parentElement) {
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
        save(sib);
        sib.style.setProperty('display', 'none', 'important');
      }
      save(el);
      el.style.setProperty('margin-top', '0px', 'important');
      el.style.setProperty('padding-top', '0px', 'important');
    }
    save(root);
    root.style.setProperty('height', '100vh', 'important');
    root.style.setProperty('max-height', 'none', 'important');
    document.documentElement.style.overflow = 'hidden';
    if (root.getBoundingClientRect().top <= 8) { stretch(root); return 'fallback'; }
    restore();
    return 'failed';
  }

  const isRed = (c) => {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return false;
    const [r, g, b, a] = m.map(Number);
    return (a === undefined || a > 0.5) && r >= 170 && g <= 100 && b <= 100;
  };
  const SKIP = /^(공식|광고|\d{1,3}\+?|·)$/;
  const DATE = /\s*·\s*(\d{1,2}월 \d{1,2}일|(오전|오후) \d{1,2}:\d{2}|어제|\d+\s*(분|시간|일)\s*전)\s*$/;

  function scan(root) {
    const byName = new Map();
    let total = 0;
    root.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!/^\d{1,3}\+?$/.test(t)) return;
      const red = isRed(getComputedStyle(el).backgroundColor) ||
        (el.parentElement && isRed(getComputedStyle(el.parentElement).backgroundColor));
      if (!red) return;
      let row = el.parentElement;
      for (let i = 0; i < 8 && row && row !== root; i++) {
        const r = row.getBoundingClientRect();
        if (r.height >= 50 && r.height <= 160 && r.width >= 250) break;
        row = row.parentElement;
      }
      const lines = (row && row !== root ? row.innerText || '' : '')
        .split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.some((l) => l.includes('(광고)'))) return; // 광고 채팅은 세지 않음
      const rest = lines.filter((l) => !SKIP.test(l));
      const name = (rest[0] || '알 수 없는 채팅').slice(0, 40);
      const text = (rest[1] || '').replace(DATE, '').slice(0, 120);
      const n = parseInt(t, 10);
      total += n;
      const cur = byName.get(name);
      byName.set(name, { name, text: cur ? cur.text : text, n: (cur ? cur.n : 0) + n });
    });
    return { total, chats: Array.from(byName.values()) };
  }

  // 새 채팅 화면: 목록·대화창이 별도 프레임(talk.bunjang.co.kr) 안에 있음
  function findTalkFrame() {
    if (!/^\/talk(\/|$)/.test(location.pathname)) return null;
    return Array.from(document.querySelectorAll('iframe'))
      .find((f) => /^https:\/\/talk\.bunjang\.co\.kr\//.test(f.src)) || null;
  }

  // 채팅 프레임을 창 전체로 띄우고 뒤의 배너·헤더를 흰 배경으로 가림
  function applyFrame(fr) {
    applied = { root: fr, saved: [], html: document.documentElement.style.overflow, bg: null };
    save(fr);
    Object.assign(fr.style, {
      position: 'fixed', top: '0px', left: '0px', width: '100vw', height: '100vh',
      maxWidth: 'none', maxHeight: 'none', margin: '0px', border: '0px',
      zIndex: '2147483000', background: '#fff',
    });
    document.documentElement.style.overflow = 'hidden';
    const bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147482999';
    document.body.appendChild(bg);
    applied.bg = bg;
    return 'applied';
  }

  function tick() {
    let root = null;
    try { root = findRoot(); } catch (e) { /* 페이지 로딩 중 */ }
    const frame = root ? null : findTalkFrame();
    if (frame) {
      if (applied && (applied.root !== frame || !document.contains(frame))) restore();
      if (!chatOnly) {
        if (applied) restore();
        mode = 'off';
      } else if (!applied) {
        mode = applyFrame(frame);
      }
      // 안 읽음 수는 프레임 안에서 따로 읽는다 (앱 쪽에서 합침)
      window.__bmcState = { chat: false, frame: true, mode };
      return;
    }
    if (!root) {
      if (applied) restore();
      failedRoot = null;
      mode = 'none';
      window.__bmcState = { chat: false, mode };
      return;
    }
    const size = innerWidth + 'x' + innerHeight;
    if (applied && (applied.root !== root || size !== lastSize || !document.contains(applied.root))) restore();
    lastSize = size;
    if (!chatOnly) {
      if (applied) restore();
      mode = 'off';
    } else if (failedRoot === root) {
      mode = 'failed';
    } else if (!applied) {
      mode = apply(root);
      if (mode === 'failed') failedRoot = root;
    }
    const s = scan(root);
    window.__bmcState = { chat: true, mode, total: s.total, chats: s.chats };
  }

  window.__bmcSet = (v) => { chatOnly = !!v; failedRoot = null; tick(); };
  window.__bmcDiag = () => {
    const a = xp('대화종료');
    const chain = [];
    for (let el = a; el && chain.length < 12; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      chain.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40) + ' ' +
        Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.top));
    }
    const root = findRoot();
    return JSON.stringify({
      path: location.pathname, vw: innerWidth, vh: innerHeight, anchor: !!a,
      root: root ? root.tagName.toLowerCase() + '.' + String(root.className).slice(0, 40) : null,
      mode, applied: !!applied, failed: !!failedRoot, badges: root ? scan(root).total : null, chain,
    }, null, 1);
  };

  window.addEventListener('resize', tick);
  setInterval(tick, 1000);
  tick();
}
