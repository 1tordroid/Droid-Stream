# Droid Stream – Handoff (2026-11-05)

Continue this project in any AI coding tool (Claude Code, Gemini/Antigravity, Cursor).
Repo: https://github.com/1tordroid/Droid-Stream (standalone, not a fork) · Developer: Tordroid · https://tordroid.com · Support: https://t.me/Tordroid_admin

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

## Remaining work
- Milestone B done: shared/opened magnet intake + clipboard grabber (lib/linkIntake.ts), multi-feed RSS (15 min polling), checksum verify (downloaded file info button), FirstRunTips mounted. VPN kill switch, proxy, blocklist existed. Still open: queue reorder UI (planner.moveQueueItem exists), HLS quality picker UI (linkGrabber.probeLink returns variants), Android TV focus pass on the new screens, screenshots of every tab.
- IDM/1DM-class download engine: dynamic segment splitting, queues + scheduler, HLS merge.
- Create a release keystore + GitHub secrets; set extra.eas.projectId in app.config.js; update the repo description/homepage (tordroid.com).
- Device testing on a OnePlus 12 (arm64). CI workflow .github/workflows/test-apk.yml builds a standalone arm64 APK artifact on claude/** and cursor/** pushes.
- When a vega-org/vega-app commit/PR/issue link is given: port that fix, keeping Droid Stream branding, the Vega credit and the license notices.
