// Vercel serverless function: POST /api/tts -> audio bytes via the provider's cloud TTS.
import { handleTTS } from '../server/handlers.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export default async function handler(req, res) {
  await handleTTS(req, res, process.env);
}
