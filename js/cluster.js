/* Lexus GX-style 12.3" digital cluster renderer.
 *
 * Design coordinates are the pixel coordinates of the close-up reference photo
 * (assets/gx_cluster.jpg); the display occupies x 245..1150, y 118..455 there.
 * The canvas is placed over the black glass of the wide interior photo.
 */
(function () {
  'use strict';

  const X0 = 245, Y0 = 118, CW = 905, CH = 337;
  const PLACE = { x: 405, y: 95, k: 0.567 };   // display position in the interior photo
  const DEG = Math.PI / 180;
  const FONT = '"Barlow", "Helvetica Neue", Arial, sans-serif';
  const KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const TACH = { cx: 490, cy: 305, r: 192, a0: 148, a1: 218, max: 8000, red: 6000 };
  const MODE_ARC = { cx: 900, cy: 305, r: 192, a0: -40, a1: 32 };
  const MODE_Y = [253, 274, 295, 316, 337];

  const RED_X = [352, 386, 420, 454, 488, 522];
  const AMBER_X = [868, 902, 936, 970, 1004, 1038];
  const LAMP_Y = 141;
  const RED = '#ff3527', RED_GLOW = 'rgba(255,50,30,0.9)';
  const AMBER = '#ffb21e', AMBER_GLOW = 'rgba(255,165,20,0.85)';
  const GREEN = '#3ee07a', GREEN_GLOW = 'rgba(60,230,120,0.7)';

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  class Cluster {
    constructor(canvas, wallpaper) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wall = wallpaper;
      this.scale = 0;
      this.flakes = [];
      for (let i = 0; i < 70; i++) this.flakes.push(this.newFlake(true));
      this.puffs = [];
      this.emit = 0;
      this.setScale(1);
    }

    static get rect() { return { x: PLACE.x, y: PLACE.y, w: CW * PLACE.k, h: CH * PLACE.k }; }
    static get designWidth() { return CW; }

    setScale(s) {
      if (Math.abs(s - this.scale) < 0.01) return;
      this.scale = s;
      this.canvas.width = Math.round(CW * s);
      this.canvas.height = Math.round(CH * s);
    }

    glow(px) { return px * this.scale; }

    newFlake(anywhere) {
      return {
        x: X0 + Math.random() * CW,
        y: anywhere ? Y0 + Math.random() * CH : Y0 - 10,
        z: 0.3 + Math.random() * 0.7,
        ph: Math.random() * 10,
      };
    }

    /* ---------- animated layers on top of the photographic backdrop ---------- */
    updateFx(st, dt, t) {
      const vf = clamp(st.speed / 100, 0, 1.3);
      const vpx = 780, vpy = 270;
      for (const f of this.flakes) {
        f.y += (8 + 14 * f.z) * dt;
        f.x += Math.sin(t * 0.6 + f.ph) * 4 * dt;
        // when moving the snow streams outward from the vanishing point
        f.x += (f.x - vpx) * vf * 1.6 * f.z * dt;
        f.y += (f.y - vpy) * vf * 1.2 * f.z * dt;
        if (f.y > Y0 + CH + 10 || f.x < X0 - 10 || f.x > X0 + CW + 10 || f.y < Y0 - 20) {
          Object.assign(f, this.newFlake(vf < 0.05));
          if (vf >= 0.05) {
            f.x = vpx + (Math.random() - 0.5) * 200;
            f.y = vpy + (Math.random() - 0.5) * 90;
          }
        }
      }
      // snow spray kicked up by the tyres
      this.emit += dt * st.speed * 0.28;
      while (this.emit > 1) {
        this.emit -= 1;
        for (const [wx, wy] of [[878, 362], [628, 380]]) {
          this.puffs.push({ x: wx + Math.random() * 14, y: wy + Math.random() * 8, vx: -(40 + Math.random() * 70) * (0.5 + vf), vy: -(8 + Math.random() * 22), r: 6 + Math.random() * 8, age: 0, life: 0.9 + Math.random() * 0.8 });
        }
      }
      for (const p of this.puffs) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 6 * dt;
        p.r += 26 * dt;
      }
      this.puffs = this.puffs.filter((p) => p.age < p.life);
      if (this.puffs.length > 140) this.puffs.splice(0, this.puffs.length - 140);
    }

    drawBackdrop(ctx, st, t, a) {
      if (!this.wall.complete || !this.wall.naturalWidth) return;
      const vf = clamp(st.speed / 100, 0, 1.3);
      const zoom = 1 + (1 - a) * 0.06 + vf * 0.012;
      const jx = (Math.sin(t * 17.3) + Math.sin(t * 7.1)) * 0.35 * vf;
      const jy = (Math.sin(t * 13.7) + Math.sin(t * 23.9)) * 0.3 * vf;
      const cx = 700, cy = 300;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(cx + jx, cy + jy);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
      ctx.drawImage(this.wall, X0, Y0, CW, CH);
      ctx.restore();

      // spray and snowfall
      ctx.save();
      ctx.globalAlpha *= a;
      for (const p of this.puffs) {
        const k = 1 - p.age / p.life;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(230,238,250,${0.32 * k})`);
        g.addColorStop(1, 'rgba(230,238,250,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      for (const f of this.flakes) {
        const r = 0.6 + f.z * 1.6 + vf * f.z * 1.2;
        ctx.fillStyle = `rgba(225,235,255,${0.25 + f.z * 0.45})`;
        if (vf > 0.15) {
          const dx = (f.x - 780) * 0.02 * vf * f.z, dy = (f.y - 270) * 0.02 * vf * f.z;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = r;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(f.x - dx * 3, f.y - dy * 3);
          ctx.lineTo(f.x, f.y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    shade(ctx) {
      let g = ctx.createLinearGradient(X0, 0, X0 + 210, 0);
      g.addColorStop(0, 'rgba(2,5,12,0.86)');
      g.addColorStop(1, 'rgba(2,5,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, Y0, 210, CH);
      g = ctx.createLinearGradient(885, 0, 960, 0);
      g.addColorStop(0, 'rgba(2,5,12,0)');
      g.addColorStop(1, 'rgba(2,5,12,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(885, Y0, X0 + CW - 885, CH);
      g = ctx.createLinearGradient(0, Y0, 0, Y0 + 110);
      g.addColorStop(0, 'rgba(1,3,9,0.7)');
      g.addColorStop(1, 'rgba(1,3,9,0)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, Y0, CW, 110);
      g = ctx.createLinearGradient(0, 372, 0, Y0 + CH);
      g.addColorStop(0, 'rgba(1,3,9,0)');
      g.addColorStop(1, 'rgba(1,3,9,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, 372, CW, Y0 + CH - 372);
    }

    text(ctx, s, x, y, size, color, opt) {
      opt = opt || {};
      ctx.font = `${opt.weight || 400} ${size}px ${opt.kr ? KR : FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = opt.align || 'center';
      ctx.textBaseline = 'middle';
      if (opt.glow) {
        ctx.save();
        ctx.shadowColor = opt.glow;
        ctx.shadowBlur = this.glow(6);
        ctx.fillText(s, x, y);
        ctx.restore();
      } else ctx.fillText(s, x, y);
    }

    arcPt(g, deg, r) {
      return [g.cx + Math.cos(deg * DEG) * (r || g.r), g.cy + Math.sin(deg * DEG) * (r || g.r)];
    }

    drawTach(ctx, rpm) {
      const g = TACH;
      const ang = (v) => g.a0 + (g.a1 - g.a0) * clamp(v / g.max, 0, 1);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(210,222,240,0.35)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r + 3, ang(g.red) * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(235,45,45,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let v = 0; v <= g.max; v += 500) {
        const major = v % 1000 === 0;
        const [x0, y0] = this.arcPt(g, ang(v), g.r - 3);
        const [x1, y1] = this.arcPt(g, ang(v), g.r - (major ? 11 : 7));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = v >= g.red ? '#ff4b45' : major ? 'rgba(235,242,255,0.85)' : 'rgba(235,242,255,0.45)';
        ctx.lineWidth = major ? 1.8 : 1.1;
        ctx.stroke();
        if (major) {
          const [lx, ly] = this.arcPt(g, ang(v), g.r - 22);
          this.text(ctx, String(v / 1000), lx, ly, 12.5, v >= g.red ? '#ff6159' : 'rgba(225,233,245,0.85)');
        }
      }
      // live bar
      const a = ang(rpm);
      if (rpm > 20) {
        const grd = ctx.createLinearGradient(...this.arcPt(g, g.a0), ...this.arcPt(g, g.a1));
        grd.addColorStop(0, 'rgba(70,150,255,0.95)');
        grd.addColorStop(1, 'rgba(210,235,255,1)');
        ctx.shadowColor = 'rgba(80,160,255,0.9)';
        ctx.shadowBlur = this.glow(8);
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, a * DEG);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 4.2;
        ctx.stroke();
        const [px, py] = this.arcPt(g, a);
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
      const [tx, ty] = this.arcPt(g, g.a1, g.r - 2);
      this.text(ctx, 'x1000 r/min', tx + 30, ty - 6, 10, 'rgba(200,210,225,0.7)', { align: 'left' });
    }

    drawModes(ctx, st) {
      const g = MODE_ARC;
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(210,222,240,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const sel = st.modeIndex;
      const y = MODE_Y[sel];
      const deg = Math.asin(clamp((y - g.cy) / g.r, -1, 1)) / DEG;
      ctx.shadowColor = 'rgba(90,170,255,0.95)';
      ctx.shadowBlur = this.glow(8);
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, (deg - 4.5) * DEG, (deg + 4.5) * DEG);
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const [ax] = this.arcPt(g, deg);
      const bar = ctx.createLinearGradient(943, 0, ax, 0);
      bar.addColorStop(0, 'rgba(70,140,255,0.5)');
      bar.addColorStop(1, 'rgba(70,140,255,0.08)');
      ctx.fillStyle = bar;
      ctx.fillRect(943, y - 10, ax - 943, 20);
      ctx.fillStyle = 'rgba(160,205,255,0.85)';
      ctx.fillRect(943, y + 10, ax - 943, 1.2);
      ctx.restore();
      this.text(ctx, st.modeTitle, 1012, 222, 15, '#e9eef6', { weight: 500 });
      st.modes.forEach((m, i) => {
        this.text(ctx, m, 948, MODE_Y[i], 13.5, i === sel ? '#ffffff' : 'rgba(215,224,238,0.72)', { align: 'left', weight: i === sel ? 600 : 400 });
      });
    }

    bar(ctx, x0, x1, y, frac, warn) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(200,212,230,0.35)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = warn ? AMBER : '#f2f6fb';
      ctx.shadowColor = warn ? AMBER_GLOW : 'rgba(200,225,255,0.6)';
      ctx.shadowBlur = this.glow(4);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + (x1 - x0) * clamp(frac, 0.02, 1), y);
      ctx.stroke();
      ctx.restore();
      const mid = (x0 + x1) / 2;
      ctx.fillStyle = 'rgba(220,228,240,0.6)';
      ctx.fillRect(mid - 0.5, y - 5, 1, 4);
    }

    lamps(ctx, st, t) {
      const all = st.bulbCheck;
      const blink = Math.sin(t * Math.PI * 2 * 1.5) > -0.3;
      SimData.RED.forEach((w, i) => {
        if (all || (st.redActive.has(w.id) && (!w.blink || blink))) {
          SimIcons.drawIcon(ctx, w.id, RED_X[i], LAMP_Y, 24, RED, RED_GLOW);
        }
      });
      SimData.AMBER.forEach((w, i) => {
        if (all || st.amberActive.has(w.id)) SimIcons.drawIcon(ctx, w.id, AMBER_X[i], LAMP_Y, 24, AMBER, AMBER_GLOW);
      });
      if (all || st.cruise) SimIcons.drawIcon(ctx, 'acc', 266, 262, 24, GREEN, GREEN_GLOW);
      if (all || st.cruise) SimIcons.drawIcon(ctx, 'cruise', 266, 296, 22, GREEN, GREEN_GLOW);
    }

    popup(ctx, st, t) {
      const p = st.popup;
      if (!p) return;
      const age = t - p.t0;
      const a = age < 0.25 ? age / 0.25 : age > p.dur - 0.5 ? Math.max(0, (p.dur - age) / 0.5) : 1;
      if (a <= 0) return;
      const red = p.level === 'red';
      const col = red ? RED : AMBER;
      const x = 505, y = 248, w = 380, h = 104;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(0, (1 - ease(age / 0.3)) * 8);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fillStyle = 'rgba(6,9,16,0.9)';
      ctx.fill();
      ctx.strokeStyle = red ? 'rgba(255,70,55,0.75)' : 'rgba(255,180,40,0.75)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 12, 2.4, h - 24);
      const pulse = red ? 0.7 + 0.3 * Math.sin(age * Math.PI * 2 * 1.5) : 1;
      ctx.globalAlpha *= pulse;
      SimIcons.drawIcon(ctx, p.item.id, x + 52, y + h / 2, 46, col, red ? RED_GLOW : AMBER_GLOW);
      ctx.globalAlpha /= pulse;
      this.text(ctx, p.item.title, x + 98, y + 36, 18, '#ffffff', { kr: true, weight: 600, align: 'left' });
      this.text(ctx, p.item.desc, x + 98, y + 62, 12.5, 'rgba(210,218,230,0.9)', { kr: true, align: 'left' });
      this.text(ctx, red ? '경고' : '주의', x + 98, y + 84, 11, col, { kr: true, weight: 600, align: 'left' });
      ctx.restore();
    }

    welcome(ctx, k) {
      if (k > 1.4) return;
      const a = 1 - smooth(0.7, 1.4, k);
      const w = CW * ease(k / 0.55);
      const cx = X0 + CW / 2, cy = 300;
      ctx.save();
      ctx.globalAlpha *= a;
      const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      g.addColorStop(0, 'rgba(120,180,255,0)');
      g.addColorStop(0.5, 'rgba(235,245,255,1)');
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.shadowColor = 'rgba(120,190,255,1)';
      ctx.shadowBlur = this.glow(18);
      ctx.fillRect(cx - w / 2, cy - 0.8, w, 1.6);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 260);
      halo.addColorStop(0, 'rgba(90,150,255,0.25)');
      halo.addColorStop(1, 'rgba(90,150,255,0)');
      ctx.shadowBlur = 0;
      ctx.fillStyle = halo;
      ctx.fillRect(X0, Y0, CW, CH);
      ctx.restore();
    }

    render(st, t, dt) {
      const ctx = this.ctx;
      const s = this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.updateFx(st, dt, t);
      if (st.backlight <= 0.002) return;

      ctx.setTransform(s, 0, 0, s, -X0 * s, -Y0 * s);
      ctx.globalAlpha = st.backlight;
      const k = st.bootT;                      // seconds since the display woke up
      const wallA = smooth(0.35, 1.2, k);
      const uiA = smooth(0.9, 1.7, k);

      this.drawBackdrop(ctx, st, t, wallA);
      this.shade(ctx);
      this.welcome(ctx, k);

      ctx.globalAlpha = st.backlight * uiA;
      const rpm = st.sweep >= 0 ? st.sweep * TACH.max : st.rpm;
      this.drawTach(ctx, rpm);
      this.drawModes(ctx, st);

      // top centre: speed, unit, gear
      this.text(ctx, String(Math.round(st.speed)), 695, 180, 64, '#ffffff', { weight: 300, glow: 'rgba(180,215,255,0.35)' });
      this.text(ctx, 'km/h', 695, 207, 11.5, 'rgba(225,232,242,0.9)', { weight: 500 });
      ctx.fillStyle = 'rgba(225,232,242,0.75)';
      ctx.fillRect(652, 206.5, 26, 1.1);
      ctx.fillRect(712, 206.5, 26, 1.1);
      this.text(ctx, st.gear, 695, 229, 23, '#ffffff', { weight: 500 });
      this.text(ctx, `${st.outside}°C`, 540, 174, 25, '#f1f4f8', { weight: 400 });
      this.text(ctx, st.clock, 845, 174, 25, '#f1f4f8', { weight: 400 });
      SimIcons.drawIcon(ctx, 'lane', 800, 212, 17, st.cruise ? GREEN : 'rgba(225,232,242,0.75)', st.cruise ? GREEN_GLOW : null);

      // bottom: eco, coolant, odometer | fuel, range
      if (st.eco) this.text(ctx, 'ECO', 287, 416, 12.5, GREEN, { weight: 700, glow: GREEN_GLOW });
      this.text(ctx, 'C', 332, 417, 12, 'rgba(225,232,242,0.85)');
      this.text(ctx, 'H', 458, 417, 12, 'rgba(225,232,242,0.85)');
      this.bar(ctx, 342, 448, 417, (st.coolant - 40) / 90, st.coolant > 118);
      SimIcons.drawIcon(ctx, 'therm', 395, 402, 13, 'rgba(225,232,242,0.85)');
      this.text(ctx, `${Math.floor(st.odo).toLocaleString('en-US')} km`, 395, 434, 12.5, 'rgba(232,238,246,0.92)');
      this.text(ctx, 'E', 944, 417, 12, 'rgba(225,232,242,0.85)');
      this.text(ctx, 'F', 1077, 417, 12, 'rgba(225,232,242,0.85)');
      this.bar(ctx, 956, 1066, 417, st.fuel, st.fuel < 0.12);
      SimIcons.drawIcon(ctx, 'fuel', 962, 402, 13, 'rgba(225,232,242,0.9)');
      this.text(ctx, `${Math.round(st.range)}`, 1022, 403, 16, '#ffffff', { weight: 500, align: 'right' });
      this.text(ctx, 'km', 1026, 405, 10.5, 'rgba(225,232,242,0.85)', { align: 'left' });

      ctx.globalAlpha = st.backlight * Math.max(uiA, st.bulbCheck ? 1 : 0);
      this.lamps(ctx, st, t);
      ctx.globalAlpha = st.backlight;
      this.popup(ctx, st, t);

      // glass sheen
      const sheen = ctx.createLinearGradient(X0, Y0, X0 + 420, Y0 + 260);
      sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(X0, Y0, CW, CH);
    }
  }

  window.Cluster = Cluster;
})();
