import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { waitForJob as waitJob } from './job-helpers.ts';
import { createApp } from '../server/app.ts';
import type { ProjectDetail } from '../shared/types.ts';

let instance: ReturnType<typeof createApp>;
let tempDir: string;
before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'emotistudio-test-'));
  instance = createApp({ dataDir: tempDir, testMode: true, openaiApiKey: '' });
});
after(async () => {
  await instance?.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});
const newInput = {
  name: '늘보군의 느긋한 하루',
  characterName: '늘보군',
  concept: '느긋하고 긍정적인 베이지 나무늘보. 크림색 얼굴, 갈색 눈무늬, 초록 크로스백.',
  personality: '느긋하고 따뜻해요',
  audience: '바쁜 하루를 보내는 친구',
};
const direction = {
  id: 'cozy',
  title: '느긋한 일상',
  description: '따뜻한 일상 속의 느긋함을 전하는 이모티콘',
  tags: ['느긋함', '일상'],
  color: '#667452',
  prompts: ['반갑게 인사', '마음을 전해요', '잠시 쉬어요', '고마워요', '응원해요', '미안해요'],
};
async function client() {
  const c = request.agent(instance.app);
  await c.get('/api/bootstrap').expect(200);
  return c;
}
test('isolated guest workspaces persist bootstrap and never expose other users projects', async () => {
  const a = await client();
  const b = await client();
  const boot = (await a.get('/api/bootstrap').expect(200)).body;
  const again = (await a.get('/api/bootstrap').expect(200)).body;
  assert.equal(boot.user.id, again.user.id);
  assert.equal(boot.user.isGuest, true);
  assert.ok(boot.projects.length >= 1);
  const id = boot.projects[0].id;
  await b.get(`/api/projects/${id}`).expect(404);
  await b.patch(`/api/projects/${id}`).send({ name: 'stolen' }).expect(404);
  await b.delete(`/api/projects/${id}`).expect(404);
  assert.equal(boot.capabilities.liveGeneration, false);
});

test('concept → suggestions → direction → generation → feedback → revision → restore → approval → export lifecycle', async () => {
  const c = await client();
  let p = (await c.post('/api/projects').send(newInput).expect(201)).body as ProjectDetail;
  assert.equal(p.status, 'concept');
  assert.equal(p.characterName, '늘보군');
  const suggestions = (await c.post(`/api/projects/${p.id}/directions`).send({}).expect(200)).body;
  assert.ok(Array.isArray(suggestions));
  assert.ok(suggestions.length >= 3);
  p = (await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200)).body;
  assert.equal(p.direction?.title, direction.title);
  await c
    .post(`/api/projects/${p.id}/generate`)
    .send({ provider: 'sample', count: 32 })
    .expect(202);
  p = await waitJob(c, p.id);
  assert.equal(p.status, 'review');
  assert.equal(p.stickers.length, 32);
  assert.equal(p.job?.status, 'completed');
  assert.equal(p.job.completed, 32);
  await c.post(`/api/projects/${p.id}/complete`).send({}).expect(409);
  await c.get(`/api/projects/${p.id}/export`).expect(409);
  const s = p.stickers[0];
  p = (
    await c
      .patch(`/api/projects/${p.id}/stickers/${s.id}`)
      .send({ status: 'changes_requested', feedback: '눈을 조금 더 웃는 표정으로 바꿔 주세요.' })
      .expect(200)
  ).body;
  assert.equal(p.stickers[0].status, 'changes_requested');
  await c
    .post(`/api/projects/${p.id}/stickers/${s.id}/revise`)
    .send({ provider: 'sample', feedback: '표정을 더 밝게' })
    .expect(202);
  p = await waitJob(c, p.id);
  let sticker = p.stickers.find((x) => x.id === s.id)!;
  assert.equal(sticker.versions.length, 2);
  assert.equal(sticker.status, 'pending');
  p = (
    await c.post(`/api/projects/${p.id}/stickers/${s.id}/restore`).send({ version: 1 }).expect(200)
  ).body;
  sticker = p.stickers.find((x) => x.id === s.id)!;
  assert.equal(sticker.currentVersion, 1);
  assert.equal(sticker.versions.length, 2);
  p = (await c.post(`/api/projects/${p.id}/approve-all`).send({}).expect(200)).body;
  assert.equal(p.approvedCount, 32);
  p = (await c.post(`/api/projects/${p.id}/complete`).send({}).expect(200)).body;
  assert.equal(p.status, 'completed');
  assert.ok(p.activities.length >= 5);
  const zip = await c.get(`/api/projects/${p.id}/export?size=360`).expect(200);
  assert.match(zip.headers['content-type'], /zip/);
  assert.match(zip.headers['content-disposition'], /attachment/);
  const reopened = (await c.post(`/api/projects/${p.id}/reopen`).send({}).expect(200)).body;
  assert.equal(reopened.status, 'review');
  await c.delete(`/api/projects/${p.id}`).expect(200);
  await c.get(`/api/projects/${p.id}`).expect(404);
});

