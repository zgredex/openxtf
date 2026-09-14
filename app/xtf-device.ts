import type {
  FontBuildResult,
  FontPreviewResult,
  FontWorkerError,
} from './font-worker';
import { firmwareHyphenationPoints } from './v6315-hyphenation';
import { decodeV6315JpegGrayscale } from './v6315-jpeg';

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
  // Clipping is reported by diagnostics instead of blocking custom output.
  // This switch changes validation only, not any serialized appearance byte.
  strictCrop: false,
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
  inlineRuns?: Array<{
    text: string;
    bold: boolean;
    italic: boolean;
    tokenId?: number;
    embeddedControlsBefore?: Array<0x02 | 0x03 | 0x1c | 0x1d>;
    embeddedControlsAfter?: Array<0x02 | 0x03 | 0x1c | 0x1d>;
  }>;
  tag?: string;
  className?: string;
  breakAfter?: 'soft' | 'paragraph' | 'text-end';
  startsParagraph?: boolean;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  suppressIndent?: boolean;
  syntheticBold?: boolean;
  recordPrefix?: 0x01 | 0x1e;
  image?: {
    archivePath: string;
    mediaType: string;
    bytes: Uint8Array;
    width: number;
    height: number;
  };
};

export type DevicePreviewOptions = {
  layout?: Partial<DeviceLayoutSettings>;
  blocks?: DevicePreviewBlock[];
  skippedEmptyBlocks?: number;
  documentLanguage?: string;
};

export const DEFAULT_DEVICE_LAYOUT_SETTINGS: DeviceLayoutSettings = {
  lineSpacing: 1.2,
  paragraphRatio: 1.5,
  indentChars: 2,
  alignMode: 'wrap-align',
};

// V6.3.15's specialized .xtf reader (ELF 0x42098106/0x420dcddc) uses a
// 22 px top origin and the symmetric screen-height - 22 lower origin. Auto
// spacing distributes the page's actual visual-line records over this span.
const V6315_SCREEN_WIDTH = 480;
const V6315_SCREEN_HEIGHT = 800;
const V6315_FIRST_LINE_Y = 22;
const V6315_LAST_LINE_Y = V6315_SCREEN_HEIGHT - 22;
const V6315_AUTO_VERTICAL_SPAN =
  V6315_LAST_LINE_Y - V6315_FIRST_LINE_Y;
// Before float-to-int conversion the painter adds this exact binary32 value
// (0x3f7d70a4), then truncates.
const V6315_DRAW_ROUNDING_BIAS = Math.fround(0.99);
// The manual-capacity branch reserves 17 px at the bottom of the framebuffer.
const V6315_MANUAL_BOTTOM_RESERVE = 17;

const HEADER_SIZE = 64;
const FLAG_GLYPH_METADATA = 0x02;

type FirmwareParagraphMode = 0 | 1 | 2 | 3 | 4;

function firmwareParagraphMode(
  paragraphRatio: DeviceParagraphRatio,
): FirmwareParagraphMode {
  switch (paragraphRatio) {
    case 1:
      return 0;
    case 1.25:
      return 1;
    case 1.5:
      return 2;
    case 1.75:
      return 3;
    case 2:
      return 4;
  }
}

function firmwareHorizontalGeometry(
  paragraphMode: FirmwareParagraphMode,
) {
  // ELF 0x42098106 derives all three values from the byte persisted under the
  // `paraRatioLS` key. The decompiler displays the interior pointer as
  // "RatioLS". The signed mode-2 offset belongs to the right edge/width; the
  // painter still starts at the 11 px inset.
  if (paragraphMode === 0) {
    return { inset: 18, signedOffset: 0, contentWidth: 444 };
  }
  if (paragraphMode === 1 || paragraphMode === 3) {
    return { inset: 13, signedOffset: 0, contentWidth: 454 };
  }
  if (paragraphMode === 2) {
    return { inset: 11, signedOffset: -12, contentWidth: 446 };
  }
  return { inset: 11, signedOffset: 0, contentWidth: 458 };
}

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
  crcData: number;
  crcHeader: number;
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
  | 'zero-width';

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
  tokenId: number;
  clusterId: number;
  layoutAdvance: number;
  glyph: ResolvedGlyph;
  inlineBold: boolean;
  inlineItalic: boolean;
  embeddedControlsBefore: Array<0x02 | 0x03 | 0x1c | 0x1d>;
  embeddedControlsAfter: Array<0x02 | 0x03 | 0x1c | 0x1d>;
};

type FirmwareInlineControl = {
  recordOffset: number;
  byte: 0x02 | 0x03 | 0x1c | 0x1d;
  kind: 'bold-start' | 'bold-end' | 'italic-start' | 'italic-end';
};

type PlannedLine = {
  kind: 'text';
  glyphs: PlannedGlyph[];
  layoutWidth: number;
  baseWidth: number;
  breakReason: 'automatic' | 'soft' | 'paragraph' | 'text-end';
  paragraphIndex: number;
  indent: number;
  textAlign?: DevicePreviewBlock['textAlign'];
  syntheticBold: boolean;
  recordPrefix?: 0x01 | 0x1e;
  sourceTag?: string;
  sourceClass?: string;
  inlineControls: FirmwareInlineControl[];
  lastConsumedSourceIndex: number;
};

type PlannedImage = {
  kind: 'image';
  paragraphIndex: number;
  archivePath: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  decodedWidth: number;
  decodedHeight: number;
  ditherPhaseStart?: number;
  ditherPhaseEnd?: number;
  levels: Uint8Array | null;
  rasterModel:
    | 'xtg-exact'
    | 'png-v6315'
    | 'bmp-v6315'
    | 'jpeg-v6315'
    | 'jpeg-browser';
  placeholder: boolean;
  lastConsumedSourceIndex: number;
};

type PlannedRecord = PlannedLine | PlannedImage;

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
  const targetAdvanceY = byteSettingAllowZero(settings.advanceY, 'advanceY');
  const targetFullWidth = byteSetting(settings.fullWidth, 'fullWidth');
  const targetAsciiWidth = byteSetting(settings.asciiWidth, 'asciiWidth');
  const targetSpaceWidth = byteSettingAllowZero(
    settings.spaceWidth,
    'spaceWidth',
  );
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

  const storedSpace = targetSpaceWidth;
  if (source.header.asciiWidthCount > 0) {
    output[source.header.asciiWidthOffset] = storedSpace;
  }
  patchStoredAdvance(output, source, 0x20, storedSpace, targetBytesPerGlyph);
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
    effectiveSpace: storedSpace || targetAsciiWidth,
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

