# X4 V6.3.15 XTF renderer mapping

This document defines the model used by OpenXTF's device preview. The source of
truth is V6.3.15 in the local `Xteink` Ghidra project: executable code was
traced in `/v6315-payload.bin`, while DROM constants were read from
`/V6.3.15-X4-EN-PROD-0905_113512.elf`. Device photographs are comparison
evidence only; no geometry below is estimated from a photograph.

The raw payload's DROM mapping is displaced by eight bytes. Reading strings or
float tables from that mapping gives plausible but wrong values. All DROM
claims below use the correctly mapped ELF.

## Selecting the XTF renderer

`FUN_4205baa0` recognizes `.xtf` and `.XTF`. That check selects the specialized
XTF branch in `FUN_4209810e`. The other branch performs `align`, `n`, and `我`
ink calibration for a different font engine. That calibration and the
`FUN_420aff66` 654 px settings-preview boundary do **not** control normal XTF
EPUB pages.

`FUN_420425ba` verifies the `XTF0` signature and 1/2 bpp format, and
`FUN_420426fc` activates the specialized engine. `FUN_42078bd8` copies XTF
header byte `0x0a` (`cellW`) and byte `0x0b` (`cellH`) into its context.

## Page geometry

- framebuffer: 480 × 800 px;
- panel density: 220 PPI (it does not rescale loaded XTF bitmaps);
- mode-0 horizontal inset: 18 px on each side;
- text width: 444 px;
- ordinary first XTF line origin: 22 px;
- lower Auto-distribution origin: `800 - 22 = 778` px;
- Auto-distribution span: `778 - 22 = 756` px.

The XTF bitmap cell is drawn at the calculated integer origin. The call chain
`FUN_42099372` → `FUN_42080fa8` → `FUN_42080708` → `FUN_4206a458` passes Y
through as the first bitmap row; the blitter checks each row against the
physical framebuffer dimension and applies no typographic baseline offset.
XTF ascender, descender, and stored `advanceY` do not reposition that bitmap in
this reader path. Therefore an Auto page whose last origin is 778 can have its
cell's lower rows clipped at 800; the preview and clipping diagnostic preserve
that firmware behavior.

Before converting a floating draw coordinate to an integer,
`FUN_420db6a4` adds binary32 `0x3f7d70a4` (the compiled `0.99f`) and truncates:

```text
drawY = trunc(f32(accumulatedY + 0.99f))
```

OpenXTF performs each corresponding operation with `Math.fround`; it does not
accumulate rounded display decimals as JavaScript binary64 values.

## Manual line-spacing choices

For the numbered choices, `FUN_4209810e` stores:

```text
initialLineStep = f32(f32(cellH) * lineSpacingLS)
```

The correctly mapped table contains:

| Device choice | binary32 word | With `cellH=38` |
| --- | --- | ---: |
| 1.2 | `0x3f99999a` | 45.60000228881836 px |
| 1.4 | `0x3fb33333` | 53.20000076293945 px |
| 1.6 | `0x3fcccccd` | 60.79999923706055 px |
| 1.8 | `0x3fe66666` | 68.4000015258789 px |
| 2.0 | `0x40000000` | 76 px |

The manual capacity branch uses `screenHeight - 17` as its lower limit. It
starts with:

```text
floor((screenHeight - 17 - firstY - cellH) / initialLineStep) + 1
```

and then verifies the last origin with the same `0.99f` comparison bias. This
is why capacity must not be derived from CSS height or from the old 654 px
settings-preview function.

## Auto is page-dependent

The UI's Auto choice is detected by `FUN_4204d3f2` using the values around 1.0
in the correctly mapped DROM table. It is a distinct layout mode, not a fixed
1.0× line-height.

### Stage 1: pagination capacity

For ordinary mode 0, `FUN_4209810e` calculates:

```text
rawRows = floor((screenHeight - 44) / cellH)
rows = rawRows - 2
initialLineStep = f32((screenHeight - 44) / (rows - 1))
```

The subtraction comes from `FUN_4204d434(4)`. With a 38 px XTF cell this gives
`rawRows=19`, `rows=17`, and an initial pagination step of exactly `47.25f`.
This initial step/capacity determines which visual-line records belong to the
page; it is not necessarily their final painted separation.

### Stage 2: painting the selected page

For a text-only page with at least two records, `FUN_420db6a4` counts explicit
paragraph boundaries using `FUN_42057034`/`FUN_420570e4`, then calculates:

