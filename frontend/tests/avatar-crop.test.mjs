// Node.js 22+: node --experimental-strip-types --test tests/avatar-crop.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainAvatarCrop,
  getAvatarCropRect,
} from "../src/lib/utils/avatarCrop.ts";

test("landscape images start with a centered square crop", () => {
  assert.deepEqual(
    getAvatarCropRect(
      { width: 1600, height: 900 },
      { zoom: 1, centerX: 800, centerY: 450 },
    ),
    { x: 350, y: 0, size: 900 },
  );
});

test("portrait images start with a centered square crop", () => {
  assert.deepEqual(
    getAvatarCropRect(
      { width: 900, height: 1600 },
      { zoom: 1, centerX: 450, centerY: 800 },
    ),
    { x: 0, y: 350, size: 900 },
  );
});

test("zoom preserves the chosen focal point and reduces the source rectangle", () => {
  assert.deepEqual(
    getAvatarCropRect(
      { width: 1600, height: 900 },
      { zoom: 2, centerX: 1000, centerY: 400 },
    ),
    { x: 775, y: 175, size: 450 },
  );
});

test("dragging past image boundaries cannot reveal empty pixels", () => {
  assert.deepEqual(
    getAvatarCropRect(
      { width: 1600, height: 900 },
      { zoom: 2, centerX: -2000, centerY: 5000 },
    ),
    { x: 0, y: 450, size: 450 },
  );
});

test("zooming back out clamps a focal point near the edge", () => {
  assert.deepEqual(
    constrainAvatarCrop(
      { width: 1000, height: 1000 },
      { zoom: 1, centerX: 900, centerY: 100 },
    ),
    { zoom: 1, centerX: 500, centerY: 500 },
  );
});

test("zoom limits prevent exposing the background or excessive magnification", () => {
  const image = { width: 600, height: 400 };
  assert.equal(
    getAvatarCropRect(image, { zoom: 0.1, centerX: 300, centerY: 200 }).size,
    400,
  );
  assert.equal(
    getAvatarCropRect(image, { zoom: 10, centerX: 300, centerY: 200 }).size,
    100,
  );
});

test("crop rectangles stay inside wide, tall, square and tiny images", () => {
  for (const image of [
    { width: 3200, height: 200 },
    { width: 200, height: 3200 },
    { width: 801, height: 801 },
    { width: 1, height: 1 },
  ]) {
    for (const zoom of [1, 1.37, 2, 3.91, 4]) {
      for (const [centerX, centerY] of [
        [0, 0],
        [image.width / 2, image.height / 2],
        [image.width, image.height],
      ]) {
        const rect = getAvatarCropRect(image, { zoom, centerX, centerY });
        assert.ok(rect.x >= 0 && rect.y >= 0);
        assert.ok(rect.size > 0);
        assert.ok(rect.x + rect.size <= image.width + 1e-9);
        assert.ok(rect.y + rect.size <= image.height + 1e-9);
      }
    }
  }
});

test("invalid image dimensions are rejected", () => {
  for (const width of [0, -1, NaN, Infinity]) {
    assert.throws(() =>
      getAvatarCropRect(
        { width, height: 100 },
        { zoom: 1, centerX: 0, centerY: 0 },
      ),
    );
  }
});
