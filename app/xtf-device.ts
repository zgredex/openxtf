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
  fullWidth: number;
  strictCrop: boolean;
};

export const DEFAULT_KOREAN_X4_SETTINGS: KoreanX4Settings = {
  cellW: 39,
  cellH: 38,
  cropLeft: 0,
  cropTop: 1,
  fullWidth: 28,
  strictCrop: true,
};

// These reproduce the reference X4 screen but are not XTF properties, so they
// are deliberately not exposed as font controls.
const PREVIEW_MARGIN = 16;
const PREVIEW_LINE_SPACING_FACTOR = 1.2;
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
        const targetY = y - cropTop;
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
  const compatibilityAdvanceY = targetH;
  const compatibilityAsciiWidth = Math.max(
    1,
    Math.round((targetW * 18) / 39),
  );
  const compatibilityAscender = Math.round((targetH * 28) / 38);
  const compatibilityDescender = -Math.round((targetH * 9) / 38);
  view.setUint8(0x0a, targetW);
  view.setUint8(0x0b, targetH);
  view.setUint8(0x0c, compatibilityAdvanceY);
  view.setUint8(0x0d, byteSetting(settings.fullWidth, 'fullWidth'));
  view.setUint8(0x0e, compatibilityAsciiWidth);
  view.setInt16(0x10, compatibilityAscender, true);
  view.setInt16(0x12, compatibilityDescender, true);
  view.setUint32(0x28, targetBytesPerGlyph, true);
  view.setUint32(0x2c, targetGlyphDataSize, true);

  const effectiveSpace = Math.max(1, targetW >> 2);
  if (source.header.asciiWidthCount > 0) {
    output[source.header.asciiWidthOffset] = effectiveSpace;
  }
  patchStoredAdvance(output, source, 0x20, effectiveSpace, targetBytesPerGlyph);
  patchStoredAdvance(
    output,
    source,
    0x3000,
    byteSetting(settings.fullWidth, 'fullWidth'),
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
      advanceY: compatibilityAdvanceY,
      layoutFullWidth: byteSetting(settings.fullWidth, 'fullWidth'),
      layoutAsciiWidth: compatibilityAsciiWidth,
      ascender: compatibilityAscender,
      descender: compatibilityDescender,
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
  const linePitch = Math.max(
    1,
    Math.trunc(xtf.header.cellH * PREVIEW_LINE_SPACING_FACTOR),
  );
  const paragraphExtra = Math.max(
    0,
    Math.trunc(linePitch * PREVIEW_PARAGRAPH_GAP_FACTOR),
  );
  const firstLineIndent = 0;
  const tracking = 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');

  const frame = new Uint8Array(width * height);
  const owners = new Int16Array(width * height);
  owners.fill(-1);
  const collisionRows = new Set<number>();
  const left = margin;
  const right = width - margin;
  const bottom = height - margin;
  let penX = left + firstLineIndent;
  let penY = margin;
  let lineIndex = 0;
  let lineCount = penY + xtf.header.cellH <= bottom ? 1 : 0;

  const nextLine = (paragraph = false) => {
    const nextY = penY + linePitch + (paragraph ? paragraphExtra : 0);
    if (nextY + xtf.header.cellH > bottom) return false;
    penY = nextY;
    lineIndex += 1;
    lineCount += 1;
    penX = left + (paragraph ? firstLineIndent : 0);
    return true;
  };

  const normalizedText = text.replace(/\r\n?/g, '\n');
  for (const character of normalizedText) {
    if (character === '\n') {
      if (!nextLine(true)) break;
      continue;
    }
    const cp = character.codePointAt(0);
    if (cp === undefined) continue;
    const glyphId = glyphIdForCodePoint(xtf, cp);
    const record =
      glyphId === null
        ? null
        : xtf.bytes.subarray(
            xtf.header.glyphDataOffset + glyphId * xtf.header.bytesPerGlyph,
            xtf.header.glyphDataOffset +
              (glyphId + 1) * xtf.header.bytesPerGlyph,
          );
    const advance = Math.max(
      1,
      stockAdvance(xtf, cp, record) + tracking,
    );
    if (penX > left && penX + advance > right) {
      if (!nextLine(false)) break;
    }
    if (penY + xtf.header.cellH > bottom) break;
    if (record) {
      paintGlyph(
        frame,
        owners,
        collisionRows,
        width,
        height,
        Math.round(penX),
        Math.round(penY),
        lineIndex,
        xtf,
        record,
      );
    }
    penX += advance;
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
      lineCount,
      inkCollisionRows: collisionRows.size,
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
  const metadataBytes = flags & FLAG_GLYPH_METADATA ? 2 : 0;
  const stride = rowStride(cellW, bppValue);
  const minimumRecordSize = metadataBytes + stride * cellH;
  if (
    !cellW ||
    !cellH ||
    bytesPerGlyph < minimumRecordSize ||
    glyphDataSize !== bytesPerGlyph * glyphCount ||
    glyphDataOffset + glyphDataSize > bytes.byteLength ||
    rangeTableOffset + rangeCount * 16 > bytes.byteLength
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
      asciiWidthOffset: view.getUint32(0x38, true),
      asciiWidthCount: view.getUint8(0x3c),
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

function stockAdvance(
  xtf: ParsedXtf,
  cp: number,
  record: Uint8Array | null,
) {
  if (cp === 0x20 || cp === 0xa0) return Math.max(1, xtf.header.cellW >> 2);
  if (cp === 0x09) return Math.max(1, xtf.header.cellW >> 2) * 4;
  if (cp === 0x3000) return Math.max(1, xtf.header.fullWidth);
  if (!record) return Math.max(1, xtf.header.cellW >> 1);

  // X4 V6.3.15 scans the staged record as 1bpp, including the optional
  // two-byte prefix. This intentionally reproduces that firmware behavior.
  const scanStride = Math.ceil(xtf.header.cellW / 8);
  let minimum = xtf.header.cellW;
  let maximum = -1;
  for (let y = 0; y < xtf.header.cellH; y += 1) {
    for (let x = 0; x < xtf.header.cellW; x += 1) {
      const offset = y * scanStride + (x >> 3);
      if (offset >= record.byteLength) continue;
      if (record[offset] & (0x80 >> (x & 7))) {
        minimum = Math.min(minimum, x);
        maximum = Math.max(maximum, x);
      }
    }
  }
  if (maximum < minimum) return Math.max(1, xtf.header.cellW >> 1);
  return Math.min(xtf.header.cellW, maximum - minimum + 2);
}

function paintGlyph(
  frame: Uint8Array,
  owners: Int16Array,
  collisionRows: Set<number>,
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
      }
      frame[index] = Math.max(frame[index], level);
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
