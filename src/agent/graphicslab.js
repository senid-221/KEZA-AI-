// Graphics Lab — hosts the Three.js Mochi-Puff sim in an isolated iframe (so its
// window-level pointer listeners never hijack the agent UI) and drives it through the
// window.__mochiLab postMessage bridge added in src/main.js. An AnnotationLayer is pinned
// over the iframe for the same draw/highlight/drag skills as the Code Studio.

import { AnnotationLayer } from './annotation.js';

export function createGraphicsLab(root) {
  root.classList.add('graphics-lab');
  root.replaceChildren();

  const frame = document.createElement('iframe');
  frame.className = 'lab-frame';
  frame.setAttribute('title', '3D Graphics Lab');
  frame.src = './lab.html?embed=1';

  const hint = el('div', 'lab-hint');
  hint.textContent = 'Loading 3D Graphics Lab…';

  root.append(frame, hint);
  const annotation = new AnnotationLayer(root);
  annotation.startLoop();

  let ready = false;
  let seq = 0;
  const pending = new Map();

  function call(method, args = []) {
    return new Promise((resolve) => {
      if (!frame.contentWindow) { resolve({ ok: false, error: 'not embedded' }); return; }
      const id = 'c' + (++seq);
      pending.set(id, resolve);
      try { frame.contentWindow.postMessage({ channel: 'mochi-lab', id, method, args }, '*'); }
      catch (_) { pending.delete(id); resolve({ ok: false, error: 'post failed' }); }
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, 4000);
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'mochi-lab' || msg.method !== 'ready') return;
    // lab announces it booted
    ready = true;
    hint.textContent = 'Mochi-Puff live · drag to pet, click to boop';
    setTimeout(() => { hint.style.opacity = '0'; }, 2500);
  });
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'mochi-lab-reply') return;
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg.result); }
  });

  // If the agent runs a lab action before the frame is ready, queue it.
  async function whenReady() {
    if (ready) return true;
    for (let i = 0; i < 40; i++) { await sleep(100); if (ready) return true; }
    return false;
  }

  return {
    kind: 'graphics',
    el: root,
    annotation,
    isReady() { return ready; },
    async invoke(method, args) {
      await whenReady();
      return call(method, Array.isArray(args) ? args : []);
    },
    surfaceRect() { return root.getBoundingClientRect(); }
  };
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
