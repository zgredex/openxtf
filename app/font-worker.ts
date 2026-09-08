export type FontWorkerError = Error & {
  code?: string;
  fatal?: boolean;
};

export type FontBuildSummary = {
  format?: string;
  version: string;
  engine?: string;
  engineVersion?: string;
  fontSize: number;
  bpp: number;
  cellW: number;
  cellH: number;
  glyphCount: number;
  slotCount?: number;
  requestedCount: number;
  missingCount: number;
  systemFallbackCount: number;
  droppedNonBmpCount?: number;
  droppedNonBmpCodepoints?: number[];
  rangeCount: number;
  bytesPerGlyph: number;
  fileSize: number;
  profile?: 'korean-x4';
  advanceY?: number;
  layoutFullWidth?: number;
  layoutAsciiWidth?: number;
  ascender?: number;
  descender?: number;
  crcData?: number;
  crcHeader?: number;
  sourceCellW?: number;
  sourceCellH?: number;
  croppedInkPixels?: number;
  croppedGlyphs?: number;
  effectiveSpace?: number;
};

export type FontBuildResult = {
  bytes: Uint8Array;
  fileName: string;
  previewDataUrl: string;
  summary: FontBuildSummary;
};

export type FontPreviewResult = {
  dataUrl: string;
  mode: 'row' | 'glyph' | 'device';
  metrics: {
    fontSize: number;
    renderFontSize: number;
    bpp: number;
    cellW: number;
    cellH: number;
    advanceY: number;
    contentBaseline: number;
    descenderHeight: number;
    cellOverlap: number;
  } | null;
  device: {
    width: number;
    height: number;
    lineCount: number;
    inkCollisionRows: number;
  } | null;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: FontWorkerError) => void;
  onProgress?: (value: number) => void;
};

type WorkerResponse =
  | { type: 'result'; requestId: number; result: unknown }
  | { type: 'progress'; requestId: number; value: number }
  | {
      type: 'error';
      requestId: number;
      error: { message?: string; code?: string; fatal?: boolean };
    };

function normalizeWorkerErrorCode(
  code: string | undefined,
  message: string | undefined,
) {
  if (code && code !== 'XTFONT_WORKER_ERROR') return code;

  const detail = (message || '').toLowerCase();
  if (detail.includes('choose a font file')) return 'XTFONT_FONT_REQUIRED';
  if (
    detail.includes('no convertible') ||
    detail.includes('none of the requested glyphs') ||
    detail.includes('does not provide any convertible characters')
  ) {
    return 'XTFONT_NO_GLYPHS';
  }
  if (detail.includes('thresholds must')) return 'XTFONT_INVALID_THRESHOLDS';
  if (detail.includes('font loading timed out')) return 'XTFONT_FONT_LOAD_TIMEOUT';
  if (
    detail.includes('legacy bin') ||
    detail.includes('cell width') ||
    detail.includes('cell height') ||
    detail.includes('glyph data must be')
  ) {
    return 'XTFONT_LEGACY_BIN_ERROR';
  }
  if (
    detail.includes('font file could not be parsed') ||
    detail.includes('cmap table') ||
    detail.includes('cmap format')
  ) {
    return 'XTFONT_INVALID_FONT_FILE';
  }
  if (
    detail.includes('freetype') ||
    detail.startsWith('ft_init_') ||
    detail.startsWith('ft_new_')
  ) {
    return 'LEGACY_BIN_INIT_ERROR';
  }
  if (
    detail.includes('canvas') ||
    detail.includes('fontface api') ||
    detail.includes('font rendering in a worker') ||
    detail.includes('registering fonts in a worker')
  ) {
    return 'XTFONT_WORKER_UNSUPPORTED';
  }
  return code || 'XTFONT_WORKER_ERROR';
}

export class FontWorkerClient {
  private worker: Worker;
  private nextRequestId = 0;
  private pending = new Map<number, PendingRequest>();
  private previewRequestId: number | null = null;
  private disposed = false;

  constructor() {
    this.worker = new Worker('/assets/xtfont.worker-Ju52l4K3.js', {
      type: 'module',
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  async probe() {
    const result = await this.request<{ supported: boolean }>('probe', {});
    if (!result.supported) {
      const error = new Error(
        'This browser does not support the font rendering worker.',
      ) as FontWorkerError;
      error.code = 'XTFONT_WORKER_UNSUPPORTED';
      throw error;
    }
    return true;
  }

  prepare(payload: Record<string, unknown>) {
    return this.request<{
      missingCps: number[];
      features: Record<string, number> | null;
    }>('prepare', payload);
  }

  preview(payload: Record<string, unknown>) {
    this.cancelPreview();
    return this.request<FontPreviewResult>('preview', payload, undefined, true);
  }

  build(payload: Record<string, unknown>, onProgress?: (value: number) => void) {
    return this.request<FontBuildResult>('build', payload, onProgress);
  }

  release() {
    return this.request<{ released: boolean }>('release', {});
  }

  cancelPreview() {
    if (this.previewRequestId === null) return;
    const requestId = this.previewRequestId;
    this.previewRequestId = null;
    this.worker.postMessage({ type: 'cancel', requestId });
    const pending = this.pending.get(requestId);
    if (pending) {
      const error = new Error('Preview was replaced by a newer request.') as FontWorkerError;
      error.code = 'XTFONT_WORKER_CANCELLED';
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPreview();
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate();
    const error = new Error('Font worker was disposed.') as FontWorkerError;
    error.code = 'XTFONT_WORKER_DISPOSED';
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private request<T>(
    type: string,
    payload: Record<string, unknown>,
    onProgress?: (value: number) => void,
    preview = false,
  ) {
    if (this.disposed) {
      return Promise.reject(
        Object.assign(new Error('Font worker was disposed.'), {
          code: 'XTFONT_WORKER_DISPOSED',
        }),
      );
    }
    const requestId = ++this.nextRequestId;
    if (preview) this.previewRequestId = requestId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      });
      this.worker.postMessage({ type, requestId, payload });
    });
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message.value);
      return;
    }
    this.pending.delete(message.requestId);
    if (this.previewRequestId === message.requestId) this.previewRequestId = null;
    if (message.type === 'result') {
      pending.resolve(message.result);
      return;
    }
    const error = new Error(
      message.error.message || 'Font worker execution failed.',
    ) as FontWorkerError;
    error.code = normalizeWorkerErrorCode(
      message.error.code,
      message.error.message,
    );
    error.fatal = message.error.fatal === true;
    pending.reject(error);
  };

  private handleWorkerError = (event: ErrorEvent) => {
    const error = new Error(
      event.message || 'Font worker could not be loaded.',
    ) as FontWorkerError;
    error.code = 'XTFONT_WORKER_UNAVAILABLE';
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  };
}

export function downloadFont(result: FontBuildResult) {
  const bytes = new Uint8Array(result.bytes);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
