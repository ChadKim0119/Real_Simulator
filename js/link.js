/* Demo link: keeps every screen of the demo (vehicle, call center, transcript,
 * and later HU, operation web, DMS, data flow) in sync.
 *
 * Transports, used together and de-duplicated by message id:
 *  - BroadcastChannel: windows of one browser on one computer (no network)
 *  - LAN relay (tools/relay.mjs): screens on several computers. Used
 *    automatically when the pages are served by the relay.
 */
(function () {
  'use strict';

  const CHANNEL = 'gs-demo-v1';
  const me = Math.random().toString(36).slice(2, 10);
  const seen = new Set();
  const handlers = {};
  let relay = false;
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }

  function deliver(msg) {
    if (!msg || !msg.id || seen.has(msg.id) || msg.from === me) return;
    seen.add(msg.id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    (handlers[msg.type] || []).forEach((fn) => { try { fn(msg.data, msg); } catch (e) { console.error(e); } });
    (handlers['*'] || []).forEach((fn) => { try { fn(msg.data, msg); } catch (e) { console.error(e); } });
  }

  /* LAN relay (only when this page is served by tools/relay.mjs). A browser
   * opens one relay connection, held by a leader tab chosen with a Web Lock:
   * Chrome allows six connections per host, and the stage windows with their
   * iframes would otherwise use them all up and stall. The leader bridges the
   * relay and the BroadcastChannel; when it closes, another tab takes over. */
  let leader = false;
  const post = (msg) => fetch('/__relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {});
  if (bc) bc.onmessage = (e) => {
    const fresh = e.data && !seen.has(e.data.id);
    deliver(e.data);
    if (leader && fresh) post(e.data);
  };
  // fallback for browsers without BroadcastChannel
  window.addEventListener('storage', (e) => {
    if (e.key === CHANNEL && e.newValue) { try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore */ } }
  });

  function lead() {
    leader = true;
    const es = new EventSource('/__relay/events');
    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || seen.has(msg.id)) return;
      deliver(msg);
      if (bc) bc.postMessage(msg);
    };
  }
  fetch('/__relay/ping', { cache: 'no-store' }).then((r) => {
    if (!r.ok) return;
    relay = true;
    Link.transport = 'lan';
    (handlers['@transport'] || []).forEach((fn) => fn('lan'));
    // without BroadcastChannel or Web Locks every page keeps its own connection
    if (bc && navigator.locks) navigator.locks.request('gs-relay-leader', () => new Promise(() => lead()));
    else lead();
  }).catch(() => {});

  const Link = {
    me,
    transport: bc ? 'local' : 'storage',
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    send(type, data) {
      const msg = { id: me + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), from: me, type, data, at: Date.now() };
      seen.add(msg.id);
      if (bc) bc.postMessage(msg);
      else { try { localStorage.setItem(CHANNEL, JSON.stringify(msg)); } catch (e) { /* ignore */ } }
      if (relay && (leader || !bc || !navigator.locks)) post(msg);
    },
  };
  window.Link = Link;
})();
