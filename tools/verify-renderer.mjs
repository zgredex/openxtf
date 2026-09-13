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

  const {
    applyKoreanX4Profile,
    decodePlainXtgLevels,
    renderXtfDevicePreview,
  } = await import(
    pathToFileURL(bundlePath).href
  );

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
  const xtg = makeFixtureXtg();
  assert.deepEqual(
    Array.from(decodePlainXtgLevels(xtg, 9, 2)),
    [0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3],
  );
  assert.equal(decodePlainXtgLevels(xtg, 8, 2), null);
  const profiled = applyKoreanX4Profile(
    {
      bytes: xtf,
      fileName: 'fixture.xtf',
      previewDataUrl: '',
      summary: {
        version: '1.5',
        fontSize: 29,
        bpp: 1,
        cellW: 1,
        cellH: 1,
        glyphCount: 96,
        requestedCount: 96,
        missingCount: 0,
        systemFallbackCount: 0,
        rangeCount: 2,
        bytesPerGlyph: 3,
        fileSize: xtf.length,
      },
    },
    {
      cellW: 39,
      cellH: 38,
      cropLeft: 0,
      cropTop: 0,
      advanceY: 38,
      fullWidth: 28,
      asciiWidth: 18,
      spaceWidth: 9,
      ascender: 0,
      descender: 0,
      strictCrop: false,
    },
  );
  const profiledPreview = await renderXtfDevicePreview(profiled.bytes, 'A A', 29);
  assert.equal(profiledPreview.device.xtfHeader.cellW, 39);
  assert.equal(profiledPreview.device.xtfHeader.cellH, 38);
  assert.equal(profiledPreview.device.xtfHeader.storedAdvanceY, 38);
  assert.equal(profiledPreview.device.xtfHeader.fullWidth, 28);
  assert.equal(profiledPreview.device.xtfHeader.asciiWidth, 18);
  assert.equal(
    profiledPreview.device.spaces.find((entry) => entry.codePoint === 0x20)
      .paintAdvance,
    9,
  );
  const paragraphBlocks = Array.from({ length: 30 }, (_, index) => ({
    text: String.fromCharCode(0x41 + (index % 26)),
    tag: 'p',
    className: '',
    breakAfter: index === 29 ? 'text-end' : 'paragraph',
    startsParagraph: true,
  }));

  const manual = await renderXtfDevicePreview(xtf, '', 29, {
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

  const automaticParagraphs = await renderXtfDevicePreview(xtf, '', 29, {
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

  const automaticOneX = await renderXtfDevicePreview(xtf, '', 29, {
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

  const narrowHangul = await renderXtfDevicePreview(xtf, '가'.repeat(30), 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  const widerXtf = xtf.slice();
  widerXtf[0x0d] = 30;
  const wideHangul = await renderXtfDevicePreview(widerXtf, '가'.repeat(30), 29, {
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

  const spacedHangul = `${'가'.repeat(7)} ${'가'.repeat(20)}`;
  const aligned = await renderXtfDevicePreview(xtf, spacedHangul, 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'wrap-align',
    },
  });
  const right = await renderXtfDevicePreview(xtf, spacedHangul, 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'right',
    },
  });
  const left = await renderXtfDevicePreview(xtf, spacedHangul, 29, {
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(aligned.device.lines[0].placementBranch, 'space-distribution');
  assert.equal(aligned.device.lines[0].justificationPixels, 17);
  assert.equal(right.device.lines[0].placementBranch, 'space-distribution');
  assert.equal(right.device.lines[0].justificationPixels, 17);
  assert.equal(right.device.lines[0].alignment, 'wrap-align');
  assert.equal(right.device.lines[0].requestedAlignment, 'right');
  assert.equal(left.device.lines[0].placementBranch, 'direct');
  assert.equal(left.device.lines[0].justificationPixels, 0);

  const explicitEndings = await renderXtfDevicePreview(xtf, '', 29, {
    blocks: [
      {
        text: 'A\tB',
        tag: 'p',
        className: '',
        breakAfter: 'soft',
        startsParagraph: true,
      },
      {
        text: 'C',
        tag: 'p',
        className: '',
        breakAfter: 'paragraph',
        startsParagraph: false,
      },
      {
        text: 'D',
        tag: 'p',
        className: '',
        breakAfter: 'text-end',
        startsParagraph: true,
      },
    ],
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'wrap-align',
    },
  });
  assert.equal(explicitEndings.device.lines[0].text, '  A B');
  assert.deepEqual(explicitEndings.device.lines[0].recordSuffixBytes, [0x05, 0x0a]);
  assert.equal(explicitEndings.device.lines[0].placementBranch, 'direct');
  assert.deepEqual(explicitEndings.device.lines[1].recordSuffixBytes, [0x0a]);
  assert.equal(explicitEndings.device.lines[2].endOfSourceFlag, true);

  const imageBlocks = [
    {
      text: 'A',
      tag: 'p',
      className: '',
      breakAfter: 'paragraph',
      startsParagraph: true,
    },
    {
      text: '',
      tag: 'img',
      className: '',
      breakAfter: 'soft',
      startsParagraph: false,
      image: {
        archivePath: 'OPS/image.png',
        mediaType: 'image/png',
        bytes: new Uint8Array(),
        width: 100,
        height: 200,
      },
    },
    {
      text: 'B',
      tag: 'p',
      className: '',
      breakAfter: 'text-end',
      startsParagraph: false,
    },
  ];
  const manualImagePage = await renderXtfDevicePreview(xtf, '', 29, {
    blocks: imageBlocks,
    layout: {
      lineSpacing: 1.2,
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(manualImagePage.device.images.length, 1);
  assert.equal(manualImagePage.device.images[0].placeholder, true);
  assert.equal(manualImagePage.device.images[0].height, 200);
  assert.equal(manualImagePage.device.images[0].width, 446);
  assert.equal(manualImagePage.device.images[0].y, 104);
  assert.equal(manualImagePage.device.images[0].drawOffsetY, 13);
  assert.deepEqual(
    manualImagePage.device.lines.map((line) => line.top),
    [22, 336],
  );
  assert.equal(
    manualImagePage.device.layout.pageFitBudget,
    Math.fround(Math.fround(Math.fround(45.6) * Math.fround(1.5)) + 200 + Math.fround(45.6)),
  );

  const automaticImagePage = await renderXtfDevicePreview(xtf, '', 29, {
    blocks: imageBlocks,
    layout: {
      lineSpacing: 'auto',
      paragraphRatio: 1.5,
      indentChars: 2,
      alignMode: 'left',
    },
  });
  assert.equal(automaticImagePage.device.layout.autoDistributed, false);
  assert.equal(automaticImagePage.device.layout.lineAdvance, Math.fround(47.25));
  assert.equal(automaticImagePage.device.images[0].drawOffsetY, 13);
  assert.deepEqual(
    automaticImagePage.device.lines.map((line) => line.top),
    [22, 341],
  );
  assert.equal(automaticImagePage.device.pageUsage.displayedRecords, 3);
  assert.equal(automaticImagePage.device.pageUsage.remainingRecords, 0);

  const fallbackGlyph = narrowHangul.device.glyphs.find(
    (glyph) => glyph.codePoint === 0xac00,
  );
  assert.equal(fallbackGlyph.fallbackSource, 'question');
  assert.equal(fallbackGlyph.renderedCodePoint, 0x3f);
  assert.equal(fallbackGlyph.layoutAdvance, 28);

  assert.equal(manual.device.pageUsage.truncated, true);
  assert.ok(manual.device.pageUsage.remainingCharacters > 0);
  assert.ok(manual.device.pageUsage.firstHiddenCharacter);

  process.stdout.write('V6.3.15 renderer fixtures passed.\n');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function makeFixtureXtg() {
  const bytes = new Uint8Array(22 + 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x58, 0x54, 0x47, 0x00], 0);
  view.setUint16(4, 9, true);
  view.setUint16(6, 2, true);
  view.setUint32(10, 4, true);
  bytes.set([0xaa, 0x80, 0x55, 0x00], 22);
  return bytes;
}

function makeFixtureXtf() {
  const headerSize = 64;
  const rangeTableOffset = headerSize;
  const rangeCount = 2;
  const asciiCount = 0x7f - 0x20;
  const asciiWidthOffset = rangeTableOffset + rangeCount * 16;
  const glyphDataOffset = asciiWidthOffset + asciiCount;
  const glyphCount = asciiCount + 1;
  const bytesPerGlyph = 3;
  const glyphDataSize = glyphCount * bytesPerGlyph;
  const bytes = new Uint8Array(glyphDataOffset + glyphDataSize);
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
