import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'openxtf-renderer-'));
const bundlePath = path.join(temporaryDirectory, 'xtf-device.mjs');

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

  const { renderXtfDevicePreview } = await import(pathToFileURL(bundlePath).href);

  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          return {
            createImageData(width, height) {
              return { data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData() {},
          };
        },
        toDataURL() {
          return 'data:image/png;base64,';
        },
      };
    },
  };

  const xtf = makeFixtureXtf();
  const paragraphBlocks = Array.from({ length: 30 }, (_, index) => ({
    text: String.fromCharCode(0x41 + (index % 26)),
    tag: 'p',
    className: '',
    breakAfter: index === 29 ? 'text-end' : 'paragraph',
    startsParagraph: true,
  }));

  const manual = renderXtfDevicePreview(xtf, '', 29, {
    blocks: paragraphBlocks,
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(manual.device.lineCount, 12);
  assert.equal(manual.device.layout.maximumWholeLines, 16);
  assert.equal(manual.device.layout.pageFitMode, 'transition-step');
  assert.equal(manual.device.layout.recordsRemovedByPageFit, 4);
  assert.equal(manual.device.lines[1].top, 91);

  const automaticParagraphs = renderXtfDevicePreview(xtf, '', 29, {
    blocks: paragraphBlocks,
    layout: {
      lineSpacing: 'auto',
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(automaticParagraphs.device.lineCount, 11);
  assert.equal(automaticParagraphs.device.layout.maximumWholeLines, 17);
  assert.equal(automaticParagraphs.device.layout.pageFitMode, 'transition-step');
  assert.equal(automaticParagraphs.device.layout.recordsRemovedByPageFit, 6);
  assert.equal(automaticParagraphs.device.lines.at(-1).top, 778);
  assert.equal(automaticParagraphs.device.layout.lineAdvance, Math.fround(50.4));

  const automaticOneX = renderXtfDevicePreview(xtf, '', 29, {
    blocks: paragraphBlocks,
    layout: {
      lineSpacing: 'auto',
      paragraphRatio: 1,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(automaticOneX.device.lineCount, 16);
  assert.equal(automaticOneX.device.layout.pageFitMode, 'record-step');
  assert.equal(automaticOneX.device.layout.recordsRemovedByPageFit, 1);
  assert.equal(automaticOneX.device.lines.at(-1).top, 778);

  const narrowHangul = renderXtfDevicePreview(xtf, '가'.repeat(30), 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  const widerXtf = xtf.slice();
  widerXtf[0x0d] = 30;
  const wideHangul = renderXtfDevicePreview(widerXtf, '가'.repeat(30), 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(narrowHangul.device.lines[0].text, `${'　'.repeat(2)}${'가'.repeat(13)}`);
  assert.equal(wideHangul.device.lines[0].text, `${'　'.repeat(2)}${'가'.repeat(12)}`);
  assert.equal(narrowHangul.device.xtfHeader.fullWidth, 28);
  assert.equal(wideHangul.device.xtfHeader.fullWidth, 30);

  process.stdout.write('V6.3.15 renderer fixtures passed.\n');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function makeFixtureXtf() {
  const headerSize = 64;
  const rangeTableOffset = headerSize;
  const rangeCount = 2;
  const glyphDataOffset = rangeTableOffset + rangeCount * 16;
  const asciiCount = 0x7f - 0x20;
  const glyphCount = asciiCount + 1;
  const bytesPerGlyph = 3;
  const glyphDataSize = glyphCount * bytesPerGlyph;
  const asciiWidthOffset = glyphDataOffset + glyphDataSize;
  const bytes = new Uint8Array(asciiWidthOffset + asciiCount);
  const view = new DataView(bytes.buffer);

  bytes.set([0x58, 0x54, 0x46, 0x30], 0);
  bytes[0x07] = 1;
  bytes[0x08] = 0x02;
  bytes[0x0a] = 1;
  bytes[0x0b] = 1;
  bytes[0x0c] = 38;
  bytes[0x0d] = 28;
  bytes[0x0e] = 10;
  view.setInt16(0x10, 0, true);
  view.setInt16(0x12, 0, true);
  view.setUint16(0x14, rangeCount, true);
  view.setUint32(0x18, glyphCount, true);
  view.setUint32(0x1c, rangeTableOffset, true);
  view.setUint32(0x24, glyphDataOffset, true);
  view.setUint32(0x28, bytesPerGlyph, true);
  view.setUint32(0x2c, glyphDataSize, true);
  view.setUint32(0x38, asciiWidthOffset, true);
  bytes[0x3c] = asciiCount;

  writeRange(view, rangeTableOffset, 0x20, asciiCount, 0);
  writeRange(view, rangeTableOffset + 16, 0x3000, 1, asciiCount);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const record = glyphDataOffset + glyphId * bytesPerGlyph;
    bytes[record] = glyphId === asciiCount ? 28 : 10;
    bytes[record + 1] = 0;
    bytes[record + 2] = glyphId === 0 ? 0 : 0x80;
  }
  bytes.fill(10, asciiWidthOffset, asciiWidthOffset + asciiCount);
  bytes[asciiWidthOffset] = 9;
  return bytes;
}

function writeRange(view, offset, start, count, glyphIdStart) {
  view.setUint32(offset, start, true);
  view.setUint32(offset + 4, count, true);
  view.setUint32(offset + 8, glyphIdStart, true);
  view.setUint32(offset + 12, 0, true);
}
