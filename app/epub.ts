import { unzip } from 'fflate';

export type EpubSection = {
  id: string;
  label: string;
  text: string;
  blocks: EpubBlock[];
  skippedEmptyBlocks: number;
};

export type EpubBlock = {
  text: string;
  inlineRuns?: EpubInlineRun[];
  tag: string;
  className: string;
  breakAfter: 'soft' | 'paragraph' | 'text-end';
  startsParagraph: boolean;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  suppressIndent?: boolean;
  syntheticBold?: boolean;
  recordPrefix?: 0x01 | 0x1e;
  image?: EpubImage;
};

export type EpubImage = {
  archivePath: string;
  mediaType: string;
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type EpubInlineRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  tokenId: number;
  embeddedControlsBefore?: Array<0x02 | 0x03 | 0x1c | 0x1d>;
  embeddedControlsAfter?: Array<0x02 | 0x03 | 0x1c | 0x1d>;
};

export type EpubBook = {
  fileName: string;
  title: string;
  language: string;
  sections: EpubSection[];
};

const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_SECTION_CHARACTERS = 300_000;
const EPUB_NEEDED_FILE = /(?:^|\/)(?:container\.xml|[^/]+\.(?:opf|ncx|xhtml|html?|xml|css|png|jpe?g|bmp|xtg))$/i;
// ELF 0x4206eb80: these are the only nested containers skipped by the stock
// V6.3.15 EPUB tokenizer. Unsupported tags are otherwise transparent to the
// text stream; in particular, <nav> is a recognized block tag.
const OMIT_ELEMENTS = new Set([
  'head',
  'title',
  'noscript',
  'script',
  'style',
]);

// Exact ELF 0x4206ebfc normal-block table. Opening and closing one of these tags
// can commit the active record. The commit is content-guarded, so nested and
// empty blocks do not manufacture blank lines.
const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'li', 'ol', 'ul', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'figure', 'figcaption', 'blockquote',
  'header', 'footer', 'nav', 'table', 'tr', 'td', 'th',
  'tbody', 'thead', 'caption', 'pre', 'address',
]);

const CENTER_CLASS_KEYWORDS = new Set([
  'head', 'title', 'titlepage', 'title-page', 'title_page', 'cover',
  'chaptertitle', 'chapter-title', 'chapter_title',
  'center', 'centered', 'centertext', 'center-text',
]);

