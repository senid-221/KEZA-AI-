// main.js — wires the Agent Studio: provider bar, mode toggle, Code Studio + Graphics Lab,
// conversation, live studio-action execution, voice, and the request loop.

import { PROVIDERS, PROVIDER_ORDER, providerLogo, providerAccent, getProvider, streamChat, fetchConfig } from './providers.js';
import { createCodeStudio } from './codestudio.js';
import { createGraphicsLab } from './graphicslab.js';
import { createConversation, renderMarkdown } from './conversation.js';
import { createVoice, createListener } from './voice.js';
import { openSettings } from './settings.js';
import { openAdmin } from './admin.js';
import { buildSystemPrompt, createScanner, SKILLS, actionAllowed } from './agent.js';
import { loadSettings, saveSettings, loadAdmin, loadHistory, saveHistory, clearHistory } from './store.js';

const $ = (id) => document.getElementById(id);

let settings = loadSettings();
let admin = loadAdmin();
let history = loadHistory(); // [{role, content}]
let mode = 'code';           // 'code' | 'graphics'
let busy = false;
let aborter = null;
let configured = {};         // { providerId: true|false } from /api/config

const conversation = createConversation($('convo'));
const studio = createCodeStudio($('studio-pane'));
const lab = createGraphicsLab($('lab-pane'));
const voice = createVoice();
let firstTurn = history.length === 0;

const providerSelect = $('provider-select');
const modelSelect = $('model-select');
const composerLogo = $('composer-logo');
const sendBtn = $('send-btn');
const inputEl = $('composer-input');
const micBtn = $('mic-btn');
const settingsBtn = $('settings-btn');
const adminBtn = $('admin-btn');
const newBtn = $('new-chat-btn');
const statusHint = $('status-hint');

// ---- provider + model dropdowns (live in the chat composer) -----------------
function providerAvailable(id) {
  return configured[id] !== false && admin.enabledProviders[id] !== false;
}
function providerNote(id) {
  if (configured[id] === false) return ' — not set';
  if (admin.enabledProviders[id] === false) return ' — disabled';
  return '';
}
function renderProviderSelect() {
  providerSelect.replaceChildren();
  for (const id of PROVIDER_ORDER) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = PROVIDERS[id].name + providerNote(id);
    o.disabled = !providerAvailable(id);
    providerSelect.appendChild(o);
  }
  providerSelect.value = settings.provider;
  providerSelect.style.setProperty('--accent', providerAccent(settings.provider));
  composerLogo.innerHTML = providerLogo(settings.provider, 16);
  composerLogo.style.setProperty('--accent', providerAccent(settings.provider));
}

function renderModelSelect() {
  const p = getProvider(settings.provider);
  modelSelect.replaceChildren();
  const opts = Array.from(new Set([settings.model, ...(p.models || [])].filter(Boolean)));
  for (const m of opts) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    modelSelect.appendChild(o);
  }
  modelSelect.value = settings.model || opts[0];
}

providerSelect.addEventListener('change', () => {
  settings.provider = providerSelect.value;
  if (!PROVIDERS[settings.provider].models.includes(settings.model)) settings.model = PROVIDERS[settings.provider].models[0];
  saveSettings(settings);
  renderProviderSelect(); renderModelSelect(); updateVoice();
  setStatus(`${PROVIDERS[settings.provider].name} · ${settings.model}`);
});
modelSelect.addEventListener('change', () => {
  settings.model = modelSelect.value;
  saveSettings(settings);
  setStatus(`${PROVIDERS[settings.provider].name} · ${settings.model}`);
});

// ---- mode toggle ------------------------------------------------------------
function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  $('tab-code').classList.toggle('active', next === 'code');
  $('tab-graphics').classList.toggle('active', next === 'graphics');
  $('studio-pane').style.display = next === 'code' ? '' : 'none';
  $('lab-pane').style.display = next === 'graphics' ? '' : 'none';
}
$('tab-code').addEventListener('click', () => setMode('code'));
$('tab-graphics').addEventListener('click', () => setMode('graphics'));

function activeSurface() { return mode === 'graphics' ? lab : studio; }

