/* Vehicle state, physics, camera and input — ties all layers together. */
(function () {
  'use strict';

  const IMG_W = 1440, IMG_H = 810;
  const EXT_TOP = -170;                 // invented windshield strip above the photo
  const FULL_TOP = -125;                // the full view shows a little of the road outside
  const WHEEL_PIVOT = [676, 410];
  const CLUSTER_VIEW = { cx: 663, cy: 168, w: 600, h: 470 };
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
    odoMeters: 0, odo: 4236.2, range: 455, fuel: 0.62, outside: 2, coolant: 40,
    redActive: new Set(), amberActive: new Set(), popup: null, clock: '7:17',
    modeTitle: 'MTS', modes: ['DEEP SNOW', 'MUD', 'SAND', 'DIRT', 'AUTO'], modeIndex: 0,
    wheel: 0, yawErr: 0, laneOffset: 0, pitch: 0, bump: 0, pendingDrive: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage');
  const wheelRig = $('#wheelRig');
  const focusShade = $('#focusShade');
  const startGlow = $('#startGlow');
  const ambientCanvas = $('#ambient');
  const extCanvas = $('#exterior');
  const cluster = new Cluster($('#cluster'));
  const ambient = new Ambient(ambientCanvas);
  const exterior = new Exterior(extCanvas);
  const audio = new SimAudio();

  const cr = Cluster.rect;
  Object.assign($('#cluster').style, { left: cr.x + 'px', top: cr.y + 'px', width: cr.w + 'px', height: cr.h + 'px' });
  const eb = Exterior.box;
  Object.assign(extCanvas.style, { left: '0px', top: eb.top + 'px', width: eb.width + 'px', height: eb.height + 'px' });
  wheelRig.style.transformOrigin = `${WHEEL_PIVOT[0]}px ${WHEEL_PIVOT[1]}px`;

  /* ---------------- camera ---------------- */
  const now = () => performance.now() / 1000;
  const cam = { z: 0, from: 0, to: 0, t0: 0, dur: 0, zoomAt: null, outAt: null };
  function camTo(target, dur) {
    cam.from = cam.z; cam.to = target; cam.t0 = now(); cam.dur = dur;
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
    const sFull = Math.min(cover, contain * 1.3) * 1.04;
    const halfH = (docked === 'bottom' ? ah : vh) / 2 / sFull;
    const cyFull = Math.min(FULL_TOP + halfH, IMG_H - halfH, (FULL_TOP + IMG_H) / 2);
    const fit = Math.min(aw / CLUSTER_VIEW.w, ah / CLUSTER_VIEW.h);
    const sZoom = Math.max(fit, Math.min(sFull * 1.35, aw / 560));
    layout = {
      full: { s: sFull, cx: IMG_W / 2, cy: cyFull, vx: vw / 2, vy: docked === 'bottom' ? ah / 2 : vh / 2 },
      zoom: { s: sZoom, cx: CLUSTER_VIEW.cx, cy: CLUSTER_VIEW.cy, vx: (area.x0 + area.x1) / 2, vy: (area.y0 + area.y1) / 2 },
    };
  }

  let resT = 0;
  function applyCamera(t, dt) {
    if (cam.dur > 0) {
      const p = clamp((t - cam.t0) / cam.dur, 0, 1);
      cam.z = cam.from + (cam.to - cam.from) * ease(p);
      if (p >= 1) cam.dur = 0;
    }
    const z = cam.z, L = layout;
    const s = Math.exp(Math.log(L.full.s) + (Math.log(L.zoom.s) - Math.log(L.full.s)) * z);
    const k = (s - L.full.s) / (L.zoom.s - L.full.s || 1);
    const cx = L.full.cx + (L.zoom.cx - L.full.cx) * k;
    const cy = L.full.cy + (L.zoom.cy - L.full.cy) * k;
    const vx = L.full.vx + (L.zoom.vx - L.full.vx) * k;
    const vy = L.full.vy + (L.zoom.vy - L.full.vy) * k;
    // body vibration from the road; a touch of engine shake at idle
    const vf = clamp(st.speed / 100, 0, 1.2);
    const idle = st.engine && st.speed < 1 ? 0.12 : 0;
    const shakeX = (Math.sin(t * 31.7) * 0.5 + Math.sin(t * 17.3) * 0.5) * (0.35 * vf + idle);
    const shakeY = (Math.sin(t * 23.1) * 0.6 + Math.sin(t * 41.9) * 0.4) * (0.45 * vf + idle) + Math.sin(t * 1.7) * 0.6 * vf;
    // never reveal the edge of the photo when it is large enough to fill the view
    const vw = window.innerWidth, vh = window.innerHeight;
    let tx = vx - cx * s, ty = vy - cy * s;
    if (IMG_W * s >= vw) tx = clamp(tx, vw - IMG_W * s, 0);
    if ((IMG_H - EXT_TOP) * s >= vh) ty = clamp(ty, vh - IMG_H * s, -EXT_TOP * s);
    stage.style.transform = `translate3d(${(tx + shakeX).toFixed(2)}px, ${(ty + shakeY).toFixed(2)}px, 0) scale(${s.toFixed(5)})`;

    const wheelA = 1 - smooth(0.1, 0.72, z);
    wheelRig.style.opacity = wheelA.toFixed(3);
    wheelRig.style.visibility = z > 0.75 ? 'hidden' : 'visible';
    focusShade.style.opacity = smooth(0.25, 1, z).toFixed(3);

    const dpr = window.devicePixelRatio || 1;
    const want = clamp(Math.ceil(s * Cluster.rect.w / Cluster.designWidth * dpr * 4) / 4, 0.5, 3.2);
    resT += dt;
    if (want !== cluster.scale && (resT > 0.25 || want > cluster.scale + 0.5)) {
      cluster.setScale(want);
      resT = 0;
    }
  }

  /* ---------------- vehicle ---------------- */
  function toast(msg, ms) {
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
      st.bulbCheck = true;
      audio.click();
      audio.welcome();
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
    if (st.mode === 'accel' || st.mode === 'cruise') {
      st.mode = 'brake';
      st.cruise = false;
      cam.zoomAt = null;
    } else if (st.pendingDrive) {
      st.pendingDrive = false;
    }
    syncUI();
  }

  function warn(level) {
    audio.unlock();
    if (st.ign !== 'on') {
      toast(st.ign === 'off' ? '시동을 켠 후 경고등이 표시됩니다' : '계기판 점검 중입니다');
      return;
    }
    const list = level === 'red' ? SimData.RED : SimData.AMBER;
    const set = level === 'red' ? st.redActive : st.amberActive;
    const item = list.find((w) => !set.has(w.id));
    if (!item) {
      toast(level === 'red' ? '모든 경고등이 이미 점등되어 있습니다' : '모든 주의등이 이미 점등되어 있습니다');
      return;
    }
    set.add(item.id);
    st.popup = { level, item, t0: now(), dur: 5.5 };
    audio.chime(level, item.id);
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
      st.bulbCheck = k > 0.15 && k < 2.5;
      st.sweep = k < 0.5 ? 0 : k < 1.3 ? ease((k - 0.5) / 0.8) : k < 2.1 ? 1 - ease((k - 1.3) / 0.8) : -1;
      if (k > 0.8 && k < 1.75) st.rpm = 190 + Math.sin(k * 62) * 40;
      if (k >= 1.75 && !st.engine) { st.engine = true; st.rpm = 480; }
      if (k >= 2.6) {
        st.ign = 'on';
        st.bulbCheck = false;
        st.sweep = -1;
        syncUI();
        if (st.pendingDrive) { st.pendingDrive = false; drive(); }
      }
    } else if (st.ign === 'off') {
      st.backlight = st.ignT > 50 ? 0 : 1 - smooth(0.15, 1.0, st.ignT);
    } else {
      st.backlight = 1;
    }

    // longitudinal dynamics
    let vm = st.speed / 3.6, a = 0, thr = 0;
    if (st.shiftT > 0) st.shiftT -= dt;
    if (st.mode === 'accel') {
      const r = st.speed / st.setSpeed;
      a = Math.max(0.35, 3.9 * (1 - Math.pow(r, 3)));
      if (st.shiftT > 0) a *= 0.55;
      thr = 0.3 + 0.55 * (1 - r * r);
      if (st.speed >= st.setSpeed - 0.6) { st.mode = 'cruise'; st.cruise = true; syncUI(); }
    } else if (st.mode === 'cruise') {
      const target = st.setSpeed + 0.9 * Math.sin(t * 0.31) + 0.45 * Math.sin(t * 0.97 + 1);
      a = clamp((target - st.speed) / 3.6 * 0.8, -1, 1);
      thr = clamp(0.18 + a * 0.25, 0.04, 0.6);
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
    const roadAngle = Math.atan(2.85 * Road.curvature(st.odoMeters)) * 16 / DEG;
    const corr = 0.3 * Math.sin(t * 0.55) + 0.15 * Math.sin(t * 1.37 + 0.7) + 0.06 * Math.sin(t * 3.1 + 2)
      + vf * (0.55 * Math.sin(t * 0.29 + 1.1) + 0.3 * Math.sin(t * 0.71) + 0.15 * Math.sin(t * 2.3 + 0.4));
    st.wheelRoad = follow(st.wheelRoad || 0, roadAngle, 0.35, dt);
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
      `<span class="mode">${st.ign === 'off' ? '시동 꺼짐' : mode}</span>`;
    const d = new Date();
    st.clock = `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
  }

  const actions = {
    ign: ignition,
    drive,
    stop,
    red: () => warn('red'),
    amber: () => warn('amber'),
    clear: clearWarnings,
    mode: cycleMode,
    view: () => {
      cam.zoomAt = null;
      camTo(cam.to > 0.5 ? 0 : 1, 3);
    },
    sound: () => { audio.unlock(); audio.setEnabled(!audio.enabled); syncUI(); },
    full: () => {
      const d = document;
      if (!d.fullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
      else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    },
    ui: () => { document.body.classList.toggle('ui-hidden'); computeLayout(); },
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
    KeyS: 'stop', ArrowDown: 'stop', Space: 'stop',
    KeyW: 'red', KeyC: 'amber', KeyX: 'clear', KeyN: 'mode',
    KeyV: 'view', KeyM: 'sound', KeyF: 'full', KeyH: 'ui',
  };
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
    const dt = Math.min(0.05, t - last);
    last = t;

    physics(t, dt);
    if (cam.zoomAt && t >= cam.zoomAt) {
      cam.zoomAt = null;
      if (st.gear === 'D') camTo(1, 5.5);
    }
    if (cam.outAt && t >= cam.outAt) {
      cam.outAt = null;
      camTo(0, 3.5);
    }
    if (st.popup && t - st.popup.t0 > st.popup.dur) st.popup = null;

    applyCamera(t, dt);
    wheelRig.style.transform = `rotate(${st.wheel.toFixed(3)}deg)`;
    exterior.update(st, dt);
    exterior.render(st);
    ambient.render(st, t);
    ambientCanvas.style.opacity = (0.12 + 0.22 * clamp(st.speed / 30, 0, 1)).toFixed(3);
    startGlow.style.opacity = st.ign === 'off' ? '0' : st.ign === 'starting' ? String(0.5 + 0.5 * Math.sin(t * 12)) : '1';
    cluster.render(st, t, dt);
    audio.update(st, dt);
    updateStatus(dt);
    requestAnimationFrame(frame);
  }

  function start() {
    dock();
    syncUI();
    document.body.classList.add('ready');
    requestAnimationFrame(frame);
  }

  const imgs = [...document.querySelectorAll('#stage img')];
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
