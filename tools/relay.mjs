#!/usr/bin/env node
/* LAN relay for the multi-screen demo. No dependencies (Node 18+).
 *
 *   node tools/relay.mjs            # serves this folder on http://<this-pc>:8787
 *   PORT=9000 node tools/relay.mjs
 *
 * Every screen (vehicle, call center, transcript, HU, OPW, DMS, data flow) is
 * opened from this server, e.g. http://192.168.0.10:8787/ccw.html, on any PC
 * on the same network. Pages detect the relay and sync through it
 * (Server-Sent Events down, POST up); without it they fall back to syncing
 * windows of one browser.
 */
import http from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.env.PORT || 8787);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};
const clients = new Set();
const recent = [];                 // last messages, replayed to late joiners

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__relay/ping') { res.writeHead(200, { 'Cache-Control': 'no-store' }); return res.end('ok'); }
  if (url.pathname === '/__relay/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hello\n\n');
    recent.forEach((m) => res.write(`data: ${m}\n\n`));
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }
  if (url.pathname === '/__relay/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const line = JSON.stringify(msg);
        if (msg.type === 'ecare') { recent.splice(0, recent.length, line); }
        for (const c of clients) c.write(`data: ${line}\n\n`);
      } catch (e) { /* ignore */ }
      res.writeHead(204); res.end();
    });
    return;
  }
  // line recordings cut on the transcript screen (대화 스크립트 · 음성 세트)
  if (url.pathname === '/__relay/audio' && req.method === 'POST') {
    const name = (url.searchParams.get('name') || '').replace(/[^\w-]/g, '').slice(0, 80);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 30e6) req.destroy(); else chunks.push(c); });
    req.on('end', async () => {
      if (!name) { res.writeHead(400); return res.end(); }
      try {
        await mkdir(join(ROOT, 'assets', 'audio', 'user'), { recursive: true });
        await writeFile(join(ROOT, 'assets', 'audio', 'user', `${name}.wav`), Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: `assets/audio/user/${name}.wav` }));
      } catch (e) { res.writeHead(500); res.end(); }
    });
    return;
  }
  // static files
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`e-Care 시연 릴레이 · 포트 ${PORT} — 같은 네트워크의 모든 PC · 아이패드에서 아래 주소로 여세요`);
  for (const ip of ips.length ? ips : ['localhost']) {
    const u = (path) => `http://${ip}:${PORT}/${path}`;
    console.log('');
    console.log(`  시연 화면 (4분할 · 차량 포함)   ${u('wall.html')}`);
    console.log(`  컨트롤 패널 (아이패드 가능)     ${u('control.html')}`);
    console.log(`  데이터 흐름 (단독 화면)         ${u('flow.html')}`);
    console.log(`  상담원 화면 CCW (단독)          ${u('agent.html')}`);
    console.log(`  고객지원실 실사 (시선 제어)     ${u('office.html')}`);
    console.log(`  상담 대화 (아이패드 가능)       ${u('ccw.html?view=transcript')}`);
    console.log(`  고객 차량 단독 (wall 대신)      ${u('index.html?stage=1&hu=1')}`);
    console.log(`  모니터 테스트                   ${u('test.html')}`);
  }
  console.log('');
  console.log('  ※ 차량 시뮬레이터(wall.html 또는 index.html)는 전체 기기 중 한 곳에서만 엽니다.');
  console.log('  ※ 위 주소로 연 화면은 LAN과 인터넷을 함께 써서, Vercel 주소로 연 다른 기기와도 동기화됩니다.');
});