```text
normalIntervals = lineCount - 1 - paragraphBoundaryCount
weightedIntervals =
  normalIntervals + paragraphBoundaryCount * paragraphRatioLS
paintedLineStep = f32(756 / weightedIntervals)
paintedParagraphStep = f32(paintedLineStep * paragraphRatioLS)
```

Normal transitions add `paintedLineStep`; real paragraph transitions add
`paintedParagraphStep`. Consequently, a page with fewer visual lines has wider
line gaps. For example, 13 lines, two paragraph boundaries, and 1.5× paragraph
spacing produce 13 weighted intervals and a binary32 step derived from
`756 / 13`. This is the firmware explanation for the larger gaps seen on the
device; no 58 px constant exists.

The default OpenXTF profile remains manual 1.2× rather than Auto because the KO
fork's measured 43 px same-paragraph tier is closer to V6.3.15's selectable
45.600002… px step than to Auto's content-dependent result. Preview and device
only match when the same runtime choice is selected on both.

## Paragraph and blank-line records

The paragraph-ratio table contains exact binary32 representations of:

```text
1.0, 1.25, 1.5, 1.75, 2.0
```

At an explicit boundary, the origin-to-origin transition is
`lineStep * paragraphRatioLS`; 1× is one normal transition, not a normal
transition plus a second full blank line.

`FUN_4209692e` preserves an empty source line as an empty 16-byte visual-line
record once page text has started. It is not painted, but it participates in
the page's line count and spacing. OpenXTF therefore retains empty EPUB block
records instead of deleting them. An empty record itself has no trailing LF,
so it is not counted as an explicit paragraph boundary.

This distinction is material: deleting blank records lowers the page line
count, changes the Auto denominator, changes every Y coordinate, and moves the
page break.

## Horizontal XTF behavior

`FUN_42093b1a` initializes the active context spacing words to 1.

For ordinary Hangul and other three-byte text, `FUN_4206ac92`,
`FUN_4208115c`, and `FUN_42080708` scan the finished stored bitmap. The normal
base advance is:

```text
min(cellW, rightInkColumn - leftInkColumn + 1) + 1 px
```

The bitmap is offset so its scanned left ink bound starts at the pen position.
Thus rasterization, crop, threshold, gamma, or embolden can alter Hangul
spacing by altering the final ink bounds. Stored per-glyph metadata and header
`fullWidth` do not normally control Hangul in this path.

U+0020 uses a separate rule:

```text
(cellW >> 2) + 1
```

For `cellW=39`, the visible word-space advance is 10 px. The serialized ASCII
space entry does not override this active rule. ASCII uses the rebuilt
95-entry table; combining marks, joiners, and variation selectors follow the
zero-width path.

## Wrapping, alignment, and drawing

- `FUN_42098c94` performs firmware word/space-aware wrapping.
- Wrap+Align distributes remaining integer width across eligible internal
  U+0020 spaces on automatically wrapped lines.
- Manual/final lines are not expanded by that justification rule.
- First-line indent is one or two `cellW` units; continuation lines return to
  the 18 px inset.
- Left and right alignment do not distribute space slack.
- EPUB CSS `line-height` is not an input to this native painter.
- The complete stored XTF cell is painted and clipped only by the framebuffer,
  not by its horizontal advance box.

OpenXTF reports ink beyond advance, content-margin overflow, physical-frame
clipping, and pixels occupied by glyphs from different lines separately.

## Korean defaults

- RIDI Batang;
- 29 px rasterization input;
- 39 × 38 storage cell;
- 2 bpp;
- crop X/Y 0;
- no embolden;
- gamma 1.0 and thresholds 64, 128, 192;
- runtime layout preview: manual 1.2× lines, 1.5× paragraph boundaries,
  two-cell first-line indent, Wrap+Align.

The 29 px value was calibrated against the KO fork's glyph bitmap appearance.
It is not a 150-PPI conversion, is not the device's 220 PPI, and is independent
of the 39 × 38 storage cell.

## Diagnostic contract

Diagnostics and the preview image share the same decoded XTF records and page
placement pass. They expose:

- initial pagination step and maximum record count;
- final page-painted step and its exact binary32 word;
- Auto normal intervals, paragraph intervals, weighted denominator, and 756 px
  numerator;
- paragraph step and extra distance;
- the exact 22…778 origin span, `0.99f` conversion bias, and integer origins;
- retained EPUB blank blocks and visible empty line records;
- per-line width, indent, justification, transition, and break reason;
- per-glyph ink/advance/fallback paths and clipping;
- the U+0020 formula and other whitespace paths; and
- page truncation and the first source character assigned to the next page.

The overlay's horizontal guides are draw origins, not typographic baselines.