export async function renderXtfDevicePreview(
  bytes: Uint8Array | ArrayBuffer,
  text: string,
  rasterSize: number,
  options: DevicePreviewOptions = {},
): Promise<FontPreviewResult> {
  const xtf = parseXtf(bytes);
  const width = V6315_SCREEN_WIDTH;
  const height = V6315_SCREEN_HEIGHT;
  const layout: DeviceLayoutSettings = {
    ...DEFAULT_DEVICE_LAYOUT_SETTINGS,
    ...options.layout,
  };
  const paragraphMode = firmwareParagraphMode(layout.paragraphRatio);
  const firmwareLanguage = normalizeFirmwareLanguage(
    options.documentLanguage || 'und',
  );
  const hyphenationDictionary = firmwareHasHyphenationDictionary(
    firmwareLanguage,
  );
  const horizontalGeometry = firmwareHorizontalGeometry(paragraphMode);
  // ELF 0x42042514 returns XTF advanceY (header 0x0c), falling back to cellH
  // only when advanceY is zero. Manual choices multiply that effective base
  // by lineSpacingLS. Auto uses it to establish pagination capacity before
  // PaintPageTextV6315 redistributes the selected page records below.
  const effectiveBaseAdvanceY =
    xtf.header.advanceY || xtf.header.cellH;
  const lineSpacingFactor = layout.lineSpacing === 'auto' ? 1 : layout.lineSpacing;
  const firmwareLineSpacingFactor = Math.fround(lineSpacingFactor);
  const firmwareParagraphRatio = Math.fround(layout.paragraphRatio);
  const autoPagination = firmwareAutoPagination(
    effectiveBaseAdvanceY,
    paragraphMode,
  );
  const initialLineAdvance =
    layout.lineSpacing === 'auto'
      ? autoPagination.lineAdvance
      : Math.fround(
          Math.fround(effectiveBaseAdvanceY) * firmwareLineSpacingFactor,
        );
  const maximumWholeLines =
    layout.lineSpacing === 'auto'
      ? autoPagination.maximumLines
      : firmwareManualMaximumLines(
          effectiveBaseAdvanceY,
          initialLineAdvance,
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
  const left = horizontalGeometry.inset;
  const right = left + horizontalGeometry.contentWidth;
  const top = V6315_FIRST_LINE_Y;
  const bottom = V6315_LAST_LINE_Y;
  const contentWidth = right - left;
  const contentHeight = V6315_AUTO_VERTICAL_SPAN;
  const firstLineY = V6315_FIRST_LINE_Y;
  const lines: NonNullable<FontPreviewResult['device']>['lines'] = [];
  const glyphs: NonNullable<FontPreviewResult['device']>['glyphs'] = [];

  const previewBlocks = normalizePreviewBlocks(text, options.blocks);
  const sourceCharacters: string[] = [];
  const plannedRecords: PlannedRecord[] = [];
  const jpegDitherState = { phase: 0 };
  let sourceIndex = 0;
  for (let paragraphIndex = 0; paragraphIndex < previewBlocks.length; paragraphIndex += 1) {
    const block = previewBlocks[paragraphIndex];
    if (block.image) {
      plannedRecords.push(
        await prepareFirmwareImageRecord(
          block.image,
          paragraphIndex,
          contentWidth,
          initialLineAdvance,
          jpegDitherState,
        ),
      );
      continue;
    }
    const paragraphGlyphs: PlannedGlyph[] = [];
    const styledCharacters = firmwareStyledTokens(block);
    for (const styledCharacter of styledCharacters) {
      const { character } = styledCharacter;
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      sourceCharacters.push(character);

      // ELF FUN_420d7794 serializes soft hyphen as internal byte 0x06 and
      // NBSP as byte 0x07. The active XTF path measures and paints those
      // internal one-byte values through asciiWidth/fallback unless its
      // separate dictionary branch replaces a selected break with '-'. The
      // EPUB tokenizer has already collapsed TAB/LF/CR/U+0020 to U+0020.
      const recordCodePoint =
        codePoint === 0x00ad ? 0x06 : codePoint === 0x00a0 ? 0x07 : codePoint;
      const glyphCodePoint = codePoint === 0x09 ? 0x20 : recordCodePoint;
      const glyph = resolveFirmwareGlyph(xtf, glyphCodePoint);
      if (glyph.missing && !isLayoutWhitespace(codePoint)) {
        missingCodePoints.add(codePoint);
      }
      paragraphGlyphs.push({
        character,
        codePoint,
        sourceIndex,
        tokenId: styledCharacter.tokenId,
        clusterId: styledCharacter.clusterId,
        layoutAdvance: firmwareLayoutAdvance(
          xtf,
          codePoint === 0x00a0 ? 0x20 : glyphCodePoint,
          glyph.record,
        ),
        glyph,
        inlineBold: styledCharacter.bold,
        inlineItalic: styledCharacter.italic,
        embeddedControlsBefore: styledCharacter.embeddedControlsBefore,
        embeddedControlsAfter: styledCharacter.embeddedControlsAfter,
      });
      sourceIndex += 1;
    }
    const suppressIndent =
      block.suppressIndent ||
      block.textAlign === 'center' ||
      /^h[1-6]$/.test(block.tag || '');
    const firstCodePoint = paragraphGlyphs[0]?.codePoint;
    let indentPixels = 0;
    if (
      !suppressIndent &&
      block.startsParagraph !== false &&
      firstCodePoint !== undefined &&
      firstCodePoint !== 0x20 &&
      firstCodePoint !== 0x3000
    ) {
      // FUN_4207176c serializes the first-line indent into the record itself.
      // A CJK-classified run gets one/two U+3000 glyphs according to the
      // persisted device selector. The non-CJK route uses two ASCII spaces.
      const cjkIndent = firmwareUsesCjkIndent(block.text);
      const indentCodePoint = cjkIndent ? 0x3000 : 0x20;
      const indentCount = cjkIndent ? layout.indentChars : 2;
      const indentRecord = recordForCodePoint(xtf, indentCodePoint);
      const indentGlyph = resolveFirmwareGlyph(xtf, indentCodePoint);
      const indentAdvance = firmwareLayoutAdvance(
        xtf,
        indentCodePoint,
        indentRecord,
      );
      const inserted: PlannedGlyph[] = Array.from(
        { length: indentCount },
        (_, indentIndex) => ({
          character: String.fromCodePoint(indentCodePoint),
          codePoint: indentCodePoint,
          sourceIndex: -1,
          // FUN_4207176c inserts the indent bytes into the first text token;
          // they are not an independent token or a late painter offset.
          tokenId: paragraphGlyphs[0]?.tokenId ?? -1,
          clusterId: -1 - indentIndex,
          layoutAdvance: indentAdvance,
          glyph: indentGlyph,
          inlineBold: paragraphGlyphs[0]?.inlineBold ?? false,
          inlineItalic: paragraphGlyphs[0]?.inlineItalic ?? false,
          embeddedControlsBefore: [],
          embeddedControlsAfter: [],
        }),
      );
      paragraphGlyphs.unshift(...inserted);
      indentPixels = indentAdvance * indentCount;
      if (indentGlyph.missing) missingCodePoints.add(indentCodePoint);
    }
    planFirmwareLines(
      xtf,
      paragraphGlyphs,
      paragraphIndex,
      indentPixels,
      contentWidth,
      block.textAlign,
      block.breakAfter ??
        (paragraphIndex < previewBlocks.length - 1 ? 'paragraph' : 'text-end'),
      Boolean(block.syntheticBold),
      block.recordPrefix,
      block.tag,
      block.className,
      layout.alignMode,
      firmwareLanguage,
      plannedRecords,
    );
  }
  if (!plannedRecords.length) {
    plannedRecords.push({
      kind: 'text',
      glyphs: [],
      layoutWidth: 0,
      baseWidth: 0,
      breakReason: 'text-end',
      paragraphIndex: 0,
      indent: 0,
      syntheticBold: false,
      sourceTag: 'body',
      sourceClass: '',
      inlineControls: [],
      lastConsumedSourceIndex: -1,
    });
  }

  const pageFit = selectFirmwarePageRecords(
    plannedRecords,
    layout.lineSpacing,
    initialLineAdvance,
    firmwareParagraphRatio,
    maximumWholeLines,
  );
  const visibleRecords = pageFit.records;
  const paragraphBoundaryCount = countFirmwareParagraphBoundaries(
    visibleRecords,
  );
  const normalBoundaryCount = Math.max(
    0,
    visibleRecords.length - 1 - paragraphBoundaryCount,
  );
  const weightedIntervals = Math.fround(
    Math.fround(normalBoundaryCount) +
      Math.fround(
        Math.fround(paragraphBoundaryCount) * firmwareParagraphRatio,
      ),
  );
  const imageHeightSum = visibleRecords.reduce(
    (sum, record) =>
      record.kind === 'image'
        ? Math.fround(sum + Math.fround(record.height))
        : sum,
    Math.fround(0),
  );
  const autoDistributed =
    layout.lineSpacing === 'auto' &&
    visibleRecords.length > 1 &&
    imageHeightSum <= 0;
  const lineAdvance = autoDistributed
    ? Math.fround(
        Math.fround(V6315_AUTO_VERTICAL_SPAN) / weightedIntervals,
      )
    : initialLineAdvance;
  const paragraphAdvance = Math.fround(
    lineAdvance * firmwareParagraphRatio,
  );
  const paragraphExtra = Math.fround(paragraphAdvance - lineAdvance);

  let penYFloat = Math.fround(firstLineY);
  let renderedSourceIndex = -1;
  let textLineIndex = 0;
  const images: NonNullable<FontPreviewResult['device']>['images'] = [];
  for (let recordIndex = 0; recordIndex < visibleRecords.length; recordIndex += 1) {
    const record = visibleRecords[recordIndex];
    renderedSourceIndex = Math.max(
      renderedSourceIndex,
      record.lastConsumedSourceIndex,
    );
    if (recordIndex > 0) {
      const previous = visibleRecords[recordIndex - 1];
      penYFloat = Math.fround(
        penYFloat +
          (isFirmwareParagraphBoundary(previous, record)
            ? paragraphAdvance
            : lineAdvance),
      );
    }
    const penY = firmwareDrawCoordinate(penYFloat);
    if (record.kind === 'image') {
      const nextRecord = visibleRecords[recordIndex + 1];
      const followingTransition = nextRecord
        ? isFirmwareParagraphBoundary(record, nextRecord)
          ? paragraphAdvance
          : lineAdvance
        : 0;
      const drawOffsetY = firmwareImageDrawOffset(
        recordIndex,
        followingTransition,
        penY,
        record.height,
        effectiveBaseAdvanceY,
      );
      const drawY = penY + drawOffsetY;
      const drawX = left + Math.trunc((contentWidth - record.width) / 2);
      paintFirmwareImage(
        frame,
        owners,
        collisionRows,
        collisionMask,
        width,
        height,
        drawX,
        drawY,
        recordIndex,
        record,
      );
      images.push({
        index: images.length,
        recordIndex,
        archivePath: record.archivePath,
        sourceWidth: record.sourceWidth,
        sourceHeight: record.sourceHeight,
        x: drawX,
        y: drawY,
        width: record.width,
        height: record.height,
        decodedWidth: record.decodedWidth,
        decodedHeight: record.decodedHeight,
        ditherPhaseStart: record.ditherPhaseStart,
        ditherPhaseEnd: record.ditherPhaseEnd,
        drawOffsetY,
        rasterModel: record.rasterModel,
        placeholder: record.placeholder,
        frameClipped:
          drawX < 0 ||
          drawY < 0 ||
          drawX + record.width > width ||
          drawY + record.height > height,
      });
      penYFloat = Math.fround(penYFloat + Math.fround(record.height));
      continue;
    }
    const line = record;
    const lineIndex = textLineIndex;
    textLineIndex += 1;

    const availableWidth = contentWidth;
    const effectiveAlign =
      line.textAlign === 'center'
        ? 'center'
        : layout.alignMode === 'left'
          ? 'left'
          : 'wrap-align';
    const horizontal = firmwareHorizontalLayout(
      xtf,
      line,
      availableWidth,
      effectiveAlign,
    );
    const inkRunWidth = horizontal.extent;
    const usedWidth = inkRunWidth;
    const nextRecord = visibleRecords[recordIndex + 1];
    const transitionAdvance =
      nextRecord && isFirmwareParagraphBoundary(line, nextRecord)
        ? paragraphAdvance
        : lineAdvance;
    const truncatedAfterLine =
      recordIndex === visibleRecords.length - 1 &&
      visibleRecords.length < plannedRecords.length;
    lines.push({
      index: lineIndex,
      top: penY,
      baseline: penY,
      characterCount: line.glyphs.length,
      text: line.glyphs.map((glyph) => glyph.character).join(''),
      layoutWidth: line.layoutWidth,
      baseWidth: line.baseWidth,
      preJustifyWidth: horizontal.preJustifyExtent,
      justificationPixels: horizontal.justificationPixels,
      justifiedGaps: horizontal.justifiedGaps,
      placementBranch: horizontal.branch,
      placementBypassReason: horizontal.bypassReason,
      terminalAdjustmentPixels: horizontal.terminalAdjustmentPixels,
      trailingAsciiReservePixels: horizontal.trailingAsciiReservePixels,
      usedWidth,
      // Keep this signed. A negative value is the exact amount by which the
      // firmware placement extends past the content width; clamping it would
      // conceal the out-of-bounds condition diagnostics are meant to expose.
      remainingWidth: contentWidth - usedWidth,
      breakReason: truncatedAfterLine ? 'page-end' : line.breakReason,
      lineAdvance: transitionAdvance,
      indent: line.indent,
      alignment: effectiveAlign,
      requestedAlignment:
        line.textAlign === 'center' ? 'center' : layout.alignMode,
      recordPrefixByte: line.recordPrefix ?? null,
      recordSuffixBytes:
        line.breakReason === 'soft'
          ? [0x05, 0x0a]
          : line.breakReason === 'paragraph'
            ? [0x0a]
            : [],
      inlineControlBytes: line.inlineControls,
      endOfSourceFlag: line.breakReason === 'text-end',
      pageStop: truncatedAfterLine,
      syntheticBold: line.syntheticBold,
      sourceTag: line.sourceTag,
      sourceClass: line.sourceClass,
    });

    const penX =
      effectiveAlign === 'center'
        ? Math.max(left, Math.trunc((width - inkRunWidth) / 2))
        : left;
    for (let glyphIndex = 0; glyphIndex < line.glyphs.length; glyphIndex += 1) {
      const planned = line.glyphs[glyphIndex];
      const resolved = planned.glyph;
      const baseAdvance =
        horizontal.baseAdvances[glyphIndex] ?? resolved.advance;
      const originX = Math.round(penX + horizontal.offsets[glyphIndex]);
      const originY = Math.round(penY);
      const gapAfter = horizontal.gapAfter[glyphIndex] ?? 0;
      const allocatedAdvance = baseAdvance + gapAfter;
      const rawInkBounds = resolved.generatedBox
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
      const inkBounds = rawInkBounds && line.syntheticBold
        ? { ...rawInkBounds, width: rawInkBounds.width + 1 }
        : rawInkBounds;
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
        layoutAdvance: planned.layoutAdvance,
        baseAdvance,
        justificationExtra: gapAfter,
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
        if (line.syntheticBold) {
          paintGeneratedBox(
            frame,
            owners,
            collisionRows,
            collisionMask,
            width,
            height,
            originX + 1,
            originY,
            lineIndex,
            xtf,
          );
        }
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
        if (line.syntheticBold) {
          paintGlyph(
            frame,
            owners,
            collisionRows,
            collisionMask,
            width,
            height,
            originX + resolved.xOffset + 1,
            originY,
            lineIndex,
            xtf,
            resolved.record,
          );
        }
      }
      renderedSourceIndex = Math.max(
        renderedSourceIndex,
        planned.sourceIndex,
      );
    }
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

  const spaceRecord = recordForCodePoint(xtf, 0x20);
  const normalSpaceAdvance = firmwareLayoutAdvance(
    xtf,
    0x20,
    spaceRecord,
  );
  const spaces = [0x20, 0x00a0, 0x3000, 0x09].map((codePoint) => {
    if (codePoint === 0x09) {
      return {
        codePoint,
        // The EPUB tokenizer collapses TAB with LF/CR/U+0020 and serializes
        // the resulting whitespace token as one U+0020. The separate
        // plain-text reader's 4/2-space expansion is not part of this preview.
        recordCodePoint: 0x20,
        compositionAdvance: normalSpaceAdvance,
        paintAdvance: normalSpaceAdvance,
        emptyLineAdvance: normalSpaceAdvance,
        nonEmptyLineAdvance: normalSpaceAdvance,
        stored: spaceRecord !== null,
        advanceSource: 'ascii-table' as const,
        fallbackSource: 'direct' as const,
      };
    }
    const recordCodePoint = codePoint === 0x00a0 ? 0x07 : codePoint;
    const record = recordForCodePoint(xtf, recordCodePoint);
    const resolved = resolveFirmwareGlyph(xtf, recordCodePoint);
    return {
      codePoint,
      recordCodePoint,
      compositionAdvance:
        codePoint === 0x00a0
          ? normalSpaceAdvance
          : firmwareLayoutAdvance(xtf, codePoint, record),
      paintAdvance: resolved.advance,
      stored: record !== null,
      advanceSource: resolved.advanceSource,
      fallbackSource: resolved.fallbackSource,
    };
  });
  const hiddenCharacters = sourceCharacters
    .slice(renderedSourceIndex + 1)
    .filter((character) => character !== '\n');
  const remainingCharacters = hiddenCharacters.length;
  const usedHeight = pageFit.budget;
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
      images,
      spaces,
      xtfHeader: {
        flags: xtf.header.flags,
        metadataBytes: xtf.header.metadataBytes,
        bpp: xtf.header.bpp,
        cellW: xtf.header.cellW,
        cellH: xtf.header.cellH,
        storedAdvanceY: xtf.header.advanceY,
        effectiveAdvanceY: effectiveBaseAdvanceY,
        advanceYFallback: xtf.header.advanceY === 0,
        fullWidth: xtf.header.fullWidth,
        asciiWidth: xtf.header.asciiWidth,
        ascender: xtf.header.ascender,
        descender: xtf.header.descender,
        rowStride: xtf.header.rowStride,
        bytesPerGlyph: xtf.header.bytesPerGlyph,
        glyphCount: xtf.header.glyphCount,
        rangeCount: xtf.header.rangeCount,
        crcData: xtf.header.crcData,
        crcHeader: xtf.header.crcHeader,
      },
      layout: {
        margin: horizontalGeometry.inset,
        horizontalOffset: horizontalGeometry.signedOffset,
        paragraphMode,
        contentWidth,
        contentHeight,
        paragraphExtra,
        maximumWholeLines,
        lineSpacing: layout.lineSpacing,
        lineSpacingFactor,
        initialLineAdvance,
        lineAdvance,
        paragraphRatio: layout.paragraphRatio,
        paragraphAdvance,
        autoDistributed,
        imageHeightSum,
        autoDistributionSuppressedByImages:
          layout.lineSpacing === 'auto' && imageHeightSum > 0,
        weightedIntervals,
        normalBoundaryCount,
        paragraphBoundaryCount,
        pageFitMode: pageFit.mode,
        pageFitBudget: pageFit.budget,
        pageFitLimit: pageFit.limit,
        recordsRemovedByPageFit: pageFit.removed,
        blankLineRecords: visibleRecords.filter(
          (record) => record.kind === 'text' && record.glyphs.length === 0,
        ).length,
        indentChars: layout.indentChars,
        cjkIndentPixels: xtf.header.fullWidth * layout.indentChars,
        nonCjkIndentPixels: normalSpaceAdvance * 2,
        alignMode: layout.alignMode,
        skippedEmptyBlocks: options.skippedEmptyBlocks ?? 0,
        documentLanguage: options.documentLanguage || 'und',
        firmwareLanguage,
        hyphenationDictionary,
        hyphenationEnabled:
          layout.alignMode !== 'left' && hyphenationDictionary,
        firstLineY,
        lastLineY: V6315_LAST_LINE_Y,
        drawRoundingBias: V6315_DRAW_ROUNDING_BIAS,
        readingSurfaceHeight: V6315_AUTO_VERTICAL_SPAN,
      },
      collisionDataUrl,
      pageUsage: {
        // Synthetic indent glyphs (sourceIndex -1) are not source characters.
        // Count each visible source index once so
        // this diagnostic cannot imply that source data was duplicated.
        displayedCharacters: new Set(
          visibleRecords.flatMap((record) =>
            record.kind === 'text'
              ? record.glyphs
                  .map((glyph) => glyph.sourceIndex)
                  .filter((index) => index >= 0)
              : [],
          ),
        ).size,
        totalCharacters: sourceCharacters.length,
        remainingCharacters,
        displayedRecords: visibleRecords.length,
        totalRecords: plannedRecords.length,
        remainingRecords: plannedRecords.length - visibleRecords.length,
        truncated:
          remainingCharacters > 0 || visibleRecords.length < plannedRecords.length,
        lastVisibleCharacter:
          renderedSourceIndex >= 0 ? sourceCharacters[renderedSourceIndex] : '',
        firstHiddenCharacter: hiddenCharacters[0] ?? '',
        usedHeight,
        remainingHeight: Math.max(0, contentHeight - usedHeight),
      },
    },
  };
}

