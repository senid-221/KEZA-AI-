// Settings modal. API keys are NOT entered here — they live as server environment
// variables (Vercel Project ▸ Settings ▸ Environment Variables). This panel shows which
// providers are active on the backend and lets the learner pick persona + voice.

import { PROVIDERS, PROVIDER_ORDER, providerLogo, fetchConfig } from './providers.js';
import { loadSettings, saveSettings } from './store.js';

export function openSettings({ onChange } = {}) {
  const s = loadSettings();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-head">
      <h2>Agent settings</h2>
      <button class="icon-btn" id="close-x" aria-label="Close">✕</button>
    </div>
    <p class="modal-sub">API keys are stored <strong>on the server</strong> as environment variables — never in this browser.
      Add them in <strong>Vercel ▸ Project ▸ Settings ▸ Environment Variables</strong> (or a local <code>.env.local</code> for <code>npm run dev</code>).
      A provider becomes usable here once its variable is set.</p>
    <div class="server-key-list" id="key-list"><div class="sk-loading">Checking server…</div></div>

    <div class="modal-foot">
      <label class="field">Persona
        <select id="persona">
          <option value="mentor">Warm mentor</option>
          <option value="pair">Pair programmer</option>
          <option value="socratic">Socratic</option>
        </select>
      </label>
      <label class="field">Voice
        <select id="voiceSel">
          <option value="alloy">OpenAI · alloy</option>
          <option value="nova">OpenAI · nova</option>
          <option value="sage">OpenAI · sage</option>
          <option value="Kore">Gemini · Kore</option>
          <option value="Puck">Gemini · Puck</option>
        </select>
      </label>
      <label class="toggle"><input type="checkbox" id="voiceOn" /> Speak answers aloud</label>
    </div>`;

  const list = modal.querySelector('#key-list');

  fetchConfig().then((cfg) => {
    list.replaceChildren();
    const byId = {};
    (cfg && cfg.providers ? cfg.providers : []).forEach((p) => { byId[p.id] = p; });
    for (const id of PROVIDER_ORDER) {
      const p = PROVIDERS[id];
      const info = byId[id];
      const configured = info ? info.configured : false;
      const envKey = info ? info.envKey : (id === 'codex' ? 'OPENAI_API_KEY' : id.toUpperCase() + '_API_KEY');
      const row = document.createElement('div');
      row.className = 'sk-row' + (configured ? ' on' : '');
      const logo = document.createElement('span'); logo.className = 'sk-logo'; logo.innerHTML = providerLogo(id, 18);
      const nm = document.createElement('span'); nm.className = 'sk-name'; nm.textContent = p.name;
      const env = document.createElement('code'); env.className = 'sk-env'; env.textContent = envKey;
      const badge = document.createElement('span'); badge.className = 'sk-badge'; badge.textContent = configured ? 'ready' : 'not set';
      row.append(logo, nm, env, badge);
      list.appendChild(row);
    }
    if (!cfg) { const n = document.createElement('div'); n.className = 'sk-loading'; n.textContent = 'Could not reach /api/config (is the backend running?)'; list.appendChild(n); }
  });

  modal.querySelector('#persona').value = s.persona;
  modal.querySelector('#voiceSel').value = s.voice;
  modal.querySelector('#voiceOn').checked = Boolean(s.voiceEnabled);
  modal.querySelector('#persona').addEventListener('change', (e) => { s.persona = e.target.value; });
  modal.querySelector('#voiceSel').addEventListener('change', (e) => { s.voice = e.target.value; });
  modal.querySelector('#voiceOn').addEventListener('change', (e) => { s.voiceEnabled = e.target.checked; });

  modal.querySelector('#close-x').addEventListener('click', () => {
    saveSettings(s);
    overlay.remove();
    if (onChange) onChange(loadSettings());
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) modal.querySelector('#close-x').click(); });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { close: () => overlay.remove() };
}
