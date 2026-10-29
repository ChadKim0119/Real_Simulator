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

  if (bc) bc.onmessage = (e) => deliver(e.data);
  // fallback for browsers without BroadcastChannel
  window.addEventListener('storage', (e) => {
    if (e.key === CHANNEL && e.newValue) { try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore */ } }
  });

  // LAN relay: only when this page is served by tools/relay.mjs
  fetch('/__relay/ping', { cache: 'no-store' }).then((r) => {
    if (!r.ok) return;
    relay = true;
    const es = new EventSource('/__relay/events');
    es.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
    Link.transport = 'lan';
    (handlers['@transport'] || []).forEach((fn) => fn('lan'));
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
      if (relay) fetch('/__relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {});
    },
  };
  window.Link = Link;
})();
