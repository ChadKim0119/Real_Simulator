/* Scenes over a whole screen, shared by Final_Instrument and Final_Dataflow:
 * the opening (three lines over e-Care's colours), the closing summary, black,
 * and the "e-Care 과업 종료" ceremony when the repair closes in DMS.
 * Scenes.mount(host) adds #scene and #fin to host and follows the control
 * panel (Link 'stage') and the director (Link 'ecare'). */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const rel = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const OPENING = '<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>'
    + '<div class="op"><b>Real Simulator 시연</b><span>e-Care에 대한 고객의 경험 여정 및 업무 flow</span><small>본 시연에 사용되는 화면, 이미지, UI 디자인은 일부 변경될 수 있습니다.</small></div>';

  const END = '<div class="cl end"><h2>Real Simulator</h2><div class="thanks">e-Care 시뮬레이션 종료</div><p>고객 경험 여정과 업무 flow 시연을 모두 마쳤습니다 · 감사합니다</p></div>';

  function mount(host) {
    const sc = document.createElement('div'); sc.id = 'scene'; host.appendChild(sc);
    const fin = document.createElement('div'); fin.id = 'fin'; fin.setAttribute('aria-live', 'polite'); host.appendChild(fin);
    let snap = null, scene = 'live';

    function closing() {
      const c = snap && (snap.cases.slice().reverse().find((x) => x.wcase === 'A') || snap.cases[snap.cases.length - 1]);
      const fl = (snap && snap.flows) || [];
      let kpi = ['—', '—', '—'];
      if (c) {
        const skips = fl.filter((f) => f.type === 'skip' && f.caseId === c.id).map((f) => f.t);
        const at = (t) => t - c.at + skips.filter((x) => x <= t).length * 25 * 60000;
        const find = (fn) => fl.find((f) => !f.type && f.caseId === c.id && fn(f));
        const reach = find((f) => f.to === 'ccw' || f.to === 'dms');
        const memo = find((f) => f.api === '상담 메모 이관');
        kpi = [reach ? `${((reach.t - c.at) / 1000).toFixed(1)}초` : '—', c.call && c.call.connectedAt ? rel(at(c.call.connectedAt)) : '—', memo ? rel(at(memo.t)) : '—'];
      }
      return `<div class="cl"><h2>e-Care 시연 요약</h2><div class="kpis">
        <div><b>${kpi[0]}</b><span>경고 → 고객지원실 · 서비스센터 도달</span></div>
        <div><b>${kpi[1]}</b><span>경고 → 고객 통화 연결</span></div>
        <div><b>${kpi[2]}</b><span>경고 → 서비스센터 이관</span></div></div>
        <p>고객 차량 · 일본측 서버 [VDP] · 한국측 서버 [TSP] · e-Care 고객지원실 · 긴급출동 · 서비스센터</p><div class="thanks">감사합니다</div></div>`;
    }
    // scenes fade in and out (and cross-fade into each other); the content leaves after the fade
    let shown = 'live', swapT = 0;
    const html = (k) => (k === 'opening' ? OPENING : k === 'closing' ? closing() : k === 'end' ? END : '');
    function render(refresh) {
      document.body.classList.toggle('scene-on', scene !== 'live');
      if (scene !== 'live') { if (window.FX && FX.gsap) FX.stopCeremony(fin); else fin.classList.remove('on'); }
      clearTimeout(swapT);
      if (refresh && scene === shown) { if (scene === 'closing') sc.innerHTML = html(scene); return; }
      if (scene === 'live') { sc.classList.remove('on'); swapT = setTimeout(() => { if (scene === 'live') { sc.innerHTML = ''; sc.className = ''; } }, 1000); shown = 'live'; return; }
      if (shown === 'live') { sc.className = scene; sc.innerHTML = html(scene); void sc.offsetWidth; sc.classList.add('on'); shown = scene; return; }
      sc.classList.add('dim');                       // scene → scene: dip, swap, rise
      swapT = setTimeout(() => { sc.className = `${scene} on dim`; sc.innerHTML = html(scene); void sc.offsetWidth; sc.classList.remove('dim'); }, 450);
      shown = scene;
    }
    // the e-Care task is done: once per case, not for cases already closed when the page opened
    const seen = new Set();
    let first = true, finT = 0;
    function ceremony(c) {
      const steps = ['경고 감지', '고객 연결', c.kind === 'emergency' ? '상담 · 긴급출동' : '경고 판정', '서비스센터 이관', '딜러 후속 통화', '입고 · 정비 · 종결'];
      const html = `<div class="fx"><svg viewBox="0 0 200 200" class="ring"><circle cx="100" cy="100" r="86" class="bg"/><circle cx="100" cy="100" r="86" class="fg"/><path d="M64 102 L90 128 L140 76" class="ck"/></svg>
        <b>e-Care 과업 종료</b><span>${steps.map((t) => `<i>${esc(t)}</i>`).join('<em>›</em>')}</span>
        <small>${esc(c.dealer || '서비스센터')} 고객 인도 · 정비 종결 · 모든 상태가 TSP에 기록되었습니다</small></div>`;
      if (window.FX && FX.ceremony(fin, html)) return;
      fin.innerHTML = html;
      fin.classList.remove('on'); void fin.offsetWidth; fin.classList.add('on');
      clearTimeout(finT);
    }
    // the recap stays until the presenter moves on; it leaves when the close is undone or reset
    let finCase = null;
    const finOff = () => { finCase = null; if (window.FX && FX.gsap) FX.stopCeremony(fin); else fin.classList.remove('on'); };
    Link.on('ecare', (d) => {
      if (!d || !d.cases) return;
      snap = d;
      if (scene === 'closing') render(true);
      for (const c of d.cases || []) {
        if ((c.done || c.dms >= 7) && !seen.has(c.id)) { seen.add(c.id); if (!first && scene === 'live') { ceremony(c); finCase = c.id; } }
        if (!c.done && c.dms < 7) seen.delete(c.id);
      }
      if (!(d.cases || []).length) seen.clear();
      if (finCase && !seen.has(finCase)) finOff();
      first = false;
    });
    Link.on('stage', (d) => { if (d.scene && d.scene !== scene) { scene = d.scene; render(); } });
    Link.send('stage-hello', { screen: 'final' });
    render();
    return { get scene() { return scene; } };
  }
  window.Scenes = { mount };
})();
