# Droid Stream – Handoff (2026-11-05)

Continue this project in any AI coding tool (Claude Code, Gemini/Antigravity, Cursor).
Repo: https://github.com/1tordroid/Droid-Stream (standalone, not a fork) · Developer: Tordroid · https://tordroid.com · Support: https://t.me/Tordroid_admin

## Status (2026-11-06, local PC session)
Local builds work: expo prebuild --platform android --no-install, then gradlew assembleRelease as below. On Windows, stop KotlinCompileDaemon first or jars stay locked. Install with adb install -r --user 0 only; do not install to the work profile unless the owner says so. The APK is named DroidStream-v5.3.2.apk.

Confirmed on OnePlus 15: magnet and Internet Archive playback (Archive streams directly), first launch Get started, Top 10 rows, Info Play button, Available providers in the Home menu, Search posters, poster matches, shared links (also while the app runs), stream quality picker, HLS download and playback of the merged file, queue reorder, Nuvio-format plugins (StreamFlix returned streams), Library back navigation, themes, Credits, Inter font everywhere. All five Maestro phone flows pass (Maestro 2.12.1, maestro --device <serial> test --include-tags phone .maestro).

Known: 1337x and EZTV are blocked by Cloudflare (no bypass). Vixsrc answers HTTP 403. The Apple BipBop test stream uses byte-range HLS, which the downloader does not support. A FORTIFY mutex abort shows in logcat when the app process is killed by a reinstall; not seen during use.

