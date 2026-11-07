/* After the rescue: the car view is masked and the screen says what happens now — the
 * service center (dealer) follows up. The dealer calls the customer's phone, books the
 * visit, and the reservation goes back to the e-Care agent, which closes the e-Care task.
 * Used over the car on Final_Instrument and on the wall's car panel.
 *   const f = Follow.mount(host, { before, padRight }); f.render(snapshot);
 * Sizes are in em; the host's width sets the font size (2560 px wide = 16 px). */
(function () {
  'use strict';
  const E = window.ECare;
  const mmss = (ms) => E.mmss(ms);

  function mount(host, opt) {
    const o = opt || {};
    const el = document.createElement('section');
    el.className = 'follow';
    el.setAttribute('aria-live', 'polite');
    if (o.padRight) el.style.setProperty('--padR', `${o.padRight / 16}em`);
    el.innerHTML = `<div class="fw">
        <div class="ftag"><i></i>긴급출동 완료 이후 · e-Care → 서비스센터</div>
        <h2>서비스센터(딜러) 후속 처리</h2>
        <p class="who"><img src="assets/avatar_dealer.webp" alt=""><span><b data-f="center">강남 서비스센터</b><small>서비스 어드바이저 이정비 · ${E.CUSTOMER.name} 고객 담당</small></span></p>
        <ol class="fs">
          <li data-s="0"><i>1</i><b>상담 메모 이관 접수</b><small>e-Care 상담원 → 서비스센터 DMS</small></li>
          <li data-s="1"><i>2</i><b>딜러 → 고객 통화</b><small>고객 안심 안내 · 방문 일정 조율</small></li>
          <li data-s="2"><i>3</i><b>입고 예약 확정</b><small>오늘 견인 입고 · 내일 오전 10시 점검</small></li>
          <li data-s="3"><i>4</i><b>예약 · 입고 정보 → e-Care 상담원</b><small>상담원 화면 도착 시 e-Care 과업 종료</small></li>
        </ol>
        <div class="call"><span class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg></span>
          <div><b data-f="cst">대기</b><small data-f="cline">서비스센터가 고객에게 연락할 차례입니다</small></div><span class="eq" aria-hidden="true"><u></u><u></u><u></u><u></u><u></u></span></div>
      </div>`;
    if (o.before && o.before.parentNode === host) host.insertBefore(el, o.before); else host.appendChild(el);
    const fit = () => { const w = host.clientWidth || 2560; el.style.fontSize = `${(w / 2560) * 16}px`; };
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(host);
    const q = (s) => el.querySelector(s);
    let fKey = '';

    function render(snap) {
      const cs = (snap && snap.cases) || [];
      const c = cs.find((x) => x.id === snap.active) || cs[cs.length - 1];
      const on = !!(c && c.kind === 'emergency' && c.dms >= 0);
      el.classList.toggle('on', on);
      if (!on) { fKey = ''; return; }
      const d = c.dcall, now = Date.now();
      const st = ['done', !d ? 'cur' : d.state === 'ended' ? 'done' : 'cur', c.dms >= 2 ? 'done' : '', c.done ? 'done' : c.resvSent ? 'cur' : ''];
      q('[data-f="center"]').textContent = c.dealer || '강남 서비스센터';
      q('[data-f="cst"]').textContent = !d ? '대기 · 이관 접수' : d.state === 'dialing' ? '고객 휴대폰 발신 중…' : d.state === 'connected' ? `통화 중 ${mmss(now - d.connectedAt)}` : `통화 종료 · ${mmss((d.endedAt || now) - (d.connectedAt || d.at))}`;
      const last = d && (d.lines || []).filter((l) => !l.deleted).slice(-1)[0];
      const cline = c.done ? 'e-Care 상담원이 예약 · 입고 정보를 받았습니다 · e-Care 과업 종료'
        : c.resvSent ? '서비스센터 → e-Care 상담원 · 예약 · 입고 정보 전달 중'
          : last ? `${last.who === 'dealer' ? '이정비' : E.CUSTOMER.name} · “${last.text}”` : d ? '서비스 어드바이저가 고객에게 전화를 겁니다' : '서비스센터가 고객에게 연락할 차례입니다';
      const cl = q('[data-f="cline"]');
      if (cl.textContent !== cline) cl.textContent = cline;
      el.classList.toggle('live', !!d && d.state === 'connected');
      const key = st.join(',');
      if (key === fKey) return;
      const first = !fKey;
      fKey = key;
      const G = window.gsap;
      el.querySelectorAll('.fs li').forEach((li, i) => {
        const was = li.className;
        li.className = st[i];
        li.querySelector('i').textContent = st[i] === 'done' ? '✓' : i + 1;
        if (G && !first && was !== st[i] && st[i]) G.fromTo(li, { scale: 0.94 }, { scale: 1, duration: 0.6, ease: 'back.out(2.4)' });
      });
      if (first && G) G.fromTo(el.querySelectorAll('.ftag, h2, .who, .fs li, .call'), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out', delay: 0.35 });
    }
    return { el, render };
  }
  window.Follow = { mount };
})();
