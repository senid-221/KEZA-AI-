// Code Studio — a tiny HTML/CSS/JS editor with a live same-origin preview iframe, an
// AnnotationLayer pinned on top of the preview (draw / highlight-by-selector / drag-drop),
// a Console panel that captures the preview's console.* and runtime errors, autosave to
// localStorage, and one-click export of the project as a self-contained HTML file.

import { AnnotationLayer } from './annotation.js';

const CODE_KEY = 'keza:code';

const START = {
  html: '<main class="card">\n  <h1>Hello, I am learning web design</h1>\n  <p>Edit me, or ask KEZA to build something.</p>\n  <button id="go">Click me</button>\n</main>',
  css: ':root { --accent:#ff4d8d; }\nbody { font-family: system-ui, sans-serif; background:#0b1020; color:#eaf0ff; display:grid; place-items:center; min-height:100vh; margin:0; }\n.card { background:#131a2e; padding:28px 32px; border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,.5); max-width:420px; }\nh1 { font-size:22px; margin:0 0 8px; }\np { color:#9fb0d0; margin:0 0 18px; }\nbutton { background:var(--accent); color:#fff; border:0; padding:12px 20px; border-radius:12px; font-size:16px; cursor:pointer; }',
  js: 'const b = document.getElementById("go");\nlet n = 0;\nb.addEventListener("click", () => {\n  n++;\n  b.textContent = "Clicked " + n + " time" + (n === 1 ? "" : "s");\n});'
};

function str(v) { return typeof v === 'string' ? v : ''; }
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(CODE_KEY));
    if (s && typeof s === 'object') return Object.assign({}, START, { html: str(s.html), css: str(s.css), js: str(s.js) });
  } catch (_) { /* ignore */ }
  return { ...START };
}

