// Code Studio — a tiny HTML/CSS/JS editor with a live same-origin preview iframe, and an
// AnnotationLayer pinned on top of the preview so the agent (and the learner) can draw,
// highlight real elements by selector, and drag-drop tokens right on the running page.

import { AnnotationLayer } from './annotation.js';

const START = {
  html: '<main class="card">\n  <h1>Hello, I am learning web design</h1>\n  <p>Edit me, or ask KEZA to build something.</p>\n  <button id="go">Click me</button>\n</main>',
  css: ':root { --accent:#ff4d8d; }\nbody { font-family: system-ui, sans-serif; background:#0b1020; color:#eaf0ff; display:grid; place-items:center; min-height:100vh; margin:0; }\n.card { background:#131a2e; padding:28px 32px; border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,.5); max-width:420px; }\nh1 { font-size:22px; margin:0 0 8px; }\np { color:#9fb0d0; margin:0 0 18px; }\nbutton { background:var(--accent); color:#fff; border:0; padding:12px 20px; border-radius:12px; font-size:16px; cursor:pointer; }',
  js: 'const b = document.getElementById("go");\nlet n = 0;\nb.addEventListener("click", () => {\n  n++;\n  b.textContent = "Clicked " + n + " time" + (n === 1 ? "" : "s");\n});'
};

export function createCodeStudio(root) {
  root.classList.add('code-studio');
  const tabs = ['html', 'css', 'js'];
  const code = { ...START };

  root.replaceChildren();

  // editor column
  const editor = el('div', 'cs-editor');
  const tabbar = el('div', 'cs-tabbar');
  const areaWrap = el('div', 'cs-area-wrap');
  const areas = {};
  tabs.forEach((t) => {
    const btn = el('button', 'cs-tab');
    btn.type = 'button'; btn.textContent = t.toUpperCase(); btn.dataset.tab = t;
    btn.addEventListener('click', () => selectTab(t));
    tabbar.appendChild(btn);
    const ta = document.createElement('textarea');
    ta.className = 'cs-area'; ta.spellcheck = false; ta.value = code[t]; ta.dataset.mode = t;
    ta.style.display = 'none';
    ta.addEventListener('input', () => { code[t] = ta.value; });
    areas[t] = ta; areaWrap.appendChild(ta);
  });
  const runBtn = el('button', 'cs-run');
  runBtn.type = 'button'; runBtn.textContent = '▶ Run';
  editor.append(tabbar, areaWrap, runBtn);

  // preview column
  const previewWrap = el('div', 'cs-preview-wrap');
  const frame = document.createElement('iframe');
  frame.className = 'cs-preview';
  frame.setAttribute('title', 'Live preview');
  const previewLabel = el('div', 'cs-preview-label'); previewLabel.textContent = 'Live preview';
  previewWrap.append(frame, previewLabel);

  root.append(editor, previewWrap);

  const annotation = new AnnotationLayer(previewWrap);
  annotation.startLoop();

  function selectTab(t) {
    tabs.forEach((x) => {
      areas[x].style.display = x === t ? '' : 'none';
    });
    tabbar.querySelectorAll('.cs-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  }
  selectTab('html');

  function setCode(mode, content) {
    if (!tabs.includes(mode)) return;
    code[mode] = String(content == null ? '' : content);
    areas[mode].value = code[mode];
    selectTab(mode);
  }
  function getCode(mode) { return code[mode] || ''; }

  function buildDoc() {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' + code.css + '</style></head><body>' + code.html +
      '<script>try{' + code.js + '}catch(e){document.body.insertAdjacentHTML("beforeend","<pre style=\\"color:#ff8080;font:13px monospace;padding:8px\\">"+e+"</pre>")}<' + '/script></body></html>';
  }

  function run() {
    frame.srcdoc = buildDoc();
    return new Promise((res) => {
      frame.onload = () => {
        try { annotation.contentDocument = frame.contentDocument; } catch (_) { annotation.contentDocument = null; }
        res(true);
      };
    });
  }

  runBtn.addEventListener('click', run);

  run();

  return {
    kind: 'code',
    el: root,
    setCode,
    getCode,
    run,
    annotation,
    surfaceRect() { return previewWrap.getBoundingClientRect(); }
  };
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
