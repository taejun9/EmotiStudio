import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import type { ProjectDetail } from '../shared/types.ts';

const credentials = { email: 'recovery-test@example.com', password: 'Recovery-password-2026!' };

test('restart reconciles a fully saved batch and allows approval and completion without regenerating', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'emoti-terminal-recovery-'));
  let instance = createApp({ dataDir, testMode: true, openaiApiKey: '' });
  try {
    const owner = request.agent(instance.app);
    const boot = (await owner.get('/api/bootstrap').expect(200)).body;
    await owner
      .post('/api/auth/register')
      .send({ name: '복구 검증 작가', ...credentials })
      .expect(201);
    const project = (await owner.get(`/api/projects/${boot.projects[0].id}`).expect(200))
      .body as ProjectDetail;
    assert.equal(project.targetCount, 6);
    const savedImages = project.stickers.map((sticker) => ({
      id: sticker.id,
      imageUrl: sticker.imageUrl,
    }));
    const jobId = randomUUID();
    const timestamp = new Date().toISOString();

    // Simulate the exact durable state after the last sticker commit but before
    // the terminal job-status commit. No real worker owns this injected job.
    instance.db
      .prepare(
        "INSERT INTO jobs (id, project_id, status, total, completed, error, payload_json, created_at, updated_at, attempted) VALUES (?, ?, 'running', 6, 6, NULL, ?, ?, ?, 0)",
      )
      .run(
        jobId,
        project.id,
        JSON.stringify({
          userId: boot.user.id,
          provider: 'sample',
          project,
          count: 6,
          startIndex: 0,
        }),
        timestamp,
        timestamp,
      );
    instance.db.prepare("UPDATE projects SET status = 'generating' WHERE id = ?").run(project.id);
    await instance.close();
    instance = createApp({ dataDir, testMode: true, openaiApiKey: '' });

    const returning = request.agent(instance.app);
    await returning.post('/api/auth/login').send(credentials).expect(200);
    const recovered = (await returning.get(`/api/projects/${project.id}`).expect(200))
      .body as ProjectDetail;
    assert.equal(recovered.job?.id, jobId);
    assert.equal(recovered.job?.status, 'completed');
    assert.equal(recovered.status, 'review');
    assert.deepEqual(
      recovered.stickers.map((sticker) => ({ id: sticker.id, imageUrl: sticker.imageUrl })),
      savedImages,
    );
    await returning.post(`/api/projects/${project.id}/approve-all`).send({}).expect(200);
    const completed = (
      await returning.post(`/api/projects/${project.id}/complete`).send({}).expect(200)
    ).body as ProjectDetail;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.approvedCount, 6);
    assert.equal(
      (
        instance.db
          .prepare('SELECT COUNT(*) AS count FROM jobs WHERE project_id = ?')
          .get(project.id) as { count: number }
      ).count,
      1,
    );
  } finally {
    await instance.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test(
  'guest login is blocked during animated generation and succeeds with saved assets after completion',
  { timeout: 40_000 },
  async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'emoti-active-guest-recovery-'));
    const instance = createApp({ dataDir, testMode: true, openaiApiKey: '' });
    try {
      const existing = request.agent(instance.app);
      await existing.get('/api/bootstrap').expect(200);
      const registered = (
        await existing
          .post('/api/auth/register')
          .send({ name: '기존 작가', ...credentials })
          .expect(201)
      ).body;
      const guest = request.agent(instance.app);
      const boot = (await guest.get('/api/bootstrap').expect(200)).body;
      const created = (
        await guest
          .post('/api/projects')
          .send({
            name: '로그인 중에도 지켜지는 늘보군 모션',
            characterName: '늘보군',
            concept: '느긋하고 다정한 베이지 나무늘보와 초록 크로스백',
            format: 'animated',
            motionPreset: 'float',
            referenceUrl: '/samples/reference.png',
          })
          .expect(201)
      ).body as ProjectDetail;
      await guest
        .put(`/api/projects/${created.id}/direction`)
        .send({
          direction: {
            id: 'cozy',
            title: '느긋한 일상',
            description: '작은 움직임으로 전하는 다정한 인사',
            tags: ['위로'],
            color: '#667452',
            prompts: ['친근한 인사'],
          },
        })
        .expect(200);
      await guest
        .post(`/api/projects/${created.id}/generate`)
        .send({ provider: 'sample', count: 24 })
        .expect(202);
      const active = (await guest.get(`/api/projects/${created.id}`).expect(200))
        .body as ProjectDetail;
      assert.ok(['queued', 'running'].includes(active.job!.status));

      await guest.post('/api/auth/login').send(credentials).expect(409);
      const stillGuest = (await guest.get('/api/bootstrap').expect(200)).body;
      assert.equal(
        stillGuest.user.id,
        boot.user.id,
        'rejected login must leave the guest session intact',
      );
      assert.equal(stillGuest.user.isGuest, true);
      await existing.get(`/api/projects/${created.id}`).expect(404);

      let finished: ProjectDetail | undefined;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const current = (await guest.get(`/api/projects/${created.id}`).expect(200))
          .body as ProjectDetail;
        if (!['queued', 'running'].includes(current.job!.status)) {
          finished = current;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(finished, 'animated sample batch must settle');
      assert.equal(finished.job?.status, 'completed', finished.job?.error ?? undefined);
      assert.equal(finished.stickers.length, 24);
      const firstImage = finished.stickers[0]!.imageUrl;
      const firstPoster = finished.stickers[0]!.posterUrl;
      assert.match(firstImage, /\.webp$/);
      await guest.post('/api/auth/login').send(credentials).expect(200);
      const loggedIn = (await guest.get('/api/bootstrap').expect(200)).body;
      assert.equal(loggedIn.user.id, registered.user.id);
      assert.equal(loggedIn.user.isGuest, false);
      const merged = (await guest.get(`/api/projects/${created.id}`).expect(200))
        .body as ProjectDetail;
      assert.equal(merged.stickers.length, 24);
      assert.equal(merged.stickers[0]!.imageUrl, firstImage);
      await guest
        .get(firstImage)
        .expect(200)
        .expect('Content-Type', /image\/webp/);
      await guest
        .get(firstPoster)
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await existing.get(`/api/projects/${created.id}`).expect(200);
    } finally {
      await instance.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
