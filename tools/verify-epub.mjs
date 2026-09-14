import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'openxtf-epub-'));
const epubBundlePath = path.join(temporaryDirectory, 'epub.mjs');
const hyphenationBundlePath = path.join(temporaryDirectory, 'hyphenation.mjs');

try {
  await Promise.all([
    build({
      entryPoints: [path.resolve('app/epub.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outfile: epubBundlePath,
      logLevel: 'silent',
    }),
    build({
      entryPoints: [path.resolve('app/v6315-hyphenation.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outfile: hyphenationBundlePath,
      logLevel: 'silent',
    }),
  ]);

  const { normalizeFirmwareInlineRuns } = await import(
    pathToFileURL(epubBundlePath).href
  );
  const { firmwareHyphenationPoints } = await import(
    pathToFileURL(hyphenationBundlePath).href
  );

  const normalize = (text, bold = false, italic = false) =>
    normalizeFirmwareInlineRuns([{ text, bold, italic, tokenId: 0 }]);
  const flattened = (runs) => runs.map((run) => run.text).join('');

  // FUN_420d7794 collapses only TAB/LF/CR/SPACE. Leading and trailing runs
  // vanish; VT and FF stay literal; U+00A0 remains a separate token.
  const whitespace = normalize(' \tA \n\r B\vC\fD\u00a0E  ');
  assert.equal(flattened(whitespace), 'A B\vC\fD\u00a0E');
  assert.deepEqual(
    whitespace.map((run) => run.tokenId),
    [0, 1, 2, 3, 4],
  );

  // FUN_4206e84e accepts only its compact, case-sensitive entity table and
  // numeric BMP scalars. Unknown, overlong, and non-BMP names remain literal.
  assert.equal(
    flattened(normalize('&Auml;&auml;&#44032;&#xAC01;&nbsp;')),
    'Ää가각\u00a0',
  );
  assert.equal(flattened(normalize('&bogus;')), '&bogus;');
  assert.equal(flattened(normalize('&NotEqualTilde;')), '&NotEqualTilde;');
  assert.equal(flattened(normalize('&#x1F600;')), '&#x1F600;');

  // Direct formatting controls are removed, and numeric entities resolving
  // to the same controls are consumed by the firmware entity path.
  assert.equal(flattened(normalize('A\u200b\u202e\ufeffB')), 'AB');
  assert.equal(flattened(normalize('A&#x200B;&#8238;&#65279;B')), 'AB');

  // FUN_4206e6e6 maps mathematical alphanumerics to ASCII plus exact inline
  // state bytes. The XTF painter later consumes those state bytes invisibly.
  const mathematical = normalize('𝐀𝐴');
  assert.equal(flattened(mathematical), 'AA');
  assert.deepEqual(mathematical[0].embeddedControlsBefore, [0x02]);
  assert.deepEqual(mathematical[0].embeddedControlsAfter, [0x03]);
  assert.deepEqual(mathematical[1].embeddedControlsBefore, [0x1c]);
  assert.deepEqual(mathematical[1].embeddedControlsAfter, [0x1d]);

  // Exact packed dictionaries recovered from V6.3.15. Korean has no
  // dictionary; an explicit soft hyphen remains available in supported text.
  assert.deepEqual(firmwareHyphenationPoints('representation', 'en'), [3, 5, 8, 10]);
  assert.deepEqual(firmwareHyphenationPoints('nieprzewidywalność', 'pl'), [3, 7, 9, 11, 14]);
  assert.deepEqual(firmwareHyphenationPoints('неопределенность', 'ru'), [6, 8, 11]);
  assert.deepEqual(firmwareHyphenationPoints('가나다라마바사', 'ko'), []);
  assert.deepEqual(firmwareHyphenationPoints('abc\u00addef', 'en'), [3]);

  process.stdout.write('V6.3.15 EPUB tokenizer and hyphenation fixtures passed.\n');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