Still to do: Android TV focus pass and TV flow, smoother transitions and loading placeholders, PikPak files listed in Library (needs an account to test), release signing (owner sets the password), extra.eas.projectId (needs the owner's Expo account), PR merge order (confirm with owner). yt-dlp downloader: confirm with the owner before building. Dropped: Light theme, Same as device, CloudStream plugins.

## Start here (local PC session, 2026-11-05)
The owner is continuing on their Windows PC with a OnePlus 15 on USB (the OnePlus 12 is busy in another session). Do these in order:
1. `git fetch origin claude/torrent-search-engine && git checkout claude/torrent-search-engine && git pull`
2. `npm ci`, then `npx tsc --noEmit -p tsconfig.json` and `npx jest` (all suites passed in the cloud: 172 suites / 1173 tests).
3. Build the standalone test APK: `npx expo prebuild --platform android --clean --no-install`, then in `android/`: `gradlew assembleRelease -PdroidstreamArm64Only=true -PreactNativeArchitectures=arm64-v8a`. Release builds without signing secrets are signed with the debug key (plugins/with-android-signing.js fallback was fixed); R8 rules for smbj are in plugins/with-proguard-rules.js.
4. `adb devices` → pick the OP 15 serial → `adb -s <serial> install -r android/app/build/outputs/apk/release/app-release.apk`.
5. On the device: Torrents → Sites → Test all (built-in HTML selectors and mirrors were never verified live; the cloud network blocked those hosts). Fix selectors or mirrors in src/lib/torrentSearch/engines/html.ts for sites that fail. Then try Find streams, Stremio add-ons (Torrentio), Debrid screens, Settings → Languages, and Watch sync.
6. Maestro: install it, then `maestro --device <serial> test .maestro` (or `npm run e2e:phone`). Adjust flows if labels differ on device.
7. Release signing: run `powershell -ExecutionPolicy Bypass -File scripts\setup-release-signing.ps1` WITH the owner (they choose and keep the password). It creates %USERPROFILE%\droid-stream-release.keystore and sets KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD at repo level and in the "nightly" environment via gh. Remind them to back up the keystore and password. The cloud session could not do this: its proxy blocks the Actions secrets API.
8. Commit fixes to claude/torrent-search-engine and push. CI (.github/workflows/test-apk.yml) also builds an arm64 test APK artifact on every push.

## Hard rules
- Based on vega-org/vega-app (React Native + Expo, TypeScript). Must stay compatible with ALL Vega plugins/providers and keep the connection to the official Vega providers repo; credit Vega.
- Keep PolyForm Noncommercial LICENSE, NOTICE and every "Required Notice:" line. No ads, no paid access, no commercial use.
- Keep the in-app updater.
- Only MIT/BSD/Apache/ISC or dynamically linked LGPL code. GPL projects (qBittorrent, LibreTorrent, Transmission, pikpak-plus) and closed apps (VidHub, 1DM, IDM) = ideas only, never copy code.
- No Google Drive/OneDrive/Dropbox sources.
- TEST BUILDS: always a standalone release APK with the JS bundle embedded (assembleRelease), never an Expo dev-client build.
- UX: Vega layout/home stays primary, then Torrents, then other sources. Tabs: Home, Search, Torrents, Library, Settings. Default Simple mode + Advanced mode; nothing hidden in a frustrating way; global fuzzy feature/settings search that also finds Advanced options and highlights them.

## PR stack (merge in this order)
1. #2 cursor/droid-stream-rebrand-e650 – rebrand + logos (Logo1 = app icon, Logo2 = cast/play button, Logo3 = add-plugin button; Settings > About: tordroid.com button uses website logo, GitHub link uses GitHub mark)
2. #3 cursor/stage1-vlc-library-e650 – libVLC player, skip intro/credits, local library
3. #4 cursor/stage2-network-sources-e650 – SMB (smbj), WebDAV stream/download, Jellyfin/Emby/Plex
4. #5 cursor/stage3-pikpak-magnet-e650 – optional per-user PikPak login + direct on-device magnet streaming
5. #6 cursor/stage4-torrent-client – Milestone A: 5 tabs, Simple torrent client (libtorrent4j 2.1.0-39, nanohttpd stream at http://127.0.0.1:{port}/stream/{infoHash}/{fileIndex}/{name}), Downloads search/filter/sort, feature search, Advanced mode, "More options"
6. claude/torrent-search-engine (on top of #6) – all jest suites green; multi-site torrent search; custom site adapters; debrid/cloud; link intake; Milestone B pieces (see below)

## Build
- Standalone test APK: `cd android && ./gradlew assembleRelease -PdroidstreamArm64Only=true -PreactNativeArchitectures=arm64-v8a` (release signed with debug keystore when release secrets are absent). Last build: 87,615,147 bytes, sha256 579b857993d2c11c3fe01629457fa9f23adc3583e1c78b21e1d7db11a8e4d244, package com.tordroid.droidstream, versionCode 217.
- CI: .github/workflows/release.yml builds a signed APK on a vX.Y.Z tag. It needs the repo secrets KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD (NOT set yet).

## Torrent search (src/lib/torrentSearch, screens/torrents/TorrentSearch|TorrentSources)
- `searchAll()` queries every enabled engine in parallel, streams results via onUpdate, dedupes by info hash, per-engine timeout (store.timeoutSeconds).
- Built-in engines: engines/api.ts (apibay, YTS, Nyaa RSS, AnimeTosho, Knaben, Torrents-CSV, Internet Archive) and engines/html.ts (1337x, TorrentGalaxy, LimeTorrents, BitSearch, EZTV, MagnetDL, Kickass, TorLock; cheerio). Mirrors are user-editable because domains move.
- engines/torznab.ts: Jackett/Prowlarr. engines/custom.ts: user adapters (auto magnet finder, CSS selectors, JSON paths, RSS) with import/export JSON, plus ADAPTER_CATALOG of extra sites (off until added).
- HTML selectors were written from each site's known markup and are NOT verified live (the build container blocks these hosts). Verify on device with Sites → Test all, and fix selectors or mirrors there.

## Debrid and cloud (src/lib/debrid, screens/torrents/DebridSettings)
- TorBox, Real-Debrid, AllDebrid, Premiumize, Offcloud, Debrid-Link, PikPak behind one DebridService interface. Cache badges where the API allows (TorBox, Premiumize, Offcloud, Debrid-Link; Real-Debrid retired instant availability). Keys in encrypted MMKV.
- Stream plays the direct HTTPS link; Download goes through the existing multi-connection downloader (queueLink).

## Streams, add-ons, sync (stage 6)
- src/lib/stremio: Stremio add-on protocol client + Cinemeta. src/lib/streams/finder.ts ranks add-on streams, site torrents, and debrid caches; play.ts plays one (debrid > phone), picks season-pack episodes, preloads the next episode. Screens: torrents/StreamFinder, torrents/StremioAddons; "Streams" button on Info.
- src/lib/releaseName.ts parser; src/lib/aniskip.ts (Jikan MAL id → AniSkip); src/lib/watchSync (Trakt device code, Simkl PIN, AniList token; called from Player when isWatched); src/lib/subtitles/hashMatch.ts (OpenSubtitles hash over HTTP ranges, OpenSubtitles v3 add-on). Player gets an optional `meta` param (lib/watchMeta.ts) and guesses it otherwise.
- Player.tsx split started: screens/home/player/{playerHelpers.ts, SkipButton.tsx, SidebarEpisodeRow.tsx}.
- Maestro flows in .maestro (npm run e2e / e2e:phone / e2e:tv).
- Min SDK stays 28 (libtorrent4j native needs Android 9 libc).

## Remaining work
- Milestone B done: shared/opened magnet intake + clipboard grabber (lib/linkIntake.ts), multi-feed RSS (15 min polling), checksum verify (downloaded file info button), FirstRunTips mounted. VPN kill switch, proxy, blocklist existed. Still open: queue reorder UI (planner.moveQueueItem exists), HLS quality picker UI (linkGrabber.probeLink returns variants), Android TV focus pass on the new screens, screenshots of every tab.
- IDM/1DM-class download engine: dynamic segment splitting, queues + scheduler, HLS merge.
- Create a release keystore + GitHub secrets; set extra.eas.projectId in app.config.js; update the repo description/homepage (tordroid.com).
- Device testing on a OnePlus 12 (arm64). CI workflow .github/workflows/test-apk.yml builds a standalone arm64 APK artifact on claude/** and cursor/** pushes.
- When a vega-org/vega-app commit/PR/issue link is given: port that fix, keeping Droid Stream branding, the Vega credit and the license notices.
