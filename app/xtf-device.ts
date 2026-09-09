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

export type DeviceLineSpacing = 'auto' | 1.2 | 1.4 | 1.6 | 1.8 | 2;
export type DeviceParagraphRatio = 1 | 1.25 | 1.5 | 1.75 | 2;
export type DeviceIndentChars = 1 | 2;
export type DeviceAlignMode = 'wrap-align' | 'right' | 'left';

export type DeviceLayoutSettings = {
  lineSpacing: DeviceLineSpacing;
  paragraphRatio: DeviceParagraphRatio;
  indentChars: DeviceIndentChars;
  alignMode: DeviceAlignMode;
};

export type DevicePreviewBlock = {
  text: string;
  tag?: string;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  suppressIndent?: boolean;
};

export type DevicePreviewOptions = {
  layout?: Partial<DeviceLayoutSettings>;
  blocks?: DevicePreviewBlock[];
  ignoredBlankBlocks?: number;
};

export const DEFAULT_DEVICE_LAYOUT_SETTINGS: DeviceLayoutSettings = {
  lineSpacing: 1.2,
  paragraphRatio: 1.5,
  indentChars: 2,
  alignMode: 'wrap-align',
};

// V6.3.15 mode 0 uses an 18 px content inset. Runtime reader settings are
// separate from the XTF file but are applied here to reproduce the page.
const PREVIEW_MARGIN = 18;
// FUN_420aff66 compares the external-font draw Y plus the calibrated glyph
// bottom against 0x28e. The reading surface is therefore 654 pixels tall;
// the rest of the 480x800 framebuffer is not another page-text area.
const V6315_READING_SURFACE_HEIGHT = 0x28e;
// The external-XTF branch of FUN_420aff66 initializes its floating-point Y
// accumulator with the exact IEEE-754 value 0x3fe66666 (1.8f), then truncates
// the accumulator to an integer for each draw call.
const V6315_EXTERNAL_INITIAL_Y = 1.8;

