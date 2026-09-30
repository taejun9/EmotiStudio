import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { waitForJob as poll } from './job-helpers.ts';
import { distinctPng } from './image-fixtures.ts';
import { createApp } from '../server/app.ts';

const concept = {
  name: '늘보군 실제 생성 경로 테스트',
  characterName: '늘보군',
  concept: '베이지색 나무늘보, 크림 얼굴, 초록 크로스백',
  referenceUrl: '/samples/reference.png',
};
const direction = {
  id: 'slow',
  title: '느긋한 위로',
  description: '늘보군의 다정한 일상',
  tags: ['위로'],
  color: '#667452',
  prompts: ['천천히 인사하는 모습'],
};
test('real-provider request path passes reference/feedback; partial failure can resume without duplicating completed images', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-provider-'));
  const png = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 180, g: 160, b: 140, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  let outputIndex = 0;
  const calls: { url: string; body: FormData | string | null | undefined }[] = [];
  let shouldFail = true;
  let failRevision = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body as FormData | string });
    if (failRevision || (shouldFail && calls.length === 3))
      return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    return new Response(
      JSON.stringify({
        data: [{ b64_json: (await distinctPng(png, ++outputIndex)).toString('base64') }],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-test-key-not-real',
    fetchImpl,
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({
        name: 'API 테스트',
        email: 'provider@example.com',
        password: 'Secure-provider-2026!',
      })
      .expect(201);
    let p = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${p.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    p = await poll(c, p.id);
    assert.equal(p.job.status, 'failed');
    assert.equal(p.stickers.length, 2);
    assert.equal(
      (app.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number }).n,
      3,
      'Only the two successes and the attempted failed call remain charged',
    );
    assert.match(p.job.error, /한도/);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/images/edits');
    const form = calls[0].body as FormData;
    assert.equal(form.get('background'), 'transparent');
    assert.ok(form.get('image[]') instanceof Blob);
    assert.match(String(form.get('prompt')), /초록 크로스백/);
    shouldFail = false;
    await c
      .post(`/api/projects/${p.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    p = await poll(c, p.id);
    assert.equal(p.job.status, 'completed');
    assert.equal(p.stickers.length, 32);
    assert.equal(
      (app.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number }).n,
      33,
      'Retrying the remaining30 must fit the default48 budget',
    );
    assert.equal(new Set(p.stickers.map((s: any) => s.id)).size, 32);
    await c
      .post(`/api/projects/${p.id}/stickers/${p.stickers[0].id}/revise`)
      .send({ provider: 'openai', feedback: '눈웃음을 강조해 주세요' })
      .expect(202);
    p = await poll(c, p.id);
    assert.equal(p.stickers[0].versions.length, 2);
    const revision = calls.at(-1)!.body as FormData;
    assert.match(String(revision.get('prompt')), /눈웃음을 강조/);
    assert.equal(revision.getAll('image[]').length, 2);
    const image = await c.get(p.stickers[0].imageUrl).expect(200);
    assert.match(image.headers['content-type'], /image\/png/);
    await c
      .patch(`/api/projects/${p.id}/stickers/${p.stickers[0].id}`)
      .send({ status: 'approved' })
      .expect(200);
    failRevision = true;
    await c
      .post(`/api/projects/${p.id}/stickers/${p.stickers[0].id}/revise`)
      .send({ provider: 'openai', feedback: '실패해도 남아야 하는 수정 의견' })
      .expect(202);
    p = await poll(c, p.id);
    assert.equal(p.job.status, 'failed');
    assert.equal(p.stickers[0].versions.length, 2);
    assert.equal(p.stickers[0].status, 'changes_requested');
    assert.equal(p.stickers[0].feedback, '실패해도 남아야 하는 수정 의견');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed upstream image becomes a failed job and never an approved or completed sticker', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-provider-invalid-'));
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('bad image').toString('base64') }] }),
        { status: 200 },
      ),
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({
        name: '오류 테스트',
        email: 'bad-provider@example.com',
        password: 'Secure-provider-2026!',
      })
      .expect(201);
    const p = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${p.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    const result = await poll(c, p.id);
    assert.equal(result.job.status, 'failed');
    assert.equal(result.stickers.length, 0);
    assert.notEqual(result.status, 'completed');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('deleting a project cannot reset the account generation budget', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-budget-'));
  const previousLimit = process.env.MAX_DAILY_GENERATED_IMAGES;
  process.env.MAX_DAILY_GENERATED_IMAGES = '32';
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 171, g: 205, b: 239, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  let outputIndex = 0;
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: (await distinctPng(png, ++outputIndex)).toString('base64') }],
        }),
        {
          status: 200,
        },
      ),
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({ name: '예산 테스트', email: 'budget@example.com', password: 'Secure-budget-2026!' })
      .expect(201);
    const first = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${first.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${first.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    await poll(c, first.id);
    await c.delete(`/api/projects/${first.id}`).expect(200);
    const second = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${second.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${second.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(429);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    if (previousLimit === undefined) delete process.env.MAX_DAILY_GENERATED_IMAGES;
    else process.env.MAX_DAILY_GENERATED_IMAGES = previousLimit;
  }
});

test('concept-only generation uses its first image to preserve character identity in the rest of the set', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-anchor-'));
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 171, g: 205, b: 239, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const urls: string[] = [];
  let outputIndex = 0;
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          data: [{ b64_json: (await distinctPng(png, ++outputIndex)).toString('base64') }],
        }),
        {
          status: 200,
        },
      );
    },
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({ name: '기준 테스트', email: 'anchor@example.com', password: 'Secure-anchor-2026!' })
      .expect(201);
    const p = (
      await c
        .post('/api/projects')
        .send({ ...concept, referenceUrl: null })
        .expect(201)
    ).body;
    await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${p.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    const result = await poll(c, p.id);
    assert.equal(result.job.status, 'completed');
    assert.equal(urls.length, 32);
    assert.match(urls[0], /\/generations$/);
    assert.ok(urls.slice(1).every((url) => url.endsWith('/edits')));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('opaque live-provider output is rejected instead of being advertised as a transparent sticker', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-opaque-'));
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#abcdef' } })
    .png()
    .toBuffer();
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
        status: 200,
      }),
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({ name: '알파 테스트', email: 'alpha@example.com', password: 'Secure-alpha-2026!' })
      .expect(201);
    const p = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200);
    await c
      .post(`/api/projects/${p.id}/generate`)
      .send({ provider: 'openai', count: 32 })
      .expect(202);
    const result = await poll(c, p.id);
    assert.equal(result.job.status, 'failed');
    assert.equal(result.stickers.length, 0);
    assert.match(result.job.error ?? '', /투명/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('identical provider output cannot silently fill different pose slots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-duplicate-output-'));
  const png = await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 4,
      background: { r: 160, g: 180, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const app = createApp({
    dataDir: dir,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
        status: 200,
      });
    },
  });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap').expect(200);
    await c
      .post('/api/auth/register')
      .send({
        name: '중복 검증',
        email: 'duplicate@example.com',
        password: 'Duplicate-test-password!',
      })
      .expect(201);
    const project = (await c.post('/api/projects').send(concept).expect(201)).body;
    await c.put(`/api/projects/${project.id}/direction`).send({ direction }).expect(200);
    await c.post(`/api/projects/${project.id}/generate`).send({ provider: 'openai' }).expect(202);
    const result = await poll(c, project.id);
    assert.equal(result.job.status, 'failed');
    assert.match(result.job.error ?? '', /동일한 이미지/);
    assert.equal(result.stickers.length, 1);
    assert.equal(calls, 2);
    assert.equal(
      (app.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number }).n,
      2,
    );
    await c.post(`/api/projects/${project.id}/complete`).send({}).expect(409);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
