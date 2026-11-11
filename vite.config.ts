import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { apiProxy } from './server/vite-proxy.mjs';

// loadEnv with an empty prefix pulls in ALL vars from .env / .env.local (server-only
// keys like OPENAI_API_KEY are NOT prefixed with VITE_, so they are never exposed to the
// browser bundle — they are only handed to the /api proxy middleware below).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), apiProxy(env)],
    server: {
      port: 3000,
      host: '0.0.0.0'
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          lab: resolve(__dirname, 'lab.html'),
          grass: resolve(__dirname, 'grass.html')
        }
      }
    }
  };
});
