# Development guide

How to build, test and release Droid Stream, and where things live in the code.

## Requirements

- Node.js 22. Expo's tooling needs 20.19.4 or newer; CI uses 22.
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

- Build with `bash scripts/dev/build-local.sh`. Add `prebuild` after changing `app.config.js`, `plugins/` or `native-src/`. The script stops the Kotlin compile daemon first, because on Windows it keeps jars locked and the next build fails with "Unable to delete file ... classes.jar". The first build takes about 30 minutes, later ones 2 to 4.
- The APK lands in `android/app/build/outputs/apk/release/DroidStream-v<version>.apk`. Without the release signing variables it is signed with the debug key. A debug-signed build cannot update the release-signed app, so uninstall first (this clears app data).
- Phone helpers: `source scripts/dev/phone.sh`, then `install_app`, `open_app`, `tap 'content-desc="Torrents"'`, `shot name`, `dump`, `crash`, `share <url>`, `jank_reset` and `jank`. Screenshots go to `phone-shots/`, which git ignores. Every action first checks that Droid Stream is in front.
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
- `react-native` is the TV fork `react-native-tvos`, set through `overrides`. The override spells out the version instead of `$react-native`, because npm fails to resolve that reference for an aliased package.
- `cheerio` stays on 1.0.0-rc.12. Version 1.x resolves to its Node build under React Native, which imports `undici` and `node:stream`, and provider plugins are written against the rc API.
- `react-native-markdown-display` gets markdown-it 14 through `overrides`. The markdown-it 10 it asks for has denial-of-service bugs. `__tests__/markdownDisplay.test.tsx` checks that dialogs still render.
- After an Expo update, check that `expo-modules-core` is still at the top of `node_modules` (`npm ls expo-modules-core`). `react-native-image-colors` imports it directly.
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

Tested on a OnePlus 15 for 5.3.3: magnet and Internet Archive playback (Archive files stream directly over HTTPS), first launch, Top 10 rows, the Info page Play button, Available providers pinned in the Home menu, Search poster suggestions, poster matches, shared links (also while the app is open), the stream quality picker, HLS download and playback of the merged file, queue reordering, Nuvio-format plugins, Library back navigation, the empty state of Cloud files, themes, Credits, the Inter font everywhere, and transfer rules from app start.

Known issues:

- 1337x and EZTV are blocked by Cloudflare. Vixsrc answers HTTP 403. TorrentGalaxy and MagnetDL stay off by default because no mirror works.
- A FORTIFY mutex abort shows in logcat when a reinstall kills the app process. It has not been seen during use.

Not tested yet: Cloud files with real PikPak or debrid accounts, debrid and watch sync sign-in, the "Because you watched" row, and Android TV.

## Roadmap

- Android TV focus pass on the newer screens, and the TV Maestro flow.
- Expo SDK 58 and React Native 0.88.
- Point `extra.eas.projectId` in `app.config.js` at a Droid Stream Expo project. It still names the upstream project.
- A yt-dlp based downloader, written from scratch (nothing from the GPL YTDLnis or youtubedl-android).
- A download engine on the level of IDM: dynamic segment splitting, queues and a scheduler.
- Port fixes from vega-org/vega-app when needed, keeping the Droid Stream branding, the Vega credit and the license notices.