test('validation blocks malformed concepts, invalid generation parameters, absent direction and unavailable provider', async () => {
  const c = await client();
  await c.post('/api/projects').send({}).expect(400);
  await c
    .post('/api/projects')
    .send({ ...newInput, name: 'x'.repeat(500) })
    .expect(400);
  const p = (await c.post('/api/projects').send(newInput).expect(201)).body;
  await c
    .post(`/api/projects/${p.id}/generate`)
    .send({ provider: 'sample', count: 32 })
    .expect(409);
  await c.put(`/api/projects/${p.id}/direction`).send({ direction }).expect(200);
  await c
    .post(`/api/projects/${p.id}/generate`)
    .send({ provider: 'sample', count: 999 })
    .expect(400);
  const live = await c
    .post(`/api/projects/${p.id}/generate`)
    .send({ provider: 'openai', count: 32 });
  assert.ok([401, 403, 503].includes(live.status));
  await c
    .put(`/api/projects/${p.id}/direction`)
    .send({ direction: { ...direction, title: '' } })
    .expect(400);
});

test('register promotes workspace, rotates auth and login/logout retain persistent ownership', async () => {
  const c = await client();
  const before = (await c.get('/api/bootstrap')).body;
  const email = `owner-${Date.now()}@example.com`;
  const password = 'Correct-horse-314!';
  const reg = await c
    .post('/api/auth/register')
    .send({ name: '늘보 작가', email, password })
    .expect(201);
  assert.equal(reg.body.user.isGuest, false);
  const owned = (await c.get('/api/bootstrap')).body;
  assert.equal(owned.projects[0].id, before.projects[0].id);
  await c.post('/api/auth/logout').send({}).expect(200);
  await c.get(`/api/projects/${owned.projects[0].id}`).expect(404);
  await c.post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  await c.post('/api/auth/login').send({ email, password }).expect(200);
  await c.get(`/api/projects/${owned.projects[0].id}`).expect(200);
  const other = await client();
  await other.post('/api/auth/register').send({ name: '다른 작가', email, password }).expect(409);
  await other
    .post('/api/auth/register')
    .send({ name: '작가', email: 'invalid', password: '123' })
    .expect(400);
});