// ---- annotation toolbar (learner draw / highlight / drag skills) ------------
const TOOL_DEFS = [
  { t: 'select', icon: '🖐', label: 'Interact' },
  { t: 'pen', icon: '✎', label: 'Draw' },
  { t: 'highlight', icon: '▤', label: 'Highlight' },
  { t: 'rect', icon: '▭', label: 'Box' },
  { t: 'ellipse', icon: '◯', label: 'Oval' },
  { t: 'arrow', icon: '→', label: 'Arrow' },
  { t: 'text', icon: 'T', label: 'Label' },
  { t: 'drag', icon: '✥', label: 'Move' },
  { t: 'clear', icon: '🗑', label: 'Clear' }
];
const COLORS = ['#ff4d8d', '#7c86ff', '#34d399', '#ffd23f', '#ff6b6b', '#ffffff'];

const annoToolbar = document.createElement('div');
annoToolbar.className = 'anno-toolbar';
for (const td of TOOL_DEFS) {
  const b = document.createElement('button');
  b.className = 'atool' + (td.t === 'select' ? ' active' : '');
  b.type = 'button'; b.dataset.tool = td.t; b.title = td.label; b.textContent = td.icon;
  b.addEventListener('click', () => {
    const layer = activeSurface().annotation;
    if (td.t === 'clear') { layer.clearShapes(); }
    else layer.setTool(td.t);
    annoToolbar.querySelectorAll('.atool').forEach((x) => x.classList.toggle('active', x.dataset.tool === (td.t === 'clear' ? 'select' : td.t)));
  });
  annoToolbar.appendChild(b);
}
const swatchWrap = document.createElement('div'); swatchWrap.className = 'aswatches';
COLORS.forEach((c, i) => {
  const s = document.createElement('button'); s.className = 'aswatch' + (i === 0 ? ' active' : ''); s.type = 'button'; s.style.background = c; s.dataset.color = c;
  s.addEventListener('click', () => { activeSurface().annotation.setColor(c); swatchWrap.querySelectorAll('.aswatch').forEach((x) => x.classList.toggle('active', x === s)); });
  swatchWrap.appendChild(s);
});
annoToolbar.appendChild(swatchWrap);
const workspaceBody = document.querySelector('.workspace-body');
workspaceBody.appendChild(annoToolbar);

// ---- make the toolbar draggable + edge-dockable -----------------------------
(function makeToolbarMovable() {
  const KEY = 'teaching-agent:toolbarpos';
  const grip = document.createElement('span');
  grip.className = 'anno-grip';
  grip.title = 'Drag to move · snaps to nearest edge · double-click to reset';
  annoToolbar.insertBefore(grip, annoToolbar.firstChild);

  let pos = null;
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw && isFinite(raw.x) && isFinite(raw.y)) pos = raw; } catch (_) {}

  const clamp = (v, lo, hi) => Math.min(Math.max(lo, v), hi);
  function apply(p) {
    const w = annoToolbar.offsetWidth, h = annoToolbar.offsetHeight;
    const cw = workspaceBody.clientWidth, ch = workspaceBody.clientHeight;
    const x = clamp(p.x, 6, Math.max(6, cw - w - 6));
    const y = clamp(p.y, 6, Math.max(6, ch - h - 6));
    annoToolbar.style.left = x + 'px';
    annoToolbar.style.top = y + 'px';
    annoToolbar.style.bottom = 'auto';
    return { x, y };
  }
  function defaultPos() {
    const w = annoToolbar.offsetWidth, h = annoToolbar.offsetHeight;
    return apply({ x: (workspaceBody.clientWidth - w) / 2, y: workspaceBody.clientHeight - h - 12 });
  }
  function layout() { if (pos) apply(pos); else pos = defaultPos(); }
  requestAnimationFrame(layout);
  window.addEventListener('resize', () => { if (pos) apply(pos); else defaultPos(); });

  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = annoToolbar.getBoundingClientRect();
    const cr = workspaceBody.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, cr };
    annoToolbar.classList.add('dragging');
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = annoToolbar.offsetWidth, h = annoToolbar.offsetHeight;
    pos = apply({ x: e.clientX - drag.cr.left - drag.dx, y: e.clientY - drag.cr.top - drag.dy });
  });
  function end(e) {
    if (!drag) return;
    drag = null;
    annoToolbar.classList.remove('dragging');
    const w = annoToolbar.offsetWidth, h = annoToolbar.offsetHeight;
    const cw = workspaceBody.clientWidth, ch = workspaceBody.clientHeight;
    const m = 8;
    const nearL = pos.x < cw * 0.30, nearR = (cw - (pos.x + w)) < cw * 0.30;
    const nearT = pos.y < ch * 0.34, nearB = (ch - (pos.y + h)) < ch * 0.34;
    let x = pos.x, y = pos.y;
    if (nearL && !nearR) x = m; else if (nearR && !nearL) x = cw - w - m;
    if (nearT && !nearB) y = m; else if (nearB && !nearT) y = ch - h - m;
    pos = { x, y };
    apply(pos);
    annoToolbar.classList.toggle('dock-left', x === m);
    annoToolbar.classList.toggle('dock-right', x === cw - w - m);
    annoToolbar.classList.toggle('dock-top', y === m);
    annoToolbar.classList.toggle('dock-bottom', y === ch - h - m);
    try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch (_) {}
    if (e && e.pointerId != null) { try { grip.releasePointerCapture(e.pointerId); } catch (_) {} }
  }
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => {
    pos = null;
    annoToolbar.classList.remove('dock-left', 'dock-right', 'dock-top', 'dock-bottom');
    try { localStorage.removeItem(KEY); } catch (_) {}
    defaultPos();
  });
})();

