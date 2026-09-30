import sharp from 'sharp';
import { applyCaption } from './captions.ts';

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPolygon {
  points: Array<{ x: number; y: number }>;
}

export type AnimationRegion = NormalizedRect | NormalizedPolygon;

export interface FrameAnimationOptions {
  columns?: number;
  rows?: number;
  /** Editable regions on the square output canvas, in 0–1 coordinates. */
  region?: AnimationRegion | AnimationRegion[] | null;
  durationMs?: number;
  /** Authored cell order; no synthetic poses are generated between cells. */
  sequence?: number[];
  /** Per-timeline-frame timing in 10ms units, overriding durationMs. */
  delaysMs?: number[];
  /** Align small sheet-layout drift using the protected body; never rotate or scale poses. */
  registerFrames?: boolean;
  /** Maximum integer-pixel alignment correction, 0–16; default 6. */
  maxTranslation?: number;
  /** Already-normalised stored sheets use zero padding on re-encoding. */
  padding?: number;
  /** Composited after part locking; excluded from cleanSheet/cleanPoster. */
  caption?: string | null;
}

export interface FrameRegistration {
  /** Integer-pixel correction on the 360px output canvas. */
  dx: number;
  dy: number;
  /** Mean normalised premultiplied RGBA error in the protected body, before masking. */
  error: number;
}

export interface RenderedFrameAnimation {
  webp: Buffer;
  gif: Buffer;
  poster: Buffer;
  cleanSheet: Buffer;
  cleanPoster: Buffer;
  /** Processed keyframes, on an equally spaced square-cell PNG atlas. */
  sheet: Buffer;
  /** Actual encoded counts; encoders can combine identical adjacent frames. */
  frameCount: number;
  gifFrameCount: number;
  durationMs: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  /** Source-cell indices and delays in the logical timeline, before encoding. */
  sequence: number[];
  delaysMs: number[];
  registration: FrameRegistration[];
  warnings: string[];
}

const SIZE = 360;
const FRAME_BYTES = SIZE * SIZE * 4;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const FEATHER_PIXELS = 2;
// The same padding for every cell reserves room for typical registration shifts.
const PADDING = 8;

export const SAMPLE_WAVE_ACTION_PROMPT =
  '앉아 있는 늘보군이 화면 왼쪽 팔만 부드럽게 흔들어 인사합니다. 머리, 얼굴, 몸통, 가방, 다리는 첫 프레임 그대로 유지합니다.';

export const SAMPLE_WAVE_OPTIONS: FrameAnimationOptions = {
  columns: 4,
  rows: 2,
  durationMs: 2000,
  maxTranslation: 12,
  sequence: [0, 1, 0, 4, 7, 4, 0],
  delaysMs: [400, 130, 280, 160, 290, 160, 580],
  region: {
    points: [
      { x: 0.015, y: 0.23 },
      { x: 0.325, y: 0.23 },
      { x: 0.282, y: 0.34 },
      { x: 0.292, y: 0.415 },
      { x: 0.325, y: 0.475 },
      { x: 0.365, y: 0.515 },
      { x: 0.39, y: 0.565 },
      { x: 0.345, y: 0.6 },
      { x: 0.29, y: 0.69 },
      { x: 0.015, y: 0.72 },
    ].map(({ x, y }) => ({
      x: (PADDING + x * (SIZE - PADDING * 2)) / SIZE,
      y: (PADDING + y * (SIZE - PADDING * 2)) / SIZE,
    })),
  },
};

function validUnit(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateRegions(region: FrameAnimationOptions['region']): AnimationRegion[] | null {
  if (region == null) return null;
  const regions = Array.isArray(region) ? region : [region];
  if (regions.length < 1 || regions.length > 8) {
    throw new Error('움직이는 영역은 1개에서 8개까지 지정할 수 있습니다.');
  }
  for (const shape of regions) {
    if (!shape || typeof shape !== 'object')
      throw new Error('움직이는 영역 형식이 잘못되었습니다.');
    if ('points' in shape) {
      if (
        !Array.isArray(shape.points) ||
        shape.points.length < 3 ||
        shape.points.length > 64 ||
        shape.points.some((point) => !point || !validUnit(point.x) || !validUnit(point.y))
      ) {
        throw new Error('다각형 영역은 0–1 범위의 좌표 3개 이상으로 지정해 주세요.');
      }
      let twiceArea = 0;
      for (let i = 0; i < shape.points.length; i++) {
        const a = shape.points[i]!;
        const b = shape.points[(i + 1) % shape.points.length]!;
        twiceArea += a.x * b.y - b.x * a.y;
      }
      if (Math.abs(twiceArea) < 0.00001) throw new Error('다각형 영역의 면적이 너무 작습니다.');
    } else if (
      !validUnit(shape.x) ||
      !validUnit(shape.y) ||
      !validUnit(shape.width) ||
      !validUnit(shape.height) ||
      shape.width <= 0 ||
      shape.height <= 0 ||
      shape.x + shape.width > 1.0000001 ||
      shape.y + shape.height > 1.0000001
    ) {
      throw new Error('사각형 영역은 캔버스 안의 0–1 범위로 지정해 주세요.');
    }
  }
  return regions;
}

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared))
    : 0;
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

