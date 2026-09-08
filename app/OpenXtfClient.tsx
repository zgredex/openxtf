'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  downloadFont,
  FontWorkerClient,
  formatBytes,
} from './font-worker';
import type {
  FontBuildResult,
  FontPreviewResult,
  FontWorkerError,
} from './font-worker';
import { TRANSLATIONS } from './i18n';
import type { Language } from './i18n';
import {
  applyKoreanX4Profile,
  DEFAULT_KOREAN_X4_SETTINGS,
  renderXtfDevicePreview,
} from './xtf-device';
import type {
  KoreanX4Settings,
  TypographyProfile,
} from './xtf-device';
import { readEpub } from './epub';
import type { EpubBook } from './epub';

const PREVIEW_TEXT =
  '가시는 걸음걸음 놓인 그 꽃을 사뿐히 즈려밟고 가시옵소서.';
const FONT_PATTERN = /\.(ttf|otf|ttc|otc)$/i;
const DEFAULT_OUTPUT_PATTERN =
  '[fontname]-[rastersize]px-[cellsize]-[bppname].xtf';
const NOTICE_TTL = 10_080 * 60 * 1000;

type ReadyFont = {
  id: string;
  name: string;
  fileName: string;
  url: string;
};

const READY_FONTS: ReadyFont[] = [
  {
    id: 'ridi-batang',
    name: 'RIDI Batang',
    fileName: 'RIDIBatang.otf',
    url: '/fonts/RIDIBatang.otf',
  },
];

async function loadReadyFont(readyFont: ReadyFont) {
  const response = await fetch(readyFont.url);
  if (!response.ok) throw new Error('OPENXTF_READY_FONT_LOAD_FAILED');
  return new File([await response.arrayBuffer()], readyFont.fileName, {
    type: 'font/otf',
  });
}

const WEIGHT_PRESETS = {
  thin: { gamma: 2.2, thresholds: '80,148,204' },
  light: { gamma: 2, thresholds: '68,136,196' },
  normal: { gamma: 1.8, thresholds: '56,120,184' },
  semi: { gamma: 1.6, thresholds: '46,108,172' },
  bold: { gamma: 1.45, thresholds: '38,96,160' },
} as const;

const KOREAN_NORMAL_WEIGHT = {
  gamma: 1,
  thresholds: '64,128,192',
} as const;

type WeightName = keyof typeof WEIGHT_PRESETS | 'custom';
type OutputFormat = 'xtf' | 'legacy-bin';
type GlyphScope = 'device' | 'full';
type TranslationCopy = (typeof TRANSLATIONS)[Language];

const DIAGNOSTIC_ADVANCE_SOURCES = [
  'ascii-table',
  'ascii-width',
  'full-width',
  'glyph-metadata',
  'zero-width',
  'tab-width',
] as const;

type Notice =
  | { kind: 'generate' }
  | { kind: 'download'; result: FontBuildResult }
  | null;

