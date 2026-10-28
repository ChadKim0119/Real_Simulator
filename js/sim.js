/* Vehicle state, physics, camera and input — ties all layers together. */
(function () {
  'use strict';

  const IMG_W = 1712, IMG_H = 1152;
  const WHEEL_PIVOT = [867, 900];
  const FULL_VIEW = { cx: 856 };
  const CLUSTER_VIEW = { cx: 866, cy: 368, w: 1150, h: 520 };
  const GEAR_FACTOR = [0, 128, 80, 55, 41, 32.5, 26, 21, 17.4]; // rpm per km/h

  const SimData = {
    RED: [
      { id: 'brake', title: '브레이크 시스템 경고', desc: '즉시 안전한 곳에 정차하십시오', blink: true },
      { id: 'oil', title: '엔진 오일 압력 낮음', desc: '엔진을 정지하고 오일을 점검하십시오', blink: true },
      { id: 'battery', title: '충전 시스템 이상', desc: '배터리 및 발전기를 점검하십시오' },
      { id: 'coolant', title: '엔진 과열', desc: '정차 후 냉각수를 점검하십시오', blink: true },
      { id: 'seatbelt', title: '안전벨트 미착용', desc: '안전벨트를 착용하십시오', blink: true },
      { id: 'airbag', title: '에어백 시스템 이상', desc: '서비스 센터에서 점검받으십시오' },
    ],
    AMBER: [
      { id: 'engine', title: '엔진 점검', desc: '가까운 서비스 센터를 방문하십시오' },
      { id: 'tpms', title: '타이어 공기압 낮음', desc: '타이어 공기압을 점검하십시오' },
      { id: 'fuel', title: '연료 부족', desc: '가까운 주유소를 이용하십시오' },
      { id: 'abs', title: 'ABS 시스템 점검', desc: '제동 시 주의하십시오' },
      { id: 'esp', title: '차체 자세 제어 장치 점검', desc: '미끄러운 노면에 주의하십시오' },
      { id: 'washer', title: '워셔액 부족', desc: '워셔액을 보충하십시오' },
    ],
  };
  window.SimData = SimData;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const follow = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
  const pad = (n) => String(n).padStart(2, '0');

  const st = {
    ign: 'off', ignT: 99, backlight: 0, bulbCheck: false, sweep: -1,
    engine: false, rpm: 0, throttle: 0,
    speed: 0, speedNeedle: 0, accel: 0, gear: 'P', gearNum: 1, shiftT: 0,
    mode: 'park', holdT: 0, cruise: false, setSpeed: 100, limit: 100,
    odoMeters: 0, odo: 17750.4, trip: 0, range: 670, fuel: 0.52, outside: 21,
    redActive: new Set(), amberActive: new Set(), popup: null, clock: '10:42',
    wheel: 0, yaw: 0, heading: 0, lateral: 0, pitch: 0, bump: 0,
    pendingDrive: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage');
  const wheelRig = $('#wheelRig');
  const spill = $('#spill');
  const extCanvas = $('#exterior');
  const cluster = new Cluster($('#cluster'));
  const exterior = new Exterior(extCanvas);
  const audio = new SimAudio();

  // place layers in stage coordinates
  const cr = Cluster.rect;
  Object.assign($('#cluster').style, { left: cr.x + 'px', top: cr.y + 'px', width: cr.w + 'px', height: cr.h + 'px' });
  const eb = Exterior.box;
  Object.assign(extCanvas.style, { left: '0px', top: eb.top + 'px', width: eb.width + 'px', height: eb.height + 'px' });
  wheelRig.style.transformOrigin = `${WHEEL_PIVOT[0]}px ${WHEEL_PIVOT[1]}px`;

  /* ---------------- camera ---------------- */
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
    let area = { x0: 0, y0: 0, x1: vw, y1: vh };
    if (docked === 'right') area.x1 = Math.max(vw * 0.5, pr.left - 12);
    if (docked === 'bottom') area.y1 = Math.max(vh * 0.45, pr.top - 8);
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
    const contain = Math.min(vw / IMG_W, ah / IMG_H);
    const cover = Math.max(vw / IMG_W, vh / IMG_H);
    const sFull = Math.min(cover, contain * 1.3);
    const halfH = (docked === 'bottom' ? ah : vh) / 2 / sFull;
    const cyFull = halfH >= IMG_H / 2 ? IMG_H / 2 : halfH + 0.35 * (IMG_H - 2 * halfH);
    const fit = Math.min(aw / CLUSTER_VIEW.w, ah / CLUSTER_VIEW.h);
    const sZoom = Math.max(fit, Math.min(sFull * 1.35, aw / 1100));
    layout = {
      vw, vh, area,
      full: { s: sFull, cx: FULL_VIEW.cx, cy: cyFull, vx: vw / 2, vy: docked === 'bottom' ? ah / 2 : vh / 2 },
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
    // tiny camera vibration from the road while moving
    const vf = clamp(st.speed / 100, 0, 1.2);
    const shakeX = (Math.sin(t * 31.7) * 0.5 + Math.sin(t * 17.3) * 0.5) * 0.35 * vf;
    const shakeY = (Math.sin(t * 23.1) * 0.6 + Math.sin(t * 41.9) * 0.4) * 0.45 * vf + Math.sin(t * 1.7) * 0.6 * vf;
    stage.style.transform = `translate3d(${(vx - cx * s + shakeX).toFixed(2)}px, ${(vy - cy * s + shakeY).toFixed(2)}px, 0) scale(${s.toFixed(5)})`;

    wheelRig.style.opacity = (1 - smooth(0.1, 0.72, z)).toFixed(3);
    wheelRig.style.visibility = z > 0.75 ? 'hidden' : 'visible';

    // keep the cluster crisp at any zoom (bounded for performance)
    const dpr = window.devicePixelRatio || 1;
    let want = clamp(Math.ceil(s * dpr * 4) / 4, 0.75, 3);
    resT += dt;
    if (want !== cluster.scale && (resT > 0.25 || want > cluster.scale + 0.5)) {
      cluster.setScale(want);
      resT = 0;
    }
  }

  /* ---------------- vehicle ---------------- */
  const now = () => performance.now() / 1000;

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
      st.bulbCheck = true;
      audio.click();
      setTimeout(() => audio.crank(0.85), 600);
    } else if (st.ign === 'starting') {
      return;
    } else {
      if (st.speed > 0.5) {
        toast('주행 중에는 시동을 끌 수 없습니다. 먼저 정지하십시오.');
        return;
      }
      audio.click();
      st.ign = 'off';
      st.ignT = 0;
      st.engine = false;
      st.gear = 'P';
      st.mode = 'park';
      st.cruise = false;
      st.popup = null;
      st.bulbCheck = false;
      st.sweep = -1;
      st.pendingDrive = false;
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
      toast('먼저 시동을 켜 주십시오  ·  시동 버튼 또는 I 키');
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
    audio.chime(level);
    syncUI();
  }

  function clearWarnings() {
    st.redActive.clear();
    st.amberActive.clear();
    st.popup = null;
    syncUI();
  }

  function physics(t, dt) {
    // ignition / boot sequence
    st.ignT += dt;
    if (st.ign === 'starting') {
      const k = st.ignT;
      st.backlight = smooth(0, 0.6, k);
      st.sweep = k < 0.35 ? 0 : k < 1.15 ? ease((k - 0.35) / 0.8) : k < 1.95 ? 1 - ease((k - 1.15) / 0.8) : -1;
      if (k > 0.6 && k < 1.45) st.rpm = 200 + Math.sin(k * 80) * 35;
      if (k >= 1.45 && !st.engine) { st.engine = true; st.rpm = 520; }
      if (k >= 2.4) {
        st.ign = 'on';
        st.bulbCheck = false;
        st.sweep = -1;
        syncUI();
        if (st.pendingDrive) { st.pendingDrive = false; drive(); }
      }
    } else if (st.ign === 'off') {
      st.backlight = 1 - smooth(0.3, 1.5, st.ignT) * 1;
      if (st.ignT > 1.5) st.backlight = 0;
    } else {
      st.backlight = 1;
    }

    // longitudinal dynamics
    let vm = st.speed / 3.6, a = 0, thr = 0;
    if (st.shiftT > 0) st.shiftT -= dt;
    if (st.mode === 'accel') {
      const r = st.speed / st.setSpeed;
      a = Math.max(0.35, 3.7 * (1 - Math.pow(r, 3)));
      if (st.shiftT > 0) a *= 0.45;
      thr = 0.25 + 0.6 * (1 - r * r);
      if (st.speed >= st.setSpeed - 0.6) { st.mode = 'cruise'; st.cruise = true; syncUI(); }
    } else if (st.mode === 'cruise') {
      const target = st.setSpeed + 0.9 * Math.sin(t * 0.31) + 0.45 * Math.sin(t * 0.97 + 1);
      a = clamp((target - st.speed) / 3.6 * 0.8, -1, 1);
      thr = clamp(0.2 + a * 0.25, 0.05, 0.6);
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
        cam.outAt = now() + 0.6;
        syncUI();
      }
    }
    if (st.mode !== 'hold' && st.mode !== 'park') vm = Math.max(0, vm + a * dt);
    st.speed = vm * 3.6;
    st.accel = follow(st.accel, a, 0.35, dt);
    st.throttle = follow(st.throttle, thr, 0.25, dt);
    st.speedNeedle = follow(st.speedNeedle, st.speed, 0.12, dt);

    // automatic gearbox
    if (st.gear === 'D' && st.shiftT <= 0) {
      const f = GEAR_FACTOR[st.gearNum];
      const up = st.mode === 'accel' ? 2300 + st.throttle * 900 : 1700;
      if (st.gearNum < 8 && st.speed > 3 && st.speed * f > up && st.mode !== 'brake') {
        st.gearNum++; st.shiftT = 0.35;
      } else if (st.gearNum > 1 && st.speed * f < (st.mode === 'brake' ? 1000 : 1150)) {
        st.gearNum--; st.shiftT = 0.25;
      }
    }
    if (st.speed < 2 && st.gearNum > 1) st.gearNum = 1;

    // engine speed
    if (st.engine) {
      let target = 760;
      if (st.gear === 'D' && (st.speed > 0.3 || st.throttle > 0.02)) {
        target = Math.max(760, st.speed * GEAR_FACTOR[st.gearNum]);
        if (st.gearNum === 1 && st.throttle > 0.05) target = Math.max(target, 1050 + st.throttle * 1500 * clamp(1 - st.speed / 24, 0, 1));
        target += st.throttle * 160;
      } else if (st.gear === 'D') {
        target = 700;
      }
      target += Math.sin(t * 7.3) * 7 + Math.sin(t * 13.1) * 5;
      if (st.ign !== 'starting' || st.ignT > 1.45) {
        const flare = st.ign === 'starting' ? 1250 : target;
        st.rpm = follow(st.rpm, flare, st.shiftT > 0 ? 0.16 : 0.12, dt);
      }
    } else if (st.ign !== 'starting' || st.ignT < 0.6) {
      st.rpm = follow(st.rpm, 0, 0.3, dt);
      if (st.rpm < 5) st.rpm = 0;
    }

    // distance, fuel
    const dm = vm * dt;
    st.odoMeters += dm;
    st.odo += dm / 1000;
    st.trip += dm / 1000;
    st.range = Math.max(0, st.range - dm / 1000);
    st.fuel = Math.max(0, st.fuel - dm / 1000 * 0.0009);

    // steering wheel: always a little alive, more corrections at speed
    const vf = clamp(st.speed / 60, 0, 1);
    st.wheel = 0.32 * Math.sin(t * 0.55) + 0.16 * Math.sin(t * 1.37 + 0.7) + 0.06 * Math.sin(t * 3.1 + 2)
      + vf * (1.0 * Math.sin(t * 0.29 + 1.1) + 0.55 * Math.sin(t * 0.71) + 0.22 * Math.sin(t * 2.3 + 0.4));
    st.yaw = follow(st.yaw, st.wheel * 0.0016 * vf, 0.6, dt);
    st.heading += st.yaw * dt * 0.4;
    st.heading *= 0.999;
    st.lateral = vf * (0.28 * Math.sin(t * 0.23 + 0.5) + 0.12 * Math.sin(t * 0.61));
    st.pitch = follow(st.pitch, st.accel * 0.32, 0.45, dt);
    st.bump = vf * (Math.sin(t * 19.3) * 0.35 + Math.sin(t * 7.9 + 1) * 0.5 + (Math.random() - 0.5) * 0.4);
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
    st.clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const actions = {
    ign: ignition,
    drive,
    stop,
    red: () => warn('red'),
    amber: () => warn('amber'),
    clear: clearWarnings,
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
    KeyW: 'red', KeyC: 'amber', KeyX: 'clear',
    KeyV: 'view', KeyM: 'sound', KeyF: 'full', KeyH: 'ui',
  };
  window.addEventListener('keydown', (e) => {
    const act = KEYS[e.code];
    if (!act || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const btn = document.querySelector(`[data-action="${act}"]`);
    if (btn) { btn.classList.add('key'); setTimeout(() => btn.classList.remove('key'), 140); }
    actions[act]();
  });

  // dock position of the control panel follows the CSS media queries
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

    exterior.update(st, dt);
    exterior.render(st);
    applyCamera(t, dt);
    wheelRig.style.transform = `rotate(${st.wheel.toFixed(3)}deg)`;
    spill.style.opacity = (st.backlight * 0.85).toFixed(3);
    cluster.render(st, t);
    audio.update(st);
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
        document.fonts.load('italic 400 22px "Barlow"'),
        document.fonts.load('italic 300 52px "Barlow"'),
        document.fonts.load('500 17px "Barlow"'),
        document.fonts.load('600 19px "Noto Sans KR"', '경고'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => {})
    : Promise.resolve();
  Promise.all([
    ...imgs.map((im) => im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; })),
    fonts,
  ]).then(() => {
    cluster.buildFace();
    start();
  });
  if (document.fonts) document.fonts.ready.then(() => cluster.buildFace());
})();
