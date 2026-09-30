import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export async function startE2EServer(
  options: { port?: number; distDir?: string; tempRoot?: string } = {},
) {
  const distDir = options.distDir ?? path.join(ROOT, 'dist');
  try {
    await access(path.join(distDir, 'index.html'));
  } catch {
    throw new Error('The E2E server requires a production build. Run npm run build first.');
  }
  process.env.NODE_ENV = 'production';
  const dataDir = await mkdtemp(path.join(options.tempRoot ?? tmpdir(), 'emotistudio-e2e-'));
  let instance: ReturnType<typeof createApp> | undefined;
  let server: Server | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        if (server?.listening) {
          const httpServer = server;
          const forceClose = setTimeout(() => httpServer.closeAllConnections(), 10_000);
          forceClose.unref();
          try {
            await new Promise<void>((resolve, reject) => {
              httpServer.close((error) => (error ? reject(error) : resolve()));
            });
          } finally {
            clearTimeout(forceClose);
          }
        }
      } finally {
        try {
          await instance?.close();
        } finally {
          // Only remove the directory allocated by this invocation, never DATA_DIR.
          await rm(dataDir, { recursive: true, force: true });
        }
      }
    })());
  try {
    // Import createApp directly so local .env files and the developer server stay untouched.
    instance = createApp({
      dataDir,
      distDir,
      openaiApiKey: '',
      imageModel: 'gpt-image-2',
      allowedOrigins: [],
      secureCookies: false,
      testMode: true,
    });
    server = createServer(instance.app);
    const httpServer = server;
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(options.port ?? 4173, '127.0.0.1', () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${address.port}`, dataDir, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const instance = await startE2EServer();
    const stop = () => {
      void instance.close().catch((error: unknown) => {
        console.error('E2E server cleanup failed:', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(`Isolated E2E server ready at ${instance.url}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
