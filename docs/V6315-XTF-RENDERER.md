# X4 V6.3.15 XTF renderer mapping

This document defines the model used by OpenXTF's device preview. The source of
truth is V6.3.15 in the local `Xteink` Ghidra project. Executable code, mapped
data, and runtime addresses are verified in
`/V6.3.15-X4-EN-PROD-0905_113512.elf`. The separately imported
`/v6315-payload.bin` is retained only as a secondary analysis aid. Device
photographs are discrepancy reports only: they can reveal a question, but they
are neither a calibration target nor acceptance evidence. The font, EPUB,
reader settings, and firmware state represented by a photograph are not known
unless they are supplied independently. No geometry or behavior below is
estimated from a photograph.

Ghidra is queried through the `ghidra-mcp` bridge as a real MCP server over
stdio. The client performs MCP `initialize`, `tools/list`, and `tools/call`,
runs the bridge with `--no-lazy`, and supplies an explicit `program` selector
for every program-scoped request. Direct HTTP/curl calls to the Ghidra plugin
are not used for this analysis.

### Program-selection protocol

The bridge instance and open-program list are checked before a trace. Code,
instructions, functions, callers, cross-references, DROM strings, tables, and
mapped constants must select
`/V6.3.15-X4-EN-PROD-0905_113512.elf`. The CodeBrowser's active tab is never
accepted as a program selector. A finding is not recorded as verified unless
its query used that explicit program path.

### Older-firmware research is a hypothesis map

The separate checkout at `/Users/patryk/esp32-reader-re-workflow` (currently
commit `1bf8af4`) contains extensive X4 V5.6.33 firmware and companion-app
research. It is useful for suggesting libraries, formats, and call paths to
look for, but it is not evidence for V6.3.15. In particular, its image-decoder,
EPUB-style, XTG/XTH, grayscale, and text-layout notes are treated as hypotheses
until the same behavior is independently recovered from the explicitly
selected V6.3.15 ELF. A matching library name alone is insufficient: the
active caller, parameters, constants, output callback, and downstream consumer
must also agree. Any disagreement remains versioned instead of being resolved
in favor of the older notes.

### Raw-payload mapping trap

`/v6315-payload.bin` includes an eight-byte prefix that was imported as if it
were executable payload. Consequently, a byte at raw-import address `P + 8`
corresponds to runtime/ELF address `P`. Relative calls can still look coherent
inside that displaced import, while absolute callback pointers land eight
bytes before the displayed raw-payload function. This is particularly
dangerous because the resulting decompilation can be plausible.

For example, the callback pointer `0x42095230` targets a valid function prologue
at ELF address `0x42095230`; the same bytes appear at raw-import address
`0x42095238`. The earlier raw label must therefore be translated by
`runtime = raw - 8`. The same displacement affects its mapped DROM and its
displayed ROM-call labels: raw `SUB_4000085c` is ROM `__mulsf3` at
`0x40000854`. The ELF is the address oracle. No raw-import address is copied
into the renderer or this document without translation and an ELF byte check.

### Reproducible parity standard

Preview parity is established with a controlled fixture consisting of the
exact XTF bytes and hash, the exact EPUB/XHTML bytes and language metadata, all
persisted reader settings, and the selected V6.3.15 renderer path. The expected
result is the firmware's logical 480 x 800 pre-panel framebuffer and its exact
record/line decisions. A browser cannot reproduce panel refresh physics, and a
photograph whose loaded font or settings are unknown cannot prove or disprove
logical parity.

A comparison capture is acceptance evidence only when that same fixture is
independently established on the device: the flashed firmware build, selected
XTF and its hash, EPUB bytes, spine location, language, line-spacing choice,
paragraph ratio, first-line indent, and alignment mode must all be recorded.
Without those inputs, a capture must not be used to tune glyph scale, advance,
line height, paragraph spacing, or page capacity.

### Standard XTFont conversion versus preview

Standard XTFont mode has two deliberately separate stages. Stage one uses the
current official XTFont Maker defaults, per-font hidden bias, automatic
measurement and serializer to produce the XTF bytes. Stage two parses those
finished bytes and executes this V6.3.15 model. The official website's own X4
and X3 previews are simple converter canvases: they iterate preview code points,
wrap by generated advance and use the generated `advanceY`, but do not execute
the firmware EPUB record splitter, paragraph modes, CJK indent insertion or
alignment/justification branches.

OpenXTF previously sent Standard mode directly to that generic worker preview.
That reproduced the official website's preview, not stock-firmware behavior.
X4 Standard preview now uses the same finished-XTF firmware path as the Korean
profile, without applying the Korean profile's 39×38 metadata patch. X3 remains
explicitly labeled as the official generic 528×792 model until an X3 firmware
program has been independently decompiled and verified.

## Selecting the XTF renderer

`FUN_4205ba98` recognizes `.xtf` and `.XTF`. `FUN_420d191e` combines that
extension check with `FUN_420425b2`'s format result and writes the page-renderer
mode through `FUN_4206b15c` into the layout state at offset `+4`. A valid v2
XTF selects mode 2. The page dispatches in `FUN_420de492` and `FUN_420e0c54`
call `FUN_420dcddc` whenever that field is nonzero and call `FUN_420db69c`
only when it is zero. Therefore `FUN_420dcddc` is the source of truth for the
supplied RIDI XTF; the segment rules in `FUN_420db69c` belong to the other
renderer and must not be copied into the XTF preview.

`FUN_420425b2` verifies the `XTF0` signature and 1/2 bpp format, and
`FUN_420426f4` activates the specialized engine. The actual 64-byte header
reader is `FUN_420014b2`, reached through the object loader
`FUN_420027d2`. It checks `XTF0`, requires header byte `0x06` to be `0x40`,
and copies header bytes `0x0a`/`0x0b` (`cellW`/`cellH`) and
`0x0c`/`0x0d` (`advanceY`/`fullWidth`) into the active XTF object. The older
`FUN_42078bd0` citation was not a function in the selected ELF and has been
removed.

The activation state is not inferred. `FUN_420426f4` first clears
`DAT_3fca1fcc`, loads and validates the XTF object at `0x3fc99d0c`, and sets
`DAT_3fca1fcc = 1` only after the load succeeds. `FUN_42041d74` then returns
the object's validity byte at `+0x35`. The only other writers found by the
Ghidra cross-reference trace are the unload/reset routines `FUN_42041b2e` and
`FUN_42041c62`, both of which clear the state. A loaded XTF therefore takes the
active-object branch until it is unloaded.

## Page geometry

- framebuffer: 480 × 800 px;
- panel density: 220 PPI (it does not rescale loaded XTF bitmaps);
- mode-0 horizontal inset: 18 px on each side;
- text width: 444 px;
- ordinary first XTF line origin: 22 px;
- lower Auto-distribution origin: `800 - 22 = 778` px;
- Auto-distribution span: `778 - 22 = 756` px.

The persisted paragraph-spacing selector is also used in the horizontal
geometry branch. This coupling is unusual, but it is explicit in
`FUN_42098106`: `DAT_3fca229f` is loaded and saved under the `paraRatioLS`
preference and selects the following values on the 480 px X4 framebuffer:

| Paragraph choice/index | Left/right inset | Signed width term | Content width |
| --- | ---: | ---: | ---: |
| 1× / 0 | 18 | 0 | 444 |
| 1.25× / 1 | 13 | 0 | 454 |
| 1.5× / 2 | 11 | −12 | 446 |
| 1.75× / 3 | 13 | 0 | 454 |
| 2× / 4 | 11 | 0 | 458 |

The preview must therefore recompute line breaks when the paragraph-spacing
choice changes; treating paragraph spacing as vertical-only does not reproduce
this firmware.

The XTF bitmap cell is drawn at the calculated integer origin. The call chain
`FUN_4209936a` → `FUN_42080fa0` → `FUN_42080700` → `FUN_4206a450` passes Y
through as the first bitmap row; the blitter checks each row against the
physical framebuffer dimension and applies no typographic baseline offset.
XTF ascender and descender do not reposition that bitmap in this reader path.
Stored `advanceY` also does not offset a glyph inside its cell, but it does set
the base line-origin step: `FUN_42042514` returns header byte `0x0c`, falling
back to `cellH` only when it is zero. Therefore an Auto page whose last origin
is 778 can have its
cell's lower rows clipped at 800; the preview and clipping diagnostic preserve
that firmware behavior.

Before converting a floating draw coordinate to an integer, the page painter
adds binary32 `0x3f7d70a4` (the compiled `0.99f`) and truncates:

```text
drawY = trunc(f32(accumulatedY + 0.99f))
```

OpenXTF performs each corresponding operation with `Math.fround`; it does not
accumulate rounded display decimals as JavaScript binary64 values.

## Manual line-spacing choices

For the numbered choices, `FUN_42098106` uses the effective XTF line advance
returned by `FUN_42042514` and stores:

```text
baseAdvanceY = advanceY != 0 ? advanceY : cellH
initialLineStep = f32(f32(baseAdvanceY) * lineSpacingLS)
```