const FIRMWARE_NAMED_ENTITIES = new Map<string, string>([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['ensp', ' '],
  ['emsp', ' '],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
  ['euro', '€'],
  ['pound', '£'],
  ['yen', '¥'],
  ['deg', '°'],
  ['middot', '·'],
  ['bull', '•'],
  ['hellip', '…'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['auml', 'ä'],
  ['Auml', 'Ä'],
  ['euml', 'ë'],
  ['Euml', 'Ë'],
  ['iuml', 'ï'],
  ['Iuml', 'Ï'],
  ['ouml', 'ö'],
  ['Ouml', 'Ö'],
  ['uuml', 'ü'],
  ['Uuml', 'Ü'],
  ['yuml', 'ÿ'],
  ['aring', 'å'],
  ['Aring', 'Å'],
  ['iexcl', '¡'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['szlig', 'ß'],
  ['acirc', 'â'],
  ['ecirc', 'ê'],
  ['icirc', 'î'],
  ['ocirc', 'ô'],
  ['ucirc', 'û'],
  ['eacute', 'é'],
  ['Eacute', 'É'],
  ['egrave', 'è'],
  ['Egrave', 'È'],
  ['aacute', 'á'],
  ['Aacute', 'Á'],
  ['agrave', 'à'],
  ['Agrave', 'À'],
  ['iacute', 'í'],
  ['Iacute', 'Í'],
  ['igrave', 'ì'],
  ['Igrave', 'Ì'],
  ['oacute', 'ó'],
  ['Oacute', 'Ó'],
  ['ograve', 'ò'],
  ['Ograve', 'Ò'],
  ['uacute', 'ú'],
  ['Uacute', 'Ú'],
  ['ugrave', 'ù'],
  ['Ugrave', 'Ù'],
  ['yacute', 'ý'],
  ['Yacute', 'Ý'],
  ['ntilde', 'ñ'],
  ['Ntilde', 'Ñ'],
  ['atilde', 'ã'],
  ['Atilde', 'Ã'],
  ['otilde', 'õ'],
  ['Otilde', 'Õ'],
  ['ccedil', 'ç'],
  ['Ccedil', 'Ç'],
  ['iquest', '¿'],
]);

export async function readEpub(file: File): Promise<EpubBook> {
  if (!/\.epub$/i.test(file.name) || file.size <= 0 || file.size > MAX_EPUB_BYTES) {
    throw new Error('OPENXTF_INVALID_EPUB');
  }

  const archive = await unzipTextFiles(new Uint8Array(await file.arrayBuffer()));
  const files = new Map<string, Uint8Array>();
  const filesByLowerPath = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(archive)) {
    const normalized = normalizeArchivePath(path);
    files.set(normalized, data);
    filesByLowerPath.set(normalized.toLowerCase(), data);
  }

  const container = getArchiveFile(
    files,
    filesByLowerPath,
    'META-INF/container.xml',
  );
  const packagePath = container
    ? readPackagePath(decodeText(container))
    : Array.from(files.keys()).find((path) => /\.opf$/i.test(path));
  if (!packagePath) throw new Error('OPENXTF_INVALID_EPUB');

  const normalizedPackagePath = normalizeArchivePath(packagePath);
  const packageFile = getArchiveFile(
    files,
    filesByLowerPath,
    normalizedPackagePath,
  );
  if (!packageFile) throw new Error('OPENXTF_INVALID_EPUB');

  const packageDocument = parseXml(decodeText(packageFile));
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const item of elementsByLocalName(packageDocument, 'item')) {
    const id = item.getAttribute('id')?.trim();
    const href = item.getAttribute('href')?.trim();
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: item.getAttribute('media-type')?.trim() || '',
    });
  }
  const mediaTypeByPath = new Map<string, string>();
  for (const item of manifest.values()) {
    mediaTypeByPath.set(
      resolveArchivePath(normalizedPackagePath, item.href).toLowerCase(),
      item.mediaType,
    );
  }

  const spineIds = elementsByLocalName(packageDocument, 'itemref')
    .filter((item) => item.getAttribute('linear')?.toLowerCase() !== 'no')
    .map((item) => item.getAttribute('idref')?.trim() || '')
    .filter(Boolean);
  const orderedItems = spineIds.length
    ? spineIds.map((id) => manifest.get(id)).filter(isManifestItem)
    : Array.from(manifest.values()).filter(isReadableManifestItem);

  const sections: EpubSection[] = [];
  for (const item of orderedItems) {
    if (!isReadableManifestItem(item)) continue;
    const contentPath = resolveArchivePath(normalizedPackagePath, item.href);
    const contentFile = getArchiveFile(files, filesByLowerPath, contentPath);
    if (!contentFile) continue;
    const content = extractReadableContent(decodeText(contentFile), contentPath);
    const hydratedBlocks = hydrateImageBlocks(
      content.blocks,
      files,
      filesByLowerPath,
      mediaTypeByPath,
    );
    if (!hydratedBlocks.some((block) => block.text.length > 0 || block.image)) {
      continue;
    }
    sections.push({
      id: `${sections.length}:${contentPath}`,
      label: content.heading || chapterLabel(contentPath, sections.length + 1),
      text: content.text.slice(0, MAX_SECTION_CHARACTERS),
      blocks: trimBlocks(hydratedBlocks, MAX_SECTION_CHARACTERS),
      skippedEmptyBlocks: content.skippedEmptyBlocks,
    });
  }

  if (!sections.length) throw new Error('OPENXTF_EMPTY_EPUB');
  const packageTitle = firstElementText(packageDocument, 'title');
  return {
    fileName: file.name,
    title: packageTitle || file.name.replace(/\.epub$/i, ''),
    language: firstElementText(packageDocument, 'language') || 'und',
    sections,
  };
}