async function prepareFirmwareImageRecord(
  image: NonNullable<DevicePreviewBlock['image']>,
  paragraphIndex: number,
  contentWidth: number,
  lineStep: number,
  jpegDitherState: { phase: number },
): Promise<PlannedImage> {
  const defaultHeight = firmwareDefaultImageHeight(lineStep);
  const imageType = firmwareRasterImageType(image.bytes, image.mediaType);
  const scaled = imageType === 'bmp'
    ? firmwareBmpCacheDimensions(
        image.width,
        image.height,
        contentWidth,
        defaultHeight,
      )
    : firmwareScaleImageDimensions(
        image.width,
        image.height,
        contentWidth,
        defaultHeight,
      );
  let levels: Uint8Array | null = null;
  let decodedWidth = 0;
  let decodedHeight = 0;
  let ditherPhaseStart: number | undefined;
  let ditherPhaseEnd: number | undefined;
  let rasterModel: PlannedImage['rasterModel'] = 'jpeg-browser';
  if (scaled && image.bytes.length) {
    const decoded = await decodeBrowserImageLevels(
      image.bytes,
      image.mediaType,
      image.width,
      image.height,
      contentWidth,
      defaultHeight,
      scaled.width,
      scaled.height,
      jpegDitherState,
    );
    levels = decoded?.levels ?? null;
    if (decoded) {
      rasterModel = decoded.rasterModel;
      decodedWidth = decoded.decodedWidth;
      decodedHeight = decoded.decodedHeight;
      ditherPhaseStart = decoded.ditherPhaseStart;
      ditherPhaseEnd = decoded.ditherPhaseEnd;
    }
  }
  const height = scaled?.height ?? defaultHeight;
  const placeholder = levels === null;
  const width = placeholder
    ? firmwarePlaceholderImageWidth(contentWidth, height, lineStep)
    : scaled?.width ?? contentWidth;
  return {
    kind: 'image',
    paragraphIndex,
    archivePath: image.archivePath,
    sourceWidth: image.width,
    sourceHeight: image.height,
    width,
    height,
    decodedWidth,
    decodedHeight,
    ditherPhaseStart,
    ditherPhaseEnd,
    levels,
    rasterModel,
    placeholder,
    lastConsumedSourceIndex: -1,
  };
}

function firmwareDefaultImageHeight(lineStep: number) {
  // FUN_42094246: max(round(FUN_420941ec() * 0.8), round(lineStep)), min 1.
  // With the normal no-footer X4 surface FUN_420941ec is 800 - 22 - 17.
  const available = V6315_SCREEN_HEIGHT - V6315_FIRST_LINE_Y -
    V6315_MANUAL_BOTTOM_RESERVE;
  return Math.max(
    1,
    firmwareRoundPositive(Math.fround(Math.fround(available) * Math.fround(0.8))),
    firmwareRoundPositive(lineStep),
  );
}

function firmwareScaleImageDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
) {
  // FUN_42052456/FUN_420ce0d0 never upscale. If either source dimension is
  // too large they use the smaller ratio, add 0.5f, convert to unsigned and
  // clamp each result to at least one and to its target bound.
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    maximumWidth < 1 ||
    maximumHeight < 1
  ) {
    return null;
  }
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceWidth > maximumWidth || sourceHeight > maximumHeight) {
    let scale = Math.fround(
      Math.min(
        Math.fround(maximumWidth / sourceWidth),
        Math.fround(maximumHeight / sourceHeight),
      ),
    );
    if (!(scale > 0)) scale = Math.fround(1);
    width = Math.max(
      1,
      firmwareRoundPositive(Math.fround(Math.fround(sourceWidth) * scale)),
    );
    height = Math.max(
      1,
      firmwareRoundPositive(Math.fround(Math.fround(sourceHeight) * scale)),
    );
  }
  return {
    width: Math.min(maximumWidth, width),
    height: Math.min(maximumHeight, height),
  };
}

function firmwareBmpCacheDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
) {
  // The BMP arm of FUN_420cdf7e does not receive the aspect-fit dimensions.
  // FUN_420a8d52 centers an undersized bitmap and crops an oversized one;
  // FUN_420ce0d0 then writes only the intersecting rectangle to XTG.
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    maximumWidth < 1 ||
    maximumHeight < 1
  ) {
    return null;
  }
  return {
    width: Math.min(sourceWidth, maximumWidth),
    height: Math.min(sourceHeight, maximumHeight),
  };
}

function firmwareRoundPositive(value: number) {
  return Math.trunc(Math.fround(Math.fround(value) + Math.fround(0.5)));
}

function firmwarePlaceholderImageWidth(
  contentWidth: number,
  imageHeight: number,
  lineStep: number,
) {
  // PaintPageTextV6315's failed-cache branch normally uses the whole content
  // span. For a very short image (no taller than the rounded line step) it
  // substitutes a square no wider than the content span and centres it.
  return imageHeight <= firmwareRoundPositive(lineStep)
    ? Math.min(contentWidth, imageHeight)
    : contentWidth;
}

type DecodedFirmwareImage = {
  levels: Uint8Array;
  rasterModel: PlannedImage['rasterModel'];
  decodedWidth: number;
  decodedHeight: number;
  ditherPhaseStart?: number;
  ditherPhaseEnd?: number;
};

async function decodeBrowserImageLevels(
  bytes: Uint8Array,
  mediaType: string,
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
  width: number,
  height: number,
  jpegDitherState: { phase: number },
): Promise<DecodedFirmwareImage | null> {
  const xtgLevels = decodePlainXtgLevels(bytes, width, height);
  if (xtgLevels) {
    return {
      levels: xtgLevels,
      rasterModel: 'xtg-exact' as const,
      decodedWidth: width,
      decodedHeight: height,
    };
  }
  const type = firmwareRasterImageType(bytes, mediaType);
  if (type === 'unknown' || type === 'xtg') return null;
  if (type === 'bmp') {
    const levels = decodeFirmwareBmpLevels(
      bytes,
      sourceWidth,
      sourceHeight,
      maximumWidth,
      maximumHeight,
      width,
      height,
    );
    return levels
      ? {
          levels,
          rasterModel: 'bmp-v6315' as const,
          decodedWidth: width,
          decodedHeight: height,
        }
      : null;
  }
  if (type === 'jpeg') {
    try {
      const fitByWidth =
        Math.fround(maximumWidth / sourceWidth) <=
        Math.fround(maximumHeight / sourceHeight);
      const decoded = await decodeV6315JpegGrayscale(
        bytes,
        width,
        height,
        fitByWidth,
      );
      if (decoded) {
        const ditherPhaseStart = jpegDitherState.phase;
        const tightLuminance = new Uint8Array(decoded.width * decoded.height);
        for (let y = 0; y < decoded.height; y += 1) {
          tightLuminance.set(
            decoded.luminance.subarray(
              y * width,
              y * width + decoded.width,
            ),
            y * decoded.width,
          );
        }
        const dithered = ditherFirmwareJpegOneBit(
          tightLuminance,
          decoded.width,
          decoded.height,
          jpegDitherState.phase,
        );
        jpegDitherState.phase = dithered.finalPhase;
        const levels = new Uint8Array(width * height);
        for (let y = 0; y < decoded.height; y += 1) {
          levels.set(
            dithered.levels.subarray(
              y * decoded.width,
              (y + 1) * decoded.width,
            ),
            y * width,
          );
        }
        return {
          levels,
          rasterModel: 'jpeg-v6315' as const,
          decodedWidth: decoded.width,
          decodedHeight: decoded.height,
          ditherPhaseStart,
          ditherPhaseEnd: dithered.finalPhase,
        };
      }
    } catch {
      // A browser without WebAssembly or a failed asset request falls through
      // to the explicitly labelled browser JPEG approximation below.
    }
  }
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes.slice().buffer], {
        type: /^image\//i.test(mediaType) ? mediaType : undefined,
      }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, sourceWidth, sourceHeight);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, sourceWidth, sourceHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
    const rgba = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
    if (type === 'png') {
      const levels = decodeFirmwarePngLevels(
        rgba,
        sourceWidth,
        sourceHeight,
        maximumWidth,
        maximumHeight,
        width,
        height,
      );
      return levels
        ? {
            levels,
            rasterModel: 'png-v6315' as const,
            decodedWidth: width,
            decodedHeight: height,
          }
        : null;
    }
    const ditherPhaseStart = jpegDitherState.phase;
    const luminance = decodeFirmwareJpegModelLuminance(
      rgba,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );
    const dithered = ditherFirmwareJpegOneBit(
      luminance,
      width,
      height,
      ditherPhaseStart,
    );
    jpegDitherState.phase = dithered.finalPhase;
    return {
      levels: dithered.levels,
      rasterModel: 'jpeg-browser' as const,
      decodedWidth: width,
      decodedHeight: height,
      ditherPhaseStart,
      ditherPhaseEnd: dithered.finalPhase,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

type FirmwareRasterImageType = 'xtg' | 'png' | 'bmp' | 'jpeg' | 'unknown';

function firmwareRasterImageType(
  bytes: Uint8Array,
  mediaType: string,
): FirmwareRasterImageType {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x58 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x47 &&
    bytes[3] === 0x00
  ) return 'xtg';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (/png/i.test(mediaType)) return 'png';
  if (/bmp/i.test(mediaType)) return 'bmp';
  if (/jpe?g/i.test(mediaType)) return 'jpeg';
  if (/xtg/i.test(mediaType)) return 'xtg';
  return 'unknown';
}

function firmwarePngLuminance(
  rgba: Uint8ClampedArray,
  pixelIndex: number,
) {
  const offset = pixelIndex * 4;
  const alpha = rgba[offset + 3];
  let red = rgba[offset];
  let green = rgba[offset + 1];
  let blue = rgba[offset + 2];
  // The active EPUB call disables alpha skipping and selects the
  // FUN_42053846 white-background blend.
  if (alpha !== 255) {
    const white = (255 - alpha) * 255;
    red = (red * alpha + white) >> 8;
    green = (green * alpha + white) >> 8;
    blue = (blue * alpha + white) >> 8;
  }
  return (red * 0x4d + green * 0x96 + blue * 0x1d) >> 8;
}

function firmwareOpaqueLuminance(
  rgba: Uint8ClampedArray,
  pixelIndex: number,
) {
  const offset = pixelIndex * 4;
  return (
    (rgba[offset] * 0x4d +
      rgba[offset + 1] * 0x96 +
      rgba[offset + 2] * 0x1d) >>
    8
  );
}

function decodeFirmwarePngLevels(
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
  cacheWidth: number,
  cacheHeight: number,
) {
  const widthRatio = Math.trunc((maximumWidth * 0x10000) / sourceWidth);
  const heightRatio = Math.trunc((maximumHeight * 0x10000) / sourceHeight);
  let ratio = Math.min(widthRatio, heightRatio);
  if (ratio >= 0xfffa) ratio = 0x10000;
  const drawWidth = Math.min(
    cacheWidth,
    Math.trunc((sourceWidth * ratio) / 0x10000),
  );
  const drawHeight = Math.min(
    cacheHeight,
    Math.trunc((sourceHeight * ratio) / 0x10000),
  );
  if (drawWidth < 1 || drawHeight < 1) return null;

  const sums = new Uint32Array(drawWidth * drawHeight);
  const counts = new Uint32Array(drawWidth * drawHeight);
  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    const targetY = Math.trunc((sourceY * ratio) / 0x10000);
    if (targetY >= drawHeight) continue;
    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      const targetX = Math.trunc((sourceX * ratio) / 0x10000);
      if (targetX >= drawWidth) continue;
      const targetIndex = targetY * drawWidth + targetX;
      sums[targetIndex] += firmwarePngLuminance(
        rgba,
        sourceY * sourceWidth + sourceX,
      );
      counts[targetIndex] += 1;
    }
  }
  const luminance = new Uint8Array(drawWidth * drawHeight);
  for (let index = 0; index < luminance.length; index += 1) {
    const count = counts[index];
    if (!count) {
      luminance[index] = 255;
      continue;
    }
    const reciprocal = Math.trunc((0x10000 + (count >> 1)) / count);
    luminance[index] = Math.min(255, (sums[index] * reciprocal) >> 16);
  }

  const drawOriginX = Math.trunc((maximumWidth - drawWidth) / 2);
  const drawOriginY = Math.trunc((maximumHeight - drawHeight) / 2);
  const cacheOriginX = Math.trunc((maximumWidth - cacheWidth) / 2);
  const cacheOriginY = Math.trunc((maximumHeight - cacheHeight) / 2);
  const offsetX = drawOriginX - cacheOriginX;
  const offsetY = drawOriginY - cacheOriginY;
  const dithered = ditherFirmwareOneBit(
    luminance,
    drawWidth,
    drawHeight,
    'xy',
    drawOriginX,
    drawOriginY,
  );
  const levels = new Uint8Array(cacheWidth * cacheHeight);
  for (let y = 0; y < drawHeight; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= cacheHeight) continue;
    for (let x = 0; x < drawWidth; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= cacheWidth) continue;
      levels[targetY * cacheWidth + targetX] = dithered[y * drawWidth + x];
    }
  }
  return levels;
}

