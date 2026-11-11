// Vercel serverless function: GET /api/config -> which providers have a server key.
// Returns only booleans + env-var NAMES (never values).
import { handleConfig } from '../server/handlers.mjs';

export const runtime = 'nodejs';

export default async function handler(req, res) {
  await handleConfig(req, res, process.env);
}