function unzipTextFiles(data: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      data,
      { filter: (file) => EPUB_NEEDED_FILE.test(file.name) },
      (error, files) => {
        if (error) reject(new Error('OPENXTF_INVALID_EPUB', { cause: error }));
        else resolve(files);
      },
    );
  });
}

function readPackagePath(containerXml: string) {
  const document = parseXml(containerXml);
  return elementsByLocalName(document, 'rootfile')[0]?.getAttribute('full-path') || '';
}

function parseXml(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error('OPENXTF_INVALID_EPUB');
  }
  return document;
}

function elementsByLocalName(document: Document, localName: string) {
  return Array.from(document.getElementsByTagName('*')).filter(
    (element) => element.localName.toLowerCase() === localName,
  );
}

function firstElementText(document: Document, localName: string) {
  return elementsByLocalName(document, localName)[0]?.textContent?.trim() || '';
}

function extractReadableContent(source: string, contentPath: string) {
  const document = new DOMParser().parseFromString(
    preserveFirmwareTextEntities(source),
    'text/html',
  );
  const body = document.body;
  const blocks: EpubBlock[] = [];
  let skippedEmptyBlocks = 0;
  let pendingRuns: EpubInlineRun[] = [];
  let pendingTag = 'body';
  let pendingClassName = '';
  let pendingCenter = false;
  let pendingSuppressIndent = false;
  let pendingSyntheticBold = false;
  let pendingRecordPrefix: EpubBlock['recordPrefix'];
  let pendingHasVisibleText = false;
  let nextStartsParagraph = true;
  let parserBold = false;
  let parserItalic = false;
  let parserHeadingCenter = false;
  let parserClassCenter: { tag: 'p' | 'div'; depth: number } | null = null;
  let nextRawRunId = 0;

  const commit = (
    breakAfter: EpubBlock['breakAfter'],
    emptyBlockCandidate = false,
  ) => {
    const inlineRuns = normalizeFirmwareInlineRuns(pendingRuns);
    const text = inlineRuns.map((run) => run.text).join('');
    const containsVisibleCharacter = /[^\t\n\r \u00a0]/u.test(text);
    if (containsVisibleCharacter) {
      blocks.push({
        text,
        inlineRuns,
        tag: pendingTag,
        className: pendingClassName,
        breakAfter,
        startsParagraph: nextStartsParagraph,
        textAlign: pendingCenter ? 'center' : undefined,
        suppressIndent: pendingSuppressIndent || pendingCenter,
        syntheticBold: pendingSyntheticBold,
        recordPrefix: pendingRecordPrefix,
      });
    } else if (
      emptyBlockCandidate &&
      pendingRuns.some((run) => run.text.length > 0)
    ) {
      skippedEmptyBlocks += 1;
    }
    pendingRuns = [];
    pendingHasVisibleText = false;
    if (breakAfter === 'soft') nextStartsParagraph = false;
    if (breakAfter === 'paragraph') nextStartsParagraph = true;
  };

  const visit = (
    node: Node,
    context: {
      tag: string;
      className: string;
    },
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || '';
      const hasVisibleText = /[^\t\n\r \u00a0]/u.test(text);
      if (!pendingHasVisibleText && hasVisibleText) {
        const center = parserHeadingCenter || parserClassCenter !== null;
        pendingTag = context.tag;
        pendingClassName = context.className;
        pendingCenter = center;
        pendingSuppressIndent = center;
        pendingSyntheticBold = parserHeadingCenter;
        pendingRecordPrefix = parserHeadingCenter
          ? 0x01
          : parserClassCenter
            ? 0x1e
            : undefined;
        pendingHasVisibleText = true;
      }
      appendInlineRun(
        pendingRuns,
        text,
        parserBold,
        parserItalic,
        nextRawRunId,
      );
      nextRawRunId += 1;
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.localName.toLowerCase();
    if (OMIT_ELEMENTS.has(tag)) return;

    if (tag === 'br' || tag === 'hr') {
      commit('soft', true);
      return;
    }

    // ELF 0x420d7794 emits images as their own non-text token. The active text
    // record is committed before the image, and `alt` never enters the glyph
    // stream. The following inline text is not a new paragraph unless a real
    // block boundary says so.
    if (tag === 'img' || tag === 'image') {
      commit('paragraph');
      const href =
        node.getAttribute('src') ||
        node.getAttribute('xlink:href') ||
        node.getAttribute('href') ||
        '';
      if (href && !/^data:/i.test(href)) {
        blocks.push({
          text: '',
          tag,
          className: node.getAttribute('class') || '',
          breakAfter: 'soft',
          startsParagraph: false,
          suppressIndent: true,
          image: {
            archivePath: resolveArchivePath(contentPath, href),
            mediaType: '',
            bytes: new Uint8Array(),
            width: 0,
            height: 0,
          },
        });
      }
      nextStartsParagraph = false;
      return;
    }

    const togglesBold = tag === 'b' || tag === 'strong';
    const togglesItalic = tag === 'i' || tag === 'em';
    if (togglesBold) parserBold = true;
    if (togglesItalic) parserItalic = true;

    const isBlock = BLOCK_ELEMENTS.has(tag);
    if (isBlock) commit('paragraph');

    const headingOrCenterTag = tag === 'center' || /^h[1-6]$/.test(tag);
    if (headingOrCenterTag) parserHeadingCenter = true;

    // ELF 0x4206ef9e keeps recognized p/div class centering in one global
    // selector/depth pair. Only nested elements of the same tag increment the
    // depth, even if the nested element has no recognized class. A different
    // p/div tag does not affect the active pair.
    const isClassContainer = tag === 'p' || tag === 'div';
    if (isClassContainer) {
      const classCentered = Array.from(node.classList).some((name) =>
        CENTER_CLASS_KEYWORDS.has(name.toLowerCase()),
      );
      if (!parserClassCenter && classCentered) {
        parserClassCenter = { tag, depth: 1 };
      } else if (parserClassCenter?.tag === tag) {
        parserClassCenter.depth += 1;
      }
    }

    const nextContext = {
      tag: isBlock ? tag : context.tag,
      className: isBlock ? node.getAttribute('class') || '' : context.className,
    };
    for (const child of node.childNodes) visit(child, nextContext);

    if (isBlock) commit('paragraph', true);
    if (headingOrCenterTag) parserHeadingCenter = false;
    if (isClassContainer && parserClassCenter?.tag === tag) {
      parserClassCenter.depth -= 1;
      if (parserClassCenter.depth === 0) parserClassCenter = null;
    }
    // ELF 0x420d7794 stores each semantic inline state as one global boolean.
    // A closing synonym clears that flag; it is not a nested browser/CSS
    // style stack (for example, </strong> also clears an outer <b> state).
    if (togglesBold) parserBold = false;
    if (togglesItalic) parserItalic = false;
  };

  for (const child of body.childNodes) {
    visit(child, {
      tag: 'body',
      className: '',
    });
  }
  commit('text-end');
  if (blocks.length) blocks[blocks.length - 1].breakAfter = 'text-end';

  const heading =
    body.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim() ||
    document.title.trim();
  return {
    heading,
    text: blocks.map((block) => block.text).join('\n\n'),
    blocks,
    skippedEmptyBlocks,
  };
}

