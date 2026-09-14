export const STANDARD_XTF_DEFAULTS = Object.freeze({
  fontSize: 36,
  bpp: 2 as const,
  weight: 'normal' as const,
  gamma: 1.8,
  thresholds: '56,120,184',
  embolden: 0,
  emboldenBias: 0.1,
  letterSpacing: 0,
  glyphScope: 'full' as const,
  systemFallback: true,
  fileNamePattern: '[fontsize]_[fontname].xtf',
});

export type StandardFontFeatures = {
  inkCoverage?: number;
  edgeShare?: number;
  solidShare?: number;
  counterOpenRatio?: number;
};

// XT-Cloud v1.16.8 measures a small reference specimen after loading the
// main font. It changes only the hidden morphology bias; all visible defaults
// remain unchanged. These exact thresholds come from the current route bundle.
export function officialStandardEmboldenBias(
  features: StandardFontFeatures | null | undefined,
) {
  const inkCoverage = Number(features?.inkCoverage) || 0;
  const counterOpenRatio = Number(features?.counterOpenRatio) || 0;
  if (inkCoverage > 0.4 || counterOpenRatio < 0.18) return 0;
  if (inkCoverage > 0.34) return 0.05;
  return 0.1;
}

export function effectiveStandardEmbolden(
  embolden: number,
  emboldenBias: number,
) {
  const visible = Number.isFinite(Number(embolden)) ? Number(embolden) : 0;
  const rawBias = Number(emboldenBias);
  const bias = Number.isFinite(rawBias)
    ? Math.min(0.1, Math.max(0, rawBias))
    : 0.1;
  return Number((visible + bias).toFixed(2));
}