export function createCodeStudio(root) {
  root.classList.add('code-studio');
  const tabs = ['html', 'css', 'js'];
  const code = loadSaved();
  const logs = [];

  root.replaceChildren();

  // ---- editor column ----
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
    ta.addEventListener('input', () => { code[t] = ta.value; schedulePersist(); });
    areas[t] = ta; areaWrap.appendChild(ta);
  });

  const toolbar = el('div', 'cs-toolbar');
  const runBtn = el('button', 'cs-run'); runBtn.type = 'button'; runBtn.textContent = '▶ Run';
  const exportBtn = el('button', 'cs-tool-btn'); exportBtn.type = 'button'; exportBtn.textContent = '⤓ Export'; exportBtn.title = 'Download this project as a single HTML file';
  const resetBtn = el('button', 'cs-tool-btn'); resetBtn.type = 'button'; resetBtn.textContent = '↺ Reset'; resetBtn.title = 'Restore the starter code';
  toolbar.append(runBtn, exportBtn, resetBtn);
  editor.append(tabbar, areaWrap, toolbar);

  // ---- preview column (preview area + console) ----
  const previewCol = el('div', 'cs-preview-col');
  const previewArea = el('div', 'cs-preview-area');
  const frame = document.createElement('iframe');
  frame.className = 'cs-preview';
  frame.setAttribute('title', 'Live preview');
  const previewLabel = el('div', 'cs-preview-label'); previewLabel.textContent = 'Live preview';
  previewArea.append(frame, previewLabel);

  const consoleBar = el('div', 'cs-console');
  const consoleHead = el('div', 'cs-console-head');
  const consoleTitle = el('span', 'cs-console-title'); consoleTitle.textContent = 'Console';
  const consoleCount = el('span', 'cs-console-count', '0');
  const consoleSpacer = el('span', 'cs-console-spacer');
  const clearBtn = el('button', 'cs-console-btn'); clearBtn.type = 'button'; clearBtn.textContent = 'Clear';
  const toggleBtn = el('button', 'cs-console-btn'); toggleBtn.type = 'button'; toggleBtn.textContent = '▾';
  consoleHead.append(consoleTitle, consoleCount, consoleSpacer, clearBtn, toggleBtn);
  const consoleBody = el('div', 'cs-console-body');
  consoleBar.append(consoleHead, consoleBody);
  previewCol.append(previewArea, consoleBar);

  root.append(editor, previewCol);

  const annotation = new AnnotationLayer(previewArea);
  annotation.startLoop();

  function selectTab(t) {
    tabs.forEach((x) => { areas[x].style.display = x === t ? '' : 'none'; });
    tabbar.querySelectorAll('.cs-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  }
  selectTab('html');

  // ---- persistence ----
  let persistTimer = null;
  function schedulePersist() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); }
  function persist() { try { localStorage.setItem(CODE_KEY, JSON.stringify(code)); } catch (_) { /* quota */ } }

  function setCode(mode, content) {
    if (!tabs.includes(mode)) return;
    code[mode] = String(content == null ? '' : content);
    areas[mode].value = code[mode];
    selectTab(mode);
    persist();
  }
  function getCode(mode) { return code[mode] || ''; }
  function resetCode() {
    Object.assign(code, START);
    tabs.forEach((t) => { areas[t].value = code[t]; });
    persist(); run();
  }

  // ---- console capture ----
  function addLog(level, text) {
    logs.push({ level, text });
    if (logs.length > 200) logs.shift();
    const line = el('div', 'cc-line cc-' + level);
    line.textContent = text;
    consoleBody.appendChild(line);
    consoleCount.textContent = String(logs.length);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    if (level === 'error') consoleBar.classList.remove('collapsed');
  }
  function clearConsole() { logs.length = 0; consoleBody.replaceChildren(); consoleCount.textContent = '0'; }
  clearBtn.addEventListener('click', clearConsole);
  toggleBtn.addEventListener('click', () => {
    const collapsed = consoleBar.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '▸' : '▾';
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || m.channel !== 'keza-console') return;
    addLog(['log', 'info', 'warn', 'error'].includes(m.level) ? m.level : 'log', String(m.text || ''));
  });

  // ---- document build ----
  const CONSOLE_BOOT =
    '<' + 'script>(function(){' +
    'function s(l,a){try{parent.postMessage({channel:"keza-console",level:l,text:a.map(function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},"*")}catch(e){}}' +
    '["log","info","warn","error"].forEach(function(k){var o=console[k]?console[k].bind(console):function(){};console[k]=function(){s(k==="info"?"log":k,[].slice.call(arguments));o.apply(null,arguments)}});' +
    'window.addEventListener("error",function(e){s("error",[e.message+" ("+(e.lineno||0)+":"+(e.colno||0)+")"])});' +
    'window.addEventListener("unhandledrejection",function(e){s("error",["Unhandled promise rejection: "+e.reason])});' +
    '})();</' + 'script>';

  function buildDoc(includeConsole) {
    const boot = includeConsole ? CONSOLE_BOOT : '';
    const err = includeConsole
      ? 'console.error((e&&e.stack)||e)'
      : 'document.body.insertAdjacentHTML("beforeend","<pre style=\\"color:#c00;font:13px monospace;padding:8px\\">"+(e&&e.message||e)+"</pre>")';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      boot + '<style>' + code.css + '</style></head><body>' + code.html +
      '<' + 'script>try{' + code.js + '}catch(e){' + err + '}<' + '/script></body></html>';
  }

  function run() {
    frame.srcdoc = buildDoc(true);
    return new Promise((res) => {
      frame.onload = () => {
        try { annotation.contentDocument = frame.contentDocument; } catch (_) { annotation.contentDocument = null; }
        res(true);
      };
    });
  }

  function exportProject() {
    const blob = new Blob([buildDoc(false)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'keza-project.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addLog('log', 'Exported keza-project.html');
  }

  runBtn.addEventListener('click', run);
  exportBtn.addEventListener('click', exportProject);
  resetBtn.addEventListener('click', resetCode);

  run();

  return {
    kind: 'code',
    el: root,
    setCode,
    getCode,
    run,
    resetCode,
    exportProject,
    annotation,
    surfaceRect() { return previewArea.getBoundingClientRect(); }
  };
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
