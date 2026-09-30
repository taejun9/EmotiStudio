import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';
import { STICKER_PLANS } from '../shared/sticker-plans.ts';
import type { ProjectDetail } from '../shared/types.ts';
const direction = {
  id: 'cozy',
  title: '다정한 일상',
  description: '서로 다른 일상 장면',
  tags: ['일상'],
  color: '#A8BC94',
  prompts: ['각 장면의 감정을 표현해요'],
};
const base = {
  name: '토끼 메인 컨셉',
  characterName: '토끼',
  concept: '밝고 명랑한 흰 토끼',
  personality: '쾌활함',
  builtinCharacter: 'tokki',
};
type Client = ReturnType<typeof request.agent>;
async function settled(client: Client, id: string): Promise<ProjectDetail> {
  for (let i = 0; i < 800; i++) {
    const { body } = await client.get(`/api/projects/${id}`).expect(200);
    if (body.job && !['queued', 'running'].includes(body.job.status)) return body;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Job timeout');
}
async function withApp(run: (app: ReturnType<typeof createApp>) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-concepts-captions-'));
  const app = createApp({ dataDir: dir, testMode: true, openaiApiKey: '' });
  try {
    await run(app);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}
async function generate(
  client: Client,
  conceptId: string,
  format: 'static' | 'animated',
  captionsEnabled = false,
) {
  const { body } = await client
    .post(`/api/concepts/${conceptId}/projects`)
    .send({ name: `${format} 세트`, format, captionsEnabled })
    .expect(201);
  await client.put(`/api/projects/${body.id}/direction`).send({ direction }).expect(200);
  await client.post(`/api/projects/${body.id}/generate`).send({ provider: 'sample' }).expect(202);
  const result = await settled(client, body.id);
  assert.equal(result.job?.status, 'completed', result.job?.error || '');
  return result;
}

test('parent concepts own multiple snapshot sets, protect ownership, and move with guest login', async () =>
  withApp(async (app) => {
    const owner = request.agent(app.app),
      stranger = request.agent(app.app);
    await owner.get('/api/bootstrap').expect(200);
    await stranger.get('/api/bootstrap').expect(200);
    const parent = (await owner.post('/api/concepts').send(base).expect(201)).body;
    await stranger.get(`/api/concepts/${parent.id}`).expect(404);
    await stranger.patch(`/api/concepts/${parent.id}`).send({ name: 'stolen' }).expect(404);
    await stranger
      .post(`/api/concepts/${parent.id}/projects`)
      .send({ name: 'stolen', format: 'static' })
      .expect(404);
    const a = (
      await owner
        .post(`/api/concepts/${parent.id}/projects`)
        .send({ name: '첫 세트', format: 'static', captionsEnabled: true })
        .expect(201)
    ).body;
    const b = (
      await owner
        .post(`/api/concepts/${parent.id}/projects`)
        .send({ name: '둘째 세트', format: 'animated' })
        .expect(201)
    ).body;
    assert.equal(a.targetCount, 32);
    assert.equal(b.targetCount, 24);
    assert.equal(a.conceptId, b.conceptId);
    assert.equal(a.builtinCharacter, 'tokki');
    await owner.patch(`/api/concepts/${parent.id}`).send({ concept: '바뀐 부모 설정' }).expect(200);
    assert.equal(
      (await owner.get(`/api/projects/${a.id}`).expect(200)).body.concept,
      base.concept,
      'Parent edits must not mutate saved set snapshots',
    );
    assert.equal((await owner.get(`/api/concepts/${parent.id}`).expect(200)).body.projectCount, 2);
    await owner.delete(`/api/concepts/${parent.id}`).expect(409);
    await owner
      .post('/api/auth/register')
      .send({
        name: '원래 계정',
        email: 'concepts@example.com',
        password: 'Concepts-test-password!',
      })
      .expect(201);
    const guest = request.agent(app.app);
    await guest.get('/api/bootstrap').expect(200);
    const guestConcept = (
      await guest
        .post('/api/concepts')
        .send({ ...base, name: '게스트 작업' })
        .expect(201)
    ).body;
    const guestSet = (
      await guest
        .post(`/api/concepts/${guestConcept.id}/projects`)
        .send({ name: '이전할 세트', format: 'static' })
        .expect(201)
    ).body;
    await guest
      .post('/api/auth/login')
      .send({ email: 'concepts@example.com', password: 'Concepts-test-password!' })
      .expect(200);
    assert.equal(
      (await guest.get(`/api/concepts/${guestConcept.id}`).expect(200)).body.projects[0].id,
      guestSet.id,
    );
    const boot = (await guest.get('/api/bootstrap').expect(200)).body;
    assert.ok(boot.concepts.some((c: { id: string }) => c.id === guestConcept.id));
    await guest.delete(`/api/projects/${guestSet.id}`).expect(200);
    await guest.delete(`/api/concepts/${guestConcept.id}`).expect(200);
  }));

test('tokki static32 and animated24 are distinct poses; caption edits preserve clean originals, timelines, ownership and free usage', async () =>
  withApp(async (app) => {
    const client = request.agent(app.app);
    await client.get('/api/bootstrap').expect(200);
    const parent = (await client.post('/api/concepts').send(base).expect(201)).body;
    const staticSet = await generate(client, parent.id, 'static', true);
    assert.equal(staticSet.stickers.length, 32);
    assert.equal(new Set(staticSet.stickers.map((s) => s.poseId)).size, 32);
    const hashes = app.db
      .prepare(
        'SELECT DISTINCT image_hash FROM versions v JOIN stickers s ON s.id=v.sticker_id WHERE s.project_id=?',
      )
      .all(staticSet.id);
    assert.equal(hashes.length, 32);
    assert.ok(staticSet.stickers.every((s, i) => s.caption === STICKER_PLANS[i]!.caption));
    const selected = staticSet.stickers[7]!;
    const invalidCaption = await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/caption`)
      .send({ enabled: true, text: '안녕\u0007' })
      .expect(400);
    assert.equal(invalidCaption.body.code, 'INVALID_CAPTION');
    assert.match(invalidCaption.body.error, /제어 문자/);

    const clean = selected.versions[0]!.cleanImageUrl;
    assert.notEqual(clean, selected.imageUrl);
    await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/caption`)
      .send({ enabled: true, text: '가'.repeat(25) })
      .expect(400);
    await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/caption`)
      .send({ enabled: true, text: '괜찮아, 함께야' })
      .expect(202);
    let edited = await settled(client, staticSet.id);
    assert.equal(edited.job?.status, 'completed', edited.job?.error || '');
    assert.equal(edited.stickers[7]!.caption, '괜찮아, 함께야');
    assert.equal(edited.stickers[7]!.versions[0]!.cleanImageUrl, clean);
    await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/caption`)
      .send({ enabled: false })
      .expect(202);
    edited = await settled(client, staticSet.id);
    assert.equal(edited.stickers[7]!.imageUrl, clean);
    assert.equal(edited.stickers[7]!.caption, null);
    const beforeRevision = (await client.get(clean).expect(200)).body as Buffer;
    await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/revise`)
      .send({ provider: 'sample', feedback: '표정을 밝게' })
      .expect(202);
    edited = await settled(client, staticSet.id);
    assert.equal(edited.job?.status, 'completed', edited.job?.error || '');
    assert.equal(
      edited.stickers[7]!.poseId,
      'cry',
      'Revision must retain its original pose index rather than becoming hello',
    );
    const afterRevision = (
      await client.get(edited.stickers[7]!.versions[0]!.cleanImageUrl).expect(200)
    ).body as Buffer;
    assert.notEqual(
      createHash('sha256').update(beforeRevision).digest('hex'),
      createHash('sha256').update(afterRevision).digest('hex'),
      'Preset revisions must make an actual visual variant',
    );
    await client
      .post(`/api/projects/${staticSet.id}/stickers/${selected.id}/restore`)
      .send({ version: 1 })
      .expect(200);
    assert.equal(
      (await client.get(`/api/projects/${staticSet.id}`).expect(200)).body.stickers[7].caption,
      STICKER_PLANS[7]!.caption,
    );
    const animatedSet = await generate(client, parent.id, 'animated', false);
    assert.equal(animatedSet.stickers.length, 24);
    assert.equal(new Set(animatedSet.stickers.map((s) => s.poseId)).size, 24);
    assert.equal(
      app.db
        .prepare(
          'SELECT DISTINCT image_hash FROM versions v JOIN stickers s ON s.id=v.sticker_id WHERE s.project_id=?',
        )
        .all(animatedSet.id).length,
      24,
    );
    const animated = animatedSet.stickers[0]!;
    const originalClean = animated.versions[0]!.cleanImageUrl;
    const before = await client.get(animated.imageUrl).expect(200);
    await client
      .post(`/api/projects/${animatedSet.id}/stickers/${animated.id}/caption`)
      .send({ enabled: true, text: '우리 같이 놀자' })
      .expect(202);
    let animatedEdit = await settled(client, animatedSet.id);
    assert.equal(animatedEdit.job?.status, 'completed', animatedEdit.job?.error || '');
    assert.equal(animatedEdit.stickers[0]!.versions[0]!.cleanImageUrl, originalClean);
    assert.deepEqual(animatedEdit.stickers[0]!.animation!.delaysMs, animated.animation!.delaysMs);
    await client
      .post(`/api/projects/${animatedSet.id}/stickers/${animated.id}/caption`)
      .send({ enabled: false })
      .expect(202);
    animatedEdit = await settled(client, animatedSet.id);
    assert.equal(animatedEdit.job?.status, 'completed', animatedEdit.job?.error || '');
    const after = await client.get(animatedEdit.stickers[0]!.imageUrl).expect(200);
    const beforeRaw = await sharp(before.body, { animated: true }).raw().toBuffer();
    const afterRaw = await sharp(after.body, { animated: true }).raw().toBuffer();
    assert.deepEqual(
      afterRaw,
      beforeRaw,
      'Removing a caption must return the exact clean animation, without repeated padding/resizing',
    );
    const outsider = request.agent(app.app);
    await outsider.get('/api/bootstrap').expect(200);
    await outsider.get(originalClean).expect(404);
    assert.equal(
      (app.db.prepare('SELECT COUNT(*) AS n FROM image_usage').get() as { n: number }).n,
      0,
    );
    await client.post(`/api/projects/${animatedSet.id}/approve-all`).send({}).expect(200);
    await client.post(`/api/projects/${animatedSet.id}/complete`).send({}).expect(200);
    const manifest = (
      await client.get(`/api/projects/${animatedSet.id}/export-manifest`).expect(200)
    ).body;
    assert.equal(manifest.project.conceptId, parent.id);
    assert.equal(manifest.stickers[0].poseId, 'hello');
    assert.equal(manifest.stickers[0].caption, null);
  }));
