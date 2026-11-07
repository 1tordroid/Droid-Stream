# Changelog

Every Droid Stream release, newest first. The release build copies the
section for its version into the GitHub release notes, so add a section
here before tagging a release.

For everything the app can do, and what is planned, see
[FEATURES.md](FEATURES.md).

## Coming in 5.6.0

Not released yet. Built and being tested:

- Skip intro, recap, credits and previews for every show (provider,
  Jellyfin, AniSkip and IntroDB times, or your own marks), with Off,
  button or auto skip for each.
- Play best moves to the next source by itself when one fails or does
  not start, remembers failed links, and has size, quality and codec
  filters.
- Sign in to Trakt and Simkl with a code and a QR code, and Trakt
  scrobbling that keeps working offline.
- Live TV guide grid, catch-up, programme reminders, and pause and
  rewind on live channels.
- Live TV and guide filters for quality and language, with channel
  counts, quality badges and Reset filters. Kept per source and profile.
- Profiles with their own history and library, a kids mode and PIN
  locks. Your current data becomes the first profile.
- A yt-dlp video and audio downloader: share a link from any app, pick
  quality or audio format, subtitles, cover, SponsorBlock, clips,
  playlists, a queue with start times, site sign-in for cookies, and
  yt-dlp updates inside the app.
- Record Live TV channels that have no DRM, or a programme from the
  guide (it starts and stops by itself). Protected channels show no
  Record option.
- MPEG-DASH and FTP/FTPS downloads, "Edit link" to continue a download
  from a new address, and expired provider or debrid links renewed by
  themselves.
- Advanced downloads (off by default): eD2k links and search, and
  GitHub and HuggingFace mirrors you add yourself.
- Smart unblock, on by default: sites your provider blocks open
  through ByeDPI or Cloudflare WARP, only for those sites, and debrid
  stays direct. Always ByeDPI, Always WARP and Off are still there.
- Update download notifications no longer vibrate every second.
- Save photos from Instagram, Facebook, X, Threads, Pinterest, Reddit
  and Tumblr posts: carousels, stories, highlights, profile pictures and
  a profile's latest posts, and Instagram photos with their song as a
  photo, a song file or a video.
- A built-in browser (globe icon on Home, and in Search and Downloads):
  tabs, private tabs, bookmarks, history, desktop or mobile layout,
  dark pages, a download button on videos and a list of the media on
  each page, an ad and tracker blocker, userscripts, saved passwords
  and passkeys. File links from other browsers can be sent to the
  downloader.

Being built:

- Advanced downloads (off by default): aria2-style remote control,
  command access and a browser-like connection.

## 5.5.0

Live TV:

- Live TV is in the Home provider menu (under Available providers), on
  the Library screen and on the Welcome screen.
- Free Indian channels with no sign-in, from the public iptv-org list,
  plus any M3U playlist link. Favourites, recent channels, groups,
  search and a programme guide where the playlist has one.
- Sign in with Jio (Jio number and SMS code) to watch Jio channels.
  Parts adapted from jiotv_go by the jiotv-go project (CC BY 4.0). Not
  affiliated with Jio.

Sign-ins:

- Sign-ins stay saved as long as each service allows: PikPak, Trakt,
  debrid services and your own servers renew their sessions by
  themselves.
- Every sign-in and key form scrolls above the keyboard and can be sent
  with the keyboard's Go key. The PikPak Sign in button is reachable
  again.

Your own servers:

- A poster library for WebDAV, Plex, Jellyfin and Emby, with folder
  browsing, matched titles and artwork, and Continue watching across
  sources.
- Plex videos without a play link and current Jellyfin servers play.

Player and search:

- Picture-in-picture and background audio when you leave the app.
- Search puts the closest title first, and an empty Search screen shows
  the provider's genres.
- Watched badges and a "Hide watched" option.
- Torrents open in external players such as VLC and MX Player.

Security and updates:

- A provider can no longer make the app reach devices on your home
  network.
- The Vega Cast server is harder to misuse, and in-app updates check the
  download's hash before installing.
- Removed the GPL FFmpeg audio decoder and permissions the app does not
  use, including WRITE_SETTINGS.
- Cloudflare WARP rebuilt on current Go; mmkv-storage 13, ffmpeg-kit
  8.1.9, bootsplash 7, haptic feedback 3, cookie manager 7.
- The 32-bit ARM torrent engine works, and the dead "Hide downloads tab"
  setting is gone.

## 5.4.0

- Expo SDK 58, React Native 0.88 and React 19.3, with the matching
  versions of every Expo module and native library.
- The Restart button on the error screen restarts the app.
- Erase all local data and Restore backup restart the app properly.
- Settings pages no longer stay half drawn after Android recreates the
  app (for example after changing the launcher icon).
- SMB sources keep working (the app ships its own Bouncy Castle).
- Smaller app: unused libraries and files removed.
- The nightly build runs again and signs like the release build.

## 5.3.4

The Vega app rebranded as Droid Stream:

- Torrents tab with multi-site search, custom site adapters, a torrent
  client that streams while downloading, RSS feeds, and schedule, Wi-Fi
  and VPN rules.
- Debrid and cloud services (TorBox, Real-Debrid, AllDebrid, Premiumize,
  Offcloud, Debrid-Link, PikPak) and Stremio add-ons in one ranked
  stream list with Play best.
- SMB, WebDAV, Jellyfin, Emby and Plex sources, a VLC player option,
  AniSkip, subtitles matched by file hash, and watch sync with Trakt,
  Simkl and AniList.
- Multi-connection downloader with a queue, HLS downloads and checksum
  checks; Library with cloud files; AMOLED black and Soft dark themes.
- In-app updates from GitHub Releases, signed with the Droid Stream
  release key.

## 5.3.3

- Cloud files in Library, PikPak file listing and loading placeholders.
- Fixed wrong title matches and the Search tab.
- Shared links open while the app is running, dialog buttons are no
  longer hidden, and Downloads fixes.
- Torrent transfer rules apply from app start without starting the
  torrent engine.
