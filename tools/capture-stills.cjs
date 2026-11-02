#!/usr/bin/env node
/* Captures still frames of the demo wall for the monitor test mode
 * (test.html). Runs the control panel's full presentation through the relay
 * on wall.html at the ratio given (default layout, no labels) and saves every
 * panel per step.
 *
 *   node tools/relay.mjs &
 *   NODE_PATH=$(npm root -g) node tools/capture-stills.cjs 21 [http://127.0.0.1:8787]
 *   NODE_PATH=$(npm root -g) node tools/capture-stills.cjs 63
 *
 * Output: assets/test/stills/<21|63>/<nn>_<panel>.jpg and index.json */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RATIO = process.argv[2] === '63' ? 63 : 21;
const BASE = process.argv[3] || 'http://127.0.0.1:8787';
const OUT = path.join(__dirname, '..', 'assets', 'test', 'stills', String(RATIO));
// default layouts, the same as js/walldef.js
const W = { 21: 2560, 63: 7560 }[RATIO];
const LAYOUT = {
  21: { cockpit: [0, 0, 860, 472], hu: [860, 0, 860, 472], talk: [1720, 0, 840, 472], flow: [0, 472, 1280, 608], ccw: [1280, 472, 1280, 608] },
  63: { cockpit: [0, 0, 1680, 1080], hu: [1680, 0, 1440, 1080], flow: [3120, 0, 1800, 1080], ccw: [4920, 0, 1800, 1080], talk: [6720, 0, 840, 1080] },
}[RATIO];

// [press "next" this many times (each once the panel is idle), wait ms, then capture id/title/what]
const PLAN = [
  [1, 2500, 'opening', '3면 오프닝', '세 화면에 이어지는 파노라마 타이틀'],
  [1, 6500, 'ignition', '시동 · 웰컴', '계기판 세리머니, 데이터 흐름 대기'],
  [1, 6000, 'driving', '주행', '주행 중 계기판'],
  [1, 3500, 'warning', '경고 · HU 팝업', 'Case A 판정, HU “고객 지원실로 연결하시겠습니까?”, 패킷 흐름'],
  [1, 3000, 'incoming', 'HU 전화연결 → 인바운드', '상담원 화면 “전화가 왔습니다” 팝업'],
  [1, 9000, 'call', '상담 통화', '통화 화면 · 자막 · 차량 진단 정보'],
  [0, 30000, 'pullover', '통화 중 갓길 정차', '고객이 정차했다고 말하는 시점'],
  [0, 34000, 'dispatch', '통화 종료 · 긴급출동', '긴급출동 요청, 통화 종료'],
  [1, 3500, 'memo', '상담 완료 · 이관', '상담 메모 → 서비스센터 (WAM-MEMO-001)'],
  [0, 10000, 'dms', '서비스센터 진행 상태', 'DMS-SVC-002 정비 상태 회신'],
  [1, 2500, null],
  [1, 4000, 'warning2', '2막 · 다시 경고', '고객 미연락 상황'],
  [1, 3000, 'sla25', '25분 경과', '25분 경과 연출 · 상담원 자동 배정 팝업'],
  [1, 5000, 'outbound', '상담원 전화 걸기', '고객 휴대전화 수신'],
  [0, 12000, 'outcall', '아웃바운드 통화', '휴대전화 통화 · 자막'],
  [0, 26000, 'outend', '아웃바운드 종료', '긴급출동 · 통화 종료'],
  [1, 3000, 'memo2', '2막 완료 · 이관', ''],
  [1, 6000, 'caseB', 'Case B 비교', '에어백 경고 · 서비스센터 직행'],
  [1, 5000, 'ignoff', '시동 끄기', ''],
  [1, 4000, 'closing', '3면 클로징', 'KPI · 타임라인 · 연동 시스템'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const wctx = await b.newContext({ viewport: { width: W, height: 1080 } });
  await wctx.addInitScript(() => { localStorage.removeItem('wall-layout-21'); localStorage.removeItem('wall-layout-63'); localStorage.setItem('wall-labels', 'false'); });
  const st = await wctx.newPage();
  await st.goto(`${BASE}/wall.html?ratio=${RATIO}`, { waitUntil: 'domcontentloaded' });
  await st.waitForTimeout(3000);
  const rc = await (await b.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  await rc.goto(`${BASE}/control.html`, { waitUntil: 'domcontentloaded' });
  await rc.waitForTimeout(1500);
  await rc.click('[data-sc="show"]');
  // start clean
  await rc.evaluate(() => { Link.send('act', { name: 'clear', args: {} }); Link.send('act', { name: 'careReset', args: {} }); });
  await rc.waitForTimeout(1500);
  const index = [];
  let n = 0;
  for (const [presses, wait, id, title, what] of PLAN) {
    for (let i = 0; i < presses; i++) {
      // "next" while a step still waits only ends the wait: let the step finish first
      await rc.waitForFunction(() => !document.querySelector('#next').textContent.includes('건너뛰고'), null, { timeout: 180000 });
      await rc.click('#next');
      await rc.waitForTimeout(150);
    }
    await rc.waitForTimeout(wait);
    if (!id) continue;
    n++;
    const key = String(n).padStart(2, '0');
    for (const k in LAYOUT) {
      const [x, y, w, h] = LAYOUT[k];
      const png = path.join(OUT, `${key}_${k}.png`);
      await st.screenshot({ path: png, clip: { x, y, width: w, height: h } });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-q:v', '5', path.join(OUT, `${key}_${k}.jpg`)]);
      fs.unlinkSync(png);
    }
    index.push({ key, id, title, what, step: (await rc.textContent('#now b')).trim() });
    console.log(key, id, title);
  }
  fs.writeFileSync(path.join(OUT, '..', 'index.json'), JSON.stringify(index, null, 1));
  await b.close();
})();