/** Distance to the inner edge. Outside pixels always remain exactly unchanged. */
function interiorDistance(shape: AnimationRegion, x: number, y: number): number {
  if (!('points' in shape)) {
    return Math.max(
      0,
      Math.min(x - shape.x, shape.x + shape.width - x, y - shape.y, shape.y + shape.height - y),
    );
  }
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const a = shape.points[i]!;
    const b = shape.points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
    distance = Math.min(distance, segmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return inside ? distance : 0;
}

function regionMask(regions: AnimationRegion[] | null) {
  const mask = new Float32Array(SIZE * SIZE);
  if (!regions) return mask.fill(1);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.max(
        ...regions.map((shape) => interiorDistance(shape, (x + 0.5) / SIZE, (y + 0.5) / SIZE)),
      );
      const t = Math.min(1, (distance * SIZE) / FEATHER_PIXELS);
      mask[y * SIZE + x] = t * t * (3 - 2 * t);
    }
  }
  return mask;
}

function bodySamples(baseline: Buffer, mask: Float32Array, maxTranslation: number) {
  const samples: number[] = [];
  for (let y = maxTranslation; y < SIZE - maxTranslation; y += 4) {
    for (let x = maxTranslation; x < SIZE - maxTranslation; x += 4) {
      const index = y * SIZE + x;
      if (mask[index] === 0 && baseline[index * 4 + 3]! > 32) samples.push(index);
    }
  }
  return samples;
}

function alignFrame(
  baseline: Buffer,
  candidate: Buffer,
  samples: number[],
  maxTranslation: number,
): FrameRegistration {
  const errorAt = (dx: number, dy: number) => {
    let error = 0;
    for (const index of samples) {
      const offset = index * 4;
      const sourceOffset = (index - dy * SIZE - dx) * 4;
      const baseAlpha = baseline[offset + 3]! / 255;
      const sourceAlpha = candidate[sourceOffset + 3]! / 255;
      error += Math.abs(baseAlpha - sourceAlpha);
      for (let channel = 0; channel < 3; channel++) {
        error += Math.abs(
          (baseline[offset + channel]! * baseAlpha -
            candidate[sourceOffset + channel]! * sourceAlpha) /
            255,
        );
      }
    }
    return error / (samples.length * 4);
  };
  let best: FrameRegistration = { dx: 0, dy: 0, error: errorAt(0, 0) };
  for (let dy = -maxTranslation; dy <= maxTranslation; dy++) {
    for (let dx = -maxTranslation; dx <= maxTranslation; dx++) {
      const error = errorAt(dx, dy);
      if (
        error < best.error - 1e-8 ||
        (Math.abs(error - best.error) < 1e-8 &&
          Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      ) {
        best = { dx, dy, error };
      }
    }
  }
  return best;
}

function replaceRegion(
  baseline: Buffer,
  candidate: Buffer,
  mask: Float32Array,
  alignment: FrameRegistration,
) {
  const output = Buffer.from(baseline);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const offset = (y * SIZE + x) * 4;
      const weight = mask[y * SIZE + x]!;
      if (weight === 0) continue;
      const sx = x - alignment.dx;
      const sy = y - alignment.dy;
      const sourceOffset = (sy * SIZE + sx) * 4;
      const sourceInBounds = sx >= 0 && sx < SIZE && sy >= 0 && sy < SIZE;
      const sourceAlpha = sourceInBounds ? candidate[sourceOffset + 3]! : 0;
      const baselineAlpha = baseline[offset + 3]!;
      const alpha = sourceAlpha * weight + baselineAlpha * (1 - weight);
      output[offset + 3] = Math.round(alpha);
      for (let channel = 0; channel < 3; channel++) {
        const sourceValue = sourceInBounds ? candidate[sourceOffset + channel]! : 0;
        output[offset + channel] =
          alpha > 0.5
            ? Math.round(
                (sourceValue * sourceAlpha * weight +
                  baseline[offset + channel]! * baselineAlpha * (1 - weight)) /
                  alpha,
              )
            : 0;
      }
    }
  }
  return output;
}

/**
 * Encode newly drawn poses from a regular sprite sheet. Each cell uses the same
 * contain transform; no per-pose crop, limb rotation, or fabricated in-between
 * poses are applied. The first cell is the fixed-body baseline. Selected regions
 * REPLACE its pixels, including alpha, so a departing arm does not leave a ghost.
 * A two-pixel feather lies wholly inside the region. Lossless WebP preserves the
 * fixed body across frames; GIF necessarily has palette/binary-alpha limits.
 */
