import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/server/routes.ts';
import { realtimeHub } from './src/server/realtime.ts';
import { ensureSeeded } from './src/server/seed.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Lazy non-blocking database seed guard on API requests
  app.use('/api', async (_req, res, next) => {
    try {
      await ensureSeeded();
      next();
    } catch (err) {
      console.error('Database initialization error:', err);
      res.status(503).json({ error: 'Database is initializing, please retry shortly.' });
    }
  });

  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  realtimeHub.init(server);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      plugins: [
        {
          name: 'disable-vite-hmr-client-ws',
          transform(code, id) {
            if (id.replace(/\\/g, '/').endsWith('/vite/dist/client/client.mjs')) {
              return {
                code: code.replace(
                  /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                  'const transport = normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} });'
                ),
                map: null,
              };
            }
          },
        },
      ],
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`EmberTable server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
