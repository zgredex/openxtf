type V6315JpegExports = {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (pointer: number) => void;
  _initialize?: () => void;
  openxtf_v6315_jpeg_decode: (
    input: number,
    inputLength: number,
    targetWidth: number,
    targetHeight: number,
    fitByWidth: number,
    output: number,
    outputLength: number,
    decodedWidth: number,
    decodedHeight: number,
  ) => number;
};

export type V6315JpegPixels = {
  luminance: Uint8Array;
  width: number;
  height: number;
};

let decoderPromise: Promise<V6315JpegExports> | null = null;

async function loadV6315JpegDecoder() {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const response = await fetch('/v6315-jpeg.wasm');
      if (!response.ok) {
        throw new Error(`V6.3.15 JPEG decoder request failed (${response.status}).`);
      }
      const moduleBytes = await response.arrayBuffer();
      const compiledDecoder = await WebAssembly.compile(moduleBytes);
      const instance = await WebAssembly.instantiate(compiledDecoder, {
        env: {
          emscripten_notify_memory_growth() {},
        },
      });
      const exports = instance.exports as unknown as V6315JpegExports;
      exports._initialize?.();
      return exports;
    })().catch((error) => {
      decoderPromise = null;
      throw error;
    });
  }
  return decoderPromise;
}

export async function decodeV6315JpegGrayscale(
  bytes: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  fitByWidth: boolean,
): Promise<V6315JpegPixels | null> {
  if (
    bytes.length < 4 ||
    bytes.length > 0xffff_ffff ||
    targetWidth < 1 ||
    targetHeight < 1 ||
    targetWidth > 0xffff ||
    targetHeight > 0xffff
  ) {
    return null;
  }
  const outputLength = targetWidth * targetHeight;
  const decoder = await loadV6315JpegDecoder();
  const inputPointer = decoder.malloc(bytes.length);
  const outputPointer = decoder.malloc(outputLength);
  const dimensionsPointer = decoder.malloc(4);
  if (!inputPointer || !outputPointer || !dimensionsPointer) {
    if (inputPointer) decoder.free(inputPointer);
    if (outputPointer) decoder.free(outputPointer);
    if (dimensionsPointer) decoder.free(dimensionsPointer);
    return null;
  }

  try {
    new Uint8Array(decoder.memory.buffer, inputPointer, bytes.length).set(bytes);
    const result = decoder.openxtf_v6315_jpeg_decode(
      inputPointer,
      bytes.length,
      targetWidth,
      targetHeight,
      fitByWidth ? 1 : 0,
      outputPointer,
      outputLength,
      dimensionsPointer,
      dimensionsPointer + 2,
    );
    if (result !== 0) return null;
    const dimensions = new DataView(decoder.memory.buffer);
    const width = dimensions.getUint16(dimensionsPointer, true);
    const height = dimensions.getUint16(dimensionsPointer + 2, true);
    if (width < 1 || height < 1 || width > targetWidth || height > targetHeight) {
      return null;
    }
    return {
      luminance: new Uint8Array(
        decoder.memory.buffer,
        outputPointer,
        outputLength,
      ).slice(),
      width,
      height,
    };
  } finally {
    decoder.free(dimensionsPointer);
    decoder.free(outputPointer);
    decoder.free(inputPointer);
  }
}
