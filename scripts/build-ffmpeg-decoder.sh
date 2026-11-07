#!/usr/bin/env bash
# Builds libffmpegJNI.so, the native part of the Media3 FFmpeg audio decoder
# (androidx/media decoder_ffmpeg 1.8.0, Apache-2.0) used by the built-in
# player for DTS, TrueHD and other audio the device can't decode itself.
#
# libffmpegJNI.so always links FFmpeg dynamically (libavcodec.so,
# libswresample.so, libavutil.so):
# - arm64-v8a and x86_64: the FFmpeg libraries that ffmpeg-kit-https already
#   ships, so the app carries one FFmpeg there. The headers come from the
#   same FFmpeg release (8.1.3).
# - armeabi-v7a: ffmpeg-kit-https has no 32-bit ARM build, so FFmpeg 8.1.3
#   is built here as shared libraries with only the audio decoders below.
#   If ffmpeg-kit ever ships armeabi-v7a, the APK build fails on the
#   duplicate libraries; then drop this build and link ffmpeg-kit's.
#
# FFmpeg is configured without --enable-gpl, --enable-version3 and
# --enable-nonfree, so it is LGPL-2.1-or-later. The script stops if the
# generated config.h says otherwise.
#
# Runs on Linux or in Git Bash on Windows, with Android NDK 27.1.12297006.
# Usage: scripts/build-ffmpeg-decoder.sh [work-dir]
# The results go to native-src/android/jniLibs/<abi>/ and
# native-src/android/decoder_ffmpeg/build.json.
set -euo pipefail

FFMPEG_VERSION=8.1.3
FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
FFMPEGKIT_VERSION=8.1.9
FFMPEGKIT_SHA256=66d0820c661f799439dd2c317af032f93579d092c16aa7d46912a838719cccd3
NDK_VERSION=27.1.12297006
API=28
DECODERS=aac,ac3,alac,dca,eac3,flac,mlp,mp3,opus,truehd,vorbis

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-${TMPDIR:-/tmp}/droidstream-ffmpeg-decoder}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
ndk="${ANDROID_NDK_HOME:-$sdk/ndk/$NDK_VERSION}"
[ -d "$ndk" ] || { echo "Android NDK $NDK_VERSION not found (set ANDROID_HOME or ANDROID_NDK_HOME)" >&2; exit 1; }
grep -q "Pkg.Revision = $NDK_VERSION" "$ndk/source.properties" || { echo "Expected NDK $NDK_VERSION at $ndk" >&2; exit 1; }

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) host=windows-x86_64; make_cmd="$ndk/prebuilt/windows-x86_64/bin/make.exe" ;;
  Linux) host=linux-x86_64; make_cmd=make ;;
  Darwin) host=darwin-x86_64; make_cmd=make ;;
  *) echo "Unsupported host $(uname -s)" >&2; exit 1 ;;
esac
# Tools are found by name so the configure line has no local paths in it.
export PATH="$ndk/toolchains/llvm/prebuilt/$host/bin:$PATH"
mkdir -p "$work/tmp"
export TMPDIR="$work/tmp" TEMP="$work/tmp" TMP="$work/tmp"
jobs="$(nproc 2>/dev/null || echo 4)"

sha256() { sha256sum "$1" | cut -d' ' -f1; }
fetch() { # url file sha256
  if [ ! -f "$2" ] || [ "$(sha256 "$2")" != "$3" ]; then
    curl -fL --retry 3 -o "$2.part" "$1"
    mv "$2.part" "$2"
  fi
  [ "$(sha256 "$2")" = "$3" ] || { echo "SHA-256 mismatch for $2" >&2; exit 1; }
}

fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$work/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256"
fetch "https://repo1.maven.org/maven2/dev/ffmpegkit-maintained/ffmpeg-kit-https/$FFMPEGKIT_VERSION/ffmpeg-kit-https-$FFMPEGKIT_VERSION.aar" \
  "$work/ffmpeg-kit-https-$FFMPEGKIT_VERSION.aar" "$FFMPEGKIT_SHA256"
rm -rf "$work/ffmpeg-kit"
mkdir -p "$work/ffmpeg-kit"
(cd "$work/ffmpeg-kit" && unzip -q "../ffmpeg-kit-https-$FFMPEGKIT_VERSION.aar")

# The same for every ABI. Nothing here enables GPL, version 3 or non-free code.
common_flags=(
  --target-os=android --enable-cross-compile
  --nm=llvm-nm --ar=llvm-ar --ranlib=llvm-ranlib --strip=llvm-strip
  --host-cc=x86_64-linux-android$API-clang
  --enable-pic --enable-shared --disable-static
  --extra-ldflags=-Wl,-z,max-page-size=16384
  --disable-autodetect --disable-iconv --disable-debug --disable-doc --disable-programs
  --disable-everything --disable-avdevice --disable-avformat --disable-swscale --disable-avfilter
  --disable-network --disable-v4l2-m2m --disable-vulkan
  --enable-avcodec --enable-swresample --enable-avutil
  --enable-decoder=$DECODERS
)