The correctly mapped table contains:

| Device choice | binary32 word | With `advanceY=38` |
| --- | --- | ---: |
| 1.2 | `0x3f99999a` | 45.60000228881836 px |
| 1.4 | `0x3fb33333` | 53.20000076293945 px |
| 1.6 | `0x3fcccccd` | 60.79999923706055 px |
| 1.8 | `0x3fe66666` | 68.4000015258789 px |
| 2.0 | `0x40000000` | 76 px |

The manual capacity branch uses `screenHeight - 17` as its lower limit. It
starts with:

```text
floor((screenHeight - 17 - firstY - baseAdvanceY) / initialLineStep) + 1
```

and then verifies the last origin with the same `0.99f` comparison bias. This
is why capacity must not be derived from CSS height or from the old 654 px
settings-preview function.

The later record-budget predicate in `FUN_42094f8e` compares the accumulated
budget against `(screenHeight - 17) + 0.5f`, not against a rounded-down
integer. With the ordinary first origin at 22 px, the exact no-footer limit is
`783.5 - 22 = 761.5f` px. OpenXTF keeps this as binary32 arithmetic; using
760.5 px removes a record one row earlier than the firmware.

## Auto is page-dependent

The UI's Auto choice is detected by `FUN_4204d3ea` using the values around 1.0
in the correctly mapped DROM table. It is a distinct layout mode, not a fixed
1.0× line-height.

### Stage 1: pagination capacity

For ordinary mode 0, `FUN_42098106` calculates:

```text
rawRows = floor((screenHeight - 44) / baseAdvanceY)
rows = rawRows - 2
initialLineStep = f32((screenHeight - 44) / (rows - 1))
```

The subtraction comes from `FUN_4204d42c(4)`. With `advanceY=38` this gives
`rawRows=19`, `rows=17`, and an initial pagination step of exactly `47.25f`.
This initial step/capacity determines which visual-line records belong to the
page; it is not necessarily their final painted separation.

`ProcessEpubContentV6315` then applies a second binary32 height budget while it
commits records. `FUN_4204d442` selects transition accounting for every manual
spacing choice and for Auto when the paragraph ratio is greater than 1.0. In
that branch the first text record costs no transition; each following record
adds either `initialLineStep` or `initialLineStep * paragraphRatioLS`, according
to whether the preceding nonempty record has a real paragraph-ending LF. Auto
with a 1× paragraph ratio takes the other branch and adds one initial line step
per committed record. The lower-origin test is `FUN_42094f8e`; when a committed
record crosses it, `FUN_420e1840` removes that record and restores its source
position. Therefore the nominal row cap is not always the number of records
that reaches the painter, particularly on pages with paragraph transitions.
OpenXTF applies this fit pass before the final Auto redistribution below.

### Stage 2: painting the selected page

For the fitted text-only page with at least two records, `FUN_420dcddc` counts explicit
paragraph boundaries using `FUN_4205702c`/`FUN_420570dc`, then calculates:

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

## Line-record endings, page end, and paragraphs

The paragraph-ratio table contains exact binary32 representations of:

```text
1.0, 1.25, 1.5, 1.75, 2.0
```

At an explicit paragraph boundary, the origin-to-origin transition is
`lineStep * paragraphRatioLS`; 1× is one normal transition, not a normal
transition plus a second full blank line.

The firmware carries five distinct ending conditions. They must not be
collapsed into a single browser newline:

| Condition | Stored record ending | Source | Paragraph boundary? | Ordinary Wrap+Align? |
| --- | --- | --- | --- | --- |
| Automatic wrap | no terminator | width overflow/splitter | no | yes |
| Explicit soft break | internal byte `0x05`, then LF | `<br>` or `<hr>` | no | no |
| Paragraph end | LF without preceding `0x05` | normal block commit | yes, when adjacent records contain text | no |
| End of source | separate boolean on the final record | backing stream has exactly zero bytes remaining | no extra record byte | no |
| End of visible page | no terminator or flag | pagination stops while source bytes remain | no | remains eligible if automatically wrapped |

This is verified through `FUN_4206ebfc`, `FUN_420d7794`, `FUN_420d866e`,
`FUN_420713a0`, `FUN_4204f334`, `FUN_4204f360`, and `FUN_4205702c`.
`FUN_420713a0(record, 1)` appends byte `0x05` followed by LF; the tokenizer
uses that route only for the special `br`/`hr` token. Its ordinary block route
calls `FUN_420713a0(record, 0)`, which appends LF only. The painter trims
`0x05`, LF, and CR from the visible string, while the boundary classifier
accepts LF only when it is not immediately preceded by `0x05`.

Two previously missing ELF function boundaries were recovered directly in the
selected program: `RenderDirectStreamPageV6315` at `0x420de492` and
`RenderEpubComposerPageV6315` at `0x420e0c54`. The former is the direct-stream
reader. It computes `FUN_420000ca(stream) == 0` and supplies that state as the
fourth argument to `PaintPageTextV6315`; it must not be cited as the EPUB
composer's end-state source. The latter retrieves the already composed EPUB
page records through `FUN_42097cbe` and supplies its final-page state as the
third painter argument, derived from the EPUB progress globals rather than a
raw stream-length test.

In both routes, simply being the last visible record does not itself mean the
text source has ended. If content continues, an automatically wrapped
page-last line remains eligible for ordinary Wrap+Align placement. OpenXTF
may label an XHTML block as a text ending for its local record construction,
but must not present the end of the currently selected preview section as a
verified device end-of-book flag.

Empty block commits do not synthesize a blank visual record: the composer
guards the commit on active record content, and `FUN_4205702c` rejects empty
transitions. This explains why visually empty XHTML blocks can disappear on
the device instead of consuming a line or paragraph gap.

EPUB fitting must not inherit the separate plain-reader overshoot rule.
`FUN_420d866e` supplies the remaining record width to `FUN_420701b8`, which
accepts a UTF-8 unit only when the accumulated measured width remains less
than or equal to that limit. A split is needed only when the next unit makes
the record strictly wider. The five-pixel allowance traced in
`FUN_420e404c` belongs to the plain-reader path and is not used by this EPUB
composer. This distinction also preserves a paragraph/text ending when its
last measured glyph lands exactly on the width limit.

After selecting that composition prefix, `FUN_42071de6` measures it again
through the painter callback and backs up by whole UTF-8 units until the
painted width also fits. This second gate is not redundant: some records have
different composition and paint advances, most visibly U+00A0 (composed as a
U+0020-width token but serialized as byte 7 and painted through the ASCII
fallback-width path). OpenXTF applies both gates. In the EPUB path a source
TAB has already been collapsed by `FUN_420d7794` into one ordinary U+0020
token; the two/four-space tab expansion belongs only to the separate plain
reader.

`FUN_420719aa` trims trailing serialized U+0020 bytes from a record and
subtracts their measured widths before that record is committed. Those bytes
have still been consumed from the source stream; a preview diagnostic must not
call them lost merely because they do not become painted glyphs.

The preview XTF must use the exact selected finished-output character scope,
not merely the characters visible on the current page. The converter derives
its source cell, baselines, raster placement, and advances from the selected
glyph population, so a page-only subset can generate different bitmap records
even with otherwise identical settings. This was observed directly with
RIDI Batang: the subset preview produced a different `가` ink box and stored
advance than the subsequent full export. OpenXTF now performs the same full
scope build for preview and export, applies the same Korean profile rewrite,
and decodes those finished XTF bytes. Consequently firmware-synthesized
U+3000 indentation and the direct → U+FFFD → `?` fallback chain see exactly
the glyph coverage present in the output file.

OpenXTF caches that finished profiled XTF by the complete set of
byte-affecting converter inputs. Changing preview text, EPUB chapter,
interface language, diagnostics, or runtime device-layout selectors then
reruns only the firmware renderer against the same bytes. Changing the source
font, fallbacks, character scope, raster settings, bitmap cell, quantization,
embolden, XTF widths, offsets, or coverage invalidates the cache and rebuilds
the file before the next preview. This is an execution optimization only; the
cached and exported byte sources follow the same construction path.

## EPUB tokenization and honored markup

`FUN_4206ebfc` recognizes the following normal block tags exactly:

```text
p, div, li, ol, ul, dl, dt, dd, h1, h2, h3, h4, h5, h6,
section, article, figure, figcaption, blockquote, header, footer,
nav, table, tr, td, th, tbody, thead, caption, pre, address
```

`br` and `hr` are the two special break tags. They emit the explicit-soft
record ending described above rather than a paragraph ending. The five
containers whose nested contents are skipped by `FUN_4206eb80` and
`FUN_420d7794` are exactly `head`, `title`, `style`, `script`, and `noscript`.
In particular, `nav` is a recognized block tag and is not part of that ignored
container set. Images are handled by a separate non-text token path; they must
not be approximated as ordinary styled text.

