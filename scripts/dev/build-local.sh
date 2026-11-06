#!/bin/bash
# Local standalone release APK (JS bundle embedded), arm64 only, for phone testing.
# Usage from the repo root, in Git Bash:
#   bash scripts/dev/build-local.sh            # rebuild (JS or Kotlin changes)
#   bash scripts/dev/build-local.sh prebuild   # after app.config.js, plugins, or native-src changes
# Output: android/app/build/outputs/apk/release/DroidStream-v<version>.apk
# Without release secrets the APK is signed with the debug key (fine for testing,
# but it cannot update an install of the release-signed app).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
export ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
LOG="$ROOT/android-build.log"

# On Windows, a leftover Kotlin compile daemon keeps jars locked and the next
# build fails with "Unable to delete file ... classes.jar". Stop it first.
if [ -d android ]; then (cd android && ./gradlew --stop >/dev/null 2>&1); fi
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='java.exe'\" | Where-Object { \$_.CommandLine -match 'KotlinCompileDaemon' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null

if [ "${1:-}" = "prebuild" ] || [ ! -d android ]; then
  npx expo prebuild --platform android --no-install 2>&1 | tail -1
fi

cd android || exit 1
./gradlew assembleRelease -PdroidstreamArm64Only=true -PreactNativeArchitectures=arm64-v8a --console=plain > "$LOG" 2>&1
rc=$?
grep -E 'BUILD |What went wrong' -A2 "$LOG" | tail -5
ls -l app/build/outputs/apk/release/*.apk 2>/dev/null
./gradlew --stop >/dev/null 2>&1
exit $rc
