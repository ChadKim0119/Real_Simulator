/* Demo link: keeps every screen of the demo (vehicle, call center, transcript,
 * head unit, data flow, control panel, monitor test) in sync.
 *
 * Transports, used together and de-duplicated by message id:
 *  - BroadcastChannel: windows of one browser on one computer (no network)
 *  - LAN relay (tools/relay.mjs): screens on several computers of one network,
 *    also offline. Used automatically when the pages are served by the relay.
 *  - Internet (Supabase Realtime broadcast): any device anywhere that opens the
 *    site, e.g. https://real-simulator.vercel.app on a Mac, a PC, a phone and an
 *    iPad. On by default; ?room=<name> keeps a separate group of devices
 *    (remembered by the browser), ?cloud=0 turns it off.
 *
 * A browser keeps one network connection, held by a leader tab chosen with a
 * Web Lock: the other tabs and iframes reach it over the BroadcastChannel.
 */
(function () {
  'use strict';

  /* A page shown inside another (a panel of wall.html or of a Final screen): F makes the
   * whole outer screen full screen, not this panel alone. Inside a Final screen every key
   * goes to that screen (its own shortcuts: F, D, T, arrows), so a key pressed on the show
   * screen never drives the car or the call center by accident. */
  if (window.top !== window) {
    addEventListener('keydown', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable]')) return;
      let outer = null;
      try { outer = window.parent.document.body; } catch (err) { return; }    // another site: leave it
      const final = outer && (outer.classList.contains('fi') || outer.classList.contains('fd'));
      if (e.code !== 'KeyF' && !final) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { window.parent.dispatchEvent(new KeyboardEvent('keydown', { code: e.code, key: e.key, bubbles: true })); } catch (err) { /* gone */ }
    }, true);
  }

  const CHANNEL = 'gs-demo-v1';
  const me = Math.random().toString(36).slice(2, 10);
  const seen = new Set();
  const handlers = {};
  let relay = false;
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }

  /* internet relay: a public broadcast channel of the demo's Supabase project.
   * Only demo messages pass through it; the key is the project's public (anon) key. */
  const CLOUD = {
    url: 'wss://mffysunppwqscbljooda.supabase.co/realtime/v1/websocket',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZnlzdW5wcHdxc2NibGpvb2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDk4MzIsImV4cCI6MjEwMzM4NTgzMn0.moKfLQF08obzVyIfDK8bqI5EX91EAfIF6W-2jtZ1NvY',
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const qs = new URLSearchParams(location.search);
  if (qs.has('room')) store.set('link-room', (qs.get('room') || 'main').replace(/[^\w-]/g, '').slice(0, 32) || 'main');
  if (qs.has('cloud')) store.set('link-cloud', qs.get('cloud') === '0' ? 'off' : 'on');
  const room = store.get('link-room') || 'main';
  const cloudWanted = store.get('link-cloud') !== 'off' && 'WebSocket' in window;

  function deliver(msg) {
    if (!msg || !msg.id || seen.has(msg.id) || msg.from === me) return;
    seen.add(msg.id);
    if (seen.size > 4000) seen.delete(seen.values().next().value);
    (handlers[msg.type] || []).forEach((fn) => { try { fn(msg.data, msg); } catch (e) { console.error(e); } });
    (handlers['*'] || []).forEach((fn) => { try { fn(msg.data, msg); } catch (e) { console.error(e); } });
  }
  const fire = () => (handlers['@transport'] || []).forEach((fn) => { try { fn(Link.transport); } catch (e) { console.error(e); } });

  /* ---------------- LAN relay ---------------- */
  let leader = false;
  const post = (msg) => fetch('/__relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {});
  function openRelay() {
    const es = new EventSource('/__relay/events');
    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || seen.has(msg.id)) return;
      deliver(msg);
      if (bc) bc.postMessage(msg);
    };
  }

  /* ---------------- internet relay (Supabase Realtime, Phoenix protocol) ---------------- */
  const cloud = (function () {
    const topic = `realtime:gs-ecare-${room}`;
    let ws = null, ref = 0, hb = null, joined = false, retry = 1000;
    const queue = [];
    // the vehicle state goes out 4 times a second: over the internet the latest
    // one every half second is plenty (the rest are sent as they come)
    const LATEST = { veh: 500 };
    const pending = {}, lastAt = {};
    const raw = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
    function open() {
      try { ws = new WebSocket(`${CLOUD.url}?apikey=${CLOUD.key}&vsn=1.0.0`); } catch (e) { return; }
      ws.onopen = () => {
        retry = 1000;
        raw({ topic, event: 'phx_join', ref: String(++ref), join_ref: '1', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false }, access_token: CLOUD.key } });
        clearInterval(hb);
        hb = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.topic !== topic) return;
        if (m.event === 'phx_reply' && !joined) {
          if (m.payload && m.payload.status === 'ok') { joined = true; status(); while (queue.length) publish(queue.shift()); }
        } else if (m.event === 'broadcast') {
          const msg = m.payload && m.payload.payload;
          if (!msg || !msg.id || seen.has(msg.id)) return;
          deliver(msg);
          if (bc) bc.postMessage(msg);
        } else if (m.event === 'phx_error' || m.event === 'phx_close') {
          try { ws.close(); } catch (err) { /* closing */ }
        }
      };
      ws.onclose = () => {
        clearInterval(hb);
        if (joined) { joined = false; status(); }
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      };
      ws.onerror = () => {};
    }
    function send(msg) { raw({ topic, event: 'broadcast', ref: String(++ref), payload: { type: 'broadcast', event: 'm', payload: msg } }); }
    function publish(msg) {
      if (!joined) { queue.push(msg); if (queue.length > 60) queue.shift(); return; }
      const gap = LATEST[msg.type];
      if (!gap) { send(msg); return; }
      const now = Date.now(), wait = (lastAt[msg.type] || 0) + gap - now;
      if (wait <= 0) { lastAt[msg.type] = now; send(msg); return; }
      if (!pending[msg.type]) setTimeout(() => { const m = pending[msg.type]; pending[msg.type] = null; lastAt[msg.type] = Date.now(); if (m) send(m); }, wait);
      pending[msg.type] = msg;
    }
    // the leader tells the other tabs of its browser whether the internet link is up
    function status() {
      Link.online = joined;
      fire();
      if (bc) bc.postMessage({ id: `${me}-st-${Date.now().toString(36)}`, from: me, type: '@link', data: { online: joined } });
    }
    setInterval(() => { if (leader && cloudWanted) status(); }, 5000);
    return { open, publish, isUp: () => joined };
  }());
  // a tab that is not the leader learns the link state from the leader
  handlers['@link'] = [(d) => { if (!leader && Link.online !== !!d.online) { Link.online = !!d.online; fire(); } }];

  // messages of the last seconds before this tab knew it leads (a new screen's
  // 'hello' asking for the current state): sent on once it does
  const early = [];
  const keepEarly = (msg) => { if (!leader && msg && msg.type !== '@link') { early.push(msg); if (early.length > 80) early.shift(); } };
  function lead() {
    leader = true;
    if (relay) openRelay();
    if (cloudWanted) cloud.open();
    const since = Date.now() - 15000;
    early.splice(0).forEach((m) => { if ((m.at || 0) > since) forward(m); });
  }
  function forward(msg) {
    if (msg.type === '@link') return;
    if (relay) post(msg);
    if (cloudWanted) cloud.publish(msg);
  }
  if (bc) bc.onmessage = (e) => {
    const fresh = e.data && !seen.has(e.data.id);
    deliver(e.data);
    if (leader && fresh) forward(e.data);
    else if (fresh) keepEarly(e.data);
  };
  // fallback for browsers without BroadcastChannel
  window.addEventListener('storage', (e) => {
    if (e.key === CHANNEL && e.newValue) { try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore */ } }
  });

  function start() {
    Link.transport = relay ? (cloudWanted ? 'lan+cloud' : 'lan') : cloudWanted ? 'cloud' : bc ? 'local' : 'storage';
    Link.relay = relay;
    fire();
    if (!relay && !cloudWanted) return;
    // without BroadcastChannel or Web Locks every page keeps its own connection
    if (bc && navigator.locks) navigator.locks.request('gs-relay-leader', () => new Promise(() => lead()));
    else lead();
  }
  fetch('/__relay/ping', { cache: 'no-store' }).then((r) => { relay = r.ok; }).catch(() => {}).finally(start);

  const Link = {
    me,
    room,
    relay: false,
    online: false,
    transport: bc ? 'local' : 'storage',
    /** short text for status lines: how this screen is linked to the others */
    label() {
      const net = Link.online ? `인터넷 · ${room === 'main' ? '기본 방' : `방 ${room}`}` : cloudWanted ? '인터넷 연결 중…' : '';
      return [Link.relay ? 'LAN 릴레이' : '', net].filter(Boolean).join(' + ') || '이 PC (같은 브라우저)';
    },
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    send(type, data) {
      const msg = { id: me + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), from: me, type, data, at: Date.now() };
      seen.add(msg.id);
      if (bc) bc.postMessage(msg);
      else { try { localStorage.setItem(CHANNEL, JSON.stringify(msg)); } catch (e) { /* ignore */ } }
      if (leader || !bc || !navigator.locks) forward(msg);
      else keepEarly(msg);
    },
  };
  window.Link = Link;
})();