const HEADER_SIZE = 64;
const FLAG_GLYPH_METADATA = 0x02;
// FUN_42093b1a initializes ctx+0x16 to 1. FUN_42080708 adds it to ordinary
// three-byte text (including Hangul), ASCII, and U+0020.
const V6315_CHARACTER_SPACING = 1;

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
  | 'ink-bounds'
  | 'cell-quarter-space'
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
  paragraphIndex: number;
  indent: number;
  textAlign?: DevicePreviewBlock['textAlign'];
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
  options: DevicePreviewOptions = {},
): FontPreviewResult {
  const xtf = parseXtf(bytes);
  const width = 480;
  const height = 800;
  const margin = PREVIEW_MARGIN;
  const layout: DeviceLayoutSettings = {
    ...DEFAULT_DEVICE_LAYOUT_SETTINGS,
    ...options.layout,
  };
  // V6.3.15 FUN_4209810e stores float(cellH) * lineSpacingLS. The compiled
  // line-spacing table is exactly 1.0, 1.2, 1.4, 1.6, 1.8, 2.0; the UI calls
  // the 1.0 entry Auto. Drawing converts each accumulated float Y to int.
  const lineSpacingFactor = layout.lineSpacing === 'auto' ? 1 : layout.lineSpacing;
  const firmwareLineSpacingFactor = Math.fround(lineSpacingFactor);
  const lineAdvance = Math.fround(
    Math.fround(xtf.header.cellH) * firmwareLineSpacingFactor,
  );
  // FUN_420570e4 returns paraRatioLS, and the paragraph painter advances by
  // ratio * lineAdvance between blocks. Therefore 1x is one normal step, not
  // one normal step plus another full line.
  const firmwareParagraphRatio = Math.fround(layout.paragraphRatio);
  const paragraphAdvance = Math.fround(
    lineAdvance * firmwareParagraphRatio,
  );
  const paragraphExtra = Math.fround(paragraphAdvance - lineAdvance);
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
  const top = 0;
  const bottom = V6315_READING_SURFACE_HEIGHT;
  const contentWidth = right - left;
  const contentHeight = V6315_READING_SURFACE_HEIGHT;
  const verticalCalibration = firmwareVerticalCalibration(xtf);
  const firstLineY = V6315_EXTERNAL_INITIAL_Y;
  const maximumWholeLines = countWholeLines(
    firstLineY,
    bottom,
    verticalCalibration.bottom,
    lineAdvance,
  );
  const lines: NonNullable<FontPreviewResult['device']>['lines'] = [];
  const glyphs: NonNullable<FontPreviewResult['device']>['glyphs'] = [];

  const previewBlocks = normalizePreviewBlocks(text, options.blocks);
  const sourceCharacters: string[] = [];
  const plannedLines: PlannedLine[] = [];
  let sourceIndex = 0;
  for (let paragraphIndex = 0; paragraphIndex < previewBlocks.length; paragraphIndex += 1) {
    const block = previewBlocks[paragraphIndex];
    const blockLines = block.text.replace(/\r\n?/g, '\n').split('\n');
    for (let manualIndex = 0; manualIndex < blockLines.length; manualIndex += 1) {
      const paragraphGlyphs: PlannedGlyph[] = [];
      for (const character of Array.from(blockLines[manualIndex])) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;
        sourceCharacters.push(character);
        const glyph = resolveFirmwareGlyph(xtf, codePoint);
        if (glyph.missing && !isLayoutWhitespace(codePoint)) {
          missingCodePoints.add(codePoint);
        }
        paragraphGlyphs.push({ character, codePoint, sourceIndex, glyph });
        sourceIndex += 1;
      }
      const suppressIndent =
        block.suppressIndent ||
        block.textAlign === 'center' ||
        /^h[1-6]$/.test(block.tag || '');
      planFirmwareLines(
        paragraphGlyphs,
        paragraphIndex,
        suppressIndent ? 0 : xtf.header.cellW * layout.indentChars,
        contentWidth,
        block.textAlign,
        plannedLines,
      );
      if (manualIndex < blockLines.length - 1) {
        const last = plannedLines.at(-1);
        if (last) last.breakReason = 'manual';
      }
    }
    const last = plannedLines.at(-1);
    if (last) {
      last.breakReason =
        paragraphIndex < previewBlocks.length - 1 ? 'manual' : 'text-end';
    }
  }
  if (!plannedLines.length) {
    plannedLines.push({
      glyphs: [],
      baseWidth: 0,
      breakReason: 'text-end',
      paragraphIndex: 0,
      indent: 0,
    });
  }

  let penYFloat = Math.fround(firstLineY);
  let renderedSourceIndex = -1;
  for (let lineIndex = 0; lineIndex < plannedLines.length; lineIndex += 1) {
    const line = plannedLines[lineIndex];
    if (lineIndex > 0) {
      const previous = plannedLines[lineIndex - 1];
      penYFloat = Math.fround(
        penYFloat +
          (previous.paragraphIndex === line.paragraphIndex
            ? lineAdvance
            : paragraphAdvance),
      );
    }
    const penY = Math.trunc(penYFloat);
    if (penY + verticalCalibration.bottom > bottom) break;

    const availableWidth = Math.max(1, contentWidth - line.indent);
    const effectiveAlign =
      line.textAlign === 'center'
        ? 'center'
        : layout.alignMode === 'right'
          ? 'right'
          : layout.alignMode === 'left'
            ? 'left'
            : 'wrap-align';
    const extraByGlyph =
      effectiveAlign === 'wrap-align'
        ? firmwareJustification(line, availableWidth)
        : new Array(line.glyphs.length).fill(0) as number[];
    const justification = extraByGlyph.reduce((sum, value) => sum + value, 0);
    const inkRunWidth = line.baseWidth + justification;
    const usedWidth = line.indent + inkRunWidth;
    const nextLine = plannedLines[lineIndex + 1];
    const nextLineTop = nextLine
      ? Math.trunc(
          Math.fround(
            penYFloat +
            (nextLine.paragraphIndex === line.paragraphIndex
              ? lineAdvance
              : paragraphAdvance),
          ),
        )
      : penY;
    const truncatedAfterLine =
      lineIndex < plannedLines.length - 1 &&
      nextLineTop + verticalCalibration.bottom > bottom;
    lines.push({
      index: lineIndex,
      top: penY,
      baseline: penY,
      characterCount: line.glyphs.length,
      text: line.glyphs.map((glyph) => glyph.character).join(''),
      baseWidth: line.baseWidth,
      justificationPixels: justification,
      justifiedSpaces: extraByGlyph.filter((extra) => extra !== 0).length,
      usedWidth,
      remainingWidth: Math.max(0, contentWidth - usedWidth),
      breakReason: truncatedAfterLine ? 'page-end' : line.breakReason,
      lineAdvance,
      indent: line.indent,
      alignment: effectiveAlign,
    });

    let penX =
      effectiveAlign === 'center'
        ? left + (contentWidth - inkRunWidth) / 2
        : effectiveAlign === 'right'
          ? right - inkRunWidth
          : left + line.indent;
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
  const hiddenCharacters = sourceCharacters
    .slice(renderedSourceIndex + 1)
    .filter((character) => character !== '\n');
  const remainingCharacters = hiddenCharacters.length;
  const lastLine = lines.at(-1);
  const usedHeight = lastLine
    ? lastLine.top + verticalCalibration.bottom - top
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
      advanceY: lineAdvance,
      contentBaseline: xtf.header.ascender,
      descenderHeight: Math.abs(xtf.header.descender),
      cellOverlap: Math.max(0, xtf.header.cellH - lineAdvance),
    },
    device: {
      width,
      height,
      ppi: 220,
      lineCount: lines.length,
      inkCollisionRows: collisionRows.size,
      inkCollisionPixels,
      lineTops: lines.map((line) => line.top),
      contentBounds: { left, top, right, bottom },
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
        effectiveAdvanceY: lineAdvance,
        advanceYFallback: false,
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
        lineSpacing: layout.lineSpacing,
        lineSpacingFactor,
        lineAdvance,
        paragraphRatio: layout.paragraphRatio,
        paragraphAdvance,
        indentChars: layout.indentChars,
        indentPixels: xtf.header.cellW * layout.indentChars,
        alignMode: layout.alignMode,
        ignoredBlankBlocks: options.ignoredBlankBlocks ?? 0,
        firstLineY,
        pageFitBottomOffset: verticalCalibration.bottom,
        readingSurfaceHeight: V6315_READING_SURFACE_HEIGHT,
      },
      collisionDataUrl,
      pageUsage: {
        displayedCharacters: glyphs.length,
        totalCharacters: sourceCharacters.length,
        remainingCharacters,
        truncated: remainingCharacters > 0,
        lastVisibleCharacter:
          renderedSourceIndex >= 0 ? sourceCharacters[renderedSourceIndex] : '',
        firstHiddenCharacter: hiddenCharacters[0] ?? '',
        usedHeight,
        remainingHeight: Math.max(0, contentHeight - usedHeight),
      },
    },
  };
}

