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
          <li data-s="1"><i>2</i><b>딜러 → 고객 통화 · 예약</b><small>고객 안심 안내 · 내일 오전 10시 점검</small></li>
          <li data-s="2"><i>3</i><b>견인 입고</b><small>견인차 → 서비스센터 · 입고 접수</small></li>
          <li data-s="3"><i>4</i><b>정비 → 고객 인도 · 종결</b><small>종결 시 e-Care 과업 종료 · 상태는 DMS → TSP</small></li>
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
      const c = cs[0];                 // the newest case (the director adds new cases in front)
      // from the step after the truck's arrival: the dealer's follow-up
      const on = !!(c && c.kind === 'emergency' && c.dms >= 0 && (c.dcall || c.towing || c.dms >= 2) && (!c.done || Date.now() - c.done < 20000));
      el.classList.toggle('on', on);
      if (!on) { fKey = ''; return; }
      const d = c.dcall, now = Date.now();
      const st = ['done', !d ? 'cur' : d.state === 'ended' && c.dms >= 2 ? 'done' : 'cur', c.dms >= 3 ? 'done' : c.towing ? 'cur' : '', c.done || c.dms >= 7 ? 'done' : c.dms >= 3 ? 'cur' : ''];
      q('[data-f="center"]').textContent = c.dealer || '강남 서비스센터';
      q('[data-f="cst"]').textContent = !d ? '대기 · 이관 접수' : d.state === 'dialing' ? '고객 휴대폰 발신 중…' : d.state === 'connected' ? `통화 중 ${mmss(now - d.connectedAt)}` : `통화 종료 · ${mmss((d.endedAt || now) - (d.connectedAt || d.at))}`;
      const last = d && (d.lines || []).filter((l) => !l.deleted).slice(-1)[0];
      const cline = c.done || c.dms >= 7 ? '고객 인도 · 정비 종결 · e-Care 과업 종료'
        : c.dms >= 3 ? `${E.DMS[c.dms]} · 서비스센터 → TSP 상태 기록`
          : c.towing ? '견인차가 차량을 서비스센터로 운송하고 있습니다'
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
