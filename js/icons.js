/* Telltale (warning lamp) icons on a 24x24 grid, styled after ISO 2575 symbols. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  function circle(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    fill ? ctx.fill() : ctx.stroke();
  }

  function path(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
    ctx.stroke();
  }

  function parens(ctx, r, dashed) {
    if (dashed) ctx.setLineDash([2.2, 1.6]);
    for (const [a0, a1] of [[0.7, 1.3], [-0.3, 0.3]]) {
      ctx.beginPath();
      ctx.arc(12, 12, r, Math.PI * a0, Math.PI * a1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function bang(ctx, y0, y1, dy) {
    path(ctx, [12, y0, 12, y1]);
    circle(ctx, 12, dy, 1.15, true);
  }

  function oilCan(ctx) {
    ctx.beginPath();
    ctx.moveTo(4.4, 10.4);
    ctx.lineTo(13.6, 10.4);
    ctx.lineTo(21.2, 7.6);
    ctx.lineTo(16.2, 15.4);
    ctx.lineTo(5.8, 15.4);
    ctx.closePath();
    ctx.stroke();
    path(ctx, [4.4, 11.0, 1.6, 9.4, 1.6, 12.8, 4.8, 14.0]);
    path(ctx, [9.2, 10.4, 9.2, 8.2]);
    path(ctx, [7.0, 8.0, 11.4, 8.0]);
    ctx.beginPath();
    ctx.moveTo(21.6, 10.4);
    ctx.quadraticCurveTo(23.1, 12.8, 21.6, 13.6);
    ctx.quadraticCurveTo(20.1, 12.8, 21.6, 10.4);
    ctx.fill();
  }

  function carSide(ctx, x, y, w) {
    const k = w / 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(0.6, 4.6);
    ctx.lineTo(0.6, 2.8);
    ctx.lineTo(3.0, 2.2);
    ctx.lineTo(5.0, 0);
    ctx.lineTo(10.0, 0);
    ctx.lineTo(12.2, 2.2);
    ctx.lineTo(13.6, 2.6);
    ctx.lineTo(13.6, 4.6);
    ctx.closePath();
    ctx.lineWidth /= k;
    ctx.stroke();
    ctx.beginPath(); ctx.arc(3.6, 4.8, 1.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(10.6, 4.8, 1.3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const ICONS = {
    /* ---- red: warning ---- */
    brake(ctx) { circle(ctx, 12, 12, 6.4); parens(ctx, 9.8); bang(ctx, 8.4, 12.8, 15.4); },
    oil(ctx) { oilCan(ctx); },
    coolant(ctx) {
      path(ctx, [12, 2.6, 12, 13.2]);
      circle(ctx, 12, 15.0, 2.4, true);
      path(ctx, [12, 4.8, 15.6, 4.8]);
      path(ctx, [12, 7.6, 14.8, 7.6]);
      path(ctx, [12, 10.4, 15.6, 10.4]);
      for (const y of [19.2, 22.0]) {
        ctx.beginPath();
        for (let x = 2.4; x <= 21.6; x += 0.4) {
          const yy = y + Math.sin((x - 2.4) / 4.8 * TAU) * 0.9;
          x === 2.4 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    },
    battery(ctx) {
      ctx.beginPath();
      ctx.roundRect(2.6, 7.4, 18.8, 11.6, 1.2);
      ctx.stroke();
      ctx.fillRect(5.4, 4.8, 3.4, 2.6);
      ctx.fillRect(15.2, 4.8, 3.4, 2.6);
      path(ctx, [5.4, 13.2, 9.2, 13.2]);
      path(ctx, [14.6, 13.2, 18.4, 13.2]);
      path(ctx, [16.5, 11.3, 16.5, 15.1]);
    },
    airbag(ctx) {
      circle(ctx, 6.2, 4.4, 2.3, true);
      ctx.save();
      ctx.lineWidth = 2.8;
      path(ctx, [6.8, 8.4, 8.0, 14.0, 13.0, 14.0, 14.6, 20.8]);
      ctx.restore();
      path(ctx, [4.6, 9.8, 4.8, 16.4, 10.2, 19.6]);
      path(ctx, [3.4, 8.2, 10.6, 15.8]);       // belt
      circle(ctx, 17.2, 7.4, 4.4, true);        // deployed bag
      path(ctx, [12.4, 9.6, 13.4, 9.0]);
    },
    door(ctx) {
      ctx.beginPath();
      ctx.roundRect(8.2, 2.6, 7.6, 18.8, 3.4);
      ctx.stroke();
      path(ctx, [9.2, 8.0, 12, 7.0, 14.8, 8.0]);
      path(ctx, [9.4, 17.2, 12, 18.0, 14.6, 17.2]);
      path(ctx, [8.2, 9.2, 4.2, 12.6]);
      path(ctx, [15.8, 9.2, 19.8, 12.6]);
      path(ctx, [8.2, 13.6, 4.8, 16.4]);
      path(ctx, [15.8, 13.6, 19.2, 16.4]);
    },

    /* ---- amber: caution ---- */
    engine(ctx) {
      ctx.beginPath();
      ctx.moveTo(6.0, 8.0);
      ctx.lineTo(9.0, 8.0);
      ctx.lineTo(9.0, 6.2);
      ctx.lineTo(13.4, 6.2);
      ctx.lineTo(13.4, 8.0);
      ctx.lineTo(16.0, 8.0);
      ctx.lineTo(17.6, 9.8);
      ctx.lineTo(19.2, 9.8);
      ctx.lineTo(19.2, 8.2);
      ctx.lineTo(21.6, 8.2);
      ctx.lineTo(21.6, 16.4);
      ctx.lineTo(19.2, 16.4);
      ctx.lineTo(19.2, 14.8);
      ctx.lineTo(17.6, 14.8);
      ctx.lineTo(15.4, 17.8);
      ctx.lineTo(8.0, 17.8);
      ctx.lineTo(6.0, 15.4);
      ctx.closePath();
      ctx.stroke();
      path(ctx, [2.4, 9.2, 2.4, 15.2]);
      path(ctx, [2.4, 12.2, 6.0, 12.2]);
    },
    abs(ctx) {
      circle(ctx, 12, 12, 7.2);
      parens(ctx, 10.4);
      ctx.save();
      ctx.font = '800 6.6px "Barlow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ABS', 12, 12.4);
      ctx.restore();
    },
    esp(ctx) {
      ctx.beginPath();
      ctx.moveTo(4.6, 12.6);
      ctx.lineTo(6.6, 7.4);
      ctx.quadraticCurveTo(7.0, 6.4, 8.2, 6.4);
      ctx.lineTo(15.8, 6.4);
      ctx.quadraticCurveTo(17.0, 6.4, 17.4, 7.4);
      ctx.lineTo(19.4, 12.6);
      ctx.lineTo(19.4, 15.2);
      ctx.lineTo(4.6, 15.2);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(5.4, 15.2, 2.8, 2.0);
      ctx.fillRect(15.8, 15.2, 2.8, 2.0);
      for (const s of [1, -1]) {
        const x = 12 - s * 4.6;
        ctx.beginPath();
        ctx.moveTo(x, 18.6);
        ctx.bezierCurveTo(x + s * 2.8, 19.6, x - s * 1.8, 21.4, x + s * 0.9, 23.2);
        ctx.stroke();
      }
    },
    gearbox(ctx) {
      ctx.beginPath();
      const teeth = 9;
      for (let i = 0; i < teeth * 2; i++) {
        const a = i / (teeth * 2) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? 10.2 : 8.2;
        const a0 = a - Math.PI / (teeth * 2) * 0.55, a1 = a + Math.PI / (teeth * 2) * 0.55;
        ctx.lineTo(12 + Math.cos(a0) * r, 12 + Math.sin(a0) * r);
        ctx.lineTo(12 + Math.cos(a1) * r, 12 + Math.sin(a1) * r);
      }
      ctx.closePath();
      ctx.stroke();
      bang(ctx, 7.6, 12.6, 15.6);
    },
    brakepad(ctx) { circle(ctx, 12, 12, 6.4); parens(ctx, 9.8, true); },
    oillevel(ctx) {
      oilCan(ctx);
      ctx.beginPath();
      for (let x = 4; x <= 18; x += 0.4) {
        const y = 20.2 + Math.sin((x - 4) / 4.6 * TAU) * 0.9;
        x === 4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    },

    /* ---- green: status ---- */
    acc(ctx) {
      carSide(ctx, 8.4, 8.6, 14.4);
      for (const r of [3.4, 5.6, 7.8]) {
        ctx.beginPath();
        ctx.arc(9.6, 12.2, r, Math.PI * 0.8, Math.PI * 1.2);
        ctx.stroke();
      }
    },
    cruise(ctx) {
      ctx.beginPath();
      ctx.arc(12, 13, 8.4, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      path(ctx, [12, 13, 16.2, 9.0]);
      circle(ctx, 12, 13, 1.4, true);
      path(ctx, [4.4, 3.0, 7.6, 6.2]);
      path(ctx, [7.6, 3.6, 7.6, 6.2, 5.0, 6.2]);
    },
    lane(ctx) {
      path(ctx, [7.6, 3.0, 2.8, 21.0]);
      path(ctx, [16.4, 3.0, 21.2, 21.0]);
      ctx.save();
      ctx.setLineDash([3.2, 2.4]);
      path(ctx, [12, 3.0, 12, 21.0]);
      ctx.restore();
    },
    master(ctx) {
      path(ctx, [12, 3.0, 21.6, 20.0, 2.4, 20.0], true);
      bang(ctx, 8.8, 14.4, 17.2);
    },
    fuel(ctx) {
      ctx.beginPath();
      ctx.roundRect(4.8, 4.0, 9.2, 16.0, 1.2);
      ctx.stroke();
      ctx.fillRect(6.6, 6.0, 5.6, 4.4);
      path(ctx, [3.2, 20.2, 15.6, 20.2]);
      ctx.beginPath();
      ctx.moveTo(14.0, 9.4);
      ctx.lineTo(17.0, 9.4);
      ctx.quadraticCurveTo(18.6, 9.4, 18.6, 11.0);
      ctx.lineTo(18.6, 16.0);
      ctx.quadraticCurveTo(18.6, 17.6, 19.7, 17.6);
      ctx.quadraticCurveTo(20.8, 17.6, 20.8, 16.2);
      ctx.lineTo(20.8, 8.6);
      ctx.lineTo(18.2, 6.0);
      ctx.stroke();
    },
    therm(ctx) {
      path(ctx, [12, 3.0, 12, 14.0]);
      circle(ctx, 12, 16.6, 2.8, true);
      path(ctx, [12, 6.0, 15.0, 6.0]);
      path(ctx, [12, 9.4, 15.0, 9.4]);
    },
  };

  /** Draw icon `id` centred at (x, y), `size` px wide, in `color`, with optional glow. */
  function drawIcon(ctx, id, x, y, size, color, glow) {
    const fn = ICONS[id];
    if (!fn) return;
    const k = size / 24;
    ctx.save();
    if (glow) {
      // shadowBlur is in device pixels, independent of the current transform
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.32 * Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
    }
    ctx.translate(x - 12 * k, y - 12 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.05;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    fn(ctx);
    ctx.restore();
  }

  window.SimIcons = { drawIcon };
})();