function appendInlineRun(
  runs: EpubInlineRun[],
  text: string,
  bold: boolean,
  italic: boolean,
  tokenId: number,
  embeddedControlsBefore?: EpubInlineRun['embeddedControlsBefore'],
  embeddedControlsAfter?: EpubInlineRun['embeddedControlsAfter'],
) {
  if (!text) return;
  const previous = runs.at(-1);
  const hasEmbeddedControls = Boolean(
    embeddedControlsBefore?.length || embeddedControlsAfter?.length,
  );
  if (
    previous &&
    !hasEmbeddedControls &&
    !previous.embeddedControlsBefore?.length &&
    !previous.embeddedControlsAfter?.length &&
    previous.bold === bold &&
    previous.italic === italic &&
    previous.tokenId === tokenId
  ) {
    previous.text += text;
  } else {
    runs.push({
      text,
      bold,
      italic,
      tokenId,
      embeddedControlsBefore,
      embeddedControlsAfter,
    });
  }
}

export function normalizeFirmwareInlineRuns(runs: EpubInlineRun[]) {
  // ELF 0x420d7794 collapses only ASCII TAB, LF, CR, and SPACE into an ordinary
  // whitespace token. Form feed and vertical tab stay literal one-byte input;
  // browser/HTML `\s` rules would silently discard behavior the firmware
  // preserves. U+00A0 follows the distinct internal-byte-7 path.
  const output: EpubInlineRun[] = [];
  let pendingSpace: Pick<EpubInlineRun, 'bold' | 'italic'> | null = null;
  let nextTokenId = 0;
  for (const run of runs) {
    let activeTextToken = -1;
    for (const decoded of decodeFirmwareEntities(run.text)) {
      const { character } = decoded;
      const codePoint = character.codePointAt(0) ?? 0;
      // ELF 0x420d7794 converts these formatting/control code points to its
      // internal CR sentinel and appends no bytes to the text token. They do
      // not become spaces and do not split the surrounding token.
      if (!decoded.fromEntity && firmwareOmitsEpubCodePoint(codePoint)) {
        continue;
      }
      if (/[\t\n\r ]/.test(character)) {
        pendingSpace ??= { bold: run.bold, italic: run.italic };
        activeTextToken = -1;
        continue;
      }
      if (pendingSpace && output.length) {
        appendInlineRun(
          output,
          ' ',
          pendingSpace.bold,
          pendingSpace.italic,
          nextTokenId,
        );
        nextTokenId += 1;
      }
      pendingSpace = null;
      if (character === '\u00a0') {
        appendInlineRun(
          output,
          character,
          run.bold,
          run.italic,
          nextTokenId,
        );
        nextTokenId += 1;
        activeTextToken = -1;
        continue;
      }
      if (activeTextToken < 0) {
        activeTextToken = nextTokenId;
        nextTokenId += 1;
      }
      const mathematical = firmwareMathematicalAlphanumeric(codePoint);
      if (mathematical) {
        appendInlineRun(
          output,
          mathematical.character,
          run.bold,
          run.italic,
          activeTextToken,
          mathematical.controlsBefore,
          mathematical.controlsAfter,
        );
        continue;
      }
      appendInlineRun(
        output,
        character,
        run.bold,
        run.italic,
        activeTextToken,
      );
    }
  }
  return output;
}

