# KEZA — Coding Teaching Agent

A talking, visual AI tutor that teaches **coding and web design** by *showing* what it
does. KEZA writes real code into a live editor, runs it, drives a 3D graphics lab, and
draws / highlights / drag-drops on screen while it explains — all in one growing inline
conversation. Created by IRAGUHA Vincent.

Built on the original **3D GPU Fur Simulation** (Three.js + Vite), which is now the
agent's "Graphics Lab" teaching surface.

## Run

```bash
npm install
cp .env.example .env.local   # fill in the provider keys you have (server-side only)
npm run dev                  # http://localhost:3000  (Vite serves the /api proxy too)
npm run build                # production bundle
node tests/providers-sse.test.mjs   # backend dialect + SSE normalisation tests
node tests/scanner.test.mjs         # studio-action protocol tests
```

API keys are **never stored in the browser**. The frontend only calls our own backend
(`/api/chat`, `/api/tts`, `/api/config`); the backend injects the provider secret from
environment variables and streams a normalised response back. Open **⚙ Settings** to see
which providers are active on the server.

## Providers (real logos, via the backend proxy)

OpenAI · OpenAI Codex (Responses API) · Anthropic · NVIDIA · Google Gemini · OpenRouter ·
Alibaba Cloud (DashScope) · Free-LLM (any OpenAI-compatible endpoint, e.g. Groq).
Each provider speaks its own real streaming SSE dialect; the backend normalises them all
to one shape for the client. Voice answers aloud via cloud TTS (OpenAI / Gemini); mic
input uses browser speech recognition.

## Environment variables

| Variable | Provider |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI + OpenAI Codex + voice TTS |
| `ANTHROPIC_API_KEY` | Anthropic |
| `NVIDIA_API_KEY` | NVIDIA |
| `GEMINI_API_KEY` | Google Gemini + Gemini TTS |
| `OPENROUTER_API_KEY` | OpenRouter |
| `ALIBABA_API_KEY` | Alibaba Cloud |
| `FREE_LLM_API_KEY` / `FREE_LLM_BASE_URL` | Free-LLM (default base = Groq) |

Optional regional/proxy overrides: `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`,
`NVIDIA_BASE_URL`, `GEMINI_BASE_URL`, `OPENROUTER_BASE_URL`, `ALIBABA_BASE_URL`.

## Deploy to Vercel

1. Push this repo and import it in Vercel (Framework: **Vite**, build `npm run build`,
   output `dist`). `vercel.json` wires the SPA fallback and the `api/*.mjs` functions.
2. **Project ▸ Settings ▸ Environment Variables** — add the names above (Production,
   Preview, Development) with your keys, then redeploy.
3. A provider appears in the app as soon as its variable is set. `/api/config` reports
   status; keys are never sent to the client.

## Skills

- **Code Studio** — HTML/CSS/JS editor with a live same-origin preview the agent edits and runs.
- **Graphics Lab** — the 3D Mochi-Puff sim, driven by the agent through a sandboxed `window.__mochiLab` bridge.
- **Draw / Highlight / Drag-drop** — an annotation overlay for the agent and the learner.
- **NVIDIA NeMo skills** — the uploaded NeMo catalog surfaced as clickable teaching topics.

## Structure

- `index.html` + `src/agent/*` — the agent app (frontend; talks only to `/api/*`).
- `server/dialect.mjs` + `server/handlers.mjs` — env-driven backend proxy (shared by Vercel, Vite dev, and `server.js`).
- `api/chat.mjs`, `api/tts.mjs`, `api/config.mjs` — Vercel serverless functions.
- `lab.html` + `src/main.js` — the 3D Graphics Lab (fur sim) with the agent control bridge.
- `public/logos/` — official brand SVGs.