// ---- status + voice ---------------------------------------------------------
function setStatus(t) { statusHint.textContent = t; }
function updateVoice() { voice.setEnabled(settings.voiceEnabled); }

// ---- quick example chips ----------------------------------------------------
const EXAMPLES = [
  'Teach me CSS Grid by building a photo gallery, live',
  'Explain how an LLM agent loop works, show it visually',
  'Turn Mochi-Puff into Golden Fluff and explain the shaders',
  'Simulate a training loop then quiz me'
];
const exWrap = $('examples');
EXAMPLES.forEach((t) => {
  const c = document.createElement('button'); c.className = 'example-chip'; c.type = 'button'; c.textContent = t;
  c.addEventListener('click', () => { inputEl.value = t; autoGrow(); submit(); });
  exWrap.appendChild(c);
});

// ---- studio action execution ------------------------------------------------
async function executeAction(a) {
  if (!actionAllowed(admin, a)) {
    conversation.addSystem(`Admin controls: the "${a.action}" action is disabled, so KEZA skipped it.`);
    return;
  }
  const speak = typeof a.speak === 'string' ? a.speak : '';
  switch (a.action) {
    case 'code': {
      setMode('code');
      studio.setCode(a.mode || 'html', a.content || '');
      await studio.run();
      break;
    }
    case 'run': {
      setMode('code');
      await studio.run();
      break;
    }
    case 'lab': {
      setMode('graphics');
      const res = await lab.invoke(a.method, a.args || []);
      if (res && res.ok === false) console.warn('lab action failed', a, res);
      break;
    }
    case 'annotate': {
      const layer = activeSurface().annotation;
      const sh = a.shape || {};
      const color = /^#[0-9a-f]{6}$/i.test(sh.color || '') ? sh.color : undefined;
      if (a.kind === 'clear') { layer.clearShapes(); break; }
      if (a.kind === 'highlight') {
        if (sh.selector && mode === 'code') layer.highlightSelector(sh.selector, color);
        else layer.highlightRect(num(sh.x, 0.1), num(sh.y, 0.1), num(sh.w, 0.3), num(sh.h, 0.2), color);
        break;
      }
      if (a.kind === 'arrow') { layer.drawArrow(num(sh.x, 0.1), num(sh.y, 0.1), num(sh.x2, 0.6), num(sh.y2, 0.6), color); break; }
      if (a.kind === 'text') { layer.addLabel(num(sh.x, 0.1), num(sh.y, 0.1), sh.label || 'note', color); break; }
      // draw
      if (sh.type === 'path' && Array.isArray(sh.points)) layer.addShape({ type: 'path', points: sh.points, color: color || layer.color, width: 4 });
      else if (sh.type === 'ellipse') layer.drawEllipse(num(sh.x, 0.2), num(sh.y, 0.2), num(sh.w, 0.3), num(sh.h, 0.2), color);
      else if (sh.type === 'line') layer.addShape({ type: 'line', x: num(sh.x, 0.1), y: num(sh.y, 0.1), x2: num(sh.x2, 0.5), y2: num(sh.y2, 0.5), color: color || layer.color });
      else layer.drawRect(num(sh.x, 0.1), num(sh.y, 0.1), num(sh.w, 0.3), num(sh.h, 0.2), color);
      if (sh.label) layer.addLabel(num(sh.x, 0.1), num(sh.y, 0.1) - 0.03, sh.label, color);
      break;
    }
    case 'dragdrop': {
      const layer = activeSurface().annotation;
      const from = Array.isArray(a.from) ? a.from : [0.2, 0.3];
      const to = Array.isArray(a.to) ? a.to : [0.7, 0.6];
      layer.animateToken([num(from[0], 0.2), num(from[1], 0.3)], [num(to[0], 0.7), num(to[1], 0.6)], a.label || 'sample');
      break;
    }
    // simulate / quiz / lesson are rendered as inline cards; nothing to apply on the surface
    default: break;
  }
  if (speak) {
    voice.say(speak, { providerId: settings.provider, voice: settings.voice });
  }
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; }