function preserveFirmwareTextEntities(source: string) {
  // DOMParser would otherwise apply the browser's much larger HTML entity
  // table before ELF 0x420d7794 is emulated. Escape ampersands only in text
  // content so attributes and tag syntax remain available to the DOM walker.
  let output = '';
  let insideTag = false;
  let quote = '';
  for (const character of source) {
    if (insideTag) {
      output += character;
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        insideTag = false;
      }
      continue;
    }
    if (character === '<') {
      insideTag = true;
      output += character;
    } else if (character === '&') {
      output += '&amp;';
    } else {
      output += character;
    }
  }
  return output;
}

function decodeFirmwareEntities(text: string) {
  const output: Array<{ character: string; fromEntity: boolean }> = [];
  for (let index = 0; index < text.length;) {
    if (text[index] !== '&') {
      const codePoint = text.codePointAt(index) ?? 0;
      const character = String.fromCodePoint(codePoint);
      output.push({ character, fromEntity: false });
      index += character.length;
      continue;
    }

    const semicolon = text.indexOf(';', index + 1);
    const nameLength = semicolon < 0 ? -1 : semicolon - index - 1;
    if (nameLength < 1 || nameLength > 7) {
      output.push({ character: '&', fromEntity: false });
      index += 1;
      continue;
    }
    const name = text.slice(index + 1, semicolon);
    const replacement = firmwareEntityReplacement(name);
    if (replacement === null) {
      output.push({ character: '&', fromEntity: false });
      index += 1;
      continue;
    }
    for (const character of Array.from(replacement)) {
      output.push({ character, fromEntity: true });
    }
    index = semicolon + 1;
  }
  return output;
}

