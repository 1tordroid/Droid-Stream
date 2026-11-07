#!/usr/bin/env bash
# Builds libtorrent4j.so, the native torrent engine, against a newer OpenSSL
# than the one in the published libtorrent4j release.
#
# libtorrent4j 2.1.0-39 (MIT, Maven Central) bundles OpenSSL 3.5.5. This
# builds the same release (tag v2.1.0-39, same libtorrent commit, Boost
# 1.90.0, NDK r29, API 28, the same b2 configs and flags as upstream's
# .github/workflows/android.yml) with only OpenSSL moved to 3.5.9. The JNI
# code is the one committed in the tag (SWIG is not run), so the Java API
# jar org.libtorrent4j:libtorrent4j:2.1.0-39 stays as it is.
#
# Linux x86_64 only (GitHub's ubuntu-24.04 runner, see
# .github/workflows/libtorrent4j.yml): Boost's b2 needs a host C++ compiler.
# Needs git, curl, unzip, perl, make, gcc/g++ and python3.
#
# Usage:
#   scripts/build-libtorrent4j.sh <armeabi-v7a|arm64-v8a|x86_64> [out-dir] [work-dir]
#   scripts/build-libtorrent4j.sh manifest [out-dir]
# A build writes <out-dir>/<abi>/libtorrent4j.so (stripped, like upstream)
# and checks it: OpenSSL version string, only libc/libm/libdl needed,
# 16 KB pages on 64-bit, and the same JNI functions as the published
# 2.1.0-39 library for that ABI. "manifest" writes <out-dir>/build.json with
# the pins and the SHA-256 of each library.
set -euo pipefail

LIBTORRENT4J_VERSION=2.1.0-39
LIBTORRENT4J_COMMIT=da7d2403f06a0939bc2c51a88e67a6c4a85512ef
LIBTORRENT_COMMIT=24a3adf35d3e689bde700371337aad61b160bafa
OPENSSL_VERSION=3.5.9
OPENSSL_SHA256=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
BOOST_VERSION=1.90.0
BOOST_SHA256=5e93d582aff26868d581a52ae78c7d8edf3f3064742c6e77901a1f18a437eea9
NDK_VERSION=r29
NDK_SHA256=4abbbcdc842f3d4879206e9695d52709603e52dd68d3c1fff04b3b5e7a308ecf
API=28
# The published per-ABI jars, only to compare the JNI functions.
REF_ARM_SHA256=914157778f514661aabe4d3e72451c1d3004401ce6659407ab7ce94a3f273fbc
REF_ARM64_SHA256=59aa4c32c0dc62c95e24c2e3fdf805624625a1f8214e2442fae492e381ecbbdc
REF_X86_64_SHA256=07ed97a0cbffbd8573a838e42549aa139b04d00ae2769eeef1a6a5402aba0cf3
# Same as upstream's OPENSSL_NO_OPTS.
OPENSSL_OPTS="no-deprecated no-shared no-makedepend no-static-engine no-stdio no-posix-io no-threads no-ui-console no-zlib no-zlib-dynamic -fno-strict-aliasing -fvisibility=hidden -O3"

root="$(cd "$(dirname "$0")/.." && pwd)"
abi="${1:-}"
out="${2:-$root/build/libtorrent4j}"

sha256() { sha256sum "$1" | cut -d' ' -f1; }

if [ "$abi" = manifest ]; then
  python3 - "$out" <<EOF
import hashlib, json, os, sys
out = sys.argv[1]
libs = {}
for abi in ('armeabi-v7a', 'arm64-v8a', 'x86_64'):
    path = os.path.join(out, abi, 'libtorrent4j.so')
    if os.path.exists(path):
        libs[abi + '/libtorrent4j.so'] = hashlib.sha256(open(path, 'rb').read()).hexdigest()
if not libs:
    sys.exit('No libraries in ' + out)
build = {
    'libtorrent4j': '$LIBTORRENT4J_VERSION',
    'libtorrent4jCommit': '$LIBTORRENT4J_COMMIT',
    'libtorrentCommit': '$LIBTORRENT_COMMIT',
    'openssl': '$OPENSSL_VERSION',
    'opensslSha256': '$OPENSSL_SHA256',
    'boost': '$BOOST_VERSION',
    'boostSha256': '$BOOST_SHA256',
    'ndk': '$NDK_VERSION',
    'ndkSha256': '$NDK_SHA256',
    'api': $API,
    'opensslOptions': '$OPENSSL_OPTS',
    'libraries': libs,
}
with open(os.path.join(out, 'build.json'), 'w', newline='\n') as f:
    json.dump(build, f, indent=2)
    f.write('\n')
