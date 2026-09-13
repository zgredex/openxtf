import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fixture = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAUEAwUFBAUGBgUGCA4JCAcHCBEMDQoOFBEVFBMRExMWGB8bFhceFxMTGyUcHiAhIyMjFRomKSYiKR8iIyL/2wBDAQYGBggHCBAJCRAiFhMWIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiL/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6d/4Sb/b/AFo/4Sb/AG/1rxb/AISX/b/Wj/hJf9v9aAPaf+Em/wBv9aP+Em/2/wBa8W/4SX/b/Wj/AISX/b/WgDxX/hJf9v8AWj/hJf8Ab/WvFv8AhJv9v9aP+Em/2/1oA9p/4SX/AG/1o/4SX/b/AFrxb/hJv9v9aP8AhJv9v9aAP//Z',
  'base64',
);
const wasm = await readFile(new URL('../public/v6315-jpeg.wasm', import.meta.url));
let instance;
({ instance } = await WebAssembly.instantiate(wasm, {
  env: { emscripten_notify_memory_growth() {} },
}));
const exports = instance.exports;
exports._initialize();

const targetWidth = 17;
const targetHeight = 17;
const inputPointer = exports.malloc(fixture.length);
const outputPointer = exports.malloc(targetWidth * targetHeight);
const dimensionsPointer = exports.malloc(4);
new Uint8Array(exports.memory.buffer, inputPointer, fixture.length).set(fixture);
const result = exports.openxtf_v6315_jpeg_decode(
  inputPointer,
  fixture.length,
  targetWidth,
  targetHeight,
  1,
  outputPointer,
  targetWidth * targetHeight,
  dimensionsPointer,
  dimensionsPointer + 2,
);
assert.equal(result, 0);
const dimensions = new DataView(exports.memory.buffer);
assert.equal(dimensions.getUint16(dimensionsPointer, true), 17);
assert.equal(dimensions.getUint16(dimensionsPointer + 2, true), 17);
const output = new Uint8Array(
  exports.memory.buffer,
  outputPointer,
  targetWidth * targetHeight,
);
assert.equal(
  createHash('sha256').update(output).digest('hex'),
  'ad5f1b57d752d9ade2a6e4963ae743d4686835109bc5a3e0d0206eb18b69fab2',
);
exports.free(dimensionsPointer);
exports.free(outputPointer);
exports.free(inputPointer);

console.log('V6.3.15 JPEG decoder fixture passed.');
