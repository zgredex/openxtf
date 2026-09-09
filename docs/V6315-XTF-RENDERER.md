# X4 V6.3.15 XTF renderer mapping

This document defines the model used by OpenXTF's device preview. The source of
truth is `/v6315-payload.bin` in the `Xteink` Ghidra project. Values inferred
from device photographs are deliberately excluded.

## Verified page geometry

- The framebuffer is 480 × 800 pixels.
- The panel is 220 PPI. PPI does not scale an XTF bitmap after loading.
- Reading mode 0 uses an 18 px horizontal inset (`FUN_4209810e`), leaving a
  444 px text width.
- The external-font page loop uses the literal limit `0x28e`, or 654 pixels,
  for its page-end test (`FUN_420aff66`). The remaining framebuffer height is
  not another text-flow area.
- The external-XTF branch initializes its Y accumulator with the exact float
  `0x3fe66666`, or `1.8f`. Each draw call receives the integer truncation of
  that accumulated float.

For a line origin `y`, the page loop accepts the line while:

```text
trunc(y) + calibratedGlyphBottom <= 654
```

The calibration is performed when the XTF is applied. `FUN_4209810e` measures
the exact samples `align`, `n`, and U+6211 (`我`), averages their bottom ink
rows, and stores that value at render-context offset `+0x0a`. OpenXTF performs
the same scan on the finished XTF glyph records. It does not use `cellH` as a
substitute for this page-fit test.

## Exact vertical stepping

`FUN_4209810e` loads the XTF `cellH` byte into the external-font context. The
active external branch calculates:

```text
lineStep = float(cellH) * lineSpacingLS
```

The compiled factor table at `ram:3c58304c` contains these binary32 values. The
decimal in the first column is the device UI label; the hexadecimal word is the
exact stored value:

| UI label | binary32 word | Stored binary32 value |
| --- | --- | ---: |
| 1.0 | `0x3f800000` | 1 |
| 1.2 | `0x3f99999a` | 1.2000000476837158 |
| 1.4 | `0x3fb33333` | 1.399999976158142 |
| 1.6 | `0x3fcccccd` | 1.600000023841858 |
| 1.8 | `0x3fe66666` | 1.7999999523162842 |
| 2.0 | `0x40000000` | 2 |

The device UI labels the 1.0 entry `Auto`. It is not EPUB CSS `line-height`.
The painter keeps `y` as a single-precision float, adds `lineStep` with
single-precision rounding, then truncates separately for every line. OpenXTF
uses `Math.fround` after every corresponding multiply and addition. A 38 px
cell therefore produces these exact binary32 steps:

| Device choice | binary32 word | Exact stored line step | UI decimal |
| --- | --- | ---: | ---: |
| Auto | `0x42180000` | 38 | 38 px |
| 1.2 | `0x42366667` | 45.60000228881836 | 45.6 px |
| 1.4 | `0x4254cccd` | 53.20000076293945 | 53.2 px |
| 1.6 | `0x42733333` | 60.79999923706055 | 60.8 px |
| 1.8 | `0x4288cccd` | 68.4000015258789 | 68.4 px |
| 2.0 | `0x42980000` | 76 | 76 px |

Integer draw origins must be obtained by accumulating the float and truncating;
rounding the displayed decimal step first or accumulating it as JavaScript
binary64 is not firmware-equivalent. For example, the exact 1.6× origin
sequence starts `1, 62, 123, 184, 245, 305, 366…`; the firmware never has a
58 px line-step setting.

`FUN_420570e4` returns both the line step and `paraRatioLS`. At a real paragraph
boundary, `FUN_420aff66` advances from the previous line origin by:

```text
paragraphStep = lineStep * paraRatioLS
extraWhitespace = paragraphStep - lineStep
```

The compiled paragraph-ratio table at `ram:3c268b64` uses the binary32 values
for these UI choices:

```text
1.0, 1.25, 1.5, 1.75, 2.0
```

Thus `1×` means one normal line step between the two origins. It does not mean
one normal step plus another full blank line.

The EPUB's empty NBSP-only `<p>` elements are not drawable text lines in this
reader path. OpenXTF removes them but reports their count in diagnostics.

## XTF header fields actually used here

`FUN_42078bd8` copies:

- header byte `0x0a` (`cellW`) to context `+0x0c` and `+0x12`;
- header byte `0x0b` (`cellH`) to context `+0x0e`.

The active line-step branch uses `cellH`. It does not use the XTF `advanceY`
byte for XTF reading line spacing. The XTF ascender and descender are also not
used as draw-time baselines: the finished bitmap cell is drawn at the line
origin. OpenXTF retains these fields for file compatibility but does not present
them as Korean appearance controls.

