// Shared backend handlers used by the Vercel functions, the Vite dev middleware, and the
// plain Node server. They read keys from the passed `env` (process.env) and NEVER send a
// secret to the client. Chat responses are normalised to OpenAI-style SSE so the browser
// parser only has to understand one dialect.

import { PROVIDER_ENV, PROVIDER_IDS, buildUpstream, extractDelta, readSSE, isConfigured, baseFor } from './dialect.mjs';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('invalid JSON body')); } });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

// GET /api/config -> which providers have a server key. Non-secret.
export async function handleConfig(req, res, env) {
  const providers = PROVIDER_IDS.map((id) => ({
    id,
    name: PROVIDER_ENV[id].name,
    envKey: PROVIDER_ENV[id].key,
    configured: isConfigured(id, env)
  }));
  json(res, 200, { providers, ready: providers.some((p) => p.configured) });
}

// POST /api/chat  body {providerId, model, messages, temperature} -> normalised SSE
export async function handleChat(req, res, env) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const providerId = String(body.providerId || '');
  if (!PROVIDER_ENV[providerId]) return json(res, 400, { error: 'unknown providerId' });
  if (!isConfigured(providerId, env)) {
    return json(res, 501, { error: `${PROVIDER_ENV[providerId].name} is not configured on the server. Set ${PROVIDER_ENV[providerId].key}.` });
  }
  const model = String(body.model || '').trim();
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && typeof m.content === 'string') : [];
  if (!model || !messages.length) return json(res, 400, { error: 'model and messages are required' });

  let upstream;
  try {
    upstream = buildUpstream(providerId, { model, messages, temperature: Number(body.temperature) || 0.6 }, env);
  } catch (e) { return json(res, 500, { error: e.message }); }

  let resUp;
  try {
    resUp = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: JSON.stringify(upstream.body)
    });
  } catch (e) {
    return json(res, 502, { error: `Could not reach ${PROVIDER_ENV[providerId].name}: ${e.message}` });
  }
  if (!resUp.ok || !resUp.body) {
    let detail = '';
    try { detail = (await resUp.text()).slice(0, 600); } catch (_) {}
    return json(res, 502, { error: `HTTP ${resUp.status} from ${PROVIDER_ENV[providerId].name} — ${detail}` });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    for await (const payload of readSSE(resUp.body)) {
      if (payload === '[DONE]') break;
      let obj; try { obj = JSON.parse(payload); } catch (_) { continue; }
      const delta = extractDelta(upstream.dialect, obj);
      if (delta) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: 'stream interrupted: ' + e.message })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

// POST /api/tts  body {providerId, text, voice} -> audio bytes (mp3 or wav)
export async function handleTTS(req, res, env) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const providerId = String(body.providerId || '');
  const text = String(body.text || '').slice(0, 4000);
  if (!text) return json(res, 400, { error: 'text required' });

  if ((providerId === 'openai' || providerId === 'codex') && isConfigured(providerId, env)) {
    const base = baseFor(providerId, env);
    const up = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env[PROVIDER_ENV[providerId].key]}` },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', input: text, voice: body.voice || 'alloy', response_format: 'mp3' })
    });
    if (!up.ok) return json(res, 502, { error: `TTS HTTP ${up.status} — ${(await up.text()).slice(0, 300)}` });
    const buf = Buffer.from(await up.arrayBuffer());
    res.statusCode = 200; res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Cache-Control', 'no-store');
    return res.end(buf);
  }

  if (providerId === 'gemini' && isConfigured('gemini', env)) {
    const base = baseFor('gemini', env);
    const up = await fetch(`${base}/models/gemini-2.5-flash-preview-tts:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env[PROVIDER_ENV.gemini.key] },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], audioConfig: { voiceName: body.voice || 'Kore' } }
      })
    });
    if (!up.ok) return json(res, 502, { error: `Gemini TTS HTTP ${up.status} — ${(await up.text()).slice(0, 300)}` });
    const j = await up.json();
    const part = j?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
    if (!part) return json(res, 502, { error: 'Gemini TTS returned no audio' });
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const wav = pcmToWav(pcm, 24000);
    res.statusCode = 200; res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store');
    return res.end(wav);
  }

  return json(res, 501, { error: `${providerId || 'provider'} has no text-to-speech on the server` });
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