function normalizePreviewBlocks(
  text: string,
  supplied: DevicePreviewBlock[] | undefined,
) {
  if (supplied?.length) {
    return supplied
      .map((block) => ({ ...block, text: block.text.replace(/\r\n?/g, '\n').trim() }))
      .filter((block) => block.text.length > 0);
  }
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const blocks = normalized
    .split(/\n[\t ]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ text: block }));
  return blocks.length ? blocks : [{ text: normalized.trim() }];
}

function planFirmwareLines(
  input: PlannedGlyph[],
  paragraphIndex: number,
  firstLineIndent: number,
  contentWidth: number,
  textAlign: DevicePreviewBlock['textAlign'],
  output: PlannedLine[],
) {
  const tokens: PlannedGlyph[][] = [];
  for (let index = 0; index < input.length; ) {
    const glyph = input[index];
    if (glyph.codePoint === 0x20) {
      let end = index + 1;
      while (end < input.length && input[end].codePoint === 0x20) end += 1;
      tokens.push(input.slice(index, end));
      index = end;
      continue;
    }
    if (glyph.codePoint >= 0x21 && glyph.codePoint <= 0x7e) {
      let end = index + 1;
      while (
        end < input.length &&
        input[end].codePoint >= 0x21 &&
        input[end].codePoint <= 0x7e
      ) {
        end += 1;
      }
      tokens.push(input.slice(index, end));
      index = end;
      continue;
    }
    tokens.push([glyph]);
    index += 1;
  }

  let current: PlannedGlyph[] = [];
  let currentWidth = 0;
  let pendingSpaces: PlannedGlyph[] = [];
  let firstLine = true;
  const indentForLine = () => (firstLine ? firstLineIndent : 0);
  const widthForLine = () => Math.max(1, contentWidth - indentForLine());
  const finish = (breakReason: PlannedLine['breakReason']) => {
    while (current.at(-1)?.codePoint === 0x20) {
      const removed = current.pop();
      currentWidth -= removed?.glyph.advance ?? 0;
    }
    output.push({
      glyphs: current,
      baseWidth: currentWidth,
      breakReason,
      paragraphIndex,
      indent: indentForLine(),
      textAlign,
    });
    current = [];
    currentWidth = 0;
    pendingSpaces = [];
    firstLine = false;
  };

  for (const token of tokens) {
    if (token.every((glyph) => glyph.codePoint === 0x20)) {
      if (current.length) pendingSpaces.push(...token);
      continue;
    }
    const pendingWidth = glyphRunWidth(pendingSpaces);
    const tokenWidth = glyphRunWidth(token);
    if (
      current.length &&
      currentWidth + pendingWidth + tokenWidth > widthForLine()
    ) {
      finish('automatic');
    }
    if (pendingSpaces.length && current.length) {
      current.push(...pendingSpaces);
      currentWidth += glyphRunWidth(pendingSpaces);
      pendingSpaces = [];
    }
    for (const glyph of token) {
      if (current.length && currentWidth + glyph.glyph.advance > widthForLine()) {
        finish('automatic');
      }
      current.push(glyph);
      currentWidth += glyph.glyph.advance;
    }
  }
  if (current.length || !output.length || output.at(-1)?.paragraphIndex !== paragraphIndex) {
    finish('text-end');
  }
}