export async function renderFrameAnimation(
  input: Buffer | string,
  options: FrameAnimationOptions = {},
): Promise<RenderedFrameAnimation> {
  const {
    columns = 4,
    rows = 2,
    durationMs = 2000,
    registerFrames = true,
    maxTranslation = 6,
    padding = PADDING,
  } = options;
  if (!Number.isInteger(maxTranslation) || maxTranslation < 0 || maxTranslation > 16) {
    throw new Error('프레임 정합 범위는 0에서 16px 사이의 정수여야 합니다.');
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 32)
    throw new Error('프레임 여백은 0–32px 정수여야 합니다.');
  const count = columns * rows;
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    count < 2 ||
    count > 24
  ) {
    throw new Error('프레임 시트는 2개에서 24개 사이의 정수 격자로 지정해 주세요.');
  }
  const sequence = options.sequence ?? Array.from({ length: count }, (_, index) => index);
  if (
    !Array.isArray(sequence) ||
    sequence.length < 2 ||
    sequence.length > 24 ||
    sequence.some((index) => !Number.isInteger(index) || index < 0 || index >= count)
  )
    throw new Error('재생 순서는 시트 안의 프레임 번호 2개에서 24개로 지정해 주세요.');
  if (!Number.isFinite(durationMs) || durationMs < sequence.length * 20 || durationMs > 10_000) {
    throw new Error('재생 시간은 프레임당 20ms 이상, 전체 10초 이하로 지정해 주세요.');
  }
  if (
    options.delaysMs &&
    (options.delaysMs.length !== sequence.length ||
      options.delaysMs.some(
        (delay) => !Number.isInteger(delay) || delay < 20 || delay % 10 !== 0,
      ) ||
      options.delaysMs.reduce((sum, delay) => sum + delay, 0) > 10_000)
  )
    throw new Error('프레임별 재생 시간은 20ms 이상의 10ms 단위이며 전체 10초 이하여야 합니다.');
  const regions = validateRegions(options.region);
  if (Buffer.isBuffer(input) && input.length > 32 * 1024 * 1024) {
    throw new Error('프레임 시트는 32MB 이하여야 합니다.');
  }
  const source = sharp(input, { limitInputPixels: 25_000_000, failOn: 'warning' });
  const metadata = await source.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
    throw new Error('프레임 시트에는 PNG, JPG, WebP 정지 이미지 한 장을 사용해 주세요.');
  }
  const decoded = await source
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  if (width < columns * 16 || height < rows * 16)
    throw new Error('프레임 시트의 각 칸은 16px 이상이어야 합니다.');
  if (Math.abs(width / columns / (height / rows) - 1) > 0.02) {
    throw new Error(
      '프레임 시트의 각 칸은 정사각형이어야 합니다. 지정한 행·열 수와 이미지 비율을 확인해 주세요.',
    );
  }
  const mask = regionMask(regions);
  if (!mask.some((weight) => weight > 0))
    throw new Error('움직이는 영역에 포함되는 픽셀이 없습니다.');
  const frames: Buffer[] = [];
  const registration: FrameRegistration[] = [];
  const warnings: string[] = [];
  let samples: number[] = [];
  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = Math.floor((column * width) / columns);
    const top = Math.floor((row * height) / rows);
    const cellWidth = Math.floor(((column + 1) * width) / columns) - left;
    const cellHeight = Math.floor(((row + 1) * height) / rows) - top;
    let clippedEdgePixels = 0;
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        if (x !== 0 && y !== 0 && x !== cellWidth - 1 && y !== cellHeight - 1) continue;
        // Ignore faint halo pixels from AI sheet export; a substantial contour
        // touching a cell boundary still requires explicit review.
        if (decoded.data[((top + y) * width + left + x) * 4 + 3]! > 64) clippedEdgePixels++;
      }
    }
    if (clippedEdgePixels > 2 && sequence.includes(index)) {
      warnings.push(
        `${index + 1}번째 원본 프레임의 그림이 칸 경계에 닿습니다. 손끝 등이 잘리지 않았는지 확인해 주세요.`,
      );
    }
    const cell = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
      .extract({
        left,
        top,
        width: cellWidth,
        height: cellHeight,
      })
      .resize(SIZE - padding * 2, SIZE - padding * 2, { fit: 'contain', background: TRANSPARENT })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: TRANSPARENT,
      })
      .raw()
      .toBuffer();
    let visible = false;
    for (let offset = 0; offset < cell.length; offset += 4) {
      if (cell[offset + 3]) visible = true;
      else cell.fill(0, offset, offset + 3);
    }
    if (!visible) throw new Error(`${index + 1}번째 프레임에 보이는 캐릭터가 없습니다.`);
    let alignment = { dx: 0, dy: 0, error: 0 };
    if (index === 0) {
      frames.push(cell);
      samples = bodySamples(cell, mask, maxTranslation);
      if (regions && samples.length < 24)
        warnings.push('고정된 몸통 영역이 작아 프레임 정합을 확인할 수 없습니다.');
    } else {
      if (registerFrames && samples.length >= 24) {
        alignment = alignFrame(frames[0]!, cell, samples, maxTranslation);
        if (
          sequence.includes(index) &&
          (alignment.error > 0.09 ||
            (maxTranslation > 0 &&
              (Math.abs(alignment.dx) === maxTranslation ||
                Math.abs(alignment.dy) === maxTranslation)))
        ) {
          warnings.push(
            `${index + 1}번째 프레임의 몸통 정합을 확인해 주세요. 팔·몸통 연결부가 다를 수 있습니다.`,
          );
        }
      }
      frames.push(replaceRegion(frames[0]!, cell, mask, alignment));
    }
    registration.push(alignment);
  }
  if (sequence.slice(1).every((index) => frames[index]!.equals(frames[sequence[0]!]!))) {
    throw new Error(
      '프레임 사이에 보이는 움직임이 없습니다. 움직이는 영역 또는 프레임 시트를 확인해 주세요.',
    );
  }
  const atlasWidth = SIZE * columns;
  const atlasHeight = SIZE * rows;
  const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
  for (let index = 0; index < count; index++) {
    for (let y = 0; y < SIZE; y++) {
      frames[index]!.copy(
        atlas,
        ((Math.floor(index / columns) * SIZE + y) * atlasWidth + (index % columns) * SIZE) * 4,
        y * SIZE * 4,
        (y + 1) * SIZE * 4,
      );
    }
  }
  const cleanSheet = await sharp(atlas, {
    raw: { width: atlasWidth, height: atlasHeight, channels: 4 },
  })
    .png()
    .toBuffer();
  const cleanPoster = await sharp(frames[sequence[0]!]!, {
    raw: { width: SIZE, height: SIZE, channels: 4 },
  })
    .png()
    .toBuffer();
  let outputSheet: Buffer = cleanSheet;
  if (options.caption) {
    outputSheet = await applyCaption(cleanSheet, options.caption, { columns, rows });
    const captioned = await sharp(outputSheet).ensureAlpha().raw().toBuffer();
    for (let index = 0; index < count; index++) {
      frames[index] = await sharp(captioned, {
        raw: { width: atlasWidth, height: atlasHeight, channels: 4 },
      })
        .extract({
          left: (index % columns) * SIZE,
          top: Math.floor(index / columns) * SIZE,
          width: SIZE,
          height: SIZE,
        })
        .raw()
        .toBuffer();
    }
  }
  const ticks = Math.round(durationMs / 10);
  const delaysMs = options.delaysMs
    ? [...options.delaysMs]
    : Array.from(
        { length: sequence.length },
        (_, index) =>
          (Math.round(((index + 1) * ticks) / sequence.length) -
            Math.round((index * ticks) / sequence.length)) *
          10,
      );
  const stack = Buffer.concat(
    sequence.map((index) => frames[index]!),
    FRAME_BYTES * sequence.length,
  );
  const animated = () =>
    sharp(stack, {
      raw: { width: SIZE, height: SIZE * sequence.length, channels: 4, pageHeight: SIZE },
    });
  const webp = await animated()
    .webp({ lossless: true, effort: 3, loop: 0, delay: delaysMs, minSize: false, mixed: false })
    .toBuffer();
  const gif = await animated()
    .gif({
      colours: 256,
      effort: 5,
      dither: 0,
      loop: 0,
      delay: delaysMs,
      keepDuplicateFrames: true,
    })
    .toBuffer();
  const [poster, sheet, webpMetadata, gifMetadata] = await Promise.all([
    sharp(frames[sequence[0]!]!, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png()
      .toBuffer(),
    Promise.resolve(outputSheet),
    sharp(webp, { animated: true }).metadata(),
    sharp(gif, { animated: true }).metadata(),
  ]);
  return {
    webp,
    gif,
    poster,
    sheet,
    cleanSheet,
    cleanPoster,
    frameCount: webpMetadata.pages ?? 1,
    gifFrameCount: gifMetadata.pages ?? 1,
    durationMs: webpMetadata.delay?.reduce((sum, delay) => sum + delay, 0) ?? 0,
    columns,
    rows,
    frameWidth: SIZE,
    frameHeight: SIZE,
    sequence: [...sequence],
    delaysMs,
    registration,
    warnings,
  };
}
