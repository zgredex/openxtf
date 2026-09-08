# OpenXTF

OpenXTF is a browser-local compatibility implementation of XT-Cloud Font Maker
v1.16.7. Its first milestone intentionally mirrors the reference application;
it does not introduce conversion options or algorithms of its own.

Korean is the default interface language. English is available from the
language switch in the header, and an explicit choice is remembered locally in
the browser.

Live application: <https://openxtf.pages.dev/>

## Compatibility sources

The byte-level format and behavior specifications live in
[`../xtfont-research/`](../xtfont-research/). The browser worker, FreeType WASM
runtime, default device repertoire, and controlled reference fixtures are pinned
to hashes recorded there.

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
