import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { distinctPng } from './image-fixtures.ts';
import { createApp, type AppOptions } from '../server/app.ts';
import type { ProjectDetail } from '../shared/types.ts';

const concept = {
  name: '늘보군 보안 회귀 테스트',
  characterName: '늘보군',
  concept: '베이지 나무늘보의 다정하고 느긋한 일상',
  referenceUrl: '/samples/reference.png',
};
const direction = {
  id: 'cozy',
  title: '다정한 일상',
  description: '작은 몸짓으로 위로를 전하는 늘보군',
  tags: ['일상', '위로'],
  color: '#A8BC94',
  prompts: ['손을 흔들며 인사해요'],
};
type Instance = ReturnType<typeof createApp>;
type Client = ReturnType<typeof request.agent>;
const imageFixture = sharp({
  create: {
    width: 32,
    height: 32,
    channels: 4,
    background: { r: 180, g: 160, b: 140, alpha: 0.5 },
  },
})
  .png()
  .toBuffer();
let outputIndex = 0;
async function imageResponse() {
  return new Response(
    JSON.stringify({
      data: [
        { b64_json: (await distinctPng(await imageFixture, ++outputIndex)).toString('base64') },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
async function withApp(options: AppOptions, run: (instance: Instance) => Promise<void>) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'emoti-security-'));
  const instance = createApp({
    dataDir,
    testMode: true,
    openaiApiKey: 'mock-security-key',
    fetchImpl: imageResponse,
    ...options,
  });
  try {
    await run(instance);
  } finally {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}
async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
async function registered(instance: Instance, email: string): Promise<Client> {
  const client = request.agent(instance.app);
  await client.get('/api/bootstrap').expect(200);
  await client
    .post('/api/auth/register')
    .send({ name: '보안 검증 작가', email, password: 'Security-test-password-2026!' })
    .expect(201);
  return client;
}
async function project(
  client: Client,
  referenceUrl = concept.referenceUrl,
): Promise<ProjectDetail> {
  const { body } = await client
    .post('/api/projects')
    .send({ ...concept, referenceUrl })
    .expect(201);
  return (await client.put(`/api/projects/${body.id}/direction`).send({ direction }).expect(200))
    .body as ProjectDetail;
}
async function settled(client: Client, projectId: string): Promise<ProjectDetail> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const { body } = await client.get(`/api/projects/${projectId}`).expect(200);
    if (body.job && !['queued', 'running'].includes(body.job.status)) return body as ProjectDetail;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Background job did not settle within the test deadline');
}

test('health checks do not create guest accounts, projects, sessions, or cookies', async () => {
  await withApp({}, async (instance) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(instance.app).get('/api/health').expect(200);
      assert.deepEqual(response.body, { status: 'ok' });
      assert.equal(response.headers['set-cookie'], undefined);
    }
    for (const table of ['users', 'projects', 'sessions']) {
      const row = instance.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
        total: number;
      };
      assert.equal(row.total, 0, `Health checks unexpectedly created ${table}`);
    }
  });
});

