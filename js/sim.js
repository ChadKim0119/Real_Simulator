/* Vehicle state, physics, camera and input — ties all layers together. */
(function () {
  'use strict';

  const IMG_W = 2300, IMG_H = 941;          // the photo, extended on the passenger side to show the whole centre display
  const EXT_TOP = 0;
  const FULL_TOP = 0;
  const WHEEL_SHIFT = 812.75 - 825.8;   // display centre minus wheel hub centre (photo px)
  const CLUSTER_VIEW = { cx: 812, cy: 270, w: 490, h: 330 };
  // the centre display: its picture area (photo px) and the view that frames it with the climate bar
  // (the 14-inch display: a wide picture area over the climate bar and the knobs)
  const HU_SCREEN = { x: 1191, y: 117, w: 512, h: 166, design: [1920, 622] };
  const HU_VIEW = { cx: 1447, cy: 262, w: 620, h: 350 };
  // the climate band under the screen, from a photo of the real 14" unit: a separate
  // high-resolution layer (hu_band.webp, BAND.k pixels per plate pixel) so it stays sharp
  const BAND = { x: 1186, y: 280, k: 3.6, src: 'assets/hu_band.webp' };
  // hand_call.webm (the driver: a woman's hand, cream knit sleeve): fingertip on the button at
  // this second; aspect of the view it was shot on; where the pad of the index finger is in the
  // clip at that moment (share of its width / height) — the layer is placed so it lands on the
  // middle of [전화 연결] on the head unit
  const HAND_CONTACT = 1.35, HAND_AR = 1680 / 720, HAND_TIP = { x: 707 / 1680, y: 252 / 712 };
  // 10-speed automatic: engine rpm per km/h in each gear
  const GEAR_FACTOR = [0, 142, 90, 64, 48, 38, 31, 26, 21, 17.5, 15];
  const IDLE = 650;

  const SimData = {
    RED: [
      { id: 'brake', title: '브레이크 시스템 경고', desc: '즉시 안전한 곳에 정차하십시오', blink: true },
      { id: 'oil', title: '엔진 오일 압력 낮음', desc: '엔진을 정지하고 오일을 점검하십시오', blink: true },
      { id: 'coolant', title: '엔진 과열', desc: '정차 후 냉각수를 점검하십시오', blink: true },
      { id: 'battery', title: '충전 시스템 이상', desc: '배터리 및 발전기를 점검하십시오' },
      { id: 'airbag', title: '에어백 · 안전벨트 경고', desc: '안전벨트를 착용하십시오', blink: true },
      { id: 'door', title: '도어 열림', desc: '모든 도어를 닫으십시오' },
    ],
    AMBER: [
      { id: 'engine', title: '엔진 점검', desc: '가까운 서비스 센터를 방문하십시오' },
      { id: 'abs', title: 'ABS 시스템 점검', desc: '제동 시 주의하십시오' },
      { id: 'esp', title: '차체 자세 제어 장치 점검', desc: '미끄러운 노면에 주의하십시오' },
      { id: 'gearbox', title: '변속기 점검', desc: '급가속을 피하고 점검받으십시오' },
      { id: 'brakepad', title: '브레이크 패드 마모', desc: '브레이크 패드를 교체하십시오' },
      { id: 'oillevel', title: '엔진 오일 부족', desc: '엔진 오일을 보충하십시오' },
    ],
  };
  window.SimData = SimData;

  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const follow = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  const pad = (n) => String(n).padStart(2, '0');

  const st = {
    ign: 'off', ignT: 99, bootT: 99, backlight: 0, bulbCheck: false, sweep: -1,
    engine: false, rpm: 0, throttle: 0,
    speed: 0, accel: 0, gear: 'P', gearNum: 1, shiftT: 0,
    mode: 'park', holdT: 0, cruise: false, setSpeed: 80, limit: 80, eco: false,
    odoMeters: 0, odo: 4236.2, range: 455, fuel: 0.62, outside: 18, coolant: 40,
    redActive: new Set(), amberActive: new Set(), popup: null, hazard: false, hazOn: false, hazT0: 0, clock: '7:17', ampm: 'AM',
    modeTitle: 'DRIVE MODE', modes: ['ECO', 'NORMAL', 'COMFORT', 'SPORT S', 'SPORT S+'], modeIndex: 1,
    music: { title: 'NEON', artist: 'A2O LITE', single: 'Debut Single · 2026', len: 208, pos: 0 },
    wheel: 0, yawErr: 0, laneOffset: 0, pitch: 0, bump: 0, pendingDrive: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage');
  const wheelCanvas = $('#wheel');
  const focusShade = $('#focusShade');
  const startGlow = $('#startGlow');
  const ambientCanvas = $('#ambient');
  const extCanvas = $('#exterior');
  const cluster = new Cluster($('#cluster'), $('#heroArt'));
  const ambient = new Ambient(ambientCanvas);
  const exterior = new Exterior(extCanvas);
  // the filmed drive replaces the drawn road once it can play (the drawing stays as a fallback)
  const driveVid = $('#drive');
  let driveOk = false;
  if (driveVid) {
    const ready = () => { if (driveOk) return; driveOk = true; driveVid.classList.add('ready'); extCanvas.style.visibility = 'hidden'; };
    if (driveVid.readyState >= 3) ready(); else driveVid.addEventListener('canplay', ready, { once: true });
    driveVid.addEventListener('error', () => { driveOk = false; driveVid.remove(); extCanvas.style.visibility = ''; });
  }
  function driveTick() {
    if (!driveOk) return;
    const v = st.speed;
    if (v < 1.5) { if (!driveVid.paused) driveVid.pause(); return; }
    const r = Math.max(0.15, Math.min(2.4, v / 70));     // the film was shot at about 70 km/h
    if (Math.abs(driveVid.playbackRate - r) > 0.02) driveVid.playbackRate = r;
    if (driveVid.paused) driveVid.play().catch(() => {});
  }
  const wheel = new Wheel(wheelCanvas, $('#wheelArt'));
  const audio = new SimAudio();
  // engine voice (Lexus LS 500 · LX 600 · LC 500), chosen on the control panel and kept here
  try { audio.setEngine(localStorage.getItem('engine-sound') || 'ls500'); } catch (e) { audio.setEngine('ls500'); }

  const cr = Cluster.rect;
  Object.assign($('#cluster').style, { left: cr.x + 'px', top: cr.y + 'px', width: cr.w + 'px', height: cr.h + 'px' });
  const eb = Exterior.box;
  Object.assign(extCanvas.style, { left: '0px', top: eb.top + 'px', width: eb.width + 'px', height: eb.height + 'px' });

  /* ---------------- camera ---------------- */
  const now = () => performance.now() / 1000;
  // z: cockpit → instrument cluster; h: (that view) → centre display
  const cam = { z: 0, from: 0, to: 0, t0: 0, dur: 0, zoomAt: null, outAt: null, h: 0, hFrom: 0, hTo: 0, ht0: 0, hdur: 0 };
  function camTo(target, dur) {
    cam.from = cam.z; cam.to = target; cam.t0 = now(); cam.dur = dur;
  }
  function huTo(target, dur) {
    cam.hFrom = cam.h; cam.hTo = target; cam.ht0 = now(); cam.hdur = dur;
  }

  let layout = null;
  function computeLayout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const panel = $('#controls');
    const pr = panel.getBoundingClientRect();
    const hidden = document.body.classList.contains('ui-hidden');
    const docked = !hidden && panel.dataset.dock;
    const area = { x0: 0, y0: 0, x1: vw, y1: vh };
    if (docked === 'right') area.x1 = Math.max(vw * 0.5, pr.left - 12);
    if (docked === 'bottom') area.y1 = Math.max(vh * 0.45, pr.top - 8);
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
    const contain = Math.min(vw / IMG_W, ah / IMG_H);
    const cover = Math.max(vw / IMG_W, vh / IMG_H);
    // fill the free height (on a phone this crops the sides and keeps the wheel)
    const sFull = Math.min(cover, Math.max(contain * 1.3, ah / IMG_H * 0.97)) * 1.04;
    const halfH = (docked === 'bottom' ? ah : vh) / 2 / sFull;
    const cyFull = Math.min(FULL_TOP + halfH, IMG_H - halfH, (FULL_TOP + IMG_H) / 2);
    const fit = Math.min(aw / CLUSTER_VIEW.w, ah / CLUSTER_VIEW.h);
    const sZoom = Math.max(fit, Math.min(sFull * 1.35, aw / 500));
    layout = {
      area,
      full: { s: sFull, cx: IMG_W / 2, cy: cyFull, vx: vw / 2, vy: docked === 'bottom' ? ah / 2 : vh / 2 },
      zoom: { s: sZoom, cx: CLUSTER_VIEW.cx, cy: CLUSTER_VIEW.cy, vx: (area.x0 + area.x1) / 2, vy: (area.y0 + area.y1) / 2 },
      hu: { s: Math.min(aw / HU_VIEW.w, ah / HU_VIEW.h), cx: HU_VIEW.cx, cy: HU_VIEW.cy, vx: (area.x0 + area.x1) / 2, vy: (area.y0 + area.y1) / 2 },
    };
  }

  let resT = 0;
  const stageView = { tx: 0, ty: 0, s: 1 };      // where the photo is on screen (rescue scene lines up with it)
  function applyCamera(t, dt) {
    if (cam.dur > 0) {
      const p = clamp((t - cam.t0) / cam.dur, 0, 1);
      cam.z = cam.from + (cam.to - cam.from) * ease(p);
      if (p >= 1) cam.dur = 0;
    }
    if (cam.hdur > 0) {
      const p = clamp((t - cam.ht0) / cam.hdur, 0, 1);
      cam.h = cam.hFrom + (cam.hTo - cam.hFrom) * ease(p);
      if (p >= 1) cam.hdur = 0;
    }
    const z = cam.z, L = layout;
    // log-scale blend between two views; positions follow the scale so the move feels like one dolly
    const blend = (A, B, w) => {
      const sc = Math.exp(Math.log(A.s) + (Math.log(B.s) - Math.log(A.s)) * w);
      const k = Math.abs(B.s - A.s) > 1e-6 ? (sc - A.s) / (B.s - A.s) : w;
      return { s: sc, cx: A.cx + (B.cx - A.cx) * k, cy: A.cy + (B.cy - A.cy) * k, vx: A.vx + (B.vx - A.vx) * k, vy: A.vy + (B.vy - A.vy) * k };
    };
    let V = blend(L.full, L.zoom, z);
    if (cam.h > 0.0005) V = blend(V, L.hu, cam.h);
    let { s, cx, cy, vx, vy } = V;
    if (huShade) huShade.style.opacity = smooth(0.15, 1, cam.h).toFixed(3);
    // body vibration from the road; a touch of engine shake at idle
    const vf = clamp(st.speed / 100, 0, 1.2);
    const idle = st.engine && st.speed < 1 ? 0.12 : 0;
    // close up on a screen (cluster or head unit) the shake would make its text shimmer:
    // it fades out there, and a still camera sits on whole pixels
    const calm = 1 - smooth(0.05, 0.6, Math.max(z, cam.h));
    let shakeX = (Math.sin(t * 31.7) * 0.5 + Math.sin(t * 17.3) * 0.5) * (0.35 * vf + idle) * calm;
    let shakeY = ((Math.sin(t * 23.1) * 0.6 + Math.sin(t * 41.9) * 0.4) * (0.45 * vf + idle) + Math.sin(t * 1.7) * 0.6 * vf) * calm;
    const still = !cam.dur && !cam.hdur;
    // never reveal the edge of the photo when it is large enough to fill the view
    const vw = window.innerWidth, vh = window.innerHeight;
    let tx = vx - cx * s, ty = vy - cy * s;
    // keep the picture's edges out of view; when it is smaller than the view the
    // same bounds simply swap, so the limit changes continuously while zooming
    const bx0 = vw - IMG_W * s;
    tx = clamp(tx, Math.min(bx0, 0), Math.max(bx0, 0));
    if (IMG_H * s >= vh) ty = clamp(ty, vh - IMG_H * s, 0);
    else ty = clamp(ty, 0, Math.max(0, L.area.y1 - IMG_H * s));   // short picture: no gap at the top
    if (still) { tx = Math.round(tx); ty = Math.round(ty); shakeX = Math.round(shakeX); shakeY = Math.round(shakeY); }
    stageView.tx = tx + shakeX; stageView.ty = ty + shakeY; stageView.s = s;     // the camera's own view
    // the rescue scene: the live cabin (photo, cluster, head unit) rides on the filmed wide shot,
    // lined up with it, so only the world outside the glass comes from the film
    if (rescue && rescue.cur) {
      const v = rescue.cur;
      s = v.k * RESCUE.plate.s; tx = v.x + v.k * RESCUE.plate.x; ty = v.y + v.k * RESCUE.plate.y; shakeX = shakeY = 0;
    }
    stage.style.transform = `translate3d(${(tx + shakeX).toFixed(2)}px, ${(ty + shakeY).toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
    // the head unit sits outside the stage layer (which is rasterized once, at one scale),
    // so it stays sharp when the camera closes in: it follows the same transform here
    if (huLayer) {
      const hk = s * huLayer.k;
      let hx = tx + shakeX + HU_SCREEN.x * s, hy = ty + shakeY + HU_SCREEN.y * s;
      if (still) { hx = Math.round(hx); hy = Math.round(hy); }
      const t3 = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0)`;
      const tr = `${t3} scale(${hk.toFixed(5)})`;
      if (tr !== huLayer.lastTr) {
        huLayer.lastTr = tr;
        huLayer.scr.style.transform = tr;
        huLayer.glass.style.transform = `${t3} scale(${s.toFixed(5)})`;
        let bx = tx + shakeX + BAND.x * s, by = ty + shakeY + BAND.y * s;
        if (still) { bx = Math.round(bx); by = Math.round(by); }
        huLayer.band.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0) scale(${(s / BAND.k).toFixed(5)})`;
      }
      const fl = z > 0.05 ? `brightness(${(1 - 0.55 * smooth(0.25, 1, z) * (1 - cam.h)).toFixed(2)})` : '';
      if (fl !== huLayer.lastFl) { huLayer.lastFl = fl; huLayer.scr.style.filter = fl; }
      if (huLayer.hand) huLayer.hand(tx + shakeX, ty + shakeY, s);
    }

    // zoomed in, the wheel fades to a faint translucent ghost that keeps moving
    const wheelA = 1 - 0.8 * smooth(0.1, 0.72, z);
    wheelCanvas.style.opacity = wheelA.toFixed(3);
    // the hub sits right of the display's centre in the photo; as the wheel turns
    // see-through, slide it under the display's centre so it reads as centred
    const zk = smooth(0.1, 0.72, z);
    wheelCanvas.style.transform = zk > 0.001 ? `translateX(${(WHEEL_SHIFT * zk).toFixed(2)}px)` : '';
    document.body.classList.toggle('zoomed', z > 0.5);
    focusShade.style.opacity = (smooth(0.25, 1, z) * (1 - cam.h)).toFixed(3);

    // Pick the cluster's pixel density for where the camera is heading, once,
    // when a move starts: re-allocating big canvases mid-zoom stutters on phones.
    const dpr = window.devicePixelRatio || 1;
    const density = (sc) => clamp(Math.ceil(sc * Cluster.rect.w / Cluster.designWidth * dpr * 4) / 4, 0.5, 3.2);
    const goal = cam.zoomAt ? 1 : cam.to;                 // a zoom-in is already scheduled
    const sEnd = Math.exp(Math.log(L.full.s) + (Math.log(L.zoom.s) - Math.log(L.full.s)) * goal);
    const want = cam.dur > 0 || cam.zoomAt ? Math.max(cluster.scale, density(Math.max(s, sEnd))) : density(s);
    wheel.setScale(s * dpr);
    resT += dt;
    if (want !== cluster.scale && (want > cluster.scale || resT > 0.5)) {
      cluster.setScale(want);
      resT = 0;
    }
  }

  /* ---------------- vehicle ---------------- */
  function showNotice() {
    const el = $('#notice');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function toast(msg, ms) {
    Link.send('toast', { msg });
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.tid);
    toast.tid = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }

  function ignition() {
    audio.unlock();
    if (st.ign === 'off') {
      st.ign = 'starting';
      st.ignT = 0;
      st.bootT = 0;
      st.ceremony = true;
      st.bulbCheck = false;
      audio.click();
      audio.welcome();
      showNotice();
      setTimeout(() => { if (st.ign === 'starting') audio.crank(0.95); }, 800);
    } else if (st.ign === 'starting') {
      return;
    } else {
      if (st.speed > 0.5) {
        toast('주행 중에는 시동을 끌 수 없습니다. 먼저 정지하십시오.');
        return;
      }
      audio.click();
      audio.stopRepeat();
      audio.goodbye();
      Object.assign(st, {
        ign: 'off', ignT: 0, engine: false, gear: 'P', mode: 'park', cruise: false,
        popup: null, bulbCheck: false, sweep: -1, pendingDrive: false,
      });
      st.redActive.clear();
      st.amberActive.clear();
      cam.zoomAt = null;
      if (cam.to > 0) camTo(0, 2.5);
    }
    syncUI();
  }

  function drive() {
    audio.unlock();
    if (st.ign === 'off') {
      toast('먼저 시동을 켜 주십시오  ·  START STOP 버튼 또는 I 키');
      pulse('#btnIgn');
      return;
    }
    if (st.ign === 'starting') {
      st.pendingDrive = true;
      toast('시동 중… 준비되면 출발합니다');
      return;
    }
    if (st.mode === 'accel' || st.mode === 'cruise') return;
    st.gear = 'D';
    st.mode = 'accel';
    st.cruise = false;
    audio.click();
    cam.outAt = null;
    // start from the full view (as in the photo), then dolly into the cluster after 3 s
    if (cam.z > 0.01 || cam.to > 0) {
      camTo(0, 1.4);
      cam.zoomAt = now() + 1.4 + 3;
    } else {
      cam.zoomAt = now() + 3;
    }
    syncUI();
  }

  function stop() {
    audio.unlock();
    if (st.mode === 'accel' || st.mode === 'cruise' || (st.mode === 'hold' && st.speed > 0.5)) {
      // pulling over while on the phone with the agent: the driver always puts the hazards on
      if (onCall()) setHazard(true);
      st.mode = 'brake';
      st.cruise = false;
      cam.zoomAt = null;
    } else if (st.pendingDrive) {
      st.pendingDrive = false;
    }
    syncUI();
  }

  function warn(level, id, tries) {
    audio.unlock();
    // the presenter moved on while the car was still starting: the warning comes once it runs
    if (st.ign === 'starting' && (tries || 0) < 25) { setTimeout(() => warn(level, id, (tries || 0) + 1), 300); return; }
    if (st.ign !== 'on') {
      toast(st.ign === 'off' ? '시동을 켠 후 경고등이 표시됩니다' : '계기판 점검 중입니다');
      return;
    }
    const list = level === 'red' ? SimData.RED : SimData.AMBER;
    const set = level === 'red' ? st.redActive : st.amberActive;
    const item = id ? SimData.RED.concat(SimData.AMBER).find((w) => w.id === id) : list.find((w) => !set.has(w.id));
    if (!item || (id && set.has(id))) {
      if (id && item) return;
      toast(level === 'red' ? '모든 긴급 경고등이 이미 점등되어 있습니다' : '모든 경고 · 알림등이 이미 점등되어 있습니다');
      return;
    }
    set.add(item.id);
    st.popup = { level, item, t0: now(), dur: 5.5 };
    audio.chime(level, item.id);
    director.warning(level, item);
    syncUI();
  }

  function clearWarnings() {
    st.redActive.clear();
    st.amberActive.clear();
    st.popup = null;
    audio.stopRepeat();
    syncUI();
  }

  function cycleMode() {
    audio.unlock();
    if (st.ign !== 'on') return;
    st.modeIndex = (st.modeIndex + 1) % st.modes.length;
    audio.tick();
  }

  function physics(t, dt) {
    st.ignT += dt;
    st.bootT += dt;
    if (st.ign === 'starting') {
      const k = st.ignT;
      st.backlight = 1;
      // GX ceremony (0-3.2 s, the engine starts under it), then the bulb check
      // and the needle sweep as the gauges come up
      st.bulbCheck = k > 2.7 && k < 3.9;
      st.sweep = k < 2.75 ? 0 : k < 3.45 ? ease((k - 2.75) / 0.7) : k < 4.15 ? 1 - ease((k - 3.45) / 0.7) : -1;
      if (k > 0.8 && k < 1.75) st.rpm = 190 + Math.sin(k * 62) * 40;
      if (k >= 1.75 && !st.engine) { st.engine = true; st.rpm = 480; }
      if (k >= 4.2) {
        st.ign = 'on';
        st.bulbCheck = false;
        st.sweep = -1;
        syncUI();
        if (st.pendingDrive) { st.pendingDrive = false; drive(); }
      }
    } else if (st.ign === 'off') {
      st.backlight = st.ignT > 50 ? 0 : 1 - smooth(2.6, 3.1, st.ignT);   // after the farewell
    } else {
      st.backlight = 1;
    }

    // the radio plays while the system is on
    if (st.ign === 'on' && st.music) st.music.pos = (st.music.pos + dt) % st.music.len;

    // longitudinal dynamics
    let vm = st.speed / 3.6, a = 0, thr = 0;
    if (st.shiftT > 0) st.shiftT -= dt;
    // the assistant slows for corners ahead and picks the speed up again after them
    // traffic and gradients: the assistant's speed drifts between about 60 and 84
    const s0 = st.odoMeters;
    st.flow = clamp(72 + 8 * Math.sin(s0 / 520 + 1) + 4 * Math.sin(s0 / 190) + 2 * Math.sin(s0 / 61), 58, st.setSpeed + 4);
    st.target = Math.min(st.flow, Road.safeSpeed(st.odoMeters));
    if (st.mode === 'accel') {
      const r = st.speed / st.setSpeed;
      a = Math.max(0.35, 3.9 * (1 - Math.pow(r, 3)));
      if (st.shiftT > 0) a *= 0.55;
      thr = 0.3 + 0.55 * (1 - r * r);
      if (st.speed > st.target + 1) { a = -clamp((st.speed - st.target) / 3.6 * 0.9, 0.3, 2.2); thr = 0; }
      if (st.speed >= st.target - 0.6) { st.mode = 'cruise'; st.cruise = true; syncUI(); }
    } else if (st.mode === 'cruise') {
      const target = st.target + 0.6 * Math.sin(t * 0.31) + 0.3 * Math.sin(t * 0.97 + 1);
      const err = (target - st.speed) / 3.6;
      a = err > 0 ? clamp(err * 0.8, 0, 1.8) : clamp(err * 0.9, -2.2, 0);
      thr = a > 0 ? clamp(0.2 + a * 0.3, 0.05, 0.7) : 0.02;
    } else if (st.mode === 'brake') {
      a = -(3.9 * clamp(st.speed / 16, 0.3, 1));
      if (vm + a * dt <= 0) {
        vm = 0; a = 0;
        st.mode = 'hold'; st.holdT = 0;
      }
    } else if (st.mode === 'hold') {
      st.holdT += dt;
      if (st.holdT > 1.3) {
        st.mode = 'park'; st.gear = 'P'; st.gearNum = 1;
        audio.click();
        cam.outAt = now() + 0.6;
        syncUI();
      }
    }
    if (st.mode !== 'hold' && st.mode !== 'park') vm = Math.max(0, vm + a * dt);
    st.speed = vm * 3.6;
    st.accel = follow(st.accel, a, 0.35, dt);
    st.throttle = follow(st.throttle, thr, 0.2, dt);

    // automatic gearbox
    if (st.gear === 'D' && st.shiftT <= 0) {
      const f = GEAR_FACTOR[st.gearNum];
      const up = st.mode === 'accel' ? 2200 + st.throttle * 1000 : 1600;
      if (st.gearNum < 10 && st.speed > 3 && st.speed * f > up && st.mode !== 'brake') {
        st.gearNum++; st.shiftT = 0.3;
      } else if (st.gearNum > 1 && st.speed * f < (st.mode === 'brake' ? 950 : 1100)) {
        st.gearNum--; st.shiftT = 0.22;
      }
    }
    if (st.speed < 2 && st.gearNum > 1) st.gearNum = 1;

    // engine speed
    if (st.engine) {
      let target = IDLE + (st.coolant < 60 ? 180 * (1 - (st.coolant - 40) / 20) : 0);
      if (st.gear === 'D' && (st.speed > 0.3 || st.throttle > 0.02)) {
        target = Math.max(IDLE, st.speed * GEAR_FACTOR[st.gearNum]);
        if (st.gearNum === 1 && st.throttle > 0.05) target = Math.max(target, 1100 + st.throttle * 1500 * clamp(1 - st.speed / 22, 0, 1));
        target += st.throttle * 150;
      } else if (st.gear === 'D') {
        target = IDLE - 30;
      }
      target += Math.sin(t * 7.3) * 6 + Math.sin(t * 13.1) * 4;
      if (st.ign === 'starting' && st.ignT < 2.4) target = 1350;
      st.rpm = follow(st.rpm, target, st.shiftT > 0 ? 0.15 : 0.11, dt);
      st.coolant = Math.min(88, st.coolant + dt * (st.speed > 1 ? 1.4 : 0.8));
    } else if (st.ign !== 'starting' || st.ignT < 0.8) {
      st.rpm = follow(st.rpm, 0, 0.28, dt);
      if (st.rpm < 5) st.rpm = 0;
    }
    st.eco = st.engine && st.gear === 'D' && st.speed > 3 && st.throttle < 0.4;

    // distance, fuel
    const dm = vm * dt;
    st.odoMeters += dm;
    st.odo += dm / 1000;
    st.range = Math.max(0, st.range - dm / 1000);
    st.fuel = Math.max(0, st.fuel - dm / 1000 * 0.0011);

    // steering: the angle the road's curve needs (wheelbase 2.85 m, ratio 16:1)
    // plus the driver's small, constant corrections
    const vf = clamp(st.speed / 60, 0, 1);
    // the driver turns in slightly ahead of the curve; the wheel never turns far
    // enough for its spokes to hide the cluster
    const look = st.odoMeters + Math.max(2, st.speed / 3.6 * 0.35);
    const roadAngle = clamp(Math.atan(2.85 * Road.curvature(look)) * 16 / DEG, -28, 28);
    // once the car stands still the driver lets the wheel return to centre:
    // corrections die away and the angle eases back to 0 (critically damped)
    const moving = st.speed > 0.5 && st.mode !== 'hold' && st.mode !== 'park';
    st.moveBlend = follow(st.moveBlend || 0, moving ? 1 : 0, moving ? 0.6 : 0.35, dt);
    const corr = st.moveBlend * (0.55 * Math.sin(t * 0.55) + 0.25 * Math.sin(t * 1.37 + 0.7) + 0.08 * Math.sin(t * 3.1 + 2)
      + vf * (0.55 * Math.sin(t * 0.29 + 1.1) + 0.3 * Math.sin(t * 0.71) + 0.15 * Math.sin(t * 2.3 + 0.4)));
    const target = moving ? roadAngle : 0;
    const w0 = 2 * Math.PI / (moving ? 1.6 : 2.2);           // response of the steering
    st.wheelVel = (st.wheelVel || 0) + (w0 * w0 * (target - (st.wheelRoad || 0)) - 2 * w0 * (st.wheelVel || 0)) * dt;
    st.wheelRoad = (st.wheelRoad || 0) + st.wheelVel * dt;
    st.wheel = st.wheelRoad + corr;
    // the corrections show up as a slight yaw and drift inside the lane
    st.yawErr = follow(st.yawErr, corr * 0.0009 * vf, 0.5, dt);
    st.laneOffset = vf * (0.22 * Math.sin(t * 0.23 + 0.5) + 0.1 * Math.sin(t * 0.61));
    st.pitch = follow(st.pitch, st.accel * 0.3, 0.45, dt);
    st.bump = clamp(st.speed / 80, 0, 1.2) * (Math.sin(t * 19.3) * 0.3 + Math.sin(t * 7.9 + 1) * 0.4 + (Math.random() - 0.5) * 0.3);
  }

  /* ---------------- UI ---------------- */
  function pulse(sel) {
    const el = $(sel);
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  function syncUI() {
    document.body.dataset.ign = st.ign;
    $('#btnIgn').setAttribute('aria-pressed', st.ign !== 'off');
    $('#btnDrive').classList.toggle('active', st.mode === 'accel' || st.mode === 'cruise');
    $('#btnStop').classList.toggle('active', st.mode === 'brake' || st.mode === 'hold');
    $('#redCount').textContent = st.redActive.size || '';
    $('#amberCount').textContent = st.amberActive.size || '';
    $('#btnSound').setAttribute('aria-pressed', audio.enabled);
  }

  let statusT = 0;
  function updateStatus(dt) {
    statusT -= dt;
    if (statusT > 0) return;
    statusT = 0.1;
    const ign = { off: 'OFF', starting: 'START', on: 'ON' }[st.ign];
    const gear = st.gear === 'D' ? `D${st.gearNum}` : st.gear;
    const mode = { park: '정차', accel: '가속', cruise: '정속 주행', brake: '감속', hold: '정지' }[st.mode];
    $('#status').innerHTML =
      `<span><b>IGN</b>${ign}</span><span><b>GEAR</b>${gear}</span>` +
      `<span><b>km/h</b>${Math.round(st.speed)}</span><span><b>rpm</b>${Math.round(st.rpm / 10) * 10}</span>` +
      `<span class="mode">${st.ign === 'off' ? '시동 꺼짐' : mode}${st.cruise && st.target < st.setSpeed - 2 ? ' · 커브 감속' : ''}</span>`;
    const d = new Date();
    st.clock = `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;   // the viewer's local time
    st.ampm = d.getHours() < 12 ? 'AM' : 'PM';
  }

  /* ---------------- e-Care call center link ---------------- */
  const director = new ECare.Director(() => st);
  // one vehicle simulator per group of devices: a second one (wall.html or index.html open
  // on another device or tab) would raise every warning and call twice, so it says so
  const simT0 = Date.now();
  let dupUntil = 0;
  const dup = document.createElement('div');
  dup.id = 'dupSim';
  dup.textContent = '다른 창 · 기기에서 차량 시뮬레이터(시연 화면)가 이미 실행 중입니다. 이 창을 닫아 주세요 — 두 곳에서 열면 경고 · 통화가 두 번 일어납니다.';
  document.body.appendChild(dup);
  Link.on('sim-alive', (d, m) => {
    if (d.t0 < simT0 || (d.t0 === simT0 && m.from < Link.me)) { dupUntil = Date.now() + 8000; dup.classList.add('on'); }
  });
  const alive = () => { Link.send('sim-alive', { t0: simT0 }); if (Date.now() > dupUntil) dup.classList.remove('on'); };
  alive();
  setInterval(alive, 3000);
  // the customer has pulled over on the shoulder by the time the agent calls
  // a call with the e-Care agent in progress (the vehicle's case or a general call)
  function onCall() {
    const g = director.general;
    if (g && (g.state === 'connected' || g.state === 'ringing')) return true;
    return director.cases.some((c) => c.call && (c.call.state === 'connected' || c.call.state === 'dialing'));
  }
  director.hooks.accept = () => { if (st.mode === 'accel' || st.mode === 'cruise') { stop(); setHazard(true); toast('고객 차량 갓길 정차 · 비상등 · e-Care 상담센터 발신'); } };
  director.hooks.stop = () => { if (st.mode === 'accel' || st.mode === 'cruise') { stop(); setHazard(true); toast('고객 차량 갓길 정차 · 비상등'); } };
  // hazard lights: on when the call says the customer switched them on (director), or from
  // the control panel; both turn arrows on the cluster, the console button and the relay tick
  const HAZ_BTN = { x: 1452, y: 491, w: 40, h: 48 };
  const hazBtn = document.createElement('div');
  hazBtn.id = 'hazBtn';
  Object.assign(hazBtn.style, { left: `${HAZ_BTN.x}px`, top: `${HAZ_BTN.y}px`, width: `${HAZ_BTN.w}px`, height: `${HAZ_BTN.h}px` });
  hazBtn.innerHTML = '<svg viewBox="0 0 40 48"><path d="M20 15.5 L29.5 32 H10.5 Z M20 20.6 L25.3 29.8 H14.7 Z" fill-rule="evenodd"/></svg>';
  stage.appendChild(hazBtn);
  function setHazard(on) {
    on = !!on;
    if (on === st.hazard) return;
    st.hazard = on;
    st.hazT0 = now();
    if (on) { toast('비상등 점등'); hazLookUntil = Date.now() + 4200; }
  }
  director.hooks.hazard = (c, on) => setHazard(on);
  // the tow truck has come for the car: the driver switches the engine and the flashers off
  function parkForTow() {
    if (st.hazard) setHazard(false);
    if (st.ign === 'off') return;
    if (st.speed > 0.5 || st.mode !== 'park') Object.assign(st, { speed: 0, accel: 0, throttle: 0, mode: 'park', cruise: false, pendingDrive: false });
    if (st.ign === 'starting') Object.assign(st, { ign: 'on', engine: true, bulbCheck: false, sweep: -1, ceremony: false });
    ignition();
    toast('견인 준비 · 시동 OFF · 비상등 OFF');
  }
  director.hooks.tow = () => parkForTow();
  // "e-Care 시뮬레이션 종료": the car is switched off and every sound stops (engine, flashers,
  // chimes, the siren); any other scene brings the sound back for the next run
  function quiet() {
    setHazard(false);
    st.hazOn = false; hazBtn.classList.remove('on');
    if (st.ign !== 'off') Object.assign(st, { ign: 'off', ignT: 0, engine: false, rpm: 0, throttle: 0, speed: 0, accel: 0, gear: 'P', mode: 'park', cruise: false, popup: null, bulbCheck: false, sweep: -1, pendingDrive: false, ceremony: false });
    sirenStop();
    audio.mute(true);
    syncUI();
  }
  Link.on('stage', (d) => { if (!d || !d.scene) return; if (d.scene === 'end') quiet(); else if (audio.muted) audio.mute(false); });
  // standing still for a minute with the flashers on: they go off (the driver is out of danger)
  let stoppedSince = 0;
  function hazardTick(t) {
    if (st.hazard && st.speed < 0.5) {
      if (!stoppedSince) stoppedSince = t;
      else if (t - stoppedSince > 60) { setHazard(false); stoppedSince = 0; toast('정차 1분 경과 · 비상등 끔'); }
    } else stoppedSince = 0;
    const lit = st.hazard && ((t - st.hazT0) % 0.76) < 0.4;
    if (lit === st.hazOn) return;
    st.hazOn = lit;
    hazBtn.classList.toggle('on', lit);
    try { audio.click(); } catch (e) { /* audio locked */ }
  }

  /* ---------------- head unit in the centre display (index.html?hu) ----------------
   * The head unit page is drawn into the display's picture area, under a glass
   * reflection; the customer's phone comes in over the whole view. The camera
   * follows the scenario: a warning on the cluster, then the head unit popup,
   * the call on the head unit, back to the cabin. The control panel can hold a
   * view (Link 'cam' {view: auto | full | cluster | hu}). */
  let huShade = null, huLayer = null;
  if (new URLSearchParams(location.search).has('hu')) {
    const k = Math.min(HU_SCREEN.w / HU_SCREEN.design[0], HU_SCREEN.h / HU_SCREEN.design[1]);
    const scr = document.createElement('iframe');
    scr.id = 'huScreen';
    scr.src = 'hu.html?embed=1';
    scr.title = '헤드유닛';
    Object.assign(scr.style, { width: `${HU_SCREEN.design[0]}px`, height: `${HU_SCREEN.design[1]}px` });
    const glare = document.createElement('div');
    glare.id = 'huGlass';
    Object.assign(glare.style, { width: `${HU_SCREEN.w}px`, height: `${HU_SCREEN.h}px` });
    huShade = document.createElement('div');
    huShade.id = 'huShade';
    const band = document.createElement('img');
    band.id = 'huBand';
    band.src = BAND.src;
    band.alt = '';
    stage.after(band, scr, glare);
    stage.appendChild(huShade);
    huLayer = { scr, glass: glare, band, k };
    const ov = document.createElement('iframe');
    ov.id = 'huPhone';
    ov.src = 'hu.html?overlay=1';
    ov.title = '고객 휴대전화';
    document.body.appendChild(ov);
    initHand();
  }
  /* the driver's hand: a filmed reach to the [전화연결] button (alpha video, keyed
   * against the empty frame), laid over the live head unit. The video was shot on
   * the head-unit view: its frame is HU_VIEW's height, centred on HU_VIEW. */
  let handHold = false;
  function initHand() {
    const HAND = { src: 'assets/hand_call.webm?v=2', contact: HAND_CONTACT, ar: HAND_AR };
    const R = { h: HU_VIEW.h, w: HU_VIEW.h * HAND.ar, x: 0, y: 0 };
    // the button's middle on the plate: read from the head unit screen (design px → plate px)
    const aim = () => {
      let bx = 1258, by = 541;                     // where [전화 연결] sits on the 1920x622 screen
      try {
        const b = huLayer.scr.contentDocument.querySelector('.pop button.call');
        if (b) { const r = b.getBoundingClientRect(); bx = r.left + r.width / 2; by = r.top + r.height / 2; }
      } catch (e) { /* not loaded */ }
      const px = HU_SCREEN.x + bx * huLayer.k, py = HU_SCREEN.y + by * huLayer.k;
      R.x = px - HAND_TIP.x * R.w; R.y = py - HAND_TIP.y * R.h;
    };
    aim();
    const vid = document.createElement('video');
    vid.id = 'huHand';
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto';
    vid.src = HAND.src;
    document.body.appendChild(vid);
    let vw = 0, vh = 0, busy = false;
    vid.addEventListener('loadedmetadata', () => { vw = vid.videoWidth; vh = vid.videoHeight; });
    huLayer.hand = (tx, ty, s) => {
      if (!busy || !vw) return;
      vid.style.transform = `translate3d(${(tx + R.x * s).toFixed(2)}px, ${(ty + R.y * s).toFixed(2)}px, 0) scale(${(s * R.w / vw).toFixed(5)}, ${(s * R.h / vh).toFixed(5)})`;
    };
    const ready = () => !cam.hdur && cam.h > 0.98;
    // the popup is on the head unit, settled (its entrance played), with [전화 연결] on it
    let popSince = 0;
    const popReady = () => {
      let b = null;
      try { b = huLayer.scr.contentDocument.querySelector('.pop button.call'); } catch (e) { b = null; }
      if (!b) { popSince = 0; return false; }
      if (!popSince) popSince = performance.now();
      return performance.now() - popSince > 450;
    };
    let reachTok = 0;
    const cancel = () => { reachTok++; if (busy) { try { vid.pause(); } catch (e) { /* */ } busy = false; handHold = false; vid.classList.remove('on'); } };
    huLayer.cancelHand = cancel;
    Link.on('hu', async (d) => {
      if (d.action === 'cancelReach') { cancel(); return; }
      if (d.action !== 'reach') return;
      const c = director.cases[0];
      if (busy || !c || c.wcase !== 'A' || c.contact > 0 || c.inbound) return;
      Link.send('hu', { action: 'reaching' });
      Link.send('hu', { action: 'show' });     // the popup may have folded away: bring it back for the hand
      busy = true; handHold = true;
      const tk = ++reachTok;
      if (huFocus !== 1) focusPolicy(true);
      // the hand only moves once the camera is on the head unit AND the popup is up there:
      // the finger never reaches an empty screen (the popup can come a moment after the warning)
      popSince = 0;
      for (let i = 0; i < 100 && !(ready() && popReady()); i++) {
        if (i % 10 === 5) Link.send('hu', { action: 'show' });
        await new Promise((r) => setTimeout(r, 100));
      }
      if (tk !== reachTok) return;
      await new Promise((r) => setTimeout(r, 80));
      if (tk !== reachTok) return;
      aim();
      let pressed = false;
      const press = () => { if (!pressed && tk === reachTok) { pressed = true; Link.send('hu', { action: 'press' }); } };
      const tick = () => {
        if (vid.currentTime >= HAND.contact) press();
        if (!vid.ended && busy) requestAnimationFrame(tick);
      };
      const done = () => { if (tk !== reachTok) return; press(); busy = false; handHold = false; vid.classList.remove('on'); };
      vid.onended = done;
      vid.onerror = done;
      try {
        vid.currentTime = 0;
        vid.classList.add('on');
        await vid.play();
        requestAnimationFrame(tick);
      } catch (e) { done(); }
      setTimeout(() => { if (busy && tk === reachTok) { vid.pause(); done(); } }, 15000);
    });
  }
  /* ---------------- the rescue truck arrives (filmed, hyperreal) ----------------
   * When the truck comes into view the camera pulls back to the whole cabin; a filmed
   * wide shot of the same cockpit fades in exactly over the photo and the view keeps
   * widening — the whole windshield and the driver's window open up — while the truck
   * passes the driver's window and pulls up in front of the car. It stays there, light
   * bar flashing, until the call is over; then the view closes back onto the dashboard.
   * plate: where the photo (IMG px) sits in the clip (clip px per photo px). */
  // two filmed parts of the same truck: the approach (A), slowing to a stop centred in front of
  // the car at switchAt; then the parked truck (C, first frame = last frame = A at switchAt)
  // looping for as long as the scene holds — light bar flashing, traffic passing in the other lanes
  const RESCUE = { src: 'assets/rescue_arrive.mp4?v=4', srcC: 'assets/rescue_hold.mp4?v=4', w: 2560, h: 1086, plate: { x: 494.1, y: 425.1, s: 0.7345 }, slowFrom: 5.7, switchAt: 6.6, playDelay: 1.6, hold: 12 };
  const rescueEl = document.createElement('div');
  rescueEl.id = 'rescue';
  rescueEl.innerHTML = '<div class="bg"></div><div class="frame"><video class="va" muted playsinline preload="auto"></video><video class="vc" muted playsinline preload="auto" loop></video><i class="bar"></i></div>';
  $('#viewport').insertBefore(rescueEl, stage);
  // the caption sits over everything (the cabin is drawn over the film)
  const rCap = document.createElement('div');
  rCap.id = 'rescueCap';
  rCap.textContent = '긴급출동 차량 도착';
  document.body.appendChild(rCap);
  const capOn = (on) => rCap.classList.toggle('on', !!on);
  const [rVid, rC] = rescueEl.querySelectorAll('video'), rFrame = rescueEl.querySelector('.frame'), rBg = rescueEl.querySelector('.bg');
  rVid.src = RESCUE.src; rC.src = RESCUE.srcC;
  const rAll = [rVid, rC];
  const rShow = (v) => { rAll.forEach((x) => { x.style.opacity = x === v ? 1 : 0; x.style.zIndex = x === v ? 2 : 1; }); };
  let rescue = null;      // { phase: pull | fade | widen | hold | narrow | out, t0, stopped }
  function rescueStart() {
    if (rescue) return;
    rescue = { phase: 'pull', t0: now(), played: false, stopped: 0, onC: false };
    rAll.forEach((v) => { try { v.pause(); v.currentTime = 0; v.playbackRate = 1; } catch (e) { /* not loaded yet */ } });
    rShow(rVid);
    focusPolicy(true);
    sirenStart();
  }
  function rescueStop(now_) {
    if (!rescue) return;
    if (now_) { sirenStop(); rescue = null; extCanvas.style.opacity = ''; if (driveVid) driveVid.style.opacity = ''; document.body.classList.remove('rescue'); rescueEl.classList.remove('on', 'stopped'); capOn(false); rAll.forEach((v) => { try { v.pause(); } catch (e) { /* */ } }); focusPolicy(true); return; }
    if (rescue.phase !== 'narrow' && rescue.phase !== 'out') { rescue.phase = 'narrow'; rescue.t0 = now(); rescue.from = rescue.cur; capOn(false); }
  }
  director.hooks.rescue = (c) => (c ? rescueStart() : rescueStop(true));
  // the clip's framing that lines up with the photo where it is now / that fills the view
  function rescueAligned() {
    const k = stageView.s / RESCUE.plate.s;
    return { k, x: stageView.tx - RESCUE.plate.x * k, y: stageView.ty - RESCUE.plate.y * k };
  }
  // the film's usable area: its left edge holds no picture after the alignment warp
  const RESCUE_SAFE = { x0: 124, x1: RESCUE.w - 16, y0: 0, y1: RESCUE.h };
  function rescueWide() {
    const vw = innerWidth, vh = innerHeight;
    const sw = RESCUE_SAFE.x1 - RESCUE_SAFE.x0, sh = RESCUE_SAFE.y1 - RESCUE_SAFE.y0;
    const k = Math.min(Math.max(vw / sw, vh / sh), Math.min(vw / sw, vh / sh) * 1.12);
    return { k, x: (vw - sw * k) / 2 - RESCUE_SAFE.x0 * k, y: (vh - sh * k) / 2 - RESCUE_SAFE.y0 * k };
  }
  // a dolly between two framings: log scale, the view centre following the scale
  function rescueBlend(A, B, w) {
    const vw = innerWidth, vh = innerHeight;
    const k = Math.exp(Math.log(A.k) + (Math.log(B.k) - Math.log(A.k)) * w);
    const f = Math.abs(B.k - A.k) > 1e-6 ? (k - A.k) / (B.k - A.k) : w;
    const ca = { x: (vw / 2 - A.x) / A.k, y: (vh / 2 - A.y) / A.k }, cb = { x: (vw / 2 - B.x) / B.k, y: (vh / 2 - B.y) / B.k };
    const cx = ca.x + (cb.x - ca.x) * f, cy = ca.y + (cb.y - ca.y) * f;
    return { k, x: vw / 2 - cx * k, y: vh / 2 - cy * k };
  }
  /* ---------------- the rescue truck's siren ----------------
   * A recorded siren (assets/audio/siren.mp3, from Openverse) placed in 3D around the driver:
   * it comes from far behind, passes the driver's side and stops in front — the same path the
   * truck takes in the film. Its clock is the film's own time (rescue_arrive.mp4), so where the
   * sound is and where the truck is never drift apart; before the film starts the truck is
   * still behind the car and the clock runs ahead of it. Distance sets the level and the
   * muffling (the car's cabin), the speed along the line of sight the Doppler pitch. */
  // the truck in the film: [film s, metres right of the driver (−: left), metres behind (−: ahead)]
  const SIREN_PATH = [[-7, -3.6, 230], [0, -3.6, 62], [0.5, -3.6, 44], [1, -3.5, 28], [1.5, -3.4, 15], [2, -3.2, 6], [2.5, -3, 0],
    [3, -2.8, -4], [3.5, -2.2, -8], [4, -1.4, -11], [4.5, -0.6, -14], [5, 0, -16], [5.7, 0.2, -18], [6.6, 0.2, -19]];
  const sirenAt = (ct) => {
    const P = SIREN_PATH;
    if (ct <= P[0][0]) return [P[0][1], P[0][2] + (P[0][0] - ct) * 30];
    for (let i = 1; i < P.length; i++) {
      if (ct <= P[i][0]) { const a = P[i - 1], b = P[i], k = (ct - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    }
    return [P[P.length - 1][1], P[P.length - 1][2]];
  };
  const SIREN_SRC = 'assets/audio/siren.mp3';
  let sirenBuf = null, sirenLoading = null, siren = null;
  // no recording at hand: a two-tone wail made here, the same length and loop
  function sirenSynth(ctx) {
    const sr = ctx.sampleRate, len = Math.round(sr * 8), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, u = (t % 4) / 4, f = 700 + 820 * (u < 0.5 ? Math.sin(u * Math.PI) : Math.sin(u * Math.PI));
      ph += (2 * Math.PI * f) / sr;
      d[i] = 0.42 * Math.sin(ph) + 0.2 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph) + 0.05 * Math.sin(5 * ph);
    }
    return b;
  }
  function sirenLoad(ctx) {
    if (sirenBuf || sirenLoading) return sirenLoading;
    sirenLoading = fetch(SIREN_SRC).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((ab) => new Promise((ok, no) => ctx.decodeAudioData(ab, ok, no)))
      .catch(() => sirenSynth(ctx))
      .then((b) => { sirenBuf = b; return b; });
    return sirenLoading;
  }
  function sirenStart() {
    sirenStop();
    audio.unlock();
    const ctx = audio.ctx;
    if (!ctx) return;
    const me = { ct: SIREN_PATH[0][0] + 2.5, last: now(), dist: null, src: null, ctx };
    siren = me;
    sirenLoad(ctx).then((buf) => {
      if (siren !== me || !buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 1200;
      const pan = ctx.createPanner();
      Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 7, rolloffFactor: 1.15, maxDistance: 2000 });
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp).connect(pan).connect(g).connect(audio.master);
      const L = ctx.listener;
      if (L.forwardZ) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else if (L.setOrientation) L.setOrientation(0, 0, -1, 0, 1, 0);
      src.start(0, Math.random() * buf.duration);
      g.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
      Object.assign(me, { src, lp, pan, g });
    });
  }
  function sirenStop(fade) {
    const s = siren;
    siren = null;
    if (!s || !s.src) return;
    const t = s.ctx.currentTime;
    s.g.gain.cancelScheduledValues(t);
    s.g.gain.setTargetAtTime(0, t, fade ? 0.5 : 0.05);
    setTimeout(() => { try { s.src.stop(); s.src.disconnect(); } catch (e) { /* stopped */ } }, fade ? 3000 : 300);
  }
  // per frame: the film's clock → where the truck is → the sound
  function sirenTick() {
    const S = siren, R = rescue;
    if (!S) return;
    const tn = now(), dt = Math.min(0.1, tn - S.last);
    S.last = tn;
    // what the film says the time is, when it can say
    let film = null;
    if (R && R.phase === 'widen' && !R.played) film = tn - R.t0 - RESCUE.playDelay;
    else if (R && R.played && !R.onC) film = rVid.currentTime;
    else if (R && R.onC) film = RESCUE.switchAt + (tn - R.stopped);
    S.ct += dt * (R && R.played && !R.onC ? rVid.playbackRate : 1);
    if (film != null) S.ct += (film - S.ct) * Math.min(1, dt * 4);
    else if (R && (R.phase === 'pull' || R.phase === 'fade')) S.ct = Math.min(S.ct, -RESCUE.playDelay - 0.2);   // the film has not begun: the truck is still behind
    if (!S.src) return;
    const [x, z] = sirenAt(S.ct);
    const dist = Math.hypot(x, z, 1.2);
    const t = S.ctx.currentTime;
    const p = S.pan;
    if (p.positionX) { p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(0.3, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); } else p.setPosition(x, 0.3, z);
    // Doppler: the truck closing in sounds higher, the pitch drops as it passes
    if (S.dist != null && dt > 0) {
      const vr = (dist - S.dist) / dt;                        // + receding
      S.src.playbackRate.setTargetAtTime(clamp(343 / (343 + vr), 0.9, 1.1), t, 0.08);
    }
    S.dist = dist;
    // the cabin muffles it; nearer and to the side (the driver's window) it opens up
    S.lp.frequency.setTargetAtTime(1300 + 5200 * Math.exp(-dist / 18), t, 0.08);
    // it has pulled up: the siren is switched off, the light bar keeps flashing
    if (R && R.stopped && tn - R.stopped > 1.6) sirenStop(true);
  }

  function rescueTick() {
    sirenTick();
    if (!rescue) return;
    const t = now() - rescue.t0, R = rescue;
    let v = null, op = 1;
    if (R.phase === 'pull') {
      // wait for the camera to settle on the whole cabin
      if ((cam.z < 0.02 && cam.h < 0.02 && !cam.dur && !cam.hdur) || t > 4) { R.phase = 'fade'; R.t0 = now(); }
      return;
    }
    if (R.phase === 'fade') { v = rescueAligned(); op = smooth(0, 0.9, t); if (t >= 0.9) { R.phase = 'widen'; R.t0 = now(); R.from = v; } }
    else if (R.phase === 'widen' || R.phase === 'hold') {
      const w = ease(clamp(t / 3.4, 0, 1));
      v = R.phase === 'hold' ? rescueWide() : rescueBlend(R.from, rescueWide(), w);
      if (R.phase === 'widen' && !R.played && t >= RESCUE.playDelay) { R.played = true; rVid.play().catch(() => {}); }
      if (R.phase === 'widen' && t >= 3.4) R.phase = 'hold';
      // the approach hands over to the stop on the same frame
      // the truck slows to a stop centred in front of the car; the parked loop takes over on that frame
      if (R.played && !R.onC) {
        const ct = rVid.currentTime;
        if (ct >= RESCUE.switchAt - 0.02 || rVid.ended) {
          R.stopped = now(); rescueEl.classList.add('stopped'); capOn(true);
          // the same truck on the same frame: a 0.25 s dissolve hides the films' small difference
          if (rC.readyState >= 2) { rC.currentTime = 0; rC.play().catch(() => {}); rC.style.zIndex = 3; rC.style.opacity = 0; R.xC = now(); }
          rVid.pause();
          R.onC = true;
        } else if (ct >= RESCUE.slowFrom) rVid.playbackRate = Math.max(0.25, 1 - 0.75 * (ct - RESCUE.slowFrom) / (RESCUE.switchAt - RESCUE.slowFrom));
      }
      if (R.xC) { const k = clamp((now() - R.xC) / 0.25, 0, 1); rC.style.opacity = k.toFixed(3); if (k >= 1) { R.xC = 0; rShow(rC); } }
      if (R.stopped && now() - R.stopped > 4) capOn(false);
      if (R.stopped && !R.parked && now() - R.stopped > 2.5) { R.parked = true; parkForTow(); }
      // after the call (and a while on the truck) the view closes back onto the dashboard
      if (R.stopped && now() - R.stopped > RESCUE.hold && !onCall()) rescueStop(false);
    } else if (R.phase === 'narrow') {
      const w = ease(clamp(t / 2.6, 0, 1));
      v = rescueBlend(R.from, rescueAligned(), w);
      if (t >= 2.6) { R.phase = 'out'; R.t0 = now(); }
    } else if (R.phase === 'out') {
      v = rescueAligned(); op = 1 - smooth(0, 0.8, t);
      if (t >= 0.8) { rescueStop(true); return; }
    }
    if (!v) return;
    R.cur = v;
    rescueEl.classList.add('on'); document.body.classList.add('rescue');
    extCanvas.style.opacity = (1 - op).toFixed(3);      // the film shows through the windows
    if (driveVid) driveVid.style.opacity = (1 - op).toFixed(3);
    rFrame.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) scale(${v.k.toFixed(5)})`;
    rFrame.style.opacity = op.toFixed(3);
    // a soft blurred copy fills the view where the clip does not reach (an upright or 4:3 screen)
    const wide = rescueWide();
    const kk = clamp((v.k - (R.from ? R.from.k : v.k)) / Math.max(1e-6, wide.k - (R.from ? R.from.k : v.k)), 0, 1);
    rBg.style.opacity = (op * (R.phase === 'narrow' || R.phase === 'out' ? 1 - smooth(0, 2.6, t) : kk)).toFixed(3);
  }

  let camHold = 'auto', seenCase = null, huFocus = 0, huEndAt = 0, hazLookUntil = 0;
  Link.on('cam', (d) => { camHold = d.view || 'auto'; focusPolicy(true); });
  function focusPolicy(force) {
    if (!huShade) return;
    let want;                                   // 'hu' | 'cluster' | null (vehicle decides)
    if (handHold) want = 'hu';
    else if (rescue) want = 'full';                     // the rescue truck: the whole cabin
    else if (camHold !== 'auto') want = camHold === 'full' ? 'full' : camHold;
    else if (Date.now() < hazLookUntil) want = 'full';     // the flashers just came on: show the cabin
    else {
      const c = director.cases[0];
      const nowMs = Date.now();
      if (c && c.id !== seenCase) {
        seenCase = c.id;
        if (cam.to < 1) camTo(1, 1.4);          // the lamp comes up on the cluster first
      }
      if (c) {
        const age = nowMs - c.at, call = c.call;
        // the head unit shows the popup once the message has reached the car (data flow)
        const shownAt = c.got ? c.got.car : c.at + 2800;
        const popup = c.contact === 0 && !c.inbound && !c.assign && shownAt && nowMs - shownAt < 13000;
        const inCall = call && call.dir === 'in' && (call.state === 'connected' || nowMs - (call.endedAt || 0) < 1200);
        // the call with the e-Care agent is over: the whole cabin (the car waits for the rescue)
        if (call && call.state === 'ended' && nowMs - (call.endedAt || 0) >= 1200) want = 'full';
        else if (!shownAt && c.contact === 0 && !c.inbound) want = 'cluster';
        else if ((c.inbound && !call) || inCall || popup || (c.wcase !== 'A' && age < 20000)) want = 'hu';
      }
    }
    const h = want === 'hu' ? 1 : 0;
    if (h !== huFocus || force) {
      huFocus = h;
      huTo(h, h ? 1.8 : 2.6);
      if (h) camTo(0, 1.8);                     // leave the cluster while panning across
      else huEndAt = now();
    }
    if (!h) {
      const zWant = want === 'cluster' ? 1 : want === 'full' ? 0 : null;
      if (zWant != null && cam.to !== zWant && !cam.dur) camTo(zWant, zWant ? 1.6 : 2.4);
      // back from the head unit: the cluster again while driving, the cabin when parked
      if (zWant == null && huEndAt && now() - huEndAt > 2.6) {
        huEndAt = 0;
        camTo(st.mode === 'accel' || st.mode === 'cruise' ? 1 : 0, 2.6);
      }
    }
  }
  setInterval(() => focusPolicy(false), 250);
  const ccwWindows = {};
  function openScreen(name, url) {
    const w = ccwWindows[name];
    if (w && !w.closed) { w.focus(); return; }
    ccwWindows[name] = window.open(url, 'gs-' + name, 'popup=yes,width=1600,height=900');
    if (!ccwWindows[name]) toast('팝업이 차단되었습니다. 주소창의 팝업 허용을 눌러 주세요.');
  }
  function care(name) {
    if (name === 'careReset') { director.command('reset', {}); toast('e-Care 시나리오를 초기화했습니다'); return; }
    if (name === 'noAnswer') {
      director.command('noAnswer', {});
      toast(director.noAnswer ? '고객 미응답 시나리오 ON · 아웃바운드 3회 발신 실패 → SMS 자동 발송' : '고객 미응답 시나리오 OFF');
      syncCare();
      return;
    }
    if (name === 'inbound') {
      const r = director.command('inbound', {});
      toast(r === 'busy' ? '상담원이 통화 중입니다. 통화가 끝난 뒤 다시 걸어 주세요.' : r === 'case' ? '고객 e-Care 인바운드 콜 · 상담센터 전화 수신 팝업' : '고객 일반 전화 · 상담센터 전화 수신 팝업 (경고 케이스 없음)');
      return;
    }
    if (!director.live()) { toast('먼저 경고등(W)을 발생시켜 주십시오. 긴급 경고가 e-Care 상담 케이스로 등록됩니다.'); return; }
    director.command(name, {});
  }
  let noiseOn = true;
  function ccwNoise() {
    noiseOn = !noiseOn;
    Link.send('ccw-noise', { on: noiseOn });
    toast(noiseOn ? '콜센터 주변 소음 켜짐' : '콜센터 주변 소음 꺼짐');
    syncCare();
  }
  function syncCare() {
    const na = document.querySelector('[data-action="noAnswer"]');
    if (na) na.setAttribute('aria-pressed', director.noAnswer ? 'true' : 'false');
    const nz = document.querySelector('[data-action="ccwNoise"]');
    if (nz) nz.setAttribute('aria-pressed', noiseOn ? 'true' : 'false');
  }
  // vehicle state for every connected screen, 4 times a second
  setInterval(() => Link.send('veh', {
    ign: st.ign, speed: st.speed, gear: st.gear, gearNum: st.gearNum, rpm: st.rpm, odoMeters: st.odoMeters, odo: st.odo,
    fuel: st.fuel, range: st.range, red: [...st.redActive], amber: [...st.amberActive], wheel: st.wheel, mode: st.mode,
    clock: st.clock, coolant: st.coolant, outside: st.outside, hazard: st.hazard, engine: audio.engId,
  }), 250);
  let careT = 0;
  // the e-Care task closes (repair finished in DMS): the finale sounds once per case
  const closedSeen = new Set();
  let closedFirst = true;
  function finaleCheck() {
    for (const k of director.cases) {
      if ((k.done || k.dms >= 7) && !closedSeen.has(k.id)) { closedSeen.add(k.id); if (!closedFirst) { audio.unlock(); audio.finale(); } }
      if (!k.done && k.dms < 7) closedSeen.delete(k.id);
    }
    closedFirst = false;
  }
  function updateCare(dt) {
    careT -= dt;
    if (careT > 0) return;
    careT = 0.5;
    finaleCheck();
    const c = director.find();
    const el = $('#careState');
    const lk = $('#linkState');
    lk.textContent = Link.label();
    st.ecareCall = c && c.call && (c.call.state === 'connected' || c.call.state === 'dialing') ? c.call : null;
    const g = director.general;
    if (g) { el.textContent = `일반 전화 · ${{ ringing: '전화 수신', connected: '통화 중', ended: '후처리' }[g.state]}`; st.ecareCall = g.state === 'connected' ? { state: 'connected', connectedAt: g.connectedAt } : g.state === 'ringing' ? { state: 'dialing' } : null; return; }
    if (!c) { el.textContent = '대기 · 상담원 3명'; return; }
    const sla = ECare.mmss(Math.max(0, ECare.SLA - (Date.now() - c.slaBase)));
    const contact = ECare.CONTACT[c.contact];
    const call = c.inbound && !c.call ? ' · 전화 수신' : c.assign && !c.assign.done && c.contact === 0 ? ' · 경고 알림 팝업' : c.call ? ({ dialing: ' · 발신 중', connected: ' · 통화 중', failed: ` · 연결 실패 ${c.retry ? c.retry.count : 0}/2` }[c.call.state] || '') : '';
    const memo = c.sheet && !c.sheet.saved ? ` · 상담 메모 ${c.sheet.step}/3` : c.sms ? ' · SMS 발송' : '';
    const disp = c.dispatch >= 0 ? ` · 출동 ${ECare.DISPATCH[c.dispatch]}` : '';
    el.textContent = `${c.id.slice(-4)} · ${contact}${call}${memo}${disp}${c.contact === 0 && !c.assign && !c.inbound ? ` · SLA ${sla}` : ''}`;
  }

  /* checkpoints: the control panel saves the whole demo state before each scenario step,
   * so [이전] puts everything back exactly as it was before that step */
  const checkpoints = new Map();
  const ST_KEYS = ['ign', 'ignT', 'bootT', 'backlight', 'bulbCheck', 'sweep', 'engine', 'rpm', 'throttle', 'speed', 'accel', 'gear', 'gearNum', 'mode', 'holdT', 'cruise', 'popup', 'hazard', 'pendingDrive', 'ceremony'];
  function checkpoint(k) {
    const v = {}; ST_KEYS.forEach((x) => { v[x] = st[x]; });
    v.red = [...st.redActive]; v.amber = [...st.amberActive];
    checkpoints.set(k, { st: v, care: director.dumpState() });
  }
  function restore(k) {
    const cp = checkpoints.get(k);
    if (!cp) return false;
    const v = cp.st;
    ST_KEYS.forEach((x) => { st[x] = v[x]; });
    st.redActive = new Set(v.red); st.amberActive = new Set(v.amber);
    st.hazT0 = now(); stoppedSince = 0;
    if (st.ign === 'starting') { st.ign = 'on'; st.engine = true; }
    rescueStop(true);
    if (huLayer && huLayer.cancelHand) huLayer.cancelHand();
    director.loadState(cp.care);
    camTo(st.mode === 'accel' || st.mode === 'cruise' ? 1 : 0, 1.6);
    syncUI();
    return true;
  }
  /* 초기화: everything back to the start, at once — the car stops and switches off */
  /* [다음] while the car is still starting: it is on at once (and drives off if asked) */
  function settle() {
    if (st.ign === 'starting') {
      Object.assign(st, { ign: 'on', engine: true, bulbCheck: false, sweep: -1, ceremony: false });
      if (st.rpm < 480) st.rpm = 650;
      syncUI();
      if (st.pendingDrive) { st.pendingDrive = false; drive(); }
    }
  }
  function fullReset() {
    rescueStop(true);
    if (huLayer && huLayer.cancelHand) huLayer.cancelHand();
    setHazard(false);
    clearWarnings();
    Object.assign(st, { ign: 'off', ignT: 99, bootT: 99, engine: false, rpm: 0, throttle: 0, speed: 0, accel: 0, gear: 'P', gearNum: 1, mode: 'park', cruise: false, popup: null, bulbCheck: false, sweep: -1, pendingDrive: false, ceremony: false, backlight: 0 });
    st.redActive.clear(); st.amberActive.clear();
    audio.stopRepeat();
    director.command('reset', {});
    camHold = 'auto';
    cam.zoomAt = null;
    camTo(0, 1.2);
    syncUI();
  }
  const actions = {
    ign: ignition,
    drive,
    stop,
    toggle: () => (st.mode === 'accel' || st.mode === 'cruise' || st.pendingDrive ? stop() : drive()),
    red: () => warn('red'),
    amber: () => warn('amber'),
    clear: clearWarnings,
    checkpoint: (a) => checkpoint(a && a.k),
    restore: (a) => { if (!restore(a && a.k)) toast('되돌릴 단계 기록이 없습니다'); },
    fullReset,
    settle,
    hazard: (a) => setHazard(a && typeof a.on === 'boolean' ? a.on : !st.hazard),
    mode: cycleMode,
    view: () => {
      cam.zoomAt = null;
      camTo(cam.to > 0.5 ? 0 : 1, 3);
    },
    sound: () => { audio.unlock(); audio.setEnabled(!audio.enabled); syncUI(); },
    engineSound: (a) => {
      const id = a && a.id;
      if (!SimAudio.ENGINES[id]) return;
      audio.setEngine(id);
      try { localStorage.setItem('engine-sound', id); } catch (e) { /* private mode */ }
      const E = SimAudio.ENGINES[id];
      toast(`엔진 사운드 · Lexus ${E.name} (${E.sub})`);
    },
    full: () => {
      const d = document;
      if (!d.fullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
      else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    },
    ui: () => { document.body.classList.toggle('ui-hidden'); computeLayout(); },
    openCcw: () => openScreen('ccw', 'ccw.html'),
    openTranscript: () => openScreen('transcript', 'ccw.html?view=transcript'),
    sla25: () => care('sla25'),
    accept: () => care('accept'),
    dispatch: () => care('dispatch'),
    complete: () => care('complete'),
    careReset: () => care('careReset'),
    inbound: () => care('inbound'),
    noAnswer: () => care('noAnswer'),
    ccwNoise,
  };

  document.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      actions[el.dataset.action]();
      el.blur();
    });
  });

  const KEYS = {
    KeyI: 'ign', Enter: 'ign',
    KeyD: 'drive', ArrowUp: 'drive',
    KeyS: 'stop', ArrowDown: 'stop', Space: 'toggle',
    KeyW: 'red', KeyC: 'amber', KeyX: 'clear', KeyN: 'mode',
    KeyV: 'view', KeyM: 'sound', KeyF: 'full', KeyH: 'ui',
    KeyO: 'openCcw', KeyY: 'openTranscript', KeyT: 'sla25', KeyA: 'accept', KeyE: 'dispatch', KeyK: 'complete', KeyR: 'careReset', KeyG: 'inbound', KeyU: 'noAnswer', KeyL: 'ccwNoise',
  };
  // the presenter's remote (remote.html) drives the vehicle over the link
  Link.on('act', (d) => {
    if (d.name === 'warnItem') {
      // a Case A lamp of the WNG master (e.g. the engine lamp) is an emergency: shown red
      const wng = ECare.WNG[d.args.id];
      const level = (wng && wng.case === 'A') || SimData.RED.some((w) => w.id === d.args.id) ? 'red' : 'amber';
      return warn(level, d.args.id);
    }
    if (actions[d.name]) actions[d.name](d.args);
  });
  // big-screen mode: no control panel, sound on without a click (kiosk Chrome
  // is started with --autoplay-policy=no-user-gesture-required)
  if (new URLSearchParams(location.search).has('stage')) {
    document.body.classList.add('ui-hidden', 'stage');
    computeLayout();
    try { audio.unlock(); } catch (e) { /* needs a gesture outside kiosk mode */ }
    document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  }

  window.addEventListener('keydown', (e) => {
    const act = KEYS[e.code];
    if (!act || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const btn = document.querySelector(`#controls [data-action="${act}"]`);
    if (btn) { btn.classList.add('key'); setTimeout(() => btn.classList.remove('key'), 140); }
    actions[act]();
  });

  function dock() {
    const panel = $('#controls');
    panel.dataset.dock = getComputedStyle(panel).getPropertyValue('--dock').trim() || 'right';
    computeLayout();
  }
  window.addEventListener('resize', dock);
  window.addEventListener('orientationchange', () => setTimeout(dock, 200));
  document.addEventListener('visibilitychange', () => { last = now(); });

  /* ---------------- main loop ---------------- */
  let last = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.25, t - last);
    last = t;

    // fixed small physics steps, so a slow device drives at the same speed
    const steps = Math.ceil(dt / 0.02);
    for (let i = 1; i <= steps; i++) physics(t - dt + dt * i / steps, dt / steps);
    if (cam.zoomAt && t >= cam.zoomAt) {
      cam.zoomAt = null;
      if (st.gear === 'D') camTo(1, 5.5);
    }
    if (cam.outAt && t >= cam.outAt) {
      cam.outAt = null;
      camTo(0, 3.5);
    }
    if (st.popup && t - st.popup.t0 > st.popup.dur) st.popup = null;
    hazardTick(t);

    applyCamera(t, dt);
    rescueTick();
    wheel.render(st.wheel);
    driveTick();
    if (!driveOk) { exterior.update(st, dt); exterior.render(st); }
    ambient.render(st, t);
    ambientCanvas.style.opacity = (0.12 + 0.22 * clamp(st.speed / 30, 0, 1)).toFixed(3);
    startGlow.style.opacity = st.ign === 'off' ? '0' : st.ign === 'starting' ? (0.6 + 0.4 * Math.sin(t * 7)).toFixed(3) : '1';
    cluster.render(st, t, dt);
    audio.update(st, dt);
    updateStatus(dt);
    updateCare(dt);
    requestAnimationFrame(frame);
  }

  function start() {
    dock();
    syncUI();
    document.body.classList.add('ready');
    requestAnimationFrame(frame);
  }

  const imgs = [...document.querySelectorAll('#stage img, #wheelArt, #heroArt')];
  const fonts = document.fonts
    ? Promise.race([
      Promise.all([
        document.fonts.load('300 64px "Barlow"'),
        document.fonts.load('400 25px "Barlow"'),
        document.fonts.load('600 13px "Barlow"'),
        document.fonts.load('600 18px "Noto Sans KR"', '경고'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => {})
    : Promise.resolve();
  Promise.all([
    ...imgs.map((im) => im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; })),
    fonts,
  ]).then(start);
})();
