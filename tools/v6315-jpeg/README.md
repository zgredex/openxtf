# V6.3.15 JPEG decoder build

`public/v6315-jpeg.wasm` is built from TJpg_Decoder v1.0.8 commit
`b764d104fc1c25f9af147c3bcb314cb1adf189dd`. The stock X4 V6.3.15 ELF was
used to determine the compiled decoder configuration and the wrapper behavior.

The build applies the three current-firmware differences that are visible in
the selected ELF:

- grayscale (`JD_FORMAT=2`) output;
- the 1024-byte saturation table (`JD_TBLCLIP=1`);
- saturation of non-1/8 grayscale IDCT samples before scale averaging.

The C wrapper reproduces `FUN_42069688`'s 1/2/4/8 TJpgDec scale selection and
`FirmwareJpegResampleCallbackV6315` at `0x4201c804`, including its per-MCU
integer nearest-neighbor resampling. Rebuild with `npm run build:jpeg-decoder`.

See `LICENSE.txt` and `docs/V6315-XTF-RENDERER.md` for provenance and the
firmware evidence boundary.