OpenXTF scans the original XHTML byte-decoded source in tag order. It does not
build a browser HTML tree first. This is necessary because `DOMParser` repairs
legacy or invalid nesting before script can observe it; for example, Firefox
would split a `<center>` nested directly inside `<p>`, while the firmware's
streaming tokenizer sees those tags in their original order and keeps one
record. `tools/verify-epub-browser.mjs` loads a synthetic zipped EPUB in a real
Firefox process and pins ignored containers, block and soft breaks, class and
literal centering, nested style-state bytes, image separation, empty-block
omission, and that source-order behavior.

That separation is explicit in `FUN_420d866e`: tokenizer token type 5 sets
result byte `+4` and returns without appending ordinary text. The actual page
builder is `ProcessEpubContentV6315` at ELF `0x420ee200`; it consumes an image
tag in a separate branch instead of asking the text-fit helper to treat the
result byte as a line.

The image branch recognizes `src`, `xlink:href`, and `href`, resolves the EPUB
archive path, reads the source dimensions, scales down while preserving aspect
ratio, and creates a special page record. `FUN_420942d2` serializes that record
as byte `0x04`, an optional `F,` marker, the decimal selected height, `|`, and
the resolved path. `FUN_42073b4c` recognizes it and `FUN_420943b4` recovers its
height. A missing/zero height falls back to `FUN_42094246`, which chooses the
larger of one rounded XTF line step and 80% of the available reading height,
with a minimum of one pixel.

`PaintPageTextV6315` sums the parsed height of every image record before its
Auto-spacing decision. The exact guard is important: a positive image-height
sum bypasses the whole-page redistribution formula and keeps the base line
step returned by `FUN_420570dc`. The later subtraction of the image sum inside
the redistribution formula is therefore present in the binary but unreachable
for an ordinary page containing a positive-height image. Earlier notes that
described image pages as Auto-redistributed were wrong.

For each image the painter advances page flow by the image height and, unless
it is the final record, by the same following line/paragraph transition that a
text record would receive. `FUN_42054d8a`
can move only the image pixels downward without moving the following record:
for a non-first image whose following transition is greater than four pixels,
the offset is the smaller of `round(baseLineStep * 0.4)` and
`round(followingTransition * 0.28)`, capped to positive remaining page space.
This distinction between image draw Y and the flow accumulator is required for
matching the next text origin.

The decoded-image path is also verified. `FUN_420db344` builds or reuses the
cache entry keyed by resolved path and target dimensions. Its worker reaches
`FUN_420ce0d0`, which reads the source dimensions, chooses
`min(targetW/sourceW, targetH/sourceH)` when downscaling is needed, rounds both
scaled dimensions by adding `0.5` before unsigned conversion, never upscales,
and centers the result in the target canvas. `FUN_4207c6fa` returns the cached
width and height. The painter centers that finished width inside the current
content span and `FUN_4207c836` draws it at the requested origin. If no usable
cache entry is available, the alternate `FUN_4204d5dc` branch draws a clipped
rectangular placeholder; it does not substitute EPUB `alt` text.
`FUN_4204d5dc` clips the requested box to the physical framebuffer, draws its
outline through display-vtable slot `+0x54`, then draws both corner-to-corner
diagonals through line slot `+0x50`; a clipped region narrower than two pixels
uses only the first diagonal. The final `+0x12c` call marks that clipped region
for display update. OpenXTF reproduces the black outline and crossed diagonals
in the normal non-inverted reader frame.

The concrete primitives are also closed in the same selected ELF. The current
derived display vtables at `0x3c269114` and `0x3c29f2a0` both resolve slot
`+0x50` to `DisplayDrawLineV6315` (`0x4200a67c`) and slot `+0x54` to
`DisplayDrawRectV6315` (`0x4200a5f0`). Non-axis-aligned lines delegate through
vtable slot `+0x30` to `DrawLinePixelsV6315` (`0x4200a3ce`). That function
swaps axes when the line is steep, orders endpoints along the major axis,
initializes the error to half the major-axis delta, subtracts the minor-axis
delta after each plotted point, and advances the minor axis only when the
result is strictly negative. OpenXTF uses the same endpoint-inclusive integer
walk, including its tie-pixel choice.

`FUN_420605ae` maps the three source raster extensions used by that worker as
JPEG (`jpg`/`jpeg`, type 3), BMP (type 2), and PNG (type 10).
`FUN_420cdf7e` clears the target surface and dispatches those types to
`FUN_4206b40e`, `FUN_420a8d52`, and `FUN_420cd5c2` respectively. JPEG reaches
`FUN_4201d040` (prepare) and `FUN_4201d500` (decompress). Those functions are a
source-level structural match for ChaN TJpgDec R0.03 with a 512-byte input
buffer, 3,500-byte work pool, scale support enabled, fast-decode level 1,
grayscale output, and the 1,024-byte saturation table enabled. The current
binary contains one visible grayscale modification: non-1/8 IDCT Y samples are
saturated through the table at `0x3c269df4` before scale averaging rather than
being narrowed directly to eight bits. At 1/8 scale the decoder uses each
block's DC Y sample directly, as the recovered R0.03 branch does.

`FUN_42069688` does not ask a browser-style image scaler for the final JPEG.
It selects TJpgDec reduction 1, 2, 4, or 8 from the limiting source/target
axis, sets that power-of-two scale through `FUN_4201cae4`, and records an
integer numerator/denominator through `FUN_4201cb9c`. The internal callback
now named `FirmwareJpegResampleCallbackV6315` at `0x4201c804` maps each decoded
MCU rectangle separately. Its output rectangle is calculated with integer
division at both edges, and each output sample selects a source sample with a
per-rectangle integer accumulator. This can leave a one-pixel white strip even
when the outer cache dimensions are exact: a 1417×2126 source targeted at
400×600 produces 399 decoded columns in the 400-column XTG crop.

The actual EPUB-cache one-bit output callback is
`JpegOutputCallbackV6315` at `0x403808a4`. PNG uses the current build's
pngle-compatible streaming path; its setup callback is
`PngOutputCallbackV6315` at `0x42051780`, which installs one of four recovered
row callbacks: opaque/unscaled `0x403802de`, opaque/downscaled `0x40380480`,
alpha/unscaled `0x403805ac`, or alpha/downscaled `0x40380756`. The downscaled
callbacks map source coordinates with a 16.16 ratio and average every source
sample that lands on the same output pixel before thresholding. These names
were added to the selected Ghidra program only after the callback entry points,
boundaries, and scale-flag direction were recovered.

The native PNG byte path is now closed as well. `FUN_420cd5c2` allocates the
pngle-compatible context through `FUN_42040d56` and streams chunks through
`FUN_42040df0`. The active build accepts grayscale, truecolor, indexed,
grayscale+alpha and RGBA forms at their PNG-legal 1/2/4/8/16-bit depths,
validates chunk CRCs, reconstructs filters 0...4, and uses the exact eight-entry
non-interlaced/Adam7 tables at `0x3c27b5d0...0x3c27b64f`. Dimensions are
restricted to 1...1024 by `FUN_42060592`. The context is zero-initialized and
the wrapper never sets display gamma, so a `gAMA` chunk does not transform the
samples in this call path. Native alpha in color types 4/6 reaches the
alpha-aware callbacks; `tRNS` alpha attached to color types 0/2/3 is decoded
but is not consumed by the active opaque callbacks.

The three decoders do not hand a four-level image to the EPUB painter. Their
current-build callbacks reduce source pixels to a one-bit drawing surface.
RGB is converted with the fixed-point BT.601 expression
`(77*R + 150*G + 29*B) >> 8`. Before thresholding, values 0...9 are clamped to
0 and values 246...255 to 255. The ordered comparison is strict. PNG and BMP
make a pixel white only when its adjusted luminance is greater than
`119 + ((absoluteX + absoluteY) & 15)`. The JPEG callback instead starts from
the mutable byte `DAT_3fca21cc`, uses `(phase + x) & 15`, and advances the phase
by every processed row width; the callback is the only read/write
cross-reference to that byte. Exact JPEG cache bytes therefore also depend on
the phase when the cache was built. The residual error is propagated to the
right and the following row by the decoder callbacks. Instruction-level
verification of `0x40380404`...`0x40380460` shows the custom propagation unit
is signed `((error - (error >> 3)) >> 2)`: twice that unit goes right, one unit
goes to the next row's preceding pixel, and one to its current pixel. This is
not standard four-neighbour Floyd-Steinberg diffusion.

The active EPUB PNG call passes center=true and allow-upscale=false. Its
downscale ratio is unsigned 16.16; source samples mapped to one output pixel
are averaged before the same one-bit threshold/error pass. The call passes the
alpha-skip flag as zero and the white-background blend flag as zero, so alpha
PNG pixels are composited against white by `FUN_42053846`; the two recovered
alpha-skip row callbacks are not selected by this path. BMP does not use the
PNG/JPEG scaler in `FUN_420cdf7e`: a smaller bitmap is centered, while a larger
one is cropped to the target surface. These format-specific differences must
not be collapsed into Canvas `drawImage` scaling.