function glyphRunWidth(glyphs: PlannedGlyph[]) {
  return glyphs.reduce((width, glyph) => width + glyph.glyph.advance, 0);
}

function countWholeLines(
  top: number,
  bottom: number,
  pageFitBottomOffset: number,
  lineAdvance: number,
) {
  let count = 0;
  let y = Math.fround(top);
  while (
    Math.trunc(y) + pageFitBottomOffset <= bottom &&
    count < 10_000
  ) {
    count += 1;
    y = Math.fround(y + lineAdvance);
  }
  return count;
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
  // FUN_42080708 handles U+0020 separately: (cellW >> 2) + ctx+0x16.
  if (codePoint === 0x20) {
    return Math.max(1, (xtf.header.cellW >> 2) + V6315_CHARACTER_SPACING);
  }
  if (codePoint >= 0x21 && codePoint <= 0x7e) {
    // FUN_4209810e rebuilds the active ASCII table from ink span + ctx+0x14
    // (initialized to 1), then FUN_42080708 adds ctx+0x16 (also 1).
    const ink = record ? glyphInkWidth(record, xtf) : 0;
    const rebuilt = ink > 0 ? ink + 1 : asciiTableAdvance(xtf, codePoint);
    return Math.max(
      1,
      (rebuilt || xtf.header.asciiWidth) + V6315_CHARACTER_SPACING,
    );
  }
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 0;

  // FUN_4208115c and FUN_42080708 scan ordinary non-ASCII bitmaps and use
  // (right + 1) - left, capped at cellW. Hangul is three-byte UTF-8, so the
  // renderer also adds the initialized ctx+0x16 character spacing.
  if (!firmwareUsesGlyphAdvance(codePoint)) {
    const ink = record ? glyphInkWidth(record, xtf) : 0;
    const measured = ink > 0 ? Math.min(ink, xtf.header.cellW) : xtf.header.cellW >> 1;
    return Math.max(1, measured + V6315_CHARACTER_SPACING);
  }

  if (!record) return Math.max(1, xtf.header.asciiWidth + V6315_CHARACTER_SPACING);
  return metadataEffectiveAdvance(xtf, record) + V6315_CHARACTER_SPACING;
}