test('global generation cap survives project deletion and applies to another registered account', async () => {
  await withEnvironment(
    {
      MAX_DAILY_GENERATED_IMAGES: '48',
      MAX_GLOBAL_DAILY_GENERATED_IMAGES: '32',
      GENERATION_ALLOWED_EMAILS: undefined,
    },
    async () => {
      let upstreamCalls = 0;
      await withApp(
        {
          fetchImpl: async () => {
            upstreamCalls++;
            return imageResponse();
          },
        },
        async (instance) => {
          const first = await registered(instance, 'global-first@example.com');
          const firstProject = await project(first);
          await first
            .post(`/api/projects/${firstProject.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(202);
          assert.equal((await settled(first, firstProject.id)).job!.status, 'completed');
          await first.delete(`/api/projects/${firstProject.id}`).expect(200);

          const second = await registered(instance, 'global-second@example.com');
          const secondProject = await project(second);
          const blocked = await second
            .post(`/api/projects/${secondProject.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(429);
          assert.equal(blocked.body.code, 'GLOBAL_DAILY_LIMIT');
          assert.equal(upstreamCalls, 32, 'Rejected work must not contact the provider');
          const unchanged = (await second.get(`/api/projects/${secondProject.id}`).expect(200))
            .body as ProjectDetail;
          assert.equal(unchanged.job, null);
          const usage = instance.db
            .prepare('SELECT SUM(image_count) AS reserved FROM image_usage')
            .get() as { reserved: number };
          assert.equal(
            usage.reserved,
            32,
            'Deleting the source project must preserve its reserved budget',
          );
        },
      );
    },
  );
});

test('configured email allowlist blocks unlisted accounts before any paid work is queued', async () => {
  await withEnvironment(
    { GENERATION_ALLOWED_EMAILS: 'allowed@example.com', MAX_GLOBAL_DAILY_GENERATED_IMAGES: '96' },
    async () => {
      let upstreamCalls = 0;
      await withApp(
        {
          fetchImpl: async () => {
            upstreamCalls++;
            return imageResponse();
          },
        },
        async (instance) => {
          const outsider = await registered(instance, 'not-allowed@example.com');
          const deniedProject = await project(outsider);
          const blocked = await outsider
            .post(`/api/projects/${deniedProject.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(403);
          assert.equal(blocked.body.code, 'GENERATION_NOT_ALLOWED');
          assert.equal(upstreamCalls, 0);
          assert.equal(
            (instance.db.prepare('SELECT COUNT(*) AS n FROM image_usage').get() as { n: number }).n,
            0,
          );

          const allowed = await registered(instance, 'ALLOWED@example.com');
          const allowedProject = await project(allowed);
          await allowed
            .post(`/api/projects/${allowedProject.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(202);
          assert.equal((await settled(allowed, allowedProject.id)).job!.status, 'completed');
          assert.equal(upstreamCalls, 32);
        },
      );
    },
  );
});

test('private generated references survive deletion of their source project and remain owner scoped', async () => {
  await withEnvironment(
    {
      GENERATION_ALLOWED_EMAILS: undefined,
      MAX_DAILY_GENERATED_IMAGES: '96',
      MAX_GLOBAL_DAILY_GENERATED_IMAGES: '96',
    },
    async () => {
      await withApp({}, async (instance) => {
        const owner = await registered(instance, 'reference-owner@example.com');
        const source = await project(owner);
        await owner
          .post(`/api/projects/${source.id}/generate`)
          .send({ provider: 'openai', count: 32 })
          .expect(202);
        const generated = await settled(owner, source.id);
        assert.equal(generated.job!.status, 'completed');
        const referenceUrl = generated.stickers[0]!.imageUrl;
        const unreferencedUrl = generated.stickers[1]!.imageUrl;
        const dependent = await project(owner, referenceUrl);
        await owner.delete(`/api/projects/${source.id}`).expect(200);
        await owner.get(referenceUrl).expect(200);
        await owner.get(unreferencedUrl).expect(404);
        const kept = (await owner.get(`/api/projects/${dependent.id}`).expect(200))
          .body as ProjectDetail;
        assert.equal(kept.referenceUrl, referenceUrl);
        const stranger = await registered(instance, 'reference-stranger@example.com');
        await stranger.get(referenceUrl).expect(404);

        await owner
          .post(`/api/projects/${dependent.id}/generate`)
          .send({ provider: 'openai', count: 32 })
          .expect(202);
        const result = await settled(owner, dependent.id);
        assert.equal(
          result.job!.status,
          'completed',
          'The retained reference must still be usable by the provider request path',
        );
        assert.equal(result.stickers.length, 32);
      });
    },
  );
});

test('approving the successful subset cannot complete or export a failed partial batch', async () => {
  await withEnvironment(
    {
      GENERATION_ALLOWED_EMAILS: undefined,
      MAX_DAILY_GENERATED_IMAGES: '48',
      MAX_GLOBAL_DAILY_GENERATED_IMAGES: '96',
    },
    async () => {
      let calls = 0;
      let fail = true;
      await withApp(
        {
          fetchImpl: async () => {
            calls++;
            if (fail && calls === 3)
              return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
                status: 429,
              });
            return imageResponse();
          },
        },
        async (instance) => {
          const owner = await registered(instance, 'partial-owner@example.com');
          const batch = await project(owner);
          await owner
            .post(`/api/projects/${batch.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(202);
          const partial = await settled(owner, batch.id);
          assert.equal(partial.job!.status, 'failed');
          assert.equal(partial.stickers.length, 2);
          await owner
            .post(`/api/projects/${batch.id}/stickers/${partial.stickers[0].id}/revise`)
            .send({ provider: 'openai', feedback: '눈을 더 크게 해 주세요' })
            .expect(409);
          await owner.post(`/api/projects/${batch.id}/approve-all`).send({}).expect(200);
          const blocked = await owner
            .post(`/api/projects/${batch.id}/complete`)
            .send({})
            .expect(409);
          assert.equal(blocked.body.code, 'BATCH_INCOMPLETE');
          await owner.get(`/api/projects/${batch.id}/export`).expect(409);

          fail = false;
          await owner
            .post(`/api/projects/${batch.id}/generate`)
            .send({ provider: 'openai', count: 32 })
            .expect(202);
          const resumed = await settled(owner, batch.id);
          assert.equal(resumed.job!.status, 'completed');
          assert.equal(resumed.job!.requestedCount, 32);
          assert.equal(resumed.stickers.length, 32);
          assert.deepEqual(
            resumed.stickers.slice(0, 2).map((sticker) => sticker.id),
            partial.stickers.map((sticker) => sticker.id),
          );
          await owner.post(`/api/projects/${batch.id}/approve-all`).send({}).expect(200);
          assert.equal(
            (await owner.post(`/api/projects/${batch.id}/complete`).send({}).expect(200)).body
              .status,
            'completed',
          );
        },
      );
    },
  );
});

test('shutdown interrupts active provider work, preserves saved images, and permits recovery after restart', async () => {
  await withEnvironment(
    {
      GENERATION_ALLOWED_EMAILS: undefined,
      MAX_DAILY_GENERATED_IMAGES: '48',
      MAX_GLOBAL_DAILY_GENERATED_IMAGES: '96',
    },
    async () => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'emoti-interrupted-'));
      let enteredBlockedCall!: () => void;
      const blockedCallEntered = new Promise<void>((resolve) => {
        enteredBlockedCall = resolve;
      });
      let calls = 0;
      let instance = createApp({
        dataDir,
        testMode: true,
        openaiApiKey: 'mock-key',
        fetchImpl: async (_input, init) => {
          if (++calls === 1) return imageResponse();
          enteredBlockedCall();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init!.signal!;
            if (signal.aborted) return reject(signal.reason);
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      });
      try {
        const owner = await registered(instance, 'recovery-owner@example.com');
        const batch = await project(owner);
        await owner
          .post(`/api/projects/${batch.id}/generate`)
          .send({ provider: 'openai', count: 32 })
          .expect(202);
        await Promise.race([
          blockedCallEntered,
          new Promise<never>((_resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Provider call did not start')),
              3000,
            );
            timeout.unref();
          }),
        ]);
        await instance.close();

        instance = createApp({
          dataDir,
          testMode: true,
          openaiApiKey: 'mock-key',
          fetchImpl: imageResponse,
        });
        const returning = request.agent(instance.app);
        await returning
          .post('/api/auth/login')
          .send({ email: 'recovery-owner@example.com', password: 'Security-test-password-2026!' })
          .expect(200);
        const interrupted = (await returning.get(`/api/projects/${batch.id}`).expect(200))
          .body as ProjectDetail;
        assert.equal(interrupted.job!.status, 'failed');
        assert.equal(interrupted.stickers.length, 1);
        assert.equal(interrupted.status, 'review');
        const savedId = interrupted.stickers[0]!.id;
        await returning
          .post(`/api/projects/${batch.id}/generate`)
          .send({ provider: 'openai', count: 32 })
          .expect(202);
        const recovered = await settled(returning, batch.id);
        assert.equal(recovered.job!.status, 'completed');
        assert.equal(recovered.stickers.length, 32);
        assert.equal(recovered.stickers[0]!.id, savedId);
      } finally {
        await instance.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});

test('private gallery reads use their own bounded budget without consuming the interactive API budget', async () => {
  await withApp({ testMode: false, secureCookies: false }, async (instance) => {
    const client = request.agent(instance.app);
    const first = await client.get('/api/bootstrap').expect(200);
    assert.match(first.headers.ratelimit, /r=239/);
    const image = await client
      .get('/api/assets/00000000-0000-4000-8000-000000000000.png')
      .expect(404);
    assert.match(image.headers.ratelimit, /r=1999/);
    const head = await client
      .head('/api/assets/00000000-0000-4000-8000-000000000000.png')
      .expect(404);
    assert.match(head.headers.ratelimit, /r=1998/);
    const next = await client.get('/api/bootstrap').expect(200);
    assert.match(next.headers.ratelimit, /r=238/);
  });
});