function firmwareEntityReplacement(name: string) {
  const named = FIRMWARE_NAMED_ENTITIES.get(name);
  if (named !== undefined) return named;

  let value: number | null = null;
  if (/^#[0-9]+$/.test(name)) {
    value = Number.parseInt(name.slice(1), 10);
  } else if (/^#[xX][0-9a-fA-F]+$/.test(name)) {
    value = Number.parseInt(name.slice(2), 16);
  }
  if (value === null || value <= 0 || value >= 0x10000) return null;
  if (
    (value >= 0x200b && value <= 0x200f) ||
    (value >= 0x2028 && value <= 0x202e) ||
    (value >= 0x2060 && value <= 0x2069) ||
    value === 0xfeff ||
    value === 0x180e
  ) {
    return '';
  }
  if (value === 0x00a0) return '\u00a0';
  if (value === 0x00ad) return '\u00ad';
  return String.fromCodePoint(value);
}

function firmwareMathematicalAlphanumeric(codePoint: number) {
  if (codePoint < 0x1d400 || codePoint > 0x1d7ff) return null;

  const letterRanges = [
    [0x1d400, true, false],
    [0x1d434, false, true],
    [0x1d468, true, true],
    [0x1d49c, false, true],
    [0x1d4d0, true, true],
    [0x1d504, false, false],
    [0x1d538, false, false],
    [0x1d56c, true, false],
    [0x1d5a0, false, false],
    [0x1d5d4, true, false],
    [0x1d608, false, true],
    [0x1d63c, true, true],
    [0x1d670, false, false],
  ] as const;
  for (const [start, bold, italic] of letterRanges) {
    const offset = codePoint - start;
    if (offset < 0 || offset >= 52) continue;
    const ascii = offset < 26 ? 0x41 + offset : 0x61 + offset - 26;
    return firmwareMathematicalReplacement(ascii, bold, italic);
  }

  const digitRanges = [
    [0x1d7ce, true],
    [0x1d7d8, false],
    [0x1d7e2, false],
    [0x1d7ec, true],
    [0x1d7f6, false],
  ] as const;
  for (const [start, bold] of digitRanges) {
    const offset = codePoint - start;
    if (offset >= 0 && offset < 10) {
      return firmwareMathematicalReplacement(0x30 + offset, bold, false);
    }
  }

  // FUN_4206e6e6 replaces every otherwise-unmapped scalar inside the enclosing
  // U+1D400–U+1D7FF window with a literal ASCII question mark.
  return firmwareMathematicalReplacement(0x3f, false, false);
}

function firmwareMathematicalReplacement(
  asciiCodePoint: number,
  bold: boolean,
  italic: boolean,
) {
  return {
    character: String.fromCodePoint(asciiCodePoint),
    controlsBefore: [
      ...(bold ? [0x02 as const] : []),
      ...(italic ? [0x1c as const] : []),
    ],
    controlsAfter: [
      ...(italic ? [0x1d as const] : []),
      ...(bold ? [0x03 as const] : []),
    ],
  };
}

function firmwareOmitsEpubCodePoint(codePoint: number) {
  return (
    (codePoint >= 0x2000 && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2069) ||
    codePoint === 0xfeff ||
    codePoint === 0x180e
  );
}

function hydrateImageBlocks(
  blocks: EpubBlock[],
  files: Map<string, Uint8Array>,
  filesByLowerPath: Map<string, Uint8Array>,
  mediaTypeByPath: Map<string, string>,
) {
  return blocks.map((block) => {
    if (!block.image) return block;
    const bytes = getArchiveFile(
      files,
      filesByLowerPath,
      block.image.archivePath,
    );
    if (!bytes) return block;
    const dimensions = readRasterImageDimensions(bytes);
    return {
      ...block,
      image: {
        ...block.image,
        bytes,
        mediaType:
          mediaTypeByPath.get(block.image.archivePath.toLowerCase()) ||
          inferImageMediaType(block.image.archivePath),
        width: dimensions?.width ?? 0,
        height: dimensions?.height ?? 0,
      },
    };
  });
}