`FUN_42085056` -> `FUN_42084d72` then samples that one-bit surface and writes a
native XTG cache file. Its header is 22 bytes: `XTG\0`, little-endian width at
offset 4, height at offset 6, zero format/reserved bytes at 8...9, a
little-endian payload length at offset 10, and eight reserved bytes at
14...21 for the normal cache call. The payload is
`height * ceil(width / 8)` bytes, row-major and MSB-first. A set bit represents
white; an unset bit represents black. `FUN_4205e08c` validates that header and
`FUN_42055f5c` consumes the same row geometry when the cached image is painted.
This disproves OpenXTF's earlier four-level, smoothly scaled browser-image
approximation for EPUB raster records.

The surrounding state machine has distinct `img_before_*`, `img_bottom`, and
`img_after_*` fit exits, so an image changes pagination even though it is not a
text line. Text accumulated before the image is committed first. When text
continues after the image, the builder also budgets its following normal or
paragraph-scaled transition.

`ReadXtgImageDimensionsV6315` at ELF `0x420e0f5e` reads native XTG dimensions.
`FUN_420e1152` handles cached dimensions plus JPEG, BMP, and PNG headers.
`FUN_42052456` performs the aspect-preserving downscale. The old label that
described `0x420e0f5e` as an EPUB composition state machine was wrong and has
been removed from the authoritative Ghidra program.

OpenXTF must never turn image `alt` text into XTF glyphs or invent a CSS-sized
blank line. Image record construction, page-fit integration, cached-size
selection, centering, independent draw-Y adjustment, one-bit cache format, and
the luminance/threshold core are traced. OpenXTF now decodes plain unexpanded
XTG exactly and decodes the V6.3.15 BMP input bytes without browser image or
color-management behavior. The native BMP path pins 1/4/8-bit indexed,
16-bit BI_RGB/BI_BITFIELDS, 24/32-bit, bottom-up/top-down, palette, row-stride,
crop, centering, luminance, and rejection behavior. OpenXTF applies the current
PNG source-byte decoder before the recovered fixed-point downscale/averaging,
white alpha composition, custom error propagation, and ordered threshold.
Browser PNG decoding and browser color management are no longer in this path.
For JPEG it
loads a 14 KB WebAssembly build from pinned TJpgDec v1.0.8/R0.03 source and
applies the configuration, grayscale saturation modification, scale selection,
and per-MCU resampler verified above. `JpegOutputCallbackV6315` uses an
eight-bit working row: every propagated error is saturated immediately by
`FUN_420697b4`, so OpenXTF has a separate JPEG dither implementation rather
than reusing the signed PNG/BMP row-buffer model. A deterministic baseline
JPEG fixture pins the WebAssembly luminance output.

The JPEG cache remains history-sensitive. `DAT_3fca21cc` is zero-initialized
but persists across JPEG cache builds, and its final value advances by every
processed output-row width. OpenXTF starts at the firmware's fresh-boot value
and carries the phase across JPEG records in preview order. Diagnostics label
that path as `V6.3.15 decoder / fresh-cache phase`; if an existing device has
already generated other JPEG caches since boot, its ordered threshold phase
can differ even though decoded luminance, geometry, resampling, and diffusion
are the same. The browser JPEG decoder is retained only as an explicitly
labelled fallback when WebAssembly cannot be loaded. Image diagnostics expose
the source size, internal decoder output, outer XTG/draw size, and starting and
ending JPEG phase; the one-column difference in the 1417×2126 example is
therefore visible instead of being silently hidden by the cache dimensions.

The parser is not a general CSS engine. `FUN_4206ec7e` inspects only the
literal `class` attribute and recognizes this exact keyword set:

```text
head, title, titlepage, title-page, title_page, cover,
chaptertitle, chapter-title, chapter_title,
center, centered, centertext, center-text
```

The comparison is exact and length-sensitive in `FUN_42052884`; it is not a
prefix or substring search. For example, the supplied EPUB's `title1c` and
`align_center` classes do not match `title` or `center` and therefore do not
create a centering record prefix in stock V6.3.15.

Together with `h1` through `h6` and the literal `center` tag, those keywords
feed a special heading/centering state in `FUN_4206ef9e`. The downstream
record builder `FUN_4207153e` prefixes the record with byte `0x01` for an
`h1`…`h6` or literal `center` element, and with byte `0x1e` for a recognized
centering class on `p` or `div`. `FUN_420dcddc` measures the finished visible
record and places it at:

```text
x = max(contentLeft, trunc((480 - measuredWidth) / 2))
```

The `0x01` route is also painted a second time at `x + 1`, producing the
firmware's one-pixel synthetic bold. The `0x1e` route is centered but painted
once. A nested `0x01` state wins over `0x1e`. OpenXTF must not infer arbitrary
CSS `text-align` from this recognition alone.

These states are not DOM/CSS inheritance. `FUN_4206ef9e` stores the
`h1`…`h6`/literal-`center` state as one boolean: an opening tag sets it and a
closing tag clears it, so a nested closing tag also clears an outer state. The
recognized `p`/`div` class route instead stores one active tag selector plus a
depth byte. Once active, only nested elements of that same tag increment the
depth (even without a recognized class), and only matching closing tags
decrement and eventually clear it; a different `p`/`div` tag is ignored by
that state machine. `FUN_420d9e84` combines those exact globals into layout
bytes `+10` (either centering route active) and `+11` (heading/literal-center
route active). `FUN_4207153e` reads those bytes only while the destination
record is empty, which makes the state at the first visible token decisive for
the record prefix. Later inline state changes do not retroactively re-prefix
the record.

The XHTML tokenizer in `FUN_420d663e` recognizes `<span>` (tag id `0x2b`), but
that route reaches `FUN_420d7168`, which only consumes the tag's attributes up
to `>`. It does not evaluate `class`, inline CSS, or stylesheet declarations.
Consequently a span such as `<span class="subscript2">` contributes its text
to the surrounding run but does not acquire the EPUB's `font-size`, color,
`line-height`, margins, or other CSS styling in this stock reader path.

## Whitespace, tabs, and inline control bytes

The ordinary raw-XHTML whitespace scanner in `FUN_420d7794` collapses only
ASCII TAB (`0x09`), LF (`0x0a`), CR (`0x0d`), and SPACE (`0x20`) to its single
space token. The compiled `0xff7fffec` mask leaves vertical tab (`0x0b`) and
form feed (`0x0c`) on the literal one-byte path. OpenXTF therefore must not use
a browser `\s` expression for this stage.

The same tokenizer maps U+180E, U+2000–U+200F, U+2028–U+202E,
U+2060–U+2069, and U+FEFF to its internal CR sentinel. On this path that
sentinel appends no bytes, creates no space, and does not end the surrounding
text token. OpenXTF omits those code points while preserving token continuity,
matching the firmware rather than browser Unicode-whitespace behavior.

### Entity decoding

Entity references are decoded by `FUN_420d4748`, not by an HTML5 parser. It
reads at most seven characters after `&`, requires a terminating semicolon,
and compares names case-sensitively. Unknown, overlong, unterminated, and
otherwise invalid references are rewound and remain literal text beginning
with `&`.

The exact named set present in V6.3.15 is:

```text
lt gt amp quot apos nbsp ensp emsp
copy reg trade euro pound yen deg middot bull
hellip lsquo rsquo ldquo rdquo ndash mdash
auml Auml euml Euml iuml Iuml ouml Ouml uuml Uuml yuml
aring Aring iexcl laquo raquo szlig
acirc ecirc icirc ocirc ucirc
eacute Eacute egrave Egrave aacute Aacute agrave Agrave
iacute Iacute igrave Igrave oacute Oacute ograve Ograve
uacute Uacute ugrave Ugrave yacute Yacute
ntilde Ntilde atilde Atilde otilde Otilde
ccedil Ccedil iquest
```

`nbsp` becomes internal byte `0x07`; `ensp` and `emsp` become ordinary
U+0020. Decimal `#…` and hexadecimal `#x…`/`#X…` forms are accepted only when
the complete value is in `1…65535`. Numeric 160 and 173 become internal bytes
`0x07` and `0x06`. Numeric U+200B–U+200F, U+2028–U+202E,
U+2060–U+2069, U+180E, and U+FEFF append no bytes. Other accepted numeric
values are encoded back to UTF-8, including U+2000–U+200A. This last point is
deliberately different from literal UTF-8 U+2000–U+200F, which the raw scanner
omits before record composition.

OpenXTF preserves raw entity spelling while constructing the inspection DOM
and runs this table during text-token normalization. Letting `DOMParser`
decode entities first is not firmware-faithful: browsers accept a much larger
name table, omitted semicolons, and supplementary numeric values that the
firmware leaves literal.

After EPUB tokenization, a source tab has already become the ordinary one-space
token above, so the EPUB preview measures and paints one U+0020. For reference,
the separate plain/alternate encoded-text reader expands a tab into literal
ASCII spaces rather than using a CSS tab stop. `FUN_420999ac` selects the count
from both line position and renderer mode:

| Position | Active XTF | Other renderer |
| --- | ---: | ---: |
| Empty line | 4 spaces | 8 spaces |
| Non-empty line | 2 spaces | 4 spaces |