test('image upload validates content, normalizes PNG and enforces private asset ownership', async () => {
  const c = await client();
  const stranger = await client();
  const png = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#967454' } })
    .png()
    .toBuffer();
  const result = await c
    .post('/api/uploads')
    .attach('file', png, { filename: 'reference.png', contentType: 'image/png' })
    .expect(201);
  assert.match(result.body.url, /^\/api\/assets\//);
  const img = await c.get(result.body.url).expect(200);
  assert.match(img.headers['content-type'], /image\/png/);
  await stranger.get(result.body.url).expect(404);
  await c
    .post('/api/uploads')
    .attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), {
      filename: 'bad.svg',
      contentType: 'image/svg+xml',
    })
    .expect(400);
  await c
    .post('/api/uploads')
    .attach('file', Buffer.from('not an image'), { filename: 'bad.png', contentType: 'image/png' })
    .expect(400);
  const crossRef = await stranger
    .post('/api/projects')
    .send({ ...newInput, referenceUrl: result.body.url });
  assert.ok([400, 404].includes(crossRef.status));
  const external = await c
    .post('/api/projects')
    .send({ ...newInput, referenceUrl: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(external.status, 400);
});

test('cross-origin writes are rejected and unknown API routes are JSON', async () => {
  const c = await client();
  await c.post('/api/projects').set('Origin', 'https://evil.example').send(newInput).expect(403);
  const unknown = await c.get('/api/not-a-route').expect(404);
  assert.match(unknown.headers['content-type'], /json/);
});

test('database survives process lifecycle without losing a saved concept', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emotistudio-persist-'));
  let app = createApp({ dataDir: dir, testMode: true, openaiApiKey: '' });
  try {
    const c = request.agent(app.app);
    await c.get('/api/bootstrap');
    await c
      .post('/api/auth/register')
      .send({
        name: '지속성 테스트',
        email: 'persist@example.com',
        password: 'Secure-password-2026!',
      })
      .expect(201);
    const p = (
      await c
        .post('/api/projects')
        .send({ ...newInput, name: '서버 재시작 후에도 남는 프로젝트' })
        .expect(201)
    ).body;
    await app.close();
    app = createApp({ dataDir: dir, testMode: true, openaiApiKey: '' });
    const again = request.agent(app.app);
    await again.get('/api/bootstrap');
    await again
      .post('/api/auth/login')
      .send({ email: 'persist@example.com', password: 'Secure-password-2026!' })
      .expect(200);
    const restored = (await again.get(`/api/projects/${p.id}`).expect(200)).body;
    assert.equal(restored.name, p.name);
    assert.equal(restored.concept, newInput.concept);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('sticker name-only edits persist without silently changing review status', async () => {
  const c = await client();
  const boot = (await c.get('/api/bootstrap')).body;
  const p = (await c.get(`/api/projects/${boot.projects[0].id}`).expect(200)).body;
  const s = p.stickers[0];
  await c.patch(`/api/projects/${p.id}/stickers/${s.id}`).send({ status: 'approved' }).expect(200);
  const result = (
    await c
      .patch(`/api/projects/${p.id}/stickers/${s.id}`)
      .send({ title: '반가워, 늘보군!' })
      .expect(200)
  ).body;
  assert.equal(result.stickers[0].title, '반가워, 늘보군!');
  assert.equal(result.stickers[0].status, 'approved');
  await c.patch(`/api/projects/${p.id}/stickers/${s.id}`).send({}).expect(400);
});

test('logging into an existing account keeps meaningful guest work and uploaded references', async () => {
  const owner = await client();
  const email = `merge-${Date.now()}@example.com`;
  const password = 'Secure-merge-2026!';
  await owner.post('/api/auth/register').send({ name: '기존 작가', email, password }).expect(201);
  const guest = await client();
  const png = await sharp({ create: { width: 30, height: 30, channels: 4, background: '#886655' } })
    .png()
    .toBuffer();
  const uploaded = (
    await guest
      .post('/api/uploads')
      .attach('file', png, { filename: 'guest.png', contentType: 'image/png' })
      .expect(201)
  ).body;
  const p = (
    await guest
      .post('/api/projects')
      .send({ ...newInput, name: '로그인 전 작업', referenceUrl: uploaded.url })
      .expect(201)
  ).body;
  await guest.post('/api/auth/login').send({ email, password }).expect(200);
  await guest.get(`/api/projects/${p.id}`).expect(200);
  await guest.get(uploaded.url).expect(200);
  await owner.get(`/api/projects/${p.id}`).expect(200);
});