export function decodeFirmwareBmpLevels(
  bytes: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
  cacheWidth: number,
  cacheHeight: number,
) {
  // FUN_420a8d52 decodes BMP bytes itself. It accepts exactly planes=1,
  // compression BI_RGB (0) or BI_BITFIELDS (3), dimensions no larger than
  // 1024, and 1/4/8/16/24/32 bits per pixel. For indexed images it always
  // seeks to a complete 2^bpp-entry BGRA palette immediately before bfOffBits.
  if (
    bytes.length < 34 ||
    bytes[0] !== 0x42 ||
    bytes[1] !== 0x4d
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const height = Math.abs(signedHeight);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (
    planes !== 1 ||
    (compression !== 0 && compression !== 3) ||
    width < 1 ||
    height < 1 ||
    width > 0x400 ||
    height > 0x400 ||
    width !== sourceWidth ||
    height !== sourceHeight ||
    ![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)
  ) return null;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const rowStride = (rowBytes + 3) & ~3;
  if (
    pixelOffset > bytes.length ||
    rowStride * height > bytes.length - pixelOffset
  ) return null;

  let palette: Uint8Array | null = null;
  if (bitsPerPixel <= 8) {
    const paletteEntries = 1 << bitsPerPixel;
    const paletteOffset = pixelOffset - paletteEntries * 4;
    if (paletteOffset < 0 || paletteOffset + paletteEntries * 4 > bytes.length) {
      return null;
    }
    palette = new Uint8Array(paletteEntries);
    for (let index = 0; index < paletteEntries; index += 1) {
      const offset = paletteOffset + index * 4;
      const blue = bytes[offset];
      const green = bytes[offset + 1];
      const red = bytes[offset + 2];
      palette[index] = bitsPerPixel === 1
        ? red > 0x80 && green > 0x80 && blue > 0x80
          ? 0xff
          : 0
        : (red * 0x4d + green * 0x96 + blue * 0x1d) >> 8;
    }
  }

  const decodePixel = (rowOffset: number, x: number) => {
    if (bitsPerPixel === 1) {
      const index = (bytes[rowOffset + (x >> 3)] >> (7 - (x & 7))) & 1;
      return palette?.[index] ?? 0;
    }
    if (bitsPerPixel === 4) {
      const packed = bytes[rowOffset + (x >> 1)];
      const index = x & 1 ? packed & 0x0f : packed >> 4;
      return palette?.[index] ?? 0;
    }
    if (bitsPerPixel === 8) {
      return palette?.[bytes[rowOffset + x]] ?? 0;
    }
    if (bitsPerPixel === 16) {
      const offset = rowOffset + x * 2;
      const low = bytes[offset];
      const high = bytes[offset + 1];
      const red = compression === 0 ? (high << 1) & 0xf8 : high & 0xf8;
      const green = compression === 0
        ? ((low >> 2) & 0x38) | ((high & 0x03) << 6)
        : ((low >> 3) & 0x1c) | ((high & 0x07) << 5);
      const blue = low & 0x1f;
      return (red * 0x4d + green * 0x96 + blue * 0xe8) >> 8;
    }
    const offset = rowOffset + x * (bitsPerPixel >> 3);
    const blue = bytes[offset];
    const green = bytes[offset + 1];
    const red = bytes[offset + 2];
    return (red * 0x4d + green * 0x96 + blue * 0x1d) >> 8;
  };

  const luminance = new Uint8Array(cacheWidth * cacheHeight);
  for (let y = 0; y < cacheHeight; y += 1) {
    const sourceY = signedHeight < 0 ? y : height - 1 - y;
    const rowOffset = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < cacheWidth; x += 1) {
      luminance[y * cacheWidth + x] = decodePixel(rowOffset, x);
    }
  }
  const originX = sourceWidth <= maximumWidth
    ? Math.trunc((maximumWidth - sourceWidth) / 2)
    : 0;
  const originY = sourceHeight <= maximumHeight
    ? Math.trunc((maximumHeight - sourceHeight) / 2)
    : 0;
  return ditherFirmwareOneBit(
    luminance,
    cacheWidth,
    cacheHeight,
    'xy',
    originX,
    originY,
  );
}

function decodeFirmwareJpegModelLuminance(
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  // Fallback only: the exact path above uses the V6.3.15-matched TJpgDec
  // module. If WebAssembly is unavailable, browser RGBA remains explicitly
  // labelled because it cannot reproduce reduced-IDCT samples byte-for-byte.
  const luminance = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.trunc((y * sourceHeight) / height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.trunc((x * sourceWidth) / width),
      );
      luminance[y * width + x] = firmwareOpaqueLuminance(
        rgba,
        sourceY * sourceWidth + sourceX,
      );
    }
  }
  return luminance;
}

export function ditherFirmwareOneBit(
  luminance: Uint8Array,
  width: number,
  height: number,
  thresholdPhase: 'xy' | 'linear' = 'xy',
  originX = 0,
  originY = 0,
) {
  const levels = new Uint8Array(width * height);
  let currentErrors = new Int16Array(width + 2);
  let nextErrors = new Int16Array(width + 2);
  let linearPhase = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let adjusted = toFirmwareInt16(
        currentErrors[x] + luminance[y * width + x],
      );
      if (adjusted < 10) adjusted = 0;
      else if (adjusted > 245) adjusted = 255;
      const phase = thresholdPhase === 'linear'
        ? (linearPhase + x) & 15
        : (originX + x + originY + y) & 15;
      const white = adjusted > 119 + phase;
      levels[y * width + x] = white ? 0 : 3;
      const error = toFirmwareInt16(adjusted - (white ? 255 : 0));
      if (error === 0) continue;
      const unit = toFirmwareInt16((error - (error >> 3)) >> 2);
      if (x < width - 1) {
        currentErrors[x + 1] = toFirmwareInt16(
          currentErrors[x + 1] + unit * 2,
        );
      }
      if (x > 0) {
        nextErrors[x - 1] = toFirmwareInt16(nextErrors[x - 1] + unit);
      }
      nextErrors[x] = toFirmwareInt16(nextErrors[x] + unit);
    }
    if (thresholdPhase === 'linear') linearPhase = (linearPhase + width) & 0xff;
    const cleared = currentErrors;
    currentErrors = nextErrors;
    nextErrors = cleared;
    nextErrors.fill(0);
  }
  return levels;
}

export function ditherFirmwareJpegOneBit(
  luminance: Uint8Array,
  width: number,
  height: number,
  startPhase = 0,
) {
  // JpegOutputCallbackV6315 (ELF 0x403808a4) modifies its 8-bit row buffer
  // immediately. Each propagated error is saturated to 0...255 before a later
  // neighbor is added, unlike the PNG/BMP signed-row-buffer implementation.
  const working = luminance.slice();
  const levels = new Uint8Array(width * height);
  let phase = startPhase & 0xff;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let adjusted = working[index];
      if (adjusted < 10) adjusted = 0;
      else if (adjusted > 245) adjusted = 255;
      const white = adjusted > 119 + ((phase + x) & 15);
      working[index] = white ? 255 : 0;
      levels[index] = white ? 0 : 3;
      const error = toFirmwareInt16(adjusted - (white ? 255 : 0));
      if (error === 0) continue;
      const unit = toFirmwareInt16((error - (error >> 3)) >> 2);
      if (x < width - 1) {
        working[index + 1] = clampFirmwareByte(
          working[index + 1] + unit * 2,
        );
      }
      if (y < height - 1) {
        if (x > 0) {
          working[index + width - 1] = clampFirmwareByte(
            working[index + width - 1] + unit,
          );
        }
        working[index + width] = clampFirmwareByte(
          working[index + width] + unit,
        );
      }
    }
    phase = (phase + width) & 0xff;
  }
  return { levels, finalPhase: phase };
}

function clampFirmwareByte(value: number) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function toFirmwareInt16(value: number) {
  return (value << 16) >> 16;
}

export function decodePlainXtgLevels(
  bytes: Uint8Array,
  expectedWidth?: number,
  expectedHeight?: number,
) {
  // FUN_42084d72 writes this plain cache form and FUN_4205e08c /
  // FUN_42055f5c validate and paint it. Expanded XTG has an extra marker and
  // is intentionally rejected until its payload consumer is closed.
  if (
    bytes.length < 22 ||
    bytes[0] !== 0x58 ||
    bytes[1] !== 0x54 ||
    bytes[2] !== 0x47 ||
    bytes[3] !== 0x00
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  if (
    width < 1 ||
    height < 1 ||
    (expectedWidth !== undefined && width !== expectedWidth) ||
    (expectedHeight !== undefined && height !== expectedHeight)
  ) {
    return null;
  }
  const rowBytes = Math.trunc((width + 7) / 8);
  const expectedPayloadLength = rowBytes * height;
  const payloadLength = view.getUint32(10, true);
  if (
    payloadLength !== expectedPayloadLength ||
    bytes.length < 22 + expectedPayloadLength
  ) {
    return null;
  }

  const levels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = 22 + y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const white =
        (bytes[rowOffset + (x >> 3)] & (1 << (7 - (x & 7)))) !== 0;
      levels[y * width + x] = white ? 0 : 3;
    }
  }
  return levels;
}

function firmwareImageDrawOffset(
  recordIndex: number,
  followingTransition: number,
  currentY: number,
  imageHeight: number,
  lineStep: number,
) {
  // Exact FUN_42054d8a no-footer branch.
  if (recordIndex === 0 || !(followingTransition > 4)) return 0;
  let offset = Math.min(
    firmwareRoundPositive(Math.fround(Math.fround(lineStep) * Math.fround(0.4))),
    firmwareRoundPositive(
      Math.fround(Math.fround(followingTransition) * Math.fround(0.28)),
    ),
  );
  if (offset < 1) return 0;
  const remaining =
    V6315_SCREEN_HEIGHT - V6315_MANUAL_BOTTOM_RESERVE -
    (currentY + imageHeight);
  if (remaining >= 1 && remaining < offset) offset = remaining;
  return offset;
}

function paintFirmwareImage(
  frame: Uint8Array,
  owners: Int16Array,
  collisionRows: Set<number>,
  collisionMask: Uint8Array,
  frameW: number,
  frameH: number,
  originX: number,
  originY: number,
  ownerIndex: number,
  image: PlannedImage,
) {
  const paint = (x: number, y: number, level: number) => {
    if (!level) return;
    const targetX = originX + x;
    const targetY = originY + y;
    if (targetX < 0 || targetX >= frameW || targetY < 0 || targetY >= frameH) {
      return;
    }
    const index = targetY * frameW + targetX;
    if (frame[index] && owners[index] >= 0 && owners[index] !== ownerIndex) {
      collisionRows.add(targetY);
      collisionMask[index] = 1;
    }
    frame[index] |= level;
    owners[index] = ownerIndex;
  };

  if (image.levels) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        paint(x, y, image.levels[y * image.width + x]);
      }
    }
    return;
  }

  // FUN_4204d5dc first clips the requested region, then draws the outline and
  // both diagonals with the normal reader ink colour. Its +0x54 vtable call is
  // the outline primitive; the two +0x50 calls are corner-to-corner lines.
  const clippedLeft = Math.max(0, -originX);
  const clippedTop = Math.max(0, -originY);
  const clippedRight = Math.min(image.width, frameW - originX);
  const clippedBottom = Math.min(image.height, frameH - originY);
  const clippedWidth = clippedRight - clippedLeft;
  const clippedHeight = clippedBottom - clippedTop;
  if (clippedWidth < 1 || clippedHeight < 1) return;
  const right = clippedRight - 1;
  const bottom = clippedBottom - 1;
  if (clippedWidth >= 2 && clippedHeight >= 2) {
    for (let x = clippedLeft; x <= right; x += 1) {
      paint(x, clippedTop, 3);
      paint(x, bottom, 3);
    }
    for (let y = clippedTop + 1; y < bottom; y += 1) {
      paint(clippedLeft, y, 3);
      paint(right, y, 3);
    }
  }
  paintFirmwareLine(clippedLeft, clippedTop, right, bottom, paint);
  if (clippedWidth >= 2 && clippedHeight >= 2) {
    paintFirmwareLine(right, clippedTop, clippedLeft, bottom, paint);
  }
}

export function paintFirmwareLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  paint: (x: number, y: number, level: number) => void,
) {
  // Exact DrawLinePixelsV6315 (0x4200a3ce): swap steep axes, order the
  // major-axis endpoints, start at majorDelta / 2, then take a minor-axis
  // step only when subtracting minorDelta makes the error strictly negative.
  const steep = Math.abs(endY - startY) > Math.abs(endX - startX);
  if (steep) {
    [startX, startY] = [startY, startX];
    [endX, endY] = [endY, endX];
  }
  if (startX > endX) {
    [startX, endX] = [endX, startX];
    [startY, endY] = [endY, startY];
  }
  const deltaX = endX - startX;
  const deltaY = Math.abs(endY - startY);
  let error = Math.trunc(deltaX / 2);
  const stepY = startY < endY ? 1 : -1;
  for (let x = startX; x <= endX; x += 1) {
    paint(steep ? startY : x, steep ? x : startY, 3);
    error -= deltaY;
    if (error < 0) {
      startY += stepY;
      error += deltaX;
    }
  }
}

function normalizeFirmwareLanguage(language: string) {
  // Exact FUN_4204c61c behavior: collect at most the first three ASCII
  // letters, folding A-Z to lowercase and stopping at the first delimiter or
  // non-letter. Two-letter values are accepted verbatim. Three-letter values
  // must match this compiled alias switch; an unrecognized value becomes
  // `und` (not its first two letters).
  let token = '';
  for (const character of language.trim()) {
    if (!/[A-Za-z]/.test(character) || token.length === 3) break;
    token += character.toLowerCase();
  }
  if (token.length === 2) return token;
  const aliases: Record<string, string> = {
    eng: 'en',
    ukr: 'uk',
    zho: 'zh',
    chi: 'zh',
    jpn: 'ja',
    bod: 'bo',
    kor: 'ko',
    fra: 'fr',
    fre: 'fr',
    deu: 'de',
    ger: 'de',
    rus: 'ru',
    spa: 'es',
    swe: 'sv',
    ita: 'it',
  };
  return aliases[token] || 'und';
}

function firmwareHasHyphenationDictionary(language: string) {
  // Exact 8-entry descriptor table at ELF 0x3c27c1a4, selected by
  // FUN_4204baa4. There is no Korean dictionary in V6.3.15.
  return new Set(['en', 'fr', 'es', 'it', 'pl', 'sv', 'ru', 'uk']).has(
    language,
  );
}

function normalizePreviewBlocks(
  text: string,
  supplied: DevicePreviewBlock[] | undefined,
): DevicePreviewBlock[] {
  if (supplied?.length) {
    return supplied.map((block, index) => ({
      ...block,
      text: block.text.replace(/\r\n?/g, '\n'),
      breakAfter:
        block.breakAfter ??
        (index < supplied.length - 1 ? 'paragraph' : 'text-end'),
      startsParagraph: block.startsParagraph ?? true,
    }));
  }
  const records = text.replace(/\r\n?/g, '\n').split('\n');
  return records.map((record, index) => ({
    text: record,
    breakAfter:
      index < records.length - 1 ? 'paragraph' as const : 'text-end' as const,
    startsParagraph: true,
  }));
}

