// Front-end provider layer. The browser NEVER sees an API key: it only calls our own
// backend (/api/chat, /api/tts, /api/config). The backend injects the provider secret from
// process.env and normalises every provider's stream into one OpenAI-style SSE dialect, so
// this file only has to parse that single shape.

import { providerIcon, BRAND } from './logos.js';

// UI metadata only (model lists, names, logos, which providers support voice).
export const PROVIDERS = {
  openai:     { id: 'openai',     name: 'OpenAI',         models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'o3-mini'], tts: true, logo: 'openai' },
  codex:      { id: 'codex',      name: 'OpenAI Codex',   models: ['gpt-5-codex', 'codex-mini-latest', 'gpt-4.1'], tts: true, logo: 'openai' },
  anthropic:  { id: 'anthropic',  name: 'Anthropic',      models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-latest', 'claude-haiku-4-5'], tts: false, logo: 'anthropic' },
  nvidia:     { id: 'nvidia',     name: 'NVIDIA',         models: ['nvidia/llama-3.3-nemotron-super-49b-v1', 'meta/llama-3.1-70b-instruct', 'nvidia/nemotron-4-340b-instruct', 'deepseek-ai/deepseek-r1'], tts: false, logo: 'nvidia' },
  gemini:     { id: 'gemini',     name: 'Google Gemini',  models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash-preview-05-20'], tts: true, logo: 'googlegemini' },
  openrouter: { id: 'openrouter', name: 'OpenRouter',     models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'], tts: false, logo: 'openrouter' },
  alibaba:    { id: 'alibaba',    name: 'Alibaba Cloud',  models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-coder-32b-instruct', 'qwq-32b'], tts: false, logo: 'alibabacloud' },
  freel:      { id: 'freel',      name: 'Free-LLM',       models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gpt-4o-mini', 'mistral-small-latest'], tts: false, logo: 'freel' }
};

export const PROVIDER_ORDER = ['openai', 'codex', 'anthropic', 'nvidia', 'gemini', 'openrouter', 'alibaba', 'freel'];

export function getProvider(id) { return PROVIDERS[id] || null; }
export function providerLogo(id, size) { const p = PROVIDERS[id]; return providerIcon(p ? p.logo : 'openai', size); }
export function providerAccent(id) { return (BRAND[id] || { accent: '#888' }).accent; }

async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) { const payload = line.slice(5).trim(); if (payload) yield payload; }
    }
  }
}

// Stream a chat turn through the backend proxy. onDelta receives text chunks.
export async function streamChat({ providerId, model, messages, temperature = 0.6, signal, onDelta }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, model, messages, temperature }),
    signal
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.error ? j.error : JSON.stringify(j); }
    catch (_) { try { detail = await res.text(); } catch (__) {} }
    throw new Error(`HTTP ${res.status} — ${truncate(detail, 400)}`);
  }
  let full = '';
  for await (const payload of readSSE(res)) {
    if (payload === '[DONE]') break;
    let obj; try { obj = JSON.parse(payload); } catch (_) { continue; }
    if (obj && obj.error) throw new Error(String(obj.error));
    const chunk = obj?.choices?.[0]?.delta?.content || '';
    if (chunk) { full += chunk; if (onDelta) onDelta(chunk); }
  }
  return full;
}

// Cloud text-to-speech via the backend. Returns an Audio element or null.
export async function speak({ providerId, text, voice, signal }) {
  const p = PROVIDERS[providerId];
  if (!p || !p.tts) return null;
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, text, voice }),
    signal
  });
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json()).error || ''; } catch (_) {}
    throw new Error(`TTS HTTP ${res.status} — ${detail}`);
  }
  const blob = await res.blob();
  return new Audio(URL.createObjectURL(blob));
}

// Which providers are configured on the server (booleans only).
export async function fetchConfig() {
  try { const r = await fetch('/api/config'); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; }
}

export function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
