#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'openxtf-png-'));
const bundlePath = path.join(temporaryDirectory, 'xtf-device.mjs');
const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PASS_X_STEP = [1, 8, 8, 4, 4, 2, 2, 1];
const PASS_Y_STEP = [1, 8, 8, 8, 4, 4, 2, 2];
const PASS_X_START = [0, 0, 4, 0, 2, 0, 1, 0];
const PASS_Y_START = [0, 0, 0, 4, 0, 2, 0, 1];
let crcTable;

try {
  await build({
    entryPoints: [path.resolve('app/xtf-device.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const {
    decodeFirmwarePngLevels,
    decodeV6315Png,
    firmwareRasterImageType,
  } = await import(pathToFileURL(bundlePath).href);

  assert.equal(firmwareRasterImageType('OPS/IMAGE.PNG'), 'png');
  assert.equal(firmwareRasterImageType('OPS/image.png.backup'), 'unknown');
  assert.equal(firmwareRasterImageType('OPS/jpeg-bytes.png'), 'png');
  assert.equal(firmwareRasterImageType('OPS/image-without-extension'), 'unknown');

  const scale = (value, maximum) =>
    Math.trunc((value * 255 + (maximum >> 1)) / maximum);
  const formatCases = [
    { colorType: 0, depth: 1, pixel: [1], expected: [255, 255, 255, 255] },
    { colorType: 0, depth: 2, pixel: [2], expected: [170, 170, 170, 255] },
    { colorType: 0, depth: 4, pixel: [7], expected: [119, 119, 119, 255] },
    { colorType: 0, depth: 8, pixel: [119], expected: [119, 119, 119, 255] },
    {
      colorType: 0,
      depth: 16,
      pixel: [0x8080],
      expected: [scale(0x8080, 0xffff), scale(0x8080, 0xffff), scale(0x8080, 0xffff), 255],
    },
    { colorType: 2, depth: 8, pixel: [12, 34, 56], expected: [12, 34, 56, 255] },
    {
      colorType: 2,
      depth: 16,
      pixel: [0x1234, 0x8000, 0xffff],
      expected: [scale(0x1234, 0xffff), scale(0x8000, 0xffff), 255, 255],
    },
    {
      colorType: 4,
      depth: 8,
      pixel: [80, 128],
      expected: [80, 80, 80, 128],
    },
    {
      colorType: 4,
      depth: 16,
      pixel: [0x4000, 0x8000],
      expected: [scale(0x4000, 0xffff), scale(0x4000, 0xffff), scale(0x4000, 0xffff), scale(0x8000, 0xffff)],
    },
    {
      colorType: 6,
      depth: 8,
      pixel: [12, 34, 56, 78],
      expected: [12, 34, 56, 78],
    },
    {
      colorType: 6,
      depth: 16,
      pixel: [0x1234, 0x8000, 0xffff, 0x4000],
      expected: [scale(0x1234, 0xffff), scale(0x8000, 0xffff), 255, scale(0x4000, 0xffff)],
    },
  ];
  for (const entry of formatCases) {
    const png = makePng({
      width: 1,
      height: 1,
      depth: entry.depth,
      colorType: entry.colorType,
      pixels: [entry.pixel],
    });
    const decoded = decodeV6315Png(png);
    assert.ok(decoded, `format ${entry.colorType}/${entry.depth} rejected`);
    assert.equal(decoded.depth, entry.depth);
    assert.equal(decoded.colorType, entry.colorType);
    assert.deepEqual(Array.from(decoded.rgba), entry.expected);
  }

  for (const depth of [1, 2, 4, 8]) {
    const png = makePng({
      width: 1,
      height: 1,
      depth,
      colorType: 3,
      pixels: [[1]],
      palette: [0, 0, 0, 11, 22, 33],
    });
    const decoded = decodeV6315Png(png);
    assert.ok(decoded, `indexed depth ${depth} rejected`);
    assert.deepEqual(Array.from(decoded.rgba), [11, 22, 33, 255]);
  }

  const filterPixels = [
    [10, 20, 30], [50, 60, 70], [90, 100, 110],
    [15, 25, 35], [55, 65, 75], [95, 105, 115],
  ];
  const expectedFilterRgba = filterPixels.flatMap((pixel) => [...pixel, 255]);
  for (let filter = 0; filter <= 4; filter += 1) {
    const decoded = decodeV6315Png(makePng({
      width: 3,
      height: 2,
      depth: 8,
      colorType: 2,
      pixels: filterPixels,
      filters: () => filter,
      splitIdat: true,
    }));
    assert.ok(decoded, `filter ${filter} rejected`);
    assert.deepEqual(Array.from(decoded.rgba), expectedFilterRgba);
  }

  const grayTransparency = decodeV6315Png(makePng({
    width: 2,
    height: 1,
    depth: 8,
    colorType: 0,
    pixels: [[10], [11]],
    transparency: [0, 10],
  }));
  assert.deepEqual(
    Array.from(grayTransparency.rgba),
    [10, 10, 10, 0, 11, 11, 11, 255],
  );
  const rgbTransparency = decodeV6315Png(makePng({
    width: 2,
    height: 1,
    depth: 8,
    colorType: 2,
    pixels: [[1, 2, 3], [1, 2, 4]],
    transparency: [0, 1, 0, 2, 0, 3],
  }));
  assert.deepEqual(
    Array.from(rgbTransparency.rgba),
    [1, 2, 3, 0, 1, 2, 4, 255],
  );
  const indexedTransparency = decodeV6315Png(makePng({
    width: 2,
    height: 1,
    depth: 1,
    colorType: 3,
    pixels: [[0], [1]],
    palette: [0, 0, 0, 255, 255, 255],
    transparency: [0],
  }));
  assert.deepEqual(
    Array.from(indexedTransparency.rgba),
    [0, 0, 0, 0, 255, 255, 255, 255],
  );

  // PngOutputCallbackV6315 selects alpha-aware handling only for color types
  // 4 and 6. tRNS alpha in grayscale, truecolor, and indexed inputs is left
  // unused by the active opaque callback, while native alpha blends to white.
  for (const png of [
    makePng({
      width: 1,
      height: 1,
      depth: 8,
      colorType: 0,
      pixels: [[0]],
      transparency: [0, 0],
    }),
    makePng({
      width: 1,
      height: 1,
      depth: 8,
      colorType: 2,
      pixels: [[0, 0, 0]],
      transparency: [0, 0, 0, 0, 0, 0],
    }),
    makePng({
      width: 1,
      height: 1,
      depth: 1,
      colorType: 3,
      pixels: [[0]],
      palette: [0, 0, 0],
      transparency: [0],
    }),
  ]) {
    const decoded = decodeV6315Png(png);
    assert.deepEqual(
      Array.from(decodeFirmwarePngLevels(decoded, 1, 1, 1, 1)),
      [3],
    );
  }
  const nativeAlpha = decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 8,
    colorType: 4,
    pixels: [[0, 0]],
  }));
  assert.deepEqual(
    Array.from(decodeFirmwarePngLevels(nativeAlpha, 1, 1, 1, 1)),
    [0],
  );

  const noGamma = decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 8,
    colorType: 0,
    pixels: [[64]],
  }));
  const withGamma = decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 8,
    colorType: 0,
    pixels: [[64]],
    gamma: 45455,
  }));
  assert.deepEqual(Array.from(withGamma.rgba), Array.from(noGamma.rgba));

  const interlaced = decodeV6315Png(makePng({
    width: 3,
    height: 3,
    depth: 8,
    colorType: 0,
    pixels: Array.from({ length: 9 }, () => [119]),
    interlace: 1,
  }));
  assert.ok(interlaced?.interlaced);
  assert.deepEqual(
    Array.from(interlaced.rgba),
    Array.from({ length: 9 }, () => [119, 119, 119, 255]).flat(),
  );
  assert.deepEqual(
    Array.from(decodeFirmwarePngLevels(interlaced, 3, 3, 3, 3)),
    [3, 3, 3, 3, 0, 3, 0, 0, 0],
  );

  const scaled = decodeV6315Png(makePng({
    width: 4,
    height: 2,
    depth: 8,
    colorType: 0,
    pixels: [
      [0], [255], [0], [255],
      [0], [255], [0], [255],
    ],
  }));
  assert.deepEqual(
    Array.from(decodeFirmwarePngLevels(scaled, 2, 1, 2, 1)),
    [3, 0],
  );

  const trailing = makePng({
    width: 1,
    height: 1,
    depth: 8,
    colorType: 0,
    pixels: [[255]],
  });
  assert.ok(decodeV6315Png(concatBytes(trailing, new Uint8Array([1, 2, 3]))));

  const badCrc = trailing.slice();
  badCrc[badCrc.length - 5] ^= 1;
  assert.equal(decodeV6315Png(badCrc), null);
  assert.equal(decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 8,
    colorType: 0,
    pixels: [[0]],
    filters: () => 5,
  })), null);
  assert.equal(decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 1,
    colorType: 3,
    pixels: [[0]],
    omitPalette: true,
  })), null);
  assert.equal(decodeV6315Png(makePng({
    width: 1,
    height: 1,
    depth: 1,
    colorType: 3,
    pixels: [[1]],
    palette: [0, 0, 0],
  })), null);

  process.stdout.write('V6.3.15 native PNG decoder fixtures passed.\n');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function makePng({
  width,
  height,
  depth,
  colorType,
  pixels,
  palette,
  transparency,
  gamma,
  interlace = 0,
  filters = () => 0,
  splitIdat = false,
  omitPalette = false,
}) {
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]])
    .get(colorType);
  assert.ok(channels);
  assert.equal(pixels.length, width * height);
  const raw = [];
  const firstPass = interlace ? 1 : 0;
  const lastPass = interlace ? 7 : 0;
  for (let pass = firstPass; pass <= lastPass; pass += 1) {
    const passPixels = width <= PASS_X_START[pass]
      ? 0
      : Math.ceil((width - PASS_X_START[pass]) / PASS_X_STEP[pass]);
    const passRows = height <= PASS_Y_START[pass]
      ? 0
      : Math.ceil((height - PASS_Y_START[pass]) / PASS_Y_STEP[pass]);
    if (!passPixels || !passRows) continue;
    const bytesPerPixel = Math.ceil((channels * depth) / 8);
    let previous = new Uint8Array(Math.ceil((passPixels * channels * depth) / 8));
    for (let passY = 0; passY < passRows; passY += 1) {
      const samples = [];
      const y = PASS_Y_START[pass] + passY * PASS_Y_STEP[pass];
      for (let passX = 0; passX < passPixels; passX += 1) {
        const x = PASS_X_START[pass] + passX * PASS_X_STEP[pass];
        samples.push(...pixels[y * width + x]);
      }
      const reconstructed = packSamples(samples, depth);
      const filter = filters(pass, passY);
      raw.push(filter);
      for (let index = 0; index < reconstructed.length; index += 1) {
        const left = index >= bytesPerPixel
          ? reconstructed[index - bytesPerPixel]
          : 0;
        const above = previous[index];
        const upperLeft = index >= bytesPerPixel
          ? previous[index - bytesPerPixel]
          : 0;
        let predictor = 0;
        if (filter === 1) predictor = left;
        else if (filter === 2) predictor = above;
        else if (filter === 3) predictor = (left + above) >> 1;
        else if (filter === 4) predictor = paeth(left, above, upperLeft);
        raw.push((reconstructed[index] - predictor) & 0xff);
      }
      previous = reconstructed;
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const chunks = [makeChunk('IHDR', ihdr)];
  if (gamma !== undefined) {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, gamma);
    chunks.push(makeChunk('gAMA', data));
  }
  if (colorType === 3 && !omitPalette) {
    chunks.push(makeChunk('PLTE', new Uint8Array(palette ?? [0, 0, 0])));
  } else if (palette) {
    chunks.push(makeChunk('PLTE', new Uint8Array(palette)));
  }
  if (transparency) {
    chunks.push(makeChunk('tRNS', new Uint8Array(transparency)));
  }
  const compressed = new Uint8Array(deflateSync(new Uint8Array(raw)));
  if (splitIdat && compressed.length > 1) {
    const middle = Math.trunc(compressed.length / 2);
    chunks.push(makeChunk('IDAT', compressed.subarray(0, middle)));
    chunks.push(makeChunk('IDAT', compressed.subarray(middle)));
  } else {
    chunks.push(makeChunk('IDAT', compressed));
  }
  chunks.push(makeChunk('IEND', new Uint8Array()));
  return concatBytes(PNG_SIGNATURE, ...chunks);
}

function packSamples(samples, depth) {
  if (depth === 16) {
    const bytes = new Uint8Array(samples.length * 2);
    for (let index = 0; index < samples.length; index += 1) {
      bytes[index * 2] = samples[index] >> 8;
      bytes[index * 2 + 1] = samples[index] & 0xff;
    }
    return bytes;
  }
  if (depth === 8) return new Uint8Array(samples);
  const bytes = new Uint8Array(Math.ceil((samples.length * depth) / 8));
  let bitOffset = 0;
  for (const sample of samples) {
    const shift = 8 - depth - (bitOffset & 7);
    bytes[bitOffset >> 3] |= sample << shift;
    bitOffset += depth;
  }
  return bytes;
}

function makeChunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    bytes[4 + index] = type.charCodeAt(index);
  }
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes, 4, data.length + 4));
  return bytes;
}

function crc32(bytes, offset, length) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = offset; index < offset + length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distances = [
    Math.abs(estimate - left),
    Math.abs(estimate - above),
    Math.abs(estimate - upperLeft),
  ];
  if (distances[0] <= distances[1] && distances[0] <= distances[2]) return left;
  return distances[1] <= distances[2] ? above : upperLeft;
}

function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