type FirmwareStyledCharacter = {
  character: string;
  bold: boolean;
  italic: boolean;
  tokenId: number;
  clusterId: number;
  embeddedControlsBefore: Array<0x02 | 0x03 | 0x1c | 0x1d>;
  embeddedControlsAfter: Array<0x02 | 0x03 | 0x1c | 0x1d>;
};

function firmwareStyledTokens(
  block: DevicePreviewBlock,
): FirmwareStyledCharacter[] {
  const pretokenized = Boolean(block.inlineRuns?.length);
  const runs = block.inlineRuns?.length
    ? block.inlineRuns
    : [
        {
          text: normalizeRawEpubBlockText(block.text),
          bold: false,
          italic: false,
        },
      ];
  const output: FirmwareStyledCharacter[] = [];
  let nextTokenId = 0;
  for (const run of runs) {
    let activeTextToken = -1;
    const characters = Array.from(run.text);
    for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
      const character = characters[characterIndex];
      const codePoint = character.codePointAt(0) ?? 0;
      if (!pretokenized && firmwareSourceTokenizerOmits(codePoint)) continue;
      // ELF 0x420d7794 returns collapsed ASCII whitespace and NBSP as separate
      // tokens. Ordinary consecutive non-whitespace input stays in one token
      // until a tag/style transition (represented here by the run boundary).
      const separateToken = codePoint === 0x20 || codePoint === 0x00a0;
      if (separateToken || activeTextToken < 0) {
        activeTextToken = run.tokenId ?? nextTokenId;
        nextTokenId = Math.max(nextTokenId + 1, activeTextToken + 1);
      }
      output.push({
        character,
        bold: run.bold,
        italic: run.italic,
        tokenId: activeTextToken,
        clusterId: -1,
        embeddedControlsBefore:
          characterIndex === 0 ? [...(run.embeddedControlsBefore ?? [])] : [],
        embeddedControlsAfter:
          characterIndex === characters.length - 1
            ? [...(run.embeddedControlsAfter ?? [])]
            : [],
      });
      if (separateToken) activeTextToken = -1;
    }
  }
  let clusterId = 0;
  for (let index = 0; index < output.length;) {
    const count = firmwareClusterCodePointCount(output, index);
    for (
      let member = index;
      member < Math.min(output.length, index + count);
      member += 1
    ) {
      output[member].clusterId = clusterId;
    }
    clusterId += 1;
    index += Math.max(1, count);
  }
  return output;
}

function normalizeRawEpubBlockText(text: string) {
  // Exact raw-XHTML whitespace/control behavior of ELF FUN_420d7794 for the
  // editable/default preview path. Loaded EPUB inlineRuns already arrive from
  // app/epub.ts in this normalized token form.
  const output: string[] = [];
  let pendingSpace = false;
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (firmwareSourceTokenizerOmits(codePoint)) continue;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      codePoint === 0x20
    ) {
      if (output.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) output.push(' ');
    pendingSpace = false;
    output.push(character);
  }
  return output.join('');
}

function firmwareClusterCodePointCount(
  input: FirmwareStyledCharacter[],
  start: number,
) {
  const tokenId = input[start]?.tokenId;
  const codePointAt = (index: number) => {
    const item = input[index];
    if (!item || item.tokenId !== tokenId) return undefined;
    return item.character.codePointAt(0);
  };
  const first = codePointAt(start);
  if (first === undefined) return 1;

  // FUN_42046a5e: U+0F04 groups with up to four following Tibetan members.
  // U+0F05 continues the group; the delimiter mask contributes one final
  // member and ends it.
  if (first === 0x0f04) {
    let count = 1;
    while (count < 5) {
      const next = codePointAt(start + count);
      if (next === 0x0f05) {
        count += 1;
        continue;
      }
      if (next !== undefined && firmwareTibetanDelimiter(next)) count += 1;
      break;
    }
    return count;
  }

  // FUN_42046b9c: paired U+0F3C/U+0F3D grouping around a Tibetan digit or a
  // normal Tibetan cluster.
  if (first === 0x0f3c) {
    const next = codePointAt(start + 1);
    if (next !== undefined && next !== 0x0f3c && next !== 0x0f3d) {
      let middleCount = 0;
      if (next >= 0x0f20 && next <= 0x0f33) {
        middleCount = 1;
      } else if (firmwareTibetanClusterStarter(next)) {
        middleCount = firmwareNormalTibetanClusterCount(
          input,
          start + 1,
          tokenId,
        );
      }
      if (middleCount > 0) {
        const closing = codePointAt(start + 1 + middleCount);
        return 1 + middleCount + (closing === 0x0f3d ? 1 : 0);
      }
    }
  }

  if (first >= 0x0f00 && first <= 0x0fff) {
    return firmwareNormalTibetanClusterCount(input, start, tokenId);
  }
  return 1;
}

function firmwareNormalTibetanClusterCount(
  input: FirmwareStyledCharacter[],
  start: number,
  tokenId: number | undefined,
) {
  const first = input[start]?.character.codePointAt(0);
  if (first === undefined || !firmwareTibetanClusterStarter(first)) return 1;
  let count = 1;
  while (count < 5) {
    const item = input[start + count];
    if (!item || item.tokenId !== tokenId) break;
    const codePoint = item.character.codePointAt(0);
    if (codePoint === undefined || !firmwareTibetanClusterContinuation(codePoint)) {
      break;
    }
    count += 1;
  }
  return count;
}

function firmwareTibetanDelimiter(codePoint: number) {
  if (codePoint < 0x0f0d || codePoint > 0x0f14) return false;
  return ((0x97 >>> (codePoint - 0x0f0d)) & 1) !== 0;
}

function firmwareTibetanClusterStarter(codePoint: number) {
  return (
    (codePoint >= 0x0f40 && codePoint <= 0x0f6c) ||
    codePoint === 0x0f00 ||
    (codePoint >= 0x0f88 && codePoint <= 0x0f8c)
  );
}

function firmwareTibetanClusterContinuation(codePoint: number) {
  if (codePoint >= 0x0f90 && codePoint <= 0x0fbc) return true;
  if (codePoint >= 0x0f18 && codePoint <= 0x0f19) return true;
  if (codePoint >= 0x0f35 && codePoint <= 0x0f3f) {
    return ((0x615 >>> (codePoint - 0x0f35)) & 1) !== 0;
  }
  return codePoint >= 0x0f71 && codePoint <= 0x0f87;
}

function planFirmwareLines(
  xtf: ParsedXtf,
  input: PlannedGlyph[],
  paragraphIndex: number,
  firstLineIndent: number,
  contentWidth: number,
  textAlign: DevicePreviewBlock['textAlign'],
  recordEnding: PlannedLine['breakReason'],
  syntheticBold: boolean,
  recordPrefix: PlannedLine['recordPrefix'],
  sourceTag: string | undefined,
  sourceClass: string | undefined,
  alignMode: DeviceAlignMode,
  firmwareLanguage: string,
  output: PlannedRecord[],
) {
  let current: PlannedGlyph[] = [];
  let currentLayoutWidth = 0;
  let currentPaintWidth = 0;
  let firstLine = true;
  const indentForLine = () => (firstLine ? firstLineIndent : 0);
  const finish = (breakReason: PlannedLine['breakReason']) => {
    // FUN_420719b2 removes serialized trailing ASCII spaces and subtracts
    // their measured width before the record is committed. Preserve their
    // source consumption separately so diagnostics never call trimmed input
    // "lost" merely because it has no painted glyph.
    const lastConsumedSourceIndex = current.reduce(
      (highest, glyph) => Math.max(highest, glyph.sourceIndex),
      -1,
    );
    while (current.at(-1)?.codePoint === 0x20) {
      const removed = current.pop();
      if (!removed) break;
      currentLayoutWidth -= removed.layoutAdvance;
      currentPaintWidth -= removed.glyph.advance;
    }
    output.push({
      kind: 'text',
      glyphs: current,
      layoutWidth: currentLayoutWidth,
      baseWidth: currentPaintWidth,
      breakReason,
      paragraphIndex,
      indent: indentForLine(),
      textAlign,
      syntheticBold,
      recordPrefix,
      sourceTag,
      sourceClass,
      inlineControls: firmwareInlineControls(
        current,
        recordPrefix === undefined ? 0 : 1,
      ),
      lastConsumedSourceIndex,
    });
    current = [];
    currentLayoutWidth = 0;
    currentPaintWidth = 0;
    firstLine = false;
  };

  // This is the stock EPUB composer (ELF 0x420d866e and its helpers), not the
  // separate plain/alternate encoded-text reader at 0x420e404c/0x420999ac.
  // Default or edited preview text is first normalized into the same simple
  // paragraph-token representation as extracted XHTML.
  let index = 0;
  let skipLeadingSpaces = false;
  const moveLastFirmwareUnitToNextLine = () => {
    const clusterId = current.at(-1)?.clusterId;
    if (clusterId === undefined || clusterId < 0) return false;
    const sourceIndices = new Set<number>();
    do {
      const removed = current.pop();
      if (!removed) break;
      currentLayoutWidth -= removed.layoutAdvance;
      currentPaintWidth -= removed.glyph.advance;
      if (removed.sourceIndex >= 0) sourceIndices.add(removed.sourceIndex);
    } while (current.at(-1)?.clusterId === clusterId);
    index -= sourceIndices.size;
    return sourceIndices.size > 0;
  };
  while (index < input.length) {
    const planned = input[index];
    if (skipLeadingSpaces && planned.codePoint === 0x20) {
      index += 1;
      continue;
    }
    skipLeadingSpaces = false;

    // ELF 0x420d866e asks ELF 0x42070402 for the final legal byte offset in the
    // selected V6.3.15 language dictionary. It tries exactly that one prefix,
    // appends a visible ASCII hyphen, and commits the record only when the
    // resulting painter width fits. A failed final candidate does not make
    // the firmware search backward through earlier legal points; it falls
    // through to the ordinary token splitter below.
    const atTokenBoundary =
      index === 0 || input[index - 1].tokenId !== planned.tokenId;
    if (
      alignMode !== 'left' &&
      (atTokenBoundary || current.length === 0)
    ) {
      let tokenEnd = index + 1;
      while (
        tokenEnd < input.length &&
        input[tokenEnd].tokenId === planned.tokenId
      ) {
        tokenEnd += 1;
      }
      const tokenGlyphs = input.slice(index, tokenEnd);
      const sourceGlyphs = tokenGlyphs.filter(
        (glyph) => glyph.sourceIndex >= 0,
      );
      const tokenText = sourceGlyphs
        .map((glyph) => glyph.character)
        .join('');
      const finalBreak = firmwareHyphenationPoints(
        tokenText,
        firmwareLanguage,
      ).at(-1);
      const tokenCharacters = Array.from(tokenText);
      const previousBreakCodePoint =
        finalBreak === undefined
          ? undefined
          : tokenCharacters[finalBreak - 1]?.codePointAt(0);
      const nextBreakCodePoint =
        finalBreak === undefined
          ? undefined
          : tokenCharacters[finalBreak]?.codePointAt(0);
      // ComposePageRecordsV6315 (ELF 0x420d866e) accepts the dictionary's
      // final byte offset only after four exact guards: the prefix must not
      // end in opening punctuation or a Thai/Lao preposed vowel, and the
      // suffix must not begin with a combining/boundary mark or prohibited
      // line-start punctuation. These are ELF 0x4206f89e, 0x4206f94a,
      // 0x4206f91c, and 0x4206f870 in call order.
      const legalFirmwareHyphenBreak =
        finalBreak !== undefined &&
        finalBreak > 0 &&
        previousBreakCodePoint !== undefined &&
        nextBreakCodePoint !== undefined &&
        !firmwareEpubOpeningPunctuation(previousBreakCodePoint) &&
        !firmwareEpubPreposedVowel(previousBreakCodePoint) &&
        !firmwareEpubBoundaryMark(nextBreakCodePoint) &&
        !firmwareEpubProhibitsLineStart(nextBreakCodePoint);
      if (legalFirmwareHyphenBreak) {
        let sourceGlyphCount = 0;
        let candidateInputCount = 0;
        const candidate: PlannedGlyph[] = [];
        for (const glyph of tokenGlyphs) {
          if (glyph.sourceIndex >= 0 && sourceGlyphCount >= finalBreak) break;
          candidate.push(glyph);
          candidateInputCount += 1;
          if (glyph.sourceIndex >= 0) sourceGlyphCount += 1;
        }

        const hyphenRecord = recordForCodePoint(xtf, 0x2d);
        const hyphenGlyph = resolveFirmwareGlyph(xtf, 0x2d);
        const styleSource = candidate.at(-1) ?? planned;
        const insertedHyphen: PlannedGlyph = {
          character: '-',
          codePoint: 0x2d,
          sourceIndex: -1,
          tokenId: planned.tokenId,
          clusterId: -0x40000000 - output.length,
          layoutAdvance: firmwareLayoutAdvance(
            xtf,
            0x2d,
            hyphenRecord,
          ),
          glyph: hyphenGlyph,
          inlineBold: styleSource.inlineBold,
          inlineItalic: styleSource.inlineItalic,
          embeddedControlsBefore: [],
          embeddedControlsAfter: [],
        };
        let tokenLayoutWidth = 0;
        let tokenPaintWidth = 0;
        for (const glyph of tokenGlyphs) {
          tokenLayoutWidth += glyph.layoutAdvance;
          tokenPaintWidth += glyph.glyph.advance;
        }
        let candidateLayoutWidth = insertedHyphen.layoutAdvance;
        let candidatePaintWidth = insertedHyphen.glyph.advance;
        for (const glyph of candidate) {
          candidateLayoutWidth += glyph.layoutAdvance;
          candidatePaintWidth += glyph.glyph.advance;
        }
        const wholeTokenOverflows =
          currentLayoutWidth + tokenLayoutWidth > contentWidth ||
          currentPaintWidth + tokenPaintWidth > contentWidth;
        const candidateFits =
          currentLayoutWidth + candidateLayoutWidth <= contentWidth &&
          currentPaintWidth + candidatePaintWidth <= contentWidth;
        if (wholeTokenOverflows && candidateFits) {
          current.push(...candidate, insertedHyphen);
          currentLayoutWidth += candidateLayoutWidth;
          currentPaintWidth += candidatePaintWidth;
          index += candidateInputCount;
          finish('automatic');
          continue;
        }
      }
    }

    // In ELF 0x420d866e the readfx==left configuration (param_6 byte +6 is
    // zero) does not immediately split an ordinary token. If the whole token
    // fits an empty record but not the remaining width of a non-empty record,
    // the current record is committed and that same token is retried intact.
    // Wrap+Align/right keep the token in the ELF 0x420723e0 split chain.
    if (
      alignMode === 'left' &&
      current.length > 0 &&
      (index === 0 || input[index - 1].tokenId !== planned.tokenId)
    ) {
      let tokenLayoutWidth = 0;
      let tokenPaintWidth = 0;
      for (
        let tokenIndex = index;
        tokenIndex < input.length &&
        input[tokenIndex].tokenId === planned.tokenId;
        tokenIndex += 1
      ) {
        tokenLayoutWidth += input[tokenIndex].layoutAdvance;
        tokenPaintWidth += input[tokenIndex].glyph.advance;
      }
      const tokenFitsFreshRecord =
        tokenLayoutWidth <= contentWidth && tokenPaintWidth <= contentWidth;
      const tokenDoesNotFitRemaining =
        currentLayoutWidth + tokenLayoutWidth > contentWidth ||
        currentPaintWidth + tokenPaintWidth > contentWidth;
      if (tokenFitsFreshRecord && tokenDoesNotFitRemaining) {
        finish('automatic');
        continue;
      }
    }

    // FUN_420701c0 advances through FUN_4206f1ee. With an active XTF object,
    // that helper uses FUN_42069a72's firmware cluster length; ordinary
    // Hangul/Latin remain one code point while the explicitly recognized
    // Tibetan sequences remain indivisible.
    let inputUnitEnd = index + 1;
    while (
      inputUnitEnd < input.length &&
      input[inputUnitEnd].clusterId === planned.clusterId
    ) {
      inputUnitEnd += 1;
    }
    const sourceUnit = input.slice(index, inputUnitEnd);

    // The splitter compares against the reader's global content width. For an
    // EPUB paragraph, FUN_4207176c has already inserted the indent glyphs at
    // the front of `input`, so their advances consume this threshold; they
    // are not a separate painter offset.
    const availableWidth = contentWidth;
    const previousLength = current.length;
    for (const glyph of sourceUnit) {
      current.push(glyph);
      currentLayoutWidth += glyph.layoutAdvance;
      currentPaintWidth += glyph.glyph.advance;
    }
    index = inputUnitEnd;

    // The EPUB composer reaches this point through FUN_420701c0 and only
    // splits when the next measured unit would be strictly wider than the
    // remaining record width. Its accepted prefix is never given the
    // plain-reader's five-pixel overshoot allowance. Equality remains in the
    // current record so an exactly full final block can still end with LF.
    const paintOverflow = currentPaintWidth > availableWidth;
    const reachedBoundary =
      currentLayoutWidth > availableWidth || paintOverflow;
    if (reachedBoundary) {
      const overflow = currentLayoutWidth - availableWidth;
      if (
        (overflow > 0 || paintOverflow) &&
        previousLength > 0
      ) {
        for (
          let unitIndex = 0;
          unitIndex < sourceUnit.length;
          unitIndex += 1
        ) {
          const removed = current.pop();
          if (removed) {
            currentLayoutWidth -= removed.layoutAdvance;
            currentPaintWidth -= removed.glyph.advance;
          }
        }
        index -= sourceUnit.length;
      }

      // ELF 0x42071de6 remeasures the selected UTF-8 prefix through the painter
      // callback and repeatedly backs up by one complete input unit until it
      // fits. This matters when composition and paint advances differ (the
      // byte-7 NBSP path is the clearest example).
      while (
        currentPaintWidth > availableWidth &&
        current.length > 0
      ) {
        if (!moveLastFirmwareUnitToNextLine()) break;
      }

      const appendNextEpubProhibitedStart = () => {
        const next = input[index];
        if (!next || !firmwareEpubProhibitsLineStart(next.codePoint)) return;
        current.push(next);
        currentLayoutWidth += next.layoutAdvance;
        currentPaintWidth += next.glyph.advance;
        index += 1;
      };
      const applyEpubBoundaryPairing = () => {
        appendNextEpubProhibitedStart();
        if (
          current.length > 1 &&
          firmwareEpubOpeningPunctuation(current.at(-1)?.codePoint ?? 0)
        ) {
          moveLastFirmwareUnitToNextLine();
        }
      };

      // ELF 0x420723e0 applies these helpers in this order around a second
      // painter-width refit: 70062, cluster/Thai correction, 71dee, 70062,
      // 700f0, cluster correction, then 70162. The still-deferred Tibetan and
      // Thai sub-branches are not guessed here.
      applyEpubBoundaryPairing();
      while (currentPaintWidth > availableWidth && current.length > 0) {
        if (!moveLastFirmwareUnitToNextLine()) break;
      }
      applyEpubBoundaryPairing();
      if (firmwareEpubProhibitsLineStart(input[index]?.codePoint ?? 0)) {
        moveLastFirmwareUnitToNextLine();
      }
      if (firmwareEpubBoundaryMark(input[index]?.codePoint ?? 0)) {
        moveLastFirmwareUnitToNextLine();
      }
      finish('automatic');
      skipLeadingSpaces = true;
    }
  }
  // The composer suppresses empty commits. A trailing block/newline therefore
  // cannot manufacture an empty visual record or retroactively change an
  // already emitted automatic-wrap record.
  if (current.length) finish(recordEnding);
}

