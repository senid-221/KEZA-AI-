// Backend proxy test — verifies server/dialect buildUpstream + extractDelta for every
// provider family, and that handleChat normalises each provider's real SSE dialect into a
// single OpenAI-style stream for the client. Runs with a fake fetch + fake Node req/res.

import { EventEmitter } from 'node:events';
import { buildUpstream, extractDelta, isConfigured, baseFor, PROVIDER_ENV } from '../server/dialect.mjs';
import { handleChat } from '../server/handlers.mjs';

let fail = 0, pass = 0;
const ok = (c, m) => { c ? (pass++, console.log('PASS ' + m)) : (fail++, console.log('FAIL ' + m)); };

const env = {
  OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant', NVIDIA_API_KEY: 'nvapi',
  GEMINI_API_KEY: 'AIza', OPENROUTER_API_KEY: 'sk-or', ALIBABA_API_KEY: 'sk-a',
  FREE_LLM_API_KEY: 'gsk', FREE_LLM_BASE_URL: 'https://api.groq.com/openai/v1'
};

const messages = [
  { role: 'system', content: 'sys prompt' },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'yo' },
  { role: 'user', content: 'again' }
];

// ---- buildUpstream per family ----
const oai = buildUpstream('openai', { model: 'gpt-4o', messages }, env);
ok(oai.url === 'https://api.openai.com/v1/chat/completions' && oai.dialect === 'openai', 'openai chat/completions');
ok(oai.headers.Authorization === 'Bearer sk-test', 'openai bearer from env');

const cod = buildUpstream('codex', { model: 'gpt-5-codex', messages }, env);
ok(cod.url.endsWith('/responses') && cod.dialect === 'responses' && cod.body.instructions === 'sys prompt', 'codex Responses API + instructions');

const ant = buildUpstream('anthropic', { model: 'claude-sonnet-4-5', messages }, env);
ok(ant.url === 'https://api.anthropic.com/v1/messages' && ant.headers['x-api-key'] === 'sk-ant' && ant.headers['anthropic-version'] === '2023-06-01', 'anthropic headers');
ok(ant.body.system === 'sys prompt' && ant.body.messages.length === 3, 'anthropic splits system out of messages');

const gem = buildUpstream('gemini', { model: 'gemini-2.0-flash', messages }, env);
ok(gem.url.includes('models/gemini-2.0-flash:streamGenerateContent?alt=sse') && gem.headers['x-goog-api-key'] === 'AIza', 'gemini stream + key header');
ok(gem.body.contents[1].role === 'model' && gem.body.systemInstruction.parts[0].text === 'sys prompt', 'gemini role mapping + systemInstruction');

const or = buildUpstream('openrouter', { model: 'x', messages }, env);
ok(or.headers['HTTP-Referer'] && or.headers['X-Title'], 'openrouter referer/title');

const al = buildUpstream('alibaba', { model: 'x', messages }, env);
ok(al.url.includes('dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'), 'alibaba compatible-mode');

const fl = buildUpstream('freel', { model: 'x', messages }, env);
ok(fl.url === 'https://api.groq.com/openai/v1/chat/completions', 'freel honours FREE_LLM_BASE_URL env override');

// ---- config gating ----
ok(isConfigured('openai', env) === true, 'openai configured when key present');
ok(isConfigured('openai', {}) === false, 'openai not configured without key');
ok(baseFor('openai', env) === 'https://api.openai.com/v1', 'baseFor default base');
ok(baseFor('openai', { ...env, OPENAI_BASE_URL: 'https://proxy.local/v1' }) === 'https://proxy.local/v1', 'baseFor env override');
let threw = false; try { buildUpstream('openai', { model: 'x', messages }, {}); } catch (_) { threw = true; }
ok(threw, 'buildUpstream throws when provider unconfigured');

// ---- extractDelta per dialect ----
ok(extractDelta('openai', { choices: [{ delta: { content: 'A' } }] }) === 'A', 'extract openai');
ok(extractDelta('responses', { type: 'response.output_text.delta', delta: 'B' }) === 'B', 'extract responses');
ok(extractDelta('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'C' } }) === 'C', 'extract anthropic');
ok(extractDelta('gemini', { candidates: [{ content: { parts: [{ text: 'D' }, { text: 'E' }] } }] }) === 'DE', 'extract gemini joins parts');
ok(extractDelta('openai', { choices: [{ delta: {} }] }) === '', 'extract empty delta');

// ---- handleChat normalises each provider's real SSE into OpenAI-style ----
function sseResponse(chunks) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
function makeReq(obj) {
  const r = new EventEmitter(); r.method = 'POST';
  setImmediate(() => { r.emit('data', JSON.stringify(obj)); r.emit('end'); });
  return r;
}
function makeRes() {
  const res = {
    statusCode: 0, headersSent: false, _h: {}, _buf: '',
    setHeader(k, v) { this._h[k] = v; },
    write(s) { this._buf += s; this.headersSent = true; return true; },
    end(s) { if (s) this._buf += s; if (this._done) this._done(); },
    flushHeaders() {}
  };
  res.finished = new Promise((r) => { res._done = r; });
  return res;
}
function joinedContent(sse) {
  let out = '';
  for (const line of sse.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const p = t.slice(5).trim();
    if (p === '[DONE]') continue;
    try { out += JSON.parse(p).choices?.[0]?.delta?.content || ''; } catch (_) {}
  }
  return out;
}

async function runChat(providerId, upstreamChunks, expect) {
  const of = globalThis.fetch;
  globalThis.fetch = async () => sseResponse(upstreamChunks);
  const res = makeRes();
  await handleChat(makeReq({ providerId, model: 'm', messages }), res, env);
  globalThis.fetch = of;
  ok(joinedContent(res._buf) === expect, `handleChat normalises [${providerId}] -> "${expect}"`);
  ok(res._buf.includes('data: [DONE]'), `handleChat emits [DONE] [${providerId}]`);
  ok((res._h['Content-Type'] || '').includes('text/event-stream'), `handleChat SSE content-type [${providerId}]`);
}

await runChat('openai', [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: [DONE]\n\n'
], 'Hello');

await runChat('anthropic', [
  'event: ping\ndata: {"type":"ping"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Cla"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ude"}}\n\n'
], 'Claude');

await runChat('gemini', [
  'data: {"candidates":[{"content":{"parts":[{"text":"Gem"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":"ini"}]}}]}\n\n'
], 'Gemini');

await runChat('codex', [
  'data: {"type":"response.output_text.delta","delta":"Co"}\n\n',
  'data: {"type":"response.output_text.delta","delta":"dex"}\n\n'
], 'Codex');

// unconfigured provider -> 501 JSON, no stream
{
  const res = makeRes();
  await handleChat(makeReq({ providerId: 'nvidia', model: 'm', messages }), { ...res, ...{ _h: {} } }, { /* no NVIDIA key */ });
}
{
  const res = makeRes();
  await handleChat(makeReq({ providerId: 'nvidia', model: 'm', messages }), res, {});
  ok(res.statusCode === 501, 'handleChat 501 when provider unconfigured');
  ok(res._buf.includes('not configured'), 'handleChat explains missing env var');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
