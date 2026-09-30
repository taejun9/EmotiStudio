import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';

function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'ZIP end directory must be present');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10),
      bytes = zip.readUInt32LE(offset + 20),
      nameLen = zip.readUInt16LE(offset + 28),
      extraLen = zip.readUInt16LE(offset + 30),
      commentLen = zip.readUInt16LE(offset + 32),
      local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + bytes);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test('downloaded ZIP contains six correctly sized alpha PNGs and accurate sample provenance', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-export-'));
  const app = createApp({ dataDir: dir, testMode: true, openaiApiKey: '' });
  try {
    const c = request.agent(app.app);
    const boot = (await c.get('/api/bootstrap')).body;
    const id = boot.projects[0].id;
    await c.post(`/api/projects/${id}/approve-all`).send({}).expect(200);
    await c.post(`/api/projects/${id}/complete`).send({}).expect(200);
    for (const size of [360, 720, 1024]) {
      const response = await c
        .get(`/api/projects/${id}/export?size=${size}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
          response.on('error', callback);
        })
        .expect(200);
      const files = readZip(response.body);
      assert.equal(files.size, 7);
      const manifest = JSON.parse(files.get('manifest.json')!.toString());
      assert.equal(manifest.containsPresetSamples, true);
      assert.equal(manifest.stickers.length, 6);
      for (const sticker of manifest.stickers) {
        assert.equal(sticker.approved, true);
        assert.equal(sticker.provider, 'sample');
        const image = files.get(sticker.filename);
        assert.ok(image);
        const metadata = await sharp(image).metadata();
        assert.equal(metadata.width, size);
        assert.equal(metadata.height, size);
        assert.equal(metadata.hasAlpha, true);
        const stats = await sharp(image).stats();
        assert.equal(stats.isOpaque, false);
      }
    }
    await c.get(`/api/projects/${id}/export?size=999`).expect(400);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