function firmwareInlineControls(
  glyphs: PlannedGlyph[],
  initialRecordOffset: number,
) {
  const controls: FirmwareInlineControl[] = [];
  let bold = false;
  let italic = false;
  let recordOffset = initialRecordOffset;
  const addEmbeddedControl = (
    byte: 0x02 | 0x03 | 0x1c | 0x1d,
  ) => {
    controls.push({
      recordOffset,
      byte,
      kind:
        byte === 0x02
          ? 'bold-start'
          : byte === 0x03
            ? 'bold-end'
            : byte === 0x1c
              ? 'italic-start'
              : 'italic-end',
    });
    recordOffset += 1;
  };
  for (const glyph of glyphs) {
    // ELF 0x4207153e/0x420715aa write the bold state byte before the italic
    // state byte. ELF 0x42042e8e makes all four bytes zero-width controls in
    // the active XTF measure and paint loops.
    if (glyph.inlineBold !== bold) {
      const byte = glyph.inlineBold ? 0x02 : 0x03;
      controls.push({
        recordOffset,
        byte,
        kind: glyph.inlineBold ? 'bold-start' : 'bold-end',
      });
      recordOffset += 1;
      bold = glyph.inlineBold;
    }
    if (glyph.inlineItalic !== italic) {
      const byte = glyph.inlineItalic ? 0x1c : 0x1d;
      controls.push({
        recordOffset,
        byte,
        kind: glyph.inlineItalic ? 'italic-start' : 'italic-end',
      });
      recordOffset += 1;
      italic = glyph.inlineItalic;
    }
    for (const byte of glyph.embeddedControlsBefore) {
      addEmbeddedControl(byte);
    }
    recordOffset += firmwareRecordByteLength(glyph);
    for (const byte of glyph.embeddedControlsAfter) {
      addEmbeddedControl(byte);
    }
  }
  return controls;
}

function firmwareRecordByteLength(glyph: PlannedGlyph) {
  if (glyph.codePoint === 0x00a0) return 1;
  if (glyph.codePoint === 0x00ad) return 1;
  if (glyph.codePoint === 0x09) return 1;
  return new TextEncoder().encode(glyph.character).length;
}

function firmwareAutoPagination(
  effectiveBaseAdvanceY: number,
  paragraphMode: FirmwareParagraphMode,
) {
  // InitializeXtfReaderLayoutV6315: floor((screenH - 44) / effective
  // advanceY), followed by
  // FUN_4204d434(4). Paragraph modes 0 and 2 reduce that four-record reserve
  // by two; modes 1, 3 and 4 retain all four reserved records.
  const rawMaximumLines = Math.trunc(
    V6315_AUTO_VERTICAL_SPAN / effectiveBaseAdvanceY,
  );
  const reservedRecords =
    paragraphMode === 0 || paragraphMode === 2 ? 2 : 4;
  const maximumLines =
    rawMaximumLines > reservedRecords
      ? rawMaximumLines - reservedRecords
      : Math.max(1, rawMaximumLines);
  const lineAdvance =
    maximumLines > 1
      ? Math.fround(
          Math.fround(V6315_AUTO_VERTICAL_SPAN) /
            Math.fround(maximumLines - 1),
        )
      : Math.fround(effectiveBaseAdvanceY);
  return { rawMaximumLines, maximumLines, lineAdvance };
}

function firmwareManualMaximumLines(
  effectiveBaseAdvanceY: number,
  lineAdvance: number,
) {
  // This is ELF 0x42098106's manual branch, including the 17 px lower reserve
  // and its 0.99f comparison bias.
  const available = Math.fround(
    V6315_SCREEN_HEIGHT -
      V6315_MANUAL_BOTTOM_RESERVE -
      V6315_FIRST_LINE_Y -
      effectiveBaseAdvanceY,
  );
  let maximumLines =
    Math.trunc(
      Math.fround(available / Math.fround(lineAdvance)),
    ) + 1;
  maximumLines = Math.max(1, maximumLines);
  const limit = Math.fround(
    Math.fround(V6315_SCREEN_HEIGHT - V6315_MANUAL_BOTTOM_RESERVE) +
      V6315_DRAW_ROUNDING_BIAS,
  );
  while (maximumLines > 1) {
    const lastOrigin = Math.fround(
      Math.fround(V6315_FIRST_LINE_Y) +
        Math.fround(
          Math.fround(maximumLines - 1) * Math.fround(lineAdvance),
        ),
    );
    const lineBoxBottom = Math.fround(
      lastOrigin + Math.fround(effectiveBaseAdvanceY),
    );
    if (lineBoxBottom <= limit) break;
    maximumLines -= 1;
  }
  return maximumLines;
}

function selectFirmwarePageRecords(
  records: PlannedRecord[],
  lineSpacing: DeviceLineSpacing,
  initialLineAdvance: number,
  paragraphRatio: number,
  maximumLines: number,
) {
  const selected = records.slice(0, Math.max(1, maximumLines));
  // ProcessEpubContentV6315 keeps a separate binary32 vertical budget after
  // the row-count cap from InitializeXtfReaderLayoutV6315. FUN_4204d442 uses
  // transition accounting for every manual choice and for Auto whenever the
  // paragraph ratio is > 1.0. Auto + 1x takes the record-step branch instead.
  const transitionStepMode =
    lineSpacing !== 'auto' || Math.fround(paragraphRatio) > Math.fround(1);
  const fitted: PlannedRecord[] = [];
  let budget = Math.fround(0);
  const availableBudget = Math.fround(
    V6315_SCREEN_HEIGHT -
      V6315_MANUAL_BOTTOM_RESERVE -
      V6315_FIRST_LINE_Y,
  );
  // Correct-ELF FUN_42094f8e adds 0.5f to (screenH - 17), then reports
  // overflow only when firstY + budget is larger than that value. The
  // surrounding gap-budget comparison uses the same available + 0.5f
  // threshold. An earlier transcription had the sign reversed and was one
  // physical row too strict at the boundary.
  const limit = Math.fround(availableBudget + Math.fround(0.5));
  const gapLimit = limit;
  for (let index = 0; index < selected.length; index += 1) {
    const record = selected[index];
    let nextBudget = budget;
    if (transitionStepMode) {
      if (fitted.length) {
        const previous = fitted[fitted.length - 1];
        const advance = isFirmwareParagraphBoundary(previous, record)
          ? Math.fround(initialLineAdvance * Math.fround(paragraphRatio))
          : initialLineAdvance;
        nextBudget = Math.fround(budget + advance);
      }
      if (record.kind === 'image') {
        nextBudget = Math.fround(nextBudget + Math.fround(record.height));
      }
    } else {
      // The no-height-budget branch advances once for each committed record,
      // including the first. Image records substitute their selected height
      // for that ordinary text-record step. On overflow FUN_420e1840 rolls
      // the record back.
      nextBudget = Math.fround(
        budget +
          Math.fround(
            record.kind === 'image' ? record.height : initialLineAdvance,
          ),
      );
    }
    if (nextBudget > gapLimit || nextBudget > limit) break;
    fitted.push(record);
    budget = nextBudget;
  }
  if (!fitted.length && selected.length) {
    // The initialized layout always admits the first ordinary text record.
    // An over-tall first image is instead rejected by FUN_42094eb0.
    if (selected[0].kind === 'text') {
      fitted.push(selected[0]);
      budget = transitionStepMode ? Math.fround(0) : initialLineAdvance;
    }
  }
  return {
    records: fitted,
    mode: transitionStepMode
      ? ('transition-step' as const)
      : ('record-step' as const),
    budget,
    limit,
    removed: selected.length - fitted.length,
  };
}

function isFirmwareParagraphBoundary(
  previous: PlannedRecord,
  next: PlannedRecord,
) {
  return (
    previous.kind === 'text' &&
    previous.breakReason === 'paragraph' &&
    previous.glyphs.length > 0 &&
    (next.kind === 'image' || next.glyphs.length > 0)
  );
}

function countFirmwareParagraphBoundaries(records: PlannedRecord[]) {
  let count = 0;
  for (let index = 1; index < records.length; index += 1) {
    if (isFirmwareParagraphBoundary(records[index - 1], records[index])) count += 1;
  }
  return count;
}

function firmwareDrawCoordinate(value: number) {
  return Math.trunc(
    Math.fround(Math.fround(value) + V6315_DRAW_ROUNDING_BIAS),
  );
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
      crcData: view.getUint32(0x30, true),
      crcHeader: view.getUint32(0x34, true),
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
  // ELF 0x42002496: the metadata byte is authoritative when flag 0x02 is
  // present; otherwise V6.3.15 returns the header full-width advance.
  return xtf.header.metadataBytes ? record[0] : xtf.header.fullWidth;
}