abi_flags() {
  case "$1" in
    armeabi-v7a) echo "--arch=arm --cpu=armv7-a --cross-prefix=armv7a-linux-androideabi$API- --cc=armv7a-linux-androideabi$API-clang --extra-cflags=-mfpu=neon" ;;
    arm64-v8a) echo "--arch=aarch64 --cpu=armv8-a --cross-prefix=aarch64-linux-android$API- --cc=aarch64-linux-android$API-clang" ;;
    x86_64) echo "--arch=x86_64 --cpu=x86-64 --cross-prefix=x86_64-linux-android$API- --cc=x86_64-linux-android$API-clang --disable-x86asm" ;;
  esac
}
triple() {
  case "$1" in
    armeabi-v7a) echo "armv7a-linux-androideabi$API" ;;
    arm64-v8a) echo "aarch64-linux-android$API" ;;
    x86_64) echo "x86_64-linux-android$API" ;;
  esac
}

# 16 KB pages, and the FFmpeg libraries a file needs (besides Android's own).
check_elf() { # file "needed FFmpeg libraries, space separated"
  if llvm-readelf -W -l "$1" | awk '$1 == "LOAD" { print $NF }' | grep -qv '0x4000$'; then
    echo "LOAD segments of $1 are not 16 KB aligned" >&2; exit 1
  fi
  local needed lib
  needed=" $(llvm-readelf -d "$1" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' | tr '\n' ' ')"
  for lib in $2; do
    case "$needed" in *" $lib "*) ;; *) echo "$1 does not link $lib" >&2; exit 1 ;; esac
  done
  for lib in $needed; do
    case " $2 libc.so libdl.so libm.so liblog.so " in *" $lib "*) ;; *) echo "$1 links $lib" >&2; exit 1 ;; esac
  done
}

jni="$root/native-src/android/decoder_ffmpeg/jni/ffmpeg_jni.cc"
library_hashes=()
for abi in armeabi-v7a arm64-v8a x86_64; do
  echo "== $abi"
  src="$work/$abi/ffmpeg-$FFMPEG_VERSION"
  rm -rf "$work/$abi"
  mkdir -p "$work/$abi"
  tar -xJf "$work/ffmpeg-$FFMPEG_VERSION.tar.xz" -C "$work/$abi"
  # shellcheck disable=SC2046
  (cd "$src" && ./configure "${common_flags[@]}" $(abi_flags "$abi") > "$work/$abi/configure.log")
  grep -q '^License: LGPL version 2.1 or later$' "$work/$abi/configure.log" || { echo "FFmpeg is not LGPL-2.1+ for $abi" >&2; exit 1; }
  for flag in CONFIG_GPL CONFIG_NONFREE CONFIG_VERSION3 CONFIG_GPLV3; do
    grep -q "^#define $flag 0$" "$src/config.h" || { echo "$flag is set for $abi" >&2; exit 1; }
  done

  # Headers only: the source root also has a VERSION file, which hides the
  # C++ <version> header on case-insensitive file systems.
  include="$work/$abi/include"
  for lib in libavcodec libavutil libswresample; do
    (cd "$src" && find "$lib" -name '*.h' -exec install -D -m 644 {} "$include/{}" \;)
  done

  out="$work/$abi/out"
  mkdir -p "$out"
  if [ "$abi" = armeabi-v7a ]; then
    # Shared libraries in the build tree; nothing is installed system-wide.
    (cd "$src" && "$make_cmd" -j"$jobs" libavutil/libavutil.so libswresample/libswresample.so libavcodec/libavcodec.so > "$work/$abi/make.log")
    for lib in avutil swresample avcodec; do
      cp "$src/lib$lib/lib$lib.so" "$out/"
      llvm-strip --strip-unneeded "$out/lib$lib.so"
    done
    check_elf "$out/libavutil.so" ""
    check_elf "$out/libswresample.so" "libavutil.so"
    check_elf "$out/libavcodec.so" "libswresample.so libavutil.so"
    ffmpeg_libs="$out"
  else
    # The libraries are ffmpeg-kit's.
    ffmpeg_libs="$work/ffmpeg-kit/jni/$abi"
  fi

  "$(triple "$abi")-clang++" -shared -fPIC -O2 -std=c++11 -I"$include" -Wl,--no-undefined \
    -Wl,-z,max-page-size=16384 -Wl,-z,relro -Wl,-z,now -Wl,--build-id=sha1 -static-libstdc++ \
    -o "$out/libffmpegJNI.so" "$jni" -L"$ffmpeg_libs" -lavcodec -lswresample -lavutil -llog
  llvm-strip --strip-unneeded "$out/libffmpegJNI.so"
  check_elf "$out/libffmpegJNI.so" "libavcodec.so libswresample.so libavutil.so"

  mkdir -p "$root/native-src/android/jniLibs/$abi"
  for file in "$out"/*.so; do
    cp "$file" "$root/native-src/android/jniLibs/$abi/"
    echo "$abi/$(basename "$file"): $(wc -c < "$file") bytes"
    library_hashes+=("    \"$abi/$(basename "$file")\": \"$(sha256 "$file")\"")
  done
done

configure_line="${common_flags[*]} $(abi_flags armeabi-v7a)"
cat > "$root/native-src/android/decoder_ffmpeg/build.json" <<EOF
{
  "media3": "1.8.0",
  "ffmpeg": "$FFMPEG_VERSION",
  "ffmpegSha256": "$FFMPEG_SHA256",
  "ffmpegKit": "$FFMPEGKIT_VERSION",
  "ffmpegKitSha256": "$FFMPEGKIT_SHA256",
  "ndk": "$NDK_VERSION",
  "armeabiV7aConfigure": "$configure_line",
  "libraries": {
$(printf '%s\n' "${library_hashes[@]}" | sed '$!s/$/,/')
  }
}
EOF
echo "Done. See native-src/android/decoder_ffmpeg/build.json"
