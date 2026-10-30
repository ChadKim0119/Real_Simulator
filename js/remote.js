/* Presenter remote: runs the auditorium demo step by step. Each step sends
 * scene changes to the stage screens and actions to the vehicle simulator
 * (which runs the e-Care director). Keyboard: → / Space next, ← previous. */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const STEPS = [
    { act: '오프닝', title: '3면 오프닝', cue: '“Global South 개발 진척 보고회를 시작하겠습니다.” 세 화면에 걸친 오프닝이 재생됩니다.', run: [['scene', 'opening']] },
    { act: '오프닝', title: '시동 · 웰컴 세리머니', cue: '라이브 화면으로 전환하며 시동을 켭니다. 왼쪽 계기판에서 세리머니가 재생됩니다.', run: [['scene', 'live'], ['wait', 900], ['act', 'ign']] },
    { act: '1막 · 주행과 경고', title: '주행 시작', cue: '“고객이 GX 550으로 주행 중입니다. 가운데 화면은 차량에서 콜센터 · 딜러까지 연결된 시스템입니다.”', run: [['act', 'drive']] },
    { act: '1막 · 주행과 경고', title: '브레이크 경고 발생 (Case A)', cue: '“차량에서 브레이크 시스템 경고가 발생했습니다. VDP를 거쳐 VEP가 WNG master로 Case A, 주행불가로 판정하고 콜센터 · 딜러 · 고객 앱에 동시에 전달합니다. 25분 SLA가 시작됩니다.”', run: [['warn', 'brake']] },
    { act: '2막 · 콜센터 상담', title: '25분 경과 · 상담원 자동 배정', cue: '“고객이 25분간 연락하지 않으면 CTI에서 유휴 상담원을 찾아 자동 배정합니다. 오른쪽 상담원 화면에 경고 알림 팝업이 뜹니다.”', run: [['act', 'sla25']] },
    { act: '2막 · 콜센터 상담', title: '상담원 전화 걸기', cue: '“상담원이 고객에게 전화를 겁니다.” 차량은 갓길에 정차하고, 통화가 자막으로 흐릅니다. 통화 중 긴급출동이 자동 요청됩니다. (통화 약 35초 — 끝나면 다음)', run: [['act', 'accept']] },
    { act: '3막 · 딜러 이관', title: '상담 완료 · 서비스센터 이관', cue: '“상담 메모가 WAM-MEMO-001로 서비스센터에 전달되고, 정비 상태가 DMS-SVC-002로 콜센터에 실시간으로 돌아옵니다.”', run: [['act', 'complete']] },
    { act: '4막 · Case B 비교', title: '에어백 경고 (Case B) · 딜러 직행', cue: '“주행 가능한 경고는 상담원을 거치지 않습니다. Case B로 판정되어 서비스센터에 바로 전달되고 SLA는 1일입니다.”', run: [['act', 'clear'], ['wait', 900], ['warn', 'airbag']] },
    { act: '5막 · 운영', title: 'OPW 정책 변경 (준비 중)', cue: '운영 화면(OPW)은 다음 단계에서 추가됩니다. 지금은 건너뜁니다.', later: true, run: [] },
    { act: '클로징', title: '시동 끄기', cue: 'IG OFF 세리머니가 재생됩니다.', run: [['act', 'ign']] },
    { act: '클로징', title: '3면 클로징 · 요약', cue: '“경고 발생부터 상담 · 출동 · 딜러 이관까지의 흐름을 정리하면 이렇습니다. 감사합니다.”', run: [['scene', 'closing']] },
  ];

  let cur = -1;
  let scene = 'live';
  let snap = null;

  /* ---------------- link ---------------- */
  Link.on('ecare', (d) => { snap = d; status(); });
  Link.on('toast', (d) => { const t = $('#toast'); t.textContent = d.msg; clearTimeout(t.tid); t.tid = setTimeout(() => { t.textContent = ''; }, 5000); });
  Link.on('stage-hello', () => Link.send('stage', { scene }));
  Link.on('@transport', link);
  Link.send('hello', { screen: 'remote' });
  function link() { $('#link').textContent = Link.transport === 'lan' ? '● LAN 연결' : '● 이 PC'; }
  link();

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function run(ops) {
    for (const [kind, a, b] of ops) {
      if (kind === 'scene') setScene(a);
      else if (kind === 'act') Link.send('act', { name: a, args: b || {} });
      else if (kind === 'warn') Link.send('act', { name: 'warnItem', args: { id: a } });
      else if (kind === 'wait') await wait(a);
    }
  }
  function setScene(s) {
    scene = s;
    Link.send('stage', { scene: s });
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === s));
  }

  /* ---------------- steps ---------------- */
  function renderSteps() {
    let last = '';
    $('#steps').innerHTML = STEPS.map((s, i) => {
      const head = s.act !== last ? `<div class="grp">${esc(s.act)}</div>` : '';
      last = s.act;
      return `${head}<button data-step="${i}" class="${i < cur ? 'done' : ''} ${i === cur ? 'cur' : ''} ${s.later ? 'todo-later' : ''}"><i>${i < cur ? '✓' : i + 1}</i>${esc(s.title)}</button>`;
    }).join('');
    const n = STEPS[Math.max(0, Math.min(STEPS.length - 1, cur + 1))];
    const now = cur >= 0 ? STEPS[cur] : null;
    $('#nowAct').textContent = now ? `${now.act} · ${cur + 1}/${STEPS.length}` : '시작 전';
    $('#nowTitle').textContent = now ? now.title : '다음을 누르면 시작합니다';
    $('#nowCue').textContent = now ? now.cue : `첫 단계: ${STEPS[0].title}`;
    $('#next').textContent = cur + 1 < STEPS.length ? `다음 ▶ ${n.title}` : '끝';
  }
  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    cur = i;
    renderSteps();
    run(STEPS[i].run);
  }
  $('#next').addEventListener('click', () => go(cur + 1));
  $('#prev').addEventListener('click', () => { cur = Math.max(-1, cur - 1); renderSteps(); });
  $('#steps').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); });
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    if (e.code === 'ArrowRight' || e.code === 'Space' || e.code === 'PageDown') { e.preventDefault(); go(cur + 1); }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp') { e.preventDefault(); cur = Math.max(-1, cur - 1); renderSteps(); }
  });

  /* ---------------- manual ---------------- */
  document.querySelector('.manual').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.scene) setScene(b.dataset.scene);
    if (b.dataset.act) Link.send('act', { name: b.dataset.act, args: {} });
    if (b.dataset.warn) Link.send('act', { name: 'warnItem', args: { id: b.dataset.warn } });
    if (b.hasAttribute('data-identify')) Link.send('stage-identify', {});
    if (b.hasAttribute('data-reset') && confirm('차량 경고 · e-Care 시나리오를 초기화하고 처음 단계로 돌아갈까요?')) {
      Link.send('act', { name: 'clear', args: {} });
      Link.send('act', { name: 'careReset', args: {} });
      cur = -1;
      renderSteps();
    }
  });

  function status() {
    const c = snap && (snap.cases.find((x) => x.id === snap.active) || snap.cases[0]);
    if (!c) { $('#state').textContent = '대기 · 경고 없음'; return; }
    const call = c.call ? { dialing: '발신 중', connected: '통화 중', ended: '통화 종료', failed: '연결 실패' }[c.call.state] : '';
    $('#state').textContent = [`${c.wng ? c.wng.code : ''} Case ${c.wcase || ''}`, E.CONTACT[c.contact], call, c.dispatch >= 0 ? `출동 ${E.DISPATCH[c.dispatch]}` : '', c.dms >= 0 ? `딜러 ${E.DMS[c.dms]}` : ''].filter(Boolean).join(' · ');
  }

  renderSteps();
  document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === scene));
})();