The mapped constants contain exactly two, four, and eight U+0020 bytes. The
active-XTF width is therefore the sum of two or four normal XTF space
advances, including the serialized U+0020 ASCII-table width when present.

First-line indent is also serialized text, not a late X-coordinate offset.
`FUN_42071764` checks the first record character, classifies at most the first
32 UTF-8 bytes through `FUN_42069b54`, and inserts one or two U+3000 sequences
for a CJK-classified paragraph according to the device selector. The non-CJK
form uses the firmware's ASCII-space indent string. It measures and adds those
inserted bytes before the rest of the record, so they consume wrap width and
their XTF glyphs are painted. No indent is inserted when the record already
starts with U+0020 or U+3000, or when the block state suppresses indentation.

U+00A0 has deliberately asymmetric composition and painting behavior. In
`FUN_420d7794` it becomes a type-2 token whose temporary measurement text is
ordinary U+0020, so line composition adds the current XTF space-table width.
`FUN_420d866e` then serializes internal byte `0x07` into the line record. That
byte is neither a formatting control nor a printable ASCII-table index:
`FUN_42049070`/`FUN_420470e4` decode it as code point 7, advance by the XTF
`asciiWidth`, and resolve its bitmap through the normal direct → U+FFFD → `?`
→ generated-box fallback chain. It is not an ordinary blank on the active XTF
paint path and must not become a Wrap+Align U+0020 boundary. This explains why
an EPUB NBSP can be measured like a word space but appear as a replacement
glyph or outlined box on the device.

U+00AD is converted to internal byte `0x06`. That byte is excluded from the
page painter's script-classification scan, but it is not one of the four
zero-width inline-style controls. Unless an enabled language dictionary selects
the break and replaces the prefix ending with a visible ASCII hyphen, byte
`0x06` follows the one-byte `asciiWidth` measurement and the normal direct →
U+FFFD → `?` → generated-box paint fallback. This surprising behavior is kept
because it is explicit in the tokenizer and active-XTF painter.

The inline-state control pairs are `0x02`/`0x03` for bold begin/end and
`0x1c`/`0x1d` for italic begin/end. The exact parser comparisons in
`FUN_420d7794` are `b` and `strong` for the first state, and `i` and `em` for
the second. Those strings were read from the correctly mapped ELF at
`0x3c2355d0`, `0x3c24d5a8`, `0x3c225440`, and `0x3c20c344`; they were not
accepted from the raw payload's displaced DROM labels.

`FUN_4204d8c4` copies the bold state to the text token's first style byte and
the italic state to the second. `FUN_4207153e` initializes a new record in
this exact order: heading/centering prefix, active bold-start byte, active
italic-start byte. `FUN_420715aa` then emits bold transitions before italic
transitions as tokens change. `FUN_42042e8e`, `FUN_420470e4`, and
`FUN_42049070` recognize and skip all four state bytes. They are record
semantics, not glyphs, and consume no XTF width or painted advance.

The parser stores these as two booleans rather than nesting counters. Opening
either synonym sets its state to one and closing either synonym sets it to
zero. Consequently a nested `b`/`strong` pair is not CSS-stack-equivalent:
closing the inner synonym clears the state even while the outer element is
still structurally open. OpenXTF follows that parser state machine.

Four-byte UTF-8 input has one additional firmware-only transformation.
`FUN_420d7794` calls `FUN_4206e6de` for U+1D400–U+1D7FF. The helper replaces
mathematical alphanumeric symbols with ASCII letters or digits and embeds the
same zero-width style-control bytes directly around that ASCII byte. Its exact
52-code-point letter blocks are:

| Start | Family | Embedded controls |
| --- | --- | --- |
| U+1D400 | bold | `02 … 03` |
| U+1D434 | italic | `1C … 1D` |
| U+1D468 | bold italic | `02 1C … 1D 03` |
| U+1D49C | script | `1C … 1D` |
| U+1D4D0 | bold script | `02 1C … 1D 03` |
| U+1D504 | fraktur | none |
| U+1D538 | double-struck | none |
| U+1D56C | bold fraktur | `02 … 03` |
| U+1D5A0 | sans-serif | none |
| U+1D5D4 | sans-serif bold | `02 … 03` |
| U+1D608 | sans-serif italic | `1C … 1D` |
| U+1D63C | sans-serif bold italic | `02 1C … 1D 03` |
| U+1D670 | monospace | none |

The ten-code-point digit blocks start at U+1D7CE, U+1D7D8, U+1D7E2,
U+1D7EC, and U+1D7F6; only U+1D7CE and U+1D7EC receive bold controls.
The tables and flag bytes were read from the correctly mapped ELF at
`0x3c2ab46c`–`0x3c2ab4fb`. Any other scalar still inside
U+1D400–U+1D7FF becomes literal ASCII `?`; input outside that window remains
its original four-byte UTF-8 sequence. These embedded controls are retained
even when they are redundant with an enclosing `<b>` or `<i>` tokenizer
state, because the firmware writes bytes rather than normalizing styles.

## Inline markup details

The inline bold/italic control bytes have no visible effect in the active-XTF
painter. `FUN_420470e4` calls `FUN_42042e8e` for each record byte; when that
predicate recognizes `0x02`, `0x03`, `0x1c`, or `0x1d`, the loop advances past
the byte without measuring, loading, substituting, shifting, slanting, or
overdrawing a glyph. No alternate XTF face is selected. OpenXTF retains these
bytes and their exact record offsets in diagnostics because they affect the
serialized record, but it correctly leaves the finished XTF bitmap unchanged.

This is different from the `0x01` heading/literal-`center` record prefix. The
page painter handles that prefix at the record level and performs the verified
second draw at `x + 1`, so heading synthetic bold remains visible in preview.

## Horizontal XTF behavior: three independent stages

`FUN_42093b12` initializes the active context spacing words to 1.

Wrapping, XTF painting, and Wrap+Align placement are separate passes and must
remain separate in the preview and diagnostics. The first two passes happen to
use the same `fullWidth` value for ordinary Hangul; the third pass can add
distributed integer pixels.

### Stage 1: line splitting

EPUB content is tokenized by `FUN_420d7794`, composed into records by
`ComposePageRecordsV6315` at `0x420d866e`, and driven by
`ProcessEpubContentV6315` at `0x420ee200`. That processor calls
`BuildPageV6315` at `0x420d9e84`, which calls the composer, and later calls
`PaintPageTextV6315` at `0x420dcddc`. `RenderDirectStreamPageV6315` at
`0x420de492` is the separate direct-stream reader and is not the EPUB
paginator. These functions are the source of truth for the EPUB preview.
`FUN_420999ac` and `FUN_420e404c` are the
plain/alternate encoded-text readers. They verify shared low-level behavior—
per-character measurement, the active-XTF five-pixel overflow allowance,
prohibited-line-start punctuation carry, leading-U+0020 suppression, tabs,
and soft hyphens—but their entire control flow must not be substituted for the
EPUB composer.

The EPUB composer groups and classifies token runs before committing a line.
Its dictionary-assisted hyphenation trie and break guards are reproduced from
the firmware data and control flow; OpenXTF does not substitute browser
word-wrap or operating-system hyphenation.

For the main split route, `FUN_420723e0` applies the verified helpers in this
exact order:

```text
FUN_420701b8   composition-width prefix
FUN_42071de6   painter-width refit
FUN_4207005a   Tibetan delimiter / prohibited-start / opening-punctuation pair
FUN_4206ff26   firmware cluster and Tibetan boundary alignment
FUN_42071d58   Thai boundary correction
FUN_42071de6   second painter-width refit
FUN_4207005a   second delimiter/punctuation correction
FUN_420700e8   prohibited-start backoff
FUN_4206ff26   second cluster/Tibetan alignment
FUN_4207015a   combining-mark/base and Thai final correction
```

This order matters: punctuation may first be carried, then rejected by the
second paint fit, then reconsidered by the later boundary helpers. OpenXTF's
ordinary Korean/Latin UTF-8, punctuation, and mark stages follow that order.
Tibetan and Thai delimiter, cluster, and boundary-realignment behavior is
intentionally deferred. Those scripts must not be treated as parity-complete
or replaced with browser grapheme segmentation in the meantime.

The composer configuration byte at offset `+6` is set by
`FUN_420d9e84` to `readfx != 2`: Wrap+Align and the device's right option
enable the dictionary attempt, while left disables it. That attempt calls
`FUN_42070402` and the pattern engine rooted at `FUN_4204c9fc` only when an
active language dictionary exists. `FUN_4204ba9c` searches the exact eight
20-byte descriptors stored at ELF `0x3c27c1a4`:

```text
en, fr, es, it, pl, sv, ru, uk
```

The packed store begins at ELF `0x3c27c244`, is 142,895 bytes long, and has
SHA-256
`ad6b478778e1161d80043b2b87e8bdb456557efb4144be7b7e352465f6aa5b84`.
OpenXTF embeds those exact bytes and reproduces the firmware's big-endian
signed trie deltas, Latin/Cyrillic normalization, composition mapping,
left/right minima, explicit soft-hyphen candidates, and eight-result limit.
The JavaScript decoder was checked against a native runner made from the same
firmware-source algorithm for English, Polish, and Russian fixtures.