// ---- the request loop -------------------------------------------------------
async function submit() {
  if (busy) return;
  const text = inputEl.value.trim();
  if (!text) return;
  const p = getProvider(settings.provider);
  if (configured[settings.provider] === false) {
    conversation.addSystem(`${p.name} isn't configured on the server yet. Add its environment variable (see ⚙ Settings), then pick it again.`);
    openSettings({ onChange: (s) => { settings = s; renderProviderSelect(); renderModelSelect(); updateVoice(); } });
    return;
  }

  busy = true; sendBtn.disabled = true; mic.stop();
  inputEl.value = ''; autoGrow();
  conversation.addUser(text);
  history.push({ role: 'user', content: text });

  const meta = { model: settings.model, accent: providerAccent(settings.provider), logo: providerLogo(settings.provider, 15) };
  const ctrl = conversation.startAssistant(meta);

  const sys = buildSystemPrompt({ mode, persona: settings.persona, admin });
  const messages = [{ role: 'system', content: sys }, ...history.filter((m) => m.role !== 'system')];

  aborter = new AbortController();
  const scanner = createScanner();
  let acc = '';
  const handled = [];

  try {
    setStatus('thinking…');
    const full = await streamChat({
      providerId: settings.provider,
      model: settings.model,
      temperature: admin.temperature,
      messages,
      signal: aborter.signal,
      onDelta: (chunk) => {
        acc += chunk;
        // stream visible prose (studio fences stripped as they complete)
        ctrl.setRaw(scanner.displayText(acc));
        for (const a of scanner.scan(acc).actions) { handled.push(a); ctrl.card(a); executeAction(a); }
      }
    });
    ctrl.setRaw(scanner.displayText(acc || full));
    // ensure any block that only closed at very end is executed
    for (const a of scanner.scan(acc).actions) {
      if (!handled.includes(a)) { handled.push(a); ctrl.card(a); executeAction(a); }
    }
    ctrl.finish();
    history.push({ role: 'assistant', content: (acc || full) });
    saveHistory(history);
    firstTurn = false;

    // narration of the whole reply if no per-action speak fired and voice is on
    if (settings.voiceEnabled) {
      const said = handled.some((a) => a.speak);
      if (!said) {
        const plain = (acc || full).replace(/```studio[\s\S]*?```/g, '').replace(/[#*`>]/g, '').trim();
        if (plain) voice.say(plain.slice(0, 1200), { providerId: settings.provider, voice: settings.voice });
      }
    }
    setStatus(`${p.name} · ${settings.model}`);
  } catch (err) {
    if (err && err.name === 'AbortError') { setStatus('stopped'); ctrl.finish(); }
    else {
      const msg = String(err && err.message || err);
      conversation.addSystem(`Request failed (${p.name}): ${msg}`);
      ctrl.fail('⚠ ' + msg);
    }
  } finally {
    busy = false; sendBtn.disabled = false; aborter = null;
  }
}

// ---- composer events --------------------------------------------------------
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(180, inputEl.scrollHeight) + 'px';
}
inputEl.addEventListener('input', autoGrow);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});
sendBtn.addEventListener('click', () => { if (busy && aborter) { aborter.abort(); } else submit(); });

