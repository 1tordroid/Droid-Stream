# Development guide

How to build, test and release Droid Stream, and where things live in the code.

## Requirements

- Node.js 22.13 or newer, as Expo SDK 58 requires; CI uses 22.
- JDK 17 and the Android SDK for APK builds.
- Git Bash on Windows for the helper scripts in `scripts/dev`.
- An arm64 Android phone with USB debugging for device tests.

## Set up and check

```bash
npm ci
npx tsc --noEmit -p tsconfig.json
npx jest
npm run lint
```

`npm test` and `npm run prebuild` regenerate `src/lib/sandbox/generated/sandboxRuntime.generated.ts` first. Commit that file when it changes.

`__tests__/providerMetadataOverride.test.tsx` waits a fixed 25 ms and can fail on a busy machine. Run it again on its own before treating it as a real failure.

## Project rules

- Droid Stream is based on [vega-org/vega-app](https://github.com/vega-org/vega-app) (React Native, Expo, TypeScript). It must keep running every Vega provider plugin and keep the official `vega-org/vega-providers` source. Credit Vega.
- Keep the PolyForm Noncommercial `LICENSE`, `NOTICE` and every `Required Notice:` line. No ads, paid access or commercial use.
- Keep the in-app updater.
- Only use code under MIT, BSD, Apache or ISC licenses, or LGPL code that is linked dynamically. GPL projects (qBittorrent, LibreTorrent, Transmission, pikpak-plus) and closed apps (VidHub, 1DM, IDM) are a source of ideas only. Never copy their code.
- No Google Drive, OneDrive or Dropbox sources.
- Test builds are standalone release APKs with the JS bundle embedded (`assembleRelease`), never an Expo dev client build.
- The Vega home layout stays first, then Torrents, then the other sources. Tabs: Home, Search, Torrents, Library, Settings. Simple mode is the default and Advanced mode adds options. Settings search also finds Advanced options and highlights them.
- Themes are AMOLED black (the default) and Soft dark. CloudStream plugins, a Light theme and "Same as device" were dropped on purpose.
- The minimum Android version stays API 28. The libtorrent4j native library calls libc functions that are missing before Android 9.

## Build and test on a phone (Windows, Git Bash)

Local builds are much faster than waiting for CI, so use them for phone testing.

- One-time Windows setup: turn on long paths (`LongPathsEnabled` = 1 under `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`) and install CMake 3.31.6 from the SDK (`sdkmanager "cmake;3.31.6"`). React Native 0.88's codegen object paths pass the 260-character limit, and the Ninja 1.10 in the default CMake 3.22.1 cannot open them ("ninja: error: mkdir ... No such file or directory"). On Windows, `app.config.js` sets `cmakeVersion` 3.31.6 through `expo-build-properties`, for the app and every native module; its Ninja 1.12 handles long paths. Linux CI keeps CMake 3.22.1.
- Build with `bash scripts/dev/build-local.sh`. Add `prebuild` after changing `app.config.js`, `plugins/` or `native-src/`, or `clean` to regenerate `android/` from scratch. The script regenerates it by itself when `APP_VARIANT`, `EXPO_TV` or the Expo version changed since its own last prebuild, or when `android/` was prebuilt outside it (`npm run prebuild`, `npm run prebuild:tv`), because a prebuild without `--clean` keeps the old project's Gradle files and package (after an SDK update, AGP rejects them). It also stops the Kotlin compile daemon first, because on Windows it keeps jars locked and the next build fails with "Unable to delete file ... classes.jar". The first build takes about 30 minutes, later ones 2 to 4.
- The APK lands in `android/app/build/outputs/apk/release/DroidStream-v<version>.apk`. Without the release signing variables it is signed with the debug key. A debug-signed build cannot update the release-signed app.
- To test without touching the installed app or its data, build a preview: `APP_VARIANT=preview bash scripts/dev/build-local.sh`. It installs beside the release app as "Droid Stream Preview", with its own package `com.tordroid.droidstream.preview` (code namespace included, so launcher icons, "Open with" and notification taps work in it). Point the phone helpers at it with `PACKAGE=com.tordroid.droidstream.preview`, when sourcing them or on a single call. The next build without the variable regenerates `android/` for the release app. The Maestro flows drive `com.tordroid.droidstream` only, so `npm run e2e:phone` tests the release app, not the preview.
- Phone helpers: `source scripts/dev/phone.sh`, then `install_app` (installs the newest APK in the output folder), `open_app`, `tap 'content-desc="Torrents"'`, `shot name`, `dump`, `crash`, `share <url>`, `jank_reset` and `jank`. Screenshots go to `phone-shots/`, which git ignores. Every action first checks that Droid Stream is in front.
- Install to the personal profile only (`adb install -r --user 0`), never to a work profile.
- `dump` (uiautomator) returns nothing while a progress bar animates. Take a screenshot instead. Text typed with `adb shell input text` needs `%s` for spaces.
- End-to-end flows use Maestro 2.12.1 (the official release zip, with `JAVA_HOME` set to JDK 17): `maestro --device <serial> test --include-tags phone .maestro`, or `npm run e2e:phone` and `npm run e2e:tv`. The five phone flows pass.
- Free test media: Big Buck Bunny, Sintel and Elephants Dream on archive.org, and the HLS stream https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8. The Apple BipBop stream uses byte-range HLS, which the downloader does not support.

## CI

| Workflow | Runs on | Does |
| --- | --- | --- |
| `test-apk.yml` | Every push to a branch other than `main` | Type check and Jest, then a standalone arm64 APK signed with the debug key, attached to the run as an artifact |
| `action-build.yml` | Pushes to `main` | Signed TV APK and Play Store TV bundle, kept on a draft release |
| `main.yml` | Every night, 00:00 India time | Nightly build of `main`, published as a pre-release. The in-app updater ignores pre-releases. |
| `release.yml` | A `vX.Y.Z` tag | Signed universal APK (about 28 minutes), published as a normal release that the in-app updater offers to everyone |

## Releasing

1. Run `npm version X.Y.Z --no-git-tag-version`, which updates `package.json` and `package-lock.json`. Then raise `version` and `versionCode` in `app.config.js`.
2. Commit and push to `main`.
3. Tag and push the tag: `git tag vX.Y.Z && git push origin refs/tags/vX.Y.Z`.

Releases are signed with the Droid Stream key (alias `droidstream`). The keystore is kept outside the repository, with a backup; `scripts/setup-release-signing.sh` and `.ps1` create one and print the values for the GitHub secrets. The secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` are set at repository level and in the `nightly` environment.

Release certificate: CN=Tordroid, OU=Droid Stream, SHA-256 `76fb06dd1d36edb89ce3ed058c5c520bffcb36eb2667b4707b487138f650d2be`. First used for v5.3.3 (versionCode 218).

## Dependencies

- Patches in `patches/` are applied by `patch-package` on every install. Patched packages are pinned to the exact patched version in `package.json`. Re-check the patch before updating one.
- Expo SDK 58 with `react-native` 0.88, which is the TV fork `react-native-tvos`, set through `overrides`. The override spells out the version instead of `$react-native`, because npm fails to resolve that reference for an aliased package. `expo.install.exclude` keeps `npx expo install --fix` away from it.
- React Native 0.88 uses the strict TypeScript API: components such as `View`, `TextInput` and `ScrollView` are function types, so refs use `HostInstance`, `TextInputInstance` and `ScrollViewInstance` from `react-native`. List props such as `ListEmptyComponent` take `undefined`, not `null`. `StatusBar` no longer has `translucent`, `backgroundColor` or `setBackgroundColor` (edge-to-edge is always on).
- Shared helpers: `src/lib/tv/focus.ts` (`getNodeHandle`, `requestTVFocusByHandle`), `src/lib/clipboard.ts` (`expo-clipboard`; React Native's `Clipboard` is deprecated) and `src/lib/webview.ts`, which works around a typing bug in `react-native-webview` 14.0.1 (`WebView<P = undefined>` turns every prop into `never`). Restarting the app uses `reloadAppAsync` from `expo`; `expo-updates` is not used.
- `cheerio` stays on 1.0.0-rc.12. Version 1.x resolves to its Node build under React Native, which imports `undici` and `node:stream`, and provider plugins are written against the rc API.
- `react-native-markdown-display` gets markdown-it 14 through `overrides`. The markdown-it 10 it asks for has denial-of-service bugs. `__tests__/markdownDisplay.test.tsx` checks that dialogs still render.
- After an Expo update, check that `expo-modules-core` is still at the top of `node_modules` (`npm ls expo-modules-core`). `react-native-image-colors` imports it directly.
- Android Gradle Plugin 9 (from React Native 0.88) reads a bare `-keep class X` rule strictly, without X's default constructor. Library rules still depend on the old reading (Room in WorkManager 2.8, Notifee, ML Kit), and a release build then crashes at start ("Failed to create an instance of class androidx.work.impl.WorkDatabase"). `plugins/with-proguard-rules.js` sets `android.r8.strictFullModeForKeepRules=false`. AGP 10 removes that switch, so check the libraries' rules before moving to it. The other AGP 9 defaults that matter at run time were checked for 5.4.0: no library rule uses a global option, no native module uses `resValue`, and the new resource shrinker keeps every resource the app looks up by name (notification icons, launcher and splash drawables).
- To check the Android JS bundle without a full build: `npx expo export:embed --platform android --dev false --entry-file index.js --bundle-output /tmp/index.android.bundle --assets-dest /tmp/assets`.

## Code map

### Torrent search

`src/lib/torrentSearch`, with the screens in `screens/torrents/TorrentSearch` and `TorrentSources`.

- `searchAll()` queries every enabled engine in parallel, streams results through `onUpdate`, removes duplicates by info hash, and applies a per-engine timeout (`store.timeoutSeconds`).
- Built-in engines: `engines/api.ts` (apibay, YTS, Nyaa RSS, AnimeTosho, Knaben, Torrents-CSV, Internet Archive) and `engines/html.ts` (1337x, TorrentGalaxy, LimeTorrents, BitSearch, EZTV, MagnetDL, Kickass, TorLock, parsed with cheerio). Mirrors can be edited in the app because these domains move.
- `engines/torznab.ts` talks to Jackett and Prowlarr. `engines/custom.ts` runs user adapters (automatic magnet finder, CSS selectors, JSON paths, RSS) with JSON import and export, plus `ADAPTER_CATALOG` of extra sites that stay off until added.
- Check HTML selectors on a phone with Sites → Test all, and fix selectors or mirrors there.

### Torrent client

libtorrent4j 2.1.0-39 runs the torrents. Files stream from a local NanoHTTPD server at `http://127.0.0.1:{port}/stream/{infoHash}/{fileIndex}/{name}`. Seeding is off by default, and schedule, Wi-Fi, VPN and RSS rules apply from app start.

### Debrid and cloud

`src/lib/debrid`, with settings in `screens/torrents/DebridSettings`.

- TorBox, Real-Debrid, AllDebrid, Premiumize, Offcloud, Debrid-Link and PikPak share one `DebridService` interface. Cache badges show where the service's API allows it (TorBox, Premiumize, Offcloud, Debrid-Link; Real-Debrid retired instant availability). Keys are stored in encrypted MMKV.
- Stream plays the direct HTTPS link. Download goes through the multi-connection downloader (`queueLink`).

### Streams, add-ons and watch sync

- `src/lib/stremio` is the Stremio add-on client, with Cinemeta. `src/lib/streams/finder.ts` ranks add-on streams, site torrents and debrid caches. `play.ts` plays one (debrid first, then on the phone), picks the episode out of a season pack, and prepares the next episode.
- `src/lib/releaseName.ts` parses release names. `src/lib/aniskip.ts` maps MAL ids from Jikan to AniSkip times. `src/lib/watchSync` (Trakt device code, Simkl PIN, AniList token) marks titles watched from the player. `src/lib/subtitles/hashMatch.ts` matches OpenSubtitles by file hash over HTTP ranges.
- The player takes an optional `meta` parameter (`lib/watchMeta.ts`) and guesses it otherwise. Player helpers and components live in `screens/home/player/`.

### Network sources, links and downloads

- SMB (smbj), WebDAV, Jellyfin, Emby and Plex, with credentials in an encrypted MMKV store.
- `lib/linkIntake.ts` takes magnets and links shared or opened from other apps, and offers a copied magnet. RSS feeds are polled every 15 minutes.
- Downloaded files can be checked against an MD5, SHA-1 or SHA-256 hash.

## Status

5.4.0 (Expo SDK 58) on a OnePlus 12 (Android 16), as a preview build beside the release app, with no crash or JavaScript error throughout: first launch, the tips and Get started (starter providers through the WebView sandbox), all five tabs, the launcher icon colors, "Open videos from other apps", a shared HLS link downloaded to the end with its notification, playback of a stream opened from another app, and Erase all local data restarting the app. Its resources match 5.3.4 except for the removed blur package and the newer Material and ConstraintLayout libraries, and the arm64 APK is 2.8 MB smaller than the arm64 parts of 5.3.4 (the code alone is 23% smaller). Changing the launcher icon closes the app, as in Vega. Not tested on 5.4.0: tapping a notification with the app in the background (the launch activity was checked in the APK instead), and SMB with a real server.

Tested on a OnePlus 15 for 5.3.3: magnet and Internet Archive playback (Archive files stream directly over HTTPS), first launch, Top 10 rows, the Info page Play button, Available providers pinned in the Home menu, Search poster suggestions, poster matches, shared links (also while the app is open), the stream quality picker, HLS download and playback of the merged file, queue reordering, Nuvio-format plugins, Library back navigation, the empty state of Cloud files, themes, Credits, the Inter font everywhere, and transfer rules from app start.

Known issues:

- 1337x and EZTV are blocked by Cloudflare. Vixsrc answers HTTP 403. TorrentGalaxy and MagnetDL stay off by default because no mirror works.
- A FORTIFY mutex abort shows in logcat when a reinstall kills the app process. It has not been seen during use.

Not tested yet: Cloud files with real PikPak or debrid accounts, debrid and watch sync sign-in, the "Because you watched" row, and Android TV.

## Roadmap

- Android TV focus pass on the newer screens, and the TV Maestro flow.
- `react-native-bootsplash` 7. It removes the build-time `sharp`, `fast-xml-parser` and `uuid` advisories, but it generates the splash at prebuild with new options (`logo`, `assetsOutput`, no `parentTheme`), so `plugins/with-dynamic-launcher-splash.js` has to move to the v7 resources and themes first.
- `react-native-mmkv-storage` 13. It wraps Android encryption keys in the Keystore ("migrated automatically"), `initialize()` throws instead of failing silently, and `useMMKVStorage` returns stored falsy values. Test the encrypted debrid and network stores on an upgraded install before taking it.
- Point `extra.eas.projectId` in `app.config.js` at a Droid Stream Expo project. It still names the upstream project.
- A yt-dlp based downloader, written from scratch (nothing from the GPL YTDLnis or youtubedl-android).
- A download engine on the level of IDM: dynamic segment splitting, queues and a scheduler.
- Port fixes from vega-org/vega-app when needed, keeping the Droid Stream branding, the Vega credit and the license notices.
