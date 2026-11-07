# Changelog

Every Droid Stream release, newest first. The release build copies the
section for its version into the GitHub release notes, so add a section
here before tagging a release.

For everything the app can do, and what is planned, see
[FEATURES.md](FEATURES.md).

## Coming in 5.7

Built and being tested:

- Live TV: World channels get a TV guide by themselves. The app loads a
  free guide file for the country from Open-EPG or EPGSHARE01 (72
  countries), only when you open the guide or the "on now" line needs it,
  and keeps it for 12 hours. Free Indian channels get one too; their
  channels do not change. A guide address you typed still wins.
  Countries without a free guide say "No guide available for this
  country."
- Live TV: All countries, at the top of Change country, shows the free
  channels of every country in one list (about 11,000). Pick a country
  from the flag chips, and use groups, quality, language and search as
  before. Favourites, recent, recording and filters work, and the choice
  is kept per profile. The TV guide of All countries loads once you pick
  a country.
- Change country shows how many channels each country has once All
  countries has loaded.
- On phones and TVs with 2 GB of RAM or less, the guide uses one smaller
  file and the channel grid only shows "on now" from a guide already
  loaded.
- Night mode in the player's audio menu: Off, Light, Medium or Strong.
  Loud scenes get quieter and quiet speech louder, without clipping.
  Changes apply at once and become the default in Player settings.
- Dialogue boost in the same menu: Off, On or Strong. Raises the centre
  channel on 5.1 and 7.1, and the voice range on stereo.
- Both work on decoded audio. When sound goes encoded to a receiver,
  the menu says so. VLC has night mode (it restarts at the same time);
  dialogue boost is in the built-in player only.
- DTS and TrueHD play again in the built-in player on phones and TVs
  that can't decode them. The app decodes them (also E-AC3, AC3, FLAC
  and others when the device has no decoder), with an LGPL build of
  FFmpeg. The audio menu shows these tracks as "DTS · software", and
  night mode, dialogue boost and volume boost work on them. Sound that
  the device or a receiver can play still goes there. Turn it off in
  Player settings > Extra audio formats (DTS, TrueHD).

## 5.6.1

- Watch online for any magnet or torrent (Torrents results, opened magnets,
  the Magnet screen): cached debrid first, then PikPak, then the torrent
  on this device. Shows the way it uses and lets you pick another.
- PikPak and debrid services in the poster library: folders, Movies and
  Shows, artwork and Continue watching. Cloud files keeps a list view.
- PikPak: quality choice from its own transcodes, storage and transfer
  quota, magnet file preview before adding, photo preview, share links,
  and PikPak WebDAV as a library source.
- Tordroid Plus in Library > Add a source: family downloads with
  progress, play with quality choice or in VLC, add magnets, quota, share
  links and its WebDAV in the poster library.
- Photos from social apps keep working when a site changes: the app
  takes signed site rules from the Droid Stream repository once a day,
  or with Check now in Video downloader settings, which shows the
  rules version.
- "This site stopped working" on the photo downloader's error and in
  Video downloader settings opens a GitHub issue with the site, app
  version, rules version and error. The post link is added only if you
  tick the box.
- Remote control (off by default): add and manage downloads from AriaNg
  or an aria2 browser extension on your Wi-Fi, with a token and a QR
  code that sets up AriaNg.
- Command access (off by default): add, pause, resume and list downloads
  from Termux, ADB or Tasker with a token.
- Use a browser-like connection (off by default): downloads from sites
  you list connect like Chrome does.
- Continue on Trakt: movies and episodes you paused on other apps
  linked to Trakt show on Home. Tap one to find a source; playback
  starts where Trakt says you stopped, unless this device has its own
  progress.
- Simkl scrobbling, with its own switch in Watch sync. Stops made
  offline are sent later.
- Skip times from Emby (intro and credits markers) and Plex (intro and
  credits markers).
- The VLC player uses the same season marks and skip settings as the
  built-in player.
- The TMDB logo next to the TMDB notice in Credits and licences.
- TV guide for Live TV Favourites and Recent. Each channel uses its own
  source's guide, and catch-up works where the channel has it.
- On a phone, Go live plays again even after you paused.
- Try SMB playback (testing): a switch in Advanced downloads, off by
  default, to test playing files from SMB shares.
- Live TV World: free channels for any country, listed by iptv-org.
  Live TV starts on your country, found on the device from the SIM,
  network or language settings, and Change country picks another.
  Free Indian channels and JioTV stay as they were.
- Live TV: the quality tag (1080p) ends the group line on each channel
  and sits under the logo in the guide, so it no longer hides the logo.
  The Indian source's chip reads India, the chosen chip scrolls into
  view, and the World header fits at 360 dp.
- Browser passkeys: when a passkey sign-in fails, the browser offers
  Sign in with Chrome once per site (also in the browser menu). It opens
  the page in a Chrome Custom Tab, and the sign-in stays in Chrome.
  Browser settings explain why and add Choose a passkey manager.
- Send a problem report in About and on the error screen: opens a GitHub
  issue with the app, version, Android version and phone model. Recent
  logs are added only if you tick the box, with sign-ins, cookies,
  emails, IP addresses, link details and file paths removed.
- A smaller arm64 APK next to the universal one on each release and
  nightly. The in-app updater picks it on 64-bit devices and the
  universal one on 32-bit devices.
- Get beta builds in Settings > About (off by default): the updater also
  offers nightly builds. Turn it off to go back to stable updates; you
  get the next stable release when it is newer.
- Automatic phone tests on GitHub: each pull request builds the app,
  starts it on an Android emulator and opens the tabs, Browser (loading
  a page), Live TV and About.

## 5.6.0

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
- The browser menu can turn the ad blocker off for all sites or just
  one site.
- Your version and build number, and a Check for updates button, at
  the top of Settings. Credits and open-source licences are now one
  page, with link buttons for the projects and services.


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
