/* Head unit (MM) of the customer's car, for the auditorium's left screen.
 * Shows the e-Care warning popup from the WNG master texts, the [전화연결]
 * button that places the MM inbound call to the call center, the call and
 * dispatch status; for outbound calls the customer's phone slides in.
 * The presenter's remote presses the button (Link 'hu' {action:'press'}). */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const root = $('#root');

  function fit() {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    root.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
  }
  addEventListener('resize', fit);
  fit();

  let snap = null, veh = null;
  let pressed = null;            // case id whose [전화연결] was pressed
  let shownAt = {};              // case id -> when its popup appeared
  let reopen = {};               // case id -> popup reopened by the remote
  let caption = null;
  Link.on('ecare', (d) => { snap = d; render(); });
  Link.on('veh', (d) => { veh = d; });
  Link.on('say', (d) => { caption = { who: d.line.who, text: d.line.text, until: Date.now() + (d.line.dur || 4) * 1000 + 2500 }; });
  const show = () => { const c = current(); if (c) { reopen[c.id] = Date.now(); render(true); } };
  Link.on('hu', (d) => {
    if (d.action === 'show') show();
    if (d.action === 'press') press();
  });
  Link.send('hello', { screen: 'hu' });
  $('#hu').addEventListener('click', (e) => {
    if (e.target.closest('button.call')) press();
    else if (e.target.closest('.pop button')) { const c = current(); if (c) { shownAt[c.id] = 1; reopen[c.id] = 0; render(true); } }
    else if (e.target.closest('.mini')) show();
  });

  const current = () => snap && (snap.cases.find((c) => c.id === snap.active) || snap.cases[0]);
  const phoneSvg = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>';

  function press() {
    const c = current();
    if (!c || c.wcase !== 'A' || c.contact > 0 || c.inbound) return;
    reopen[c.id] = Date.now();
    pressed = c.id;
    render(true);
    const b = $('.pop button.call');
    if (b) b.classList.add('press');
    // the MM call goes out through CTI to the call center
    setTimeout(() => Link.send('cmd', { name: 'inbound', args: {} }), 650);
  }

  function state() {
    const c = current();
    const g = snap && snap.general;
    if (!c) return { v: 'home' };
    const call = c.call;
    if (c.inbound && !call) return { v: 'calling', c };
    if (call && call.dir === 'in' && call.state === 'connected') return { v: 'incall', c };
    if (call && call.dir === 'out' && (call.state === 'dialing' || call.state === 'connected')) return { v: 'home', c, phone: call.state, out: true };
    if (c.sms && !(c.sheet && c.sheet.saved && Date.now() - c.sheet.saved > 15000)) return { v: 'home', c, phone: 'sms' };
    const open = c.contact === 0 && !c.inbound;
    if ((open && c.kind === 'emergency') || (c.wcase !== 'A' && Date.now() - c.at < 20000)) {
      const since = Date.now() - Math.max(shownAt[c.id] || (shownAt[c.id] = Date.now()), reopen[c.id] || 0);
      return { v: since < 12000 || pressed === c.id ? 'pop' : 'mini', c };
    }
    return { v: 'home', c, g };
  }

  let lastKey = '';
  function render(force) {
    if (!snap) return;
    const s = state();
    const c = s.c;
    const key = JSON.stringify([s.v, s.phone, c && [c.id, c.contact, c.dispatch, c.dms, c.call && c.call.state, c.sheet && !!c.sheet.saved], pressed]);
    if (!force && key === lastKey) return;
    lastKey = key;
    const hu = $('#hu');
    const alert = c && c.contact === 0 && c.kind === 'emergency';
    const bar = `<div class="bar"><span class="num" data-clock></span><span>18°C</span><span>LTE ▮▮▮</span><span class="ecare ${alert ? 'alert' : ''}"><i></i>e-Care</span></div>`;
    let body = home(c);
    if (s.v === 'pop') body += popup(c);
    if (s.v === 'mini') body += `<div class="mini"><i></i>${esc(c.wng ? c.wng.name : c.warn.title)} 경고 · e-Care 연결 가능</div>`;
    if (s.v === 'calling') body = callScreen(c, false);
    if (s.v === 'incall') body = callScreen(c, true);
    hu.innerHTML = bar + body;
    hu.classList.toggle('dim', !!s.phone);
    hu.querySelectorAll('canvas[data-ic]').forEach((cv) => {
      const g = cv.getContext('2d');
      cv.width = cv.height = 220;
      SimIcons.drawIcon(g, cv.dataset.ic, 110, 110, 150, cv.dataset.col, cv.dataset.col);
    });
    phone(s);
    tick();
  }

  function home(c) {
    let card = `<div class="card"><small>미디어</small><b>NEON</b><span>A2O LITE</span></div>`;
    let st = '';
    if (c && c.wcase === 'A' && c.contact > 0) {
      const parts = [E.CONTACT[c.contact], c.dispatch >= 0 ? `긴급출동 ${E.DISPATCH[c.dispatch]}` : '', c.dms >= 0 ? `${c.dealer} ${E.DMS[c.dms]}` : ''].filter(Boolean);
      st = `<div class="card st"><small>e-Care</small><b>${parts.join(' · ')}</b><span>상담센터 연결 완료</span></div>`;
    } else if (c && c.wcase !== 'A' && c.dms >= 0) {
      st = `<div class="card st"><small>e-Care · 서비스센터</small><b>${esc(c.dealer)} ${E.DMS[c.dms]}</b><span>서비스센터에서 연락드립니다</span></div>`;
    } else if (c && c.contact === 0) {
      st = `<div class="card warn"><small>차량 경고</small><b>${esc(c.wng ? c.wng.name : c.warn.title)}</b><span>${c.wcase === 'A' ? '주행 불가 · 콜센터 연결 가능' : '점검 필요'}</span></div>`;
    }
    const disp = c && c.dispatch >= 0 && c.dispatch < 3 ? `<div class="disp">🚚 <b>긴급출동 ${E.DISPATCH[c.dispatch]}</b> · ${c.dispatch === 0 ? '출동 차량 배정 중' : c.dispatch === 1 ? '도착 예정 12분' : '현장 도착 · 견인 준비'}</div>` : '';
    return `<div class="scr home">${disp}<div class="map"><svg viewBox="0 0 1180 690"><path d="M120 690 C 300 520, 360 420, 560 360 S 860 250, 1180 140" stroke="#2f6fe0" stroke-width="18" fill="none" stroke-linecap="round" opacity="0.85"/><path d="M0 300 L1180 330 M420 0 L520 690 M820 0 L760 690" stroke="#1d2a3c" stroke-width="10"/><circle cx="560" cy="360" r="20" fill="#fff"/><circle cx="560" cy="360" r="11" fill="#2f6fe0"/></svg>
      <div class="turn"><b>↗ 2.3 km</b><span>456번 지방도 · 직진</span></div></div>
      <div class="side">${st}${card}<div class="card"><small>주행</small><b class="num" data-speed>0 km/h</b><span>GX 550 · 123가4567</span></div></div></div>`;
  }

  function popup(c) {
    const w = c.wng || { name: c.warn.title, case: 'A' };
    const A = w.case === 'A';
    const text = A
      ? `${w.name} 이상이 감지되었습니다. 즉시 안전한 장소에 정차하시기 바랍니다. 차량을 계속 운전하면 위험할 수 있습니다. 콜센터에 연결하겠습니까?`
      : `${w.name} 이상이 감지되었습니다. 가까운 서비스센터에서 점검을 받아주시기 바랍니다. 딜러에 연결하겠습니까?`;
    const col = A ? '#ff4757' : '#ffb02e';
    return `<div class="pop ${A ? '' : 'b'}"><div class="hd"><canvas data-ic="${c.warn.id}" data-col="${col}"></canvas><div><b>${esc(w.name)}</b><span>${A ? '주행 불가 · 긴급' : '점검 필요'}</span></div></div>
      <p>${esc(text)}</p>
      <div class="btns"><button class="call">${phoneSvg}${A ? '전화연결' : '서비스센터 연결'}</button><button>닫기</button></div>
      <div class="foot">e-Care · 연결하면 차량 진단 정보가 ${A ? '상담센터' : '서비스센터'}로 함께 전달됩니다</div></div>`;
  }

  function callScreen(c, live) {
    const w = c.wng || { code: '', name: c.warn.title };
    const disp = c.dispatch >= 0 ? `<div class="disp">🚚 <b>긴급출동 ${E.DISPATCH[c.dispatch]}</b> · ${c.dispatch === 0 ? '출동 차량 배정 중' : c.dispatch === 1 ? '도착 예정 12분' : '현장 도착'}</div>` : '';
    return `<div class="callscr ${live ? 'live' : ''}">${disp}<div class="who"><div class="av">e-Care</div><div><b>e-Care 상담센터</b><span data-calltime>${live ? '통화 중' : '연결 중…'}</span><em>차량 진단 정보 함께 전송 · ${esc(w.code)} ${esc(w.name)}</em></div></div>
      <div class="ctl"><div><i>🎤</i>음소거</div><div><i>⌨</i>키패드</div><div><i>🔊</i>스피커</div><div></div><div class="end"><i>${phoneSvg.replace('fill="#fff"', 'fill="#fff" style="transform:rotate(135deg);width:60px"')}</i>종료</div><div></div></div></div>`;
  }

  let phoneKey = '';
  function phone(s) {
    const el = $('#phone');
    const k = s.phone || '';
    el.classList.toggle('on', !!k);
    if (k === phoneKey) return;
    phoneKey = k;
    if (k === 'dialing') el.innerHTML = `<div class="ps"><small>휴대전화 수신</small><b>e-Care 상담센터</b><span>전화가 왔습니다</span><div class="btn2"><i class="no">✕</i><i class="yes">${phoneSvg.replace('<svg', '<svg width="60"')}</i></div></div>`;
    else if (k === 'connected') el.innerHTML = `<div class="ps"><small>통화 중</small><b>e-Care 상담센터</b><span data-ptime>00:00</span></div>`;
    else if (k === 'sms') el.innerHTML = `<div class="ps"><small>메시지</small><b>e-Care 상담센터</b><div class="sms">[e-Care] 고객님 차량에서 주행 불가 경고가 감지되어 3차례 연락드렸으나 연결되지 않았습니다. 안전한 곳에 정차 후 상담센터로 연락 주시기 바랍니다.</div></div>`;
  }

  function tick() {
    const t = new Date();
    document.querySelectorAll('[data-clock]').forEach((e) => { e.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}`; });
    if (veh) document.querySelectorAll('[data-speed]').forEach((e) => { e.textContent = `${Math.round(veh.speed)} km/h`; });
    const c = current();
    const call = c && c.call;
    const ct = $('[data-calltime]');
    if (ct && call && call.connectedAt) ct.textContent = `통화 중 ${E.mmss(Date.now() - call.connectedAt)}`;
    const pt = $('[data-ptime]');
    if (pt && call && call.connectedAt) pt.textContent = E.mmss(Date.now() - call.connectedAt);
    const cap = $('#cap');
    if (caption && Date.now() < caption.until) {
      cap.innerHTML = `<small class="${caption.who === 'agent' ? '' : 'c'}">${caption.who === 'agent' ? 'e-Care 상담원' : `${E.CUSTOMER.name} 고객`}</small><p>${esc(caption.text)}</p>`;
      cap.classList.add('on');
    } else cap.classList.remove('on');
  }
  setInterval(() => { tick(); render(); }, 300);
})();
