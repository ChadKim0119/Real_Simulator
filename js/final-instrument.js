/* Final_Instrument: 21:9 screen 1. The customer's car (cluster and head unit,
 * the vehicle simulator and the e-Care director run in it) fills the screen;
 * the conversation waits as a button and opens as a tall glass panel on the
 * right while a call is on, closing again a little after it ends. The journey
 * step sits small at the top left. Control panel: Link 'talk-panel'
 * { open: true | false | 'auto' }. */
(function () {
  'use strict';
  const { mmss, CASECOL, primary } = window.FinalUI;
  const E = window.ECare;
  const $ = (s) => document.querySelector(s);
  const talk = $('#talk'), fab = $('#fab'), badge = $('#fab .badge');
  const wave = $('#talk .wave');
  wave.innerHTML = Array.from({ length: 28 }, () => '<i></i>').join('');
  Scenes.mount($('#canvas'));

  let snap = null;
  let open = false, manual = null;        // manual: true / false while the presenter decides, null = automatic
  let closeAt = 0, seenLines = 0, callKey = '';
  function call() {
    if (!snap) return null;
    const g = snap.general;
    if (g && g.state !== 'ended') return { live: g.state === 'connected', ring: g.state === 'ringing', at: g.connectedAt, lines: (g.lines || []).length, dir: 'in', key: 'G' + g.at, general: true };
    const c = primary(snap);
    if (!c || !c.call) return null;
    const k = c.call;
    return { live: k.state === 'connected', ring: k.state === 'dialing', ended: k.state === 'ended' || k.state === 'failed', endedAt: k.endedAt, at: k.connectedAt, lines: (k.lines || []).filter((l) => !l.deleted).length, dir: k.dir, key: c.id + k.dir, c };
  }
  /* The panel grows out of the button (bottom right) and its header settles in, then folds
   * back into the button. GSAP when present (js/fx.js), the CSS transition otherwise. */
  const G = window.gsap;
  if (G) { talk.classList.add('gs'); fab.classList.add('gs'); G.set(talk, { autoAlpha: 0 }); }
  let talkTl = null;
  function setOpen(v) {
    if (v === open) return;
    open = v;
    talk.classList.toggle('on', open);
    fab.classList.toggle('hide', open);
    if (open) { badge.classList.remove('on'); }
    if (!G) return;
    if (talkTl) talkTl.kill();
    const head = talk.querySelectorAll('header > *');
    if (open) {
      talkTl = G.timeline()
        .to(fab, { scale: 0.55, autoAlpha: 0, duration: 0.32, ease: 'power2.in' }, 0)
        .fromTo(talk, { autoAlpha: 0, x: 70, y: 40, scale: 0.86, clipPath: 'inset(78% 0% 0% 72% round 42px)' },
          { autoAlpha: 1, x: 0, y: 0, scale: 1, clipPath: 'inset(0% 0% 0% 0% round 26px)', duration: 0.95, ease: 'expo.out' }, 0.08)
        .fromTo(head, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' }, 0.35)
        .fromTo(talk.querySelector('iframe'), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.45)
        .fromTo(talk.querySelector('.wave'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.6);
    } else {
      talkTl = G.timeline()
        .to(talk, { autoAlpha: 0, x: 50, y: 30, scale: 0.9, clipPath: 'inset(78% 0% 0% 72% round 42px)', duration: 0.6, ease: 'power3.inOut' }, 0)
        .fromTo(fab, { scale: 0.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, ease: 'back.out(2.2)' }, 0.38);
    }
  }
  // the badge pops when a new line comes in while the panel is closed
  let badgeN = 0;
  function popBadge(n) { if (n > badgeN && G && !open) G.fromTo(badge, { scale: 0.3 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' }); badgeN = n; }
  function tick() {
    const k = call();
    const now = Date.now();
    const ck = k ? k.key : (snap && snap.cases && snap.cases.length ? 'case:' + snap.cases[snap.cases.length - 1].id : '');
    if (ck !== callKey) { callKey = ck; seenLines = 0; manual = null; closeAt = 0; }     // a new case or call: start afresh
    let want = open;
    if (manual != null) want = manual;
    else if (k && (k.live || k.ring)) { want = true; closeAt = 0; }
    else if (k && k.ended && open) { if (!closeAt) closeAt = (k.endedAt || now) + 9000; if (now > closeAt) want = false; }
    else if (!k) want = false;
    setOpen(want);
    // header: who talks to whom, the call time
    const st = $('#talkState'), tm = $('#talkTime'), sub = $('#talkSub');
    if (k && k.live) { st.textContent = '통화 중'; st.className = 'live'; tm.textContent = k.at ? mmss(now - k.at) : ''; }
    else if (k && k.ring) { st.textContent = k.dir === 'out' ? '발신 중' : '연결 중'; st.className = ''; tm.textContent = ''; }
    else if (k && k.ended) { st.textContent = '통화 종료'; st.className = ''; }
    else { st.textContent = '대기'; st.className = ''; tm.textContent = ''; }
    const male = !!(k && k.c && k.c.call && (k.c.call.lines || []).some((l) => /ecare_m_/.test(l.audio || '')));
    const ci = $('#talk .av2 img:last-child'), avSrc = `assets/avatar_${male ? 'customer_m' : 'customer'}.webp`;
    if (!ci.src.endsWith(avSrc)) ci.src = avSrc;
    sub.textContent = !k ? 'e-Care 고객지원실 · 고객' : k.general ? `${E.CUSTOMER.name} 고객 · 일반 전화` : k.dir === 'out' ? `상담원 → ${E.CUSTOMER.name} 고객 휴대폰` : `${E.CUSTOMER.name} 고객 → 헤드유닛 콜`;
    // closed: a badge counts the lines said meanwhile, the button rings while a call comes in
    const n = k ? k.lines : 0;
    if (open) seenLines = n;
    badge.textContent = Math.max(0, n - seenLines);
    popBadge(Math.max(0, n - seenLines));
    badge.classList.toggle('on', !open && n > seenLines);
    fab.classList.toggle('ring', !open && !!k && (k.live || k.ring));
    // the scenario step playing on the control panel, top left (the panel sends it)
    renderStep();
  }
  let scn = null, stepKey = '';
  function renderStep() {
    const jr = $('#journey');
    const c = primary(snap);
    jr.style.setProperty('--case', c ? CASECOL[(c.wng && c.wng.case) || c.wcase || 'A'] : '#4f8cff');
    const show = !!scn && scn.i >= 0 && !document.body.classList.contains('scene-on');
    jr.classList.toggle('on', show);
    if (!scn || scn.i < 0) return;
    const key = `${scn.sc}|${scn.i}|${scn.n}`;
    if (key === stepKey) return;
    stepKey = key;
    // the new step slides in
    jr.classList.remove('swap'); void jr.offsetWidth; jr.classList.add('swap');
    $('#journey i').textContent = `STEP ${scn.i + 1}`;
    $('#journey b').textContent = scn.t;
    $('#journey em').textContent = `/ ${scn.n}${scn.grp ? ' · ' + scn.grp : ''}`;
    $('#journey .dots').innerHTML = scn.n <= 14 ? Array.from({ length: scn.n }, (_, i) => `<u class="${i < scn.i ? 'done' : i === scn.i ? 'cur' : ''}"></u>`).join('')
      : `<u class="bar"><s style="width:${((scn.i + 1) / scn.n * 100).toFixed(1)}%"></s></u>`;
  }
  Link.on('scn-step', (d) => { scn = d; renderStep(); });
  Link.send('scn-hello', {});
  // messages to or from the car: a short note, one at a time
  let fSeen = -1, linkQ = [], linkT = 0;
  const WHO = { vdp: '일본측 서버', cti: 'e-Care 상담', ccw: 'e-Care 상담원', wam: '업무 흐름 서버' };
  function linkNotes(d) {
    const fl = d.flows || [];
    if (fSeen < 0) { fSeen = fl.length ? fl[fl.length - 1].id : 0; return; }
    if (fl.length && fl[fl.length - 1].id < fSeen) fSeen = 0;
    for (const f of fl) {
      if (f.id <= fSeen) continue;
      fSeen = f.id;
      if (f.from === 'car' && f.to !== 'car') linkQ.push({ t: `차량 → ${WHO[f.to] || f.to}`, api: f.api, col: '#4f8cff' });
      else if (f.to === 'car' && f.from !== 'car' && !/음성/.test(f.api)) linkQ.push({ t: `${WHO[f.from] || f.from} → 차량`, api: f.api, col: '#3ddc84' });
    }
  }
  setInterval(() => {
    const el = $('#link');
    if (Date.now() < linkT) return;
    const n = linkQ.shift();
    if (!n) { el.classList.remove('on'); return; }
    el.style.setProperty('--lc', n.col);
    $('#link span').innerHTML = `<b>${n.api.replace(/[<>&]/g, '')}</b>${n.t.replace(/[<>&]/g, '')}`;
    el.classList.add('on');
    linkT = Date.now() + 2600;
  }, 300);
  Link.on('ecare', (d) => {
      if (!d || !d.cases) return; snap = d; linkNotes(d); tick(); });
  setInterval(tick, 500);
  // who speaks: the wave under the conversation follows the voice
  let sayT = 0;
  Link.on('say', (d) => {
    const dur = ((d.line && d.line.dur) || 3) * 1000;
    talk.classList.add('speaking');
    talk.style.setProperty('--w', d.line && d.line.who === 'agent' ? '#5aa2ff' : '#3ddc84');
    clearTimeout(sayT); sayT = setTimeout(() => talk.classList.remove('speaking'), dur);
  });
  Link.on('hush', () => { clearTimeout(sayT); talk.classList.remove('speaking'); });
  fab.addEventListener('click', () => { manual = !open; setOpen(manual); });
  $('#talkMin').addEventListener('click', () => { manual = false; setOpen(false); });
  Link.on('talk-panel', (d) => { manual = d.open === 'auto' ? null : !!d.open; tick(); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyT') { manual = !open; setOpen(manual); } });
  Link.send('hello', { screen: 'final-instrument' });
})();