function metadataEffectiveAdvance(xtf: ParsedXtf, record: Uint8Array) {
  // ELF 0x42045d6c operates on the record selected by the fallback loader. It
  // does not re-enter the ASCII-table/fullWidth classifier for that record.
  // Its scan result is the first column after the rightmost occupied bitmap
  // pixel measured from cell x=0—not the tight ink width with blank leading
  // columns removed.
  const rightEdge = glyphInkRightEdge(record, xtf);
  const inkAdvance =
    rightEdge < 1 ? 0 : signedXOffset(xtf, record) + rightEdge + 1;
  return Math.max(1, storedAdvance(xtf, record), inkAdvance);
}

function signedXOffset(xtf: ParsedXtf, record: Uint8Array) {
  // ELF 0x420024ac reads metadata byte 1 as int8_t.
  if (!xtf.header.metadataBytes) return 0;
  const value = record[1] ?? 0;
  return value > 0x7f ? value - 0x100 : value;
}

function asciiTableAdvance(xtf: ParsedXtf, codePoint: number) {
  const index = codePoint - 0x20;
  if (index < 0 || index >= xtf.header.asciiWidthCount) return 0;
  return xtf.bytes[xtf.header.asciiWidthOffset + index] ?? 0;
}

function firmwareIsWideLayoutCodePoint(codePoint: number) {
  // ELF 0x42069b00(cp, 1), as called by both V6.3.15 line-splitter paths.
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9fef) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfad8) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60)
  );
}

function firmwareAsciiKeepsCjkClass(codePoint: number) {
  // Exact translation of ELF 0x4204d2da, which decides whether an ASCII byte
  // can coexist with the CJK classification in ELF 0x42069b54's 32-byte probe.
  if (codePoint < 0x3d) {
    if (codePoint < 0x22) return codePoint === 0x21;
    if (((0x04000861 >>> ((codePoint - 0x22) & 31)) & 1) !== 0) {
      return true;
    }
    if (codePoint >= 0x30 && codePoint <= 0x39) return true;
  } else if (
    (codePoint & 0xfb) === 0x5b ||
    codePoint === 0x7b
  ) {
    return true;
  }
  if (codePoint < 0x41) {
    return ((0x3d801bcd >>> ((codePoint - 0x23) & 31)) & 1) !== 0;
  }
  if (codePoint === 0x60) return true;
  if (codePoint > 0x60) return codePoint >= 0x7c && codePoint <= 0x7e;
  return codePoint >= 0x5c && codePoint <= 0x5d;
}

function firmwareIndentWideClass(codePoint: number) {
  // ELF 0x42069b00(cp, 0): unlike the normal splitter's `cp, 1` call, this
  // indent classifier includes only these three wide ranges.
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9fef) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfad8)
  );
}

function firmwareUsesCjkIndent(text: string) {
  // Exact state machine of ELF 0x42069b54 as used by ELF 0x42069e34. Only the
  // first 32 UTF-8 bytes are classified, and result 1 selects U+3000 indent.
  const bytes = new TextEncoder().encode(text);
  const length = Math.min(bytes.length, 0x20);
  let tibetan = false;
  let cjk = false;
  let other = false;
  let offset = 0;
  while (offset < length) {
    const first = bytes[offset];
    if (first === 0x0a || first === 0x0d) break;
    if (first === 0x20 || first === 0x09) {
      offset += 1;
      continue;
    }
    if (first < 0x80) {
      other ||= !firmwareAsciiKeepsCjkClass(first);
      offset += 1;
      continue;
    }

    let codePoint = 0;
    let byteCount = 0;
    if ((first & 0xe0) === 0xc0 && offset + 1 < length) {
      const second = bytes[offset + 1];
      if ((second & 0xc0) !== 0x80) break;
      codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
      byteCount = 2;
    } else if ((first & 0xf0) === 0xe0 && offset + 2 < length) {
      const second = bytes[offset + 1];
      const third = bytes[offset + 2];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) break;
      codePoint =
        ((first & 0x0f) << 12) |
        ((second & 0x3f) << 6) |
        (third & 0x3f);
      byteCount = 3;
    } else if ((first & 0xf8) === 0xf0 && offset + 3 < length) {
      const second = bytes[offset + 1];
      const third = bytes[offset + 2];
      const fourth = bytes[offset + 3];
      if (
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80 ||
        (fourth & 0xc0) !== 0x80
      ) {
        break;
      }
      codePoint =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
      byteCount = 4;
    } else {
      break;
    }
    offset += byteCount;

    if (
      codePoint === 0x00a0 ||
      codePoint === 0x200b ||
      codePoint === 0x3000 ||
      (codePoint >= 0x0660 && codePoint <= 0x0669) ||
      (codePoint >= 0x06f0 && codePoint <= 0x06f9) ||
      ((codePoint & ~0x80) >= 0x0e50 &&
        (codePoint & ~0x80) <= 0x0e59) ||
      (codePoint >= 0xff10 && codePoint <= 0xff19)
    ) {
      continue;
    }

    const ignoredPunctuation =
      (codePoint >= 0x2013 &&
        codePoint <= 0x2026 &&
        ((0x00080663 >>> ((codePoint - 0x2013) & 31)) & 1) !== 0) ||
      (codePoint >= 0x300a && codePoint <= 0x3011) ||
      codePoint === 0x30fb ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60);
    if (ignoredPunctuation || codePoint === 0x00b7) continue;

    if (codePoint >= 0x0f00 && codePoint <= 0x0fff) {
      tibetan = true;
      continue;
    }
    const cjkLike =
      firmwareIndentWideClass(codePoint) ||
      (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
      (codePoint >= 0x3130 && codePoint <= 0x318f) ||
      (codePoint >= 0xff66 && codePoint <= 0xff9d) ||
      (codePoint >= 0x20000 && codePoint <= 0x2fa1f);
    if (cjkLike) cjk = true;
    else other = true;
  }

  const classification = tibetan
    ? cjk
      ? Number(other) + 1
      : other
        ? 2
        : 3
    : cjk
      ? Number(other) + 1
      : Number(other) * 2;
  return classification === 1;
}

function firmwareLayoutAdvance(
  xtf: ParsedXtf,
  codePoint: number,
  record: Uint8Array | null,
) {
  // ELF 0x420424f8 returns XTF object byte +9 (raw header byte 0x0d,
  // fullWidth). ELF 0x42098106 writes that value to the fixed wide-character
  // word consumed by the splitter. Ordinary Hangul therefore wraps and
  // advances by fullWidth; cellW only bounds the stored bitmap.
  if (codePoint === 0x20) {
    return Math.max(
      1,
      asciiTableAdvance(xtf, codePoint) || xtf.header.asciiWidth,
    );
  }
  if (codePoint === 0x09) return Math.max(1, xtf.header.cellW >> 2);
  if (codePoint >= 0x21 && codePoint <= 0x7e) {
    return Math.max(
      1,
      asciiTableAdvance(xtf, codePoint) || xtf.header.asciiWidth,
    );
  }
  if (firmwareIsWideLayoutCodePoint(codePoint) || codePoint === 0x2026) {
    return xtf.header.fullWidth;
  }
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 0;
  if (record && firmwareUsesGlyphAdvance(codePoint)) {
    return metadataEffectiveAdvance(xtf, record);
  }
  // ELF 0x42049070 passes XTF fullWidth as param_4 and asciiWidth as param_5
  // to ELF 0x42046fba. For every multi-byte code point outside the narrow
  // metadata ranges, ELF 0x42046fba replaces that initial asciiWidth with
  // fullWidth. This includes decomposed Hangul Jamo and supplementary
  // fallback characters; composition never derives their width from ink.
  return xtf.header.fullWidth;
}

function firmwareAdvance(
  xtf: ParsedXtf,
  codePoint: number,
  record: Uint8Array | null,
) {
  // A v2 .xtf page selects ELF 0x420dcddc and ultimately ELF 0x420470e4. Do not
  // apply ELF 0x42080700's +1 spacing: that belongs to the other painter.
  if (codePoint === 0x20) {
    return Math.max(
      1,
      asciiTableAdvance(xtf, codePoint) || xtf.header.asciiWidth,
    );
  }
  if (codePoint >= 0x21 && codePoint <= 0x7e) {
    // ELF 0x42049070/0x420470e4 prefer ELF 0x4204257a's serialized table and
    // fall back to XTF asciiWidth.
    const serialized = asciiTableAdvance(xtf, codePoint);
    return Math.max(1, serialized || xtf.header.asciiWidth);
  }
  // Internal record byte 0x07 (the EPUB representation of U+00A0) and any
  // other non-formatting single-byte controls reach ELF 0x42046fba's ASCII
  // fallback-width result. The ASCII table itself only covers 0x20..0x7e.
  if (codePoint >= 0 && codePoint <= 0x7f) {
    return Math.max(1, xtf.header.asciiWidth);
  }
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 0;
  if (firmwareIsWideLayoutCodePoint(codePoint) || codePoint === 0x2026) {
    return xtf.header.fullWidth;
  }

  // ELF 0x42047040 selects the metadata/ink-derived branch only for its narrow
  // script ranges. Ordinary Hangul does not enter it.
  if (!firmwareUsesGlyphAdvance(codePoint)) return xtf.header.fullWidth;

  if (!record) return Math.max(1, xtf.header.fullWidth);
  return metadataEffectiveAdvance(xtf, record);
}

function firmwareAdvanceSource(
  codePoint: number,
  record: Uint8Array | null,
): FirmwareAdvanceSource {
  if (codePoint === 0x20) return 'ascii-table';
  if (codePoint >= 0x21 && codePoint <= 0x7e) return 'ascii-table';
  if (codePoint >= 0 && codePoint <= 0x7f) return 'ascii-width';
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 'zero-width';
  if (firmwareIsWideLayoutCodePoint(codePoint) || codePoint === 0x2026) {
    return 'full-width';
  }
  if (record && firmwareUsesGlyphAdvance(codePoint)) return 'glyph-metadata';
  if (codePoint < 0x80) return 'ascii-width';
  return 'full-width';
}

function firmwareUsesGlyphAdvance(codePoint: number) {
  // ELF 0x42047040 + ELF 0x42046cdc. The firmware deliberately excludes ordinary
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

function firmwareSourceTokenizerOmits(codePoint: number) {
  // Formatting/control code points discarded by the raw source tokenizer.
  // This must not be reapplied by the painter: numeric entities can emit some
  // of the same code points (notably U+2000–U+200A) into the line record.
  return (
    (codePoint >= 0x2000 && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2069) ||
    codePoint === 0xfeff ||
    codePoint === 0x180e
  );
}

function firmwareEpubProhibitsLineStart(codePoint: number) {
  // Exact translation of FUN_4206f728, used by FUN_42070062/FUN_420700f0 in
  // the EPUB candidate-break chain. This set is intentionally larger than
  // the plain-text FUN_4204d572 set above.
  if (codePoint === 0x5d) return true;
  if (codePoint >= 0x21 && codePoint <= 0x3b) {
    return ((0x06002903 >>> (codePoint - 0x21)) & 1) !== 0;
  }
  if (codePoint === 0x3f) return true;
  if (codePoint === 0x7d || codePoint === 0x00bb || codePoint === 0x0f3d) {
    return true;
  }
  if (codePoint >= 0x2019 && codePoint <= 0x2026) {
    return ((0x2011 >>> (codePoint - 0x2019)) & 1) !== 0;
  }
  if (codePoint >= 0x3001 && codePoint <= 0x3015) {
    return ((0x115503 >>> (codePoint - 0x3001)) & 1) !== 0;
  }
  if (codePoint >= 0xff01 && codePoint <= 0xff1f) {
    return ((0x46002901 >>> (codePoint - 0xff01)) & 1) !== 0;
  }
  return false;
}

function firmwareEpubOpeningPunctuation(codePoint: number) {
  // Exact translation of ELF FUN_4206f7e0. FUN_4207005a moves one of these from
  // the end of the previous candidate to the start of the next line.
  if (
    codePoint === 0x22 ||
    codePoint === 0x28 ||
    codePoint === 0x5b ||
    codePoint === 0x7b ||
    codePoint === 0x00ab ||
    codePoint === 0x0f3c ||
    codePoint === 0x2018 ||
    codePoint === 0x201c ||
    codePoint === 0xff08
  ) {
    return true;
  }
  return (
    codePoint >= 0x3008 &&
    codePoint <= 0x3014 &&
    ((0x1155 >>> (codePoint - 0x3008)) & 1) !== 0
  );
}

function firmwareEpubPreposedVowel(codePoint: number) {
  // Exact translation of ELF FUN_4206f8d4. Clearing bit 7 folds the Lao
  // U+0EC0-U+0EC4 range onto Thai U+0E40-U+0E44.
  return (codePoint & 0xffffff7f) >= 0x0e40 &&
    (codePoint & 0xffffff7f) <= 0x0e44;
}

function firmwareEpubBoundaryMark(codePoint: number) {
  // Exact FUN_42069f94 predicate used by FUN_42070162 after the compositor's
  // second fit/correction pass. When the next code point is one of these
  // marks, the preceding base unit is moved with it instead of leaving the
  // mark at the start of the next record.
  if (firmwareZeroAdvanceCodePoint(codePoint)) return true;
  if (codePoint >= 0x0591 && codePoint <= 0x05bd) return true;
  if (codePoint >= 0x05bf && codePoint <= 0x05c7) {
    return ((0x016d >>> (codePoint - 0x05bf)) & 1) !== 0;
  }
  if (codePoint >= 0x0610 && codePoint <= 0x061a) return true;
  if (codePoint >= 0x064b && codePoint <= 0x065f) return true;
  if (codePoint === 0x0670) return true;
  if (codePoint >= 0x06d6 && codePoint <= 0x06ed) {
    return ((0x00f67e7f >>> (codePoint - 0x06d6)) & 1) !== 0;
  }
  if (codePoint === 0x0e30 || codePoint === 0x0e32 || codePoint === 0x0e33) {
    return true;
  }
  if (codePoint >= 0x0eb0 && codePoint <= 0x0ebc) return true;
  if (codePoint >= 0x0ec8 && codePoint <= 0x0ecd) return true;
  if (codePoint >= 0x302a && codePoint <= 0x302f) return true;
  if (codePoint === 0x3099 || codePoint === 0x309a) return true;
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
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
      // ELF 0x420470e4 passes ELF 0x420024ac's signed metadata byte directly to
      // FUN_42045084. It does not normalize the bitmap's scanned left bound.
      xOffset: signedXOffset(xtf, direct),
      missing: false,
      generatedBox: false,
    };
  }

  // ELF 0x42045e3e: missing glyphs fall back to U+FFFD, then '?'. If neither
  // exists ELF 0x4204489a creates a border box across the complete cell.
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

