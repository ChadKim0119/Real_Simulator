/* Light and shadow passing over the interior while driving (trees, poles,
 * open sky). The photo shows no window, so this is how the outside world
 * is felt inside the cabin. Composited with `mix-blend-mode: soft-light`. */
(function () {
  'use strict';

  const W = 1440, H = 810, Q = 1 / 8;
  const SCREEN = { x: 405, y: 95, w: 515, h: 195 };

  const hash = (n, k) => {
    const s = Math.sin(n * 78.233 + k * 12.989) * 43758.5453;
    return s - Math.floor(s);
  };

  class Ambient {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = Math.round(W * Q);
      canvas.height = Math.round(H * Q);
      this.ctx = canvas.getContext('2d');
    }

    render(st, t) {
      const ctx = this.ctx;
      ctx.setTransform(Q, 0, 0, Q, 0, 0);
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(0, 0, W, H);
      const d = st.odoMeters;

      // overall daylight breathing (clouds)
      const sky = 0.5 + 0.5 * Math.sin(t * 0.07) * Math.sin(t * 0.031 + 1);
      ctx.fillStyle = `rgba(255,248,235,${0.06 + sky * 0.08})`;
      ctx.fillRect(0, 0, W, H);

      // objects beside the road; each sweeps across the cabin once
      for (let n = Math.floor((d - 30) / 7); n <= Math.floor((d + 4) / 7); n++) {
        const pos = n * 7 + hash(n, 1) * 5;
        const p = (d - pos) / (10 + hash(n, 2) * 10);
        if (p < 0 || p > 1) continue;
        const kind = hash(n, 3);
        const light = kind > 0.72;
        const strength = light ? 0.22 + hash(n, 4) * 0.2 : 0.18 + hash(n, 5) * 0.32;
        const bw = 160 + hash(n, 6) * 420;
        const cx = W * (1.25 - p * 1.6);
        const tilt = 380 + hash(n, 7) * 300;
        const env = Math.sin(p * Math.PI);
        ctx.save();
        ctx.globalAlpha = strength * env;
        ctx.fillStyle = light ? '#fff6e0' : '#000';
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2 + tilt, -40);
        ctx.lineTo(cx + bw / 2 + tilt, -40);
        ctx.lineTo(cx + bw / 2 - tilt * 0.4, H + 40);
        ctx.lineTo(cx - bw / 2 - tilt * 0.4, H + 40);
        ctx.closePath();
        ctx.fill();
        // dappled leaves inside a tree shadow
        if (!light && kind < 0.45) {
          ctx.fillStyle = '#fff6e0';
          for (let i = 0; i < 6; i++) {
            const lx = cx + (hash(n * 9 + i, 8) - 0.5) * bw + (hash(n * 9 + i, 9) - 0.5) * 300;
            const ly = hash(n * 9 + i, 10) * H;
            ctx.globalAlpha = strength * env * 0.8;
            ctx.beginPath();
            ctx.ellipse(lx, ly, 40 + hash(i, n) * 70, 25 + hash(n, i) * 40, 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // the display is emissive; keep its area neutral
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h);
    }
  }

  window.Ambient = Ambient;
})();
