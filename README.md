# OpenXTF

OpenXTF is a browser-local XT font builder. Standard XTFont mode follows the
current official XTFont Maker defaults, hidden per-font tuning, automatic
measurement and serialization. OpenXTF then previews the completed XTF through
the decompiled X4 V6.3.15 rendering path instead of treating the converter's
generic canvas preview as device firmware.

The separate Korean reading profile applies its documented fixed XTF metrics
after official rasterization. It remains the default profile.

Korean is the default interface language. English is available from the
language switch in the header, and an explicit choice is remembered locally in
the browser.

Live application: <https://openxtf.pages.dev/>

## Compatibility sources

The firmware-backed V6.3.15 glyph, spacing, EPUB, image, and framebuffer
mapping used by the Korean preview is documented in
[`docs/V6315-XTF-RENDERER.md`](docs/V6315-XTF-RENDERER.md). The browser worker,
FreeType WASM runtime, default device repertoire, and controlled fixtures are
kept in this repository with the implementation they verify.

## Privacy boundary

Font parsing, preview rendering, and conversion run locally in the browser.
OpenXTF does not need an application backend to construct XTF or legacy BIN
fonts.

## Development

```sh
npm run dev
npm run build
npm run verify:compatibility
```

`verify:compatibility` expects the development site at `http://localhost:3000`
and compares all four controlled outputs with the official Firefox fixtures.
Set `OPENXTF_URL` to test another deployment.

## Cloudflare Pages

The project uses vinext static export, producing `dist/client`. Publish the
same verified client-only artifact with:

```sh
npm run deploy:pages
```

No server-side conversion function is deployed. The browser receives the
pinned worker, FreeType WASM runtime, and character repertoire as static
assets; selected font files and generated output stay on the user's device.
