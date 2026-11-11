// Vercel serverless function: POST /api/chat -> normalised SSE from the active provider.
// Keys come from the project's Environment Variables (never from the client).
import { handleChat } from '../server/handlers.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export default async function handler(req, res) {
  await handleChat(req, res, process.env);
}
