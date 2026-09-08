import { unzip } from 'fflate';

export type EpubSection = {
  id: string;
  label: string;
  text: string;
};

export type EpubBook = {
  fileName: string;
  title: string;
  sections: EpubSection[];
};

const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_SECTION_CHARACTERS = 300_000;
const EPUB_TEXT_FILE = /(?:^|\/)(?:container\.xml|[^/]+\.(?:opf|ncx|xhtml|html?|xml))$/i;
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'p',
  'pre',
  'section',
  'table',
  'tr',
]);
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
    const content = extractReadableText(decodeText(contentFile));
    if (!content.text) continue;
    sections.push({
      id: `${sections.length}:${contentPath}`,
      label: content.heading || chapterLabel(contentPath, sections.length + 1),
      text: content.text.slice(0, MAX_SECTION_CHARACTERS),
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

function extractReadableText(source: string) {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const body = document.body;
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
    const block = BLOCK_ELEMENTS.has(tag);
    if (block) pieces.push('\n');
    for (const child of node.childNodes) visit(child);
    if (tag === 'td' || tag === 'th') pieces.push('\t');
    if (block) pieces.push('\n');
  };

  visit(body);
  const text = pieces
    .join('')
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const heading =
    body.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim() ||
    document.title.trim();
  return { heading, text };
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
