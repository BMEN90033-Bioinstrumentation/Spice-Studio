#!/usr/bin/env bash
# Build a relocatable, self-contained ngspice into vendor/ngspice/<platform>-<arch>/.
#
#   bash scripts/build-ngspice.sh            (macOS, Linux; MSYS2 via scripts/build-ngspice-win.sh)
#
# Env:  NGSPICE_SRC        ngspice source tree (default: ./ngspice-ngspice). Never modified:
#                          it is copied into the build dir and autogen'd there.
#       NGSPICE_BUILD_DIR  scratch dir (default: vendor/.build/<platform>-<arch>)
#       JOBS               make -j (default: CPU count)
#
# Output layout (the contract the app relies on):
#   bin/ngspice[.exe]  lib/ngspice/*.cm  share/ngspice/scripts/spinit (+ other stock scripts)
#   COPYING  THIRD_PARTY_NOTICES.md
#
# Runtime: macOS/Linux need SPICE_LIB_DIR=<root>/share/ngspice (ngspice finds spinit only via
# that or a compiled-in absolute path; --enable-relpath is cwd-relative on Unix, so useless).
# spinit loads the code models from $SPICE_LIB_DIR/../../lib/ngspice. Windows needs no env:
# ngspice.exe resolves ../share/ngspice and the relative codemodel paths against its own dir.
set -euo pipefail

die() { echo "build-ngspice: $*" >&2; exit 1; }

repo=$(cd "$(dirname "$0")/.." && pwd)
src=$(cd "${NGSPICE_SRC:-$repo/ngspice-ngspice}" && pwd) || die "no ngspice source (set NGSPICE_SRC)"
[ -f "$src/configure.ac" ] || die "$src is not an ngspice source tree"

case $(uname -s) in
  Darwin) plat=darwin ;;
  Linux) plat=linux ;;
  MINGW64*) plat=win32 ;;
  *) die "unsupported host $(uname -s) (Windows: run scripts/build-ngspice-win.sh in an MSYS2 MINGW64 shell)" ;;