function firmwareAdvanceSource(
  codePoint: number,
  record: Uint8Array | null,
): FirmwareAdvanceSource {
  if (codePoint === 0x09) return 'tab-width';
  if (codePoint === 0x20) return 'cell-quarter-space';
  if (codePoint >= 0x21 && codePoint <= 0x7e) return 'ascii-table';
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 'zero-width';
  if (record && firmwareUsesGlyphAdvance(codePoint)) return 'glyph-metadata';
  if (codePoint < 0x80) return 'ascii-width';
  return 'ink-bounds';
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
    const inkLeft = glyphInkLeft(direct, xtf);
    return {
      record: direct,
      renderedCodePoint: codePoint,
      advance: firmwareAdvance(xtf, codePoint, direct),
      advanceSource: firmwareAdvanceSource(codePoint, direct),
      fallbackSource: 'direct',
      storedAdvance: storedAdvance(xtf, direct),
      inkWidth: Math.max(0, inkWidth),
      // FUN_4206ac92 shifts the staged bitmap by -left in the normal reader
      // draw path, so the measured ink begins at the current pen position.
      xOffset: inkLeft > 0 ? -inkLeft : 0,
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
      xOffset: Math.min(0, -glyphInkLeft(record, xtf)),
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
  const left = glyphInkLeft(record, xtf);
  if (left < 0) return -1;
  for (let x = xtf.header.cellW - 1; x >= left; x -= 1) {
    for (let y = 0; y < xtf.header.cellH; y += 1) {
      if (
        readBitmapPixel(
          record,
          xtf.header.metadataBytes,
          xtf.header.rowStride,
          xtf.header.bpp,
          x,
          y,
        )
      ) {
        return x - left + 1;
      }
    }
  }
  return -1;
}

function glyphInkLeft(record: Uint8Array, xtf: ParsedXtf) {
  for (let x = 0; x < xtf.header.cellW; x += 1) {
    for (let y = 0; y < xtf.header.cellH; y += 1) {
      if (
        readBitmapPixel(
          record,
          xtf.header.metadataBytes,
          xtf.header.rowStride,
          xtf.header.bpp,
          x,
          y,
        )
      ) {
        return x;
      }
    }
  }
  return -1;
}

function glyphInkVerticalBounds(record: Uint8Array, xtf: ParsedXtf) {
  let top = xtf.header.cellH;
  let bottom = -1;
  for (let y = 0; y < xtf.header.cellH; y += 1) {
    for (let x = 0; x < xtf.header.cellW; x += 1) {
      if (
        readBitmapPixel(
          record,
          xtf.header.metadataBytes,
          xtf.header.rowStride,
          xtf.header.bpp,
          x,
          y,
        )
      ) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return bottom < 0 ? null : { top, bottom };
}

function firmwareVerticalCalibration(xtf: ParsedXtf) {
  // In FUN_4209810e's active external-font apply path, the firmware measures
  // exactly three samples: "align", "n", and U+6211 (我). It sums each run's
  // top and bottom ink rows, divides both sums by three, subtracts two from the
  // averaged top, and stores bottom-top as ctx+0x10. FUN_420aff66 uses the
  // averaged bottom (ctx+0x0a) for its 0x28e page-end test.
  const samples = ['align', 'n', '\u6211'];
  let topSum = 0;
  let bottomSum = 0;
  for (const sample of samples) {
    let runTop = xtf.header.cellH;
    let runBottom = -1;
    for (const character of Array.from(sample)) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      const resolved = resolveFirmwareGlyph(xtf, codePoint);
      if (resolved.generatedBox) {
        runTop = 0;
        runBottom = Math.max(runBottom, xtf.header.cellH - 1);
        continue;
      }
      if (!resolved.record) continue;
      const bounds = glyphInkVerticalBounds(resolved.record, xtf);
      if (!bounds) continue;
      runTop = Math.min(runTop, bounds.top);
      runBottom = Math.max(runBottom, bounds.bottom);
    }
    topSum += runBottom < 0 ? 0 : runTop;
    bottomSum += Math.max(0, runBottom);
  }
  const top = Math.trunc(topSum / samples.length) - 2;
  const bottom = Math.trunc(bottomSum / samples.length);
  return {
    top,
    bottom,
    height: Math.max(0, bottom - top),
  };
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
