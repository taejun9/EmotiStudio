import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  renderFrameAnimation,
  SAMPLE_WAVE_OPTIONS,
  type RenderedFrameAnimation,
} from '../server/frame-animation.ts';

const SIZE = 360;
const FRAME_BYTES = SIZE * SIZE * 4;

async function fixtureSheet({ moving = true, drift = true } = {}) {
  const atlas = Buffer.alloc(4 * 2 * FRAME_BYTES);
  for (let index = 0; index < 8; index++) {
    const frame = Buffer.alloc(FRAME_BYTES);
    const dx = drift && index > 0 ? 3 : 0;
    const dy = drift && index > 0 ? -2 : 0;
    const rect = (left: number, top: number, width: number, height: number, rgba: number[]) => {
      for (let y = top + dy; y < top + height + dy; y++) {
        for (let x = left + dx; x < left + width + dx; x++) {
          for (let channel = 0; channel < 4; channel++)
            frame[(y * SIZE + x) * 4 + channel] = rgba[channel]!;
        }
      }
    };
    rect(165, 75, 130, 240, [181, 138, 96, 255]);
    rect(188, 109, 50, 70, [241, 223, 181, 255]);
    rect(241, 113, 17, 11, [67, 48, 27, 255]);
    // A translucent edge verifies premultiplied blending and preservation of alpha.
    rect(
      55 + (moving ? index * 7 : 0),
      130 + (moving ? index * 3 : 0),
      35,
      65,
      [181, 138, 96, 255],
    );
    rect(53 + (moving ? index * 7 : 0), 130 + (moving ? index * 3 : 0), 2, 65, [181, 138, 96, 120]);
    for (let y = 0; y < SIZE; y++) {
      frame.copy(
        atlas,
        ((Math.floor(index / 4) * SIZE + y) * SIZE * 4 + (index % 4) * SIZE) * 4,
        y * SIZE * 4,
        (y + 1) * SIZE * 4,
      );
    }
  }
  return sharp(atlas, { raw: { width: SIZE * 4, height: SIZE * 2, channels: 4 } })
    .png()
    .toBuffer();
}

async function atlasFrames(result: RenderedFrameAnimation) {
  const { data, info } = await sharp(result.sheet)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, result.columns * SIZE);
  assert.equal(info.height, result.rows * SIZE);
  return Array.from({ length: result.columns * result.rows }, (_, index) => {
    const frame = Buffer.alloc(FRAME_BYTES);
    for (let y = 0; y < SIZE; y++) {
      const start =
        ((Math.floor(index / result.columns) * SIZE + y) * info.width +
          (index % result.columns) * SIZE) *
        4;
      data.copy(frame, y * SIZE * 4, start, start + SIZE * 4);
    }
    return frame;
  });
}

async function verifyEncodings(result: RenderedFrameAnimation) {
  for (const [format, buffer, count] of [
    ['webp', result.webp, result.frameCount],
    ['gif', result.gif, result.gifFrameCount],
  ] as const) {
    const metadata = await sharp(buffer, { animated: true }).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 360);
    assert.equal(metadata.pageHeight, 360);
    assert.equal(metadata.pages, count);
    assert.ok(count >= 2 && count <= 24);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.loop, 0);
    assert.equal(
      metadata.delay!.reduce((sum, delay) => sum + delay, 0),
      result.durationMs,
    );
  }
}

test('drawn poses remain independent while registration fixes sheet drift and protected pixels stay exact', async () => {
  const result = await renderFrameAnimation(await fixtureSheet(), {
    region: { x: 0.08, y: 0.25, width: 0.35, height: 0.42 },
  });
  await verifyEncodings(result);
  assert.equal(result.durationMs, 2000);
  assert.equal(result.warnings.length, 0);
  for (const aligned of result.registration.slice(1)) {
    assert.equal(aligned.dx, -3);
    assert.equal(aligned.dy, 2);
    assert.ok(aligned.error < 0.001, 'subpixel resampling leaves less than 0.1% body error');
  }
  const frames = await atlasFrames(result);
  for (const frame of frames.slice(1)) {
    let movingPixels = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const offset = (y * SIZE + x) * 4;
        const inRegion =
          (x + 0.5) / SIZE > 0.08 &&
          (x + 0.5) / SIZE < 0.43 &&
          (y + 0.5) / SIZE > 0.25 &&
          (y + 0.5) / SIZE < 0.67;
        if (inRegion) {
          if (!frame.subarray(offset, offset + 4).equals(frames[0]!.subarray(offset, offset + 4)))
            movingPixels++;
        } else {
          assert.deepEqual(
            frame.subarray(offset, offset + 4),
            frames[0]!.subarray(offset, offset + 4),
          );
        }
      }
    }
    assert.ok(movingPixels > 100, 'the arm must visibly change independently of the body');
  }
  const departedArm = (144 * SIZE + 64) * 4 + 3;
  assert.equal(frames[0]![departedArm], 255);
  assert.equal(
    frames[7]![departedArm],
    0,
    'replacement removes the old limb instead of leaving a ghost',
  );
  const firstWebp = await sharp(result.webp, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
  const poster = await sharp(result.poster).ensureAlpha().raw().toBuffer();
  assert.deepEqual(firstWebp, poster, 'lossless WebP starts with the exact PNG poster');
});

