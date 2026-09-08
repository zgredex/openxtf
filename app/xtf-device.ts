import type {
  FontBuildResult,
  FontPreviewResult,
  FontWorkerError,
} from './font-worker';

export type TypographyProfile = 'korean-x4' | 'standard';

export type KoreanX4Settings = {
  cellW: number;
  cellH: number;
  cropLeft: number;
  cropTop: number;
  advanceY: number;
  fullWidth: number;
  asciiWidth: number;
  spaceWidth: number;
  ascender: number;
  descender: number;
  strictCrop: boolean;
};

export const DEFAULT_KOREAN_X4_SETTINGS: KoreanX4Settings = {
  cellW: 39,
  cellH: 38,
  cropLeft: 0,
  cropTop: 0,
  advanceY: 38,
  fullWidth: 28,
  asciiWidth: 18,
  spaceWidth: 9,
  ascender: 28,
  descender: -9,
  strictCrop: true,
};

// V6.3.15 mode 0 uses an 18 px content inset. Reader/EPUB styling can apply
// additional line and paragraph spacing, but those values are not XTF data.
const PREVIEW_MARGIN = 18;
const PREVIEW_PARAGRAPH_GAP_FACTOR = 0.5;

const HEADER_SIZE = 64;
const FLAG_GLYPH_METADATA = 0x02;

type XtfHeader = {
  bpp: 1 | 2;
  flags: number;
  cellW: number;
  cellH: number;
  advanceY: number;
  fullWidth: number;
  asciiWidth: number;
  ascender: number;
  descender: number;
  rangeCount: number;
  glyphCount: number;
  rangeTableOffset: number;
  glyphDataOffset: number;
  bytesPerGlyph: number;
  glyphDataSize: number;
  asciiWidthOffset: number;
  asciiWidthCount: number;
  metadataBytes: number;
  rowStride: number;
};

type RangeRecord = {
  start: number;
  count: number;
  glyphIdStart: number;
};

type ParsedXtf = {
  bytes: Uint8Array;
  view: DataView;
  header: XtfHeader;
  ranges: RangeRecord[];
};

type FirmwareAdvanceSource =
  | 'ascii-table'
  | 'ascii-width'
  | 'full-width'
  | 'glyph-metadata'
  | 'zero-width'
  | 'tab-width';

type FirmwareFallbackSource =
  | 'direct'
  | 'replacement'
  | 'question'
  | 'generated-box'
  | 'none';

type ResolvedGlyph = {
  record: Uint8Array | null;
  renderedCodePoint: number;
  advance: number;
  advanceSource: FirmwareAdvanceSource;
  fallbackSource: FirmwareFallbackSource;
  storedAdvance: number | null;
  inkWidth: number;
  xOffset: number;
  missing: boolean;
  generatedBox: boolean;
};

type PlannedGlyph = {
  character: string;
  codePoint: number;
  sourceIndex: number;
  glyph: ResolvedGlyph;
};

type PlannedLine = {
  glyphs: PlannedGlyph[];
  baseWidth: number;
  breakReason: 'automatic' | 'manual' | 'text-end';
};

export type XtfProfileReport = {
  sourceCellW: number;
  sourceCellH: number;
  croppedInkPixels: number;
  croppedGlyphs: number;
  effectiveSpace: number;
};

