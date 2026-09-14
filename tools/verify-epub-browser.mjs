#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { build } from 'esbuild';
import { strToU8, zipSync } from 'fflate';

const port = Number(process.env.GECKODRIVER_PORT || 4446);
const driverOrigin = `http://127.0.0.1:${port}`;
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const parserBundle = await build({
  entryPoints: ['app/epub.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'OpenXtfEpubFixture',
  platform: 'browser',
  target: 'firefox128',
  write: false,
  logLevel: 'silent',
});
const parserSource = `${parserBundle.outputFiles[0].text}\nwindow.__openXtfEpub = OpenXtfEpubFixture;`;

const containerXml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles>
</container>`;
const packageXml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Firmware XHTML fixture</dc:title><dc:language>ko</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="image" href="tiny.xtg" media-type="application/x-xtg"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;
const chapterXhtml = `<!doctype html><html><head>
  <title>Ignored head title</title><style>.center { line-height: 9 }</style>
</head><body>
  <p class="title1c">Alpha <span class="center" style="font-size:99px">Beta</span></p>
  <p class="center">Centered</p>
  <p class="align_center">Not centered</p>
  <h2>Heading <strong>bold <b>nested</b> tail</strong></h2>
  <p>Before<br/>After</p>
  <p>   </p>
  <script>IGNORED SCRIPT</script><noscript>IGNORED NOSCRIPT</noscript>
  <nav>Navigation text</nav>
  <div class="center"><div>Same tag nested</div><p>Different tag</p>Tail</div>
  <p>Prefix<center>late center</center>suffix</p>
  <p>Before image<img src="tiny.xtg" alt="ALT MUST NOT APPEAR"/>After image</p>
</body></html>`;
const xtg = new Uint8Array(22 + 3);
xtg.set([0x58, 0x54, 0x47, 0x00, 0x02, 0x00, 0x03, 0x00]);
new DataView(xtg.buffer).setUint32(10, 3, true);
xtg.set([0x00, 0x00, 0x00], 22);
const epubBytes = zipSync({
  'META-INF/container.xml': strToU8(containerXml),
  'OPS/content.opf': strToU8(packageXml),
  'OPS/chapter.xhtml': strToU8(chapterXhtml),
  'OPS/tiny.xtg': xtg,
});
const epubBase64 = Buffer.from(epubBytes).toString('base64');

let sessionId;
let driverLog = '';
const driver = spawn(process.env.GECKODRIVER || 'geckodriver', [
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
]);
driver.stdout.on('data', (chunk) => { driverLog += chunk; });
driver.stderr.on('data', (chunk) => { driverLog += chunk; });

async function webdriver(method, pathname, body) {
  const response = await fetch(`${driverOrigin}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `WebDriver ${method} ${pathname} failed (${response.status}): ${JSON.stringify(payload).slice(0, 600)}`,
    );
  }
  return payload.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${driverOrigin}/status`);
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`geckodriver did not start.\n${driverLog.slice(-1200)}`);
}

const execute = (script, args = []) =>
  webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args });

try {
  await waitForDriver();
  const session = await webdriver('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          args: ['-headless'],
          ...(process.env.FIREFOX_BINARY
            ? { binary: process.env.FIREFOX_BINARY }
            : {}),
        },
      },
    },
  });
  sessionId = session.sessionId;
  await webdriver('POST', `/session/${sessionId}/url`, { url: 'about:blank' });
  await execute('eval(arguments[0]); return true;', [parserSource]);
  await execute(`
    const bytes = Uint8Array.from(atob(arguments[0]), (character) => character.charCodeAt(0));
    const file = new File([bytes], 'fixture.epub', { type: 'application/epub+zip' });
    window.__openXtfEpubResult = { status: 'running' };
    window.__openXtfEpub.readEpub(file).then((book) => {
      window.__openXtfEpubResult = {
        status: 'done',
        book: {
          ...book,
          sections: book.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) => ({
              ...block,
              image: block.image ? {
                archivePath: block.image.archivePath,
                mediaType: block.image.mediaType,
                width: block.image.width,
                height: block.image.height,
              } : undefined,
            })),
          })),
        },
      };
    }).catch((error) => {
      window.__openXtfEpubResult = { status: 'error', error: String(error) };
    });
    return true;
  `, [epubBase64]);

  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(100);
    result = await execute('return window.__openXtfEpubResult || null;');
    if (result?.status === 'done') break;
    if (result?.status === 'error') throw new Error(result.error);
  }
  assert.equal(result?.status, 'done');
  const book = result.book;
  assert.equal(book.title, 'Firmware XHTML fixture');
  assert.equal(book.language, 'ko');
  assert.equal(book.sections.length, 1);
  const section = book.sections[0];
  assert.equal(section.skippedEmptyBlocks, 1);
  assert.equal(section.blocks.some((block) => block.text.includes('IGNORED')), false);
  assert.equal(section.blocks.some((block) => block.text.includes('ALT MUST')), false);

  const byText = (text) => section.blocks.find((block) => block.text === text);
  assert.equal(byText('Alpha Beta').recordPrefix, null);
  assert.equal(byText('Alpha Beta').textAlign, null);
  assert.equal(byText('Centered').recordPrefix, 0x1e);
  assert.equal(byText('Centered').textAlign, 'center');
  assert.equal(byText('Not centered').recordPrefix, null);
  assert.equal(byText('Navigation text').tag, 'nav');
  assert.deepEqual(byText('Before').breakAfter, 'soft');
  assert.equal(byText('After').startsParagraph, false);

  const heading = byText('Heading bold nested tail');
  assert.equal(heading.recordPrefix, 0x01);
  assert.equal(heading.syntheticBold, true);
  assert.deepEqual(
    heading.inlineRuns.map((run) => [run.text, run.bold]),
    [
      ['Heading', false],
      [' ', false],
      ['bold', true],
      [' ', true],
      ['nested', true],
      [' ', false],
      ['tail', false],
    ],
  );

  for (const text of ['Same tag nested', 'Different tag', 'Tail']) {
    assert.equal(byText(text).recordPrefix, 0x1e);
    assert.equal(byText(text).textAlign, 'center');
  }
  const lateCenter = byText('Prefixlate centersuffix');
  assert.ok(
    lateCenter,
    `late-center record missing: ${JSON.stringify(section.blocks.map((block) => block.text))}`,
  );
  assert.equal(lateCenter.recordPrefix, null);
  assert.equal(lateCenter.textAlign, null);

  const imageIndex = section.blocks.findIndex((block) => block.image);
  assert.ok(imageIndex > 0);
  assert.equal(section.blocks[imageIndex - 1].text, 'Before image');
  assert.equal(section.blocks[imageIndex].image.archivePath, 'OPS/tiny.xtg');
  assert.equal(section.blocks[imageIndex].image.width, 2);
  assert.equal(section.blocks[imageIndex].image.height, 3);
  assert.equal(section.blocks[imageIndex + 1].text, 'After image');
  assert.equal(section.blocks.at(-1).breakAfter, 'text-end');

  process.stdout.write('V6.3.15 in-browser EPUB tag-state fixture passed.\n');
} finally {
  if (sessionId) {
    await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  }
  driver.kill('SIGTERM');
}
