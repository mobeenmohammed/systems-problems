#!/usr/bin/env bash
# Build a patched rustc.wasm — the one lowering the browser compiler is
# missing — and the sysroot that goes with it.
#
# This is the build patches/README.md says this repository does not do.
# It does it now, because the alternative was to keep reporting the same
# blocker: four Rust exercises type-check and will not run, for a single
# unimplemented opcode pair in the CLIF-to-wasm translator.
#
# It follows AngelOnFira/wasm-rustc's own CI workflow, which is the
# supported way to build this: bjorn3's branch ships a bootstrap.toml
# with host = wasm32-wasip1, the Cranelift backend, and download-ci-llvm,
# so NO LLVM is compiled here. What is compiled is rustc itself, to
# wasm32, which is the several-hour part.
#
# Resumable. Every phase writes a marker and is skipped on a re-run, so
# an interrupted build is restarted by running this again, and x.py's own
# incremental state does the rest.
#
#   Run from WSL (or any Linux with gcc, cmake, ninja, python3, curl):
#     bash scripts/build-rustc-wasm.sh
#
#   Watch:  tail -f <repo>/_rustbuild/build.log
#   Output: <repo>/_rustbuild/out/{rustc.wasm,sysroot-wasip1.bundle}
#
# Nothing here needs root. The upstream workflow apt-installs build tools
# and adds swap; this assumes the tools are present and limits the job
# count instead, because a machine with 7 GB of RAM and sixteen cores
# will be killed by the kernel long before it runs out of work.

set -euo pipefail

REPO_WIN="${REPO_WIN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WORK="${WORK:-$HOME/rustbuild}"
RUST_FORK="${RUST_FORK:-https://github.com/AngelOnFira/rust}"
RUST_REF="${RUST_REF:-riw-wasm20}"
HELPERS="${HELPERS:-https://github.com/AngelOnFira/wasm-rustc}"
JOBS="${JOBS:-6}"
WASI_SDK_URL=https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-32/wasi-sdk-32.0-x86_64-linux.tar.gz

OUT="$REPO_WIN/_rustbuild/out"
LOG="$REPO_WIN/_rustbuild/build.log"
mkdir -p "$WORK" "$OUT" "$(dirname "$LOG")"

