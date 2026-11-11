// localStorage-backed UI settings + conversation persistence. No API keys live here —
// keys are server-side environment variables only.
const NS = 'teaching-agent:';

export function getJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}
export function setJSON(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (_) { /* quota */ }
}

export const DEFAULT_SETTINGS = {
  provider: 'openai',
  model: 'gpt-4o',
  voice: 'alloy',
  voiceEnabled: true,
  persona: 'mentor'        // 'mentor' | 'pair' | 'socratic'
};

export function loadSettings() {
  const stored = getJSON('settings', {});
  // Legacy browser-held secrets from the old browser-direct build — drop them so no key
  // ever lingers in localStorage. Keys now live only on the server.
  delete stored.keys;
  delete stored.baseURLOverrides;
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

export function saveSettings(s) {
  const clean = {
    provider: s.provider,
    model: s.model,
    voice: s.voice,
    voiceEnabled: s.voiceEnabled,
    persona: s.persona
  };
  setJSON('settings', clean);
}

export function loadHistory() { return getJSON('history', []); }
export function saveHistory(messages) { setJSON('history', messages.slice(-120)); }
export function clearHistory() { localStorage.removeItem(NS + 'history'); }

// ---- admin (operator) controls: how the AI behaves. Persisted locally. --------
export const DEFAULT_ADMIN = {
  temperature: 0.6,
  enabledProviders: {},   // id -> bool; undefined = follow server-configured
  skills: { code: true, run: true, lab: true, annotate: true, dragdrop: true, simulate: true, quiz: true, lesson: true },
  allowCode: true,        // master switch for code/run actions
  allowLab: true,         // master switch for 3D lab actions
  customInstructions: '', // appended to the system prompt
  maxSpeakChars: 1200
};

export function loadAdmin() {
  const stored = getJSON('admin', {});
  return Object.assign({}, DEFAULT_ADMIN, stored, {
    skills: Object.assign({}, DEFAULT_ADMIN.skills, stored.skills || {}),
    enabledProviders: Object.assign({}, stored.enabledProviders || {})
  });
}
export function saveAdmin(a) { setJSON('admin', a); }
