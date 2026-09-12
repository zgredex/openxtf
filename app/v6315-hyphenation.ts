import {
  V6315_HYPHENATION_BASE64,
  V6315_HYPHENATION_LANGUAGES,
} from './v6315-hyphenation-data';
import type { V6315HyphenationLanguage } from './v6315-hyphenation-data';

type PackedNode = {
  offset: number;
  valueWidth: number;
  keyCount: number;
  keysOffset: number;
  valuesOffset: number;
  patternOffset: number;
  patternLength: number;
};

type SourceLetter = {
  codePoint: number;
  sourceStart: number;
  sourceEnd: number;
};

let packedStore: Uint8Array | null = null;

function firmwareHyphenationStore() {
  if (packedStore) return packedStore;
  const binary = atob(V6315_HYPHENATION_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  packedStore = bytes;
  return bytes;
}

function openPackedNode(
  bytes: Uint8Array,
  languageOffset: number,
  languageLength: number,
  nodeOffset: number,
): PackedNode | null {
  if (nodeOffset < 0 || nodeOffset >= languageLength) return null;
  const start = languageOffset + nodeOffset;
  const remaining = languageLength - nodeOffset;
  const header = bytes[start];
  let cursor = 1;
  let keyCount = header & 0x1f;
  if (keyCount === 0x1f) {
    if (remaining === 1) return null;
    keyCount = bytes[start + cursor];
    cursor += 1;
  }

  let patternOffset = 0;
  let patternLength = 0;
  if (header & 0x80) {
    if (cursor + 1 >= remaining) return null;
    const encoded =
      (bytes[start + cursor] << 4) | (bytes[start + cursor + 1] >> 4);
    patternLength = bytes[start + cursor + 1] & 0x0f;
    if (encoded <= 3 || encoded + patternLength > languageLength) return null;
    patternOffset = languageOffset + encoded - 4;
    cursor += 2;
  }

  const valueWidth = ((header >> 5) & 0x03) || 1;
  const keysOffset = start + cursor;
  const valuesOffset = keysOffset + keyCount;
  if (cursor + keyCount + keyCount * valueWidth > remaining) return null;
  return {
    offset: nodeOffset,
    valueWidth,
    keyCount,
    keysOffset,
    valuesOffset,
    patternOffset,
    patternLength,
  };
}

function packedTransition(
  bytes: Uint8Array,
  node: PackedNode,
  key: number,
) {
  let keyIndex = -1;
  for (let index = 0; index < node.keyCount; index += 1) {
    if (bytes[node.keysOffset + index] === key) {
      keyIndex = index;
      break;
    }
  }
  if (keyIndex < 0) return null;
  const valueOffset = node.valuesOffset + keyIndex * node.valueWidth;
  if (node.valueWidth === 1) {
    const raw = bytes[valueOffset];
    return raw & 0x80 ? raw - 0x100 : raw;
  }
  if (node.valueWidth === 2) {
    // FUN_4204b94e reconstructs two-byte deltas in network order. This is
    // intentionally different from XTF's little-endian header fields.
    const raw = (bytes[valueOffset] << 8) | bytes[valueOffset + 1];
    return raw & 0x8000 ? raw - 0x10000 : raw;
  }
  return (
    (bytes[valueOffset] << 16) |
    (bytes[valueOffset + 1] << 8) |
    bytes[valueOffset + 2]
  ) - 0x800000;
}

function firmwareAlphabetCharacter(codePoint: number, transform: number) {
  if (transform === 1) return codePoint >= 0x0400 && codePoint <= 0x052f;
  const asciiLetter = ((codePoint & 0xffffffdf) - 0x41) >>> 0;
  return (
    asciiLetter <= 0x19 ||
    codePoint - 0x00c0 <= 0x16 ||
    codePoint - 0x00d8 <= 0x1e ||
    (codePoint >= 0x00f8 && codePoint <= 0x017f) ||
    codePoint === 0x1e9e
  );
}

function firmwareLowercase(codePoint: number, transform: number) {
  if (transform === 1) {
    if (codePoint >= 0x0410 && codePoint <= 0x042f) return codePoint + 0x20;
    if (codePoint === 0x0401) return 0x0451;
    return codePoint;
  }
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint + 0x20;
  if (
    (codePoint >= 0x00c0 && codePoint <= 0x00d6) ||
    (codePoint >= 0x00d8 && codePoint <= 0x00de)
  ) {
    return codePoint + 0x20;
  }
  if (codePoint >= 0x0100 && codePoint <= 0x0137) {
    return codePoint & 1 ? codePoint : codePoint + 1;
  }
  if (codePoint >= 0x0139 && codePoint <= 0x0148) {
    return codePoint & 1 ? codePoint + 1 : codePoint;
  }
  if (codePoint >= 0x014a && codePoint <= 0x0177) {
    return codePoint & 1 ? codePoint : codePoint + 1;
  }
  if (codePoint === 0x0178) return 0x00ff;
  if (codePoint >= 0x0179 && codePoint <= 0x017e) {
    return codePoint & 1 ? codePoint + 1 : codePoint;
  }
  if (codePoint === 0x1e9e) return 0x00df;
  return codePoint;
}

function firmwareSourceLetters(text: string) {
  const characters = Array.from(text);
  const letters: SourceLetter[] = [];
  const explicitBreaks: number[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const codePoint = characters[index].codePointAt(0) ?? 0;
    if (codePoint === 0x00ad) {
      if (index > 0 && index < characters.length - 1) explicitBreaks.push(index);
      continue;
    }

    const next = characters[index + 1];
    const nextCodePoint = next?.codePointAt(0);
    if (
      nextCodePoint !== undefined &&
      (nextCodePoint === 0x0300 ||
        nextCodePoint === 0x0301 ||
        nextCodePoint === 0x0302 ||
        nextCodePoint === 0x0303 ||
        nextCodePoint === 0x0307 ||
        nextCodePoint === 0x0308 ||
        nextCodePoint === 0x0327 ||
        nextCodePoint === 0x0328)
    ) {
      const composed = `${characters[index]}${next}`.normalize('NFC');
      const composedCharacters = Array.from(composed);
      if (composedCharacters.length === 1) {
        letters.push({
          codePoint: composedCharacters[0].codePointAt(0) ?? codePoint,
          sourceStart: index,
          sourceEnd: index + 2,
        });
        index += 1;
        continue;
      }
    }
    letters.push({ codePoint, sourceStart: index, sourceEnd: index + 1 });
  }
  return { characters, letters, explicitBreaks };
}

/**
 * Returns source-code-point indices at which V6.3.15 permits a dictionary or
 * explicit-soft-hyphen split. The returned index is the first source code
 * point of the suffix, matching the byte offset returned by FUN_4204baf2.
 */
export function firmwareHyphenationPoints(
  text: string,
  language: string,
) {
  const descriptor =
    V6315_HYPHENATION_LANGUAGES[
      language as V6315HyphenationLanguage
    ];
  if (!descriptor) return [];
  const { characters, letters, explicitBreaks } = firmwareSourceLetters(text);
  const sourceByteLength = characters.reduce(
    (total, character) =>
      total +
      (character.codePointAt(0) === 0x00ad
        ? 1
        : new TextEncoder().encode(character).length),
    0,
  );
  if (sourceByteLength <= 5 || sourceByteLength >= 0x51) return [];

  let first = -1;
  let last = -1;
  for (let index = 0; index < letters.length; index += 1) {
    if (!firmwareAlphabetCharacter(letters[index].codePoint, descriptor.transform)) {
      continue;
    }
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0 || last < first) return [];
  for (let index = first; index <= last; index += 1) {
    if (!firmwareAlphabetCharacter(letters[index].codePoint, descriptor.transform)) {
      return [];
    }
  }

  const normalizedBytes: number[] = [0x2e];
  const normalizedStarts: number[] = [0];
  const splitSourceIndices: number[] = [letters[first].sourceStart];
  const encoder = new TextEncoder();
  for (let index = first; index <= last; index += 1) {
    const letter = letters[index];
    normalizedStarts.push(normalizedBytes.length);
    splitSourceIndices.push(letter.sourceStart);
    normalizedBytes.push(
      ...encoder.encode(
        String.fromCodePoint(
          firmwareLowercase(letter.codePoint, descriptor.transform),
        ),
      ),
    );
  }
  normalizedStarts.push(normalizedBytes.length);
  splitSourceIndices.push(letters[last].sourceEnd);
  normalizedBytes.push(0x2e);

  const bytes = firmwareHyphenationStore();
  const root = openPackedNode(
    bytes,
    descriptor.offset,
    descriptor.length,
    descriptor.firstTableEnd,
  );
  if (!root) return explicitBreaks.slice(0, 8);
  const weights = new Uint8Array(normalizedStarts.length);
  const byteToCharacter = new Int16Array(normalizedBytes.length);
  byteToCharacter.fill(-1);
  for (let index = 0; index < normalizedStarts.length; index += 1) {
    byteToCharacter[normalizedStarts[index]] = index;
  }

  for (const start of normalizedStarts) {
    let node = root;
    for (let byteIndex = start; byteIndex < normalizedBytes.length; byteIndex += 1) {
      const delta = packedTransition(bytes, node, normalizedBytes[byteIndex]);
      if (delta === null) break;
      const nextOffset = node.offset + delta;
      const next = openPackedNode(
        bytes,
        descriptor.offset,
        descriptor.length,
        nextOffset,
      );
      if (!next) break;
      if (next.patternLength > 0) {
        let patternPosition = 0;
        for (let index = 0; index < next.patternLength; index += 1) {
          const encoded = bytes[next.patternOffset + index];
          patternPosition += Math.trunc(encoded / 10);
          const targetByte = start + patternPosition;
          const characterIndex = byteToCharacter[targetByte] ?? -1;
          if (
            characterIndex > 1 &&
            characterIndex + 1 < normalizedStarts.length
          ) {
            weights[characterIndex] = Math.max(
              weights[characterIndex],
              encoded % 10,
            );
          }
        }
      }
      node = next;
    }
  }

  const letterCount = last - first + 1;
  const output = [...explicitBreaks];
  for (let leftCount = 1; leftCount < letterCount; leftCount += 1) {
    const rightCount = letterCount - leftCount;
    const characterIndex = leftCount + 1;
    if (
      leftCount >= descriptor.leftMin &&
      rightCount >= descriptor.rightMin &&
      (weights[characterIndex] & 1) !== 0
    ) {
      const sourceIndex = splitSourceIndices[characterIndex];
      if (!output.includes(sourceIndex)) output.push(sourceIndex);
      if (output.length === 8) break;
    }
  }
  return output.sort((left, right) => left - right);
}
