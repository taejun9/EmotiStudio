import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { applyCaption, normalizeCaption } from '../server/captions.ts';
import { renderCharacterSticker } from '../server/character-art.ts';
import { renderFrameAnimation } from '../server/frame-animation.ts';

const pixels = (input: Buffer) => sharp(input).ensureAlpha().raw().toBuffer();
test('Korean captions have opaque contrasting lettering, transparent margins and literal markup', async () => {
  const original = await renderCharacterSticker('tokki', 0, { animated: false });
  const result = await applyCaption(original.png, '고마워, 내 친구!');
  const raw = await pixels(result);
  const at = (x: number, y: number) => [...raw.subarray((y * 360 + x) * 4, (y * 360 + x) * 4 + 4)];
  assert.deepEqual(at(180, 345), [255, 253, 247, 255]);
  assert.equal(at(0, 359)[3], 0);
  let ink = 0;
  for (let y = 305; y < 339; y++)
    for (let x = 40; x < 320; x++) {
      const [r, g, b, a] = at(x, y);
      if (r! < 80 && g! < 80 && b! < 80 && a === 255) ink++;
    }
  assert.ok(ink > 350, 'Korean glyphs are rasterized, not missing text');
  for (const background of ['#141820', '#ffffff']) {
    const composite = await sharp({ create: { width: 360, height: 360, channels: 4, background } })
      .composite([{ input: result }])
      .raw()
      .toBuffer();
    assert.deepEqual(
      [...composite.subarray((345 * 360 + 180) * 4, (345 * 360 + 180) * 4 + 4)],
      [255, 253, 247, 255],
    );
  }
  const escaped = await applyCaption(original.png, '<b>좋아</b> & 친구');
  assert.equal((await sharp(escaped).metadata()).width, 360);
  assert.ok(!(await pixels(escaped)).equals(raw));
});

test('caption input supports Korean graphemes and rejects empty, oversized and hidden controls', () => {
  assert.equal(normalizeCaption('  안녕\n 친구  '), '안녕 친구');
  assert.equal(normalizeCaption('가'.repeat(24)).length, 24);
  for (const invalid of ['', ' ', '가'.repeat(25), '안\u200b녕', '안\u202e녕'])
    assert.throws(() => normalizeCaption(invalid));
});

test('animated captions remain fixed and removing them restores the exact clean atlas without cumulative shrinking', async () => {
  const source = await renderCharacterSticker('tokki', 0, { animated: true });
  const first = await renderFrameAnimation(source.sheet, { ...source.options, caption: '안녕!' });
  const frames = await sharp(first.sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const band = async (index: number) =>
    sharp(frames.data, {
      raw: { width: frames.info.width, height: frames.info.height, channels: 4 },
    })
      .extract({
        left: (index % first.columns) * 360,
        top: Math.floor(index / first.columns) * 360 + 292,
        width: 360,
        height: 68,
      })
      .raw()
      .toBuffer();
  const reference = await band(0);
  for (let i = 1; i < first.columns * first.rows; i++) assert.ok((await band(i)).equals(reference));
  const restored = await renderFrameAnimation(first.cleanSheet, {
    columns: first.columns,
    rows: first.rows,
    sequence: first.sequence,
    delaysMs: first.delaysMs,
    padding: 0,
    region: null,
    registerFrames: false,
  });
  assert.ok((await pixels(restored.sheet)).equals(await pixels(first.cleanSheet)));
  assert.ok((await pixels(restored.poster)).equals(await pixels(first.cleanPoster)));
  assert.ok(!(await pixels(first.poster)).equals(await pixels(first.cleanPoster)));
  const captionAgain = await renderFrameAnimation(restored.cleanSheet, {
    columns: first.columns,
    rows: first.rows,
    sequence: first.sequence,
    delaysMs: first.delaysMs,
    padding: 0,
    region: null,
    registerFrames: false,
    caption: '안녕!',
  });
  assert.ok((await pixels(captionAgain.sheet)).equals(await pixels(first.sheet)));
});