test('real 늘보군 sheet preserves face, body and bag while an authored arm loop keeps transparent margins', async () => {
  const result = await renderFrameAnimation(
    'public/samples/animations/wave.png',
    SAMPLE_WAVE_OPTIONS,
  );
  await verifyEncodings(result);
  assert.ok(result.webp.length < 650 * 1024);
  assert.equal(result.durationMs, 2000);
  assert.deepEqual(result.sequence, SAMPLE_WAVE_OPTIONS.sequence);
  assert.deepEqual(
    result.warnings,
    [],
    'curated sample poses align inside the permitted search range',
  );
  assert.deepEqual(result.delaysMs, SAMPLE_WAVE_OPTIONS.delaysMs);
  assert.ok(!result.sequence.includes(6), 'the face-occluding pose is excluded from playback');
  assert.ok(
    !result.sequence.includes(2),
    'the clipped extended-arm pose is excluded from playback',
  );
  assert.ok(
    !result.sequence.includes(3),
    'the pose with an inconsistent shoulder outline is excluded',
  );
  const frames = await atlasFrames(result);
  const protectedRects = [
    { x: 123, y: 110, width: 15, height: 35, name: 'forehead inside polygon bounding box' },
    { x: 145, y: 95, width: 120, height: 85, name: 'face' },
    { x: 170, y: 235, width: 70, height: 40, name: 'body' },
    { x: 105, y: 255, width: 50, height: 36, name: 'bag' },
  ];
  for (const [index, frame] of frames.entries()) {
    for (const region of protectedRects) {
      for (let y = region.y; y < region.y + region.height; y++) {
        const start = (y * SIZE + region.x) * 4;
        assert.deepEqual(
          frame.subarray(start, start + region.width * 4),
          frames[0]!.subarray(start, start + region.width * 4),
          `${region.name} remains exact in cell ${index}`,
        );
      }
    }
    for (let p = 0; p < SIZE; p++) {
      for (const offset of [
        p * 4 + 3,
        ((SIZE - 1) * SIZE + p) * 4 + 3,
        p * SIZE * 4 + 3,
        (p * SIZE + SIZE - 1) * 4 + 3,
      ]) {
        assert.equal(frame[offset], 0, `cell ${index} has no clipped outer edge`);
      }
    }
  }
  let armChanges = 0;
  for (let y = 90; y < 230; y++) {
    for (let x = 10; x < 100; x++) {
      const offset = (y * SIZE + x) * 4;
      if (!frames[0]!.subarray(offset, offset + 4).equals(frames[4]!.subarray(offset, offset + 4)))
        armChanges++;
    }
  }
  assert.ok(armChanges > 1000, 'actual AI-drawn arm poses produce substantial local motion');
  // Verify the delivered WebP too, not only the pre-encoding atlas.
  const decoded = await sharp(result.webp, { animated: true }).ensureAlpha().raw().toBuffer();
  for (let index = 1; index < result.frameCount; index++) {
    for (const region of protectedRects) {
      for (let y = region.y; y < region.y + region.height; y++) {
        const start = (y * SIZE + region.x) * 4;
        assert.deepEqual(
          decoded.subarray(
            index * FRAME_BYTES + start,
            index * FRAME_BYTES + start + region.width * 4,
          ),
          decoded.subarray(start, start + region.width * 4),
        );
      }
    }
  }
});

test('invalid grids, regions, timing and static-only timelines are rejected', async () => {
  const source = await fixtureSheet({ moving: false, drift: false });
  const singleSquare = await sharp(source).resize(512, 512, { fit: 'fill' }).png().toBuffer();
  await assert.rejects(renderFrameAnimation(singleSquare), /정사각형/);
  await assert.rejects(renderFrameAnimation(source, { columns: 6, rows: 5 }), /2개에서 24개/);
  await assert.rejects(
    renderFrameAnimation(source, { region: { x: 0.9, y: 0, width: 0.5, height: 1 } }),
    /사각형/,
  );
  await assert.rejects(
    renderFrameAnimation(source, {
      region: {
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
      },
    }),
    /면적/,
  );
  await assert.rejects(renderFrameAnimation(source, { sequence: [0, 8] }), /재생 순서/);
  await assert.rejects(
    renderFrameAnimation(source, { sequence: [0, 1], delaysMs: [10, 1990] }),
    /프레임별/,
  );
  await assert.rejects(renderFrameAnimation(source), /움직임이 없습니다/);
});
