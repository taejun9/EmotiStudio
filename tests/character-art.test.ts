import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderCharacterSticker, type BuiltInCharacter } from '../server/character-art.ts';
import { renderFrameAnimation } from '../server/frame-animation.ts';
import { STICKER_PLANS } from '../shared/sticker-plans.ts';

const CHARACTERS: BuiltInCharacter[] = ['neulbo', 'tokki'];
const SIZE = 360;
const FRAME_BYTES = SIZE * SIZE * 4;
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function changedPixels(a: Buffer, b: Buffer, threshold = 30) {
  let changed = 0;
  for (let offset = 0; offset < a.length; offset += 4) {
    let difference = 0;
    for (let channel = 0; channel < 4; channel++)
      difference += Math.abs(a[offset + channel]! - b[offset + channel]!);
    if (difference > threshold) changed++;
  }
  return changed;
}

function transparentMargins(frame: Buffer, label: string) {
  for (let pixel = 0; pixel < SIZE; pixel++) {
    for (const index of [pixel, (SIZE - 1) * SIZE + pixel, pixel * SIZE, pixel * SIZE + SIZE - 1]) {
      assert.equal(frame[index * 4 + 3], 0, `${label}: art must not be clipped by the canvas`);
    }
  }
  let visible = 0;
  for (let offset = 3; offset < frame.length; offset += 4) if (frame[offset]! > 0) visible++;
  assert.ok(
    visible > SIZE * SIZE * 0.1 && visible < SIZE * SIZE * 0.8,
    `${label}: transparent and visibly drawn`,
  );
}

async function splitSheet(sheet: Buffer) {
  const raw = await sharp(sheet).ensureAlpha().raw().toBuffer();
  return Array.from({ length: 8 }, (_, index) => {
    const frame = Buffer.alloc(FRAME_BYTES);
    for (let y = 0; y < SIZE; y++) {
      const start = ((Math.floor(index / 4) * SIZE + y) * SIZE * 4 + (index % 4) * SIZE) * 4;
      raw.copy(frame, y * SIZE * 4, start, start + SIZE * 4);
    }
    return frame;
  });
}

test('both characters have 32 visually distinct transparent illustrations, with consistent identities', async () => {
  assert.equal(STICKER_PLANS.length, 32);
  assert.equal(new Set(STICKER_PLANS.map((plan) => plan.id)).size, 32);
  for (const character of CHARACTERS) {
    const fingerprints = new Set<string>();
    const thumbnails: Buffer[] = [];
    for (let planIndex = 0; planIndex < 32; planIndex++) {
      const { png } = await renderCharacterSticker(character, planIndex, { animated: false });
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.width, SIZE);
      assert.equal(info.height, SIZE);
      transparentMargins(data, `${character}/${STICKER_PLANS[planIndex]!.id}`);
      fingerprints.add(hash(data));
      thumbnails.push(await sharp(png).resize(72, 72).ensureAlpha().raw().toBuffer());
    }
    assert.equal(fingerprints.size, 32);
    // Inspect actual resized pixels too: metadata changes or a tiny decorative
    // mark cannot make a reused picture pass as a distinct scene.
    for (let a = 0; a < 32; a++)
      for (let b = a + 1; b < 32; b++) {
        assert.ok(
          changedPixels(thumbnails[a]!, thumbnails[b]!, 50) > 72 * 72 * 0.04,
          `${character}: ${STICKER_PLANS[a]!.id} and ${STICKER_PLANS[b]!.id} must differ visibly`,
        );
      }
  }
});

// Stable interior anchors in each authored scene, deliberately away from
// moving paws/eyelids. They also catch accidental global movement of the rig.
const HEAD_ANCHORS = [
  [180, 130],
  [180, 139],
  [228, 211],
  [180, 155],
  [180, 130],
  [180, 160],
  [183, 144],
  [180, 153],
  [180, 130],
  [180, 130],
  [180, 130],
  [180, 130],
  [180, 130],
  [180, 144],
  [176, 138],
  [180, 148],
  [180, 150],
  [190, 132],
  [174, 146],
  [180, 176],
  [176, 137],
  [180, 146],
  [174, 158],
  [172, 137],
];
const BODY_ANCHORS = [
  [187, 265],
  [187, 272],
  [166, 301],
  [187, 282],
  [185, 265],
  [183, 290],
  [177, 285],
  [187, 288],
  [187, 265],
  [187, 265],
  [187, 265],
  [187, 267],
  [187, 265],
  [183, 282],
  [187, 274],
  [180, 288],
  [180, 306],
  [186, 259],
  [183, 282],
  [183, 291],
  [187, 274],
  [185, 281],
  [183, 307],
  [177, 274],
];