print(json.dumps(build, indent=2))
EOF
  exit 0
fi

case "$abi" in
  armeabi-v7a)
    triple=armv7a-linux-androideabi$API; ossl_target=linux-armv4; ossl_flags="-march=armv7-a -mfpu=neon -fPIC"
    jam=android-arm-config.jam; toolset=clang-linux-arm; strip_flags="--strip-unneeded -x -g"
    ref_name=arm; ref_sha=$REF_ARM_SHA256; page=4096 ;;
  arm64-v8a)
    triple=aarch64-linux-android$API; ossl_target=linux-aarch64; ossl_flags="-march=armv8-a+crypto -fPIC"
    jam=android-arm64-config.jam; toolset=clang-arm64; strip_flags="--strip-unneeded -x"
    ref_name=arm64; ref_sha=$REF_ARM64_SHA256; page=16384 ;;
  x86_64)
    triple=x86_64-linux-android$API; ossl_target=linux-x86_64; ossl_flags="-fPIC"
    jam=android-x86_64-config.jam; toolset=clang-x86_64; strip_flags="--strip-unneeded -x"
    ref_name=x86_64; ref_sha=$REF_X86_64_SHA256; page=16384 ;;
  *) echo "Usage: $0 <armeabi-v7a|arm64-v8a|x86_64|manifest> [out-dir] [work-dir]" >&2; exit 1 ;;
esac
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo "Runs on Linux x86_64 only (b2 needs a host compiler)" >&2; exit 1; }

work="${3:-${TMPDIR:-/tmp}/droidstream-libtorrent4j}"
mkdir -p "$work" "$out/$abi"
jobs="$(nproc 2>/dev/null || echo 4)"

fetch() { # url file sha256
  if [ ! -f "$2" ] || [ "$(sha256 "$2")" != "$3" ]; then
    curl -fL --retry 3 -o "$2.part" "$1"
    mv "$2.part" "$2"
  fi
  [ "$(sha256 "$2")" = "$3" ] || { echo "SHA-256 mismatch for $2" >&2; exit 1; }
}

fetch "https://dl.google.com/android/repository/android-ndk-$NDK_VERSION-linux.zip" "$work/ndk.zip" "$NDK_SHA256"
fetch "https://archives.boost.io/release/$BOOST_VERSION/source/boost_${BOOST_VERSION//./_}.tar.gz" "$work/boost.tar.gz" "$BOOST_SHA256"
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" \
  "$work/openssl.tar.gz" "$OPENSSL_SHA256"
fetch "https://repo1.maven.org/maven2/org/libtorrent4j/libtorrent4j-android-$ref_name/$LIBTORRENT4J_VERSION/libtorrent4j-android-$ref_name-$LIBTORRENT4J_VERSION.jar" \
  "$work/ref-$abi.jar" "$ref_sha"

if [ ! -d "$work/android-ndk" ]; then
  rm -rf "$work/ndk-unpack" && mkdir "$work/ndk-unpack"
  unzip -qq "$work/ndk.zip" -d "$work/ndk-unpack"
  mv "$work/ndk-unpack/android-ndk-$NDK_VERSION" "$work/android-ndk"
fi
export ANDROID_TOOLCHAIN="$work/android-ndk/toolchains/llvm/prebuilt/linux-x86_64"

if [ ! -x "$work/boost/b2" ]; then
  rm -rf "$work/boost" "$work/boost_${BOOST_VERSION//./_}"
  tar xzf "$work/boost.tar.gz" -C "$work"
  mv "$work/boost_${BOOST_VERSION//./_}" "$work/boost"
  (cd "$work/boost" && ./bootstrap.sh)
fi
export BOOST_ROOT="$work/boost"

src="$work/libtorrent4j"
if [ ! -d "$src/.git" ]; then
  git clone -q https://github.com/aldenml/libtorrent4j.git "$src"
