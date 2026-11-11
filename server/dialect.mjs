// Server-side provider dialect. Runs ONLY on the backend (Vercel function / Node / Vite
// dev middleware). Reads API keys from process.env — secrets never reach the browser.
// buildUpstream() produces the real request for each provider; extractDelta() pulls one
// text delta out of that provider's SSE chunk so the proxy can normalise every backend
// into a single OpenAI-style stream for the client.

export const PROVIDER_ENV = {
  openai:     { key: 'OPENAI_API_KEY',      baseURL: 'OPENAI_BASE_URL',      family: 'openai',    dialect: 'openai',    defaultBase: 'https://api.openai.com/v1', name: 'OpenAI' },
  codex:      { key: 'OPENAI_API_KEY',      baseURL: 'OPENAI_BASE_URL',      family: 'openai',    dialect: 'responses', defaultBase: 'https://api.openai.com/v1', name: 'OpenAI Codex' },
  anthropic:  { key: 'ANTHROPIC_API_KEY',   baseURL: 'ANTHROPIC_BASE_URL',   family: 'anthropic', dialect: 'anthropic', defaultBase: 'https://api.anthropic.com/v1', name: 'Anthropic' },
  nvidia:     { key: 'NVIDIA_API_KEY',      baseURL: 'NVIDIA_BASE_URL',      family: 'openai',    dialect: 'openai',    defaultBase: 'https://integrate.api.nvidia.com/v1', name: 'NVIDIA' },
  gemini:     { key: 'GEMINI_API_KEY',      baseURL: 'GEMINI_BASE_URL',      family: 'gemini',    dialect: 'gemini',    defaultBase: 'https://generativelanguage.googleapis.com/v1beta', name: 'Google Gemini' },
  openrouter: { key: 'OPENROUTER_API_KEY',  baseURL: 'OPENROUTER_BASE_URL',  family: 'openai',    dialect: 'openai',    defaultBase: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
  alibaba:    { key: 'ALIBABA_API_KEY',     baseURL: 'ALIBABA_BASE_URL',     family: 'openai',    dialect: 'openai',    defaultBase: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', name: 'Alibaba Cloud' },
  freel:      { key: 'FREE_LLM_API_KEY',    baseURL: 'FREE_LLM_BASE_URL',    family: 'openai',    dialect: 'openai',    defaultBase: 'https://api.groq.com/openai/v1', name: 'Free-LLM' }
};

export const PROVIDER_IDS = Object.keys(PROVIDER_ENV);

export function isConfigured(providerId, env) {
  const cfg = PROVIDER_ENV[providerId];
  return Boolean(cfg && env && env[cfg.key]);
}

export function baseFor(providerId, env) {
  const cfg = PROVIDER_ENV[providerId];
  const fromEnv = env && env[cfg.baseURL];
  return (fromEnv || cfg.defaultBase).replace(/\/+$/, '');
}

// messages: [{role:'system'|'user'|'assistant', content:string}]
export function buildUpstream(providerId, { model, messages, temperature = 0.6 }, env) {
  const cfg = PROVIDER_ENV[providerId];
  if (!cfg) throw new Error('unknown provider: ' + providerId);
  const apiKey = env[cfg.key];
  if (!apiKey) throw new Error('provider not configured on server: ' + providerId);
  const base = baseFor(providerId, env);
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system');

  if (cfg.family === 'gemini') {
    const contents = chat.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents, generationConfig: { temperature } };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return {
      url: `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      dialect: 'gemini',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body
    };
  }

  if (cfg.family === 'anthropic') {
    const body = { model, max_tokens: 4096, stream: true, messages: chat, temperature };
    if (sys) body.system = sys;
    return {
      url: `${base}/messages`, dialect: 'anthropic',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body
    };
  }

  if (cfg.dialect === 'responses') {
    const input = chat.map((m) => ({ role: m.role, content: m.content }));
    const body = { model, input, stream: true };
    if (sys) body.instructions = sys;
    return {
      url: `${base}/responses`, dialect: 'responses',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body
    };
  }

  const body = { model, messages, stream: true, temperature };
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  if (providerId === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://vercel.app', 'X-Title': 'KEZA Coding Agent' });
  return { url: `${base}/chat/completions`, dialect: 'openai', headers, body };
}

// Pull one text delta out of a provider chunk. Returns '' to skip.
export function extractDelta(dialect, obj) {
  try {
    if (dialect === 'openai') {
      const d = obj?.choices?.[0]?.delta;
      return (d?.content) || (d?.reasoning_content) || '';
    }
    if (dialect === 'responses') {
      return obj?.type === 'response.output_text.delta' ? (obj.delta || '') : '';
    }
    if (dialect === 'anthropic') {
      return obj?.type === 'content_block_delta' && obj?.delta?.type === 'text_delta' ? (obj.delta.text || '') : '';
    }
    if (dialect === 'gemini') {
      const parts = obj?.candidates?.[0]?.content?.parts || [];
      return parts.map((x) => x.text || '').join('');
    }
  } catch (_) { /* ignore malformed chunk */ }
  return '';
}

// Yield each `data:` payload string from a web ReadableStream (Node 18+ / Vercel).
export async function* readSSE(body) {
  const reader = body.getReader();
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
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) yield payload;
      }
    }
  }
}