export function applyKoreanX4Profile(
  result: FontBuildResult,
  settings: KoreanX4Settings,
): FontBuildResult {
  const source = parseXtf(result.bytes);
  const targetW = byteSetting(settings.cellW, 'cellW');
  const targetH = byteSetting(settings.cellH, 'cellH');
  const cropLeft = integerSetting(settings.cropLeft, -255, 255, 'cropLeft');
  const cropTop = integerSetting(settings.cropTop, -255, 255, 'cropTop');
  const targetAdvanceY = byteSetting(settings.advanceY, 'advanceY');
  const targetFullWidth = byteSetting(settings.fullWidth, 'fullWidth');
  const targetAsciiWidth = byteSetting(settings.asciiWidth, 'asciiWidth');
  const targetSpaceWidth = byteSetting(settings.spaceWidth, 'spaceWidth');
  const targetAscender = integerSetting(
    settings.ascender,
    -32768,
    32767,
    'ascender',
  );
  const targetDescender = integerSetting(
    settings.descender,
    -32768,
    32767,
    'descender',
  );
  const baselineShift = targetAscender - source.header.ascender;
  const targetStride = rowStride(targetW, source.header.bpp);
  const targetBytesPerGlyph =
    source.header.metadataBytes + targetStride * targetH;
  const targetGlyphDataSize = targetBytesPerGlyph * source.header.glyphCount;
  const targetLength = source.header.glyphDataOffset + targetGlyphDataSize;
  const output = new Uint8Array(targetLength);

  output.set(
    source.bytes.subarray(0, source.header.glyphDataOffset),
    0,
  );

  let croppedInkPixels = 0;
  let croppedGlyphs = 0;
  for (let glyphId = 0; glyphId < source.header.glyphCount; glyphId += 1) {
    const sourceRecordOffset =
      source.header.glyphDataOffset + glyphId * source.header.bytesPerGlyph;
    const targetRecordOffset =
      source.header.glyphDataOffset + glyphId * targetBytesPerGlyph;

    if (source.header.metadataBytes) {
      output.set(
        source.bytes.subarray(
          sourceRecordOffset,
          sourceRecordOffset + source.header.metadataBytes,
        ),
        targetRecordOffset,
      );
    }

    let glyphWasCropped = false;
    for (let y = 0; y < source.header.cellH; y += 1) {
      for (let x = 0; x < source.header.cellW; x += 1) {
        const level = readBitmapPixel(
          source.bytes,
          sourceRecordOffset + source.header.metadataBytes,
          source.header.rowStride,
          source.header.bpp,
          x,
          y,
        );
        if (!level) continue;
        const targetX = x - cropLeft;
        // Align the source baseline to the XTF ascender before applying the
        // explicit crop/translation. A 29 px raster then retains the KO 14 pt
        // placement inside the 39x38 reading cell.
        const targetY = y + baselineShift - cropTop;
        if (
          targetX < 0 ||
          targetX >= targetW ||
          targetY < 0 ||
          targetY >= targetH
        ) {
          croppedInkPixels += 1;
          glyphWasCropped = true;
          continue;
        }
        writeBitmapPixel(
          output,
          targetRecordOffset + source.header.metadataBytes,
          targetStride,
          source.header.bpp,
          targetX,
          targetY,
          level,
        );
      }
    }
    if (glyphWasCropped) croppedGlyphs += 1;
  }

  if (settings.strictCrop && croppedInkPixels > 0) {
    const error = new Error(
      `The requested ${targetW}×${targetH} cell would remove ${croppedInkPixels} ink pixels from ${croppedGlyphs} glyphs.`,
    ) as FontWorkerError;
    error.code = 'XTF_PROFILE_CROP_INK';
    throw error;
  }

  const view = new DataView(output.buffer);
  view.setUint8(0x0a, targetW);
  view.setUint8(0x0b, targetH);
  view.setUint8(0x0c, targetAdvanceY);
  view.setUint8(0x0d, targetFullWidth);
  view.setUint8(0x0e, targetAsciiWidth);
  view.setInt16(0x10, targetAscender, true);
  view.setInt16(0x12, targetDescender, true);
  view.setUint32(0x28, targetBytesPerGlyph, true);
  view.setUint32(0x2c, targetGlyphDataSize, true);

  const effectiveSpace = targetSpaceWidth;
  if (source.header.asciiWidthCount > 0) {
    output[source.header.asciiWidthOffset] = effectiveSpace;
  }
  patchStoredAdvance(output, source, 0x20, effectiveSpace, targetBytesPerGlyph);
  patchStoredAdvance(
    output,
    source,
    0x3000,
    targetFullWidth,
    targetBytesPerGlyph,
  );

  const crcData = crc32(
    output,
    source.header.glyphDataOffset,
    source.header.glyphDataOffset + targetGlyphDataSize,
  );
  view.setUint32(0x30, crcData, true);
  const crcHeader = crc32(output, 0, 0x34);
  view.setUint32(0x34, crcHeader, true);

  const report: XtfProfileReport = {
    sourceCellW: source.header.cellW,
    sourceCellH: source.header.cellH,
    croppedInkPixels,
    croppedGlyphs,
    effectiveSpace,
  };

  return {
    ...result,
    bytes: output,
    previewDataUrl: '',
    summary: {
      ...result.summary,
      profile: 'korean-x4',
      cellW: targetW,
      cellH: targetH,
      advanceY: targetAdvanceY,
      layoutFullWidth: targetFullWidth,
      layoutAsciiWidth: targetAsciiWidth,
      ascender: targetAscender,
      descender: targetDescender,
      bytesPerGlyph: targetBytesPerGlyph,
      fileSize: output.byteLength,
      crcData,
      crcHeader,
      ...report,
    },
  };
}

