/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'node:http';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp } from './src/server/app';
import { safeLogError } from './src/server/security';
import {
  getLatestStoreSnapshot,
  initBackgroundScheduler,
} from './src/server/whatsappService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isManagedContainer = Boolean(
  process.env.K_SERVICE || process.env.CLOUD_RUN_JOB
);
const HOST =
  (process.env.HOST || '').trim() ||
  (isManagedContainer ? '0.0.0.0' : '127.0.0.1');

async function startServer() {
  const { app, attachErrorMiddleware, tokenService } = createApiApp({
    port: PORT,
  });

  const httpServer = createServer(app);

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        ws: { server: httpServer },
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  attachErrorMiddleware();

  httpServer.listen(PORT, HOST, () => {
    console.log(`Arjun Groceries Server listening on http://${HOST}:${PORT}`);
    if (HOST === '0.0.0.0' && !tokenService.isConfigured) {
      console.warn(
        '[Security Notice] Server is bound to 0.0.0.0 without API_AUTH_TOKEN configured. Set API_AUTH_TOKEN and ALLOWED_ORIGINS before exposing externally.'
      );
    }
    // Start Weekly Sunday 12:00 PM IST Background Scheduler backed by persisted store snapshot
    initBackgroundScheduler(() => getLatestStoreSnapshot());
  });
}

startServer().catch((err) => {
  safeLogError('Server:startup', err, [
    process.env.GEMINI_API_KEY,
    process.env.API_AUTH_TOKEN,
    process.env.WHATSAPP_ACCESS_TOKEN,
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    process.env.WHATSAPP_APP_SECRET,
  ]);
  process.exit(1);
});