const mic = createListener((t, isFinal) => { inputEl.value = t; autoGrow(); if (isFinal) submit(); }, (st) => {
  micBtn.classList.toggle('listening', st === 'listening');
  if (st === 'unsupported') { micBtn.disabled = true; micBtn.title = 'Voice input not supported in this browser'; }
});
micBtn.addEventListener('click', () => { if (!mic.supported()) return; if (mic.isListening()) mic.stop(); else mic.start('en-US'); });

settingsBtn.addEventListener('click', () => openSettings({ onChange: (s) => { settings = s; renderProviderSelect(); renderModelSelect(); updateVoice(); } }));
adminBtn.addEventListener('click', () => openAdmin({
  onChange: ({ admin: a, settings: s }) => {
    admin = a; settings = s;
    renderProviderSelect(); renderModelSelect(); updateVoice();
    setStatus(`${PROVIDERS[settings.provider].name} · ${settings.model}`);
  }
}));
newBtn.addEventListener('click', () => {
  clearHistory(); history = []; firstTurn = true; conversation.clear(); bootGreeting();
});

// stop speaking if user starts a new turn while talking
inputEl.addEventListener('focus', () => voice.cancel());

// ---- boot greeting (deterministic Vincent credit) ---------------------------
function bootGreeting() {
  const meta = { model: '', accent: providerAccent(settings.provider), logo: providerLogo(settings.provider, 15) };
  const ctrl = conversation.startAssistant(meta);
  const greet = "Hi — I'm **KEZA**, your coding & web-design teaching agent. I was created by **IRAGUHA Vincent**. 👋\n\nI learn by *showing*: I'll write real code in the Studio, drive the 3D Graphics Lab, and draw, highlight and drag things right on screen while I explain. Pick a provider below and ask me anything. (API keys live on the server — see ⚙ Settings.)";
  ctrl.setRaw(renderMarkdown(greet));
  ctrl.finish();
}

// ---- init -------------------------------------------------------------------
renderProviderSelect();
renderModelSelect();
updateVoice();
setMode('code');
if (history.length === 0) {
  bootGreeting();
} else {
  // replay saved conversation (roles only; studio actions are not re-executed on reload)
  for (const m of history) {
    if (m.role === 'user') conversation.addUser(m.content);
    else if (m.role === 'assistant') {
      const ctrl = conversation.startAssistant({ accent: providerAccent(settings.provider), logo: providerLogo(settings.provider, 15) });
      ctrl.setRaw(renderMarkdown((m.content || '').replace(/```studio[\s\S]*?```/g, '')));
      ctrl.finish();
    }
  }
  firstTurn = false;
}

// Ask the backend which providers are configured; refresh the dropdowns.
(async function loadConfig() {
  const cfg = await fetchConfig();
  if (!cfg || !Array.isArray(cfg.providers)) return;
  cfg.providers.forEach((p) => { configured[p.id] = p.configured; });
  // if current provider isn't configured, switch to the first configured one
  if (configured[settings.provider] === false) {
    const alt = cfg.providers.find((p) => p.configured);
    if (alt) { settings.provider = alt.id; settings.model = PROVIDERS[alt.id].models[0]; saveSettings(settings); }
  }
  renderProviderSelect(); renderModelSelect();
  setStatus(`${PROVIDERS[settings.provider].name} · ${settings.model}`);
})();

window.addEventListener('resize', () => { studio.annotation.resize(); lab.annotation.resize(); });