export default function OpenXtfClient() {
  const mainInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const epubInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<FontWorkerClient | null>(null);
  const fileIds = useRef(new WeakMap<File, number>());
  const nextFileId = useRef(0);
  const previewSequence = useRef(0);

  const [font, setFont] = useState<File | null>(null);
  const [fallbacks, setFallbacks] = useState<File[]>([]);
  const [typographyProfile, setTypographyProfile] =
    useState<TypographyProfile>('korean-x4');
  const [koreanSettings, setKoreanSettings] = useState<KoreanX4Settings>(
    DEFAULT_KOREAN_X4_SETTINGS,
  );
  const [format, setFormat] = useState<OutputFormat>('xtf');
  const [fontSize, setFontSize] = useState(29);
  const [bpp, setBpp] = useState<1 | 2>(2);
  const [weight, setWeight] = useState<WeightName>('normal');
  const [gamma, setGamma] = useState(1);
  const [thresholds, setThresholds] = useState('64,128,192');
  const [thresholdMode, setThresholdMode] = useState<'symmetric' | 'custom'>(
    'custom',
  );
  const [thresholdSpread, setThresholdSpread] = useState(64);
  const [embolden, setEmbolden] = useState(0);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [binThreshold, setBinThreshold] = useState(127);
  const [glyphScope, setGlyphScope] = useState<GlyphScope>('full');
  const [systemFallback, setSystemFallback] = useState(false);
  const [fileNamePattern, setFileNamePattern] = useState(
    DEFAULT_OUTPUT_PATTERN,
  );
  const [advanced, setAdvanced] = useState(false);
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT);
  const [epubBook, setEpubBook] = useState<EpubBook | null>(null);
  const [epubSectionIndex, setEpubSectionIndex] = useState(0);
  const [epubLoading, setEpubLoading] = useState(false);
  const [epubError, setEpubError] = useState('');
  const [preview, setPreview] = useState<FontPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [defaultCharacters, setDefaultCharacters] = useState('');
  const [extraCharacters, setExtraCharacters] = useState('');
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [defaultCharactersOpen, setDefaultCharactersOpen] = useState(false);
  const [missingCps, setMissingCps] = useState<number[]>([]);
  const [workerReady, setWorkerReady] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [results, setResults] = useState<FontBuildResult[]>([]);
  const [readyFontLoading, setReadyFontLoading] = useState<string | null>(
    READY_FONTS[0].id,
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [language, setLanguage] = useState<Language>('ko');
  const copy = TRANSLATIONS[language];
  const koreanProfileActive =
    typographyProfile === 'korean-x4' && format === 'xtf';

  const actualThresholds =
    thresholdMode === 'symmetric'
      ? `${128 - thresholdSpread},128,${128 + thresholdSpread}`
      : thresholds;
  const actualBpp = format === 'legacy-bin' ? 1 : bpp;
  const actualScope = format === 'legacy-bin' ? 'full' : glyphScope;
  const allCharacters = defaultCharacters + extraCharacters;
  const defaultCharacterCount = uniqueCodePointCount(defaultCharacters);
  const extraCharacterCount = uniqueCodePointCount(extraCharacters);
  const totalCharacterCount = uniqueCodePointCount(allCharacters);
  const koreanSpaceWidth = koreanSettings.spaceWidth;
  const missingSample = missingCps
    .slice(0, 40)
    .map((cp) => String.fromCodePoint(cp))
    .join(' ');

  const fontKey = useMemo(() => {
    const files = font ? [font, ...fallbacks] : [];
    return files
      .map((file) => {
        let id = fileIds.current.get(file);
        if (!id) {
          id = ++nextFileId.current;
          fileIds.current.set(file, id);
        }
        return id;
      })
      .join('|');
  }, [font, fallbacks]);

  useEffect(() => {
    const storedDark = localStorage.getItem('xt_dark') === '1';
    document.documentElement.classList.toggle('dark', storedDark);
    queueMicrotask(() => setDark(storedDark));

    let cancelled = false;
    const defaultReadyFont = READY_FONTS[0];
    loadReadyFont(defaultReadyFont)
      .then((readyFont) => {
        if (!cancelled) setFont((current) => current ?? readyFont);
      })
      .catch(() => {
        if (!cancelled) {
          setError(TRANSLATIONS.ko.readyFontError);
        }
      })
      .finally(() => {
        if (!cancelled) setReadyFontLoading(null);
      });

    fetch('/data/default-device-characters.txt')
      .then((response) => {
        if (!response.ok) {
          throw new Error(TRANSLATIONS.ko.defaultCharactersError);
        }
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setDefaultCharacters(text.replace(/[\r\n]/g, ''));
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });

    const worker = new FontWorkerClient();
    workerRef.current = worker;
    worker
      .probe()
      .then(() => {
        if (!cancelled) setWorkerReady(true);
      })
      .catch((reason: FontWorkerError) => {
        if (!cancelled) setError(mapWorkerError(reason, 'ko'));
      });

    return () => {
      cancelled = true;
      worker.dispose();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === 'ko'
        ? 'OpenXTF — XT 글꼴 만들기'
        : 'OpenXTF — XT Font Maker';
  }, [language]);

  useEffect(() => {
    const sequence = ++previewSequence.current;
    const worker = workerRef.current;
    if (!font || !workerReady || !worker || !defaultCharacters) {
      setPreview(null);
      setMissingCps([]);
      setPreviewLoading(false);
      setPreviewError('');
      return;
    }

    setPreviewLoading(true);
    setPreviewError('');
    let localPreviewWorker: FontWorkerClient | null = null;
    const timer = window.setTimeout(async () => {
      try {
        const prepared = await worker.prepare({
          outputFormat: format,
          fontKey,
          fontFile: font,
          fallbackFiles: fallbacks,
          missingText: allCharacters,
          fontSize,
        });
        if (sequence !== previewSequence.current) return;
        setMissingCps(prepared.missingCps || []);
        let rendered: FontPreviewResult;
        if (koreanProfileActive) {
          localPreviewWorker = new FontWorkerClient();
          await localPreviewWorker.probe();
          const previewFont = await localPreviewWorker.build({
            options: {
              ...makeOptions(),
              fontFile: font,
              fallbackFiles: [...fallbacks],
              charsText: previewText || PREVIEW_TEXT,
              glyphScope: 'device',
              systemFallback,
              fileNamePattern: 'preview.xtf',
              includePreview: false,
            },
          });
          if (sequence !== previewSequence.current) return;
          const profiledPreview = applyKoreanX4Profile(
            previewFont,
            koreanSettings,
          );
          rendered = renderXtfDevicePreview(
            profiledPreview.bytes,
            previewText,
            fontSize,
          );
        } else {
          rendered = await worker.preview({
            outputFormat: format,
            fontKey,
            fontFile: font,
            fallbackFiles: fallbacks,
            options: makeOptions(),
          });
        }
        if (sequence !== previewSequence.current) return;
        setPreview(rendered);
        setPreviewError(rendered.dataUrl ? '' : copy.previewFailed);
      } catch (reason) {
        const workerError = reason as FontWorkerError;
        if (
          sequence !== previewSequence.current ||
          workerError.code === 'XTFONT_WORKER_CANCELLED' ||
          workerError.code === 'XTFONT_PREVIEW_CANCELLED'
        ) {
          return;
        }
        setPreview(null);
        setPreviewError(mapWorkerError(workerError, language));
      } finally {
        localPreviewWorker?.dispose();
        localPreviewWorker = null;
        if (sequence === previewSequence.current) setPreviewLoading(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      localPreviewWorker?.dispose();
      worker.cancelPreview();
    };
    // makeOptions is intentionally represented by its primitive dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    font,
    fallbacks,
    fontKey,
    workerReady,
    defaultCharacters,
    extraCharacters,
    format,
    fontSize,
    bpp,
    gamma,
    actualThresholds,
    embolden,
    letterSpacing,
    binThreshold,
    glyphScope,
    systemFallback,
    previewText,
    language,
    typographyProfile,
    koreanSettings,
  ]);

  function makeOptions() {
    return {
      outputFormat: format,
      binThreshold,
      binAntialias: true,
      binGridFit: true,
      fontSize,
      bpp: actualBpp,
      renderMode: 'manual',
      gamma,
      thresholds: actualThresholds,
      embolden: koreanProfileActive
        ? Number(embolden.toFixed(2))
        : Number((embolden + 0.1).toFixed(2)),
      letterSpacing,
      previewText,
      charsText: allCharacters,
      glyphScope: actualScope,
      systemFallback,
      previewMode: 'device',
      previewDevice: 'x4',
      scale: 3,
    };
  }

  function chooseFont(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!next) return;
    if (!FONT_PATTERN.test(next.name)) {
      setError(copy.chooseFontError);
      return;
    }
    setError('');
    setSuccess(copy.loadedFont(next.name));
    setFont(next);
    setResults([]);
  }

  async function chooseReadyFont(readyFont: ReadyFont) {
    if (readyFontLoading) return;
    setReadyFontLoading(readyFont.id);
    setError('');
    try {
      const next = await loadReadyFont(readyFont);
      setFont(next);
      setSuccess(copy.loadedFont(next.name));
      setResults([]);
    } catch {
      setError(copy.readyFontError);
    } finally {
      setReadyFontLoading(null);
    }
  }

  function chooseFallbacks(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;
    const supported = selected.filter((file) => FONT_PATTERN.test(file.name));
    if (supported.length !== selected.length) {
      setError(copy.unsupportedFallbacks);
    } else {
      setError('');
    }
    setFallbacks((current) => [...current, ...supported]);
  }

  async function chooseEpub(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    setEpubLoading(true);
    setEpubError('');
    try {
      const book = await readEpub(file);
      setEpubBook(book);
      setEpubSectionIndex(0);
      setPreviewText(book.sections[0].text);
    } catch (reason) {
      setEpubBook(null);
      setEpubSectionIndex(0);
      setEpubError(
        reason instanceof Error && reason.message === 'OPENXTF_EMPTY_EPUB'
          ? copy.epubEmptyError
          : copy.epubInvalidError,
      );
    } finally {
      setEpubLoading(false);
    }
  }

  function chooseEpubSection(index: number) {
    if (!epubBook?.sections[index]) return;
    setEpubSectionIndex(index);
    setPreviewText(epubBook.sections[index].text);
  }

  function clearEpub() {
    setEpubBook(null);
    setEpubSectionIndex(0);
    setEpubError('');
    setPreviewText(PREVIEW_TEXT);
  }

  function applyWeightPreset(name: keyof typeof WEIGHT_PRESETS) {
    const preset =
      koreanProfileActive && name === 'normal'
        ? KOREAN_NORMAL_WEIGHT
        : WEIGHT_PRESETS[name];
    setWeight(name);
    setGamma(preset.gamma);
    setThresholdMode('custom');
    setThresholds(preset.thresholds);
  }

  function activateKoreanProfile() {
    setTypographyProfile('korean-x4');
    setFormat('xtf');
    setFontSize(29);
    setBpp(2);
    setWeight('normal');
    setGamma(KOREAN_NORMAL_WEIGHT.gamma);
    setThresholdMode('custom');
    setThresholds(KOREAN_NORMAL_WEIGHT.thresholds);
    setEmbolden(0);
    setLetterSpacing(0);
    setGlyphScope('full');
    setSystemFallback(false);
    setFileNamePattern(DEFAULT_OUTPUT_PATTERN);
    setKoreanSettings(DEFAULT_KOREAN_X4_SETTINGS);
    setResults([]);
    void chooseReadyFont(READY_FONTS[0]);
  }

  function activateStandardProfile() {
    setTypographyProfile('standard');
    setFontSize(36);
    setBpp(2);
    setWeight('normal');
    setGamma(1.8);
    setThresholdMode('custom');
    setThresholds('56,120,184');
    setEmbolden(0);
    setLetterSpacing(0);
    setGlyphScope('full');
    setSystemFallback(true);
    setFileNamePattern(DEFAULT_OUTPUT_PATTERN);
    setResults([]);
  }

  function updateKoreanSetting<K extends keyof KoreanX4Settings>(
    key: K,
    value: KoreanX4Settings[K],
  ) {
    setKoreanSettings((current) => ({ ...current, [key]: value }));
    setResults([]);
  }

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('xt_dark', next ? '1' : '0');
  }

  function toggleLanguage() {
    const next: Language = language === 'ko' ? 'en' : 'ko';
    setLanguage(next);
    setError('');
    setSuccess('');
  }

  function requestGenerate() {
    if (!font || building || !workerReady || !defaultCharacters) return;
    const acceptedAt = Number(
      localStorage.getItem('xtf_generate_notice_guest') || 0,
    );
    if (Date.now() - acceptedAt < NOTICE_TTL) {
      void buildFont();
    } else {
      setNotice({ kind: 'generate' });
    }
  }

  async function buildFont() {
    const worker = workerRef.current;
    if (!font || !worker) return;
    setError('');
    setSuccess('');
    setBuilding(true);
    setBuildProgress(0);
    worker.cancelPreview();
    try {
      let result = await worker.build(
        {
          options: {
            ...makeOptions(),
            fontFile: font,
            fallbackFiles: [...fallbacks],
            fileNamePattern,
            includePreview: false,
          },
        },
        setBuildProgress,
      );
      if (koreanProfileActive) {
        result = applyKoreanX4Profile(result, koreanSettings);
        setPreview(
          renderXtfDevicePreview(
            result.bytes,
            previewText,
            result.summary.fontSize,
          ),
        );
      }
      result = applyOutputFileName(result, font.name, fileNamePattern, {
        gamma,
        thresholds: actualThresholds,
        embolden: koreanProfileActive
          ? Number(embolden.toFixed(2))
          : Number((embolden + 0.1).toFixed(2)),
        letterSpacing,
      });
      setResults((current) => [result, ...current]);
      setBuildProgress(1);
      setSuccess(copy.generatedSuccess);
    } catch (reason) {
      setError(mapWorkerError(reason as FontWorkerError, language));
    } finally {
      setBuilding(false);
    }
  }

  function requestDownload(result: FontBuildResult) {
    setNotice({ kind: 'download', result });
  }

  function confirmNotice() {
    const current = notice;
    setNotice(null);
    if (!current) return;
    if (current.kind === 'generate') {
      localStorage.setItem('xtf_generate_notice_guest', String(Date.now()));
      void buildFont();
    } else {
      downloadFont(current.result);
    }
  }

  const previewStatus = !font
    ? copy.previewNoFont
    : previewError || copy.previewLoading;
  const summaryCell = koreanProfileActive
    ? `${koreanSettings.cellW}×${koreanSettings.cellH}`
    : preview?.metrics
      ? `${preview.metrics.cellW}×${preview.metrics.cellH}`
      : copy.automatic;
  const summaryFont = font
    ? font.name.replace(/\.(ttf|otf|ttc|otc)$/i, '')
    : copy.notSelected;
  const previewMissingCodePoints = preview?.device?.missingCodePoints ?? [];
  const previewMissingSample = previewMissingCodePoints
    .slice(0, 12)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join(' ');
  const diagnosticDevice = preview?.device ?? null;
  const diagnosticMetrics = preview?.metrics ?? null;
  const diagnosticLines = diagnosticDevice?.lines ?? [];
  const diagnosticGlyphs = diagnosticDevice?.glyphs ?? [];
  const diagnosticSpaces = diagnosticDevice?.spaces ?? [];
  const diagnosticHeader = diagnosticDevice?.xtfHeader;
  const diagnosticLayout = diagnosticDevice?.layout;
  const diagnosticPage = diagnosticDevice?.pageUsage;
  const diagnosticFirstHiddenCodePoint =
    diagnosticPage?.firstHiddenCharacter?.codePointAt(0);
  const diagnosticFirstHiddenLabel =
    diagnosticFirstHiddenCodePoint === undefined
      ? ''
      : `${diagnosticCharacterName(
          diagnosticFirstHiddenCodePoint,
          copy,
          diagnosticPage?.firstHiddenCharacter,
        )} (${formatCodePoint(diagnosticFirstHiddenCodePoint)})`;
  const diagnosticAdvanceUsage = DIAGNOSTIC_ADVANCE_SOURCES.map((source) => ({
    source,
    count: diagnosticGlyphs.filter((glyph) => glyph.advanceSource === source)
      .length,
  }));
  const diagnosticProtrudingGlyphs = diagnosticGlyphs.filter(
    (glyph) =>
      (glyph.advanceOverflowLeft ?? 0) > 0 ||
      (glyph.advanceOverflowRight ?? 0) > 0,
  ).length;
  const diagnosticContentOverflowGlyphs = diagnosticGlyphs.filter(
    (glyph) => glyph.contentOverflow,
  ).length;
  const diagnosticFrameClippedGlyphs = diagnosticGlyphs.filter(
    (glyph) => glyph.frameClipped,
  ).length;
  const diagnosticFallbackGlyphs = diagnosticGlyphs.filter(
    (glyph) => glyph.missing && !glyph.whitespace,
  ).length;
  const diagnosticGeneratedBoxes = diagnosticGlyphs.filter(
    (glyph) => glyph.generatedBox,
  ).length;
  const diagnosticJustifiedLines = diagnosticLines.filter(
    (line) => (line.justificationPixels ?? 0) > 0,
  ).length;
  const diagnosticAutomaticBreaks = diagnosticLines.filter(
    (line) => line.breakReason === 'automatic',
  ).length;
  const diagnosticManualBreaks = diagnosticLines.filter(
    (line) => line.breakReason === 'manual',
  ).length;
  const strokeControls =
    format === 'xtf' ? (
      <>
        <div className="space-y-2 setting-help-host" title={copy.strokeDarknessHelp}>
          <div className="flex items-center justify-between gap-3">
            <SettingLabel
              label={copy.strokeDarkness}
              help={copy.strokeDarknessHelp}
            />
            {weight === 'custom' ? (
              <span className="text-xs text-slate-400">({copy.custom})</span>
            ) : null}
          </div>
          <div className="grid grid-cols-5 gap-1">
            {Object.keys(WEIGHT_PRESETS).map((name) => (
              <button
                key={name}
                type="button"
                className={`preset-button ${weight === name ? 'is-active' : ''}`}
                onClick={() =>
                  applyWeightPreset(name as keyof typeof WEIGHT_PRESETS)
                }
              >
                {copy.weightPresets[name as keyof typeof WEIGHT_PRESETS]}
              </button>
            ))}
          </div>
          <p className="hint">{copy.strokeDarknessHint}</p>
        </div>

        <RangeField
          label={copy.strokeWeight}
          value={`${embolden.toFixed(2)} px`}
          min={-3}
          max={8}
          step={0.25}
          number={embolden}
          onChange={(value) => {
            setEmbolden(value);
            setWeight('custom');
          }}
          hint={copy.strokeWeightHint}
          tooltip={copy.strokeWeightHelp}
        />
      </>
    ) : (
      <RangeField
        label={copy.bitmapThreshold}
        value={String(binThreshold)}
        min={0}
        max={255}
        step={1}
        number={binThreshold}
        onChange={setBinThreshold}
        hint={copy.bitmapThresholdHint}
      />
    );

  return (
    <div className="app-shell min-h-screen">
      <header className="site-header">
        <div className="brand" aria-label="OpenXTF">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy">
            <strong>OpenXTF</strong>
            <small>{copy.brandSubtitle}</small>
          </span>
        </div>
        <nav className="top-nav" aria-label={copy.primaryNavigation}>
          <button
            type="button"
            className="language-button"
            aria-label={copy.switchLanguageLabel}
            onClick={toggleLanguage}
          >
            {copy.switchLanguage}
          </button>
          <button
            type="button"
            className="theme-button"
            aria-label={dark ? copy.switchToLight : copy.switchToDark}
            onClick={toggleDark}
          >
            {dark ? '☀' : '☾'}
          </button>
        </nav>
      </header>

      <main id="workspace" className="studio-main">
        <div className="studio-grid">
          <aside className="studio-inspector min-w-0">
            <section className="card space-y-3">
              <p className="label mb-0">{copy.mainFont}</p>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  className="font-picker"
                  onClick={() => mainInputRef.current?.click()}
                >
                  <span className="file-icon">T</span>
                  <span className="min-w-0 flex-1 truncate">
                    {font?.name ?? copy.pickFont}
                  </span>
                  {font ? <span className="local-badge">{copy.local}</span> : null}
                  <span className="chevron">⌄</span>
                </button>
                <button
                  type="button"
                  className="upload-button"
                  onClick={() => mainInputRef.current?.click()}
                >
                  <span aria-hidden="true">⇧</span>
                  <span className="hidden sm:inline">{copy.upload}</span>
                </button>
                <input
                  ref={mainInputRef}
                  type="file"
                  accept=".ttf,.otf,.ttc,.otc"
                  className="hidden"
                  onChange={chooseFont}
                />
              </div>
              {font ? <p className="hint">{copy.loadedFont(font.name)}</p> : null}
              <div className="ready-fonts">
                <div>
                  <p className="field-label">{copy.readyFonts}</p>
                  <p className="hint">{copy.readyFontsHint}</p>
                </div>
                {READY_FONTS.map((readyFont) => {
                  const selected = font?.name === readyFont.fileName;
                  const loading = readyFontLoading === readyFont.id;
                  return (
                    <button
                      type="button"
                      className={`ready-font-button ${selected ? 'active' : ''}`}
                      aria-pressed={selected}
                      disabled={Boolean(readyFontLoading)}
                      onClick={() => void chooseReadyFont(readyFont)}
                      key={readyFont.id}
                    >
                      <span className="file-icon">R</span>
                      <span className="min-w-0 flex-1 text-left">
                        <strong>{loading ? copy.loadingReadyFont : copy.readyFontName}</strong>
                        <small>OpenType · OTF</small>
                      </span>
                      <span className="local-badge">{copy.defaultReadyFont}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              className={`card space-y-3 ${missingCps.length ? 'missing-card' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="label mb-0">{copy.supplementalFonts}</p>
                {fallbacks.length ? (
                  <button
                    type="button"
                    className="quiet-link"
                    onClick={() => setFallbacks([])}
                  >
                    {copy.clearAll}
                  </button>
                ) : null}
              </div>
              <p className="hint">{copy.supplementalFontHint}</p>
              {missingCps.length ? (
                <div className="missing-warning">
                  <p className="font-semibold">
                    {copy.missingWarning(missingCps.length)}
                  </p>
                  <p className="mt-1 break-all font-mono leading-relaxed">
                    {missingSample}
                    {missingCps.length > 40 ? ' …' : ''}
                  </p>
                  {systemFallback ? (
                    <p className="mt-1">
                      {copy.systemFallbackOn}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {fallbacks.length ? (
                <ul className="space-y-1.5">
                  {fallbacks.map((file, index) => (
                    <li className="fallback-item" key={`${file.name}-${index}`}>
                      <span className="fallback-index">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        aria-label={copy.removeFont(file.name)}
                        onClick={() =>
                          setFallbacks((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  className="font-picker"
                  onClick={() => fallbackInputRef.current?.click()}
                >
                  <span className="file-icon">+</span>
                  <span className="min-w-0 flex-1 truncate">
                    {copy.addSupplementalFonts}
                  </span>
                  <span className="chevron">⌄</span>
                </button>
                <button
                  type="button"
                  className="upload-button"
                  onClick={() => fallbackInputRef.current?.click()}
                >
                  <span aria-hidden="true">⇧</span>
                  <span className="hidden sm:inline">{copy.upload}</span>
                </button>
                <input
                  ref={fallbackInputRef}
                  type="file"
                  multiple
                  accept=".ttf,.otf,.ttc,.otc"
                  className="hidden"
                  onChange={chooseFallbacks}
                />
              </div>
            </section>

            <section className="card space-y-4">
              <p className="label">{copy.conversionSettings}</p>
              <fieldset className="space-y-2">
                <legend className="field-label">{copy.typographyProfile}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <SegmentButton
                    active={typographyProfile === 'korean-x4'}
                    onClick={activateKoreanProfile}
                  >
                    {copy.koreanReadingProfile}
                  </SegmentButton>
                  <SegmentButton
                    active={typographyProfile === 'standard'}
                    onClick={activateStandardProfile}
                  >
                    {copy.standardProfile}
                  </SegmentButton>
                </div>
                <p className="hint">
                  {koreanProfileActive
                    ? copy.koreanProfileHint
                    : copy.standardProfileHint}
                </p>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="field-label">{copy.outputFormat}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <SegmentButton
                    active={format === 'xtf'}
                    onClick={() => setFormat('xtf')}
                  >
                    .xtf
                  </SegmentButton>
                  <SegmentButton
                    active={format === 'legacy-bin'}
                    onClick={() => {
                      activateStandardProfile();
                      setFormat('legacy-bin');
                    }}
                  >
                    .bin
                  </SegmentButton>
                </div>
              </fieldset>

              {koreanProfileActive ? (
                <div className="device-profile-panel space-y-4">
                  <div className="profile-summary">
                    <span>{copy.referenceAppearance}</span>
                    <strong>{fontSize} px · {bpp} bpp</strong>
                  </div>

                  <div className="appearance-heading">
                    <p className="field-label">{copy.xtfDeviceMetrics}</p>
                    <p className="hint">{copy.xtfMetricsHint}</p>
                  </div>

                  <section className="appearance-group">
                    <p className="appearance-group-title">
                      {copy.glyphSizeAndPosition}
                    </p>
                    <div className="settings-grid">
                      <NumberField
                        label={copy.rasterSize}
                        value={fontSize}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.rasterSizeHelp}
                        onChange={setFontSize}
                      />
                      <NumberField
                        label={copy.cellWidth}
                        value={koreanSettings.cellW}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.cellWidthHelp}
                        onChange={(value) => updateKoreanSetting('cellW', value)}
                      />
                      <NumberField
                        label={copy.cellHeight}
                        value={koreanSettings.cellH}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.cellHeightHelp}
                        onChange={(value) => updateKoreanSetting('cellH', value)}
                      />
                      <NumberField
                        label={copy.cropLeft}
                        value={koreanSettings.cropLeft}
                        min={-64}
                        max={64}
                        step={1}
                        suffix="px"
                        help={copy.cropLeftHelp}
                        onChange={(value) => updateKoreanSetting('cropLeft', value)}
                      />
                      <NumberField
                        label={copy.cropTop}
                        value={koreanSettings.cropTop}
                        min={-64}
                        max={64}
                        step={1}
                        suffix="px"
                        help={copy.cropTopHelp}
                        onChange={(value) => updateKoreanSetting('cropTop', value)}
                      />
                    </div>

                    <label
                      className="fallback-row compact-fallback-row setting-help-host"
                      title={copy.protectInkHelp}
                    >
                      <input
                        type="checkbox"
                        checked={koreanSettings.strictCrop}
                        onChange={(event) =>
                          updateKoreanSetting('strictCrop', event.target.checked)
                        }
                      />
                      <span>
                        <strong className="field-label block">
                          <SettingLabel
                            label={copy.protectInk}
                            help={copy.protectInkHelp}
                          />
                        </strong>
                        <span className="hint block">{copy.protectInkHint}</span>
                      </span>
                    </label>
                  </section>

                  <section className="appearance-group">
                    <p className="appearance-group-title">
                      {copy.textSpacingAndRhythm}
                    </p>
                    <div className="settings-grid">
                      <NumberField
                        label={copy.fullWidthAdvance}
                        value={koreanSettings.fullWidth}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.fullWidthAdvanceHelp}
                        onChange={(value) => updateKoreanSetting('fullWidth', value)}
                      />
                      <NumberField
                        label={copy.effectiveWordSpace}
                        value={koreanSettings.spaceWidth}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.wordSpaceHelp}
                        onChange={(value) => updateKoreanSetting('spaceWidth', value)}
                      />
                      <NumberField
                        label={copy.storedAdvanceY}
                        value={koreanSettings.advanceY}
                        min={1}
                        max={255}
                        step={1}
                        suffix="px"
                        help={copy.advanceYHelp}
                        onChange={(value) => updateKoreanSetting('advanceY', value)}
                      />
                    </div>
                  </section>

                  <section className="appearance-group space-y-4">
                    <p className="appearance-group-title">
                      {copy.strokeAppearance}
                    </p>
                    {strokeControls}
                  </section>
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5">
                    <span className="field-label">{copy.fontSize}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={255}
                      value={fontSize}
                      onChange={(event) => setFontSize(Number(event.target.value))}
                    />
                  </label>
                  {strokeControls}
                </>
              )}

              {!koreanProfileActive ? (
                <RangeField
                  label={copy.letterSpacing}
                  value={`${letterSpacing > 0 ? '+' : ''}${letterSpacing} px`}
                  min={-12}
                  max={16}
                  step={1}
                  number={letterSpacing}
                  onChange={setLetterSpacing}
                  hint={
                    format === 'legacy-bin'
                      ? copy.binSpacingHint
                      : copy.xtfSpacingHint
                  }
                />
              ) : null}

              <label className="fallback-row">
                <input
                  type="checkbox"
                  checked={systemFallback}
                  onChange={(event) => setSystemFallback(event.target.checked)}
                />
                <span>
                  <strong className="field-label block">
                    {copy.systemFontFallback}
                  </strong>
                  <span className="hint block">
                    {copy.systemFontFallbackHint}
                    {format === 'legacy-bin' ? copy.bmpOnly : ''}
                  </span>
                </span>
              </label>

              <div className="advanced-shell">
                <button
                  type="button"
                  className="advanced-toggle"
                  onClick={() => setAdvanced((value) => !value)}
                >
                  <span>{copy.advanced}</span>
                  <span className={advanced ? 'rotate' : ''}>⌄</span>
                </button>
                {advanced ? (
                  <div className="advanced-content space-y-4">
                    <p className="hint">{copy.advancedHint}</p>
                    <label className="block space-y-1.5">
                      <span className="field-label">
                        {copy.outputFilenamePattern}
                      </span>
                      <input
                        className="input"
                        type="text"
                        value={fileNamePattern}
                        onChange={(event) => setFileNamePattern(event.target.value)}
                      />
                      <span className="hint">{copy.placeholders}</span>
                    </label>
                    {format === 'xtf' ? (
                      <>
                      <div className="space-y-2">
                        <span className="field-label">{copy.bitDepth}</span>
                        <div className="grid grid-cols-2 gap-2">
                          <SegmentButton
                            active={bpp === 1}
                            onClick={() => setBpp(1)}
                          >
                            1 bpp
                          </SegmentButton>
                          <SegmentButton
                            active={bpp === 2}
                            onClick={() => setBpp(2)}
                          >
                            2 bpp
                          </SegmentButton>
                        </div>
                        <p className="hint">
                          {bpp === 1
                            ? copy.oneBppHint
                            : copy.twoBppHint}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <span className="field-label">{copy.characterRange}</span>
                        <div className="grid grid-cols-2 gap-2">
                          <SegmentButton
                            active={glyphScope === 'device'}
                            onClick={() => setGlyphScope('device')}
                          >
                            {copy.deviceSet}
                          </SegmentButton>
                          <SegmentButton
                            active={glyphScope === 'full'}
                            onClick={() => setGlyphScope('full')}
                          >
                            {copy.fullFont}
                          </SegmentButton>
                        </div>
                        <p className="hint">
                          {glyphScope === 'full'
                            ? copy.fullFontHint
                            : copy.deviceSetHint}
                        </p>
                      </div>
                      <div className="render-tuning space-y-2">
                        <p className="field-label">{copy.renderTuning}</p>
                        <RangeField
                          label={copy.gamma}
                          value={gamma.toFixed(2)}
                          min={0.5}
                          max={3}
                          step={0.05}
                          number={gamma}
                          onChange={(value) => {
                            setGamma(value);
                            setWeight('custom');
                          }}
                          hint=""
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="field-label">
                            {copy.thresholds}
                          </span>
                          <span className="mono">{actualThresholds}</span>
                        </div>
                        <select
                          className="input"
                          value={thresholdMode}
                          onChange={(event) => {
                            setThresholdMode(
                              event.target.value as 'symmetric' | 'custom',
                            );
                            setWeight('custom');
                          }}
                        >
                          <option value="symmetric">{copy.symmetric}</option>
                          <option value="custom">{copy.manualThresholds}</option>
                        </select>
                        {thresholdMode === 'symmetric' ? (
                          <RangeField
                            label=""
                            value=""
                            min={8}
                            max={127}
                            step={1}
                            number={thresholdSpread}
                            onChange={(value) => {
                              setThresholdSpread(value);
                              setWeight('custom');
                            }}
                            hint={copy.spreadHint(thresholdSpread)}
                          />
                        ) : (
                          <input
                            className="input"
                            value={thresholds}
                            placeholder="64,128,192"
                            onChange={(event) => {
                              setThresholds(event.target.value);
                              setWeight('custom');
                            }}
                          />
                        )}
                      </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          </aside>

          <div className="studio-canvas min-w-0">
            <section className="card studio-toolbar space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="eyebrow">
                    {format === 'xtf'
                      ? koreanProfileActive
                        ? copy.koreanReadingProfile
                        : 'XTFont v1.5 (.xtf)'
                      : copy.legacyBin}
                  </p>
                  <h2 className="workspace-title">
                    {copy.generationWorkspace}
                  </h2>
                  <p className="workspace-copy">
                    {koreanProfileActive
                      ? copy.koreanWorkspaceCopy
                      : copy.workspaceCopy}
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={!font || building || !workerReady || !defaultCharacters}
                  onClick={requestGenerate}
                >
                  {building ? copy.generating : copy.generate}
                </button>
              </div>
              <div className="build-summary" aria-label={copy.currentSettings}>
                <div>
                  <span>{copy.summaryFont}</span>
                  <strong>{summaryFont}</strong>
                </div>
                <div>
                  <span>{copy.summaryRaster}</span>
                  <strong>{fontSize} px</strong>
                </div>
                <div>
                  <span>{copy.summaryCell}</span>
                  <strong>{summaryCell}</strong>
                </div>
                <div>
                  <span>{copy.summaryDepth}</span>
                  <strong>{actualBpp} bpp</strong>
                </div>
                <div>
                  <span>{copy.summaryRange}</span>
                  <strong>{actualScope === 'full' ? copy.fullFont : copy.deviceSet}</strong>
                </div>
                <div>
                  <span>{copy.summaryOutput}</span>
                  <strong>{format === 'xtf' ? '.xtf' : '.bin'}</strong>
                </div>
              </div>
              {building ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{copy.building(fontSize)}</span>
                    <span>{Math.round(buildProgress * 100)}%</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${Math.round(buildProgress * 100)}%` }} />
                  </div>
                </div>
              ) : null}
              {error ? <p className="error-message">{error}</p> : null}
              {success ? <p className="success-message">{success}</p> : null}
            </section>

            <section className="card preview-studio min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="label mb-0">{copy.previewText}</p>
                <div className="preview-source-actions">
                  {previewLoading ? (
                    <span className="text-xs text-slate-400">
                      {copy.updatingPreview}
                    </span>
                  ) : null}
                  <input
                    ref={epubInputRef}
                    className="sr-only"
                    type="file"
                    accept=".epub,application/epub+zip"
                    onChange={chooseEpub}
                  />
                  <button
                    type="button"
                    className="secondary-btn compact-action"
                    disabled={epubLoading}
                    onClick={() => epubInputRef.current?.click()}
                  >
                    {epubLoading ? copy.loadingEpub : copy.loadEpub}
                  </button>
                  {epubBook ? (
                    <button
                      type="button"
                      className="secondary-btn compact-action"
                      onClick={clearEpub}
                    >
                      {copy.clearEpub}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-btn compact-action"
                    disabled={!preview?.device || !preview?.metrics}
                    onClick={() => setShowDiagnostics((value) => !value)}
                  >
                    {showDiagnostics
                      ? copy.hideDiagnostics
                      : copy.showDiagnostics}
                  </button>
                </div>
              </div>
              {epubError ? <p className="error-message">{epubError}</p> : null}
              {epubBook ? (
                <div className="epub-preview-panel">
                  <div>
                    <strong>{copy.epubLoaded(epubBook.title, epubBook.sections.length)}</strong>
                    <span>{epubBook.fileName}</span>
                  </div>
                  <label>
                    <span className="field-label">{copy.epubSection}</span>
                    <select
                      className="input"
                      value={epubSectionIndex}
                      onChange={(event) =>
                        chooseEpubSection(Number(event.target.value))
                      }
                    >
                      {epubBook.sections.map((section, index) => (
                        <option key={section.id} value={index}>
                          {index + 1}. {section.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">{copy.epubPrivacyHint}</p>
                </div>
              ) : null}
              <textarea
                className="input preview-text-input"
                rows={2}
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
              />
              <div className="preview-frame" aria-busy={previewLoading}>
                {preview?.dataUrl ? (
                  <button
                    type="button"
                    className="preview-image-button"
                    aria-label={copy.enlarge}
                    onClick={() => {
                      setZoom(1);
                      setEnlarged(true);
                    }}
                  >
                    {/* The worker output is generated locally from the selected font. */}
                    <span className="device-preview-sheet">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.dataUrl} alt={copy.fontPreview} />
                      {showDiagnostics &&
                      diagnosticDevice?.contentBounds &&
                      diagnosticDevice.lineTops?.length &&
                      diagnosticMetrics ? (
                        <span className="preview-diagnostic-overlay" aria-hidden="true">
                          <span
                            className="diagnostic-content-bounds"
                            style={{
                              left: `${(diagnosticDevice.contentBounds.left / diagnosticDevice.width) * 100}%`,
                              top: `${(diagnosticDevice.contentBounds.top / diagnosticDevice.height) * 100}%`,
                              width: `${((diagnosticDevice.contentBounds.right - diagnosticDevice.contentBounds.left) / diagnosticDevice.width) * 100}%`,
                              height: `${((diagnosticDevice.contentBounds.bottom - diagnosticDevice.contentBounds.top) / diagnosticDevice.height) * 100}%`,
                            }}
                          />
                          {diagnosticDevice.glyphs?.map((glyph) => (
                            <span
                              className={`diagnostic-advance-box${glyph.whitespace ? ' is-whitespace' : ''}${glyph.missing ? ' is-missing' : ''}${(glyph.advanceOverflowLeft ?? 0) > 0 || (glyph.advanceOverflowRight ?? 0) > 0 ? ' is-protruding' : ''}`}
                              style={{
                                left: `${(glyph.x / diagnosticDevice.width) * 100}%`,
                                top: `${(glyph.y / diagnosticDevice.height) * 100}%`,
                                width: `${(Math.max(1, glyph.advance) / diagnosticDevice.width) * 100}%`,
                                height: `${(diagnosticMetrics.cellH / diagnosticDevice.height) * 100}%`,
                              }}
                              key={`advance-${glyph.index}`}
                            />
                          ))}
                          {diagnosticDevice.glyphs?.map((glyph) =>
                            glyph.inkBounds ? (
                              <span
                                className={`diagnostic-ink-box${glyph.contentOverflow ? ' is-overflow' : ''}${glyph.frameClipped ? ' is-clipped' : ''}`}
                                style={{
                                  left: `${(glyph.inkBounds.x / diagnosticDevice.width) * 100}%`,
                                  top: `${(glyph.inkBounds.y / diagnosticDevice.height) * 100}%`,
                                  width: `${(glyph.inkBounds.width / diagnosticDevice.width) * 100}%`,
                                  height: `${(glyph.inkBounds.height / diagnosticDevice.height) * 100}%`,
                                }}
                                key={`ink-${glyph.index}`}
                              />
                            ) : null,
                          )}
                          {diagnosticDevice.collisionDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="diagnostic-collision-map"
                              src={diagnosticDevice.collisionDataUrl}
                              alt=""
                            />
                          ) : null}
                          {diagnosticDevice.lineTops.map((lineTop, index) => (
                            <span
                              className="diagnostic-baseline"
                              style={{
                                top: `${((lineTop + diagnosticMetrics.contentBaseline) / diagnosticDevice.height) * 100}%`,
                              }}
                              key={`${lineTop}-${index}`}
                            >
                              {index + 1}
                            </span>
                          ))}
                          {diagnosticDevice.lines?.map((line) => (
                            <span
                              className={`diagnostic-break-marker is-${line.breakReason}`}
                              style={{
                                left: `${((diagnosticDevice.contentBounds!.left + Math.min(line.usedWidth, diagnosticDevice.contentBounds!.right - diagnosticDevice.contentBounds!.left)) / diagnosticDevice.width) * 100}%`,
                                top: `${((line.top + diagnosticMetrics.cellH) / diagnosticDevice.height) * 100}%`,
                              }}
                              key={`break-${line.index}`}
                            >
                              {line.breakReason === 'automatic'
                                ? '↳'
                                : line.breakReason === 'manual'
                                  ? '↵'
                                  : line.breakReason === 'page-end'
                                    ? '■'
                                    : '•'}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <div className="preview-empty">{previewStatus}</div>
                )}
                {previewLoading && preview?.dataUrl ? (
                  <div className="preview-updating">
                    {copy.updatingPreview}
                  </div>
                ) : null}
              </div>
              {showDiagnostics && preview?.device && preview.metrics ? (
                <section className="preview-diagnostics-panel">
                  <header className="diagnostics-heading">
                    <div>
                      <p className="field-label">{copy.previewDiagnostics}</p>
                      <p className="hint">{copy.diagnosticsHint}</p>
                    </div>
                    <span className="diagnostic-model-badge">
                      V6.3.15 · {preview.device.width}×{preview.device.height}
                      {preview.device.ppi ? ` · ${preview.device.ppi} ppi` : ''}
                    </span>
                  </header>

                  <div className="diagnostic-overlay-legend">
                    <span className="is-advance">{copy.overlayAdvance}</span>
                    <span className="is-ink">{copy.overlayInk}</span>
                    <span className="is-baseline">{copy.overlayBaseline}</span>
                    <span className="is-collision">{copy.overlayCollision}</span>
                    <span className="is-break">{copy.overlayBreaks}</span>
                  </div>

                  <section className="diagnostic-section">
                    <h3>{copy.diagnosticOverview}</h3>
                    <dl className="diagnostic-metric-grid">
                      <div>
                        <dt>{copy.diagnosticLines}</dt>
                        <dd>
                          {formatLocaleNumber(preview.device.lineCount, language)} /{' '}
                          {diagnosticLayout?.maximumWholeLines ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticPageCharacters}</dt>
                        <dd>
                          {diagnosticPage
                            ? `${formatLocaleNumber(diagnosticPage.displayedCharacters, language)} / ${formatLocaleNumber(diagnosticPage.totalCharacters, language)}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticPitch}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `${diagnosticHeader.storedAdvanceY} → ${diagnosticHeader.effectiveAdvanceY} px`
                            : `${preview.metrics.advanceY} px`}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticCell}</dt>
                        <dd>
                          {preview.metrics.cellW}×{preview.metrics.cellH} ·{' '}
                          {preview.metrics.bpp} bpp
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticContentArea}</dt>
                        <dd>
                          {diagnosticLayout
                            ? `${diagnosticLayout.contentWidth}×${diagnosticLayout.contentHeight} · ${diagnosticLayout.margin}px`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticHeaderAdvances}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `${diagnosticHeader.fullWidth} / ${diagnosticHeader.asciiWidth} px`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticBaselineMetrics}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `${diagnosticHeader.ascender} / ${diagnosticHeader.descender} px`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticRecordLayout}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `${diagnosticHeader.rowStride} B/${copy.diagnosticRow} · ${diagnosticHeader.bytesPerGlyph} B/${copy.diagnosticGlyph}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticHeaderFlags}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `0x${diagnosticHeader.flags.toString(16).padStart(2, '0').toUpperCase()} · ${diagnosticHeader.metadataBytes} B`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticFontCoverage}</dt>
                        <dd>
                          {diagnosticHeader
                            ? `${formatLocaleNumber(diagnosticHeader.glyphCount, language)} / ${formatLocaleNumber(diagnosticHeader.rangeCount, language)}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticParagraphExtra}</dt>
                        <dd>{diagnosticLayout?.paragraphExtra ?? '—'} px</dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticCellOverlap}</dt>
                        <dd>{preview.metrics.cellOverlap} px</dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticVerticalUse}</dt>
                        <dd>
                          {diagnosticPage
                            ? `${diagnosticPage.usedHeight ?? 0} / ${diagnosticPage.remainingHeight ?? 0} px`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticCollision}</dt>
                        <dd>
                          {formatLocaleNumber(preview.device.inkCollisionRows, language)}{' '}
                          {copy.diagnosticRows} ·{' '}
                          {formatLocaleNumber(preview.device.inkCollisionPixels ?? 0, language)}{' '}
                          px
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.diagnosticMissing}</dt>
                        <dd>
                          {formatLocaleNumber(previewMissingCodePoints.length, language)}
                          {previewMissingSample ? ` · ${previewMissingSample}` : ''}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="diagnostic-section">
                    <h3>{copy.diagnosticAudit}</h3>
                    <div className="diagnostic-audit-grid">
                      <DiagnosticFinding
                        title={copy.diagnosticAdvanceOverflow}
                        value={formatLocaleNumber(diagnosticProtrudingGlyphs, language)}
                        detail={copy.diagnosticAdvanceOverflowDetail}
                        tone={diagnosticProtrudingGlyphs ? 'warning' : 'ok'}
                      />
                      <DiagnosticFinding
                        title={copy.diagnosticContentOverflow}
                        value={formatLocaleNumber(diagnosticContentOverflowGlyphs, language)}
                        detail={copy.diagnosticContentOverflowDetail}
                        tone={diagnosticContentOverflowGlyphs ? 'warning' : 'ok'}
                      />
                      <DiagnosticFinding
                        title={copy.diagnosticFrameClipping}
                        value={formatLocaleNumber(diagnosticFrameClippedGlyphs, language)}
                        detail={copy.diagnosticFrameClippingDetail}
                        tone={diagnosticFrameClippedGlyphs ? 'danger' : 'ok'}
                      />
                      <DiagnosticFinding
                        title={copy.diagnosticFallbacks}
                        value={`${formatLocaleNumber(diagnosticFallbackGlyphs, language)} · □ ${formatLocaleNumber(diagnosticGeneratedBoxes, language)}`}
                        detail={copy.diagnosticFallbacksDetail}
                        tone={diagnosticFallbackGlyphs ? 'warning' : 'ok'}
                      />
                      <DiagnosticFinding
                        title={copy.diagnosticLineCollisions}
                        value={`${formatLocaleNumber(preview.device.inkCollisionRows, language)} / ${formatLocaleNumber(preview.device.inkCollisionPixels ?? 0, language)}`}
                        detail={copy.diagnosticLineCollisionsDetail}
                        tone={preview.device.inkCollisionRows ? 'danger' : 'ok'}
                      />
                      <DiagnosticFinding
                        title={copy.diagnosticPageTruncation}
                        value={diagnosticPage?.truncated ? copy.yes : copy.no}
                        detail={
                          diagnosticPage?.truncated
                            ? copy.diagnosticPageTruncationDetail(
                                diagnosticPage.remainingCharacters,
                                diagnosticFirstHiddenLabel,
                              )
                            : copy.diagnosticPageFits
                        }
                        tone={diagnosticPage?.truncated ? 'warning' : 'ok'}
                      />
                    </div>
                  </section>

                  <section className="diagnostic-section">
                    <div className="diagnostic-section-heading">
                      <h3>{copy.diagnosticAdvancePaths}</h3>
                      <p>
                        {copy.diagnosticAdvancePathSummary(
                          diagnosticJustifiedLines,
                          diagnosticAutomaticBreaks,
                          diagnosticManualBreaks,
                        )}
                      </p>
                    </div>
                    <div className="diagnostic-path-grid">
                      {diagnosticAdvanceUsage.map(({ source, count }) => (
                        <div key={source}>
                          <span>{copy.diagnosticAdvanceSources[source]}</span>
                          <strong>{formatLocaleNumber(count, language)}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="diagnostic-firmware-note">
                      {copy.diagnosticAdvanceRulesHint}
                    </p>
                  </section>

                  <section className="diagnostic-section">
                    <h3>{copy.diagnosticSpaceTable}</h3>
                    <div className="diagnostic-table-scroll is-compact">
                      <table className="diagnostic-table">
                        <thead>
                          <tr>
                            <th>{copy.diagnosticCharacter}</th>
                            <th>{copy.diagnosticCodePoint}</th>
                            <th>{copy.diagnosticAdvanceSource}</th>
                            <th>{copy.diagnosticRecordPresent}</th>
                            <th>{copy.diagnosticEffectiveAdvance}</th>
                            <th>{copy.diagnosticFallback}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnosticSpaces.map((space) => (
                            <tr key={space.codePoint}>
                              <td>{diagnosticCharacterName(space.codePoint, copy)}</td>
                              <td>{formatCodePoint(space.codePoint)}</td>
                              <td>
                                {space.advanceSource
                                  ? copy.diagnosticAdvanceSources[space.advanceSource]
                                  : '—'}
                              </td>
                              <td>{space.stored ? copy.yes : copy.no}</td>
                              <td>{space.advance} px</td>
                              <td>
                                {space.fallbackSource
                                  ? copy.diagnosticFallbackSources[space.fallbackSource]
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="diagnostic-section">
                    <h3>{copy.diagnosticLineTable}</h3>
                    <div className="diagnostic-table-scroll">
                      <table className="diagnostic-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>{copy.diagnosticText}</th>
                            <th>{copy.diagnosticBreak}</th>
                            <th>{copy.diagnosticTopBaseline}</th>
                            <th>{copy.diagnosticCharacters}</th>
                            <th>{copy.diagnosticBaseWidth}</th>
                            <th>{copy.diagnosticJustification}</th>
                            <th>{copy.diagnosticUsedRemaining}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnosticLines.map((line) => (
                            <tr key={line.index}>
                              <td>{line.index + 1}</td>
                              <td className="diagnostic-text-cell">{line.text || '—'}</td>
                              <td>{copy.diagnosticBreakReasons[line.breakReason]}</td>
                              <td>{line.top} / {line.baseline}</td>
                              <td>{line.characterCount}</td>
                              <td>{line.baseWidth ?? line.usedWidth} px</td>
                              <td>
                                +{line.justificationPixels ?? 0} px ·{' '}
                                {line.justifiedSpaces ?? 0} SP
                              </td>
                              <td>
                                {line.usedWidth} / {line.remainingWidth} px
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="diagnostic-section">
                    <div className="diagnostic-section-heading">
                      <h3>{copy.diagnosticGlyphTable}</h3>
                      <p>{copy.diagnosticGlyphTableHint}</p>
                    </div>
                    <div className="diagnostic-table-scroll is-glyph-table">
                      <table className="diagnostic-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>{copy.diagnosticCharacter}</th>
                            <th>{copy.diagnosticCodePoint}</th>
                            <th>{copy.diagnosticLinePosition}</th>
                            <th>{copy.diagnosticAdvanceSource}</th>
                            <th>{copy.diagnosticStoredEffective}</th>
                            <th>{copy.diagnosticJustification}</th>
                            <th>{copy.diagnosticOffsetInk}</th>
                            <th>{copy.diagnosticAdvanceOverflow}</th>
                            <th>{copy.diagnosticFallback}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnosticGlyphs.map((glyph) => (
                            <tr
                              className={
                                glyph.frameClipped
                                  ? 'is-danger'
                                  : glyph.contentOverflow ||
                                      (glyph.advanceOverflowLeft ?? 0) > 0 ||
                                      (glyph.advanceOverflowRight ?? 0) > 0 ||
                                      glyph.missing
                                    ? 'is-warning'
                                    : ''
                              }
                              key={glyph.index}
                            >
                              <td>{glyph.index + 1}</td>
                              <td>{diagnosticCharacterName(glyph.codePoint, copy, glyph.character)}</td>
                              <td>
                                {formatCodePoint(glyph.codePoint)}
                                {glyph.renderedCodePoint !== undefined &&
                                glyph.renderedCodePoint !== glyph.codePoint
                                  ? ` → ${formatCodePoint(glyph.renderedCodePoint)}`
                                  : ''}
                              </td>
                              <td>L{glyph.lineIndex + 1} · {glyph.x},{glyph.y}</td>
                              <td>
                                {glyph.advanceSource
                                  ? copy.diagnosticAdvanceSources[glyph.advanceSource]
                                  : '—'}
                              </td>
                              <td>
                                {glyph.storedAdvance ?? '—'} /{' '}
                                {glyph.baseAdvance ?? glyph.advance} px
                              </td>
                              <td>+{glyph.justificationExtra ?? 0} px</td>
                              <td>
                                x{glyph.xOffset ?? 0} ·{' '}
                                {glyph.inkBounds
                                  ? `${glyph.inkBounds.width}×${glyph.inkBounds.height}`
                                  : '—'}
                              </td>
                              <td>
                                ←{glyph.advanceOverflowLeft ?? 0} / →{glyph.advanceOverflowRight ?? 0}
                                {glyph.contentOverflow ? ` · ${copy.diagnosticMargin}` : ''}
                                {glyph.frameClipped ? ` · ${copy.diagnosticScreen}` : ''}
                              </td>
                              <td>
                                {glyph.fallbackSource
                                  ? copy.diagnosticFallbackSources[glyph.fallbackSource]
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </section>
              ) : null}
              {preview?.dataUrl && !previewLoading ? (
                <p className="text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {copy.clickToEnlarge}
                </p>
              ) : null}
              {preview?.device && preview?.metrics ? (
                <p className="hint">
                  {koreanProfileActive
                    ? copy.koreanPreviewDetails(
                        preview.device.lineCount,
                        preview.metrics.advanceY,
                        koreanSpaceWidth,
                        preview.device.inkCollisionRows,
                      )
                    : copy.previewDetails(
                        format === 'xtf' ? 'XTF' : 'BIN',
                        preview.device.lineCount,
                        preview.metrics.advanceY,
                        preview.device.inkCollisionRows,
                      )}
                </p>
              ) : null}
            </section>

            <section className="card character-studio space-y-2">
              <button
                type="button"
                className="characters-toggle"
                onClick={() => setCharactersOpen((value) => !value)}
              >
                <span className="flex items-center gap-2">
                  <span className="label mb-0">
                    {copy.supplementalCharacters}
                  </span>
                  <span className="count-badge">
                    {formatLocaleNumber(totalCharacterCount || 19_570, language)}{copy.chars}
                  </span>
                </span>
                <span className={charactersOpen ? 'rotate' : ''}>⌄</span>
              </button>
              {!charactersOpen ? (
                <p className="hint">
                  {copy.characterSummary(
                    defaultCharacterCount || 19_570,
                    extraCharacterCount,
                    totalCharacterCount || 19_570,
                  )}
                </p>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="character-default">
                    <button
                      type="button"
                      className="characters-toggle"
                      onClick={() => setDefaultCharactersOpen((value) => !value)}
                    >
                      <span className="text-left">
                        <span className="field-label block">
                          {copy.defaultSupplementalCharacters}
                        </span>
                        <span className="hint block">
                          {copy.defaultCharactersHint(
                            defaultCharacterCount || 19_570,
                          )}
                        </span>
                      </span>
                      <span className={defaultCharactersOpen ? 'rotate' : ''}>⌄</span>
                    </button>
                    {defaultCharactersOpen ? (
                      <textarea
                        readOnly
                        className="textarea mt-3"
                        value={defaultCharacters}
                      />
                    ) : null}
                  </div>
                  <label className="block space-y-1.5">
                    <span className="field-label">
                      {copy.extraSupplementalCharacters}
                    </span>
                    <textarea
                      className="textarea"
                      value={extraCharacters}
                      placeholder={copy.extraCharactersPlaceholder}
                      onChange={(event) => setExtraCharacters(event.target.value)}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    {extraCharacters ? (
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => setExtraCharacters('')}
                      >
                        {copy.clearAll}
                      </button>
                    ) : null}
                    <span className="hint">
                      {copy.extraCharacterCount(extraCharacterCount)}
                    </span>
                  </div>
                  <p className="hint">{copy.characterModeHint}</p>
                </div>
              )}
            </section>

            <section className="card export-studio space-y-4">
              <div>
                <p className="label mb-0">{copy.results}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {results.length
                    ? copy.fileCount(results.length)
                    : copy.noOutput}
                </p>
              </div>
              {results.length ? (
                <div className="space-y-3">
                  {results.map((result, index) => (
                    <div className="result-card" key={`${result.fileName}-${index}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {result.fileName}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatBytes(result.summary.fileSize || result.bytes.length)}
                            {' · '}
                            {result.summary.format === 'legacy-bin'
                              ? copy.legacySummary(
                                  result.summary.slotCount,
                                  result.summary.glyphCount,
                                )
                              : copy.xtfSummary(
                                  result.summary.glyphCount,
                                  result.summary.rangeCount,
                                )}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn shrink-0"
                          onClick={() => requestDownload(result)}
                        >
                          {copy.download}
                        </button>
                      </div>
                      <div className="result-stats">
                        <Stat
                          label={copy.cell}
                          value={`${result.summary.cellW}×${result.summary.cellH}`}
                        />
                        <Stat
                          label={copy.bytesPerGlyph}
                          value={String(result.summary.bytesPerGlyph)}
                        />
                        <Stat
                          label={copy.missing}
                          value={String(result.summary.missingCount)}
                          danger
                        />
                        <Stat
                          label={copy.resultBitDepth}
                          value={`${result.summary.bpp} bpp`}
                        />
                        {result.summary.profile === 'korean-x4' ? (
                          <>
                            <Stat
                              label={copy.effectiveWordSpace}
                              value={`${result.summary.effectiveSpace ?? 0} px`}
                            />
                            <Stat
                              label={copy.sourceCell}
                              value={`${result.summary.sourceCellW ?? 0}×${result.summary.sourceCellH ?? 0}`}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="results-empty">{copy.resultsEmpty}</div>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer>
        <p>© 2026 OpenXTF</p>
        <p>{copy.fontAttribution}</p>
      </footer>

      {notice ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="notice-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={copy.rightsNotice}
          >
            <p>
              {notice.kind === 'generate'
                ? copy.generationRights
                : copy.downloadRights}
            </p>
            <div>
              <button type="button" onClick={() => setNotice(null)}>
                {copy.cancel}
              </button>
              <button type="button" onClick={confirmNotice}>
                {copy.confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {enlarged && preview?.dataUrl ? (
        <div
          className="preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={copy.enlargedTitle}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEnlarged(false);
          }}
        >
          <header>
            <div>
              <h2>{copy.enlargedTitle}</h2>
              <p>
                {preview.device?.width} × {preview.device?.height} px
              </p>
            </div>
            <button type="button" onClick={() => setEnlarged(false)}>
              ×
            </button>
          </header>
          <div className="preview-toolbar">
            <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}>
              −
            </button>
            <output>{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => setZoom((value) => Math.min(4, value * 1.25))}>
              +
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              100%
            </button>
          </div>
          <div className="preview-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.dataUrl}
              alt={copy.fontPreview}
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
          <p className="preview-footer">{copy.zoomHint}</p>
        </div>
      ) : null}
    </div>
  );
}

function SegmentButton({
  active = false,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`segment-button ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DiagnosticFinding({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'ok' | 'warning' | 'danger';
}) {
  return (
    <article className={`diagnostic-finding is-${tone}`}>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function formatCodePoint(codePoint: number) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint > 0xffff ? 6 : 4, '0')}`;
}

function diagnosticCharacterName(
  codePoint: number,
  copy: TranslationCopy,
  character?: string,
) {
  if (codePoint === 0x20) return copy.diagnosticSpaceNames.space;
  if (codePoint === 0x00a0) return copy.diagnosticSpaceNames.noBreakSpace;
  if (codePoint === 0x3000) return copy.diagnosticSpaceNames.ideographicSpace;
  if (codePoint === 0x09) return copy.diagnosticSpaceNames.tab;
  return character || String.fromCodePoint(codePoint);
}

function SettingLabel({ label, help }: { label: string; help?: string }) {
  return (
    <span className="setting-label">
      <span className="setting-label-text">{label}</span>
      {help ? (
        <span className="setting-info" aria-hidden="true">
          ?
        </span>
      ) : null}
    </span>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  number,
  onChange,
  hint,
  tooltip,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  number: number;
  onChange: (value: number) => void;
  hint: string;
  tooltip?: string;
}) {
  return (
    <div
      className={`space-y-2 ${tooltip ? 'setting-help-host' : ''}`}
      title={tooltip}
    >
      {label || value ? (
        <div className="flex items-center justify-between gap-3">
          <span className="field-label">
            <SettingLabel label={label} help={tooltip} />
          </span>
          <span className="mono">{value}</span>
        </div>
      ) : null}
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={number}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  help?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label
      className={`number-field ${help ? 'setting-help-host' : ''}`}
      title={help}
    >
      <SettingLabel label={label} help={help} />
      <span className="number-input-wrap">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}

function Stat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={danger ? 'text-rose-500' : ''}>{value}</strong>
    </div>
  );
}

function uniqueCodePointCount(text: string) {
  return new Set(
    Array.from(text.replace(/[\r\n]/g, '')).map((character) =>
      character.codePointAt(0),
    ),
  ).size;
}

function formatLocaleNumber(value: number, language: Language) {
  return value.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US');
}

function applyOutputFileName(
  result: FontBuildResult,
  sourceName: string,
  pattern: string,
  settings: {
    gamma: number;
    thresholds: string;
    embolden: number;
    letterSpacing: number;
  },
): FontBuildResult {
  const now = new Date();
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  const fontName = sourceName.replace(/\.[^.]+$/, '') || 'font';
  const rasterSize = result.summary.fontSize;
  const extension =
    result.summary.format === 'legacy-bin' ? '.bin' : '.xtf';
  const replacements: Record<string, string> = {
    '[fontname]': fontName,
    '[fontsize]': String(rasterSize),
    '[rastersize]': String(rasterSize),
    '[bpp]': String(result.summary.bpp),
    '[bppname]': `${result.summary.bpp}bpp`,
    '[cellwidth]': String(result.summary.cellW),
    '[cellheight]': String(result.summary.cellH),
    '[cellsize]': `${result.summary.cellW}x${result.summary.cellH}`,
    '[advancey]': String(
      result.summary.advanceY ?? result.summary.cellH,
    ),
    '[spacing]': String(settings.letterSpacing),
    '[gamma]': String(settings.gamma),
    '[thresholds]': settings.thresholds.trim().replace(/[,\s]+/g, '-'),
    '[embolden]': String(settings.embolden),
    '[datetime]': `${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}_${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`,
    '[date]': `${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}`,
    '[time]': `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`,
    '[year]': String(now.getFullYear()),
    '[month]': twoDigits(now.getMonth() + 1),
    '[day]': twoDigits(now.getDate()),
  };

  let fileName = String(pattern || DEFAULT_OUTPUT_PATTERN);
  for (const [placeholder, value] of Object.entries(replacements)) {
    fileName = fileName.replaceAll(placeholder, value);
  }
  fileName =
    fileName
      .replace(/[\\/:*?"<>|\0]/g, '_')
      .split(/[\\/]+/)
      .pop() || `font${extension}`;
  if (fileName === '.' || fileName === '..') fileName = `font${extension}`;
  fileName = fileName.replace(/\.(?:xtf|bin)$/i, '') + extension;

  return { ...result, fileName };
}

function mapWorkerError(error: FontWorkerError, language: Language) {
  const copy = TRANSLATIONS[language];
  switch (error.code) {
    case 'XTFONT_FONT_REQUIRED':
      return copy.fontRequiredError;
    case 'XTFONT_NO_GLYPHS':
      return copy.noGlyphsError;
    case 'XTFONT_INVALID_THRESHOLDS':
      return copy.invalidThresholdsError;
    case 'XTFONT_FONT_LOAD_TIMEOUT':
      return copy.fontLoadTimeoutError;
    case 'XTFONT_LEGACY_BIN_ERROR':
      return copy.legacyBinError;
    case 'XTFONT_INVALID_FONT_FILE':
      return copy.invalidFontError;
    case 'LEGACY_BIN_INIT_ERROR':
      return copy.freeTypeError;
    case 'XTF_PROFILE_CROP_INK':
      return copy.cropInkError;
    case 'XTFONT_WORKER_UNSUPPORTED':
    case 'XTFONT_WORKER_UNAVAILABLE':
      return copy.workerError;
    default:
      return copy.generationError;
  }
}
