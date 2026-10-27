import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import optimizer from "next/dist/server/image-optimizer.js";

test("Next uses the patched native Sharp and optimizes images without retaining metadata", async () => {
  assert.equal(optimizer.getSharp().versions.sharp, "0.35.5");
  const input = await sharp({ create: { width: 160, height: 80, channels: 3, background: "#22c55e" } })
    .withExif({ IFD0: { Copyright: "private-metadata" } }).jpeg().toBuffer();
  const output = await optimizer.optimizeImage({ buffer: input, contentType: "image/webp", width: 80, quality: 80 });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 80);
  assert.equal(metadata.height, 40);
  assert.equal(metadata.exif, undefined);
});