fi
git -C "$src" -c advice.detachedHead=false checkout -q -f "$LIBTORRENT4J_COMMIT"
git -C "$src" submodule update -q --init --recursive --force
[ "$(git -C "$src/swig/deps/libtorrent" rev-parse HEAD)" = "$LIBTORRENT_COMMIT" ] || { echo "Unexpected libtorrent commit" >&2; exit 1; }
git -C "$src" clean -qfdx swig/bin
export LIBTORRENT_ROOT="$src/swig/deps/libtorrent"

# OpenSSL, static, for this ABI.
ossl="$work/openssl-$abi"
rm -rf "$work/openssl-$OPENSSL_VERSION" "$ossl"
tar xzf "$work/openssl.tar.gz" -C "$work"
(
  cd "$work/openssl-$OPENSSL_VERSION"
  export CC="$ANDROID_TOOLCHAIN/bin/$triple-clang" AR="$ANDROID_TOOLCHAIN/bin/llvm-ar"
  export LD="$ANDROID_TOOLCHAIN/bin/ld" RANLIB="$ANDROID_TOOLCHAIN/bin/llvm-ranlib"
  # shellcheck disable=SC2086
  ./Configure "$ossl_target" $OPENSSL_OPTS $ossl_flags --prefix="$ossl"
  make -j"$jobs" > "$work/openssl-$abi.log" 2>&1
  make install_sw >> "$work/openssl-$abi.log" 2>&1
)
[ -d "$ossl/lib64" ] && [ ! -d "$ossl/lib" ] && mv "$ossl/lib64" "$ossl/lib"
grep -q "OPENSSL_VERSION_TEXT.*\"OpenSSL $OPENSSL_VERSION " "$ossl/include/openssl/opensslv.h" \
  || { echo "OpenSSL headers are not $OPENSSL_VERSION" >&2; exit 1; }
export OPENSSL_ROOT="$ossl"

# libtorrent4j with b2, as upstream.
(
  cd "$src/swig"
  export CXX="$ANDROID_TOOLCHAIN/bin/$triple-clang++" CC="$ANDROID_TOOLCHAIN/bin/$triple-clang"
  export AR="$ANDROID_TOOLCHAIN/bin/llvm-ar" LD="$ANDROID_TOOLCHAIN/bin/ld" RANLIB="$ANDROID_TOOLCHAIN/bin/llvm-ranlib"
  "$BOOST_ROOT/b2" -j"$jobs" --user-config="config/$jam" variant=release toolset="$toolset" \
    target-os=android location="bin/release/android/$abi"
)
lib="$out/$abi/libtorrent4j.so"
cp "$src/swig/bin/release/android/$abi/libtorrent4j.so" "$lib"
# shellcheck disable=SC2086
"$ANDROID_TOOLCHAIN/bin/llvm-strip" $strip_flags "$lib"

# Checks.
grep -aq "OpenSSL $OPENSSL_VERSION " "$lib" || { echo "$lib does not contain OpenSSL $OPENSSL_VERSION" >&2; exit 1; }
needed="$("$ANDROID_TOOLCHAIN/bin/llvm-readelf" -d "$lib" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' | sort | tr '\n' ' ')"
[ "$needed" = "libc.so libdl.so libm.so " ] || { echo "Unexpected libraries needed: $needed" >&2; exit 1; }
if [ "$page" = 16384 ]; then
  "$ANDROID_TOOLCHAIN/bin/llvm-readelf" -lW "$lib" | awk '$1 == "LOAD" && $NF != "0x4000" { bad = 1 } END { exit bad }' \
    || { echo "$lib is not aligned to 16 KB pages" >&2; exit 1; }
fi
rm -rf "$work/ref-$abi" && mkdir "$work/ref-$abi"
unzip -qq -o "$work/ref-$abi.jar" "lib/$abi/libtorrent4j.so" -d "$work/ref-$abi"
jni() { "$ANDROID_TOOLCHAIN/bin/llvm-nm" -D --defined-only "$1" | awk '$3 ~ /^Java_/ { print $3 }' | sort; }
if ! diff <(jni "$work/ref-$abi/lib/$abi/libtorrent4j.so") <(jni "$lib") > "$work/jni-$abi.diff"; then
  echo "JNI functions differ from libtorrent4j $LIBTORRENT4J_VERSION:" >&2
  head -40 "$work/jni-$abi.diff" >&2
  exit 1
fi
echo "$abi: $(jni "$lib" | wc -l) JNI functions, OpenSSL $OPENSSL_VERSION, sha256 $(sha256 "$lib")"