test('all 24 scenes for both characters encode real local animation while head and torso stay fixed', async () => {
  for (const character of CHARACTERS) {
    const sceneHashes = new Set<string>();
    for (let planIndex = 0; planIndex < 24; planIndex++) {
      const label = `${character}/${STICKER_PLANS[planIndex]!.id}`;
      const { sheet, options } = await renderCharacterSticker(character, planIndex, {
        animated: true,
      });
      const frames = await splitSheet(sheet);
      sceneHashes.add(hash(frames[0]!));
      assert.ok(
        new Set(frames.map(hash)).size >= 3,
        `${label}: at least three genuinely different drawn frames`,
      );
      const [hx, hy] = HEAD_ANCHORS[planIndex]!;
      const [bx, by] = BODY_ANCHORS[planIndex]!;
      let mostChanged = 0;
      for (const frame of frames) {
        transparentMargins(frame, label);
        mostChanged = Math.max(mostChanged, changedPixels(frames[0]!, frame));
        for (const [x, y] of [
          [hx! - 4, hy! - 37],
          [bx!, by!],
        ]) {
          for (let row = 0; row < 5; row++) {
            const start = ((y! + row) * SIZE + x!) * 4;
            assert.deepEqual(
              frame.subarray(start, start + 20),
              frames[0]!.subarray(start, start + 20),
              `${label}: face/torso interior must stay fixed`,
            );
          }
        }
      }
      assert.ok(mostChanged > 60, `${label}: visible local movement, not duplicate stills`);
      assert.ok(
        mostChanged < SIZE * SIZE * 0.15,
        `${label}: movement stays local instead of transforming the whole drawing`,
      );
      const encoded = await renderFrameAnimation(sheet, options);
      assert.equal(encoded.durationMs, 2000);
      assert.deepEqual(encoded.warnings, []);
      for (const [buffer, count] of [
        [encoded.webp, encoded.frameCount],
        [encoded.gif, encoded.gifFrameCount],
      ] as const) {
        const metadata = await sharp(buffer, { animated: true }).metadata();
        assert.equal(metadata.pages, count);
        assert.ok(count >= 2 && count <= 8);
        assert.equal(metadata.width, 360);
        assert.equal(metadata.pageHeight, 360);
        assert.equal(metadata.hasAlpha, true);
        assert.equal(metadata.loop, 0);
      }
      assert.ok(encoded.webp.length < 650 * 1024, `${label}: animated WebP stays below 650KB`);
    }
    assert.equal(sceneHashes.size, 24, 'the full animated pack cannot reuse a single pose');
  }
});

test('preset revisions change pose/expression while invalid character and scene selection are rejected', async () => {
  for (const character of CHARACTERS) {
    const original = await renderCharacterSticker(character, 0, { animated: false });
    const revised = await renderCharacterSticker(character, 0, { animated: false, variant: 1 });
    const first = await sharp(original.png).ensureAlpha().raw().toBuffer();
    const second = await sharp(revised.png).ensureAlpha().raw().toBuffer();
    assert.ok(changedPixels(first, second) > 1000, 'a revision visibly changes the drawing');
  }
  await assert.rejects(
    renderCharacterSticker('unknown' as BuiltInCharacter, 0, { animated: false }),
  );
  await assert.rejects(renderCharacterSticker('neulbo', 32, { animated: false }));
  await assert.rejects(renderCharacterSticker('tokki', 24, { animated: true }));
  await assert.rejects(renderCharacterSticker('tokki', 0, { animated: true, variant: -1 }));
});

test('Tokki v2 keeps upright pink ears, white fur, round cheeks and a pink backpack at chat size', async () => {
  const { png } = await renderCharacterSticker('tokki', 0, { animated: false });
  const raw = await sharp(png).ensureAlpha().raw().toBuffer();
  const count = (
    bounds: [number, number, number, number],
    match: (r: number, g: number, b: number) => boolean,
  ) => {
    const [left, top, width, height] = bounds;
    let found = 0;
    for (let y = top; y < top + height; y++)
      for (let x = left; x < left + width; x++) {
        const i = (y * 360 + x) * 4;
        if (raw[i + 3] === 255 && match(raw[i]!, raw[i + 1]!, raw[i + 2]!)) found++;
      }
    return found;
  };
  const pink = (r: number, g: number, b: number) =>
    r > 230 && g > 140 && g < 235 && b > 150 && b < 235 && r - g > 20;
  assert.ok(count([90, 0, 85, 80], pink) > 150, 'left upright ear has a visible pink interior');
  assert.ok(count([185, 0, 85, 80], pink) > 150, 'right upright ear has a visible pink interior');
  assert.ok(count([120, 90, 120, 90], pink) > 900, 'rounded pink cheeks remain prominent');
  assert.ok(count([70, 180, 85, 110], pink) > 350, 'a pink backpack is visible beside the body');
  assert.ok(
    count([110, 80, 140, 240], (r, g, b) => r > 250 && g > 245 && b > 245) > 15_000,
    'fur is white, not the previous cream',
  );
  assert.equal(
    count([155, 180, 70, 40], (r, g, b) => g > r + 5 && g > b),
    0,
    'the old mint neck scarf is absent',
  );
  // A 120px render retains both pink ear interiors and the high-contrast contour.
  const small = await sharp(png).resize(120, 120).ensureAlpha().raw().toBuffer();
  let smallPink = 0,
    smallInk = 0;
  for (let i = 0; i < small.length; i += 4) {
    if (small[i + 3]! < 200) continue;
    if (pink(small[i]!, small[i + 1]!, small[i + 2]!)) smallPink++;
    if (small[i]! < 100 && small[i + 1]! < 90 && small[i + 2]! < 85) smallInk++;
  }
  assert.ok(
    smallPink > 250 && smallInk > 400,
    'signature color and contour survive chat-size downsampling',
  );
});
