import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), 'openxtf-standard-'),
);
const bundlePath = path.join(temporaryDirectory, 'standard-xtfont.mjs');

try {
  await build({
    entryPoints: [path.resolve('app/standard-xtfont.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const {
    STANDARD_XTF_DEFAULTS,
    effectiveStandardEmbolden,
    officialStandardEmboldenBias,
  } = await import(pathToFileURL(bundlePath).href);

  assert.deepEqual(STANDARD_XTF_DEFAULTS, {
    fontSize: 36,
    bpp: 2,
    weight: 'normal',
    gamma: 1.8,
    thresholds: '56,120,184',
    embolden: 0,
    emboldenBias: 0.1,
    letterSpacing: 0,
    glyphScope: 'full',
    systemFallback: true,
    fileNamePattern: '[fontsize]_[fontname].xtf',
  });

  assert.equal(
    officialStandardEmboldenBias({
      inkCoverage: 0.3,
      counterOpenRatio: 0.22,
    }),
    0.1,
  );
  assert.equal(
    officialStandardEmboldenBias({
      inkCoverage: 0.35,
      counterOpenRatio: 0.22,
    }),
    0.05,
  );
  assert.equal(
    officialStandardEmboldenBias({
      inkCoverage: 0.41,
      counterOpenRatio: 0.22,
    }),
    0,
  );
  assert.equal(
    officialStandardEmboldenBias({
      inkCoverage: 0.3,
      counterOpenRatio: 0.17,
    }),
    0,
  );
  assert.equal(effectiveStandardEmbolden(0, 0.1), 0.1);
  assert.equal(effectiveStandardEmbolden(1.25, 0.05), 1.3);
  assert.equal(effectiveStandardEmbolden(-1, 0), -1);

  process.stdout.write('PASS official Standard XTFont defaults and auto-tune\n');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
