'use strict';
/*
 * Deal Hunter(매물헌터) 연결 창구.
 * 이 PC 안(127.0.0.1)에서만 열리고, 허용한 Hunter 주소에서 온 요청만 받는다.
 *   GET  /status  계정별 안 읽은 수·최근 대화 (화면에 이미 보이는 숫자만, 채팅 내용 수집 없음)
 *   POST /focus   {"id": "..."} 해당 계정 창을 앞으로 띄움
 * 채팅 발송·쿠키·세션 정보는 다루지 않는다.
 */
const http = require('http');

const PORT = 47615;
const ALLOWED_ORIGINS = new Set([
  'https://deal-hunter-v5.wwzb-64.chatgpt.site',
  'http://localhost:5173', // Hunter 개발 서버 (npm run dev)
  'http://127.0.0.1:5173',
  'http://localhost:4173', // Hunter 빌드 미리보기 (npm run preview)
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174', // Hunter 로컬 새 화면 (npm run preview:live)
  'http://localhost:4174',
]);
const OK_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function startBridge({ getStatus, focus, version }) {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    // 다른 사이트가 주소를 바꿔치기해서 들어오는 경우(DNS 리바인딩) 차단
    if (!OK_HOSTS.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(403).end(); return; }
    if (!ALLOWED_ORIGINS.has(origin)) { res.writeHead(403).end(); return; }

    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
      'Cache-Control': 'no-store',
    };
    const send = (code, body) => {
      res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'OPTIONS') { res.writeHead(204, headers).end(); return; }
    if (req.method === 'GET' && url.pathname === '/status') {
      send(200, { app: 'bungae-multichat', version, ...getStatus() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/focus') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1000) req.destroy(); });
      req.on('end', () => {
        let id = '';
        try { id = String(JSON.parse(raw || '{}').id || ''); } catch { /* 잘못된 요청 */ }
        if (id && !/^[a-z0-9]+$/i.test(id)) return send(400, { ok: false });
        send(200, { ok: focus(id || null) });
      });
      return;
    }
    send(404, { ok: false });
  });
  server.on('error', (e) => console.warn('[bridge] 연결 창구를 열지 못했습니다:', e.code || e.message));
  server.listen(PORT, '127.0.0.1');
  return server;
}

module.exports = { startBridge, BRIDGE_PORT: PORT };
