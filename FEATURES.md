# Droid Stream features

Everything the app can do, what is being built right now, and what is
planned. For the changes in each release, see [CHANGELOG.md](CHANGELOG.md).

**Status in this list**

- ✅ In the app today (latest release, 5.6.1)
- 🧪 Built for the next release, being tested
- 🔨 Being built for the next release
- 📋 Planned for a later release

Droid Stream is based on Vega by [vega-org](https://github.com/vega-org/vega-app).
It runs on Android phones, tablets and Android TV.

---

## Watch

- ✅ Stream movies, shows and anime from provider plugins (the same plugins Vega runs), with auto updates for providers.
- ✅ Search every provider at once; the closest title match comes first, and an empty Search shows the provider's genres.
- ✅ Title pages with seasons, episodes, cast, ratings and artwork.
- ✅ Watch list, Library, Continue watching, watched badges and "Hide watched".
- ✅ Auto play next episode.
- ✅ Skip intro, recap, credits and previews for every show: times from the provider, Jellyfin, AniSkip (anime) and IntroDB, or mark them yourself once per season. Off, button or auto skip for each type.
- ✅ Skip times from your Emby and Plex servers too, and the VLC player uses the same season marks and skip settings.
- ✅ Play best falls back to the next source by itself when one fails or doesn't start, and remembers links that failed.
- ✅ Play best filters: largest file, lowest and highest quality, prefer or avoid HEVC and AV1.
- 📋 Chapters in the player.
- 📋 Night mode and dialogue boost for quiet speech and loud effects.
- 📋 DTS and TrueHD audio in the built-in player.
- 📋 Dolby Vision profile 7 to 8.1 conversion.

## Player

- ✅ Built-in player or VLC, or any external player.
- ✅ Picture-in-picture and background audio.
- ✅ Swipe gestures for brightness, volume and seeking; seek interval and playback speed.
- ✅ Volume boost, ambient lighting around the video and an HDR badge.
- ✅ Customise the player controls (layout and look).
- ✅ Buffer settings and faster playback on slow servers (parallel connections).
- ✅ Automatically try the next server when one fails.
- ✅ Notification media controls.
- ✅ Subtitles: style, size and colour, matched by file hash, search and add your own.
- ✅ Preferred audio and subtitle languages, with a second choice.
- 🧪 Night mode (evens out loud and quiet sound) and dialogue boost (clearer voices), changed live from the audio menu. VLC has night mode only.
- 📋 Subtitle sync tools and dual subtitles.
- 📋 Subtitle translation, using your own service.

## Live TV

- ✅ Live TV in the Home menu, the Library and the Welcome screen.
- ✅ Free Indian channels with no sign-in, plus any M3U playlist link.
- ✅ Sign in with Jio (Jio number and SMS code) for Jio channels.
- ✅ Favourites, recent channels, groups, search and now/next info.
- ✅ TV guide grid with channels down and times across.
- ✅ TV guide for Favourites and Recent, with each channel's own guide and catch-up.
- ✅ Catch-up: replay past programmes where the channel allows it.
- ✅ Pause and rewind live channels that keep a buffer, with a "Go live" button.
- ✅ On a phone, Go live also plays again after you paused.
- ✅ Programme reminders.
- ✅ Filter channels by quality (4K, 1080p, 720p, SD) and language, with counts; kept per source and profile.
- ✅ Record live channels and programmes.
- ✅ World: free channels for any country from iptv-org. Starts on your country (from the SIM, network or language settings, never online), and you can change it.
- ✅ Quality tags (1080p) sit beside the channel's group instead of on its logo, and the chosen source chip stays in view on narrow phones.
- 📋 Watch 2 to 4 channels at once.

## Torrents

- ✅ Search many torrent sites at once, with filters and trending.
- ✅ Turn sites on or off, add your own sites, Jackett or Prowlarr.
- ✅ Stream while downloading; open magnets and `.torrent` files from other apps.
- ✅ Choose which files in a torrent to download.
- ✅ Speed limits, scheduler, Wi-Fi only, proxy, VPN bind and kill switch.
- ✅ Trackers, encryption, DHT, PEX, LSD, uTP and an IP blocklist.
- ✅ RSS feeds, create a torrent, seeding limits (seeding is off until you turn it on).
- ✅ Open torrents in external players such as VLC and MX Player.
- ✅ Watch online for any magnet or torrent: cached debrid first, then PikPak in the cloud, then the torrent on this device. Shows the way it uses, and you can pick another.

## Debrid, cloud and add-ons

- ✅ TorBox, Real-Debrid, AllDebrid, Premiumize, Offcloud, Debrid-Link and PikPak.
- ✅ Stremio add-ons such as Torrentio, Comet, MediaFusion and OpenSubtitles.
- ✅ One ranked stream list from add-ons, torrent sites and debrid caches, with Play best.
- ✅ Cloud files in Library.
- ✅ PikPak and each signed-in debrid service as poster libraries: folders, Movies and Shows, artwork and Continue watching. Debrid transfers are the folders. A list view is still there.
- ✅ PikPak: play its own transcoded copies with a quality choice, storage and transfer quota, preview a magnet's files before adding, photo preview, share links, and PikPak WebDAV as a library source.
- ✅ Tordroid Plus: sign in to the family portal, see family downloads with progress, play them (with quality choice or in VLC), add magnets, quota, share links, and its WebDAV in the poster library.
- ✅ Sign-ins stay saved as long as each service allows.
- 📋 Add-on rows on Home.

## Your own servers

- ✅ SMB, WebDAV, Jellyfin, Emby and Plex.
- ✅ Try SMB playback (testing), a switch in Advanced downloads. Off by default.
- ✅ Poster library for your servers and your device's videos: Movies, Shows, Other and Folders, matched titles and artwork, Continue watching across sources.
- ✅ Fix a wrong poster or title.
- 📋 Plex PIN sign-in and Jellyfin Quick Connect.
- 📋 Sync your progress back to Jellyfin, Emby and Plex.
- 📋 Find servers on your network by themselves.

## Downloads

- ✅ Multi-connection downloader (1 to 32 connections) with smart splitting, a queue, speed limits and a scheduler.
- ✅ HLS downloads with a quality choice, and checksum checks.
- ✅ Copy a link and the app offers to download it.
- ✅ External downloader support.
- ✅ yt-dlp downloader:
  - share a link from any app
  - pick a video quality, or audio as MP3, M4A or Opus
  - subtitles, thumbnails and SponsorBlock
  - cut a clip
  - pick items from a playlist
  - background queue and scheduling
  - update yt-dlp in the app
- ✅ Social media downloads:
  - a built-in browser with site shortcuts
  - a download button on videos
  - a list of all media on the page
- ✅ Photos from social apps: Instagram (photos, carousels, reel covers, stories and highlights when signed in, full-size profile pictures), Facebook, X, Threads, Pinterest, Reddit and Tumblr. Pick items, "Photos only" and original quality; saved in Social/<site>/<author>.
- ✅ Instagram photo with its song: save the photo, the song, or a video of the photo (or a carousel slideshow) with the song, made on the phone.
- ✅ Batch downloads of a whole carousel or the latest posts of a profile (playlists go through the yt-dlp downloader).
- ✅ Site rules for photos from social apps: when a site changes, a signed rules update fixes it without an app update (checked once a day, or with Check now in Video downloader settings). "This site stopped working" opens a GitHub issue with the site and versions, and the post link only if you tick the box.
- ✅ MPEG-DASH downloads (separate video and audio).
- ✅ Fix a download mid-way: change the link or headers, or refresh an expired link, without losing progress.
- ✅ FTP and FTPS downloads.
- 📋 Season and rolling downloads (keep the next episodes ready).

### Advanced downloads (off by default, for rare needs)

- ✅ eD2k links, server list and search.
- ✅ GitHub and HuggingFace mirrors that you add yourself.
- ✅ aria2-style remote control: send downloads to your phone from AriaNg or a browser extension on your Wi-Fi.
- ✅ Command access from Termux, ADB or Tasker.
- ✅ Browser-like connection for sites that turn away download apps.

## Browser

- ✅ Built-in browser: tabs that come back after a restart, private tabs, bookmarks, history, site shortcuts, find in page, dark pages and a choice of search engine, opened from a small globe icon.
- ✅ Desktop or mobile layout: Desktop by default, a choice for new tabs and pop-ups, and a Desktop site switch remembered for each site.
- ✅ Download detection: a download button on videos and a list of every video, audio, image and stream on the page.
- ✅ Ad and tracker blocker with EasyList, EasyPrivacy and IndianList, your own lists and rules, and blocking off for chosen sites.
- ✅ Userscripts (Greasemonkey and Tampermonkey style).
- ✅ Saved passwords locked with your screen lock, your phone's password manager (autofill), and passkeys where the passkey provider allows the app.
- ✅ Help when passkeys fail: Sign in with Chrome (the sign-in stays in Chrome), offered once per site, and Choose a passkey manager in Browser settings.
- ✅ Send pages, links and media to the downloader, yt-dlp, Torrents, the player or cast, and take file links from other browsers.
- 📋 Droid Stream (with extension support): a second edition of the whole app. It has every Droid Stream feature, and its Browser runs on Firefox's engine (GeckoView) with Firefox add-ons such as uBlock Origin, Dark Reader and Tampermonkey. Install one or the other: the regular Droid Stream stays smaller, this edition is about 60 MB bigger.

## Profiles and family

- ✅ Profiles: each has its own history, library, Continue watching, searches, Live TV favourites and Trakt sign-in.
- ✅ Kids mode: hides adult content, the Torrents tab and Settings.
- ✅ PIN lock with a wait after wrong tries.
- ✅ Existing data becomes the first profile; nothing is lost.

## Watch sync

- ✅ Trakt, Simkl and AniList.
- ✅ Sign in to Trakt and Simkl with a code and a QR code, without typing keys.
- ✅ Trakt scrobbling: "watching now", and watches saved even when offline.
- ✅ Bring Trakt progress into Continue watching: a "Continue on Trakt" row, and playback starts where Trakt says you stopped.
- ✅ Simkl scrobbling, with its own switch, that keeps working offline.
- 📋 New-episode calendar and alerts.

## Cast and TV

- ✅ Google Cast and DLNA, plus Vega Cast so existing Vega receivers still pair.
- ✅ Android TV layout with remote (D-pad) control.
- ✅ Sync with the Vega desktop app.
- 📋 Android TV "Watch Next" row.
- 📋 Automatic frame-rate matching on TV.
- 📋 TV screensaver and pause screen.
- 📋 Send your whole setup from your phone to your TV.

## Network and privacy

- ✅ Cloudflare WARP mode, ByeDPI and DNS over HTTPS to get past ISP blocks.
- ✅ Smart unblock, on by default: only sites your provider blocks open through ByeDPI or Cloudflare WARP; debrid stays direct.
- ✅ Providers can't reach devices on your home network.
- ✅ In-app updates check the download before installing, signed with the Droid Stream key.
- ✅ Encrypted storage for sign-ins and keys; no analytics or trackers.

## Look and feel

- ✅ Accent colours, launcher icons, AMOLED black and Soft dark themes.
- ✅ Advanced mode shows every extra control; tab bar labels, haptics and the Home menu are adjustable.
- ✅ Search inside Settings to jump to any option.
- ✅ Check for updates and the version in Settings; one Credits and licences page with links.
- ✅ Get beta builds (Settings > About, off by default): the in-app updater also offers nightly builds. Turn it off to go back to stable; you get the next stable release when it is newer.
- ✅ A smaller arm64 APK next to the universal one on each release and nightly. The updater picks it on 64-bit devices and the universal one on 32-bit devices.
- ✅ Automatic phone tests on GitHub: each pull request starts the app on an Android emulator and opens the tabs, Browser (loading a page), Live TV and About.
- ✅ The TMDB logo with the TMDB notice in Credits and licences.
- ✅ Send a problem report from About or the error screen: a GitHub issue with your app and phone details, and recent logs only if you tick the box.
- 📋 IMDb, Rotten Tomatoes and Metacritic scores together.

## Backup

- ✅ Export and import a backup; erase all local data.
- ✅ Backups include profiles and PINs.
- 📋 Full backup and sync through WebDAV.

---

Ideas come from what users ask for in many apps. Droid Stream's code is
its own: projects under GPL (such as YTDLnis, Ghost Downloader 3, aMule and
Jellyfin clients) are used for ideas only. Projects whose code or logic is
used are credited in the app under Credits and licences.
