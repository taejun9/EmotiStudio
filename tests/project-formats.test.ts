import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';
import { SAMPLE_WAVE_ACTION_PROMPT } from '../server/frame-animation.ts';
import { STICKER_PLANS } from '../shared/sticker-plans.ts';
import { distinctPng } from './image-fixtures.ts';
import type { ProjectDetail } from '../shared/types.ts';

const concept = {
  name: '늘보군의 움직이는 하루',
  characterName: '늘보군',
  concept: '느긋한 나무늘보가 친구에게 마음을 전해요.',
  referenceUrl: '/samples/reference.png',
};
const direction = {
  id: 'cozy',
  title: '다정한 일상',
  description: '느긋하고 따뜻한 하루',
  tags: ['일상'],
  color: '#A8BC94',
  prompts: ['손을 흔들어요'],
};
type Client = ReturnType<typeof request.agent>;
async function settled(client: Client, id: string): Promise<ProjectDetail> {
  for (let i = 0; i < 500; i++) {
    const result = await client.get(`/api/projects/${id}`).expect(200);
    if (!['queued', 'running'].includes(result.body.job?.status))
      return result.body as ProjectDetail;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Animated generation timed out');
}
// Deliberately distinct test poses: fixed body, eight independently drawn hand locations.
async function frameSheet(still = false) {
  const cells = Array.from({ length: 8 }, (_, i) => {
    const x = (i % 4) * 384,
      y = Math.floor(i / 4) * 384;
    const handX = 278 + (still ? 0 : i * 4),
      handY = 108 + (still ? 0 : [0, 8, 16, 24, 16, 8, 0, -8][i]!);
    return `<g transform="translate(${x} ${y})"><ellipse cx="180" cy="228" rx="78" ry="112" fill="#bca78e"/><circle cx="180" cy="114" r="64" fill="#dfcbb0"/><path d="M240 185 Q270 160 ${handX} ${handY}" fill="none" stroke="#bca78e" stroke-width="30" stroke-linecap="round"/><circle cx="${handX}" cy="${handY}" r="20" fill="#dfcbb0"/></g>`;
  }).join('');
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="768">${cells}</svg>`),
  )
    .png()
    .toBuffer();
}
function unzip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  const files = new Map<string, Buffer>();
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10),
      size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28),
      extraLength = buffer.readUInt16LE(offset + 30),
      commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test('v1 SQLite migration preserves legacy counts, original images, and revision history', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-v1-migration-'));
  const original = new DatabaseSync(path.join(directory, 'emotistudio.sqlite'));
  original.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE, password_hash TEXT, is_guest INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, character_name TEXT NOT NULL, concept TEXT NOT NULL, personality TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', reference_url TEXT, direction_json TEXT, status TEXT NOT NULL DEFAULT 'concept', provider TEXT NOT NULL DEFAULT 'sample', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE stickers (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, emotion TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', current_version INTEGER NOT NULL DEFAULT 1, feedback TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE versions (id TEXT PRIMARY KEY, sticker_id TEXT NOT NULL REFERENCES stickers(id), version INTEGER NOT NULL, image_url TEXT NOT NULL, prompt TEXT NOT NULL, feedback TEXT, provider TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(sticker_id, version));
    CREATE TABLE jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, error TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const date = '2026-09-30T00:00:00.000Z';
  original
    .prepare('INSERT INTO users VALUES (?, ?, NULL, NULL, 1, ?)')
    .run('owner', '기존 작가', date);
  for (const [name, amount] of [
    ['six', 6],
    ['twelve', 12],
    ['twenty-four', 24],
    ['empty', 0],
  ] as const) {
    original
      .prepare(
        "INSERT INTO projects VALUES (?, 'owner', ?, '늘보군', '기존 컨셉', '', '', NULL, NULL, 'review', 'sample', ?, ?)",
      )
      .run(name, name, date, date);
    const savedCount = amount === 12 ? 2 : amount;
    for (let i = 0; i < savedCount; i++) {
      original
        .prepare(
          "INSERT INTO stickers VALUES (?, ?, '인사', '반가워요', 'approved', 1, NULL, ?, ?)",
        )
        .run(`${name}-${i}`, name, i, date);
      original
        .prepare(
          "INSERT INTO versions VALUES (?, ?, 1, '/samples/hello.png', '보존할 프롬프트', NULL, 'sample', ?)",
        )
        .run(`v-${name}-${i}`, `${name}-${i}`, date);
    }
    if (amount === 12) {
      original
        .prepare("INSERT INTO jobs VALUES ('batch', ?, 'failed', 12, 2, '중단', ?, ?, ?)")
        .run(name, JSON.stringify({ count: 12, provider: 'sample' }), date, date);
      original
        .prepare("INSERT INTO jobs VALUES ('revision', ?, 'completed', 1, 1, NULL, ?, ?, ?)")
        .run(
          name,
          JSON.stringify({ count: 1, provider: 'sample', stickerId: `${name}-0` }),
          date,
          date,
        );
    }
  }
  original.close();
  let store = new Store(directory);
  try {
    for (const [name, target] of [
      ['six', 6],
      ['twelve', 12],
      ['twenty-four', 24],
      ['empty', 32],
    ] as const) {
      const project = store.detail(store.one('SELECT * FROM projects WHERE id = ?', name)!);
      assert.equal(project.targetCount, target);
      assert.equal(project.isLegacy, true);
      assert.equal(project.format, 'static');
      for (const sticker of project.stickers) {
        assert.equal(sticker.imageUrl, '/samples/hello.png');
        assert.equal(sticker.posterUrl, sticker.imageUrl);
        assert.equal(sticker.versions[0]!.sourceUrl, sticker.imageUrl);
        assert.equal(sticker.motionPreset, null);
        assert.equal(sticker.animation, null);
        assert.equal(sticker.status, 'approved');
      }
    }
    assert.equal(store.one('PRAGMA user_version')!.user_version, 4);
    store.db.close();
    store = new Store(directory);
    assert.equal(
      store.project(store.one("SELECT * FROM projects WHERE id = 'twelve'")!).targetCount,
      12,
      'Migration must remain idempotent',
    );
    assert.equal(store.one('PRAGMA integrity_check')!.integrity_check, 'ok');
  } finally {
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('new projects enforce 32/24 counts while editing a six-sticker legacy demo preserves its format', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-format-count-'));
  const instance = createApp({ dataDir: directory, testMode: true, openaiApiKey: '' });
  try {
    const client = request.agent(instance.app);
    const bootstrap = await client.get('/api/bootstrap').expect(200);
    const demo = bootstrap.body.projects[0];
    assert.equal(demo.targetCount, 6);
    assert.equal(demo.isLegacy, true);
    const renamed = await client
      .patch(`/api/projects/${demo.id}`)
      .send({ name: '기존 미리보기', format: 'static' })
      .expect(200);
    assert.equal(renamed.body.targetCount, 6);
    await client.patch(`/api/projects/${demo.id}`).send({ format: 'animated' }).expect(409);
    await client.patch(`/api/projects/${demo.id}`).send({ motionPreset: 'bounce' }).expect(409);
    for (const [format, target] of [
      ['static', 32],
      ['animated', 24],
    ] as const) {
      const created = await client
        .post('/api/projects')
        .send({ ...concept, format })
        .expect(201);
      assert.equal(created.body.targetCount, target);
      assert.equal(created.body.isLegacy, false);
      await client
        .put(`/api/projects/${created.body.id}/direction`)
        .send({ direction })
        .expect(200);
      await client
        .post(`/api/projects/${created.body.id}/generate`)
        .send({ provider: 'sample', count: 6 })
        .expect(400);
      await client.post(`/api/projects/${created.body.id}/complete`).send({}).expect(409);
    }
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('24 AI frame animations retain original PNG, revise articulated poses and export actual GIF/WebP timelines', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-animated-api-'));
  const png = await frameSheet();
  const referencePng = await sharp(png)
    .extract({ left: 0, top: 0, width: 384, height: 384 })
    .resize(512, 512)
    .png()
    .toBuffer();
  const uploadedReferences: Buffer[][] = [];
  const submittedPrompts: string[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++;
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.equal(form.get('size'), '1536x768');
    assert.match(String(form.get('prompt')), /exactly 8 distinct temporal keyframes/);
    submittedPrompts.push(String(form.get('prompt')));
    uploadedReferences.push(
      await Promise.all(
        form
          .getAll('image[]')
          .map(async (image) => Buffer.from(await (image as Blob).arrayBuffer())),
      ),
    );
    return new Response(
      JSON.stringify({ data: [{ b64_json: (await distinctPng(png, calls)).toString('base64') }] }),
      {
        status: 200,
      },
    );
  };
  let instance = createApp({
    dataDir: directory,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl,
  });
  try {
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    await client
      .post('/api/auth/register')
      .send({
        name: '움직임 작가',
        email: 'animation@example.com',
        password: 'Animation-test-password!',
      })
      .expect(201);
    const uploaded = await client
      .post('/api/uploads')
      .attach('file', referencePng, { filename: 'character.png', contentType: 'image/png' })
      .expect(201);
    let project = (
      await client
        .post('/api/projects')
        .send({
          ...concept,
          format: 'animated',
          referenceUrl: uploaded.body.url,
          actionPrompt: '오른손만 자연스럽게 인사해요',
        })
        .expect(201)
    ).body as ProjectDetail;
    await client.put(`/api/projects/${project.id}/direction`).send({ direction }).expect(200);
    await client
      .post(`/api/projects/${project.id}/generate`)
      .send({ provider: 'openai' })
      .expect(202);
    await client
      .post(`/api/projects/${project.id}/generate`)
      .send({ provider: 'openai' })
      .expect(409);
    project = await settled(client, project.id);
    assert.equal(project.job!.status, 'completed', project.job!.error || '');
    assert.equal(project.stickers.length, 24);
    assert.equal(calls, 24);
    assert.ok(
      uploadedReferences.flat().every((image) => image.equals(referencePng)),
      'Atlas must never be sent as the character reference',
    );
    const first = project.stickers[0]!;
    const originalUrl = first.versions[0]!.sourceUrl;
    assert.match(first.imageUrl, /\.webp$/);
    assert.match(first.gifUrl!, /\.gif$/);
    assert.match(first.posterUrl, /\.png$/);
    assert.notEqual(originalUrl, first.posterUrl);
    assert.equal(originalUrl, uploaded.body.url);
    assert.equal(first.animation?.kind, 'frames');
    assert.equal(first.animation?.columns, 4);
    assert.equal(first.animation?.rows, 2);
    assert.equal(first.motionPreset, null);
    await client.get(first.animation!.sheetUrl).expect(200);
    await client
      .post('/api/projects')
      .send({ ...concept, referenceUrl: first.animation!.sheetUrl })
      .expect(400);
    const original = await client.get(originalUrl).expect(200);
    assert.equal((await sharp(original.body).metadata()).width, 512);
    const poster = await client.get(first.posterUrl).expect(200);
    assert.equal((await sharp(poster.body).metadata()).width, 360);
    const animation = await client.get(first.imageUrl).expect(200);
    assert.match(animation.headers['content-type'], /image\/webp/);
    assert.ok((await sharp(animation.body, { animated: true }).metadata()).pages! > 1);
    const stranger = request.agent(instance.app);
    await stranger.get('/api/bootstrap').expect(200);
    await stranger.get(first.gifUrl!).expect(404);
    await client.patch(`/api/projects/${project.id}`).send({ motionPreset: 'shake' }).expect(409);

    await client
      .patch(`/api/projects/${project.id}/stickers/${first.id}`)
      .send({ status: 'approved' })
      .expect(200);
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/motion`)
      .send({ preset: 'shake' })
      .expect(410);
    const region = { x: 0.62, y: 0.15, width: 0.3, height: 0.45 };
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/animate`)
      .send({
        provider: 'openai',
        actionPrompt: '팔과 손목으로 작은 인사를 해요',
        region: { ...region, x: 0.99 },
      })
      .expect(400);
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/animate`)
      .send({ provider: 'openai', actionPrompt: '팔과 손목으로 작은 인사를 해요', region })
      .expect(202);
    project = await settled(client, project.id);
    assert.equal(project.job!.status, 'completed', project.job!.error || '');
    let changed = project.stickers[0]!;
    assert.equal(changed.versions.length, 2);
    assert.equal(changed.motionPreset, null);
    assert.equal(changed.status, 'pending');
    assert.equal(changed.versions[0]!.sourceUrl, originalUrl);
    assert.deepEqual(changed.animation?.region, region);
    assert.equal(changed.animation?.actionPrompt, '팔과 손목으로 작은 인사를 해요');
    const changedBytes = (await client.get(changed.imageUrl).expect(200)).body as Buffer;
    const decoded = await sharp(changedBytes, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frameBytes = 360 * 360 * 4;
    for (let frame = 1; frame < decoded.info.height / 360; frame++) {
      for (let y = 0; y < 360; y++)
        for (let x = 0; x < 360; x++) {
          if (
            x / 360 >= region.x &&
            x / 360 <= region.x + region.width &&
            y / 360 >= region.y &&
            y / 360 <= region.y + region.height
          )
            continue;
          const offset = (y * 360 + x) * 4;
          assert.equal(
            decoded.data.readUInt32LE(frame * frameBytes + offset),
            decoded.data.readUInt32LE(offset),
            'Every protected RGBA pixel must remain exact in the actual encoded WebP',
          );
        }
    }

    assert.equal(calls, 25, 'A new articulated pose sheet requires exactly one paid request');
    assert.ok(
      uploadedReferences[24]![0]!.equals(poster.body),
      'New local action must use the current poster as its placement reference',
    );
    assert.ok(
      uploadedReferences[24]![1]!.equals(referencePng),
      'Original identity reference remains an additional image',
    );
    assert.equal(
      uploadedReferences[24]!.length,
      2,
      'New actions should not accidentally use the previous sheet as identity',
    );
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/restore`)
      .send({ version: 1 })
      .expect(200);
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/revise`)
      .send({ provider: 'openai', feedback: '손을 조금 작게 그려주세요' })
      .expect(202);
    project = await settled(client, project.id);
    changed = project.stickers[0]!;
    assert.equal(changed.currentVersion, 3);
    assert.equal(changed.versions[0]!.sourceUrl, originalUrl);
    assert.equal(changed.versions.length, 3);
    assert.equal(changed.animation?.actionPrompt, STICKER_PLANS[0]!.actionPrompt);
    assert.equal(calls, 26);
    const originalAtlas = (await client.get(first.animation!.sheetUrl).expect(200)).body as Buffer;
    assert.ok(
      uploadedReferences[25]![0]!.equals(poster.body),
      'Revision must see the restored version poster',
    );
    assert.ok(
      uploadedReferences[25]![1]!.equals(originalAtlas),
      'Revision must see the actual timeline being corrected',
    );
    assert.ok(uploadedReferences[25]![2]!.equals(referencePng));
    assert.match(submittedPrompts[25]!, /CURRENT 4×2 EIGHT-POSE TIMELINE SHEET TO REVISE/);
    assert.match(submittedPrompts[25]!, /손을 조금 작게/);
    await client.post(`/api/projects/${project.id}/approve-all`).send({}).expect(200);
    await client.post(`/api/projects/${project.id}/complete`).send({}).expect(200);
    await client.get(`/api/projects/${project.id}/export?size=720`).expect(400);
    await client.get(`/api/projects/${project.id}/export?format=png`).expect(400);
    for (const format of ['webp', 'gif']) {
      const response = await client
        .get(`/api/projects/${project.id}/export?format=${format}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const files = unzip(response.body as Buffer);
      assert.equal([...files.keys()].filter((name) => name.startsWith('animations/')).length, 24);
      assert.equal([...files.keys()].filter((name) => name.startsWith('posters/')).length, 24);
      const manifest = JSON.parse(files.get('manifest.json')!.toString());
      assert.equal(manifest.image.format, format);
      assert.equal(manifest.project.targetCount, 24);
      assert.match(manifest.note, /WebP Animator/);
      const selected = manifest.stickers[0];
      assert.equal(selected.animation.kind, 'frames');
      assert.equal(selected.animation.sequence.length, selected.animation.delaysMs.length);
      const metadata = await sharp(files.get(selected.filename)!, { animated: true }).metadata();
      assert.equal(metadata.width, 360);
      assert.equal(metadata.pageHeight, 360);
      assert.equal(metadata.pages, selected.frameCount);
      assert.equal(
        metadata.delay!.reduce((sum, delay) => sum + delay, 0),
        selected.durationMs,
      );
    }
    await instance.close();
    instance = createApp({
      dataDir: directory,
      testMode: true,
      openaiApiKey: 'mock-key',
      fetchImpl,
    });
    assert.equal(
      (instance.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number })
        .n,
      26,
      'Database reopen must preserve one charge per requested pose sheet',
    );
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('animated generation checks storage capacity before contacting the paid provider', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-quota-preflight-'));
  let calls = 0;
  const instance = createApp({
    dataDir: directory,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () => {
      calls++;
      throw new Error('This request must never reach a provider');
    },
  });
  try {
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    const registered = await client
      .post('/api/auth/register')
      .send({ name: '용량 검증', email: 'quota@example.com', password: 'Quota-test-password!' })
      .expect(201);
    const insert = instance.db.prepare('INSERT INTO assets VALUES (?, ?, NULL, 1, ?)');
    for (let index = 0; index < 297; index++)
      insert.run(`${randomUUID()}.png`, registered.body.user.id, new Date().toISOString());
    const created = await client
      .post('/api/projects')
      .send({ ...concept, format: 'animated' })
      .expect(201);
    await client.put(`/api/projects/${created.body.id}/direction`).send({ direction }).expect(200);
    await client
      .post(`/api/projects/${created.body.id}/generate`)
      .send({ provider: 'openai' })
      .expect(202);
    const result = await settled(client, created.body.id);
    assert.equal(result.job!.status, 'failed');
    assert.match(result.job!.error!, /저장 한도/);
    assert.equal(calls, 0);
    assert.equal(
      (instance.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number })
        .n,
      0,
    );
    assert.equal(
      (instance.db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n,
      297,
    );
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed animation bundle removes only its uncommitted files and preserves existing references', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-bundle-rollback-'));
  const png = await frameSheet();
  let calls = 0;
  const instance = createApp({
    dataDir: directory,
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
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    await client
      .post('/api/auth/register')
      .send({
        name: '원본 보존 검증',
        email: 'bundle@example.com',
        password: 'Bundle-test-password!',
      })
      .expect(201);
    const reference = await client
      .post('/api/uploads')
      .attach('file', png, { filename: 'reference.png', contentType: 'image/png' })
      .expect(201);
    const existingFiles = await readdir(path.join(directory, 'assets'));
    const created = await client
      .post('/api/projects')
      .send({ ...concept, format: 'animated', referenceUrl: reference.body.url })
      .expect(201);
    await client.put(`/api/projects/${created.body.id}/direction`).send({ direction }).expect(200);
    instance.db.exec(
      "CREATE TRIGGER reject_animation_gif BEFORE INSERT ON assets WHEN NEW.filename LIKE '%.gif' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
    );
    await client
      .post(`/api/projects/${created.body.id}/generate`)
      .send({ provider: 'openai' })
      .expect(202);
    const result = await settled(client, created.body.id);
    assert.equal(result.job!.status, 'failed');
    assert.equal(result.stickers.length, 0);
    assert.equal(calls, 1);
    assert.deepEqual(
      await readdir(path.join(directory, 'assets')),
      existingFiles,
      'New source, poster, WebP, GIF and temporary files must all be removed after rollback',
    );
    assert.equal(
      (instance.db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n,
      1,
    );
    assert.equal(
      (instance.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number })
        .n,
      1,
      'Only the attempted API request may remain reserved',
    );
    await client.get(reference.body.url).expect(200);
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('animated preset library produces distinct poses and honest per-pose actions instead of claiming custom free-text generation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-frame-sample-'));
  const instance = createApp({ dataDir: directory, testMode: true, openaiApiKey: '' });
  try {
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    const created = await client
      .post('/api/projects')
      .send({ ...concept, format: 'animated', actionPrompt: '발끝으로 탭댄스를 춰요' })
      .expect(201);
    await client.put(`/api/projects/${created.body.id}/direction`).send({ direction }).expect(200);
    await client
      .post(`/api/projects/${created.body.id}/generate`)
      .send({ provider: 'sample' })
      .expect(202);
    let project = await settled(client, created.body.id);
    assert.equal(project.job?.status, 'completed', project.job?.error || '');
    assert.equal(project.stickers.length, 24);
    assert.equal(project.containsPresetSamples, true);
    assert.equal(new Set(project.stickers.map((s) => s.imageUrl)).size, 24);
    assert.equal(new Set(project.stickers.map((s) => s.poseId)).size, 24);
    assert.ok(
      project.stickers.every(
        (s, i) =>
          s.animation?.actionPrompt === STICKER_PLANS[i]!.actionPrompt && s.motionPreset === null,
      ),
    );
    const first = project.stickers[0]!;
    await client
      .post(`/api/projects/${project.id}/stickers/${first.id}/animate`)
      .send({
        provider: 'sample',
        actionPrompt: '눈만 깜빡여요',
        region: { x: 0, y: 0, width: 0.2, height: 0.2 },
      })
      .expect(202);
    project = await settled(client, project.id);
    assert.equal(project.job?.status, 'completed', project.job?.error || '');
    assert.equal(project.stickers[0]!.animation?.actionPrompt, STICKER_PLANS[0]!.actionPrompt);
    assert.equal(project.stickers[0]!.animation?.region, null);
    assert.match(project.stickers[0]!.versions[0]!.prompt, /AI로 해석한 결과가 아닙니다/);
    assert.equal(
      (instance.db.prepare('SELECT COUNT(*) AS n FROM image_usage').get() as { n: number }).n,
      0,
    );
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed or motionless provider sheets fail without saving a fake animation and release unattempted reservations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-frame-invalid-'));
  const still = await frameSheet(true);
  const malformed = await sharp(still)
    .extract({ left: 0, top: 0, width: 384, height: 384 })
    .png()
    .toBuffer();
  let upstream = malformed;
  let calls = 0;
  const instance = createApp({
    dataDir: directory,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ b64_json: upstream.toString('base64') }] }), {
        status: 200,
      });
    },
  });
  try {
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    await client
      .post('/api/auth/register')
      .send({
        name: '실패 검증',
        email: 'frames-invalid@example.com',
        password: 'Frame-invalid-password!',
      })
      .expect(201);
    for (const [image, error] of [
      [malformed, /4×2 프레임 시트/],
      [still, /보이는 움직임이 없습니다/],
    ] as const) {
      upstream = image;
      const created = await client
        .post('/api/projects')
        .send({ ...concept, format: 'animated' })
        .expect(201);
      await client
        .put(`/api/projects/${created.body.id}/direction`)
        .send({ direction })
        .expect(200);
      await client
        .post(`/api/projects/${created.body.id}/generate`)
        .send({ provider: 'openai' })
        .expect(202);
      const project = await settled(client, created.body.id);
      assert.equal(project.job?.status, 'failed');
      assert.match(project.job!.error!, error);
      assert.equal(project.stickers.length, 0);
      await client.post(`/api/projects/${project.id}/complete`).send({}).expect(409);
    }
    assert.equal(calls, 2);
    assert.equal(
      (instance.db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n,
      0,
    );
    assert.equal(
      (instance.db.prepare('SELECT SUM(image_count) AS n FROM image_usage').get() as { n: number })
        .n,
      2,
    );
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('sample-to-AI frame revision maps visible frame numbers to atlas cells and preserves its repeated playback timeline', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'emoti-review-timeline-'));
  const sheet = await frameSheet();
  let calls = 0;
  const prompts: string[] = [];
  const instance = createApp({
    dataDir: directory,
    testMode: true,
    openaiApiKey: 'mock-key',
    fetchImpl: async (_url, init) => {
      calls++;
      assert.ok(init?.body instanceof FormData);
      const form = init.body as FormData;
      prompts.push(String(form.get('prompt')));
      assert.equal(form.getAll('image[]').length, calls === 1 ? 3 : 2);
      return new Response(JSON.stringify({ data: [{ b64_json: sheet.toString('base64') }] }), {
        status: 200,
      });
    },
  });
  try {
    const client = request.agent(instance.app);
    await client.get('/api/bootstrap').expect(200);
    await client
      .post('/api/auth/register')
      .send({
        name: '프레임 검수 작가',
        email: 'timeline-review@example.com',
        password: 'Timeline-review-password!',
      })
      .expect(201);
    const created = await client
      .post('/api/projects')
      .send({ ...concept, format: 'animated' })
      .expect(201);
    await client.put(`/api/projects/${created.body.id}/direction`).send({ direction }).expect(200);
    await client
      .post(`/api/projects/${created.body.id}/generate`)
      .send({ provider: 'sample' })
      .expect(202);
    let project = await settled(client, created.body.id);
    assert.equal(project.job?.status, 'completed', project.job?.error || '');
    const previous = project.stickers[0]!;
    previous.animation!.sequence = [0, 1, 0, 4, 7, 4, 0];
    previous.animation!.delaysMs = [400, 130, 280, 160, 290, 160, 580];
    instance.db
      .prepare('UPDATE versions SET animation_json = ? WHERE sticker_id = ?')
      .run(JSON.stringify(previous.animation), previous.id);
    assert.deepEqual(previous.animation!.sequence, [0, 1, 0, 4, 7, 4, 0]);
    await client
      .post(`/api/projects/${project.id}/stickers/${previous.id}/revise`)
      .send({ provider: 'openai', feedback: '3번 프레임의 손가락을 고쳐주세요' })
      .expect(202);
    project = await settled(client, project.id);
    assert.equal(project.job?.status, 'completed', project.job?.error || '');
    const revised = project.stickers[0]!;
    assert.match(prompts[0]!, /review frame 3 → atlas cell 1 \(280ms\)/);
    assert.match(prompts[0]!, /3번 프레임의 손가락/);
    assert.match(prompts[0]!, /Repeated atlas cells are the same pose/);
    assert.deepEqual(revised.animation!.sequence, previous.animation!.sequence);
    assert.deepEqual(revised.animation!.delaysMs, previous.animation!.delaysMs);
    assert.equal(revised.durationMs, previous.durationMs);
    assert.equal(revised.versions[0]!.sourceUrl, previous.versions[0]!.sourceUrl);
    const encoded = await sharp((await client.get(revised.imageUrl).expect(200)).body, {
      animated: true,
    }).metadata();
    assert.deepEqual(encoded.delay, previous.animation!.delaysMs);
    await client
      .post(`/api/projects/${project.id}/stickers/${previous.id}/animate`)
      .send({ provider: 'openai', actionPrompt: '손을 천천히 들어 인사해요' })
      .expect(202);
    project = await settled(client, project.id);
    assert.equal(project.job?.status, 'completed', project.job?.error || '');
    assert.deepEqual(project.stickers[0]!.animation!.sequence, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(
      project.stickers[0]!.animation!.delaysMs,
      [250, 250, 250, 250, 250, 250, 250, 250],
    );
    assert.doesNotMatch(prompts[1]!, /Existing visible review timeline/);
    assert.equal(calls, 2);
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});
