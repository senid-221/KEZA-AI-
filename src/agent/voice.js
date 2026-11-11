// Voice: speaking uses cloud TTS from the active provider (OpenAI /audio/speech, or
// Gemini TTS); listening uses the free browser SpeechRecognition where available.

import { speak as providerSpeak, getProvider } from './providers.js';

export function createVoice() {
  let current = null;
  let enabled = true;

  function cancel() {
    if (current) { try { current.pause(); } catch (_) {} current = null; }
  }

  async function say(text, { providerId, voice, signal }) {
    if (!enabled || !text || !text.trim()) return false;
    const p = getProvider(providerId);
    if (!p || !p.tts) return false; // provider has no voice — skip silently
    cancel();
    try {
      const audio = await providerSpeak({ providerId, text, voice, signal });
      if (!audio) return false;
      current = audio;
      await audio.play();
      audio.onended = () => { if (current === audio) current = null; };
      return true;
    } catch (_) {
      return false;
    }
  }

  function setEnabled(v) { enabled = Boolean(v); if (!enabled) cancel(); }
  function isEnabled() { return enabled; }
  function isSpeaking() { return Boolean(current && !current.paused); }

  return { say, cancel, setEnabled, isEnabled, isSpeaking };
}

// Simple browser STT helper for the mic button.
export function createListener(onText, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let listening = false;

  function supported() { return Boolean(SR); }

  function start(lang) {
    if (!SR) { onState && onState('unsupported'); return; }
    if (listening) { stop(); return; }
    rec = new SR();
    rec.lang = lang || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onstart = () => { listening = true; onState && onState('listening'); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      onText && onText(finalText || interim, Boolean(finalText));
    };
    rec.onerror = (e) => { onState && onState('error:' + e.error); stop(); };
    rec.onend = () => { stop(); };
    try { rec.start(); } catch (_) { stop(); }
  }

  function stop() {
    listening = false;
    if (rec) { try { rec.stop(); } catch (_) {} rec = null; }
    onState && onState('idle');
  }

  return { supported, start, stop, isListening: () => listening };
}
