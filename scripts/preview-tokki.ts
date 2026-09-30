/** Generate an isolated, reproducible review pack through the real application API. */
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp, { type OverlayOptions } from 'sharp';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { getCharacterPreset } from '../shared/character-presets.ts';
import type { ProjectDetail, Sticker } from '../shared/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'test-results/tokki-v2-preview'));
const dataDir = await mkdtemp(path.join(tmpdir(), 'emoti-tokki-preview-'));
const instance = createApp({ dataDir, testMode: true, openaiApiKey: '', secureCookies: false });
const client = request.agent(instance.app);
const preset = getCharacterPreset('tokki');
const rows: {
  name: string;
  format: string;
  bytes: number;
  pages: number;
  width: number;
  height: number;
  transparent: boolean;
  delaysMs?: number[];
  loop?: number;
}[] = [];
const readAsset = (url: string) => readFile(path.join(dataDir, 'assets', path.basename(url)));
const safe = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function waitForSet(id: string): Promise<ProjectDetail> {
  for (let i = 0; i < 1200; i++) {
    const { body } = await client.get(`/api/projects/${id}`).expect(200);
    if (body.job?.status === 'failed') throw new Error(body.job.error);
    if (body.job?.status === 'completed') return body as ProjectDetail;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Preview generation timeout');
}
async function montage(stickers: Sticker[], dark: boolean, clean: boolean, filename: string) {
  const size = 160,
    cellHeight = 180,
    columns = 8;
  const overlays: OverlayOptions[] = [];
  for (const [index, sticker] of stickers.entries()) {
    const version = sticker.versions.find((v) => v.version === sticker.currentVersion)!;
    const raw = await readAsset(clean ? version.cleanImageUrl : sticker.posterUrl);
    const image = await sharp(raw).resize(size, size).png().toBuffer();
    const x = (index % columns) * size,
      y = Math.floor(index / columns) * cellHeight;
    overlays.push({ input: image, left: x, top: y });
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="20"><text x="80" y="15" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${dark ? '#ffffff' : '#342922'}">${String(index + 1).padStart(2, '0')} · ${safe(sticker.poseId || '')}</text></svg>`,
    );
    overlays.push({ input: label, left: x, top: y + size });
  }
  await sharp({
    create: {
      width: columns * size,
      height: Math.ceil(stickers.length / columns) * cellHeight,
      channels: 4,
      background: dark ? '#252932' : '#fffdf8',
    },
  })
    .composite(overlays)
    .png()
    .toFile(path.join(output, filename));
}
try {
  await mkdir(output, { recursive: true });
  for (const folder of ['static', 'animated', 'clean'])
    await mkdir(path.join(output, folder), { recursive: true });
  await client.get('/api/bootstrap').expect(200);
  const { body: concept } = await client
    .post('/api/concepts')
    .send({
      name: '토끼찬구 · 새 설정화',
      characterName: preset.name,
      concept: preset.concept,
      personality: preset.personality,
      audience: preset.audience,
      referenceUrl: preset.image,
      builtinCharacter: preset.id,
    })
    .expect(201);
  const sets: ProjectDetail[] = [];
  for (const format of ['static', 'animated'] as const) {
    const { body: created } = await client
      .post(`/api/concepts/${concept.id}/projects`)
      .send({
        name: `토끼찬구 ${format === 'static' ? '32가지 마음' : '24가지 작은 동작'}`,
        format,
        captionsEnabled: true,
      })
      .expect(201);
    await client
      .put(`/api/projects/${created.id}/direction`)
      .send({
        direction: {
          id: 'tokki-v2',
          title: '늘보와 함께하는 활발한 하루',
          description: '급하지만 따뜻한 토끼찬구가 친구를 응원하고 기다려 주는 일상.',
          tags: ['활발함', '응원', '친구'],
          color: '#EFABA9',
          prompts: ['새 설정화의 흰 토끼와 분홍 백팩·당근 키링을 유지하며 장면별 감정을 표현해요.'],
        },
      })
      .expect(200);
    await client
      .post(`/api/projects/${created.id}/generate`)
      .send({ provider: 'sample' })
      .expect(202);
    const project = await waitForSet(created.id);
    assert.equal(project.stickers.length, format === 'static' ? 32 : 24);
    const unique = new Set<string>();
    for (const [index, sticker] of project.stickers.entries()) {
      const stem = `${String(index + 1).padStart(2, '0')}-${sticker.poseId}`;
      const version = sticker.versions.find((v) => v.version === sticker.currentVersion)!;
      for (const [extension, url] of format === 'animated'
        ? [
            ['webp', sticker.imageUrl],
            ['gif', sticker.gifUrl!],
            ['png', sticker.posterUrl],
          ]
        : [['png', sticker.imageUrl]]) {
        const buffer = await readAsset(url!);
        const metadata = await sharp(buffer, { animated: true }).metadata();
        const stats = await sharp(buffer).stats();
        const height = metadata.pageHeight || metadata.height || 0;
        assert.equal(metadata.width, 360);
        assert.equal(height, 360);
        assert.equal(metadata.hasAlpha, true);
        assert.equal(stats.isOpaque, false);
        await writeFile(path.join(output, format, `${stem}.${extension}`), buffer);
        rows.push({
          name: `${format}/${stem}.${extension}`,
          format: metadata.format || '',
          bytes: buffer.length,
          pages: metadata.pages || 1,
          width: metadata.width!,
          height,
          transparent: !stats.isOpaque,
          delaysMs: metadata.delay,
          loop: metadata.loop,
        });
      }
      const clean = await readAsset(version.cleanImageUrl);
      const raw = await sharp(clean).ensureAlpha().raw().toBuffer();
      unique.add(createHash('sha256').update(raw).digest('hex'));
      if (format === 'static') await writeFile(path.join(output, 'clean', `${stem}.png`), clean);
    }
    assert.equal(unique.size, project.targetCount);
    await client.post(`/api/projects/${project.id}/approve-all`).send({}).expect(200);
    await client.post(`/api/projects/${project.id}/complete`).send({}).expect(200);
    for (const kind of format === 'static' ? ['png'] : ['webp', 'gif']) {
      const response = await client
        .get(
          `/api/projects/${project.id}/export?size=360${kind === 'png' ? '' : `&format=${kind}`}`,
        )
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
          res.on('error', callback);
        })
        .expect(200);
      await writeFile(path.join(output, `tokki-${project.targetCount}-${kind}.zip`), response.body);
    }
    sets.push(project);
  }
  await montage(sets[0]!.stickers, false, false, 'static-light.png');
  await montage(sets[0]!.stickers, true, false, 'static-dark.png');
  await montage(sets[0]!.stickers, false, true, 'static-no-caption.png');
  // Preserve the actual playback cadence in the contact sheet, including anticipation and holds.
  const timeline = sets[1]!.stickers[0]!.animation!.delaysMs;
  for (const sticker of sets[1]!.stickers)
    assert.deepEqual(
      sticker.animation!.delaysMs,
      timeline,
      'Contact sheet requires a shared timeline',
    );
  const frames: Buffer[] = [];
  const width = 6 * 160,
    height = 4 * 180;
  for (let tick = 0; tick < timeline.length; tick++) {
    const overlays: OverlayOptions[] = [];
    for (const [index, sticker] of sets[1]!.stickers.entries()) {
      const animation = sticker.animation!;
      const cell = animation.sequence[tick % animation.sequence.length]!;
      const poster = await sharp(await readAsset(animation.sheetUrl))
        .extract({
          left: (cell % animation.columns) * 360,
          top: Math.floor(cell / animation.columns) * 360,
          width: 360,
          height: 360,
        })
        .resize(160, 160)
        .png()
        .toBuffer();
      overlays.push({ input: poster, left: (index % 6) * 160, top: Math.floor(index / 6) * 180 });
    }
    frames.push(
      await sharp({ create: { width, height, channels: 4, background: '#fffdf8' } })
        .composite(overlays)
        .raw()
        .toBuffer(),
    );
  }
  await sharp(Buffer.concat(frames), {
    raw: { width, height: height * timeline.length, channels: 4, pageHeight: height },
  })
    .gif({ loop: 0, delay: timeline, colours: 256, effort: 7 })
    .toFile(path.join(output, 'animated-24.gif'));
  const contactMetadata = await sharp(path.join(output, 'animated-24.gif'), {
    animated: true,
  }).metadata();
  assert.deepEqual(
    contactMetadata.delay,
    timeline,
    'Contact sheet timing must match exported animations',
  );
  await writeFile(
    path.join(output, 'quality-report.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        character: preset.name,
        design: preset.concept,
        provider: 'code-preset',
        staticCount: 32,
        animatedCount: 24,
        automatedApprovalForExport: true,
        scope:
          'Local format, transparency, dimensions and duplicate checks. Visual quality needs manual review. Not platform certification.',
        files: rows,
      },
      null,
      2,
    ) + '\n',
  );
  const sections = sets
    .map(
      (project) =>
        `<section><h2>${project.format === 'static' ? '정지 32종' : '움직이는 24종'}</h2><div class="grid">${project.stickers
          .map((sticker, index) => {
            const stem = `${String(index + 1).padStart(2, '0')}-${sticker.poseId}`;
            return `<figure><img src="${project.format}/${stem}.${project.format === 'static' ? 'png' : 'webp'}" alt="${safe(sticker.title)}"><figcaption>${index + 1}. ${safe(sticker.title)}</figcaption></figure>`;
          })
          .join('')}</div></section>`,
    )
    .join('');
  await writeFile(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>토끼찬구 새 디자인 검수</title><style>body{font:16px system-ui;background:#fffdf8;color:#342922;margin:24px}body.dark{background:#252932;color:#fff}header{max-width:920px}button,a{display:inline-block;padding:10px;margin:4px;color:inherit}button{cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,180px);gap:12px}figure{margin:0}img{width:160px;height:160px}figcaption{font-size:13px}.large img{width:360px;height:360px}.large .grid{grid-template-columns:repeat(auto-fit,380px)}</style><header><h1>토끼찬구 · 새 설정화 검수</h1><p>흰 몸과 곧은 귀, 분홍 볼, 분홍 백팩과 당근 키링. 코드 기반 프리셋으로 다시 제작한 32개 정지·24개 움직이는 이모티콘입니다.</p><button onclick="document.body.classList.toggle('dark')">밝음 / 어두움</button><button onclick="document.body.classList.toggle('large')">160px / 360px</button><p><a href="tokki-32-png.zip">32개 PNG ZIP</a><a href="tokki-24-webp.zip">24개 WebP ZIP</a><a href="tokki-24-gif.zip">24개 GIF ZIP</a></p><p>자동 검사와 시각 검수용 결과입니다. 플랫폼 심사 승인을 뜻하지 않습니다.</p></header>${sections}</html>`,
  );
  console.log(`검증: ${output} — static32 + animated24, PNG/WebP/GIF exports, quality-report.json`);
} finally {
  await instance.close();
  await rm(dataDir, { recursive: true, force: true });
}
