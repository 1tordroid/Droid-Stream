# Droid Stream features

Everything the app can do, what is being built right now, and what is
planned. For the changes in each release, see [CHANGELOG.md](CHANGELOG.md).

**Status in this list**

- ✅ In the app today (latest release, 5.5.0)
- 🧪 Built for 5.6.0, being tested
- 🔨 Being built for 5.6.0
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
- 🧪 Skip intro, recap, credits and previews for every show: times from the provider, Jellyfin, AniSkip (anime) and IntroDB, or mark them yourself once per season. Off, button or auto skip for each type.
- 🧪 Play best falls back to the next source by itself when one fails or doesn't start, and remembers links that failed.
- 🧪 Play best filters: largest file, lowest and highest quality, prefer or avoid HEVC and AV1.
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
- 📋 Subtitle sync tools and dual subtitles.
- 📋 Subtitle translation, using your own service.

## Live TV

- ✅ Live TV in the Home menu, the Library and the Welcome screen.
- ✅ Free Indian channels with no sign-in, plus any M3U playlist link.
- ✅ Sign in with Jio (Jio number and SMS code) for Jio channels.
- ✅ Favourites, recent channels, groups, search and now/next info.
- 🧪 TV guide grid with channels down and times across.
- 🧪 Catch-up: replay past programmes where the channel allows it.
- 🧪 Pause and rewind live channels that keep a buffer, with a "Go live" button.
- 🧪 Programme reminders.
- 🔨 Record live channels and programmes.
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

## Debrid, cloud and add-ons

- ✅ TorBox, Real-Debrid, AllDebrid, Premiumize, Offcloud, Debrid-Link and PikPak.
- ✅ Stremio add-ons such as Torrentio, Comet, MediaFusion and OpenSubtitles.
- ✅ One ranked stream list from add-ons, torrent sites and debrid caches, with Play best.
- ✅ Cloud files in Library.
- ✅ Sign-ins stay saved as long as each service allows.
- 📋 Add-on rows on Home.

## Your own servers

- ✅ SMB, WebDAV, Jellyfin, Emby and Plex.
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
- 🔨 yt-dlp downloader:
  - share a link from any app
  - pick a video quality, or audio as MP3, M4A or Opus
  - subtitles, thumbnails and SponsorBlock
  - cut a clip
  - pick items from a playlist
  - background queue and scheduling
  - update yt-dlp in the app
- 🔨 Social media downloads:
  - a built-in browser with site shortcuts
  - a download button on videos
  - a list of all media on the page
- 🔨 Photos from social apps: single photos, carousels, stories and profile pictures, with a "photo only" option.
- 🔨 Instagram photo with its song, saved as a video (or photo only, or song only).
- 🔨 Batch downloads of a carousel, playlist or profile.
- 🔨 MPEG-DASH downloads (separate video and audio).
- 🔨 Fix a download mid-way: change the link or headers, or refresh an expired link, without losing progress.
- 🔨 FTP and FTPS downloads.
- 📋 Season and rolling downloads (keep the next episodes ready).

### Advanced downloads (off by default, for rare needs)

- 🔨 eD2k links, server list and search.
- 🔨 GitHub and HuggingFace mirrors that you add yourself.
- 🔨 aria2-style remote control: send downloads to your phone from AriaNg or a browser extension on your Wi-Fi.
- 🔨 Command access from Termux, ADB or Tasker.
- 🔨 Browser-like connection for sites that turn away download apps.

## Browser

- 🔨 Built-in browser: tabs, private tabs, bookmarks, history, desktop mode and dark pages, opened from a small globe icon.
- 🔨 Download detection: a download button on videos and a list of every video, audio, image and stream on the page.
- 🔨 Ad and tracker blocker with common filter lists, and userscripts.
- 🔨 Send pages, links and media to the downloader, Torrents, the player or cast.
- 📋 Droid Stream (Extension support): a second, optional app. It is the same browser with Firefox add-ons (for example uBlock Origin, Dark Reader and Tampermonkey), built on Firefox's engine (GeckoView). It sends downloads, magnets and videos to Droid Stream. It is a separate app because Firefox's engine adds about 60 MB, and Droid Stream stays small.

## Profiles and family

- 🧪 Profiles: each has its own history, library, Continue watching, searches, Live TV favourites and Trakt sign-in.
- 🧪 Kids mode: hides adult content, the Torrents tab and Settings.
- 🧪 PIN lock with a wait after wrong tries.
- 🧪 Existing data becomes the first profile; nothing is lost.

## Watch sync

- ✅ Trakt, Simkl and AniList.
- 🧪 Sign in to Trakt and Simkl with a code and a QR code, without typing keys.
- 🧪 Trakt scrobbling: "watching now", and watches saved even when offline.
- 📋 Bring Trakt progress into Continue watching.
- 📋 Simkl scrobbling.
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
- ✅ Providers can't reach devices on your home network.
- ✅ In-app updates check the download before installing, signed with the Droid Stream key.
- ✅ Encrypted storage for sign-ins and keys; no analytics or trackers.

## Look and feel

- ✅ Accent colours, launcher icons, AMOLED black and Soft dark themes.
- ✅ Advanced mode shows every extra control; tab bar labels, haptics and the Home menu are adjustable.
- ✅ Search inside Settings to jump to any option.
- 📋 IMDb, Rotten Tomatoes and Metacritic scores together.

## Backup

- ✅ Export and import a backup; erase all local data.
- 🧪 Backups include profiles and PINs.
- 📋 Full backup and sync through WebDAV.

---

Ideas come from what users ask for in many apps. Droid Stream's code is
its own: projects under GPL (such as YTDLnis, Ghost Downloader 3, aMule and
Jellyfin clients) are used for ideas only. Projects whose code or logic is
used are credited in the app under Credits and Open-source licenses.