## Exact horizontal advance rules

`FUN_42093b1a` initializes both context spacing words `+0x14` and `+0x16` to
1. The active external path uses them as follows.

### Ordinary Hangul and other three-byte text

`FUN_4206ac92`, `FUN_4208115c`, and `FUN_42080708` scan the finished bitmap's
leftmost and rightmost nonzero columns. The base advance is:

```text
min(cellW, right - left + 1)
```

`FUN_42080708` then adds context `+0x16`, which is 1 px in this reader context.
It also offsets the draw so the left ink bound begins at the pen position.
Consequences:

- normal Hangul advance is `inkWidth + 1 px`, capped before the final `+1`;
- the stored per-glyph advance metadata does not control normal Hangul;
- header `fullWidth` does not control normal Hangul in this active path;
- changing the bitmap raster, crop, embolden, gamma, or threshold can change
  Hangul spacing because it can change the scanned ink bounds.

### U+0020 space

The active U+0020 branch does not use the serialized ASCII space entry. Its
advance is exactly:

```text
(cellW >> 2) + 1
```

For `cellW = 39`, this is 10 px. A stored value of 9 is overwritten by the
reader's active context behavior.

### ASCII

When an external font is applied, `FUN_4209810e` rebuilds the 95-entry ASCII
table. Non-space ASCII receives scanned ink width plus context `+0x14`; the
draw loop then adds context `+0x16`. U+0020 follows the separate rule above.

Selected non-CJK Unicode ranges can use the firmware's metadata-width path;
combining marks, joiners, and variation selectors use the zero-width path. The
diagnostics report the chosen path for every placed code point.

## Wrapping, justification, indent, and alignment

- `FUN_42098c94` performs word/space-aware wrapping rather than browser line
  layout.
- Wrap+Align distributes remaining integer pixels across eligible internal
  U+0020 spaces on automatically wrapped lines. Manual endings and the final
  line are not expanded.
- The runtime CJK indent setting moves the first line by one or two `cellW`
  units. Continued lines start at the normal left inset.
- Left and right alignment do not distribute word-space slack. EPUB-centred
  title blocks retain centred placement in the preview.
- EPUB CSS `line-height` is not the line-step input to this native painter.
  OpenXTF imports text blocks and the limited alignment/indent semantics that
  reach this model, but it does not treat arbitrary browser CSS as firmware.

## Bitmap drawing and clipping

The renderer draws the finished stored bitmap at the calculated origin. It is
not clipped to its horizontal advance. Ink may therefore enter the next advance
box, cross the 18 px content boundary, or reach the physical framebuffer edge.
OpenXTF paints the same complete cell and reports these cases separately:

- ink beyond the allocated advance;
- ink beyond the 444 × 654 reader content region;
- true clipping outside the 480 × 800 framebuffer; and
- pixels occupied by glyphs from different lines.

## Korean defaults

The font-file defaults remain:

- RIDI Batang;
- 29 px raster;
- 39 × 38 storage cell;
- 2bpp;
- crop X/Y 0;
- no embolden;
- gamma 1.0 and thresholds 64, 128, 192.

The 29 px value is a rasterization input calibrated against the KO fork glyph
bitmaps. It is not a 150-PPI or 220-PPI conversion and is independent of the
device's physical panel density.

The KO reference measurements supplied for the same-paragraph and paragraph
tiers are 43 px and about 64 px. V6.3.15 cannot express 43 from a 38 px cell:
its available exact steps jump from 38.0 to 45.6. OpenXTF therefore defaults to
the nearest selectable line tier, 1.2× (45.6 px), and the 1.5× paragraph tier
(68.4 px origin-to-origin). These are exact firmware results, not photograph
measurements. Users must select the same runtime values on the device for the
preview and device pagination to match.

## Diagnostic contract

Diagnostics are generated from the same decoded XTF records and placement pass
as the preview image. They show:

- the exact `cellH × lineSpacingLS` result;
- the exact `lineStep × paraRatioLS` result and additional whitespace;
- the exact binary32 word used for the line step, paragraph step, and first Y;
- every integer line draw origin produced by float accumulation;
- the 654 px page surface and XTF-derived bottom-row test value;
- first-line indent, alignment mode, blank EPUB blocks removed, and page usage;
- per-line widths, U+0020 distribution, and wrap reasons;
- per-glyph ink bounds, advance source, fallback source, and clipping; and
- the exact U+0020 formula and the other whitespace paths.

The overlay marks line draw origins, not typographic baselines. XTF ascender and
descender values do not reposition glyphs in this V6.3.15 path.