The compositor tries only the final returned candidate. Before inserting the
visible ASCII hyphen, it applies these four predicates in this exact order:

```text
FUN_4206f89e  preceding code point is opening punctuation
FUN_4206f94a  preceding code point is Thai/Lao preposed vowel
FUN_4206f91c  following code point is a combining/boundary mark
FUN_4206f870  following code point is prohibited at line start
```

Any true predicate rejects that candidate. The firmware does not then walk
backward through earlier dictionary candidates; it resumes its ordinary token
splitter. OpenXTF follows the same final-candidate and guard behavior.

`FUN_4204c614` accepts any two-letter ASCII language token and has this exact
three-letter alias switch:

```text
eng→en, ukr→uk, zho/chi→zh, jpn→ja, bod→bo, kor→ko,
fra/fre→fr, deu/ger→de, rus→ru, spa→es, swe→sv, ita→it
```

It stops at the first non-letter after case-folding ASCII A-Z and treats an
unrecognized three-letter value as `und`; notably, it does not map `pol` to
`pl`. The normalizer maps `kor` to `ko`, but no `ko` descriptor exists.
Consequently the supplied `test.epub` (`dc:language=ko`) takes no dictionary
hyphenation path, including for Latin names embedded in its Korean text. This
is a firmware language-state result, not a linguistic guess from the text.

The same configuration byte also changes ordinary overflow handling inside
`FUN_420d866e`. In left mode, when the current record already has content and
the next complete token fits the full record width but not the remaining
width, the compositor commits the current record and retries that token on the
next record. Wrap+Align and right mode instead enter the token-splitting and
boundary-correction path. Alignment therefore affects record boundaries as
well as final x placement. OpenXTF retains tokenizer boundaries independently
from glyph/code-point boundaries for this reason.

`FUN_420424f8` returns XTF object byte `+9`, which is raw XTF header byte
`0x0d` (`fullWidth`). In `FUN_42098106` that getter's result is written to the
fixed wide-character word at `gp - 0x2fc`. When the XTF object is active,
`FUN_42095120` measures through `FUN_42049070`; its inactive-object fallback
uses that copied word through `FUN_42081154`. Both routes resolve an ordinary
Hangul syllable to `fullWidth`. The supplied `defaultridi.xtf` therefore
measures each syllable as exactly 28 px while deciding line breaks. Raw header
byte `0x0a` (`cellW=39`) is the stored bitmap width and is not the
ordinary-Hangul splitter advance.

The same rule also covers multi-byte characters outside
`FUN_42046cdc`'s narrow metadata ranges. `FUN_42049070` passes XTF
`fullWidth` and `asciiWidth` to `FUN_42046fba`; for decomposed Hangul Jamo and
supplementary fallback characters, that helper replaces the initial ASCII
fallback with `fullWidth`. It never scans the glyph ink to choose the
composition width. OpenXTF therefore uses `fullWidth` for both their split and
paint advances unless the exact metadata classifier selects the glyph-record
advance path.

In the plain UTF-8 reader, `FUN_420e404c` performs an additional boundary
correction that is absent from `FUN_420999ac` itself. If
an automatically split line ends in an ASCII letter or comma and the next
input character is also an ASCII letter or comma, it searches backward for an
ASCII space, ASCII hyphen, or UTF-8 U+2014 em dash. Its non-dictionary fallback
only rolls the suffix to the next line when that suffix contains no three-byte
UTF-8 sequence in the normal UTF-8 mode; the next-line loop subsequently skips
leading U+0020 bytes. The dictionary-assisted hyphenation path is separate and
must not be approximated from this fallback.

### Stage 2: active-XTF painting

`FUN_420dcddc` activates the XTF object and draws through
`FUN_42049380`/`FUN_4204938a` into `FUN_420470e4`. Ordinary Hangul uses XTF
`fullWidth`, not a scan of its ink bounds. The supplied file's base Hangul
pen advance is therefore 28 px. Metadata/ink-derived advances are enabled only
for the narrower script ranges selected by `FUN_42047040` and
`FUN_42046cdc`; ordinary Hangul is outside those ranges.

The bitmap origin still honors XTF metadata byte 1 as a signed X offset:
`FUN_420024ac` returns it and `FUN_420470e4` passes it directly to
`FUN_4204507c`. The firmware does not shift every glyph left to normalize its
scanned ink bound.

ASCII, including U+0020, first uses the optional 95-entry XTF ASCII-width table
through `FUN_4204257a`; zero entries fall back to XTF `asciiWidth`. In the
supplied file the serialized space width is 9 px. The `(cellW >> 2) + 1` rule
and per-character `+1` seen in `FUN_42080700` belong to the non-XTF painter and
must not be applied to this v2-XTF page path.

### Stage 3: Wrap+Align distribution

`FUN_420dcddc` has two different distribution routes. Its high-level
three-byte classifier covers `3000-9FEF`, `F900-FAD8`, `FE30-FE4F`, and
`FF01-FF60` (with a separate Tibetan `0F0B`/`0F0C` case), but notably omits
Hangul `AC00-D7A3`. Therefore a line containing
ordinary Hangul and ASCII, but no character that sets that CJK-line state,
takes `FUN_42042076` rather than the CJK `FUN_4204938a` route.

`FUN_42042076` first measures U+0020 through `FUN_42042040` →
`FUN_42049070`, so the supplied XTF uses its serialized 9 px space. It excludes
leading and trailing ASCII spaces, divides the remaining line width across
only the internal U+0020 spaces, and applies integer quotient plus remainder in
order. It does **not** insert justification pixels after Hangul syllables. This
is the firmware reason word gaps can be visibly much larger on the device even
when the Hangul-to-Hangul rhythm is unchanged.

The helper itself contains a signed compression path, but the active-XTF EPUB
caller invokes `FUN_42042076` only when remaining width is strictly positive.
At zero or negative remaining width it calls the direct XTF painter instead.
OpenXTF therefore expands internal word spaces on eligible ordinary records but
does not expose the helper's unreachable negative-space compression as device
behavior.

Lines that set the high-level CJK state instead reach `FUN_4204938a`, which
enables the lower distribution branch in `FUN_420470e4`. `FUN_420439d4` marks
U+0020 and its supported three-byte wide characters as eligible, while
`FUN_42044668` counts the boundaries with leading-whitespace handling. The
signed remaining pixels are divided with integer quotient and remainder; the
first remainder boundaries receive one additional pixel.

Before that active-XTF dispatch, `FUN_420dcddc` also rejects CJK distribution
when the positive natural remainder is strictly greater than
`2 × max(fullWidth, 8)`. Equality is still eligible, and this gate does not
reject a negative remainder. With `fullWidth=28`, a CJK-state record with more
than 56 px left uses the direct painter instead of stretching its boundaries.

That CJK-state route has two further Korean/Latin-visible rules. A record
ending in exactly one ASCII graphic character bypasses distribution. A record
ending in two or more consecutive ASCII graphics retains a small
undistributed reserve; with `fullWidth=28`, the reserve is
`min(remainingWidth, 28 / 14) = min(remainingWidth, 2)` pixels.

Before CJK-boundary distribution, `FUN_420470e4` can tighten a supported final
closing-punctuation glyph selected by `FUN_42047098`. It reads the actual XTF
bitmap's rightmost occupied column through `FUN_420432ea`, adds the signed X
offset and a width-dependent margin, clamps the result to at least
`asciiWidth`, and uses it only when it remains smaller than the normal base
advance. The reclaimed pixels join the distributed remainder. This adjustment
depends on the finished XTF bitmap and is reproduced from those bytes; it is
not browser punctuation kerning.

The `ceil(remaining / count) < 4` comparison visible elsewhere in
`FUN_420dcddc` is not a general active-XTF eligibility gate. Its containing
branch is reached only when the `.xtf` predicate is false and another layout
state is present. Applying that test to ordinary Hangul XTF lines was a false
cross-branch inference. Explicit/manual endings and actual text-ending lines
bypass ordinary Wrap+Align distribution, as do the non-Wrap alignment modes.
An automatically wrapped final line of the visible page is not rejected merely
because it is page-last when content continues onto the next page.

The persisted alignment selector (`readfx`) has three UI values, but only two
distinct active-XTF branches. In `FUN_420d9e84`, values 0 (Wrap+Align) and 1
(device label: right align) both pass the same enabled flag to the EPUB
composition/hyphenation path. `FUN_420dcddc` likewise distinguishes only
value 2 from all other values in its active-XTF route. Therefore values 0 and
1 use identical ordinary XTF placement and distribution; value 2 is the left,
non-distributed route. Implementing value 1 as CSS-style right alignment would
contradict the firmware.

The complete stored XTF cell is painted and clipped only by the framebuffer,
not by its horizontal advance box. EPUB CSS `line-height` is not an input to
this painter.

### Superseded horizontal model

