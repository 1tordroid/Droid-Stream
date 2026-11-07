# On-device tests (Maestro)

These flows drive the real app on a phone or Android TV, using the same
accessibility labels screen readers use.

1. Install Maestro once: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
2. Connect the device (`adb devices` shows it) and install the test APK. The
   flows drive `com.tordroid.droidstream` only, so use a release-package
   build: they never touch an `APP_VARIANT=preview` install, and with one
   beside the release app they test (and write to) the release app instead.
3. Run everything: `maestro test .maestro`, or phone-only: `maestro test --include-tags phone .maestro`, TV: `--include-tags tv`.
4. The flows CI runs (tag `ci`, no accounts or torrent sites needed):
   `bash scripts/ci/run-maestro.sh <apk> maestro-output ci` installs the APK,
   runs them and keeps screenshots, the report and logcat in `maestro-output/`.

Screenshots land in the current folder. Network-dependent flows (torrent
search, Find streams) need the phone online; they wait up to 45 seconds.
