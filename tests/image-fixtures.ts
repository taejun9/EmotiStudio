import sharp from 'sharp';

/** Unique provider outputs for integration tests that are not testing duplicate rejection. */
export async function distinctPng(input: Buffer, index: number): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let offset = 0;
  while (offset < data.length && data[offset + 3] === 0) offset += 4;
  if (offset === data.length) throw new Error('Fixture must contain visible pixels');
  data[offset] = index % 256;
  data[offset + 1] = Math.floor(index / 256) % 256;
  return sharp(data, { raw: info }).png().toBuffer();
}