An earlier trace treated `cellW=39` as the Hangul splitter width and described
the painter as deriving ordinary-Hangul advance from ink. That model is
rejected. It resulted from confusing the XTF object's bitmap-width byte with
the `FUN_420424f8` getter. The getter/header-offset trace and the active painter
both resolve ordinary Hangul to `fullWidth=28`; ink-derived advance is limited
to the script ranges selected by `FUN_42047040`/`FUN_42046cdc`.

The earlier model also assigned the lower painter's Hangul/space-boundary
distribution and a `<4 px` gate to all active-XTF Hangul lines. That is rejected
after tracing the surrounding `.xtf` predicate and high-level classifier.
Ordinary Hangul uses `FUN_42042076` and distributes only across internal ASCII
spaces.

OpenXTF reports ink beyond advance, content-margin overflow, physical-frame
clipping, and pixels occupied by glyphs from different lines separately.

## What an XTF file can influence

`FUN_420014b2`/`FUN_420027d2` load the v2 XTF header into the active object,
while the renderer consumes only a subset of those values. The distinction
below is important: a field can be valid XTF metadata without being consulted
by this reading path.

| XTF data | Stock V6.3.15 reading effect |
| --- | --- |
| `bpp` (`0x07`) | Selects 1-bpp or two-plane 2-bpp bitmap decoding and therefore stored darkness levels. |
| flags/metadata bit (`0x08`, bit 1) | Enables the per-glyph metadata prefix used for X offsets and the narrow-range metadata advance path. |
| `cellW` (`0x0a`) | Bitmap row stride, storage width, generated fallback-box width, and the cell area the blitter can paint. It is not ordinary Hangul advance. |
| `cellH` (`0x0b`) | Bitmap storage/draw height. It is also the line-advance fallback only when header `advanceY` is zero. The bitmap can overlap adjacent line boxes or be clipped independently of pagination. |
| `advanceY` (`0x0c`) | Base line-origin step used by the EPUB reader; zero falls back to `cellH`. Manual reader spacing multiplies this effective value by the chosen 1.2…2.0 factor, and Auto uses it to calculate initial page capacity before page redistribution. |
| `fullWidth` (`0x0d`) | Ordinary Hangul/CJK composition width and painted pen advance. It also determines the advance of inserted U+3000 first-line-indent glyphs. |
| `asciiWidth` (`0x0e`) | Fallback advance when the printable ASCII table is absent/zero, and the paint advance for remaining one-byte internal values such as NBSP byte `0x07`. |
| ascender/descender (`0x10`/`0x12`) | Stored metadata only in this active XTF page path; neither moves the glyph cell nor changes line origins. |
| 95 ASCII widths | Per-character advance for U+0020…U+007E; U+0020 directly controls ordinary word-space width and Wrap+Align gap measurement. |
| range coverage | Determines whether direct glyph data exists and therefore when U+FFFD, `?`, or the generated box is used. |
| per-glyph X offset | Signed bitmap-origin displacement, applied directly during blitting. |
| per-glyph stored advance | Used only by the firmware's selected narrow-script metadata routes, not ordinary Hangul. |
| glyph bitmap pixels | The reproducible logical 1-bpp/2-bpp pre-panel image. Raster size, crop, threshold/gamma and embolden change these stored pixels during conversion. |

Line-spacing selector, paragraph ratio, first-line indent, alignment mode,
framebuffer margins, centering markers, and page pagination are firmware/runtime
state. They are not properties stored in an XTF file.

### OpenXTF control-to-preview contract

The Korean-reading editor exposes the appearance-affecting conversion inputs
below. Each change invalidates the finished-XTF cache, rebuilds the same XTF
bytes that would be downloaded, parses those bytes again, and supplies them to
the V6.3.15 preview. The summary at the top of the controls is read back from
that parsed XTF header and U+0020 width table; it is not echoed from form state.
The preview does not use CSS font metrics or a parallel browser-font
approximation.

| OpenXTF control | What is changed in the generated XTF | V6.3.15-visible result |
| --- | --- | --- |
| Font source and supplemental-font order | Source of each packed glyph bitmap and its source metrics | Typeface, glyph shape, and which font supplies a missing character |
| Source raster size | Browser font-rasterizer input pixel size before packing | Glyph scale and bitmap detail; it does not directly set the firmware line step |
| Stored cell width/height (`cellW`/`cellH`) | Header dimensions, row stride, record size, and repacked bitmap bounds | Drawable bitmap area and clipping; `cellH` is also the line-step fallback when `advanceY=0` |
| Bitmap X/Y shift inside cell | Pixel position inside every repacked cell | Visible glyph position without changing the nominal pen advance or line origin |
| Conversion baseline row | Baseline used while OpenXTF repacks source pixels; the same value is stored as ascender metadata | Visible vertical position of packed pixels. The firmware does not apply the stored ascender a second time |
| Hangul/CJK character width (`fullWidth`) | Header `fullWidth` and stored U+3000 advance | Ordinary Hangul/CJK wrap measurement, painted advance, and CJK first-line indentation |
| Line-spacing base (`advanceY`) | Header `advanceY` | Firmware line-spacing base and page-capacity input; zero selects `cellH` |
| ASCII fallback width (`asciiWidth`) | Header `asciiWidth` | Advance for zero/missing ASCII-table entries and the verified internal one-byte fallback routes |
| Word-space width (U+0020) | U+0020 ASCII-width-table entry and U+0020 glyph metadata | Actual ordinary-space width before any firmware justification; zero falls back to `asciiWidth` |
| Stored-width adjustment for Latin/narrow glyphs | Source-derived per-glyph advance metadata and printable-ASCII width entries | Latin/ASCII and the verified narrow metadata ranges only; ordinary Hangul remains controlled by `fullWidth` |
| Stored pixel levels (`bpp`) | Header bpp and repacked bitmap planes | Binary 1-bpp or four-level 2-bpp glyph edges |
| Stroke-darkness preset | Gamma and quantization-threshold inputs | A convenient preset that changes the packed pixel levels; it is not a separate firmware field |
| Stroke weight | Bitmap morphology before packing | Thicker or thinner stored strokes |
| Raster tone curve and pixel-level boundaries | Tone curve and final 1-bpp/2-bpp quantization | Exact stored pixel levels and ink bounds |
| Stored glyph coverage and force-included characters | Range table, glyph count, and glyph records | Whether a code point has a direct glyph or enters the firmware replacement/box fallback chain |
| Bake browser fallback glyphs into XTF | Adds packed glyphs rendered by the browser only for still-uncovered code points | Those characters use the build environment's default serif instead of the firmware replacement chain |

The source rasterizer also derives printable-ASCII table entries and the
per-glyph metadata advances from each source face. The XTF metadata-presence
flag and individual records are therefore generated data, not separate global
typography switches. The current converter emits zero per-glyph X offsets;
global horizontal placement is exposed as bitmap X shift. A future per-glyph
editor could alter those signed offset bytes, but presenting a single raw
“metadata flag” switch would be misleading because the flag alone has no
visual meaning without changing every affected record.

The raw XTF descender header value is intentionally not an appearance control:
the active page path does not consult it for placement. The ascender header is
also not advertised as a firmware positioning metric; the visible “baseline
row” control is a conversion operation that moves pixels before serialization.
Likewise, the former strict-crop switch affected only OpenXTF validation and
not one output byte, so it is hidden. Ink lost outside the selected cell remains
reported by diagnostics without blocking a deliberately chosen geometry.

The output filename is retained as an output-management option and is explicitly
described as non-visual. It does not change XTF bytes or the preview.

`FUN_4204507c` clips each painted cell to the 480×800 framebuffer. Its 2-bpp
loop reads each source byte in the exact pair order bits 7–6, 5–4, 3–2, 1–0.
Source bit 0 clears the corresponding pixel in framebuffer plane 0 and source
bit 1 clears it in plane 1. Since both planes begin white, drawing a second
glyph over a pixel accumulates the source codes with bitwise OR. It does not
alpha-composite browser grays or replace the existing pixel with the
numerically darker input. OpenXTF stores and composes those same logical codes
and maps codes 0…3 to white…black only when producing the browser image. It can
therefore reproduce the exact pre-panel logical framebuffer. It cannot
reproduce the physical e-ink controller's waveform, panel history, ghosting,
lighting, camera optics, or display-surface appearance.

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
of the 39 × 38 storage cell. This is a default font-conversion choice, not a
preview calibration: the preview must pass the resulting XTF through the
firmware-derived model unchanged.

### Late-record screen clipping and the safe-fit action

The supplied Korean EPUB produced a useful current-build fixture. With the
default RIDI conversion and the manual 1.2× / paragraph 1.5× reader choices,
the selected page had no horizontal content overflow and no cross-line ink
collision, but its last text record was drawn at Y=775 and twelve glyphs
extended below the 480×800 framebuffer. This is not an EPUB data-loss event and
is not repaired by narrowing Hangul or changing word spacing.

