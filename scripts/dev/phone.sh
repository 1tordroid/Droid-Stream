#!/bin/bash
# Phone test helpers for adb. Source it, then call the functions:
#   source scripts/dev/phone.sh
#   install_app                  # installs the local build to the personal profile only
#   open_app; tap 'content-desc="Torrents"'; shot home; crash
# Set DEVICE to a serial when more than one phone is connected (adb devices -l).
# Set PACKAGE=com.tordroid.droidstream.preview for APP_VARIANT=preview builds,
# when sourcing or on a single call (PACKAGE=... open_app).
# Every action first checks that Droid Stream is in front, so a script never
# taps inside another app if someone else is using the phone.
S="${DEVICE:-$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')}"
PKG_AT_SOURCE="${PACKAGE:-com.tordroid.droidstream}"
pkg() { printf '%s' "${PACKAGE:-$PKG_AT_SOURCE}"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/phone-shots"
mkdir -p "$OUT"
export MSYS_NO_PATHCONV=1

w() { ping -n $(( $1 + 1 )) 127.0.0.1 >/dev/null; }
# Live displays only (the full dump can hold an old ANR snapshot), the personal
# profile only, and the package up to its "/" so the preview
# (com.tordroid.droidstream.preview) never passes for the release app.
front() { adb -s "$S" shell dumpsys window displays | grep -F 'mFocusedApp=' | grep -qF " u0 $(pkg)/" || { echo "NOT IN FRONT"; return 1; }; }
open_app() { adb -s "$S" shell monkey -p "$(pkg)" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; w 8; front; }
# Never install to the work profile (user 10) unless the owner says so.
# Newest APK first: older builds keep their versioned files in the same folder.
# adb.exe needs a Windows path: MSYS_NO_PATHCONV stops Git Bash from converting /c/... for it.
install_app() {
  local apk; apk="$(ls -t "$ROOT"/android/app/build/outputs/apk/release/*.apk | head -1)"
  if command -v cygpath >/dev/null 2>&1; then apk="$(cygpath -w "$apk")"; fi
  adb -s "$S" install -r --user 0 "$apk"
}
shot() { adb -s "$S" exec-out screencap -p > "$OUT/$1.png"; echo "$OUT/$1.png"; }
# Text and content descriptions on screen with their bounds. Empty while progress bars animate.
dump() {
  adb -s "$S" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb -s "$S" exec-out cat /sdcard/ui.xml | grep -oE '(text|content-desc)="[^"]+"[^>]*bounds="[^"]+"' | sed -E 's/ (resource-id|class|package|checkable|checked|clickable|enabled|focusable|focused|scrollable|long-clickable|password|selected|visible-to-user|important|hint|index|content-desc|text)="[^"]*"//g'
}
tap() {
  front || return 9
  local c; c=$(dump | grep -F "$1" | head -1 | grep -oE '[0-9]+' | tail -4 | tr '\n' ' ')
  [ -n "$c" ] || { echo "NOT FOUND: $1"; return 1; }
  set -- $c
  front && adb -s "$S" shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 ))
}
swipe() { front || return 9; adb -s "$S" shell input swipe "$@"; }
key() { front || return 9; adb -s "$S" shell input keyevent "$@"; }
crash() { adb -s "$S" logcat -d -b crash | tail -"${1:-5}"; adb -s "$S" shell pidof "$(pkg)"; }
# Share a link into the app the way another app would.
share() { adb -s "$S" shell am start --user 0 -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "$1" -p "$(pkg)" >/dev/null; }
# Frame-time summary since the last reset: jank percentage and percentiles.
jank_reset() { adb -s "$S" shell dumpsys gfxinfo "$(pkg)" reset >/dev/null; }
jank() { adb -s "$S" shell dumpsys gfxinfo "$(pkg)" | grep -E 'Total frames rendered|Janky frames:|90th percentile|99th percentile' | sed 's/^ *//' | tr '\n' ';'; echo; }