esac
case $(uname -m) in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "unsupported arch $(uname -m)" ;;
esac
id=$plat-$arch
out=$repo/vendor/ngspice/$id
work=${NGSPICE_BUILD_DIR:-$repo/vendor/.build/$id}
jobs=${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
exe=ngspice
[ $plat = win32 ] && exe=ngspice.exe

# ---- toolchain -------------------------------------------------------------------------
cflags="-O2"
ldflags=""
if [ $plat = darwin ]; then
  export MACOSX_DEPLOYMENT_TARGET=11.0
  cflags="$cflags -mmacosx-version-min=11.0"
  ldflags="-mmacosx-version-min=11.0"
  # Apple's bison 2.3 is too old; Homebrew's is keg-only. Build-time only: nothing from
  # Homebrew is linked (checked below).
  if command -v brew >/dev/null; then PATH="$(brew --prefix bison)/bin:$PATH"; fi
elif [ $plat = win32 ]; then
  # static libgcc/winpthread: only Windows system DLLs at runtime. libtool swallows -static for ngspice.exe
  # (-Wl,-Bstatic gets through), and gcc -shared (the .cm links) uses shared libgcc unless -static-libgcc
  ldflags="-s -static -static-libgcc -Wl,-Bstatic"
fi
for t in autoconf automake make bison flex; do command -v $t >/dev/null || die "missing build tool: $t"; done
command -v libtoolize >/dev/null || command -v glibtoolize >/dev/null || die "missing build tool: libtool"
bv=$(bison --version | sed -n '1s/.* \([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
awk -v v="$bv" 'BEGIN { split(v, a, "."); exit !(a[1] > 2 || (a[1] == 2 && a[2] >= 7)) }' ||
  die "bison $bv too old (need >= 2.7; macOS: brew install bison)"

# ---- configure flags -------------------------------------------------------------------
# Unix installs to a placeholder prefix via DESTDIR so no build path is baked into the binary;
# MinGW can't DESTDIR a drive-letter prefix, and its paths are exe-relative anyway.
if [ $plat = win32 ]; then prefix=$(cygpath -m "$work/stage"); destdir=""; inst=$work/stage
else prefix=/opt/ngspice-studio; destdir=$work/stage; inst=$work/stage$prefix; fi
flags=(
  --prefix="$prefix"
  --disable-debug
  --enable-xspice --enable-klu --enable-osdi
  --disable-openmp --without-x --without-readline --without-editline --without-fftw3
)
[ $plat = win32 ] && flags+=(--with-wingui=no)
# never pick up optional libs that happen to be installed on the build machine
cache=(ac_cv_header_sndfile_h=no ac_cv_lib_sndfile_sf_command=no
  ac_cv_header_samplerate_h=no ac_cv_lib_samplerate_src_process=no)

# ---- build -----------------------------------------------------------------------------
mkdir -p "$work/src" "$work/build"
# copy (mtimes preserved, so make stays incremental); autogen output lands in the copy only
(cd "$src" && tar --exclude=.git -cf - .) | (cd "$work/src" && tar -xpf -)
if [ ! -x "$work/src/configure" ] || [ "$work/src/configure.ac" -nt "$work/src/configure" ]; then
  echo "== autogen"
  (cd "$work/src" && ./autogen.sh) >"$work/autogen.log" 2>&1 || die "autogen failed, see $work/autogen.log"
fi

want="${flags[*]} ${cache[*]} CFLAGS=$cflags LDFLAGS=$ldflags"
if [ ! -f "$work/build/Makefile" ] || [ "$(cat "$work/build/.flags" 2>/dev/null)" != "$want" ]; then
  echo "== configure ${flags[*]} CFLAGS=\"$cflags\" LDFLAGS=\"$ldflags\""
  rm -rf "$work/build" && mkdir -p "$work/build"
  (cd "$work/build" && ../src/configure "${flags[@]}" "${cache[@]}" CFLAGS="$cflags" LDFLAGS="$ldflags") \
    >"$work/configure.log" 2>&1 || die "configure failed, see $work/configure.log"
  echo "$want" >"$work/build/.flags"
fi

echo "== make -j$jobs (log: $work/make.log)"
make -C "$work/build" -j"$jobs" >"$work/make.log" 2>&1 || { tail -30 "$work/make.log"; die "make failed"; }
rm -rf "$work/stage"
make -C "$work/build" install ${destdir:+DESTDIR="$destdir"} >"$work/install.log" 2>&1 || die "make install failed, see $work/install.log"

# ---- assemble --------------------------------------------------------------------------
echo "== assemble $out"
rm -rf "$out"
mkdir -p "$out/bin" "$out/lib/ngspice" "$out/share/ngspice"
cp "$inst/bin/$exe" "$out/bin/"
cp "$inst"/lib/ngspice/*.cm "$out/lib/ngspice/"
cp -R "$inst/share/ngspice/scripts" "$out/share/ngspice/"
if [ $plat = win32 ]; then cmdir='../lib/ngspice/'; else cmdir='$SPICE_LIB_DIR/../../lib/ngspice/'; fi
sed -E "s#^([[:space:]]*(codemodel|osdi)) .*/lib/ngspice/#\1 $cmdir#" "$inst/share/ngspice/scripts/spinit" \
  >"$out/share/ngspice/scripts/spinit"
! grep -q "$prefix" "$out/share/ngspice/scripts/spinit" || die "spinit still references $prefix"

case $plat in
  darwin)
    # /usr/bin explicitly: conda/Homebrew cctools-port strip/otool shadow Apple's on PATH
    /usr/bin/strip "$out/bin/$exe"
    /usr/bin/strip -x "$out"/lib/ngspice/*.cm
    # strip invalidates the linker's ad-hoc signature; arm64 refuses to run unsigned code
    /usr/bin/codesign --force --sign - "$out/bin/$exe" "$out"/lib/ngspice/*.cm ;;
  linux) strip --strip-unneeded "$out/bin/$exe" "$out"/lib/ngspice/*.cm ;;
esac
chmod 755 "$out/bin/$exe"
chmod 644 "$out"/lib/ngspice/*.cm

version=$(sed -n 's/^#define PACKAGE_VERSION "\(.*\)"/\1/p' "$work/build/src/include/ngspice/config.h")
rev=$(git -C "$src" rev-parse HEAD 2>/dev/null || echo unknown)
cp "$src/COPYING" "$out/COPYING"
{
  cat "$repo/scripts/ngspice-notices.md"
  printf '\n## This build\n\n- ngspice %s, source revision `%s` (https://sourceforge.net/p/ngspice/ngspice/)\n' "$version" "$rev"
  printf -- '- built by `scripts/build-ngspice.sh` for %s: `configure %s CFLAGS="%s" LDFLAGS="%s"`\n' "$id" "${flags[*]}" "$cflags" "$ldflags"
} >"$out/THIRD_PARTY_NOTICES.md"

# ---- checks ----------------------------------------------------------------------------
echo "== dependency check"
bad=0
for f in "$out/bin/$exe" "$out"/lib/ngspice/*.cm; do
  case $plat in
    darwin) deps=$(/usr/bin/otool -L "$f" | tail -n +2 | awk '{print $1}')
            foreign=$(grep -vE '^(/usr/lib/|/System/)' <<<"$deps" || true) ;;
    linux)  deps=$(ldd "$f" | awk '/=>/ {print $3; next} {print $1}')
            foreign=$(grep -vE '^(linux-vdso|/lib|/usr/lib|/lib64|/usr/lib64)' <<<"$deps" || true) ;;
    win32)  deps=$(ntldd "$f" | awk '{print $3}')
            foreign=$(grep -viE '^[a-z]:\\windows\\' <<<"$deps" || true) ;;
  esac
  echo "${f#$out/}: $(tr '\n' ' ' <<<"$deps")"
  if [ -n "$foreign" ]; then echo "  NON-SYSTEM: $foreign" >&2; bad=1; fi
done
[ $bad = 0 ] || die "binary links outside system locations"

echo "== smoke test (XSPICE gain block + KLU, from an unrelated cwd)"
tmp=$(mktemp -d)
cat >"$tmp/t.cir" <<'EOF'
smoke
v1 1 0 1
a1 1 2 amp
.model amp gain(gain=3)
r2 2 0 1k
.options klu
.op
.end
EOF
if [ $plat = win32 ]; then log=$(cd "$tmp" && "$out/bin/$exe" -b t.cir 2>&1) || true
else log=$(cd "$tmp" && SPICE_LIB_DIR="$out/share/ngspice" "$out/bin/$exe" -b t.cir 2>&1) || true; fi
rm -rf "$tmp"
grep -Eiq 'v\(2\)[[:space:]]+3\.0+e\+00' <<<"$log" && grep -q 'KLU' <<<"$log" && ! grep -qi 'error' <<<"$log" ||
  { echo "$log"; die "smoke test failed"; }

echo
echo "== ngspice $version ($id) -> $out"
(cd "$out" && find . -type f | sort | while read -r f; do printf '  %8s  %s\n' "$(du -k "$f" | cut -f1)K" "${f#./}"; done)
[ $plat = win32 ] || echo "  runtime env: SPICE_LIB_DIR=<root>/share/ngspice"
echo "OK"
