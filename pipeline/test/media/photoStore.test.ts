import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImage, storagePathFor } from '../../src/media/photoStore.ts';

async function image(width: number, height: number, format: 'jpeg' | 'png' = 'jpeg', withExif = false): Promise<Uint8Array> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  if (withExif) img = img.withExif({ IFD0: { Copyright: 'Someone', Make: 'TestCam' } });
  return new Uint8Array(await (format === 'jpeg' ? img.jpeg() : img.png()).toBuffer());
}

const isWebp = (b: Uint8Array) => Buffer.from(b.slice(0, 4)).toString() === 'RIFF' && Buffer.from(b.slice(8, 12)).toString() === 'WEBP';

test('storagePathFor is stable, per URL, under pipeline/<restaurant_id>/', () => {
  const a = storagePathFor(7, 'https://a/x.jpg');
  assert.match(a, /^pipeline\/7\/[0-9a-f]{16}\.webp$/);
  assert.equal(storagePathFor(7, 'https://a/x.jpg'), a);
  assert.notEqual(storagePathFor(7, 'https://a/y.jpg'), a);
});

test('a large image is resized to 800 px on its longest side as WebP', async () => {
  const r = await processImage(await image(2000, 1000));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([r.width, r.height], [800, 400]);
  assert.ok(isWebp(r.webp));
  const meta = await sharp(r.webp).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 800, 400]);
});

test('a medium image is not upscaled', async () => {
  const r = await processImage(await image(600, 500, 'png'));
  assert.equal(r.ok && `${r.width}x${r.height}`, '600x500');
});

test('an image whose short side is under 400 px is rejected', async () => {
  assert.deepEqual(await processImage(await image(1000, 300)), { ok: false, reason: 'too_small' });
});

test('bytes that are not an image are rejected', async () => {
  assert.deepEqual(await processImage(new Uint8Array(Buffer.from('<html><body>Not found</body></html>'))), { ok: false, reason: 'not_image' });
  assert.deepEqual(await processImage(new Uint8Array(512).map((_, i) => (i * 37) % 256)), { ok: false, reason: 'not_image' });
});

test('metadata is stripped from the stored copy', async () => {
  const r = await processImage(await image(1200, 900, 'jpeg', true));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const meta = await sharp(r.webp).metadata();
  assert.equal(meta.exif, undefined);
});

test('an SVG is rejected as not a photo, even when large', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="red"/></svg>';
  assert.deepEqual(await processImage(new Uint8Array(Buffer.from(svg))), { ok: false, reason: 'not_image' });
});
