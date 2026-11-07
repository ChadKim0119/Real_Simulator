#!/usr/bin/env node
/* Captures still frames of the demo wall for the monitor test mode
 * (test.html). Runs the control panel's full presentation through the relay
 * on wall.html (2560x1080, default layout, no labels) and saves every panel
 * per step.
 *
 *   node tools/relay.mjs &
 *   NODE_PATH=$(npm root -g) node tools/capture-stills.cjs [base url] [21|169]
 *
 * Output (21:9 → assets/test/stills, 16:9 → assets/test/stills-169):
 * <nn>_wall.jpg (the whole wall), <nn>_<panel>.jpg and index.json with the
 * layout the frames were taken in. Each mode needs its own relay (PORT=…) to
 * run both at once. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const MODE = ['169', '63'].includes(process.argv[3]) ? process.argv[3] : '21';
const OUT = path.join(__dirname, '..', 'assets', 'test', MODE === '21' ? 'stills' : `stills-${MODE}`);
const W = { 21: 2560, 169: 1920, 63: 7560 }[MODE];

// [press "next" this many times (each once the panel is idle), wait ms, then capture id/title/what]
const PLAN = [
  [1, 2500, 'opening', '오프닝', '화면 전체 타이틀'],
  [1, 6500, 'ignition', '시동 · 웰컴', '계기판 세리머니, 데이터 흐름 대기'],
  [1, 6000, 'driving', '주행', '주행 중 계기판'],
  [1, 3500, 'warning', '경고 · HU 팝업', '계기판 경고 → 시선이 HU로, “고객 지원실로 연결하시겠습니까?”'],
  [1, 6500, 'incoming', 'HU 전화연결 → 인바운드', '여성 운전자 손 → 상담원 화면 “전화가 왔습니다” 팝업'],
  [1, 9000, 'call', '상담 통화', '통화 화면 · 자막 · 차량 진단 정보'],
  [0, 18000, 'pullover', '통화 중 갓길 정차', '고객이 정차 · 비상등을 켰다고 말하는 시점'],
  [0, 14000, 'dispatch', '긴급출동 요청 · 선호 센터 확인', '위치 확인 → 정차 · 비상등 → 긴급출동 요청 → 선호 서비스센터 · 연락처 확인'],
  [1, 4000, 'memo', '상담 완료 · 이관 (견인 전)', '상담 메모 → 서비스센터 DMS · 컨택대기'],
  [1, 6500, 'rescue', '긴급출동 차량 접근', '이관 후 · 대시보드 확장 · 견인차가 운전석 창 옆을 지나감'],
  [0, 6000, 'arrive', '긴급출동 차량 도착', '고객 차 앞 정차 · 경광등'],
  [1, 30000, 'dealer', '딜러 후속 통화', '차량 화면은 딜러 후속 처리로 마스킹 · 어드바이저 → 고객 휴대폰 · 안심 안내 · 입고 예약'],
  [1, 3500, 'towin', '견인 입고', '견인차 → 서비스센터 차량 운송 · 입고 접수 (DMS → TSP)'],
  [1, 4000, 'repair', '정비 진행 → 정비 완료', 'DMS → TSP 정비 상태'],
  [1, 1600, 'done', '고객 인도 · 정비 종결', '종결이 TSP에 도착 → e-Care 과업 종료'],
  [1, 2500, null],
  [1, 4000, 'warning2', '2막 · 다시 경고', '고객 미연락 상황'],
  [1, 3000, 'sla25', '25분 경과', '25분 경과 연출 · 상담원 자동 배정 팝업'],
  [1, 5000, 'outbound', '상담원 전화 걸기', '고객 휴대전화 수신'],
  [0, 12000, 'outcall', '아웃바운드 통화', '휴대전화 통화 · 자막'],
  [1, 3000, 'memo2', '2막 완료 · 이관', ''],
  [1, 9000, 'outend', '아웃바운드 종료 · 출동 도착', '이관 후 긴급출동 차량 도착'],
  [1, 2000, null],
  [1, 6000, 'caseB', '경고 등급 비교', '에어백 경고 · 서비스센터 직행'],
  [1, 5500, 'caseBdms', '서비스센터 직접 컨택', 'DMS에 바로 들어온 건 · 예약 확정'],
  [1, 5000, 'ignoff', '시동 끄기', ''],
  [1, 4000, 'closing', '클로징', 'KPI · 연동 시스템'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // capture over the LAN relay only: never join the cloud room (live screens of the demo, or the other mode's capture)
  const newContext = b.newContext.bind(b);
  b.newContext = async (o) => { const c = await newContext(o); await c.addInitScript(() => { try { localStorage.setItem('link-cloud', 'off'); } catch (e) { /* */ } }); return c; };
  const wctx = await b.newContext({ viewport: { width: W, height: 1080 } });
  await wctx.addInitScript((m) => { try { localStorage.setItem('wall-mode', JSON.stringify(m)); localStorage.removeItem('wall-layout-' + m); localStorage.setItem('wall-labels', 'false'); } catch (e) { /* blank frames */ } }, MODE);
  const st = await wctx.newPage();
  await st.goto(`${BASE}/wall.html`, { waitUntil: 'domcontentloaded' });
  await st.waitForTimeout(3000);
  // the mode's default layout, as the wall itself computes it
  const LAYOUT = await st.evaluate((m) => WallDef.rects(WallDef.load(m), m), MODE);
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
      await rc.waitForFunction(() => !document.querySelector('#next').textContent.includes('마무리하고'), null, { timeout: 180000 });
      await rc.click('#next');
      await rc.waitForTimeout(150);
    }
    await rc.waitForTimeout(wait);
    if (!id) continue;
    n++;
    const key = String(n).padStart(2, '0');
    const full = path.join(OUT, `${key}_wall.png`);
    await st.screenshot({ path: full });
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', full, '-q:v', '4', path.join(OUT, `${key}_wall.jpg`)]);
    fs.unlinkSync(full);
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
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ mode: MODE, W, layout: LAYOUT, steps: index }, null, 1));
  await b.close();
})();
