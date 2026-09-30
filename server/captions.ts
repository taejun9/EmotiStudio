import sharp, { type OutputInfo, type OverlayOptions } from 'sharp';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const MAX_CAPTION_LENGTH = 24;
export const CAPTION_INK = '#342922';
export const CAPTION_PAPER = '#fffdf7';
const FONT_FILE = fileURLToPath(new URL('../public/fonts/NotoSansKR.ttf', import.meta.url));
// Use the bundled font without scanning machine-specific fonts or unwritable caches.
if (!process.env.FONTCONFIG_FILE) {
  const cache = join(tmpdir(), `emotistudio-fontconfig-${process.getuid?.() ?? 'local'}`);
  mkdirSync(cache, { recursive: true });
  const config = join(cache, 'fonts.conf');
  const xml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fontConfig = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${xml(fileURLToPath(new URL('../public/fonts', import.meta.url)))}</dir><cachedir>${xml(cache)}</cachedir></fontconfig>`;
  if (!existsSync(config) || readFileSync(config, 'utf8') !== fontConfig)
    writeFileSync(config, fontConfig);
  process.env.FONTCONFIG_FILE = config;
}
const SIZE = 360;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const badgeCache = new Map<string, Promise<Buffer>>();

export function normalizeCaption(value: string): string {
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(
    new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(normalized),
  ).length;
  if (!length || length > MAX_CAPTION_LENGTH)
    throw new Error(`대사는 1자에서 ${MAX_CAPTION_LENGTH}자까지 입력해 주세요.`);
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(
      normalized,
    )
  )
    throw new Error('보이지 않는 제어 문자는 대사에 사용할 수 없습니다.');
  return normalized;
}

function escapeMarkup(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function makeBadge(caption: string): Promise<Buffer> {
  let lettering: { data: Buffer; info: OutputInfo } | undefined;
  for (const fontSize of [30, 27, 24, 22, 20]) {
    lettering = await sharp({
      text: {
        text: `<span foreground="${CAPTION_INK}">${escapeMarkup(caption)}</span>`,
        font: `Noto Sans KR Bold ${fontSize}`,
        fontfile: FONT_FILE,
        width: 308,
        align: 'centre',
        wrap: 'word-char',
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (lettering.info.height <= 48) break;
  }
  if (!lettering || lettering.info.height > 52)
    throw new Error('대사가 너무 길어 읽기 어렵습니다. 조금 짧게 입력해 주세요.');
  const paper = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="336" height="64"><rect x="5" y="5" width="326" height="54" rx="18" fill="${CAPTION_PAPER}" stroke="#ffffff" stroke-width="9"/><rect x="5" y="5" width="326" height="54" rx="18" fill="${CAPTION_PAPER}" stroke="${CAPTION_INK}" stroke-width="2.5"/></svg>`,
  );
  return sharp(paper)
    .composite([
      {
        input: lettering.data,
        left: Math.round((336 - lettering.info.width) / 2),
        top: Math.round((64 - lettering.info.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/** Lettering is baked into every exported frame. Art and text have separate bands. */
export async function applyCaption(
  input: Buffer,
  value: string,
  { columns = 1, rows = 1 }: { columns?: number; rows?: number } = {},
): Promise<Buffer> {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns * rows > 24
  )
    throw new Error('대사 합성에 사용할 프레임 격자가 올바르지 않습니다.');
  const caption = normalizeCaption(value);
  if (!badgeCache.has(caption)) {
    if (badgeCache.size >= 128) badgeCache.clear();
    const pending = makeBadge(caption);
    badgeCache.set(caption, pending);
    pending.catch(() => badgeCache.delete(caption));
  }
  const badge = await badgeCache.get(caption)!;
  const source = await sharp(input, { limitInputPixels: 25_000_000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  if (width < columns || height < rows || Math.abs(width / columns / (height / rows) - 1) > 0.02)
    throw new Error('대사는 정사각형 이모티콘 또는 정사각 칸의 프레임 시트에 넣을 수 있습니다.');
  const cells: OverlayOptions[] = [];
  for (let index = 0; index < columns * rows; index++) {
    const col = index % columns,
      row = Math.floor(index / columns);
    const left = Math.floor((col * width) / columns),
      top = Math.floor((row * height) / rows);
    const art = await sharp(source.data, { raw: { width, height, channels: 4 } })
      .extract({
        left,
        top,
        width: Math.floor(((col + 1) * width) / columns) - left,
        height: Math.floor(((row + 1) * height) / rows) - top,
      })
      .resize(288, 288, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toBuffer();
    cells.push({ input: art, left: col * SIZE + 36, top: row * SIZE + 2 });
    cells.push({ input: badge, left: col * SIZE + 12, top: row * SIZE + 292 });
  }
  return sharp({
    create: { width: SIZE * columns, height: SIZE * rows, channels: 4, background: TRANSPARENT },
  })
    .composite(cells)
    .png()
    .toBuffer();
}