The cause is verified in the explicitly selected
`/V6.3.15-X4-EN-PROD-0905_113512.elf`. `FUN_42094f8e` compares the accumulated
page budget with the display height minus the 17-pixel lower reserve; it does
not query the actual nonblank rows of the final glyph. `FUN_4204507c` then
iterates the stored 1-bpp/2-bpp cell at the requested origin and clips samples
whose transformed framebuffer coordinates are outside the physical surface.
The page fitter can therefore accept a late record whose glyph bitmap is
positioned too low inside its cell.

OpenXTF's one-click screen-fit action operates on the same finished XTF and
the same current page. It first moves the serialized bitmap by only the exact
integer overflow distance and accepts that correction only when rebuilding
from the unprofiled source XTF does not discard any ink pixels. If
translation would crop source ink, it preserves raster size, Hangul width, and
every glyph pixel, then searches upward from the current `advanceY` for the
smallest firmware line base that yields an unclipped current page. It never
solves this condition by horizontally squeezing Korean text. Diagnostics show
both independent failure classes: framebuffer clipping during firmware paint,
and ink discarded earlier while reframing the source glyph into the XTF cell.
The action is deliberately scoped to the currently rendered page and selected
reader settings; changing the EPUB section or the device line/paragraph choice
requires checking that resulting page again.

## Diagnostic contract

Diagnostics and the preview image share the same decoded XTF records and page
placement pass. They expose:

- the finished XTF data and header CRC32 values, so a comparison can identify
  the exact generated font bytes rather than relying on its filename;
- initial pagination step and maximum record count;
- final page-painted step and its exact binary32 word;
- Auto normal intervals, paragraph intervals, weighted denominator, and 756 px
  numerator;
- paragraph step and extra distance;
- the exact 22…778 origin span, `0.99f` conversion bias, and integer origins;
- skipped empty XHTML blocks and any explicit empty LF line records;
- per-line splitter width, XTF paint width, pre-justify extent,
  applied integer justification, transition, record-ending bytes, effective
  alignment branch, centering marker, exact inline state-control bytes and
  byte offsets, synthetic-bold pass, and break reason;
- per-glyph splitter advance, XTF painter advance, final distributed advance,
  fallback paths, and clipping;
- the serialized U+0020 ASCII-table entry, its fallback, and other whitespace
  paths;
- each EPUB image record's source dimensions, firmware-selected draw size,
  centered draw origin, independent Y offset, cache/placeholder path, and
  frame clipping;
- image suppression of whole-page Auto redistribution, plus image-inclusive
  record capacity and page-fit budget; and
- page truncation, remaining record count, and the first source character
  assigned to the next page.

The preview is not considered closed or 1:1 while any active EPUB-composer
branch remains approximated. The implementation audit is maintained against
`ProcessEpubContentV6315` (`0x420ee200`), `BuildPageV6315` (`0x420d9e84`),
`ComposePageRecordsV6315` (`0x420d866e`), `PaintPageTextV6315`
(`0x420dcddc`), and the image-placement and dictionary-hyphenation helper
graphs. `RenderDirectStreamPageV6315` (`0x420de492`) is retained only as the
separate direct-stream reader; it is not the EPUB page builder. Device
photographs may expose an unmodeled branch, but similarity to a photo is never
a success condition.
Closure requires a matching firmware trace and a reproducible pre-panel
framebuffer result for every active branch.

## Korean/Latin parity closure matrix

`Verified` below means the behavior was read from the selected
`/V6.3.15-X4-EN-PROD-0905_113512.elf`, not inherited from an older firmware or
inferred from a photograph. `Fixture` means an executable regression pins the
browser result. A row is not closed merely because the current preview looks
plausible.

| Active path | Firmware evidence | Browser model | Fixture | State / remaining gap |
| --- | --- | --- | --- | --- |
| XTF recognition, header, range lookup, ASCII table, 1/2-bpp records | `0x4205ba98`, `0x420425b2`, `0x420014b2`, `0x420027d2` | Implemented from finished downloaded XTF bytes | Controlled XTF header/space fixture and stable output hashes | Closed for accepted XTF v2 files |
| Direct glyph, U+FFFD, `?`, generated-box fallback order | `0x420470e4` and lookup helpers | Implemented per painted code point | Missing-Hangul → `?` fixture | Closed for Korean/Latin |
| EPUB tokenizer, block table, ignored containers, whitespace, entities and invisible controls | `0x4206eb80`, `0x4206ebfc`, `0x4206e84e`, `0x420d7794` | Sequential source scanner implemented in `app/epub.ts`; browser tree repair is bypassed | Unit fixtures plus a synthetic zipped EPUB in real Firefox pin whitespace, entities, ignored content and source-order tag state | Closed for the tested Korean/Latin token and tag classes |
| Inline bold/italic bytes and mathematical-alphanumeric remapping | `0x4206e6e6`, `0x420d7794`, `0x420470e4` | Serialized state is retained for diagnostics and consumed without changing XTF ink | Mathematical bold/italic byte fixture | Closed for Korean/Latin |
| Empty blocks and automatic/manual/paragraph/text/source/page endings | `0x4206ebfc`, `0x420713a0`, `0x4205702c`, composer/painter calls | Five distinct endings modeled | Record suffix, source-end, pagination and in-browser EPUB fixtures | Closed for the verified Korean/Latin path |
| EPUB line splitting and the second painter-width gate | `0x420d866e`, `0x420701b8`, `0x42071de6`, `0x420719aa` | Layout and paint advances are separate; trailing source spaces are consumed but not painted | Exact-width, NBSP refit, opening/closing punctuation and Hangul full-width fixtures | Closed for the verified Korean/Latin units and punctuation paths |
| Language dictionaries, explicit soft hyphen and legal-break guards | `0x4204baa4`, `0x4204baf2`, `0x42070402`, punctuation helpers | Exact packed V6.3.15 dictionaries and guards implemented | English, Polish, Russian, Korean-none, soft-hyphen and visible inserted-hyphen fixtures | Closed for the supported Korean/Latin dictionary path |
| XTF glyph paint advance and bitmap clipping | `0x420470e4`, XTF lookup/blit helpers | Finished records, signed X offsets and framebuffer clipping modeled | Screen-bottom clipping and safe crop-shift fixtures | Closed for Korean/Latin glyphs |
| Wrap+Align/right/left and ordinary-Hangul versus CJK-state distribution | `0x42042076`, `0x420dcddc` | Split, natural paint and integer distribution remain separate stages | Hangul-space modes, CJK remainder, and one/two trailing-Latin fixtures | Closed for the verified Korean/Latin/CJK-state branches |
| Manual/Auto line steps, paragraph ratio, indentation, capacity and origin conversion | `0x420570dc`, `0x4205702c`, `0x420dcddc` | Binary32 arithmetic, 22…778 origin span and transition/page-fit modes implemented | Manual, Auto, paragraph-ratio and late-line fixtures | Closed for current Korean defaults and exposed runtime choices |
| Heading/literal-center/class-center handling and ignored CSS | `0x4206ec7e`, `0x4206ef9e`, `0x4207153e`, `0x420d9e84`, `0x420dcddc` | Exact class set, record prefixes, centering and one-pixel heading pass implemented | Synthetic zipped EPUB in real Firefox covers class/literal center, headings, nested styles and ignored inline CSS | Closed for the verified Korean/Latin tag-state path |
| Image record sizing, page fit, placement and placeholder | composer image branch, `0x420942d2`, `0x42073b4c`, `0x420943b4`, `0x42054d8a` | Separate image records and transitions modeled | Manual/Auto placeholder fixture | Closed for record/layout behavior |
| Native XTG and JPEG cache raster | `0x4205e08c`, `0x42055f5c`, `0x42069688`, `0x403808a4` | XTG exact; pinned TJpgDec WASM plus V6.3.15 resample/dither path | XTG bit fixture, JPEG decoder fixture and stable hashes | Closed from a fresh JPEG-cache phase; existing-device phase history is explicitly reported |
| PNG and BMP source decoding before verified firmware scaling/dither/crop | `FUN_420cd5c2`, `FUN_42040d56`, `FUN_42040df0`, PNG row callbacks, `0x42053846`, `FUN_420a8d52`, `0x420cdf7e` | Both formats decode source bytes natively before the recovered scaler/dither/crop | PNG color/depth/filter/CRC/Adam7/alpha fixtures; BMP bit-depth/orientation/compression fixtures | Closed for accepted V6.3.15 PNG and BMP inputs |
| Display line/rectangle raster before panel refresh | vtables `0x3c269114`/`0x3c29f2a0`, `0x4200a67c`, `0x4200a5f0`, `0x4200a3ce` | Strict-tie Adafruit-style line walk implemented | Forward/reverse steep tie fixture | Closed for logical framebuffer primitives |
| Physical e-ink waveform, ghosting and photographed contrast | Outside the logical framebuffer contract | Intentionally not simulated | Not applicable | Out of scope; never used to tune typography |
| Tibetan and Thai shaping/cluster branches | Present in firmware | Partially traced | Not complete | Deliberately deferred at the user's direction |

The overlay's horizontal guides are draw origins, not typographic baselines.
