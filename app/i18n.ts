export type Language = 'ko' | 'en';

const koNumber = (value: number) => value.toLocaleString('ko-KR');
const enNumber = (value: number) => value.toLocaleString('en-US');

export const TRANSLATIONS = {
  ko: {
    primaryNavigation: '기본 탐색',
    switchLanguage: 'English',
    switchLanguageLabel: '영어로 전환',
    switchToLight: '라이트 모드로 전환',
    switchToDark: '다크 모드로 전환',
    brandSubtitle: '기기를 위한 활자 공방',
    workflowLabel: 'XTF 만들기 단계',
    workflowSteps: ['글꼴 선택', '미리보기 확인', 'XTF 생성'],
    mainFont: '글꼴 소스',
    pickFont: '글꼴 선택…',
    local: '로컬',
    upload: '업로드',
    loadedFont: (name: string) => `불러온 글꼴: ${name}`,
    readyFonts: '바로 선택할 수 있는 글꼴',
    readyFontsHint: '업로드하지 않고 바로 사용할 수 있습니다.',
    defaultReadyFont: '기본',
    readyFontName: 'RIDI바탕',
    loadingReadyFont: 'RIDI바탕 불러오는 중…',
    readyFontError:
      '내장 RIDI바탕 글꼴을 불러올 수 없습니다. 페이지를 새로고침한 뒤 다시 시도하세요.',
    supplementalFonts: '대체 글꼴',
    clearAll: '모두 지우기',
    supplementalFontHint:
      '기본 글꼴에 없는 문자는 대체 글꼴을 사용해 자동으로 표시합니다.',
    missingWarning: (count: number) =>
      `기본 글꼴과 대체 글꼴에서 아직 지원되지 않는 문자 ${koNumber(count)}개는 제외됩니다. 다음 문자를 포함하는 대체 글꼴을 업로드하거나 불러오세요:`,
    systemFallbackOn:
      '시스템 글꼴 대체가 켜져 있어 위 문자는 브라우저의 시스템 글꼴로 글꼴 파일에 렌더링됩니다.',
    removeFont: (name: string) => `${name} 삭제`,
    addSupplementalFonts: '대체 글꼴 추가',
    conversionSettings: '글자 모양',
    typographyProfile: '타이포그래피 프로필',
    koreanReadingProfile: '한국어 독서',
    standardProfile: '표준 XTFont',
    koreanProfileHint:
      'RIDI바탕 기준의 38px 래스터, 39×38 셀, 2bpp와 9px 단어 간격을 기본으로 사용합니다. 값은 아래에서 조정할 수 있습니다.',
    standardProfileHint:
      '공식 XTFont Maker와 동일한 자동 측정 및 직렬화 동작을 사용합니다.',
    outputFormat: '출력 형식',
    fontSize: '글꼴 크기',
    rasterSize: '래스터 크기',
    rasterSizeHint:
      '38px는 한국어 독서 프로필의 기준 래스터 크기입니다. 셀 크기와 별도로 원본 글리프를 래스터화할 때 사용됩니다.',
    referenceAppearance: '현재 래스터 출력',
    deviceLineSpacing: '기기 줄 간격',
    lineTight: (pixels: number) => `좁게 · ${pixels}px`,
    lineNormal: (pixels: number) => `보통 · ${pixels}px (기본)`,
    lineWide: (pixels: number) => `넓게 · ${pixels}px`,
    lineSpacingHint: (pixels: number) =>
      `미리보기 줄 중심 간격은 ${pixels}px입니다. X4에서도 같은 줄 간격 단계를 선택하세요.`,
    deviceLayoutSettings: '기기 레이아웃 설정',
    paragraphGap: '문단 추가 간격',
    firstLineIndent: '첫 줄 들여쓰기',
    deviceTracking: '기기 자간',
    pageMargin: '미리보기 여백',
    charactersUnit: '자',
    deviceOnlySettingsHint:
      '이 값들은 기기/책 레이아웃을 재현하는 미리보기 설정입니다. XTF 파일에는 저장되지 않으므로 X4와 같은 값으로 맞추세요.',
    xtfDeviceMetrics: 'XTF 글꼴 모양 설정',
    cellWidth: '셀 너비',
    cellHeight: '셀 높이',
    cropLeft: '왼쪽 자르기',
    cropTop: '위쪽 자르기',
    storedAdvanceY: '저장 advanceY',
    fullWidthAdvance: '전각 공백(U+3000) 너비',
    asciiMeanWidth: 'ASCII 평균 너비',
    ascender: '어센더',
    descender: '디센더',
    effectiveWordSpace: '실제 단어 간격',
    xtfMetricsHint:
      '여기에는 X4의 글자 모양이나 배치에 실제로 영향을 주는 XTF 값만 표시됩니다. 단어 간격은 셀 너비÷4이고, 줄 간격의 기준은 셀 높이입니다. 자르기는 저장되는 글리프 픽셀의 위치를 바꿉니다.',
    protectInk: '잉크 손실 방지',
    protectInkHint:
      '목표 셀로 자를 때 글리프 픽셀이 하나라도 사라지면 생성을 중단합니다.',
    strokeDarkness: '획 농도',
    custom: '사용자 지정',
    weightPresets: {
      thin: '얇게',
      light: '연하게',
      normal: '기본',
      semi: '진하게',
      bold: '매우 진하게',
    },
    strokeDarknessHint:
      '왼쪽에서 오른쪽으로 갈수록 글리프가 진해집니다. 회색조 분포에만 영향을 주며 글리프 모양은 바뀌지 않습니다.',
    strokeWeight: '획 굵기',
    strokeWeightHint:
      '양수는 획을 굵게 하고, 음수는 비트맵 형태 연산으로 획을 가늘게 합니다.',
    bitmapThreshold: '비트맵 임계값',
    bitmapThresholdHint:
      '임계값보다 진한 픽셀만 유지합니다. 값이 낮을수록 획이 더 진해집니다.',
    letterSpacing: '자간',
    binSpacingHint:
      'BIN 파일에 저장되는 셀 너비를 조정합니다. 양수는 자간을 넓히고 음수는 좁히며, 너무 많이 줄이면 획이 잘릴 수 있습니다.',
    xtfSpacingHint:
      '글리프별 가로 간격을 픽셀 단위로 조정합니다. 양수는 넓히고 음수는 글리프가 겹치지 않는 범위에서 좁힙니다.',
    systemFontFallback: '시스템 글꼴 대체',
    systemFontFallbackHint:
      '기본 글꼴과 대체 글꼴에 없는 문자는 브라우저의 시스템 글꼴로 렌더링합니다. 기본 글꼴과 모양이 다를 수 있습니다.',
    bmpOnly: ' BMP 문자만 지원합니다.',
    outputFilenamePattern: '출력 파일 이름 형식',
    placeholders:
      '자리표시자: [fontname], [rastersize], [cellsize], [bppname], [spacing], [gamma], [thresholds], [embolden], [date], [time] 등',
    advanced: '고급 설정',
    advancedHint:
      '비트 심도, 파일 이름, 렌더링 조정을 설정합니다. 대부분은 기본값을 그대로 사용하면 됩니다.',
    bitDepth: '비트 심도',
    oneBppHint: '1bpp는 이진 글리프를 사용하며 파일 크기가 더 작습니다.',
    twoBppHint:
      '2bpp는 네 단계 회색조를 사용해 글자 가장자리를 더 부드럽게 표현합니다.',
    characterRange: '문자 범위',
    deviceSet: '기기 문자 세트',
    fullFont: '전체 글꼴',
    fullFontHint:
      '기본 글꼴의 cmap에 포함된 모든 문자를 생성합니다. 시간과 메모리가 훨씬 더 많이 필요합니다.',
    deviceSetHint:
      'X4 기본 문자 세트와 추가 문자만 생성합니다. 출력이 작고 모바일에서 더 안정적입니다.',
    renderTuning: '렌더링 조정',
    gamma: '감마(대비)',
    thresholds: '임계값(회색조)',
    symmetric: '대칭',
    manualThresholds: '수동 t0,t1,t2',
    spreadHint: (spread: number) => `간격 ${spread}, 128을 중심으로 적용합니다.`,
    legacyBin: '레거시 BIN (.bin)',
    generationWorkspace: '출력 준비',
    workspaceCopy:
      '선택한 글꼴과 현재 설정으로 XT 기기용 파일을 만듭니다. 모든 처리는 이 브라우저 안에서만 이루어집니다.',
    koreanWorkspaceCopy:
      '선택한 글꼴을 현재 XTF 설정으로 변환하고, 생성된 글리프 데이터로 기기 미리보기를 구성합니다.',
    generating: '생성 중',
    generate: '생성',
    building: (size: number) => `생성 중 1/1: ${size}px`,
    generatedSuccess: '글꼴 파일 1개를 생성했습니다. 아래에서 다운로드하세요.',
    currentSettings: '현재 생성 설정',
    summaryFont: '글꼴',
    summaryRaster: '래스터',
    summaryCell: '셀',
    summaryDepth: '비트 심도',
    summaryRange: '문자 범위',
    summaryOutput: '출력',
    automatic: '자동',
    notSelected: '선택 전',
    previewText: '읽기 미리보기',
    loadEpub: 'EPUB 불러오기',
    loadingEpub: 'EPUB 읽는 중…',
    clearEpub: 'EPUB 닫기',
    epubSection: '미리볼 장',
    epubLoaded: (title: string, count: number) =>
      `${title} · 본문 ${count}개`,
    epubPrivacyHint:
      'EPUB은 브라우저 안에서만 열립니다. 선택한 장의 텍스트와 문단 구분을 XTF 기기 미리보기에 적용하며, 책의 CSS·이미지·루비는 재현하지 않습니다.',
    epubInvalidError:
      '이 EPUB을 읽을 수 없습니다. DRM이 없는 표준 EPUB 파일인지 확인하세요. 최대 크기는 100MB입니다.',
    epubEmptyError: 'EPUB의 읽기 순서에서 표시할 본문을 찾지 못했습니다.',
    updatingPreview: '미리보기 업데이트 중',
    deviceLayout: '기기 레이아웃',
    enlarge: '크게 보기',
    fontPreview: '글꼴 미리보기',
    previewNoFont: '글꼴을 불러오면 실시간 미리보기가 여기에 표시됩니다.',
    previewLoading: '글꼴을 불러와 미리보기를 렌더링하는 중…',
    previewFailed: '미리보기를 만들 수 없습니다. 글꼴 파일이나 미리보기 텍스트를 확인하세요.',
    clickToEnlarge: '미리보기를 클릭하거나 탭하여 크게 보기',
    previewDiagnostics: '미리보기 진단',
    showDiagnostics: '진단 표시',
    hideDiagnostics: '진단 숨기기',
    diagnosticsHint:
      '최종 글리프 데이터에서 계산한 정보입니다. 진단 표시는 XTF 출력에 영향을 주지 않습니다.',
    diagnosticLines: '표시된 줄',
    diagnosticPitch: '줄 중심 간격',
    diagnosticCell: '글리프 셀',
    diagnosticSpace: '단어 간격',
    diagnosticCollision: '줄 간 잉크 충돌',
    diagnosticMissing: '미표시 문자',
    previewDetails: (
      format: 'XTF' | 'BIN',
      lines: number,
      advance: number,
      collisions: number,
    ) =>
      `최종 ${format} 글리프, 너비, 줄 간격으로 구성됨 (${lines}줄, 행당 ${advance}px)${
        format === 'XTF'
          ? `; 빈 픽셀은 인접 행을 지우지 않으며 현재 잉크 충돌은 ${collisions}px입니다.`
          : '.'
      }`,
    koreanPreviewDetails: (
      lines: number,
      pitch: number,
      space: number,
      collisions: number,
    ) =>
      `최종 XTF 셀을 X4 V6.3.15 방식으로 렌더링했습니다. ${lines}줄 · 줄 간격 ${pitch}px · 단어 간격 ${space}px · 줄 간 잉크 충돌 ${collisions}px.`,
    supplementalCharacters: '포함할 문자',
    chars: '자',
    characterSummary: (defaults: number, extras: number, total: number) =>
      `기본 ${koNumber(defaults)}자, 추가 ${koNumber(extras)}자, 보조 문자 총 ${koNumber(total)}자. 탭하여 보거나 편집하세요.`,
    defaultSupplementalCharacters: '기본 보조 문자',
    defaultCharactersHint: (count: number) =>
      `기본으로 보조 문자 ${koNumber(count)}자를 사용합니다. 탭하여 전체 목록을 확인하세요.`,
    extraSupplementalCharacters: '추가 보조 문자',
    extraCharactersPlaceholder:
      '선택 사항. 기본 보조 문자 세트 외에 반드시 포함할 문자를 입력하세요.',
    extraCharacterCount: (count: number) => `추가 문자 ${koNumber(count)}자`,
    characterModeHint:
      '기기 문자 세트 모드는 기본 세트와 추가 문자를 생성합니다. 전체 글꼴 모드는 기본 글꼴의 cmap도 합칩니다. 줄바꿈은 무시하고 공백은 유지합니다.',
    results: '내보내기',
    fileCount: (count: number) => `파일 ${koNumber(count)}개`,
    noOutput: '아직 출력 없음',
    legacySummary: (slots: number | undefined, glyphs: number) =>
      `고정 슬롯 ${koNumber(slots ?? 0)}개 · 사용 가능한 글리프 ${koNumber(glyphs)}개`,
    xtfSummary: (glyphs: number, ranges: number) =>
      `글리프 ${koNumber(glyphs)}개 · 범위 ${koNumber(ranges)}개`,
    download: '다운로드',
    cell: '셀',
    bytesPerGlyph: '글리프당 바이트',
    missing: '누락',
    resultBitDepth: '비트 심도',
    sourceCell: '변환 전 셀',
    resultsEmpty: '글꼴을 선택하고 생성하세요. 출력 파일이 여기에 표시됩니다.',
    rightsNotice: '권리 확인 안내',
    generationRights:
      '업로드한 자료를 사용할 적법한 권리가 있는지 확인하세요. 생성된 폰트는 기존 폰트나 저작물과 유사할 수 있습니다. OpenXTF는 생성 결과의 상업적 이용 가능 여부나 제3자의 권리를 침해하지 않는다는 점을 보증하지 않습니다. 상업적으로 사용할 경우 관련 권한을 직접 확인하고 그에 따른 책임을 부담해야 합니다.',
    downloadRights:
      '업로드한 자료를 사용할 적법한 권리가 있는지 확인하세요. 생성된 폰트는 창작 도구의 결과일 뿐입니다. OpenXTF는 상업적으로 사용할 수 있거나 제3자의 권리를 침해하지 않는다는 점을 보증하지 않습니다. 생성된 폰트를 상업적 목적, 공개 배포 또는 기타 외부 배포에 사용할 경우 관련 권한을 직접 확인하고 그에 따른 책임을 부담해야 합니다.',
    cancel: '취소',
    confirm: '확인',
    enlargedTitle: '글꼴 미리보기 · 크게 보기',
    zoomHint:
      '스크롤하거나 손가락을 모아 확대·축소하고, 드래그하거나 방향키로 이동하세요. Esc를 누르면 닫힙니다. 확대 비율은 레이아웃에 영향을 주지 않습니다.',
    chooseFontError: 'TTF / OTF / TTC / OTC 글꼴 파일을 선택하세요.',
    unsupportedFallbacks: '지원하지 않는 대체 글꼴 파일은 제외했습니다.',
    defaultCharactersError: '기본 문자 세트를 불러올 수 없습니다.',
    invalidFontError:
      '글꼴 파일을 해석할 수 없습니다. 완전한 원본 TTF / OTF / TTC / OTC 글꼴 파일을 선택하세요.',
    fontRequiredError:
      '먼저 TTF / OTF / TTC / OTC 글꼴 파일을 선택하세요.',
    noGlyphsError:
      '선택한 글꼴에는 현재 문자 범위에서 변환할 수 있는 글리프가 없습니다. 문자 범위나 대체 글꼴을 확인하세요.',
    invalidThresholdsError:
      '회색조 임계값은 0~255 사이 숫자 세 개여야 하며 t0 ≤ t1 ≤ t2 순서여야 합니다.',
    fontLoadTimeoutError:
      '글꼴을 불러오는 데 시간이 너무 오래 걸렸습니다. 글꼴 파일을 확인한 뒤 다시 시도하세요.',
    legacyBinError:
      '레거시 BIN 데이터를 처리할 수 없습니다. 셀 크기와 입력 파일을 확인하세요.',
    freeTypeError:
      'FreeType 글꼴 엔진을 불러올 수 없습니다. 페이지를 새로고침한 뒤 다시 시도하세요.',
    workerError: '이 브라우저에서는 로컬 글꼴 렌더링 워커를 시작할 수 없습니다.',
    generationError: '글꼴 생성에 실패했습니다.',
    cropInkError:
      '설정한 대상 셀로 자르면 글리프 잉크가 손실됩니다. 자르기 위치나 셀 크기를 조정하거나 잉크 손실 방지를 끄세요.',
    fontAttribution:
      '이 페이지는 리디주식회사에서 제공한 리디바탕 폰트를 사용합니다.',
  },
  en: {
    primaryNavigation: 'Primary',
    switchLanguage: '한국어',
    switchLanguageLabel: 'Switch to Korean',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    brandSubtitle: 'Type workshop for devices',
    workflowLabel: 'XTF creation steps',
    workflowSteps: ['Choose font', 'Check preview', 'Generate XTF'],
    mainFont: 'Font source',
    pickFont: 'Pick a font…',
    local: 'Local',
    upload: 'Upload',
    loadedFont: (name: string) => `Loaded font: ${name}`,
    readyFonts: 'Ready-to-pick fonts',
    readyFontsHint: 'Use these fonts immediately without uploading a file.',
    defaultReadyFont: 'Default',
    readyFontName: 'RIDI Batang',
    loadingReadyFont: 'Loading RIDI Batang…',
    readyFontError:
      'The bundled RIDI Batang font could not load. Refresh the page and try again.',
    supplementalFonts: 'Fallback fonts',
    clearAll: 'Clear all',
    supplementalFontHint:
      'When the main font is missing some characters, supplemental fonts are used automatically for display.',
    missingWarning: (count: number) =>
      `${count} character(s) are still uncovered by the main font + supplemental fonts and will be silently dropped. Upload or load a supplemental font that contains:`,
    systemFallbackOn:
      "System font fallback is on: the characters above will be rendered into the font file using the browser's system font.",
    removeFont: (name: string) => `Remove ${name}`,
    addSupplementalFonts: 'Add supplemental fonts',
    conversionSettings: 'Typography',
    typographyProfile: 'Typography profile',
    koreanReadingProfile: 'Korean reading',
    standardProfile: 'Standard XTFont',
    koreanProfileHint:
      'Defaults to the RIDIBatang reference: a 38 px raster, 39×38 cells, 2bpp, a 9 px word space, and the 38/45/53 px line-spacing system.',
    standardProfileHint:
      'Uses the official XTFont Maker automatic measurement and serialization behavior.',
    outputFormat: 'Output format',
    fontSize: 'Font size',
    rasterSize: 'Raster size',
    rasterSizeHint:
      '38 px is the reference raster size for this Korean reading profile. It rasterizes the source before the target cell is applied.',
    referenceAppearance: 'Current raster output',
    deviceLineSpacing: 'Device line spacing',
    lineTight: (pixels: number) => `Tight · ${pixels} px`,
    lineNormal: (pixels: number) => `Normal · ${pixels} px (default)`,
    lineWide: (pixels: number) => `Wide · ${pixels} px`,
    lineSpacingHint: (pixels: number) =>
      `The preview baseline pitch is ${pixels} px. Select the same spacing tier on the X4.`,
    deviceLayoutSettings: 'Device layout settings',
    paragraphGap: 'Extra paragraph gap',
    firstLineIndent: 'First-line indent',
    deviceTracking: 'Device tracking',
    pageMargin: 'Preview margin',
    charactersUnit: 'chars',
    deviceOnlySettingsHint:
      'These reproduce device/book layout in the preview. They are not stored in XTF, so use the same values on the X4.',
    xtfDeviceMetrics: 'XTF appearance controls',
    cellWidth: 'Cell width',
    cellHeight: 'Cell height',
    cropLeft: 'Crop left',
    cropTop: 'Crop top',
    storedAdvanceY: 'Stored advanceY',
    fullWidthAdvance: 'Full-width space (U+3000)',
    asciiMeanWidth: 'ASCII mean width',
    ascender: 'Ascender',
    descender: 'Descender',
    effectiveWordSpace: 'Effective word space',
    xtfMetricsHint:
      'Only XTF values that genuinely affect X4 text appearance or layout are shown here. Word space is cell width ÷ 4, line spacing is based on cell height, and cropping repositions the stored glyph pixels.',
    protectInk: 'Protect glyph ink',
    protectInkHint:
      'Stop generation if reframing into the target cell would remove even one nonblank glyph pixel.',
    strokeDarkness: 'Stroke darkness',
    custom: 'custom',
    weightPresets: {
      thin: 'Thin',
      light: 'Light',
      normal: 'Default',
      semi: 'Semi',
      bold: 'Bold',
    },
    strokeDarknessHint:
      'Glyphs grow darker left to right. Only affects grayscale distribution, not glyph shape.',
    strokeWeight: 'Stroke weight',
    strokeWeightHint:
      'Positive values embolden, negative values thin strokes using bitmap morphology.',
    bitmapThreshold: 'Bitmap threshold',
    bitmapThresholdHint:
      'Only pixels with coverage above the threshold are kept. A lower threshold makes strokes darker.',
    letterSpacing: 'Letter spacing',
    binSpacingHint:
      'Changes the cell width stored in the BIN file. Positive values loosen spacing; negative values tighten it and may crop strokes if too large.',
    xtfSpacingHint:
      'Adjust horizontal spacing per glyph, in pixels. Positive loosens, negative tightens (without overlapping glyphs).',
    systemFontFallback: 'System font fallback',
    systemFontFallbackHint:
      "Characters missing from both the main and supplemental fonts are rendered with the browser's system font. Their style may differ from the main font.",
    bmpOnly: ' BMP characters only.',
    outputFilenamePattern: 'Output filename pattern',
    placeholders:
      'Placeholders: [fontname], [rastersize], [cellsize], [bppname], [spacing], [gamma], [thresholds], [embolden], [date], [time], etc.',
    advanced: 'Advanced',
    advancedHint:
      'Bit depth, file naming and render tuning live here. Defaults work well for most cases.',
    bitDepth: 'Bit depth',
    oneBppHint: '1bpp uses binary glyphs and smaller files.',
    twoBppHint: '2bpp uses four gray levels for smoother text edges.',
    characterRange: 'Character range',
    deviceSet: 'Device set',
    fullFont: 'Full font',
    fullFontHint:
      'Generate every character exposed by the main font cmap. This takes much more time and memory.',
    deviceSetHint:
      'Generate only the X4 default set plus your extra characters. Smaller output and more stable on mobile.',
    renderTuning: 'Render tuning',
    gamma: 'Gamma (contrast)',
    thresholds: 'Thresholds (grayscale)',
    symmetric: 'Symmetric',
    manualThresholds: 'Manual t0,t1,t2',
    spreadHint: (spread: number) => `Spread ${spread}, centered around 128.`,
    legacyBin: 'Legacy BIN (.bin)',
    generationWorkspace: 'Build output',
    workspaceCopy:
      'Create an XT device font from the selected face and current settings. All processing stays inside this browser.',
    koreanWorkspaceCopy:
      'Convert the selected typeface with the current XTF settings and compose the device preview from the generated glyph data.',
    generating: 'Generating',
    generate: 'Generate',
    building: (size: number) => `Building 1/1: ${size}px`,
    generatedSuccess: 'Generated 1 font file. Download it below.',
    currentSettings: 'Current build settings',
    summaryFont: 'Font',
    summaryRaster: 'Raster',
    summaryCell: 'Cell',
    summaryDepth: 'Bit depth',
    summaryRange: 'Character range',
    summaryOutput: 'Output',
    automatic: 'Automatic',
    notSelected: 'Not selected',
    previewText: 'Reading preview',
    loadEpub: 'Load EPUB',
    loadingEpub: 'Reading EPUB…',
    clearEpub: 'Close EPUB',
    epubSection: 'Section to preview',
    epubLoaded: (title: string, count: number) =>
      `${title} · ${count} reading section${count === 1 ? '' : 's'}`,
    epubPrivacyHint:
      "The EPUB stays inside your browser. The selected section's text and paragraph breaks use the XTF device preview; book CSS, images and ruby annotations are not reproduced.",
    epubInvalidError:
      'This EPUB could not be read. Check that it is a standard DRM-free EPUB no larger than 100 MB.',
    epubEmptyError: 'No readable content was found in the EPUB spine.',
    updatingPreview: 'Updating preview',
    deviceLayout: 'Device layout',
    enlarge: 'Enlarge',
    fontPreview: 'Font preview',
    previewNoFont: 'Live preview will appear here once a font is loaded',
    previewLoading: 'Loading font and rendering preview…',
    previewFailed: 'Preview failed. Check the font file or preview text.',
    clickToEnlarge: 'Click or tap the preview to enlarge',
    previewDiagnostics: 'Preview diagnostics',
    showDiagnostics: 'Show diagnostics',
    hideDiagnostics: 'Hide diagnostics',
    diagnosticsHint:
      'Calculated from the final glyph data. Showing diagnostics does not change the XTF output.',
    diagnosticLines: 'Visible lines',
    diagnosticPitch: 'Line-centre pitch',
    diagnosticCell: 'Glyph cell',
    diagnosticSpace: 'Word space',
    diagnosticCollision: 'Cross-line ink collision',
    diagnosticMissing: 'Unrendered characters',
    previewDetails: (
      format: 'XTF' | 'BIN',
      lines: number,
      advance: number,
      collisions: number,
    ) =>
      `Composed from the final ${format} glyphs, widths, and line advance (${lines} line(s), ${advance}px per row)${
        format === 'XTF'
          ? `; blank pixels never erase adjacent rows, with ${collisions}px of current ink collision.`
          : '.'
      }`,
    koreanPreviewDetails: (
      lines: number,
      pitch: number,
      space: number,
      collisions: number,
    ) =>
      `Rendered from final XTF cells with the X4 V6.3.15 path: ${lines} line(s), ${pitch} px pitch, ${space} px word space, ${collisions} px of cross-line ink collision.`,
    supplementalCharacters: 'Character set',
    chars: ' chars',
    characterSummary: (defaults: number, extras: number, total: number) =>
      `${enNumber(defaults)} default, ${enNumber(extras)} extra; ${enNumber(total)} supplemental characters total. Tap to view or edit.`,
    defaultSupplementalCharacters: 'Default supplemental characters',
    defaultCharactersHint: (count: number) =>
      `${enNumber(count)} supplemental characters are used by default. Tap to view the full list.`,
    extraSupplementalCharacters: 'Extra supplemental characters',
    extraCharactersPlaceholder:
      'Optional. Enter characters to force-include beyond the default supplemental set.',
    extraCharacterCount: (count: number) => `${enNumber(count)} extra character(s)`,
    characterModeHint:
      'Device-set mode generates the default set and extra characters. Full-font mode also merges the main font cmap. Line breaks are ignored and spaces are preserved.',
    results: 'Exports',
    fileCount: (count: number) => `${enNumber(count)} file(s)`,
    noOutput: 'No output yet',
    legacySummary: (slots: number | undefined, glyphs: number) =>
      `${enNumber(slots ?? 0)} fixed slots · ${enNumber(glyphs)} available glyphs`,
    xtfSummary: (glyphs: number, ranges: number) =>
      `${enNumber(glyphs)} glyphs · ${enNumber(ranges)} ranges`,
    download: 'Download',
    cell: 'Cell',
    bytesPerGlyph: 'Bytes/glyph',
    missing: 'Missing',
    resultBitDepth: 'Bit depth',
    sourceCell: 'Source cell',
    resultsEmpty: 'Choose a font and generate. Output files will appear here.',
    rightsNotice: 'Rights notice',
    generationRights:
      'Please confirm that you have the legal right to use the materials you uploaded. The generated font may be similar to existing fonts or works. OpenXTF does not guarantee that the generated result is commercially usable or does not infringe third-party rights. If used for commercial purposes, please confirm the relevant authorization yourself and assume the corresponding responsibility.',
    downloadRights:
      'Please make sure you have the legal right to use the materials you uploaded. The generated font is only the result of a creative tool. OpenXTF does not guarantee that it can be used commercially or that it does not infringe third-party rights. If you use the generated font for commercial purposes, public release, or any other external distribution, please confirm the relevant authorization yourself and assume the corresponding responsibility.',
    cancel: 'Cancel',
    confirm: 'Confirm',
    enlargedTitle: 'Font preview · Enlarged view',
    zoomHint:
      'Scroll or pinch to zoom; drag or use arrow keys to pan. Esc closes. Zoom does not change the layout.',
    chooseFontError: 'Choose a TTF / OTF / TTC / OTC font file.',
    unsupportedFallbacks: 'Unsupported supplemental font files were ignored.',
    defaultCharactersError: 'Default character set could not load.',
    invalidFontError:
      'The font file could not be parsed. Please choose a complete original TTF / OTF / TTC / OTC font file.',
    fontRequiredError:
      'Choose a TTF / OTF / TTC / OTC font file first.',
    noGlyphsError:
      'The selected font has no convertible glyphs in the current character range. Check the range or supplemental fonts.',
    invalidThresholdsError:
      'Grayscale thresholds must be three numbers from 0 to 255 in t0 ≤ t1 ≤ t2 order.',
    fontLoadTimeoutError:
      'The font took too long to load. Check the font file and try again.',
    legacyBinError:
      'The legacy BIN data could not be processed. Check the cell size and input file.',
    freeTypeError:
      'The FreeType font engine could not load. Refresh the page and try again.',
    workerError: 'This browser cannot start the local font rendering worker.',
    generationError: 'Font generation failed.',
    cropInkError:
      'The selected target cell would remove glyph ink. Adjust the crop position or cell size, or turn off ink protection.',
    fontAttribution:
      'This page uses the Ridi Batang font provided by Ridi Corporation.',
  },
} as const;
