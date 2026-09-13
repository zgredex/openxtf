#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
default_tmp_root="/tmp"
if [[ -d /private/tmp ]]; then
  default_tmp_root="/private/tmp"
fi
build_tmp_root="${OPENXTF_BUILD_TMP:-$default_tmp_root}"
work_dir="$(mktemp -d "$build_tmp_root/openxtf-jpeg.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

upstream_commit="b764d104fc1c25f9af147c3bcb314cb1adf189dd"
git clone --quiet https://github.com/Bodmer/TJpg_Decoder.git "$work_dir/upstream"
git -C "$work_dir/upstream" checkout --quiet --detach "$upstream_commit"
test "$(git -C "$work_dir/upstream" rev-parse HEAD)" = "$upstream_commit"

perl -0pi -e 's/#define\s+JD_FORMAT\s+1/#define JD_FORMAT 2/' \
  "$work_dir/upstream/src/tjpgdcnf.h"
perl -0pi -e 's/#define\s+JD_TBLCLIP\s+0/#define JD_TBLCLIP 1/' \
  "$work_dir/upstream/src/tjpgdcnf.h"
perl -0pi -e 's/\*pix\+\+ = \(uint8_t\)\*py\+\+;/\*pix++ = BYTECLIP(*py++);/' \
  "$work_dir/upstream/src/tjpgd.c"
cp "$repo_root/tools/v6315-jpeg/openxtf_v6315.c" \
  "$work_dir/upstream/src/openxtf_v6315.c"

emcc_cache="$work_dir/em-cache"
emcc_bin="$(command -v emcc)"
env EM_CACHE="$emcc_cache" "$emcc_bin" \
  "$work_dir/upstream/src/tjpgd.c" \
  "$work_dir/upstream/src/openxtf_v6315.c" \
  -I"$work_dir/upstream/src" \
  -O3 \
  -s STANDALONE_WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FILESYSTEM=0 \
  -s MALLOC=emmalloc \
  -s EXPORTED_FUNCTIONS=_malloc,_free,_openxtf_v6315_jpeg_decode \
  --no-entry \
  -o "$repo_root/public/v6315-jpeg.wasm"
