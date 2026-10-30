/* Auditorium stage. stage.html?screen=left|center|right shows one screen's
 * content full screen; ?screen=all shows the three side by side (rehearsal on
 * one monitor). The presenter's remote (remote.html) switches scenes on every
 * screen at once: opening and closing panoramas span the three screens. */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const SCREEN = params.get('screen') || 'all';
  const IDX = { left: 0, center: 1, right: 2 }[SCREEN];
  const SRC = { left: 'index.html?stage=1', center: 'flow.html', right: 'ccw.html?stage=1' };
  const NAME = { left: '왼쪽 · 고객', center: '가운데 · 데이터 흐름', right: '오른쪽 · 운영' };

  document.title = `Stage · ${NAME[SCREEN] || '3면 미리보기'}`;
  if (SCREEN === 'all') document.body.classList.add('all');
  else document.documentElement.style.setProperty('--idx', IDX);

  // content panes
  (SCREEN === 'all' ? ['left', 'center', 'right'] : [SCREEN]).forEach((k) => {
    const f = document.createElement('iframe');
    f.src = SRC[k];
    f.title = NAME[k];
    f.allow = 'autoplay; fullscreen';
    $('#panes').appendChild(f);
  });

  let snap = null;
  let scene = 'live';
  Link.on('ecare', (d) => { snap = d; if (scene === 'closing') render(); });
  Link.on('stage', (d) => setScene(d.scene));
  const identify = () => { const t = $('#tag'); t.textContent = NAME[SCREEN] || 'ALL'; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 4000); };
  Link.on('stage-identify', identify);
  Link.send('stage-hello', { screen: SCREEN });

  function setScene(s) {
    if (s === scene) return;
    scene = s;
    render();
  }

  const pad = (n) => String(n).padStart(2, '0');
  const rel = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

  function closing() {
    const c = snap && (snap.cases.slice().reverse().find((x) => x.wcase === 'A') || snap.cases[snap.cases.length - 1]);
    const fl = (snap && snap.flows) || [];
    let kpi = ['—', '—', '—'], rows = [];
    if (c) {
      const skips = fl.filter((f) => f.type === 'skip' && f.caseId === c.id).map((f) => f.t);
      const at = (t) => t - c.at + skips.filter((x) => x <= t).length * 25 * 60000;
      const find = (fn) => fl.find((f) => !f.type && f.caseId === c.id && fn(f));
      const reach = find((f) => f.to === 'ccw' || f.api === 'WAM-EVT-001');
      const connect = c.call && c.call.connectedAt;
      const memo = find((f) => f.api === 'WAM-MEMO-001');
      kpi = [reach ? ((reach.t - c.at) / 1000).toFixed(1) : '—', connect ? rel(at(connect)) : '—', memo ? rel(at(memo.t)) : '—'];
      const ev = [
        [c.at, `경고 발생 · ${c.wng ? c.wng.code : ''} ${c.wng ? c.wng.name : ''}`],
        [(find((f) => f.api === 'Case 판정') || {}).t, `VEP Case 판정 · ${c.wcase ? 'Case ' + c.wcase : ''}`],
        [(reach || {}).t, '콜센터 · 딜러 동시 전달'],
        [skips[0], '25분 경과 · 자동 아웃바운드'],
        [connect, '고객 통화 연결'],
        [(find((f) => f.to === 'rescue') || {}).t, '긴급출동 요청'],
        [(memo || {}).t, '상담 메모 · 딜러 이관'],
        [(find((f) => f.api === 'DMS-SVC-002' && /예약/.test(f.label)) || {}).t, '서비스센터 예약'],
      ].filter(([t]) => t);
      rows = ev.map(([t, label]) => `<div><em>${rel(at(t))}</em>${label}</div>`);
    }
    return `<div class="cl"><div class="bg"></div>
      <div class="col c0"><h2>시연 시나리오 기준</h2>
        <div class="kpi"><b>${kpi[0]}<small>초</small></b><span>경고 → 콜센터 · 딜러 도달</span></div>
        <div class="kpi" style="animation-delay:.3s"><b>${kpi[1]}</b><span>경고 → 고객 통화 연결</span></div>
        <div class="kpi" style="animation-delay:.6s"><b>${kpi[2]}</b><span>경고 → 딜러 이관</span></div></div>
      <div class="col c1"><h2>e-Care 처리 타임라인</h2><div class="tl">${rows.map((r, i) => r.replace('<div>', `<div style="animation-delay:${0.15 * i}s">`)).join('') || '<div>시나리오 진행 후 표시됩니다</div>'}</div></div>
      <div class="col c2"><h2>연동 시스템</h2><div class="sys"><span>차량 DCM · HU</span><span>VDP</span><span>VEP</span><span>WAM</span><span>콜센터 CCW</span><span>CTI</span><span>딜러 DMS</span><span>운영 OPW</span><span>긴급출동</span><span>고객 앱 · SMS</span></div>
        <div class="thanks">감사합니다</div></div></div>`;
  }

  function render() {
    const pano = $('#pano'), strip = $('#strip');
    if (scene === 'opening') {
      strip.innerHTML = `<div class="op"><div class="bg"></div><div class="grid"></div><div class="sweep"></div><div class="line"></div>
        <div class="col c0"><div class="w">Welcome to</div></div>
        <div class="col c1"><div class="k">TOYOTA · LEXUS CONNECT</div><div class="w">Global South</div><div class="s">개발 진척 보고회</div></div>
        <div class="col c2"><div class="w">e-Care</div><div class="s">경고 · 상담 · 출동 · 딜러</div></div></div>`;
      pano.classList.add('on');
    } else if (scene === 'closing') {
      strip.innerHTML = closing();
      pano.classList.add('on');
    } else if (scene === 'black') {
      strip.innerHTML = '';
      pano.classList.add('on');
    } else {
      pano.classList.remove('on');
    }
  }
  render();

  // keyboard on the stage PC: F full screen, I identify
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    if (e.code === 'KeyI') { identify(); Link.send('stage-identify', {}); }
  });
})();
