// AnnotationLayer — a DPR-aware canvas overlay that sits on top of whatever surface is
// active (Code Studio live preview, or the 3D Graphics Lab iframe). Powers the agent's
// "draw / highlight / drag-drop" skills AND the learner's own mouse drawing.
//
// All geometry is stored as FRACTIONS of the surface (0..1) so it survives resizes and
// looks identical whether it overlays a DOM preview or a WebGL canvas.

const TOOLS = ['select', 'pen', 'rect', 'ellipse', 'highlight', 'arrow', 'text', 'drag', 'clear'];

export function isTool(t) { return TOOLS.includes(t); }

export class AnnotationLayer {
  constructor(container) {
    this.container = container;
    this.shapes = [];
    this.tool = 'select';
    this.color = '#ff4d8d';
    this.stroke = 4;
    this.contentDocument = null; // optional: live-preview doc so we can highlight by selector
    this.onTokenDrop = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'anno-canvas';
    this.layer = document.createElement('div');
    this.layer.className = 'anno-token-layer';
    container.appendChild(this.canvas);
    container.appendChild(this.layer);

    this.ctx = this.canvas.getContext('2d');
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this._bindPointer();
    this.setTool('select');
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  setTool(t) {
    if (isTool(t)) this.tool = t;
    const drawing = t !== 'select';
    this.canvas.style.pointerEvents = drawing ? 'auto' : 'none';
    this.canvas.style.cursor = drawing ? 'crosshair' : 'default';
    if (typeof this.onToolChange === 'function') this.onToolChange(t);
  }
  setColor(c) { if (/^#[0-9a-fA-F]{3,8}$/.test(c)) this.color = c; }

  // ---- programmatic (agent) ops ---------------------------------------------
  addShape(shape) { this.shapes.push(shape); this.redraw(); return shape; }
  drawRect(x, y, w, h, color) { return this.addShape({ type: 'rect', x, y, w, h, color: color || this.color }); }
  drawEllipse(x, y, w, h, color) { return this.addShape({ type: 'ellipse', x, y, w, h, color: color || this.color }); }
  drawArrow(x, y, x2, y2, color) { return this.addShape({ type: 'arrow', x, y, x2, y2, color: color || this.color }); }
  addLabel(x, y, text, color) { return this.addShape({ type: 'text', x, y, label: text, color: color || this.color }); }
  highlightRect(x, y, w, h, color) {
    return this.addShape({ type: 'highlight', x, y, w, h, color: color || '#ffd23f', born: performance.now() });
  }
  clearShapes() { this.shapes = []; this.redraw(); }

  // Resolve a CSS selector inside the live-preview document and ring it.
  highlightSelector(sel, color) {
    if (!this.contentDocument) return null;
    let el;
    try { el = this.contentDocument.querySelector(sel); } catch (_) { return null; }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const host = this.contentDocument.defaultView;
    const sx = r.left / Math.max(1, host.innerWidth);
    const sy = r.top / Math.max(1, host.innerHeight);
    const sw = r.width / Math.max(1, host.innerWidth);
    const sh = r.height / Math.max(1, host.innerHeight);
    return this.highlightRect(clamp01(sx), clamp01(sy), clamp01(sw), clamp01(sh), color);
  }

  // Animated drag-and-drop token. Returns a promise that resolves when it lands.
  animateToken(from, to, label) {
    return new Promise((resolve) => {
      const chip = document.createElement('div');
      chip.className = 'anno-token';
      chip.textContent = label || '•';
      chip.style.left = (from[0] * 100) + '%';
      chip.style.top = (from[1] * 100) + '%';
      this.layer.appendChild(chip);
      requestAnimationFrame(() => {
        chip.style.transform = `translate(${(to[0] - from[0]) * this.cssW}px, ${(to[1] - from[1]) * this.cssH}px) scale(1)`;
        chip.classList.add('moving');
      });
      const dur = 1100;
      setTimeout(() => {
        chip.classList.add('dropped');
        setTimeout(() => { chip.remove(); resolve(true); }, 350);
        if (this.onTokenDrop) this.onTokenDrop(to, label);
      }, dur);
    });
  }

  destroy() { this._ro.disconnect(); this.canvas.remove(); this.layer.remove(); }

  // ---- rendering -------------------------------------------------------------
  redraw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.cssW, this.cssH);
    for (const s of this.shapes) this._draw(s, c, false);
  }

  _px(v) { return v * this.cssW; }
  _py(v) { return v * this.cssH; }

  _draw(s, c, ghost) {
    const col = s.color || this.color;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (s.type === 'path' && Array.isArray(s.points) && s.points.length) {
      c.strokeStyle = col; c.lineWidth = s.width || this.stroke;
      c.beginPath();
      s.points.forEach((p, i) => { const [x, y] = p; if (i === 0) c.moveTo(this._px(x), this._py(y)); else c.lineTo(this._px(x), this._py(y)); });
      c.stroke();
    } else if (s.type === 'highlighter' && Array.isArray(s.points) && s.points.length) {
      c.strokeStyle = hexA(col, 0.42); c.lineWidth = 18;
      c.beginPath();
      s.points.forEach((p, i) => { const [x, y] = p; if (i === 0) c.moveTo(this._px(x), this._py(y)); else c.lineTo(this._px(x), this._py(y)); });
      c.stroke();
    } else if (s.type === 'rect') {
      c.strokeStyle = col; c.lineWidth = this.stroke;
      c.strokeRect(this._px(s.x), this._py(s.y), this._px(s.w), this._py(s.h));
    } else if (s.type === 'ellipse') {
      c.strokeStyle = col; c.lineWidth = this.stroke;
      c.beginPath();
      c.ellipse(this._px(s.x + s.w / 2), this._py(s.y + s.h / 2), Math.abs(this._px(s.w / 2)) || 1, Math.abs(this._py(s.h / 2)) || 1, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (s.type === 'line') {
      c.strokeStyle = col; c.lineWidth = this.stroke;
      c.beginPath(); c.moveTo(this._px(s.x), this._py(s.y)); c.lineTo(this._px(s.x2), this._py(s.y2)); c.stroke();
    } else if (s.type === 'arrow') {
      this._arrow(c, this._px(s.x), this._py(s.y), this._px(s.x2), this._py(s.y2), col);
    } else if (s.type === 'highlight') {
      this._ring(c, this._px(s.x), this._py(s.y), this._px(s.w), this._py(s.h), col, s.born);
    } else if (s.type === 'text') {
      c.font = '600 15px "Google Sans", system-ui, sans-serif';
      const pad = 6; const w = c.measureText(s.label || '').width + pad * 2; const h = 22 + pad;
      c.fillStyle = hexA('#0b1020', 0.78); roundRect(c, this._px(s.x), this._py(s.y), w, h, 8); c.fill();
      c.fillStyle = col; c.fillText(s.label || '', this._px(s.x) + pad, this._py(s.y) + 18);
    }
    c.restore();
  }

  _arrow(c, x, y, x2, y2, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = this.stroke;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
    const ang = Math.atan2(y2 - y, x2 - x); const head = 12;
    c.beginPath(); c.moveTo(x2, y2);
    c.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    c.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    c.closePath(); c.fill();
  }

  _ring(c, x, y, w, h, col, born) {
    const t = born ? ((performance.now() - born) % 1600) / 1600 : 0;
    const pulse = 0.6 + 0.4 * Math.sin(t * Math.PI * 2);
    c.fillStyle = hexA(col, 0.16 * pulse);
    roundRect(c, x, y, w, h, 10); c.fill();
    c.strokeStyle = col; c.lineWidth = 3 + 1.5 * pulse;
    c.shadowColor = col; c.shadowBlur = 14 * pulse;
    roundRect(c, x, y, w, h, 10); c.stroke();
    c.shadowBlur = 0;
  }

  // ---- manual drawing --------------------------------------------------------
  _bindPointer() {
    let active = null;
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      if (this.tool === 'clear') { this.clearShapes(); return; }
      if (this.tool === 'select' || this.tool === 'drag') {
        const hit = this._hitTest(x, y);
        if (hit && this.tool === 'drag') active = { kind: 'move', shape: hit, ox: x - hit.x, oy: y - hit.y };
        return;
      }
      if (this.tool === 'pen' || this.tool === 'highlight') {
        active = { kind: 'path', shape: { type: this.tool === 'pen' ? 'path' : 'highlighter', points: [[x, y]], color: this.color } };
      } else if (this.tool === 'rect' || this.tool === 'ellipse') {
        active = { kind: 'box', sx: x, sy: y, shape: { type: this.tool, x, y, w: 0, h: 0, color: this.color } };
      } else if (this.tool === 'arrow') {
        active = { kind: 'box', sx: x, sy: y, shape: { type: 'arrow', x, y, x2: x, y2: y, color: this.color } };
      } else if (this.tool === 'text') {
        const label = (window.prompt('Annotation label:') || '').slice(0, 60);
        if (label) this.addLabel(x, y, label, this.color);
        return;
      }
      if (active) { this.shapes.push(active.shape); this.canvas.setPointerCapture(e.pointerId); }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!active) return;
      const [x, y] = pos(e);
      if (active.kind === 'path') { active.shape.points.push([x, y]); }
      else if (active.kind === 'move') { shiftShape(active.shape, x - active.ox - active.shape.x, y - active.oy - active.shape.y); }
      else if (active.kind === 'box') {
        const s = active.shape;
        if (s.type === 'arrow') { s.x2 = x; s.y2 = y; }
        else { s.x = Math.min(active.sx, x); s.y = Math.min(active.sy, y); s.w = Math.abs(x - active.sx); s.h = Math.abs(y - active.sy); }
      }
      this.redraw();
    });
    const end = (e) => {
      if (active && this.canvas.hasPointerCapture && e && e.pointerId != null) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      active = null;
      this.redraw();
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  _hitTest(x, y) {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (s.type === 'text') { if (Math.abs(s.x - x) < 0.1 && Math.abs(s.y - y) < 0.05) return s; }
      else if (s.type === 'arrow') { if (nearLine(s, x, y, 0.02)) return s; }
      else if (s.type === 'path' || s.type === 'highlighter') {
        if (s.points.some(([px, py]) => Math.hypot(px - x, py - y) < 0.02)) return s;
      } else if (s.type === 'line') { if (nearLine(s, x, y, 0.02)) return s; }
      else if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
    }
    return null;
  }

  // redraw highlights on a timer so the pulse animates
  startLoop() {
    if (this._loop) return;
    const tick = () => {
      if (this.shapes.some((s) => s.type === 'highlight')) this.redraw();
      this._raf = requestAnimationFrame(tick);
    };
    this._loop = true; tick();
  }
}

function shiftShape(s, dx, dy) {
  if (s.type === 'path' || s.type === 'highlighter') s.points = s.points.map(([x, y]) => [x + dx, y + dy]);
  else if (s.type === 'arrow' || s.type === 'line') { s.x += dx; s.y += dy; s.x2 += dx; s.y2 += dy; }
  else { s.x += dx; s.y += dy; }
}

function nearLine(s, x, y, tol) {
  const { x: ax, y: ay, x2: bx, y2: by } = s;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy; if (!len) return false;
  let t = ((x - ax) * dx + (y - ay) * dy) / len; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < tol;
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2) || 1;
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
