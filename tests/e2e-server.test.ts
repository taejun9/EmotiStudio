import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startE2EServer } from '../scripts/e2e-server.ts';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'emotistudio-e2e-lifecycle-'));
  const distDir = path.join(root, '.managed', 'dist');
  const tempRoot = path.join(root, 'runs');
  await mkdir(distDir, { recursive: true });
  await mkdir(tempRoot);
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>E2E build</title>');
  return { root, distDir, tempRoot };
}

test('E2E server serves the build, disables paid generation, and removes only its own data', async () => {
  const { root, distDir, tempRoot } = await fixture();
  const developerData = path.join(root, 'developer-data');
  await mkdir(developerData);
  await writeFile(path.join(developerData, 'keep.txt'), 'preserve developer data');
  const keys = ['DATA_DIR', 'OPENAI_API_KEY', 'NODE_ENV', 'COOKIE_SECURE'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.DATA_DIR = developerData;
  process.env.OPENAI_API_KEY = 'mock-inherited-key-that-must-not-enable-generation';
  process.env.COOKIE_SECURE = 'true';
  let instance: Awaited<ReturnType<typeof startE2EServer>> | undefined;
  try {
    instance = await startE2EServer({ port: 0, distDir, tempRoot });
    assert.ok(instance.dataDir.startsWith(tempRoot + path.sep));
    const health = await fetch(`${instance.url}/api/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(health.headers.get('set-cookie'), null);
    for (const route of ['/', '/projects/example']) {
      const page: Response = await fetch(`${instance.url}${route}`, {
        headers: { Accept: 'text/html' },
      });
      assert.equal(
        page.status,
        200,
        `Production fallback must serve ${route} from a hidden checkout`,
      );
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await page.text(), /E2E build/);
    }
    const bootstrap = await fetch(`${instance.url}/api/bootstrap`);
    assert.equal((await bootstrap.json()).capabilities.liveGeneration, false);
    assert.doesNotMatch(bootstrap.headers.get('set-cookie') ?? '', /; Secure/i);
    await access(path.join(instance.dataDir, 'emotistudio.sqlite'));
    await instance.close();
    await instance.close();
    await assert.rejects(access(instance.dataDir), { code: 'ENOENT' });
    assert.equal(
      await readFile(path.join(developerData, 'keep.txt'), 'utf8'),
      'preserve developer data',
    );
  } finally {
    await instance?.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('E2E startup port conflicts remove the allocated database without touching the listener', async () => {
  const { root, distDir, tempRoot } = await fixture();
  const occupied = createServer((_request, response) => response.end('existing listener'));
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as AddressInfo).port;
    await assert.rejects(startE2EServer({ port, distDir, tempRoot }), { code: 'EADDRINUSE' });
    assert.deepEqual(await readdir(tempRoot), []);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing listener');
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await rm(root, { recursive: true, force: true });
  }
});

test('E2E startup rejects a missing production build before allocating data', async () => {
  const { root, tempRoot } = await fixture();
  try {
    await assert.rejects(
      startE2EServer({ port: 0, distDir: path.join(root, 'missing-build'), tempRoot }),
      /Run npm run build first/,
    );
    assert.deepEqual(await readdir(tempRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
