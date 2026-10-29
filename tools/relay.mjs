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
import { readFile, stat } from 'node:fs/promises';
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
  console.log(`e-Care demo relay on port ${PORT}`);
  for (const ip of ips.length ? ips : ['localhost']) {
    console.log(`  vehicle     http://${ip}:${PORT}/`);
    console.log(`  call center http://${ip}:${PORT}/ccw.html   (agent screen only: /ccw.html?view=app)`);
    console.log(`  transcript  http://${ip}:${PORT}/ccw.html?view=transcript`);
  }
});
