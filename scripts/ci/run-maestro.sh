#!/usr/bin/env bash
# Installs an APK on the running emulator or phone and runs the Maestro flows
# tagged "ci" (the ones that need no accounts and no flaky sites).
# Usage: bash scripts/ci/run-maestro.sh <apk> [output folder] [tag]
# Screenshots, the JUnit report, Maestro's debug output and logcat go to the
# output folder (default maestro-output/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${2:-$ROOT/maestro-output}"
TAG="${3:-ci}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

adb wait-for-device
# Wait for the package manager as well as the boot flag.
for _ in $(seq 1 60); do
  if [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && adb shell pm path android >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# -g grants the runtime permissions, so no system prompt covers the app.
adb install -r -g "$APK"

adb logcat -c || true
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!

status=0
# takeScreenshot writes to the working folder.
(cd "$OUT" && maestro test --include-tags "$TAG" --format junit --output "$OUT/report.xml" \
  --debug-output "$OUT/debug" "$ROOT/.maestro") || status=$?

kill "$LOGCAT_PID" 2>/dev/null || true
# A crash leaves its stack trace here.
adb logcat -d -b crash > "$OUT/crash.txt" 2>&1 || true
if [ -s "$OUT/crash.txt" ]; then
  echo "Crash log:"
  cat "$OUT/crash.txt"
fi
exit "$status"
