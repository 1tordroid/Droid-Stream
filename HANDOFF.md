# Droid Stream – Handoff (2026-11-04)

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

## Build
- Standalone test APK: `cd android && ./gradlew assembleRelease -PdroidstreamArm64Only=true -PreactNativeArchitectures=arm64-v8a` (release signed with debug keystore when release secrets are absent). Last build: 87,615,147 bytes, sha256 579b857993d2c11c3fe01629457fa9f23adc3583e1c78b21e1d7db11a8e4d244, package com.tordroid.droidstream, versionCode 217.
- CI: .github/workflows/release.yml builds a signed APK on a vX.Y.Z tag. It needs the repo secrets KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD (NOT set yet).

## Remaining work
- Milestone B: VPN kill switch, proxy, RSS feeds/auto-download, IP blocklist, clipboard magnet grabber, checksum verify, queue reorder, HLS quality picker, mount the FirstRunTips intro, Android TV focus handling, screenshots of every tab in Simple and Advanced modes.
- IDM/1DM-class download engine: dynamic segment splitting, queues + scheduler, HLS merge.
- Fix 9 of 164 failing jest tests (App.test.tsx loads global.css; missing "Watch" label, etc.).
- Create a release keystore + GitHub secrets; set extra.eas.projectId in app.config.js; update the repo description/homepage (tordroid.com).
- Device testing on a OnePlus 12 (arm64).
- When a vega-org/vega-app commit/PR/issue link is given: port that fix, keeping Droid Stream branding, the Vega credit and the license notices.