say() { printf '\n=== %s — %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
done_marker() { [ -f "$WORK/.done-$1" ]; }
mark() { touch "$WORK/.done-$1"; }

say "building into $WORK, logging to $LOG"

# ---------------------------------------------------------------- clone
# A plain clone, not actions/checkout and not --depth 1: bootstrap walks
# history to find the upstream commit whose prebuilt LLVM it downloads,
# and a shallow clone leaves it with nothing to walk.
if ! done_marker clone; then
  say "cloning $RUST_FORK @ $RUST_REF (this is a large repository)"
  rm -rf "$WORK/rust"
  git clone --no-checkout "$RUST_FORK" "$WORK/rust" >>"$LOG" 2>&1
  git -C "$WORK/rust" checkout "$RUST_REF" >>"$LOG" 2>&1
  mark clone
fi

if ! done_marker helpers; then
  say "cloning the packaging scripts"
  rm -rf "$WORK/wasm-rustc"
  git clone --depth 1 "$HELPERS" "$WORK/wasm-rustc" >>"$LOG" 2>&1
  mark helpers
fi

# ---------------------------------------------------------------- patch
if ! done_marker patch; then
  say "applying patches/clif2wasm-smulhi.patch"
  git -C "$WORK/rust" apply --verbose "$REPO_WIN/patches/clif2wasm-smulhi.patch" 2>&1 | tee -a "$LOG"
  grep -q 'pub fn smulhi64' "$WORK/rust/compiler/rustc_codegen_cranelift/clif2wasm/src/i128_lower.rs"
  grep -q 'Opcode::Smulhi | Opcode::Umulhi' "$WORK/rust/compiler/rustc_codegen_cranelift/clif2wasm/src/ops.rs"
  say "patch applied and both halves are present in the tree"
  mark patch
fi

# ------------------------------------------------------------- WASI SDK
if ! done_marker wasisdk; then
  say "fetching WASI SDK 32"
  ( cd "$WORK/rust"
    curl -fL --retry 3 -o wasi-sdk.tar.gz "$WASI_SDK_URL" >>"$LOG" 2>&1
    tar -xzf wasi-sdk.tar.gz && rm wasi-sdk.tar.gz
    test -x wasi-sdk-32.0-x86_64-linux/bin/clang )
  mark wasisdk
fi
export WASI_SDK_PATH="$WORK/rust/wasi-sdk-32.0-x86_64-linux"
export WASI_SYSROOT="$WASI_SDK_PATH/share/wasi-sysroot"

# ----------------------------------------------------------------- LLVM
# The branch's bootstrap.toml downloads a prebuilt LLVM from rust-lang
# CI. That artifact has expired: bootstrap resolves this branch to an
# upstream commit from July and ci-artifacts.rust-lang.org 404s it, so
# the download cannot be the way in any more and the upstream workflow
# would fail here too.
#
# Doing without LLVM is not an option either, tempting as it looks on a
# tree whose host is wasm32 and whose backend is Cranelift: dropping the
# LLVM backend makes bootstrap build the x86_64 side with Cranelift, and
# compiler_builtins has x86 inline assembly that Cranelift cannot
# assemble. It gets as far as `Failed to assemble ... fma_with_fma`.
#
# So: an official LLVM release, unpacked here, pointed at by
# llvm-config. The tree wants >= 21 (src/bootstrap/.../llvm.rs panics
# below that) and 21.1.0 is the newest with a prebuilt Linux x64 tarball
# on the release page. No root, nothing installed system-wide.
LLVM_URL=https://github.com/llvm/llvm-project/releases/download/llvmorg-21.1.0/LLVM-21.1.0-Linux-X64.tar.xz
LLVM_DIR="$WORK/LLVM-21.1.0-Linux-X64"

if ! done_marker llvm; then
  say "fetching LLVM 21.1.0 (about 1 GB; the tree needs >= 21 and Ubuntu ships 18)"
  ( cd "$WORK"
    curl -fL --retry 3 -o llvm.tar.xz "$LLVM_URL" >>"$LOG" 2>&1
    tar -xJf llvm.tar.xz && rm llvm.tar.xz
    test -x "$LLVM_DIR/bin/llvm-config" )
  mark llvm
fi
say "LLVM $("$LLVM_DIR/bin/llvm-config" --version)"

# The official LLVM release is built with Clang against libc++, so
# `llvm-config --cxxflags` hands out `-stdlib=libc++`. rustc_llvm's
# build script passes those flags straight to the host C++ compiler,
# and g++ does not know that option:
#
#   c++: error: unrecognized command-line option '-stdlib=libc++'
#
# Clang++ would accept it and then need libc++ headers, which are not
# installed and need root. So the flag is filtered out instead: a
# wrapper around llvm-config that is the real one in every respect
# except that --cxxflags comes back without it. Nothing else in the
# build looks at it, and the glue compiles against libstdc++ as it
# would with any distribution LLVM.
LLVM_CFG="$WORK/llvm-config-filtered"
if ! done_marker wrapper; then
  say "writing an llvm-config wrapper that drops -stdlib=libc++"
  cat > "$LLVM_CFG" <<WRAP
#!/usr/bin/env bash
real="$LLVM_DIR/bin/llvm-config"
out="\$("\$real" "\$@")" || exit \$?
printf '%s\\n' "\${out//-stdlib=libc++/}"
WRAP
  chmod +x "$LLVM_CFG"
  "$LLVM_CFG" --version >/dev/null
  mark wrapper
fi

if ! done_marker config; then
  say "pointing bootstrap at it"
  python3 - "$LLVM_CFG" <<'PY'
import io, sys
llvm = sys.argv[1]
p = 'rust/bootstrap.toml'
import os
p = os.path.join(os.environ.get('WORK', os.path.expanduser('~/rustbuild')), 'rust', 'bootstrap.toml')
s = io.open(p, encoding='utf-8').read()
s = s.replace('download-ci-llvm = true', 'download-ci-llvm = false')
# The LLVM backend goes back in: the x86_64 host side needs it.
s = s.replace('codegen-backends = ["cranelift"]\n',
              'codegen-backends = ["llvm", "cranelift"]\n', 1)
if 'llvm-config' not in s:
    s += f'\nllvm-config = "{llvm}/bin/llvm-config"\n'
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('bootstrap.toml: external LLVM, both backends')
PY
  mark config
fi

# ------------------------------------------------------------ the build
# GITHUB_ACTIONS and CI are unset for the same reason the upstream
# workflow unsets them: bootstrap's CI path assumes the checkout tip is a
# bors merge and takes HEAD^1 as upstream, which on a fork branch is a
# commit rust-lang CI never built an LLVM for.
if ! done_marker rustc; then
  say "building rustc for wasm32 (hours; -j $JOBS to stay inside this machine's memory)"
  ( cd "$WORK/rust" && env -u GITHUB_ACTIONS -u CI python3 x.py install -j "$JOBS" ) >>"$LOG" 2>&1
  mark rustc
fi

if ! done_marker wasip1; then
  say "building the wasm32-wasip1 std sysroot"
  ( cd "$WORK/rust" && env -u GITHUB_ACTIONS -u CI \
      python3 x.py build library --target wasm32-wasip1 --stage 1 -j "$JOBS" ) >>"$LOG" 2>&1
  mark wasip1
fi

# -------------------------------------------------------------- package
say "packaging"
export RUST_DIR="$WORK/rust" OUT_DIR="$WORK/out"
mkdir -p "$OUT_DIR"
PACKAGE_SET=wasip1 bash "$WORK/wasm-rustc/scripts/package-artifacts.sh" >>"$LOG" 2>&1 || \
  say "the wasip1 packaging step reported a problem; see the log"
PACKAGE_SET=main bash "$WORK/wasm-rustc/scripts/package-artifacts.sh" >>"$LOG" 2>&1 || \
  say "the main packaging step reported a problem; see the log"

# The tarballs need zstd, which may not be installed; the files inside
# them are what this repository vendors, so they are copied directly.
found_wasm="$(find "$WORK" -name rustc.wasm -newer "$WORK/.done-patch" 2>/dev/null | head -1)"
found_bundle="$(find "$WORK" -name 'sysroot-wasip1.bundle' 2>/dev/null | head -1)"
[ -n "$found_wasm" ] && cp "$found_wasm" "$OUT/rustc.wasm" && say "rustc.wasm  -> $OUT ($(stat -c%s "$OUT/rustc.wasm") bytes)"
[ -n "$found_bundle" ] && cp "$found_bundle" "$OUT/sysroot-wasip1.bundle" && say "sysroot     -> $OUT ($(stat -c%s "$OUT/sysroot-wasip1.bundle") bytes)"

say "done. Artifacts in $OUT"
