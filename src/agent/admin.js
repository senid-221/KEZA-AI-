// Admin dashboard — operator controls for the AI. Governs which providers are available,
// the default model + temperature, which skills/actions the agent may perform, code/lab
// guardrails, custom system instructions, and teaching persona/voice. Persisted locally.

import { PROVIDERS, PROVIDER_ORDER, providerLogo, providerAccent, fetchConfig } from './providers.js';
import { SKILLS } from './agent.js';
import { loadAdmin, saveAdmin, loadSettings, saveSettings } from './store.js';

function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

export function openAdmin({ onChange } = {}) {
  const admin = loadAdmin();
  const settings = loadSettings();

  const overlay = el('div', 'admin-overlay');
  const panel = el('div', 'admin-panel');

  // header
  const head = el('div', 'admin-head');
  head.appendChild(el('div', 'admin-title', 'KEZA · Admin dashboard'));
  head.appendChild(el('div', 'admin-sub', 'Control which models the AI can use and what it is allowed to do.'));
  const closeBtn = el('button', 'admin-close', '✕');
  closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close admin');
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const body = el('div', 'admin-body');
  panel.appendChild(body);

  const dirty = { touched: false };

  // ---- section helper ----
  function section(title, hint) {
    const s = el('section', 'admin-sec');
    s.appendChild(el('h3', 'admin-sec-title', title));
    if (hint) s.appendChild(el('p', 'admin-sec-hint', hint));
    body.appendChild(s);
    return s;
  }

  // ---- Providers & models ----
  const provSec = section('Providers & models', 'A provider is selectable only when the server has its key AND it is enabled here.');
  const provList = el('div', 'admin-prov-list');
  provSec.appendChild(provList);

  const modelRow = el('div', 'admin-inline');
  modelRow.appendChild(el('label', 'admin-lbl', 'Default provider'));
  const defaultProviderSel = el('select', 'admin-select');
  modelRow.appendChild(defaultProviderSel);
  const modelSel = el('select', 'admin-select admin-model');
  modelRow.appendChild(el('label', 'admin-lbl', 'Default model'));
  modelRow.appendChild(modelSel);
  provSec.appendChild(modelRow);

  const tempRow = el('div', 'admin-inline');
  const tempLbl = el('label', 'admin-lbl', 'Temperature');
  const tempRange = el('input', 'admin-range'); tempRange.type = 'range'; tempRange.min = '0'; tempRange.max = '1.5'; tempRange.step = '0.1'; tempRange.value = String(admin.temperature);
  const tempVal = el('span', 'admin-range-val', Number(admin.temperature).toFixed(1));
  tempRange.addEventListener('input', () => { tempVal.textContent = Number(tempRange.value).toFixed(1); admin.temperature = Number(tempRange.value); dirty.touched = true; });
  tempRow.append(tempLbl, tempRange, tempVal);
  provSec.appendChild(tempRow);

  let serverCfg = {};
  function renderProviders() {
    provList.replaceChildren();
    defaultProviderSel.replaceChildren();
    for (const id of PROVIDER_ORDER) {
      const p = PROVIDERS[id];
      const configured = serverCfg[id] === true;
      const enabled = admin.enabledProviders[id] !== false;
      const row = el('div', 'admin-prov' + (configured && enabled ? ' on' : ''));
      const logo = el('span', 'ap-logo'); logo.innerHTML = providerLogo(id, 18);
      const nm = el('span', 'ap-name', p.name);
      const status = el('span', 'ap-status', configured ? 'server ready' : 'no server key');
      const toggle = el('button', 'ap-toggle' + (enabled ? ' on' : '')); toggle.type = 'button';
      toggle.textContent = enabled ? 'Enabled' : 'Disabled';
      toggle.disabled = !configured;
      toggle.addEventListener('click', () => {
        admin.enabledProviders[id] = !(admin.enabledProviders[id] !== false);
        dirty.touched = true; renderProviders();
      });
      row.append(logo, nm, status, toggle);
      provList.appendChild(row);

      if (configured && enabled) {
        const o = el('option', null, p.name); o.value = id;
        if (id === settings.provider) o.selected = true;
        defaultProviderSel.appendChild(o);
      }
    }
    if (!defaultProviderSel.children.length) {
      const o = el('option', null, 'None available'); o.value = ''; defaultProviderSel.appendChild(o);
    }
    renderModels();
  }
  function renderModels() {
    const id = defaultProviderSel.value || settings.provider;
    const p = PROVIDERS[id] || PROVIDERS[PROVIDER_ORDER[0]];
    modelSel.replaceChildren();
    for (const m of p.models) { const o = el('option', null, m); o.value = m; if (m === settings.model) o.selected = true; modelSel.appendChild(o); }
  }
  defaultProviderSel.addEventListener('change', () => {
    settings.provider = defaultProviderSel.value;
    const p = PROVIDERS[settings.provider]; if (p) settings.model = p.models[0];
    dirty.touched = true; renderModels();
  });
  modelSel.addEventListener('change', () => { settings.model = modelSel.value; dirty.touched = true; });

  // ---- Skills ----
  const skillSec = section('Skills & actions', 'Turn off anything you do not want the AI to do on screen.');
  const skillGrid = el('div', 'admin-skill-grid');
  skillSec.appendChild(skillGrid);
  for (const s of SKILLS) {
    const on = admin.skills[s.id] !== false;
    const card = el('div', 'admin-skill' + (on ? ' on' : ''));
    card.appendChild(el('div', 'as-name', s.title));
    card.appendChild(el('div', 'as-hint', s.hint));
    const t = el('button', 'as-toggle' + (on ? ' on' : '')); t.type = 'button'; t.textContent = on ? 'On' : 'Off';
    t.addEventListener('click', () => {
      admin.skills[s.id] = !(admin.skills[s.id] !== false);
      card.classList.toggle('on', admin.skills[s.id] !== false);
      t.classList.toggle('on', admin.skills[s.id] !== false);
      t.textContent = admin.skills[s.id] !== false ? 'On' : 'Off';
      dirty.touched = true;
    });
    card.appendChild(t);
    skillGrid.appendChild(card);
  }

  // ---- Guardrails ----
  const guardSec = section('Guardrails', 'Master switches that override individual skills.');
  function switchRow(label, hint, get, set) {
    const r = el('div', 'admin-switch');
    const txt = el('div', 'as-txt'); txt.appendChild(el('div', 'as-name', label)); txt.appendChild(el('div', 'as-hint', hint));
    const b = el('button', 'as-toggle' + (get() ? ' on' : '')); b.type = 'button'; b.textContent = get() ? 'Allowed' : 'Blocked';
    b.addEventListener('click', () => { set(!get()); b.classList.toggle('on', get()); b.textContent = get() ? 'Allowed' : 'Blocked'; dirty.touched = true; });
    r.append(txt, b); guardSec.appendChild(r);
  }
  switchRow('Code editing', 'Allow the AI to write & run code in the Code Studio.', () => admin.allowCode !== false, (v) => { admin.allowCode = v; });
  switchRow('3D Graphics Lab', 'Allow the AI to drive the Mochi-Puff 3D scene.', () => admin.allowLab !== false, (v) => { admin.allowLab = v; });

  // ---- Custom instructions ----
  const ciSec = section('Custom instructions', 'Extra rules appended to the system prompt (e.g. always answer in Kinyarwanda, or focus on accessibility).');
  const ci = el('textarea', 'admin-textarea'); ci.placeholder = 'Optional operator instructions for KEZA…'; ci.value = admin.customInstructions || '';
  ci.addEventListener('input', () => { admin.customInstructions = ci.value.slice(0, 4000); dirty.touched = true; });
  ciSec.appendChild(ci);

  // ---- Persona & voice ----
  const pvSec = section('Teaching style & voice');
  const pvRow = el('div', 'admin-inline');
  const personaSel = el('select', 'admin-select');
  [['mentor', 'Warm mentor'], ['pair', 'Pair programmer'], ['socratic', 'Socratic']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; if (settings.persona === v) o.selected = true; personaSel.appendChild(o); });
  personaSel.addEventListener('change', () => { settings.persona = personaSel.value; dirty.touched = true; });
  pvRow.append(el('label', 'admin-lbl', 'Persona'), personaSel);
  const voiceBtn = el('button', 'as-toggle' + (settings.voiceEnabled ? ' on' : '')); voiceBtn.type = 'button'; voiceBtn.textContent = settings.voiceEnabled ? 'Voice on' : 'Voice off';
  voiceBtn.addEventListener('click', () => { settings.voiceEnabled = !settings.voiceEnabled; voiceBtn.classList.toggle('on', settings.voiceEnabled); voiceBtn.textContent = settings.voiceEnabled ? 'Voice on' : 'Voice off'; dirty.touched = true; });
  pvRow.append(el('label', 'admin-lbl', 'Speak aloud'), voiceBtn);
  pvSec.appendChild(pvRow);

  // ---- status ----
  const statusSec = section('Status');
  const statusLine = el('div', 'admin-status');
  statusSec.appendChild(statusLine);
  function updateStatus() {
    const avail = PROVIDER_ORDER.filter((id) => serverCfg[id] === true && admin.enabledProviders[id] !== false);
    statusLine.textContent = `Ready: ${avail.length ? avail.map((i) => PROVIDERS[i].name).join(', ') : 'no providers yet'} · model ${settings.model} · temp ${admin.temperature.toFixed(1)}`;
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function close() {
    if (dirty.touched) { saveAdmin(admin); saveSettings(settings); if (onChange) onChange({ admin: loadAdmin(), settings: loadSettings() }); }
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });

  // initial provider render, then async config
  renderProviders(); updateStatus();
  fetchConfig().then((cfg) => {
    if (cfg && Array.isArray(cfg.providers)) cfg.providers.forEach((p) => { serverCfg[p.id] = p.configured; });
    renderProviders(); updateStatus();
  });

  return { close };
}