type FirmwareHorizontalLayout = {
  offsets: number[];
  gapAfter: number[];
  baseAdvances: number[];
  preJustifyExtent: number;
  extent: number;
  justificationPixels: number;
  justifiedGaps: number;
  branch: 'direct' | 'space-distribution' | 'cjk-distribution';
  bypassReason?:
    | 'alignment'
    | 'record-ending'
    | 'nonpositive-space-slack'
    | 'no-boundary'
    | 'single-trailing-ascii'
    | 'excessive-cjk-slack'
    | 'no-adjustment';
  terminalAdjustmentPixels: number;
  trailingAsciiReservePixels: number;
};

function firmwareHorizontalLayout(
  xtf: ParsedXtf,
  line: PlannedLine,
  contentWidth: number,
  alignment: 'wrap-align' | 'right' | 'left' | 'center',
): FirmwareHorizontalLayout {
  const naturalBaseAdvances = line.glyphs.map(
    (planned) => planned.glyph.advance,
  );
  const offsetsForAdvances = (advances: number[]) => {
    const offsets: number[] = [];
    let width = 0;
    for (const advance of advances) {
      offsets.push(width);
      width += advance;
    }
    return { offsets, width };
  };
  const natural = offsetsForAdvances(naturalBaseAdvances);
  const directResult = (
    bypassReason: FirmwareHorizontalLayout['bypassReason'],
    baseAdvances = naturalBaseAdvances,
    terminalAdjustmentPixels = 0,
    trailingAsciiReservePixels = 0,
  ): FirmwareHorizontalLayout => {
    const direct = offsetsForAdvances(baseAdvances);
    return {
    offsets: direct.offsets,
    gapAfter: new Array(line.glyphs.length).fill(0) as number[],
    baseAdvances,
    preJustifyExtent: direct.width,
    extent: direct.width,
    justificationPixels: 0,
    justifiedGaps: 0,
    branch: 'direct',
    bypassReason,
    terminalAdjustmentPixels,
    trailingAsciiReservePixels,
  };
  };

  // Explicit/manual endings do not take the automatic Wrap+Align path. An
  // automatically wrapped final record may still be justified when the text
  // continues on the next page, so page position is not itself a bypass.
  if (
    alignment !== 'wrap-align' ||
    line.breakReason !== 'automatic' ||
    line.glyphs.length < 1
  ) {
    return directResult(
      alignment !== 'wrap-align' ? 'alignment' : 'record-ending',
    );
  }

  const cjkPainter = firmwareLineUsesCjkPainter(line);
  let boundaries: number[];
  if (!cjkPainter) {
    // Ordinary Hangul does not set ELF 0x420dcddc's CJK-line flag. The active
    // XTF branch therefore calls ELF 0x42042076, which distributes remaining
    // width only after internal ASCII U+0020 spaces. Leading/trailing spaces
    // are excluded; Hangul syllable boundaries are not distribution points.
    const firstNonSpace = line.glyphs.findIndex(
      (glyph) => glyph.codePoint !== 0x20,
    );
    let lastNonSpace = -1;
    for (let index = line.glyphs.length - 1; index >= 0; index -= 1) {
      if (line.glyphs[index].codePoint !== 0x20) {
        lastNonSpace = index;
        break;
      }
    }
    boundaries = [];
    for (let index = firstNonSpace + 1; index < lastNonSpace; index += 1) {
      if (line.glyphs[index].codePoint === 0x20) boundaries.push(index);
    }
    // PaintPageTextV6315 calls ELF 0x42042076 only for strictly positive
    // remaining width in the active XTF branch. Its signed compression code
    // exists, but this caller cannot reach it for an over-wide ordinary line.
    const slack = contentWidth - natural.width;
    if (slack <= 0) {
      return directResult('nonpositive-space-slack');
    }
  } else {
    // CJK-line records take ELF 0x4204938a -> ELF 0x420470e4. That lower-level
    // painter counts U+0020 and supported three-byte wide characters.
    boundaries = [];
    let seenNonWhitespace = false;
    for (let index = 0; index < line.glyphs.length; index += 1) {
      const codePoint = line.glyphs[index].codePoint;
      const whitespace = codePoint === 0x20 || codePoint === 0x3000;
      if (
        firmwareJustificationBoundary(codePoint) &&
        (seenNonWhitespace || !whitespace)
      ) {
        boundaries.push(index);
      }
      if (!whitespace) seenNonWhitespace = true;
    }
  }

  const baseAdvances = [...naturalBaseAdvances];
  let terminalAdjustmentPixels = 0;
  let trailingAsciiReservePixels = 0;
  if (cjkPainter) {
    let trailingAsciiCount = 0;
    for (let index = line.glyphs.length - 1; index >= 0; index -= 1) {
      const codePoint = line.glyphs[index].codePoint;
      if (codePoint < 0x21 || codePoint > 0x7e) break;
      trailingAsciiCount += 1;
    }
    // In PaintPageTextV6315, a CJK-state record ending in exactly one ASCII
    // graphic bypasses the distributed XTF thunk. Two or more terminal ASCII
    // graphics retain a small undistributed reserve (2 px for fullWidth=28).
    if (trailingAsciiCount === 1) {
      return directResult('single-trailing-ascii');
    }
    const naturalSlack = contentWidth - natural.width;
    // PaintPageTextV6315 sets the active-XTF direct-paint gate when the
    // positive remainder is strictly larger than twice max(fullWidth, 8).
    // This prevents a sparse CJK-state record from being stretched across an
    // implausibly large portion of the page. Equality remains distributable.
    const maximumDistributedSlack = Math.max(xtf.header.fullWidth, 8) * 2;
    if (naturalSlack > maximumDistributedSlack) {
      return directResult('excessive-cjk-slack');
    }
    if (trailingAsciiCount > 1 && naturalSlack > 0) {
      const reserveLimit =
        xtf.header.fullWidth <= 27
          ? 2
          : xtf.header.fullWidth > 69
            ? 4
            : Math.trunc(xtf.header.fullWidth / 14);
      trailingAsciiReservePixels = Math.min(naturalSlack, reserveLimit);
    }

    const lastIndex = line.glyphs.length - 1;
    const adjustedTerminalAdvance = firmwareTerminalPunctuationAdvance(
      xtf,
      line.glyphs[lastIndex],
    );
    if (
      adjustedTerminalAdvance !== null &&
      adjustedTerminalAdvance < baseAdvances[lastIndex]
    ) {
      terminalAdjustmentPixels =
        baseAdvances[lastIndex] - adjustedTerminalAdvance;
      baseAdvances[lastIndex] = adjustedTerminalAdvance;
      const terminalBoundary = boundaries.at(-1) === lastIndex;
      // ELF 0x420470e4 decrements the supplied count for an adjusted terminal
      // boundary, but recomputes the original count if decrementing would
      // produce zero. Preserve that exact one-boundary edge case.
      if (terminalBoundary && boundaries.length > 1) boundaries.pop();
    }
  }

  if (!boundaries.length) {
    return directResult(
      terminalAdjustmentPixels ? 'no-adjustment' : 'no-boundary',
      baseAdvances,
      terminalAdjustmentPixels,
      trailingAsciiReservePixels,
    );
  }

  const adjusted = offsetsForAdvances(baseAdvances);
  const preJustifyExtent = adjusted.width;
  const slack =
    contentWidth - preJustifyExtent - trailingAsciiReservePixels;
  if (slack === 0) {
    return directResult(
      'no-adjustment',
      baseAdvances,
      terminalAdjustmentPixels,
      trailingAsciiReservePixels,
    );
  }
  const offsets = new Array(line.glyphs.length).fill(0) as number[];
  const gapAfter = new Array(line.glyphs.length).fill(0) as number[];

  // Both routes divide a signed remainder with integer quotient/remainder and
  // assign the first remainder boundaries one extra pixel in that direction.
  // The ordinary active-XTF caller is positive-only; the lower CJK route in
  // ELF 0x420470e4 uses its signed value directly. Its final eligible glyph
  // remains in the divisor even when the post-glyph increment cannot move a
  // following glyph.
  const appliedSlack = slack;
  const direction = appliedSlack < 0 ? -1 : 1;
  const magnitude = Math.abs(appliedSlack);
  const quotient = Math.trunc(magnitude / boundaries.length);
  const remainder = magnitude % boundaries.length;
  let boundaryCursor = 0;
  let pen = 0;
  for (let index = 0; index < line.glyphs.length; index += 1) {
    offsets[index] = pen;
    pen += baseAdvances[index];
    if (boundaries[boundaryCursor] === index) {
      const extra =
        direction * (quotient + (boundaryCursor < remainder ? 1 : 0));
      gapAfter[index] = extra;
      pen += extra;
      boundaryCursor += 1;
    }
  }
  return {
    offsets,
    gapAfter,
    baseAdvances,
    preJustifyExtent,
    extent: pen,
    justificationPixels: appliedSlack,
    justifiedGaps: gapAfter.filter((gap) => gap !== 0).length,
    branch: cjkPainter ? 'cjk-distribution' : 'space-distribution',
    terminalAdjustmentPixels,
    trailingAsciiReservePixels,
  };
}

function firmwareTerminalPunctuationAdvance(
  xtf: ParsedXtf,
  planned: PlannedGlyph | undefined,
) {
  if (!planned || !firmwareTerminalPunctuation(planned.codePoint)) return null;
  const record = recordForCodePoint(xtf, planned.codePoint);
  if (!record) return null;
  const baseAdvance = firmwareBaseAdvanceBeforeMetadata(xtf, planned.codePoint);
  if (baseAdvance <= xtf.header.asciiWidth) return null;
  const rightEdge = glyphInkRightEdge(record, xtf);
  const inkExtent = signedXOffset(xtf, record) + rightEdge;
  if (inkExtent < 1) return null;
  const margin = baseAdvance <= 17
    ? 2
    : Math.trunc((baseAdvance + 6) / 12);
  const adjusted = Math.max(xtf.header.asciiWidth, inkExtent + margin);
  if (adjusted < 1 || adjusted >= baseAdvance) return null;
  return adjusted;
}

function firmwareTerminalPunctuation(codePoint: number) {
  // Exact ELF 0x42047098 predicate used only by the justified XTF painter's
  // final-glyph adjustment.
  if ((codePoint & 0xfffffffb) === 0x2019) return true;
  if (codePoint >= 0x3001 && codePoint <= 0x3011) {
    return ((0x00015503 >>> (codePoint - 0x3001)) & 1) !== 0;
  }
  if (codePoint >= 0xff01 && codePoint <= 0xff1f) {
    return ((0x46002901 >>> (codePoint - 0xff01)) & 1) !== 0;
  }
  return false;
}

function firmwareBaseAdvanceBeforeMetadata(
  xtf: ParsedXtf,
  codePoint: number,
) {
  if (firmwareZeroAdvanceCodePoint(codePoint)) return 0;
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return Math.max(
      1,
      asciiTableAdvance(xtf, codePoint) || xtf.header.asciiWidth,
    );
  }
  if (codePoint === 0x2026 || !firmwareUsesGlyphAdvance(codePoint)) {
    return xtf.header.fullWidth;
  }
  return xtf.header.asciiWidth;
}

function firmwareLineUsesCjkPainter(line: PlannedLine) {
  // This reproduces the sticky state accumulated by PaintPageTextV6315
  // (ELF 0x420dcddc, around 0x420dd948). Its three-byte ranges omit
  // AC00-D7A3, so an ordinary Hangul/Latin record stays on the segmented-space
  // path even though FUN_42069b00 classifies Hangul as wide in the separate
  // line splitter. A preceding qualifying CJK character keeps the state set;
  // U+3000 and ordinary two-byte characters preserve it. Four-byte UTF-8
  // takes the firmware's unconditional true branch.
  let cjkLine = false;
  for (const glyph of line.glyphs) {
    const codePoint = glyph.codePoint;
    const utf8Bytes =
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (utf8Bytes === 4) {
      cjkLine = true;
      continue;
    }
    if (utf8Bytes === 2) continue;
    if (utf8Bytes !== 3) continue;
    if (codePoint === 0x0f0b || codePoint === 0x0f0c) {
      cjkLine = true;
      continue;
    }
    if (codePoint === 0x3000) continue;
    if (
      (codePoint >= 0x3000 && codePoint <= 0x9fef) ||
      (codePoint >= 0xf900 && codePoint <= 0xfad8) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60)
    ) {
      cjkLine = true;
    }
  }
  return cjkLine;
}

function firmwareJustificationBoundary(codePoint: number) {
  // ELF 0x420439d4: an ASCII boundary is U+0020; a three-byte UTF-8 boundary is
  // one of the same wide ranges used by the firmware's CJK/Hangul classifier.
  const utf8Bytes =
    codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  if (utf8Bytes === 1) return codePoint === 0x20;
  return utf8Bytes === 3 && firmwareIsWideLayoutCodePoint(codePoint);
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

function glyphInkRightEdge(record: Uint8Array, xtf: ParsedXtf) {
  // ELF 0x420432ea returns the first column after the rightmost nonzero bitmap
  // pixel, measured from cell x=0 (not the ink width after removing left-side
  // blank columns).
  for (let x = xtf.header.cellW - 1; x >= 0; x -= 1) {
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
        return x + 1;
      }
    }
  }
  return 0;
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
      // FUN_42045084 clears the corresponding bits in two e-paper planes.
      // In this white=0 logical-code buffer, overlap therefore composes with
      // bitwise OR rather than by selecting the darker numeric level.
      frame[index] |= level;
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

function byteSettingAllowZero(value: number, name: string) {
  return integerSetting(value, 0, 255, name);
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
