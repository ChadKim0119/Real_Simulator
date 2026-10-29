/* Steering wheel renderer.
 *
 * The wheel image is photographed face-on. To turn it the way a real wheel
 * turns, every point is rotated about the column axis in the wheel's own plane
 * and then projected into the interior photo. The wheel is dish-shaped, so the
 * projection depends on depth: the rim maps through a homography fitted to the
 * rim's outer edge, the deeper-set hub through a homography fitted to the hub, and
 * the spokes blend between the two. The mesh is drawn with WebGL; without it a
 * plain 2D affine rotation is used.
 */
(function () {
  'use strict';

  const G = window.WheelGeometry;
  const N = 56;                                    // mesh cells per side
  const HUB_R = 0.36, RIM_R = 0.78;                // depth blend radii (fraction of the wheel radius)
  const BOX = { x: 380, y: 30, w: 900, h: 860 };   // canvas area in stage px

  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function projectRim(x, y) {
    const h = G.rim;
    const w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }

  function projectHub(x, y) {
    const h = G.hub;
    const w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }

  class Wheel {
    constructor(canvas, image) {
      this.canvas = canvas;
      this.image = image;
      this.scale = 0;
      Object.assign(canvas.style, { left: BOX.x + 'px', top: BOX.y + 'px', width: BOX.w + 'px', height: BOX.h + 'px' });

      // rest-pose mesh in source-image pixels, with a depth weight per vertex
      const { x: tx, y: ty, w: tw, h: th } = G.tex;
      const [cx, cy] = G.centre;
      this.cx = cx;
      this.cy = cy;
      this.src = new Float32Array((N + 1) * (N + 1) * 2);
      this.uv = new Float32Array((N + 1) * (N + 1) * 2);
      this.hubW = new Float32Array((N + 1) * (N + 1));
      let k = 0;
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++, k++) {
          const sx = tx + tw * i / N, sy = ty + th * j / N;
          this.src[k * 2] = sx - cx;
          this.src[k * 2 + 1] = sy - cy;
          this.uv[k * 2] = i / N;
          this.uv[k * 2 + 1] = j / N;
          const r = Math.hypot(sx - cx, sy - cy) / G.radius;
          this.hubW[k] = 1 - smooth(HUB_R, RIM_R, r);
        }
      }
      const idx = [];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      this.indices = new Uint16Array(idx);
      this.pos = new Float32Array((N + 1) * (N + 1) * 2);
      this.gl = this.initGL();
      if (!this.gl) this.ctx = canvas.getContext('2d');
      this.setScale(1);
    }

    static get box() { return BOX; }

    initGL() {
      let gl = null;
      try {
        gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
      } catch (e) { gl = null; }
      if (!gl) return null;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, `
        attribute vec2 aPos; attribute vec2 aUV; varying vec2 vUV;
        uniform vec4 uBox;
        void main() {
          vec2 p = (aPos - uBox.xy) / uBox.zw;
          gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
          vUV = aUV;
        }`));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
        precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform float uAlpha;
        void main() { gl_FragColor = texture2D(uTex, vUV) * uAlpha; }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      this.loc = {
        pos: gl.getAttribLocation(prog, 'aPos'),
        uv: gl.getAttribLocation(prog, 'aUV'),
        box: gl.getUniformLocation(prog, 'uBox'),
        alpha: gl.getUniformLocation(prog, 'uAlpha'),
      };
      this.posBuf = gl.createBuffer();
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.loc.uv);
      gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
      gl.uniform4f(this.loc.box, BOX.x, BOX.y, BOX.w, BOX.h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.tex = null;
      return gl;
    }

    upload() {
      const gl = this.gl;
      if (!this.image.complete || !this.image.naturalWidth) return false;
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return true;
    }

    setScale(s) {
      s = Math.min(Math.max(s, 0.5), 2);
      if (Math.abs(s - this.scale) < 0.05) return;
      this.scale = s;
      this.canvas.width = Math.round(BOX.w * s);
      this.canvas.height = Math.round(BOX.h * s);
      if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Draw the wheel turned by `deg` degrees (positive = clockwise, to the right). */
    render(deg) {
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      if (!this.gl) return this.render2D(a);
      const gl = this.gl;
      if (!this.tex && !this.upload()) return;
      const src = this.src, pos = this.pos, hubW = this.hubW;
      const cx = this.cx, cy = this.cy;
      for (let k = 0, n = hubW.length; k < n; k++) {
        const dx = src[k * 2], dy = src[k * 2 + 1];
        const x = cx + dx * ca - dy * sa, y = cy + dx * sa + dy * ca;
        const w = hubW[k];
        const [rx, ry] = projectRim(x, y);
        if (w > 0.001) {
          const [hx, hy] = projectHub(x, y);
          pos[k * 2] = rx + (hx - rx) * w;
          pos[k * 2 + 1] = ry + (hy - ry) * w;
        } else {
          pos[k * 2] = rx;
          pos[k * 2 + 1] = ry;
        }
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.loc.pos);
      gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(this.loc.alpha, 1);
      gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    render2D(a) {
      const ctx = this.ctx, s = this.scale, r = G.rim;
      if (!this.image.complete) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(s, 0, 0, s, -BOX.x * s, -BOX.y * s);
      ctx.transform(r[0], r[3], r[1], r[4], r[2], r[5]);   // perspective terms dropped
      ctx.translate(this.cx, this.cy);
      ctx.rotate(a);
      ctx.translate(-this.cx, -this.cy);
      ctx.drawImage(this.image, G.tex.x, G.tex.y, G.tex.w, G.tex.h);
    }
  }

  window.Wheel = Wheel;
})();
