#!/bin/bash
# Local standalone release APK (JS bundle embedded), arm64 only, for phone testing.
# Usage from the repo root, in Git Bash:
#   bash scripts/dev/build-local.sh            # rebuild (JS or Kotlin changes)
#   bash scripts/dev/build-local.sh prebuild   # after app.config.js, plugins, or native-src changes
#   bash scripts/dev/build-local.sh clean      # regenerate android/ from scratch
#   APP_VARIANT=preview bash scripts/dev/build-local.sh   # installs beside the release app
# android/ is also regenerated from scratch by itself when APP_VARIANT, EXPO_TV
# or the Expo version changed since this script's last prebuild, or when
# android/ was prebuilt outside it (npm run prebuild, prebuild:tv): a prebuild
# without --clean keeps the old project's Gradle files and package.
# Output: android/app/build/outputs/apk/release/DroidStream-v<version>.apk
# Without release secrets the APK is signed with the debug key (fine for testing,
# but it cannot update an install of the release-signed app).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
export ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
LOG="$ROOT/android-build.log"
STAMP_FILE="$ROOT/android/.droidstream-prebuild"
STAMP="variant=${APP_VARIANT:-default} tv=${EXPO_TV:-0} expo=$(node -p "require('expo/package.json').version")"

# On Windows, a leftover Kotlin compile daemon keeps jars locked and the next
# build fails with "Unable to delete file ... classes.jar". Stop it first.
if [ -d android ]; then (cd android && ./gradlew --stop >/dev/null 2>&1); fi
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='java.exe'\" | Where-Object { \$_.CommandLine -match 'KotlinCompileDaemon' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null

prebuild() {
  local out rc
  # A failed or interrupted prebuild must not leave an old stamp behind.
  rm -f "$STAMP_FILE"
  out=$(EXPO_NO_GIT_STATUS=1 npx expo prebuild --platform android --no-install "$@" 2>&1)
  rc=$?
  if [ $rc -ne 0 ]; then
    printf '%s\n' "$out" | tail -20
    echo "prebuild failed (exit $rc)"
    exit $rc
  fi
  printf '%s\n' "$out" | tail -1
  echo "$STAMP" > "$STAMP_FILE"
}

# Regenerate from scratch unless this script prebuilt android/ for the current
# variant and Expo version and nothing prebuilt it since. Every prebuild
# rewrites app/build.gradle; Gradle builds never do.
needs_clean() {
  [ -d android ] || return 1
  [ "$(cat "$STAMP_FILE" 2>/dev/null)" = "$STAMP" ] || return 0
  [ -f android/app/build.gradle ] || return 0
  [ android/app/build.gradle -nt "$STAMP_FILE" ]
}

if [ "${1:-}" = "clean" ] || needs_clean; then
  prebuild --clean
elif [ "${1:-}" = "prebuild" ] || [ ! -d android ]; then
  prebuild
fi

cd android || exit 1
./gradlew assembleRelease -PdroidstreamArm64Only=true -PreactNativeArchitectures=arm64-v8a --console=plain > "$LOG" 2>&1
rc=$?
grep -E 'BUILD |What went wrong' -A2 "$LOG" | tail -5
ls -l app/build/outputs/apk/release/*.apk 2>/dev/null
./gradlew --stop >/dev/null 2>&1
exit $rc
