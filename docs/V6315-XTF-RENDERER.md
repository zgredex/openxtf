# X4 V6.3.15 XTF renderer mapping

This note records the behavior used by OpenXTF's device preview. The firmware
program `/v6315-payload.bin` in the `Xteink` Ghidra project is the authority.
Older conclusions based on the separate `0x4206…` legacy path do not describe
the active XTF renderer.

## Device geometry

- Framebuffer: 480 × 800 pixels.
- Panel density: 220 PPI. This describes physical pixel density and is not an
  additional scale factor for XTF bitmaps.
- Reading mode 0 content inset: 18 pixels on the left and right
  (`FUN_4209810e`). Other firmware modes use different insets and are outside
  the font-only preview.

## Active XTF path

- `FUN_420014ba` reads and validates the 64-byte `XTF0` header.
- `FUN_420024ca` returns the bitmap after the optional two-byte glyph metadata.
- `FUN_420024b4` reads metadata byte 1 as a signed X offset.
- `FUN_42045084` blits the complete stored `cellW × cellH` bitmap at
  `(lineX + xOffset, lineY)`. The blitter clips against the framebuffer, not
  against the glyph's advance width.
- `FUN_4204251c` returns `advanceY`; it falls back to `cellH` only when
  `advanceY` is zero.

The practical consequence is that a bitmap may extend beyond its allocated
horizontal advance. OpenXTF deliberately preserves that behavior in the
preview, including protrusion into the right margin and framebuffer clipping.

## Horizontal advance selection

V6.3.15 does not use one universal per-glyph rule.

| Text class | Firmware advance source |
| --- | --- |
| ASCII U+0020–U+007E | 95-byte ASCII width table (`FUN_42042582`) |
| Ordinary Hangul and CJK | header `fullWidth` (`FUN_42046fc2`) |
| Tab | header `asciiWidth` |
| Combining marks, joiners and variation selectors | zero advance (`FUN_42046f0c`) |
| Selected non-CJK Unicode ranges | effective per-glyph advance |

The selected per-glyph ranges are U+0080–024F, U+0370–052F, U+0590–08FF,
U+0E00–0E7F, U+1E00–1EFF and U+2000–22FF, excluding special zero-width
characters and U+2026 (`FUN_42047048`, `FUN_42046CE4`).

For those ranges, `FUN_420432f2` scans the real 1bpp or 2bpp bitmap and returns
its rightmost ink width. `FUN_42045d74` then caches:

```text
max(storedAdvance, signedXOffset + inkWidth + 1)
```

The final `+1` is an explicit firmware trailing pixel. Ordinary Hangul does
not enter this calculation: its spacing is controlled by `fullWidth`.

## Spaces and justification

- U+0020 has its own entry in the ASCII table. Its width is not derived from
  `cellW`.
- U+3000 follows `fullWidth`.
- `FUN_4204207e` distributes line slack only over internal U+0020 characters;
  leading and trailing U+0020 characters are excluded. Integer quotient and
  remainder pixels are distributed in firmware order.

## Missing glyphs

`FUN_42045e46` tries the requested code point, then U+FFFD, then `?`. If none
exists, `FUN_420448a2` generates a border box occupying the complete bitmap
cell. The fallback bitmap is drawn with its signed X offset, while the advance
selection still follows the original character's text class.

## Header fields exposed by OpenXTF

- `cellW`, `cellH`: bitmap record dimensions and clipping/storage bounds.
- `advanceY`: font-supplied base vertical line advance.
- `fullWidth`: ordinary Korean/CJK horizontal advance.
- `asciiWidth`: fallback ASCII width and tab width.
- ASCII U+0020 entry: actual normal word-space width.
- Crop/translation controls: change the pixels stored inside the cell.
- BPP, raster size, thresholds, gamma and embolden: change the stored bitmap.
- Letter spacing: changes stored advances where V6.3.15 honors per-glyph
  metadata. It does not replace `fullWidth` for ordinary Hangul.

Ascender and descender are retained as internal header compatibility values,
but are not shown as normal Korean text controls. The V6.3.15 font loader scans
sample glyph bitmaps to derive the normal-text ink bounds used by the reader
(`FUN_420426fc`, getters `FUN_42042466` and `FUN_42042482`).

In the Korean reading profile, OpenXTF also hides `asciiWidth` and the generic
per-glyph letter-spacing control. The firmware does not use either value for
ordinary Hangul: `asciiWidth` is an ASCII fallback/tab metric, while Hangul
uses the header `fullWidth` instead of per-glyph advances. Both compatibility
values remain valid internally and the Standard XTFont profile still exposes
the generic letter-spacing control. U+0020 remains visible because its ASCII
table entry directly controls spaces inside Korean text.

## Korean default calibration

The KO reference font was generated as 14 pt at 150 DPI, which is about
29.17 pixels. Its compiled font data stores a 38 px line height, a 28 px
ascender and a -9 px descender. XTF stores integer metrics, so the closest
V6.3.15 profile is:

- raster size: 29 px;
- bitmap cell: 39 × 38;
- `advanceY`: 38 px;
- `fullWidth`: 28 px;
- `asciiWidth`: 18 px;
- U+0020: 9 px;
- 2bpp;
- no added letter spacing or embolden;
- gamma 1.0 and thresholds 64, 128, 192.

This matches the font-controlled part of the KO typography as closely as the
integer XTF format and V6.3.15's constant-width Hangul path allow. EPUB CSS,
firmware `lineSpacingLS`, `paraRatioLS`, reading mode, status/footer layout and
book-specific line breaking are runtime inputs rather than XTF properties.

The preview decodes and paints the completed XTF records, rather than drawing
the source OTF directly. It therefore represents the glyph pixels, metadata,
constant Hangul advance, ASCII table, fallback behavior and framebuffer
clipping that the generated file supplies to V6.3.15. It is not a promise that
an EPUB page has identical pagination without the same book content, CSS and
reader settings.

The KO built-in font was rasterized by FreeType at 150 DPI. OpenXTF's standard
XTF conversion core retains the web XT-maker-compatible outline raster path,
so its hinting can differ by pixels from the KO fork's compiled bitmap even
when the same RIDIBatang outline and metrics are selected. The Korean defaults
minimize scale and placement differences; they do not claim byte-identical KO
glyph bitmaps.
