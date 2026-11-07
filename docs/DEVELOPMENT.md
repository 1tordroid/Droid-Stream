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

Optional build secrets, read by `app.config.js` into `extra` and passed by all four workflows. Set them at repository level and in the `nightly` environment. Locally, export them before `build-local.sh`. A build without them still works: the app asks for the user's own keys instead.

| Secret | Purpose |
| --- | --- |
| `TMDB_API_KEY` | Bundled TMDB key. Users can set their own in Settings. |
| `PROXY_API_URL` | Metadata proxy URL. |
| `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` | Built-in Trakt app, so Watch sync signs in with a code or QR code alone. Create it at https://trakt.tv/oauth/applications/new with redirect URI `urn:ietf:wg:oauth:2.0:oob`. Both must be set, or neither is used. The secret ships inside the APK, as with any device-flow client. |
| `SIMKL_CLIENT_ID` | Built-in Simkl app for the PIN sign-in (https://simkl.com/settings/developer/new/). |

Users can still pick "Use my own app" in Watch sync. A sign-in keeps the app that issued it (`authApp`), so token renewal always uses the matching Client ID.

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

### eD2k downloads

Off by default (Settings > Preferences > Downloads > eD2k downloads). Written from the public eDonkey/eMule protocol descriptions; no aMule, eMule or Kelpie code was used.

- `src/lib/ed2k`: `link.ts` parses `ed2k://` file, server and serverlist links, `settings.ts` keeps the switch and the server list (MMKV), `native.ts` wraps `Ed2kModule`, `intake.ts` handles shared, opened and copied links. `downloadBackends/ed2kBackend.ts` puts eD2k files in the normal downloads list; the screen is `screens/settings/Ed2k.tsx` (paste a link, search, servers).
- `native-src/android/com/vega/Ed2kProtocol.kt` is the wire format (packets, tags, messages), the part map and MD4 hashing (Bouncy Castle `MD4Digest`), with no Android code. `Ed2kTransfer.kt` is the engine: one shared server connection, a coordinator thread per download and a thread per peer (up to 8). `Ed2kModule.kt` connects it to React Native.
- Parts are 9,728,000 bytes, fetched in 180 KiB blocks, three requested at a time, plain or zlib-compressed. Each part is checked against its MD4 hash from the hashset (from the link's `p=` or the first peer) and a bad part is fetched again; the hashset is checked against the file hash first. The partial file has a part map next to it (`<file>.part.ed2k`), so pause, a crash or a restart continue from the finished blocks.
- Upload queues: a peer answers with its queue position ("Waiting in queue (n)" in the list). The client asks again after 29 minutes, or at once when the peer asks for a callback through the server.
- No uploading or sharing. The client offers the server an empty file list, never listens for connections (so servers give it a low ID and low-ID peers are skipped), and answers peers' file, upload and shared-list requests with "not found" or "denied". Nothing runs unless a download or search is active; the server connection closes a minute after the last one. The torrent Wi-Fi only setting applies (it also allows Ethernet).
- Not done: obfuscated connections, Kad, AICH recovery, source exchange, UDP reasks.

### Debrid and cloud

`src/lib/debrid`, with settings in `screens/torrents/DebridSettings`.

- TorBox, Real-Debrid, AllDebrid, Premiumize, Offcloud, Debrid-Link and PikPak share one `DebridService` interface. Cache badges show where the service's API allows it (TorBox, Premiumize, Offcloud, Debrid-Link; Real-Debrid retired instant availability). Keys are stored in encrypted MMKV.
- Stream plays the direct HTTPS link. Download goes through the multi-connection downloader (`queueLink`).

### Streams, add-ons and watch sync

- `src/lib/stremio` is the Stremio add-on client, with Cinemeta. `src/lib/streams/finder.ts` ranks add-on streams, site torrents and debrid caches. `play.ts` plays one (debrid first, then on the phone), picks the episode out of a season pack, and prepares the next episode.
- `src/lib/releaseName.ts` parses release names. `src/lib/aniskip.ts` maps MAL ids from Jikan to AniSkip times. `src/lib/watchSync` (Trakt device code, Simkl PIN, AniList token) marks titles watched from the player. `devicePoll.ts` polls a device code (400 pending, 429 adds 5 s, 404/409/410/418 stop, three network failures in a row tolerated) and Settings shows the code with a QR code (`lib/qr/encode.ts`, byte mode, level M, versions 1 to 10, drawn by `components/QrCode.tsx`). `scrobble.ts` sends Trakt `/scrobble/start`, `pause` and `stop` through `hooks/useScrobble.ts` in the player; a stop at 80% or more records the watch, so the history POST is skipped while a scrobble session owns the title. Failed stops queue in MMKV (`scrobble:queue` in the watch-sync store, newest per title, 50 at most, 30 days) and are sent on app start, resume and the next playback; 420 and 429 back off (Retry-After, else 1 min or 1 h doubling to 6 h). `src/lib/subtitles/hashMatch.ts` matches OpenSubtitles by file hash over HTTP ranges.
- The player takes an optional `meta` parameter (`lib/watchMeta.ts`) and guesses it otherwise. Player helpers and components live in `screens/home/player/`.

### Network sources, links and downloads

- SMB (smbj), WebDAV, Jellyfin, Emby and Plex, with credentials in an encrypted MMKV store.
- `native-src/android/com/vega/SmbStreamServer.kt` serves SMB files to the player on `127.0.0.1` with Range support: one random 128-bit token per opened file, no listing route, tokens expire 30 minutes after the last read. `lib/sources/smb.ts` (`openSmbStream`, `SMB_STREAMING.enabled`) gates it; it is off until device seek tests pass, so SMB is browse-only.

### Network library (netlib)

- `src/lib/netlib/` turns WebDAV and SMB sources and device folders into poster libraries. `scan/` lists folders (`walk.ts`: 8 levels, 5000 videos), `parsePath.ts` reads a title from the file name and the folders above it (season folders, show folders, film folders, id tags such as `{tmdb-603}`, extras), and `group.ts` makes movies (versions, cd1/cd2 parts), shows (episodes) and Other.
- `match/` matches titles: an id tag, then TMDB `/search/movie` or `/search/tv` with the year when a TMDB key is saved, else Cinemeta (`findImdb`). Four requests at once with backoff on 429 (`match/index.ts`), scored by `match/score.ts`. `cache.ts` keeps hits 180 days and misses 7 days.
- Everything is in the unencrypted MMKV instance `netlib`: libraries, per-source settings (library folder, online lookups, Other tab), device folders, matches and library history. Erase all clears it; Android Auto Backup skips it (`plugins/with-backup-rules.js`), and it is not in the settings backup or watch sync.
- A file's player link is a version key (`ids.ts`, `netlib:v:<source>:<path>`, no sign-in in it). `resolve.ts` turns it into a stream: WebDAV with Basic auth headers, SMB through the stream server, device files as they are. `useStream` resolves it too, so the next episode plays from the same source.
- Screens: `screens/library/SourceLibrary.tsx` (Movies, Shows, Other, Folders; A-Z, Recently added, Year; search; settings sheet; FlashList with the first-focus guard), `components/netlib/FixMatch.tsx` (the metadata picker), `components/netlib/NetlibEpisodeList.tsx` (Info body). `LocalLibrary.tsx` is the device source. Info links are `netlib:i:<item id>` with provider `netlib`.
- Continue Watching: the player writes `history.ts` (not the synced store); `continueWatching.ts` builds the rows and the resume point, counting 85% as watched.
- `lib/linkIntake.ts` takes magnets and links shared or opened from other apps, and offers a copied magnet. RSS feeds are polled every 15 minutes.
- Downloaded files can be checked against an MD5, SHA-1 or SHA-256 hash.

### Video downloader (yt-dlp)

Written for Droid Stream; nothing comes from the GPL YTDLnis or youtubedl-android.

- yt-dlp (Unlicense) runs unchanged in CPython 3.11, built in by Chaquopy 17.2 (MIT) through `plugins/with-ytdlp.js`. Python 3.11 is the newest Chaquopy builds for armeabi-v7a; yt-dlp needs 3.11 or newer today. When yt-dlp drops 3.11, move to a newer Python and limit the downloader to arm64. No Python is needed on the build machine (`pyc.src = false`).
- The plugin downloads the pinned yt-dlp release (version and SHA-256 at the top of the plugin) into `assets/ytdlp/yt-dlp.zip` at prebuild. `YtdlRuntime.kt` extracts it to `files/ytdlp/bundled/<version>`. "Update yt-dlp" fetches the newest release from github.com/yt-dlp/yt-dlp, checks it against the release's `SHA2-256SUMS`, refuses one that needs a newer Python, and keeps it in `files/ytdlp/releases/<version>`. The newer of the two is loaded; an update that fails to load falls back to the bundled one.
- `native-src/android/python/droidstream_ytdl.py` is the bridge. yt-dlp's ffmpeg and ffprobe point at placeholder files in `files/ytdlp/bin`; the bridge hands those commands to FFmpegKit (the app's ffmpeg-kit-https) instead of starting a process, so merging, audio conversion, embedding, SponsorBlock cuts and `--download-sections` all work. YouTube's challenge solver (yt-dlp-ejs, bundled with yt-dlp) runs in Jetpack's JavaScript sandbox (`YtdlJsSandbox.kt`, the WebView's V8 in an isolated process). Python's OpenSSL gets Android's certificate store as a PEM file.
- Downloads are a fourth download backend (`sourceType: 'ytdlp'`, `src/lib/downloadBackends/ytdlpBackend.ts`) in the normal queue: foreground service, notifications, concurrency, pause (stops yt-dlp, which continues its partial files on resume), retry, and saving to the download location. Options are yt-dlp command-line arguments built in `src/lib/ytdl/args.ts` and stored on the record. A record can wait for a start time or Wi-Fi (`src/lib/ytdl/schedule.ts`, checked by `getQueuedDownloads`).
- Screens: `screens/ytdl/YtdlDownload.tsx` (the Download sheet: shared links that are web pages open it, and Downloads has "Download from link"), `YtdlSettings.tsx` (version, update, defaults, folder, cookies, templates) and `YtdlCookies.tsx` (sign-in browser; its cookies go to `files/ytdlp/cookies.txt`).
- Cover art in Opus and "Original" audio needs mutagen (GPL), which the app does not ship, so the sheet turns it off there.

### Browser

Written for Droid Stream; ideas from 1DM, PikPak, SnapTube and Titanium Browser, none of their code.

- `src/screens/browser` is the UI (tabs, new-tab page, menus, Media on this page, settings, passwords). Root routes `Browser` ({url?, private?}), `BrowserSettings` and `BrowserPasswords`; none of them opens in a kids profile.
- The page engine sits behind `src/lib/browser/engine.ts` (`BrowserEngine`: tab view and handle, request hook, blocking, cookies, site data, user agents, passkeys, events). This build uses `engines/webview.ts` (react-native-webview plus `BrowserModule.kt`). A GeckoView engine for the extension build implements the same interface; tabs, media detection, the ad blocker, userscripts, passwords and layouts stay as they are.
- `BrowserModule.kt` wraps react-native-webview's `WebViewClient` in `BrowserWebClient.kt` for `shouldInterceptRequest` (the library has no request hook), replaces its download listener so page downloads reach the app's downloader, sets autofill and passkeys (`WebSettingsCompat.setWebAuthenticationSupport`, FOR_BROWSER), flushes cookies on pause, and asks for the screen lock.
- `inject.ts` is the page script: media in the DOM and in fetch/XHR, the download button on videos, element hiding, sign-in detection and filling, find in page, dark pages, the desktop viewport and the GM functions. Calls that matter (sign-ins, GM requests, filling) carry a per-tab token kept in the script's closure.
- `filters/` parses Adblock Plus filters (`parse.ts`), matches them (`engine.ts`, mirrored by `BrowserFilters.kt` on the same compiled lines) and handles element hiding (`cosmetic.ts`). `lists.ts` downloads EasyList, EasyPrivacy and IndianList on first use and every week (never bundled) and compiles them under `files/browser/filters`.
- `userscripts/`: metadata and @match (`meta.ts`), installed scripts and GM values (`store.ts`), GM_xmlhttpRequest behind the provider URL guard (`gm.ts`).
- `passwords.ts`: saved sign-ins per profile in the encrypted `droid-stream-passwords` store (out of backups). `store.ts`: settings (shared), and history, bookmarks, tabs, shortcuts and site layouts per profile. `privacy.ts`: private tabs clear the cookies and site data of the hosts they visited, since WebView has one cookie store.
- `handoff.ts`: downloads with the page's cookies, Referer and user agent, HLS quality choice, DASH through yt-dlp, the yt-dlp sheet (cookies written to its cookie file, not from private tabs), Torrents, the player, cast, and the `SocialDownload` route when the build has it.
- File links from other browsers: the `.LinkDownloader` alias (`plugins/with-browser.js`) takes VIEW intents for http(s) files; `TorrentClientModule.consumeLaunchIntent` passes their Cookie, Referer and User-Agent extras to `linkIntake.ts`.

### Live TV

- `src/screens/livetv/LiveTV.tsx` is the screen (Home drawer, Home welcome screen and the Library hub open it). Sources: the iptv-org India playlist, the user's own jiotv_go server (`<address>/playlist.m3u`, optional `?q=`; the app never talks to Jio itself) and any M3U URL.
- `src/lib/livetv/m3u.ts` is a pure M3U parser (`#EXTINF` attributes, `#EXTVLCOPT` user agent and referrer as headers, `#KODIPROP` skipped). `store.ts` keeps playlists, the server address, the playlist cache (12 hours), favourites and recent channels in MMKV. `epg.ts` reads now and next from plain XMLTV guides; gzipped guides (jiotv_go's `epg.xml.gz`) are skipped.
- Channels open in the built-in player with `live: true`, which stops it saving watch progress.

## Status

5.4.0 (Expo SDK 58) on a OnePlus 12 (Android 16), as a preview build beside the release app, with no crash or JavaScript error throughout: first launch, the tips and Get started (starter providers through the WebView sandbox), all five tabs, the launcher icon colors, "Open videos from other apps", a shared HLS link downloaded to the end with its notification, playback of a stream opened from another app, and Erase all local data restarting the app. Its resources match 5.3.4 except for the removed blur package and the newer Material and ConstraintLayout libraries, and the arm64 APK is 2.8 MB smaller than the arm64 parts of 5.3.4 (the code alone is 23% smaller). Changing the launcher icon closes the app, as in Vega. Not tested on 5.4.0: tapping a notification with the app in the background (the launch activity was checked in the APK instead), and SMB with a real server.

Tested on a OnePlus 15 for 5.3.3: magnet and Internet Archive playback (Archive files stream directly over HTTPS), first launch, Top 10 rows, the Info page Play button, Available providers pinned in the Home menu, Search poster suggestions, poster matches, shared links (also while the app is open), the stream quality picker, HLS download and playback of the merged file, queue reordering, Nuvio-format plugins, Library back navigation, the empty state of Cloud files, themes, Credits, the Inter font everywhere, and transfer rules from app start.

Known issues:

- 1337x and EZTV are blocked by Cloudflare. Vixsrc answers HTTP 403. TorrentGalaxy and MagnetDL stay off by default because no mirror works.
- A FORTIFY mutex abort shows in logcat when a reinstall kills the app process. It has not been seen during use.

Not tested yet: Cloud files with real PikPak or debrid accounts, debrid and watch sync sign-in, the "Because you watched" row, and Android TV.

5.5.0 network library, not yet tested on a device: scanning a real WebDAV server, SMB share and device folder; poster matching with and without a TMDB key; Fix match; resume and next episode from Continue Watching; the TV D-pad pass through the library grid. SMB playback (smbj 0.15.0 and `SmbStreamServer`) is built but switched off until a 4 GB MKV plays and seeks at 10%, 50% and 90% from Windows and Samba shares on the OnePlus 12 and an Android TV.

## Roadmap

- Android TV focus pass on the newer screens, and the TV Maestro flow.
- `react-native-mmkv-storage` 13. It wraps Android encryption keys in the Keystore ("migrated automatically"), `initialize()` throws instead of failing silently, and `useMMKVStorage` returns stored falsy values. Test the encrypted debrid and network stores on an upgraded install before taking it.
- Point `extra.eas.projectId` in `app.config.js` at a Droid Stream Expo project. It still names the upstream project.
- Phone tests of the yt-dlp downloader (YouTube with and without cookies, Instagram, X, a playlist, a cut, SponsorBlock, an update).
- A download engine on the level of IDM: dynamic segment splitting, queues and a scheduler.
- Port fixes from vega-org/vega-app when needed, keeping the Droid Stream branding, the Vega credit and the license notices.