export function renderXtfDevicePreview(
  bytes: Uint8Array | ArrayBuffer,
  text: string,
  rasterSize: number,
): FontPreviewResult {
  const xtf = parseXtf(bytes);
  const width = 480;
  const height = 800;
  const margin = PREVIEW_MARGIN;
  // FUN_4204251c returns advanceY, falling back to cellH only when it is 0.
  // The reader's lineSpacingLS multiplier is not XTF data; the neutral font
  // preview therefore uses the stored metric directly.
  const linePitch = Math.max(1, xtf.header.advanceY || xtf.header.cellH);
  const paragraphExtra = Math.max(
    0,
    Math.trunc(linePitch * PREVIEW_PARAGRAPH_GAP_FACTOR),
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');

  const frame = new Uint8Array(width * height);
  const owners = new Int16Array(width * height);
  owners.fill(-1);
  const collisionRows = new Set<number>();
  const collisionMask = new Uint8Array(width * height);
  const missingCodePoints = new Set<number>();
  const left = margin;
  const right = width - margin;
  const bottom = height - margin;
  const contentWidth = right - left;
  const contentHeight = bottom - margin;
  const maximumWholeLines =
    xtf.header.cellH > contentHeight
      ? 0
      : 1 + Math.floor((contentHeight - xtf.header.cellH) / linePitch);
  const lines: NonNullable<FontPreviewResult['device']>['lines'] = [];
  const glyphs: NonNullable<FontPreviewResult['device']>['glyphs'] = [];

  const normalizedText = text.replace(/\r\n?/g, '\n');
  const characters = Array.from(normalizedText);
  const totalCharacters = characters.reduce(
    (count, character) => count + (character === '\n' ? 0 : 1),
    0,
  );
  const plannedLines: PlannedLine[] = [];
  let currentGlyphs: PlannedGlyph[] = [];
  let currentWidth = 0;

  const finishPlannedLine = (breakReason: PlannedLine['breakReason']) => {
    plannedLines.push({
      glyphs: currentGlyphs,
      baseWidth: currentWidth,
      breakReason,
    });
    currentGlyphs = [];
    currentWidth = 0;
  };

  for (
    let characterIndex = 0;
    characterIndex < characters.length;
    characterIndex += 1
  ) {
    const character = characters[characterIndex];
    if (character === '\n') {
      finishPlannedLine('manual');
      continue;
    }
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const glyph = resolveFirmwareGlyph(xtf, codePoint);
    if (glyph.missing && !isLayoutWhitespace(codePoint)) {
      missingCodePoints.add(codePoint);
    }
    if (currentGlyphs.length && currentWidth + glyph.advance > contentWidth) {
      finishPlannedLine('automatic');
      if (codePoint === 0x20) continue;
    }
    currentGlyphs.push({
      character,
      codePoint,
      sourceIndex: characterIndex,
      glyph,
    });
    currentWidth += glyph.advance;
  }
  if (currentGlyphs.length || !plannedLines.length) {
    finishPlannedLine('text-end');
  }

  let penY = margin;
  let previousBreak: PlannedLine['breakReason'] | null = null;
  let renderedSourceIndex = -1;
  for (let lineIndex = 0; lineIndex < plannedLines.length; lineIndex += 1) {
    const line = plannedLines[lineIndex];
    if (lineIndex > 0) {
      penY += linePitch;
      if (previousBreak === 'manual') penY += paragraphExtra;
    }
    if (penY + xtf.header.cellH > bottom) break;

    const extraByGlyph = firmwareJustification(line, contentWidth);
    const justification = extraByGlyph.reduce((sum, value) => sum + value, 0);
    const usedWidth = line.baseWidth + justification;
    const nextLineTop =
      penY +
      linePitch +
      (line.breakReason === 'manual' ? paragraphExtra : 0);
    const truncatedAfterLine =
      lineIndex < plannedLines.length - 1 &&
      nextLineTop + xtf.header.cellH > bottom;
    lines.push({
      index: lineIndex,
      top: penY,
      baseline: penY + xtf.header.ascender,
      characterCount: line.glyphs.length,
      text: line.glyphs.map((glyph) => glyph.character).join(''),
      baseWidth: line.baseWidth,
      justificationPixels: justification,
      justifiedSpaces: extraByGlyph.filter((extra) => extra !== 0).length,
      usedWidth,
      remainingWidth: Math.max(0, contentWidth - usedWidth),
      breakReason: truncatedAfterLine ? 'page-end' : line.breakReason,
    });

    let penX = left;
    for (let glyphIndex = 0; glyphIndex < line.glyphs.length; glyphIndex += 1) {
      const planned = line.glyphs[glyphIndex];
      const resolved = planned.glyph;
      const originX = Math.round(penX);
      const originY = Math.round(penY);
      const allocatedAdvance = resolved.advance + extraByGlyph[glyphIndex];
      const inkBounds = resolved.generatedBox
        ? {
            x: originX,
            y: originY,
            width: xtf.header.cellW,
            height: xtf.header.cellH,
          }
        : resolved.record
          ? glyphInkBounds(
              resolved.record,
              xtf,
              originX + resolved.xOffset,
              originY,
            )
          : null;
      const inkLeft = inkBounds?.x ?? originX;
      const inkRight = inkBounds ? inkBounds.x + inkBounds.width : originX;
      glyphs.push({
        index: glyphs.length,
        character: planned.character,
        codePoint: planned.codePoint,
        lineIndex,
        x: originX,
        y: originY,
        advance: allocatedAdvance,
        baseAdvance: resolved.advance,
        justificationExtra: extraByGlyph[glyphIndex],
        advanceSource: resolved.advanceSource,
        renderedCodePoint: resolved.renderedCodePoint,
        fallbackSource: resolved.fallbackSource,
        storedAdvance: resolved.storedAdvance,
        xOffset: resolved.xOffset,
        inkWidth: resolved.inkWidth,
        advanceOverflowLeft: Math.max(0, originX - inkLeft),
        advanceOverflowRight: Math.max(
          0,
          inkRight - (originX + allocatedAdvance),
        ),
        contentOverflow: Boolean(
          inkBounds &&
            (inkBounds.x < left || inkBounds.x + inkBounds.width > right),
        ),
        frameClipped: Boolean(
          inkBounds &&
            (inkBounds.x < 0 ||
              inkBounds.y < 0 ||
              inkBounds.x + inkBounds.width > width ||
              inkBounds.y + inkBounds.height > height),
        ),
        generatedBox: resolved.generatedBox,
        missing: resolved.missing,
        whitespace: isLayoutWhitespace(planned.codePoint),
        inkBounds,
      });
      if (resolved.generatedBox) {
        paintGeneratedBox(
          frame,
          owners,
          collisionRows,
          collisionMask,
          width,
          height,
          originX,
          originY,
          lineIndex,
          xtf,
        );
      } else if (resolved.record) {
        paintGlyph(
          frame,
          owners,
          collisionRows,
          collisionMask,
          width,
          height,
          originX + resolved.xOffset,
          originY,
          lineIndex,
          xtf,
          resolved.record,
        );
      }
      penX += allocatedAdvance;
      renderedSourceIndex = Math.max(
        renderedSourceIndex,
        planned.sourceIndex,
      );
    }
    previousBreak = line.breakReason;
    if (truncatedAfterLine) break;
  }

  const image = context.createImageData(width, height);
  for (let index = 0; index < frame.length; index += 1) {
    const ink = frame[index];
    const gray = 255 - Math.round((ink / 3) * 255);
    const offset = index * 4;
    image.data[offset] = gray;
    image.data[offset + 1] = gray;
    image.data[offset + 2] = gray;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  let collisionDataUrl = '';
  if (collisionRows.size) {
    const collisionCanvas = document.createElement('canvas');
    collisionCanvas.width = width;
    collisionCanvas.height = height;
    const collisionContext = collisionCanvas.getContext('2d');
    if (collisionContext) {
      const collisionImage = collisionContext.createImageData(width, height);
      for (let index = 0; index < collisionMask.length; index += 1) {
        if (!collisionMask[index]) continue;
        const offset = index * 4;
        collisionImage.data[offset] = 190;
        collisionImage.data[offset + 1] = 56;
        collisionImage.data[offset + 2] = 38;
        collisionImage.data[offset + 3] = 220;
      }
      collisionContext.putImageData(collisionImage, 0, 0);
      collisionDataUrl = collisionCanvas.toDataURL('image/png');
    }
  }

  const spaces = [0x20, 0x00a0, 0x3000, 0x09].map((codePoint) => {
    const record = recordForCodePoint(xtf, codePoint);
    const resolved = resolveFirmwareGlyph(xtf, codePoint);
    return {
      codePoint,
      advance: resolved.advance,
      stored: record !== null,
      advanceSource: resolved.advanceSource,
      fallbackSource: resolved.fallbackSource,
    };
  });
  const hiddenCharacters = characters
    .slice(renderedSourceIndex + 1)
    .filter((character) => character !== '\n');
  const remainingCharacters = hiddenCharacters.length;
  const lastLine = lines.at(-1);
  const usedHeight = lastLine
    ? lastLine.top + xtf.header.cellH - margin
    : 0;
  let inkCollisionPixels = 0;
  for (const collision of collisionMask) {
    if (collision) inkCollisionPixels += 1;
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mode: 'device',
    metrics: {
      fontSize: rasterSize,
      renderFontSize: rasterSize,
      bpp: xtf.header.bpp,
      cellW: xtf.header.cellW,
      cellH: xtf.header.cellH,
      advanceY: linePitch,
      contentBaseline: xtf.header.ascender,
      descenderHeight: Math.abs(xtf.header.descender),
      cellOverlap: Math.max(0, xtf.header.cellH - linePitch),
    },
    device: {
      width,
      height,
      ppi: 220,
      lineCount: lines.length,
      inkCollisionRows: collisionRows.size,
      inkCollisionPixels,
      lineTops: lines.map((line) => line.top),
      contentBounds: { left, top: margin, right, bottom },
      missingCodePoints: [...missingCodePoints].sort((a, b) => a - b),
      lines,
      glyphs,
      spaces,
      xtfHeader: {
        flags: xtf.header.flags,
        metadataBytes: xtf.header.metadataBytes,
        bpp: xtf.header.bpp,
        cellW: xtf.header.cellW,
        cellH: xtf.header.cellH,
        storedAdvanceY: xtf.header.advanceY,
        effectiveAdvanceY: linePitch,
        advanceYFallback: xtf.header.advanceY === 0,
        fullWidth: xtf.header.fullWidth,
        asciiWidth: xtf.header.asciiWidth,
        ascender: xtf.header.ascender,
        descender: xtf.header.descender,
        rowStride: xtf.header.rowStride,
        bytesPerGlyph: xtf.header.bytesPerGlyph,
        glyphCount: xtf.header.glyphCount,
        rangeCount: xtf.header.rangeCount,
      },
      layout: {
        margin,
        contentWidth,
        contentHeight,
        paragraphExtra,
        maximumWholeLines,
      },
      collisionDataUrl,
      pageUsage: {
        displayedCharacters: glyphs.length,
        totalCharacters,
        remainingCharacters,
        truncated: remainingCharacters > 0,
        lastVisibleCharacter:
          renderedSourceIndex >= 0 ? characters[renderedSourceIndex] : '',
        firstHiddenCharacter: hiddenCharacters[0] ?? '',
        usedHeight,
        remainingHeight: Math.max(0, contentHeight - usedHeight),
      },
    },
  };
}

function parseXtf(input: Uint8Array | ArrayBuffer): ParsedXtf {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (
    bytes.byteLength < HEADER_SIZE ||
    bytes[0] !== 0x58 ||
    bytes[1] !== 0x54 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x30
  ) {
    throw new Error('Not an XTF v1.5 file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bppValue = view.getUint8(0x07);
  if (bppValue !== 1 && bppValue !== 2) {
    throw new Error(`Unsupported XTF bit depth: ${bppValue}.`);
  }
  const flags = view.getUint8(0x08);
  const cellW = view.getUint8(0x0a);
  const cellH = view.getUint8(0x0b);
  const glyphCount = view.getUint32(0x18, true);
  const rangeCount = view.getUint16(0x14, true);
  const rangeTableOffset = view.getUint32(0x1c, true);
  const glyphDataOffset = view.getUint32(0x24, true);
  const bytesPerGlyph = view.getUint32(0x28, true);
  const glyphDataSize = view.getUint32(0x2c, true);
  const asciiWidthOffset = view.getUint32(0x38, true);
  const asciiWidthCount = view.getUint8(0x3c);
  const metadataBytes = flags & FLAG_GLYPH_METADATA ? 2 : 0;
  const stride = rowStride(cellW, bppValue);
  const minimumRecordSize = metadataBytes + stride * cellH;
  if (
    !cellW ||
    !cellH ||
    bytesPerGlyph < minimumRecordSize ||
    glyphDataSize !== bytesPerGlyph * glyphCount ||
    glyphDataOffset + glyphDataSize > bytes.byteLength ||
    rangeTableOffset + rangeCount * 16 > bytes.byteLength ||
    (asciiWidthCount > 0 &&
      asciiWidthOffset + asciiWidthCount > bytes.byteLength)
  ) {
    throw new Error('The XTF header or glyph table is inconsistent.');
  }
  const ranges: RangeRecord[] = [];
  for (let index = 0; index < rangeCount; index += 1) {
    const offset = rangeTableOffset + index * 16;
    ranges.push({
      start: view.getUint32(offset, true),
      count: view.getUint32(offset + 4, true),
      glyphIdStart: view.getUint32(offset + 8, true),
    });
  }
  return {
    bytes,
    view,
    ranges,
    header: {
      bpp: bppValue,
      flags,
      cellW,
      cellH,
      advanceY: view.getUint8(0x0c),
      fullWidth: view.getUint8(0x0d),
      asciiWidth: view.getUint8(0x0e),
      ascender: view.getInt16(0x10, true),
      descender: view.getInt16(0x12, true),
      rangeCount,
      glyphCount,
      rangeTableOffset,
      glyphDataOffset,
      bytesPerGlyph,
      glyphDataSize,
      asciiWidthOffset,
      asciiWidthCount,
      metadataBytes,
      rowStride: stride,
    },
  };
}

function patchStoredAdvance(
  output: Uint8Array,
  source: ParsedXtf,
  cp: number,
  advance: number,
  targetBytesPerGlyph: number,
) {
  if (!source.header.metadataBytes) return;
  const glyphId = glyphIdForCodePoint(source, cp);
  if (glyphId === null) return;
  output[source.header.glyphDataOffset + glyphId * targetBytesPerGlyph] =
    advance;
}

function glyphIdForCodePoint(xtf: ParsedXtf, cp: number): number | null {
  let low = 0;
  let high = xtf.ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = xtf.ranges[middle];
    if (cp < range.start) high = middle - 1;
    else if (cp >= range.start + range.count) low = middle + 1;
    else return range.glyphIdStart + cp - range.start;
  }
  return null;
}

function recordForCodePoint(xtf: ParsedXtf, codePoint: number) {
  const glyphId = glyphIdForCodePoint(xtf, codePoint);
  if (glyphId === null) return null;
  const start =
    xtf.header.glyphDataOffset + glyphId * xtf.header.bytesPerGlyph;
  return xtf.bytes.subarray(start, start + xtf.header.bytesPerGlyph);
}

function storedAdvance(xtf: ParsedXtf, record: Uint8Array) {
  // FUN_4200249e: the metadata byte is authoritative when flag 0x02 is
  // present; otherwise V6.3.15 returns the header full-width advance.
  return xtf.header.metadataBytes ? record[0] : xtf.header.fullWidth;
}

function metadataEffectiveAdvance(xtf: ParsedXtf, record: Uint8Array) {
  // FUN_42045d74 operates on the record selected by the fallback loader. It
  // does not re-enter the ASCII-table/fullWidth classifier for that record.
  const inkWidth = glyphInkWidth(record, xtf);
  const inkAdvance =
    inkWidth < 1 ? 0 : signedXOffset(xtf, record) + inkWidth + 1;
  return Math.max(1, storedAdvance(xtf, record), inkAdvance);
}

function signedXOffset(xtf: ParsedXtf, record: Uint8Array) {
  // FUN_420024b4 reads metadata byte 1 as int8_t.
  if (!xtf.header.metadataBytes) return 0;
  const value = record[1] ?? 0;
  return value > 0x7f ? value - 0x100 : value;
}

function asciiTableAdvance(xtf: ParsedXtf, codePoint: number) {
  const index = codePoint - 0x20;
  if (index < 0 || index >= xtf.header.asciiWidthCount) return 0;
  return xtf.bytes[xtf.header.asciiWidthOffset + index] ?? 0;
}

function firmwareAdvance(
  xtf: ParsedXtf,
  codePoint: number,
  record: Uint8Array | null,
) {
  // FUN_42042582 supplies the native 0x20..0x7e table. Its entries, notably
  // U+0020, drive both measurement and wrapping.
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return Math.max(1, asciiTableAdvance(xtf, codePoint) || xtf.header.asciiWidth);
  }
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 0;

  // FUN_42046fc2: ordinary multi-byte text, including Hangul, uses the
  // header full-width value. Single-byte text uses asciiWidth. Only the
  // ranges accepted by FUN_42046ce4 may replace that base with an XTF
  // per-glyph advance.
  const baseAdvance =
    codePoint < 0x80 || firmwareUsesGlyphAdvance(codePoint)
      ? xtf.header.asciiWidth
      : xtf.header.fullWidth;
  if (!record || !firmwareUsesGlyphAdvance(codePoint)) {
    return Math.max(1, baseAdvance);
  }

  // FUN_42045d74 caches max(storedAdvance, signedXOffset + inkWidth + 1).
  // Unlike the legacy 4206xxxx path, this scans the actual 1/2-bpp bitmap
  // after the two metadata bytes have been skipped.
  return metadataEffectiveAdvance(xtf, record);
}

function firmwareAdvanceSource(
  codePoint: number,
  record: Uint8Array | null,
): FirmwareAdvanceSource {
  if (codePoint === 0x09) return 'tab-width';
  if (codePoint >= 0x20 && codePoint <= 0x7e) return 'ascii-table';
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 'zero-width';
  if (record && firmwareUsesGlyphAdvance(codePoint)) return 'glyph-metadata';
  if (codePoint < 0x80) return 'ascii-width';
  return 'full-width';
}

function firmwareUsesGlyphAdvance(codePoint: number) {
  // FUN_42047048 + FUN_42046ce4. The firmware deliberately excludes ordinary
  // CJK/Hangul from the metadata-width path.
  if (codePoint === 0x2026 || firmwareZeroAdvanceCodePoint(codePoint)) {
    return false;
  }
  return (
    (codePoint >= 0x0080 && codePoint <= 0x024f) ||
    (codePoint >= 0x0370 && codePoint <= 0x052f) ||
    (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
    (codePoint >= 0x0e00 && codePoint <= 0x0e7f) ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff) ||
    (codePoint >= 0x2000 && codePoint <= 0x22ff)
  );
}

function firmwareZeroAdvanceCodePoint(codePoint: number) {
  // FUN_42046f0c: combining marks, joiners and variation selectors are
  // zero-advance components in the V6.3.15 text loop.
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x0e31 &&
      codePoint <= 0x0e4e &&
      ((0x3fc003f9 >>> ((codePoint - 0x0e31) & 31)) & 1) !== 0) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function resolveFirmwareGlyph(
  xtf: ParsedXtf,
  codePoint: number,
): ResolvedGlyph {
  const direct = recordForCodePoint(xtf, codePoint);
  if (direct) {
    const inkWidth = glyphInkWidth(direct, xtf);
    return {
      record: direct,
      renderedCodePoint: codePoint,
      advance: firmwareAdvance(xtf, codePoint, direct),
      advanceSource: firmwareAdvanceSource(codePoint, direct),
      fallbackSource: 'direct',
      storedAdvance: storedAdvance(xtf, direct),
      inkWidth: Math.max(0, inkWidth),
      xOffset: signedXOffset(xtf, direct),
      missing: false,
      generatedBox: false,
    };
  }

  if (codePoint === 0x09) {
    return {
      record: null,
      renderedCodePoint: codePoint,
      advance: Math.max(1, xtf.header.asciiWidth),
      advanceSource: 'tab-width',
      fallbackSource: 'none',
      storedAdvance: null,
      inkWidth: 0,
      xOffset: 0,
      missing: true,
      generatedBox: false,
    };
  }

  // FUN_42045e46: missing glyphs fall back to U+FFFD, then '?'. If neither
  // exists FUN_420448a2 creates a border box across the complete cell.
  const replacements = codePoint === 0xfffd ? [0x3f] : [0xfffd, 0x3f];
  for (const replacement of replacements) {
    if (codePoint === replacement) continue;
    const record = recordForCodePoint(xtf, replacement);
    if (!record) continue;
    const inkWidth = glyphInkWidth(record, xtf);
    return {
      record,
      renderedCodePoint: replacement,
      advance: firmwareUsesGlyphAdvance(codePoint)
        ? metadataEffectiveAdvance(xtf, record)
        : firmwareAdvance(xtf, codePoint, null),
      advanceSource: firmwareAdvanceSource(codePoint, record),
      fallbackSource: replacement === 0xfffd ? 'replacement' : 'question',
      storedAdvance: storedAdvance(xtf, record),
      inkWidth: Math.max(0, inkWidth),
      xOffset: signedXOffset(xtf, record),
      missing: true,
      generatedBox: false,
    };
  }

  return {
    record: null,
    renderedCodePoint: codePoint,
    advance: firmwareAdvance(xtf, codePoint, null),
    advanceSource: firmwareAdvanceSource(codePoint, null),
    fallbackSource: 'generated-box',
    storedAdvance: null,
    inkWidth: xtf.header.cellW,
    xOffset: 0,
    missing: true,
    generatedBox: true,
  };
}

function firmwareJustification(line: PlannedLine, contentWidth: number) {
  const extras = new Array(line.glyphs.length).fill(0) as number[];
  if (line.breakReason !== 'automatic' || line.baseWidth >= contentWidth) {
    return extras;
  }
  const firstInk = line.glyphs.findIndex(
    (glyph) => glyph.codePoint !== 0x20,
  );
  let lastInk = line.glyphs.length - 1;
  while (lastInk >= 0 && line.glyphs[lastInk].codePoint === 0x20) {
    lastInk -= 1;
  }
  if (firstInk < 0 || lastInk <= firstInk) return extras;
  const spaces: number[] = [];
  for (let index = firstInk + 1; index < lastInk; index += 1) {
    if (line.glyphs[index].codePoint === 0x20) spaces.push(index);
  }
  if (!spaces.length) return extras;

  // FUN_4204207e divides the signed slack across internal U+0020 spaces and
  // distributes the integer remainder one pixel at a time.
  const slack = contentWidth - line.baseWidth;
  const quotient = Math.trunc(slack / spaces.length);
  const remainder = slack % spaces.length;
  spaces.forEach((glyphIndex, index) => {
    extras[glyphIndex] = quotient + (index < remainder ? 1 : 0);
  });
  return extras;
}

function glyphInkWidth(record: Uint8Array, xtf: ParsedXtf) {
  const bitmapOffset = xtf.header.metadataBytes;
  for (let x = xtf.header.cellW - 1; x >= 0; x -= 1) {
    for (let y = 0; y < xtf.header.cellH; y += 1) {
      if (
        readBitmapPixel(
          record,
          bitmapOffset,
          xtf.header.rowStride,
          xtf.header.bpp,
          x,
          y,
        )
      ) {
        return x + 1;
      }
    }
  }
  return -1;
}

function glyphInkBounds(
  record: Uint8Array,
  xtf: ParsedXtf,
  originX: number,
  originY: number,
) {
  let left = xtf.header.cellW;
  let top = xtf.header.cellH;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < xtf.header.cellH; y += 1) {
    for (let x = 0; x < xtf.header.cellW; x += 1) {
      if (
        !readBitmapPixel(
          record,
          xtf.header.metadataBytes,
          xtf.header.rowStride,
          xtf.header.bpp,
          x,
          y,
        )
      ) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  return {
    x: originX + left,
    y: originY + top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function isLayoutWhitespace(codePoint: number) {
  return codePoint === 0x09 || codePoint === 0x20 || codePoint === 0xa0 || codePoint === 0x3000;
}

function paintGlyph(
  frame: Uint8Array,
  owners: Int16Array,
  collisionRows: Set<number>,
  collisionMask: Uint8Array,
  frameW: number,
  frameH: number,
  originX: number,
  originY: number,
  lineIndex: number,
  xtf: ParsedXtf,
  record: Uint8Array,
) {
  const bitmapOffset = xtf.header.metadataBytes;
  for (let y = 0; y < xtf.header.cellH; y += 1) {
    const targetY = originY + y;
    if (targetY < 0 || targetY >= frameH) continue;
    for (let x = 0; x < xtf.header.cellW; x += 1) {
      const level = readBitmapPixel(
        record,
        bitmapOffset,
        xtf.header.rowStride,
        xtf.header.bpp,
        x,
        y,
      );
      if (!level) continue;
      const targetX = originX + x;
      if (targetX < 0 || targetX >= frameW) continue;
      const index = targetY * frameW + targetX;
      if (frame[index] && owners[index] >= 0 && owners[index] !== lineIndex) {
        collisionRows.add(targetY);
        collisionMask[index] = 1;
      }
      frame[index] = Math.max(frame[index], level);
      owners[index] = lineIndex;
    }
  }
}

function paintGeneratedBox(
  frame: Uint8Array,
  owners: Int16Array,
  collisionRows: Set<number>,
  collisionMask: Uint8Array,
  frameW: number,
  frameH: number,
  originX: number,
  originY: number,
  lineIndex: number,
  xtf: ParsedXtf,
) {
  for (let y = 0; y < xtf.header.cellH; y += 1) {
    for (let x = 0; x < xtf.header.cellW; x += 1) {
      if (
        x !== 0 &&
        y !== 0 &&
        x !== xtf.header.cellW - 1 &&
        y !== xtf.header.cellH - 1
      ) {
        continue;
      }
      const targetX = originX + x;
      const targetY = originY + y;
      if (
        targetX < 0 ||
        targetX >= frameW ||
        targetY < 0 ||
        targetY >= frameH
      ) {
        continue;
      }
      const index = targetY * frameW + targetX;
      if (frame[index] && owners[index] >= 0 && owners[index] !== lineIndex) {
        collisionRows.add(targetY);
        collisionMask[index] = 1;
      }
      frame[index] = 3;
      owners[index] = lineIndex;
    }
  }
}

function readBitmapPixel(
  bytes: Uint8Array,
  bitmapOffset: number,
  stride: number,
  bpp: 1 | 2,
  x: number,
  y: number,
) {
  const offset = bitmapOffset + y * stride + (bpp === 1 ? x >> 3 : x >> 2);
  const byte = bytes[offset] ?? 0;
  if (bpp === 1) return byte & (0x80 >> (x & 7)) ? 3 : 0;
  return (byte >> ((3 - (x & 3)) * 2)) & 0x03;
}

function writeBitmapPixel(
  bytes: Uint8Array,
  bitmapOffset: number,
  stride: number,
  bpp: 1 | 2,
  x: number,
  y: number,
  level: number,
) {
  if (bpp === 1) {
    const offset = bitmapOffset + y * stride + (x >> 3);
    bytes[offset] |= 0x80 >> (x & 7);
    return;
  }
  const offset = bitmapOffset + y * stride + (x >> 2);
  const shift = (3 - (x & 3)) * 2;
  bytes[offset] = (bytes[offset] & ~(0x03 << shift)) | ((level & 0x03) << shift);
}

function rowStride(cellW: number, bpp: 1 | 2) {
  return Math.ceil((cellW * bpp) / 8);
}

function byteSetting(value: number, name: string) {
  return integerSetting(value, 1, 255, name);
}

function integerSetting(value: number, minimum: number, maximum: number, name: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function crc32(bytes: Uint8Array, start = 0, end = bytes.length) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