function inferImageMediaType(path: string) {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.bmp$/i.test(path)) return 'image/bmp';
  if (/\.xtg$/i.test(path)) return 'application/x-xtg';
  return 'application/octet-stream';
}

function readRasterImageDimensions(bytes: Uint8Array) {
  // ReadXtgImageDimensionsV6315 (ELF 0x420e0f5e) checks the first eight
  // bytes only: `XTG\0`, then little-endian u16 width and height.
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x58 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x47 &&
    bytes[3] === 0x00
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint16(4, true);
    const height = view.getUint16(6, true);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dibSize = view.getUint32(14, true);
    const width =
      dibSize === 12 ? view.getUint16(18, true) : Math.abs(view.getInt32(18, true));
    const height =
      dibSize === 12 ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const startOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (startOfFrame && length >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += length;
    }
  }
  return null;
}

function trimBlocks(blocks: EpubBlock[], limit: number) {
  const result: EpubBlock[] = [];
  let remaining = limit;
  for (const block of blocks) {
    if (remaining <= 0 && !block.image) break;
    if (block.image) {
      result.push(block);
      continue;
    }
    const text = block.text.slice(0, remaining);
    const inlineRuns = block.inlineRuns
      ? sliceInlineRuns(block.inlineRuns, text.length)
      : undefined;
    if (text || block.text.length === 0) {
      result.push({ ...block, text, inlineRuns });
    }
    remaining -= text.length + 2;
  }
  return result;
}

function sliceInlineRuns(runs: EpubInlineRun[], length: number) {
  const result: EpubInlineRun[] = [];
  let remaining = length;
  for (const run of runs) {
    if (remaining <= 0) break;
    const text = run.text.slice(0, remaining);
    appendInlineRun(
      result,
      text,
      run.bold,
      run.italic,
      run.tokenId,
      run.embeddedControlsBefore,
      text.length === run.text.length
        ? run.embeddedControlsAfter
        : undefined,
    );
    remaining -= text.length;
  }
  return result;
}

function isManifestItem(
  item: { href: string; mediaType: string } | undefined,
): item is { href: string; mediaType: string } {
  return Boolean(item);
}

function isReadableManifestItem(item: { href: string; mediaType: string }) {
  return (
    item.mediaType === 'application/xhtml+xml' ||
    item.mediaType === 'text/html' ||
    /\.(?:xhtml|html?)(?:[?#].*)?$/i.test(item.href)
  );
}

function resolveArchivePath(packagePath: string, href: string) {
  const baseDirectory = packagePath.includes('/')
    ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1)
    : '';
  const cleanHref = safeDecodeUriComponent(href.split(/[?#]/, 1)[0]);
  return normalizeArchivePath(`${baseDirectory}${cleanHref}`);
}

function normalizeArchivePath(path: string) {
  const result: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(safeDecodeUriComponent(part));
  }
  return result.join('/');
}

function getArchiveFile(
  files: Map<string, Uint8Array>,
  filesByLowerPath: Map<string, Uint8Array>,
  path: string,
) {
  const normalized = normalizeArchivePath(path);
  return files.get(normalized) || filesByLowerPath.get(normalized.toLowerCase());
}

function safeDecodeUriComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeText(data: Uint8Array) {
  if (data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  }
  if (data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  }
  return new TextDecoder('utf-8').decode(data);
}

function chapterLabel(path: string, number: number) {
  const fileName = path.split('/').pop()?.replace(/\.(?:xhtml|html?)$/i, '') || '';
  const readableName = fileName.replace(/[_-]+/g, ' ').trim();
  return readableName || `Chapter ${number}`;
}
