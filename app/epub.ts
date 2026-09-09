import { unzip } from 'fflate';

export type EpubSection = {
  id: string;
  label: string;
  text: string;
  blocks: EpubBlock[];
  retainedBlankBlocks: number;
};

export type EpubBlock = {
  text: string;
  tag: string;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  suppressIndent?: boolean;
};

export type EpubBook = {
  fileName: string;
  title: string;
  sections: EpubSection[];
};

const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_SECTION_CHARACTERS = 300_000;
const EPUB_TEXT_FILE = /(?:^|\/)(?:container\.xml|[^/]+\.(?:opf|ncx|xhtml|html?|xml|css))$/i;
const OMIT_ELEMENTS = new Set([
  'audio',
  'canvas',
  'math',
  'nav',
  'noscript',
  'rp',
  'rt',
  'script',
  'style',
  'svg',
  'video',
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
    const content = extractReadableContent(
      decodeText(contentFile),
      contentPath,
      files,
      filesByLowerPath,
    );
    if (!content.blocks.some((block) => block.text.length > 0)) continue;
    sections.push({
      id: `${sections.length}:${contentPath}`,
      label: content.heading || chapterLabel(contentPath, sections.length + 1),
      text: content.text.slice(0, MAX_SECTION_CHARACTERS),
      blocks: trimBlocks(content.blocks, MAX_SECTION_CHARACTERS),
      retainedBlankBlocks: content.retainedBlankBlocks,
    });
  }

  if (!sections.length) throw new Error('OPENXTF_EMPTY_EPUB');
  const packageTitle = firstElementText(packageDocument, 'title');
  return {
    fileName: file.name,
    title: packageTitle || file.name.replace(/\.epub$/i, ''),
    sections,
  };
}

function unzipTextFiles(data: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      data,
      { filter: (file) => EPUB_TEXT_FILE.test(file.name) },
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

const READING_BLOCK_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'figcaption',
  'dd',
  'dt',
].join(',');

type BookCssRule = {
  selector: string;
  declarations: Map<string, string>;
  order: number;
};

function extractReadableContent(
  source: string,
  contentPath: string,
  files: Map<string, Uint8Array>,
  filesByLowerPath: Map<string, Uint8Array>,
) {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const body = document.body;
  const rules: BookCssRule[] = [];
  for (const link of Array.from(document.querySelectorAll('link[href]'))) {
    if (!(link.getAttribute('rel') || '').toLowerCase().includes('stylesheet')) continue;
    const href = link.getAttribute('href');
    if (!href) continue;
    const data = getArchiveFile(
      files,
      filesByLowerPath,
      resolveArchivePath(contentPath, href),
    );
    if (data) rules.push(...parseBookCss(decodeText(data), rules.length));
  }
  for (const style of Array.from(document.querySelectorAll('style'))) {
    rules.push(...parseBookCss(style.textContent || '', rules.length));
  }
  const candidates = Array.from(body.querySelectorAll(READING_BLOCK_SELECTOR));
  if (!candidates.length && normalizeBlockText(readElementText(body))) {
    candidates.push(body);
  }
  const blocks: EpubBlock[] = [];
  let retainedBlankBlocks = 0;
  for (const element of candidates) {
    const text = normalizeBlockText(readElementText(element));
    const bookStyle = bookBlockStyle(element, rules);
    if (!text) retainedBlankBlocks += 1;
    blocks.push({
      text,
      tag: element.localName.toLowerCase(),
      ...bookStyle,
    });
  }

  const heading =
    body.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim() ||
    document.title.trim();
  return {
    heading,
    text: blocks.map((block) => block.text).join('\n\n'),
    blocks,
    retainedBlankBlocks,
  };
}

function parseBookCss(source: string, orderOffset: number) {
  const rules: BookCssRule[] = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let order = orderOffset;
  while ((match = pattern.exec(clean))) {
    if (match[1].trim().startsWith('@')) continue;
    const declarations = parseBookDeclarations(match[2]);
    if (!declarations.size) continue;
    for (const selector of match[1].split(',')) {
      if (selector.trim()) {
        rules.push({ selector: selector.trim(), declarations, order: order++ });
      }
    }
  }
  return rules;
}

function parseBookDeclarations(source: string) {
  const declarations = new Map<string, string>();
  for (const item of source.split(';')) {
    const colon = item.indexOf(':');
    if (colon < 0) continue;
    const property = item.slice(0, colon).trim().toLowerCase();
    if (property !== 'text-align' && property !== 'text-indent') continue;
    declarations.set(
      property,
      item.slice(colon + 1).replace(/!important\s*$/i, '').trim().toLowerCase(),
    );
  }
  return declarations;
}

function bookBlockStyle(element: Element, rules: BookCssRule[]) {
  const values = new Map<string, { value: string; score: number; order: number }>();
  for (const rule of rules) {
    try {
      if (!element.matches(rule.selector)) continue;
    } catch {
      continue;
    }
    const score = bookSelectorScore(rule.selector);
    for (const [property, value] of rule.declarations) {
      const previous = values.get(property);
      if (!previous || score > previous.score || (score === previous.score && rule.order >= previous.order)) {
        values.set(property, { value, score, order: rule.order });
      }
    }
  }
  for (const [property, value] of parseBookDeclarations(element.getAttribute('style') || '')) {
    values.set(property, { value, score: Number.MAX_SAFE_INTEGER, order: Number.MAX_SAFE_INTEGER });
  }
  const align = values.get('text-align')?.value;
  const textAlign =
    align === 'left' || align === 'right' || align === 'center' || align === 'justify'
      ? align
      : undefined;
  const indent = values.get('text-indent')?.value;
  return {
    ...(textAlign ? { textAlign } : {}),
    ...(indent && /^0(?:[a-z%]+)?$/i.test(indent) ? { suppressIndent: true } : {}),
  } as Pick<EpubBlock, 'textAlign' | 'suppressIndent'>;
}

function bookSelectorScore(selector: string) {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)?.length ?? 0;
  const elements = selector.match(/(?:^|[\s>+~])[a-z][\w-]*/gi)?.length ?? 0;
  return ids * 10_000 + classes * 100 + elements;
}

function readElementText(element: Element) {
  const pieces: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push(node.nodeValue || '');
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.localName.toLowerCase();
    if (OMIT_ELEMENTS.has(tag)) return;
    if (tag === 'br') {
      pieces.push('\n');
      return;
    }
    for (const child of node.childNodes) visit(child);
    if (tag === 'td' || tag === 'th') pieces.push('\t');
  };
  visit(element);
  return pieces.join('');
}

function normalizeBlockText(text: string) {
  return text
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function trimBlocks(blocks: EpubBlock[], limit: number) {
  const result: EpubBlock[] = [];
  let remaining = limit;
  for (const block of blocks) {
    if (remaining <= 0) break;
    const text = block.text.slice(0, remaining);
    if (text || block.text.length === 0) result.push({ ...block, text });
    remaining -= text.length + 2;
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
