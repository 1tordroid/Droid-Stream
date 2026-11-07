/**
 * Everything on the Credits and licences page. Each entry names its links so
 * the page can show them as small labelled buttons. An entry with no link we
 * could confirm sets `noLinks: true` instead of guessing one.
 */

export type CreditLinkLabel =
  | 'Repository'
  | 'Website'
  | 'Releases'
  | 'Telegram'
  | 'GitHub'
  | 'App'
  | 'Play Store'
  | 'Docs'
  | 'Licence'
  | 'Terms'
  | 'Providers';

export interface CreditLink {
  label: CreditLinkLabel;
  url: string;
}

export interface CreditEntry {
  name: string;
  note: string;
  license?: string;
  /** A line that must be shown word for word, such as a Required Notice. */
  notice?: string;
  /** A logo the service asks to show with its notice. */
  logo?: 'tmdb';
  links: CreditLink[];
  /** Set when there is no official link to show. */
  noLinks?: true;
}

export type CreditSectionId = 'droidstream' | 'builton' | 'code' | 'services' | 'ideas' | 'licences';

export interface CreditSection {
  id: CreditSectionId;
  title: string;
  /** Short name for the jump buttons at the top of the page. */
  shortTitle: string;
  intro: string;
  items: CreditEntry[];
}

const gh = (path: string): CreditLink => ({label: 'Repository', url: `https://github.com/${path}`});
const web = (url: string): CreditLink => ({label: 'Website', url});
const docs = (url: string): CreditLink => ({label: 'Docs', url});

/** The wording TMDB asks every app that uses its API to show, with its logo. */
export const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

/** OMDb's data is licensed CC BY-NC 4.0, which asks for credit. */
export const OMDB_NOTICE = 'Ratings data from the OMDb API (omdbapi.com), licensed CC BY-NC 4.0.';

export const VEGA_REQUIRED_NOTICE =
  'Required Notice: Copyright (c) 2026 [LICENSOR NAME] (https://github.com/vega-org/vega-app)';

export const CREDIT_SECTIONS: CreditSection[] = [
  {
    id: 'droidstream',
    title: 'Droid Stream and Tordroid',
    shortTitle: 'Droid Stream',
    intro: 'Droid Stream is free and noncommercial. It is made by Tordroid.',
    items: [
      {
        name: 'Droid Stream',
        note: 'This app. Source code, releases and the changelog are on GitHub.',
        license: 'PolyForm Noncommercial 1.0.0',
        links: [
          gh('1tordroid/Droid-Stream'),
          {label: 'Releases', url: 'https://github.com/1tordroid/Droid-Stream/releases'},
          {label: 'Licence', url: 'https://github.com/1tordroid/Droid-Stream/blob/main/LICENSE'},
        ],
      },
      {
        name: 'Tordroid',
        note: 'Developer of Droid Stream. Ask for help on Telegram.',
        links: [
          web('https://tordroid.com'),
          {label: 'Telegram', url: 'https://t.me/Tordroid_admin'},
          {label: 'GitHub', url: 'https://github.com/1tordroid'},
        ],
      },
      {
        name: 'Tordroid Plus',
        note: "Tordroid's family portal for a shared PikPak account, built on PikPak Plus by Bharath Ganji. Droid Stream signs in to it as a library source and only talks to its web API; none of its code is in the app.",
        license: 'GPL-3.0',
        links: [web('https://plus.tordroid.com'), gh('1tordroid/pikpak-plus')],
      },
    ],
  },
  {
    id: 'builton',
    title: 'Built on',
    shortTitle: 'Built on',
    intro: 'Droid Stream is based on this project and stays compatible with its providers.',
    items: [
      {
        name: 'Vega by vega-org',
        note: 'The original app, its layout, and the provider system.',
        license: 'PolyForm Noncommercial 1.0.0',
        links: [gh('vega-org/vega-app'), {label: 'Providers', url: 'https://github.com/vega-org/vega-providers'}],
      },
    ],
  },
  {
    id: 'code',
    title: 'Code and libraries',
    shortTitle: 'Libraries',
    intro: 'Used under their own licences. Every package is in the licence list at the end.',
    items: [
      {name: 'React Native for TV (react-native-tvos)', note: 'The app framework, with Android TV support.', license: 'MIT', links: [gh('react-native-tvos/react-native-tvos'), web('https://reactnative.dev')]},
      {name: 'Expo', note: 'Builds the app and provides its native modules.', license: 'MIT', links: [gh('expo/expo'), web('https://expo.dev')]},
      {name: 'react-native-video', note: 'The built-in player.', license: 'MIT', links: [gh('TheWidlarzGroup/react-native-video')]},
      {name: 'AndroidX Media3 (ExoPlayer)', note: 'Plays video in the built-in player and reads frames for thumbnails.', license: 'Apache-2.0', links: [gh('androidx/media'), docs('https://developer.android.com/media/media3')]},
      {name: 'libVLC by VideoLAN', note: 'VLC playback engine, linked dynamically.', license: 'LGPL-2.1', links: [web('https://www.videolan.org/vlc/libvlc.html')]},
      {name: 'libtorrent', note: 'Torrent engine.', license: 'BSD-3-Clause', links: [gh('arvidn/libtorrent'), web('https://www.libtorrent.org')]},
      {name: 'libtorrent4j', note: 'Connects libtorrent to the app.', license: 'BSD-3-Clause', links: [gh('aldenml/libtorrent4j')]},
      {name: 'NanoHTTPD', note: 'Local server that streams torrents to the player.', license: 'BSD-3-Clause', links: [gh('NanoHttpd/nanohttpd')]},
      {name: 'smbj', note: 'SMB network shares.', license: 'Apache-2.0', links: [gh('hierynomus/smbj')]},
      {name: 'Bouncy Castle', note: 'MD4 hashing for eD2k downloads.', license: 'MIT', links: [gh('bcgit/bc-java'), web('https://www.bouncycastle.org')]},
      {name: 'Apache Commons Net', note: 'FTP and FTPS downloads.', license: 'Apache-2.0', links: [gh('apache/commons-net'), web('https://commons.apache.org/proper/commons-net/')]},
      {name: 'yt-dlp', note: 'The video downloader, run unchanged inside the app.', license: 'Unlicense', links: [gh('yt-dlp/yt-dlp')]},
      {name: 'yt-dlp-ejs', note: 'Solves YouTube challenges for yt-dlp.', license: 'Unlicense', links: [gh('yt-dlp/ejs')]},
      {name: 'Python (CPython)', note: 'Runs yt-dlp on Android.', license: 'PSF-2.0', links: [gh('python/cpython'), web('https://www.python.org')]},
      {name: 'Chaquopy', note: 'Builds Python into the app.', license: 'MIT', links: [gh('chaquo/chaquopy'), web('https://chaquo.com/chaquopy/')]},
      {name: 'FFmpeg', note: 'Merges and converts downloaded video and audio.', license: 'LGPL-3.0', links: [web('https://ffmpeg.org')]},
      {name: 'FFmpegKit', note: 'Runs FFmpeg inside the app. The app uses the community-maintained build.', license: 'LGPL-3.0', links: [gh('ffmpegkit-maintained/ffmpeg'), {label: 'Repository', url: 'https://github.com/arthenica/ffmpeg-kit'}]},
      {name: 'Jetpack JavaScript Engine (androidx.javascriptengine)', note: 'Runs the YouTube challenge solver in an isolated process.', license: 'Apache-2.0', links: [docs('https://developer.android.com/jetpack/androidx/releases/javascriptengine')]},
      {name: 'AndroidX WebKit', note: 'Passkey support in the browser.', license: 'Apache-2.0', links: [docs('https://developer.android.com/jetpack/androidx/releases/webkit')]},
      {name: 'MMKV by Tencent', note: 'Fast on-device storage for settings and data.', license: 'BSD-3-Clause', links: [gh('Tencent/MMKV')]},
      {name: 'react-native-mmkv-storage', note: 'Connects MMKV to the app, with encryption.', license: 'MIT', links: [gh('ammarahm-ed/react-native-mmkv-storage')]},
      {name: 'zustand', note: 'App state.', license: 'MIT', links: [gh('pmndrs/zustand'), docs('https://zustand.docs.pmnd.rs')]},
      {name: 'cheerio', note: 'Reads torrent site pages.', license: 'MIT', links: [gh('cheeriojs/cheerio'), web('https://cheerio.js.org')]},
      {name: 'Inter by Rasmus Andersson', note: 'App font, SIL Open Font License.', license: 'OFL-1.1', links: [gh('rsms/inter'), web('https://rsms.me/inter/')]},
      {name: 'usque', note: 'Open-source Cloudflare WARP client behind WARP mode. It runs as its own process.', license: 'MIT', links: [gh('Diniboy1123/usque')]},
      {name: 'ByeDPI', note: 'Gets past ISP blocks in ByeDPI mode and Smart unblock.', license: 'MIT', links: [gh('hufrea/byedpi')]},
      {name: 'Notifee', note: 'Download, update and reminder notifications.', license: 'Apache-2.0', links: [gh('invertase/notifee'), docs('https://notifee.app')]},
      {name: 'react-native-google-cast', note: 'Casting to Chromecast and Google TV.', license: 'MIT', links: [gh('react-native-google-cast/react-native-google-cast')]},
      {
        name: 'JioTV Go by the jiotv-go project',
        note: 'Parts of its sign-in and channel logic are adapted for the JioTV source in Live TV (Sign in with Jio, token renewal, channel list and stream requests), and Live TV can also load the playlist from your own JioTV Go server. Licensed CC BY 4.0. Not affiliated with Jio.',
        license: 'CC-BY-4.0',
        links: [gh('JioTV-Go/jiotv_go'), docs('https://jiotv_go.rabil.me')],
      },
    ],
  },
  {
    id: 'services',
    title: 'Open protocols and services',
    shortTitle: 'Services',
    intro: 'Droid Stream talks to these. Each one is optional and belongs to its owner.',
    items: [
      {name: 'Stremio add-on protocol', note: 'Add-on support, written from the public protocol.', links: [gh('Stremio/stremio-addon-sdk'), docs('https://github.com/Stremio/stremio-addon-sdk/tree/master/docs')]},
      {name: 'Cinemeta', note: 'Movie and show details, and the IMDb score when OMDb has none.', links: [web('https://v3-cinemeta.strem.io')]},
      {
        name: 'TMDB (The Movie Database)',
        note: 'Posters, artwork and details for your library and title pages, with your own API key. Its user score shows on title pages when there is no IMDb score.',
        notice: TMDB_NOTICE,
        logo: 'tmdb',
        links: [web('https://www.themoviedb.org'), {label: 'Terms', url: 'https://www.themoviedb.org/api-terms-of-use'}, docs('https://developer.themoviedb.org')],
      },
      {name: 'TVmaze', note: 'Episode air dates for the Calendar and new-episode alerts. TVmaze data is licensed CC BY-SA 4.0.', license: 'CC-BY-SA-4.0', links: [web('https://www.tvmaze.com'), docs('https://www.tvmaze.com/api')]},
      {
        name: 'OMDb API',
        note: 'Title search results, and the IMDb, Rotten Tomatoes and Metacritic scores on title pages. You can use your own free key in Settings > Ratings.',
        license: 'CC-BY-NC-4.0',
        notice: OMDB_NOTICE,
        links: [web('https://www.omdbapi.com'), {label: 'Licence', url: 'https://creativecommons.org/licenses/by-nc/4.0/'}],
      },
      {name: 'IMDb', note: 'Scores and vote counts on title pages, through OMDb and Cinemeta. Droid Stream does not read the IMDb website. IMDb is a trademark of its owner. Not affiliated.', links: [web('https://www.imdb.com')]},
      {name: 'Rotten Tomatoes', note: 'Critics scores on title pages, through OMDb. Droid Stream does not read the Rotten Tomatoes website. Rotten Tomatoes is a trademark of its owner. Not affiliated.', links: [web('https://www.rottentomatoes.com')]},
      {name: 'Metacritic', note: 'Metascores on title pages, through OMDb. Droid Stream does not read the Metacritic website. Metacritic is a trademark of its owner. Not affiliated.', links: [web('https://www.metacritic.com')]},
      {name: 'Jikan', note: 'Anime details from MyAnimeList.', links: [web('https://jikan.moe'), gh('jikan-me/jikan')]},
      {name: 'AniSkip', note: 'Anime intro and outro skip times.', links: [gh('aniskip/aniskip-api')]},
      {name: 'IntroDB', note: 'TV show intro, recap and outro skip times.', links: [web('https://introdb.app')]},
      {name: 'SponsorBlock', note: 'Marks or removes sponsor segments in yt-dlp downloads.', links: [web('https://sponsor.ajay.app'), gh('ajayyy/SponsorBlock')]},
      {name: 'OpenSubtitles', note: 'Subtitle matching.', links: [web('https://www.opensubtitles.com')]},
      {name: 'Trakt', note: 'Watch history sync.', links: [web('https://trakt.tv'), docs('https://docs.trakt.tv')]},
      {name: 'Simkl', note: 'Watch history sync.', links: [web('https://simkl.com')]},
      {name: 'AniList', note: 'Anime watch history sync.', links: [web('https://anilist.co')]},
      {name: 'Jellyfin', note: 'Play from your own Jellyfin server.', links: [web('https://jellyfin.org'), docs('https://api.jellyfin.org')]},
      {name: 'Emby', note: 'Play from your own Emby server.', links: [web('https://emby.media'), docs('https://dev.emby.media')]},
      {name: 'Plex', note: 'Play from your own Plex server.', links: [web('https://www.plex.tv'), docs('https://developer.plex.tv')]},
      {name: 'TorBox', note: 'Debrid service, with your own account.', links: [web('https://torbox.app')]},
      {name: 'Real-Debrid', note: 'Debrid service, with your own account.', links: [web('https://real-debrid.com')]},
      {name: 'AllDebrid', note: 'Debrid service, with your own account.', links: [web('https://alldebrid.com')]},
      {name: 'Premiumize', note: 'Debrid service, with your own account.', links: [web('https://www.premiumize.me')]},
      {name: 'Offcloud', note: 'Debrid service, with your own account.', links: [web('https://offcloud.com')]},
      {name: 'Debrid-Link', note: 'Debrid service, with your own account.', links: [web('https://debrid-link.com')]},
      {name: 'PikPak', note: 'Cloud downloads with your own account. It also gave ideas for browser download detection.', links: [web('https://mypikpak.com')]},
      {name: 'Cloudflare WARP', note: "WARP mode connects to Cloudflare's WARP network through usque.", links: [web('https://one.one.one.one')]},
      {name: 'Google Cast', note: 'Casting to Chromecast and Google TV devices.', links: [docs('https://developers.google.com/cast')]},
      {name: 'iptv-org', note: 'Public lists of free-to-air channels behind Free Indian channels, the World channels for each country and All countries in Live TV.', links: [gh('iptv-org/iptv'), web('https://iptv-org.github.io')]},
      {name: 'Open-EPG', note: 'Free daily TV guide files per country, used for the TV guide of World channels and Free Indian channels in Live TV.', links: [web('https://www.open-epg.com')]},
      {name: 'EPGSHARE01', note: 'Free daily TV guide files per country, used for the TV guide of World channels in Live TV where Open-EPG has none that matches.', links: [web('https://epgshare01.online')]},
      {name: 'EasyList', note: "Filter list by the EasyList authors, downloaded by the browser's ad blocker.", links: [web('https://easylist.to'), gh('easylist/easylist')]},
      {name: 'EasyPrivacy', note: "Filter list by the EasyList authors, downloaded by the browser's tracker blocker.", links: [web('https://easylist.to')]},
      {name: 'IndianList', note: "Filter list for Indian sites by its maintainers, downloaded by the browser's ad blocker.", links: [gh('mediumkreation/IndianList')]},
    ],
  },
  {
    id: 'ideas',
    title: 'Ideas and inspiration',
    shortTitle: 'Ideas',
    intro: 'These projects inspired features or design. Droid Stream uses none of their code and is not affiliated with them.',
    items: [
      {name: 'CloudStream', note: 'Open-source streaming app.', links: [gh('recloudstream/cloudstream'), web('https://recloudstream.github.io')]},
      {name: 'Nuvio', note: 'Open-source streaming app. Its script plugin format is supported.', links: [gh('NuvioMedia/NuvioMobile'), web('https://nuvio.tv')]},
      {name: 'Stremio', note: 'Add-on driven streaming.', links: [web('https://www.stremio.com')]},
      {name: 'qBittorrent', note: 'Torrent client ideas.', links: [web('https://www.qbittorrent.org'), gh('qbittorrent/qBittorrent')]},
      {name: 'LibreTorrent', note: 'Torrent client ideas.', links: [{label: 'Repository', url: 'https://gitlab.com/proninyaroslav/libretorrent'}]},
      {name: 'Transmission', note: 'Torrent client ideas.', links: [web('https://transmissionbt.com'), gh('transmission/transmission')]},
      {name: 'aMule', note: 'eD2k download ideas.', links: [web('https://www.amule.org'), gh('amule-project/amule')]},
      {name: 'pikpak-plus by Bharath Ganji', note: 'Cloud download ideas, and the base of Tordroid Plus.', links: [gh('bharathganji/pikpak-plus')]},
      {name: 'Ghost Downloader 3', note: 'Download manager ideas.', links: [gh('XiaoYouChR/Ghost-Downloader-3')]},
      {name: 'VidHub', note: 'Library ideas.', links: [{label: 'App', url: 'https://okaapps.com/product/1659622164'}]},
      {name: '1DM', note: 'Download manager and browser download detection ideas.', links: [{label: 'Play Store', url: 'https://play.google.com/store/apps/details?id=idm.internet.download.manager'}]},
      {name: 'IDM (Internet Download Manager)', note: 'Download manager ideas.', links: [web('https://www.internetdownloadmanager.com')]},
      {name: 'YTDLnis', note: 'Video downloader ideas. The Droid Stream downloader is its own code.', links: [gh('deniscerri/ytdlnis'), web('https://ytdlnis.org')]},
      {name: 'Seal', note: 'Video downloader ideas. The Droid Stream downloader is its own code.', links: [gh('JunkFood02/Seal')]},
      {name: 'SnapTube', note: 'Browser and download detection ideas. The Droid Stream browser is its own code.', links: [], noLinks: true},
      {name: 'Titanium Browser', note: 'Browser ideas. The Droid Stream browser is its own code.', links: [gh('jqssun/android-titanium-browser')]},
      {name: 'Morphe', note: 'Feature ideas.', links: [web('https://morphe.software'), gh('MorpheApp/morphe-manager')]},
      {name: 'Netflix', note: 'Browsing and design ideas.', links: [web('https://www.netflix.com')]},
    ],
  },
];

const npm = (name: string): CreditLink => ({label: 'Repository', url: `https://github.com/${name}`});

/** Every third-party component in the app, with its licence. */
export const LICENSE_SECTION: CreditSection = {
  id: 'licences',
  title: 'Open-source licences',
  shortTitle: 'Licences',
  intro: 'Each part keeps its own licence. Packages they depend on keep theirs too.',
  items: [
    {
      name: 'Vega',
      note: 'Droid Stream is a noncommercial fork of Vega and keeps its licence.',
      license: 'PolyForm Noncommercial 1.0.0',
      notice: VEGA_REQUIRED_NOTICE,
      links: [gh('vega-org/vega-app'), {label: 'Licence', url: 'https://github.com/1tordroid/Droid-Stream/blob/main/LICENSE'}],
    },
    {name: 'Inter font', license: 'OFL-1.1', note: 'The app font, by The Inter Project Authors. The license ships with the font files.', links: [gh('rsms/inter')]},
    {name: 'libVLC', license: 'LGPL-2.1', note: 'Linked dynamically through react-native-vlc-media-player for the optional VLC engine. Droid Stream does not modify libVLC.', links: [web('https://www.videolan.org/vlc/libvlc.html')]},
    {name: 'VLC for Android media library', license: 'LGPL-2.1', note: 'The native media library used by the VLC engine. Source is available from VideoLAN.', links: [{label: 'Repository', url: 'https://code.videolan.org/videolan/vlc-android'}, web('https://www.videolan.org')]},
    {name: 'react-native-vlc-media-player', license: 'MIT', note: 'Connects libVLC to the app.', links: [npm('razorRun/react-native-vlc-media-player')]},
    {name: 'libtorrent and libtorrent4j', license: 'BSD-3-Clause', note: 'One shared session for direct playback and the Torrents tab. Droid Stream does not copy GPL torrent-client code.', links: [gh('arvidn/libtorrent'), gh('aldenml/libtorrent4j')]},
    {name: 'NanoHTTPD', license: 'BSD', note: 'Serves a torrent file to the on-device player at 127.0.0.1 only.', links: [gh('NanoHttpd/nanohttpd')]},
    {name: 'OkHttp', license: 'Apache-2.0', note: 'HTTP client used for segmented downloads and DNS over HTTPS.', links: [gh('lysine-dev/okhttp'), web('https://lysine.dev/okhttp/')]},
    {name: 'smbj', license: 'Apache-2.0', note: 'SMB browsing. Credentials are kept in an encrypted on-device store.', links: [gh('hierynomus/smbj')]},
    {name: 'Bouncy Castle', license: 'MIT', note: 'MD4 hashing for eD2k downloads.', links: [gh('bcgit/bc-java')]},
    {name: 'Apache Commons Net', license: 'Apache-2.0', note: 'FTP and FTPS downloads. By The Apache Software Foundation.', links: [gh('apache/commons-net')]},
    {name: 'yt-dlp', license: 'Unlicense', note: "The video downloader. Droid Stream ships one release and can update it from GitHub. It runs unchanged; the bridge around it is Droid Stream's own code.", links: [gh('yt-dlp/yt-dlp')]},
    {name: 'yt-dlp-ejs', license: 'Unlicense, with meriyah (ISC) and astring (MIT)', note: "The YouTube challenge solver bundled with yt-dlp. It runs in Android's JavaScript sandbox.", links: [gh('yt-dlp/ejs')]},
    {name: 'Python (CPython)', license: 'PSF-2.0', note: 'Runs yt-dlp inside the app. Copyright (c) 2001 Python Software Foundation; All Rights Reserved.', links: [web('https://www.python.org')]},
    {name: 'Chaquopy', license: 'MIT', note: 'Builds Python into the app and connects it to Kotlin.', links: [gh('chaquo/chaquopy')]},
    {name: 'Libraries in the Python build', license: 'OpenSSL: Apache-2.0; SQLite: public domain; libffi: MIT; bzip2: BSD-style; xz: 0BSD', note: "Parts of Python's standard library, as built by Chaquopy.", links: [gh('chaquo/chaquopy')]},
    {name: 'FFmpeg through FFmpegKit', license: 'LGPL-3.0 (FFmpeg) and LGPL-3.0 (FFmpegKit)', note: 'Merges, converts and cuts what yt-dlp downloads, and remuxes MKV for casting. Linked dynamically from ffmpeg-kit-https.', links: [web('https://ffmpeg.org'), gh('ffmpegkit-maintained/ffmpeg')]},
    {name: 'Jetpack JavaScript Engine (androidx.javascriptengine)', license: 'Apache-2.0', note: 'Runs the YouTube challenge solver in an isolated process.', links: [docs('https://developer.android.com/jetpack/androidx/releases/javascriptengine')]},
    {name: 'AndroidX WebKit', license: 'Apache-2.0', note: 'Passkey support in the browser.', links: [docs('https://developer.android.com/jetpack/androidx/releases/webkit')]},
    {name: 'AndroidX DocumentFile', license: 'Apache-2.0', note: 'Reads and writes folders you pick.', links: [docs('https://developer.android.com/jetpack/androidx/releases/documentfile')]},
    {name: 'AndroidX Media3', license: 'Apache-2.0', note: 'ExoPlayer playback, the player UI and video thumbnails.', links: [gh('androidx/media')]},
    {name: 'usque', license: 'MIT', note: 'Cloudflare WARP client, built from source and run as its own process.', links: [gh('Diniboy1123/usque')]},
    {name: 'ByeDPI', license: 'MIT', note: 'Built from source and run as its own process.', links: [gh('hufrea/byedpi')]},
    {name: 'MMKV', license: 'BSD-3-Clause', note: 'On-device storage by Tencent. Its license file lists the third-party parts it includes.', links: [gh('Tencent/MMKV')]},
    {name: 'jiotv_go by the jiotv-go project', license: 'CC-BY-4.0', note: 'The JioTV source in Live TV adapts its sign-in, token renewal, channel list and stream request logic, rewritten in TypeScript and changed to run inside the app. Not affiliated with Jio.', links: [gh('JioTV-Go/jiotv_go')]},
    {name: 'EasyList, EasyPrivacy and IndianList', license: 'GPL-3.0 or CC BY-SA 3.0 (dual licensed)', note: "Filter lists for the browser's ad and tracker blocker, by the EasyList authors and the IndianList maintainers. The app downloads them from easylist.to and easylist-downloads.adblockplus.org; they are not shipped with it. The blocker that reads them is Droid Stream's own code.", links: [web('https://easylist.to'), gh('mediumkreation/IndianList')]},
    {name: 'React', license: 'MIT', note: 'react and react-dom.', links: [npm('react/react'), web('https://react.dev')]},
    {name: 'React Native for TV (react-native-tvos)', license: 'MIT', note: 'The app framework.', links: [npm('react-native-tvos/react-native-tvos')]},
    {name: 'Expo and Expo modules', license: 'MIT', note: 'expo, @expo/metro-runtime, @expo/ui, expo-application, expo-blur, expo-brightness, expo-build-properties, expo-camera, expo-clipboard, expo-constants, expo-crypto, expo-document-picker, expo-file-system, expo-font, expo-intent-launcher, expo-navigation-bar, expo-status-bar, expo-system-ui and expo-video-thumbnails.', links: [npm('expo/expo'), docs('https://docs.expo.dev')]},
    {name: '@expo/vector-icons', license: 'MIT', note: 'App icons.', links: [npm('expo/vector-icons')]},
    {name: 'React Navigation', license: 'MIT', note: '@react-navigation/native, bottom-tabs, native-stack and react-native-drawer-layout.', links: [npm('react-navigation/react-navigation'), web('https://reactnavigation.org')]},
    {name: 'react-native-reanimated and react-native-worklets', license: 'MIT', note: 'Animations. By Software Mansion.', links: [npm('software-mansion/react-native-reanimated')]},
    {name: 'react-native-gesture-handler', license: 'MIT', note: 'Touch gestures. By Software Mansion.', links: [npm('software-mansion/react-native-gesture-handler')]},
    {name: 'react-native-screens', license: 'MIT', note: 'Native screens. By Software Mansion.', links: [npm('software-mansion/react-native-screens')]},
    {name: 'react-native-svg', license: 'MIT', note: 'Vector graphics. By Software Mansion.', links: [npm('software-mansion/react-native-svg')]},
    {name: 'react-native-video', license: 'MIT', note: 'The built-in player.', links: [npm('TheWidlarzGroup/react-native-video')]},
    {name: 'react-native-webview', license: 'MIT', note: 'The browser and sign-in pages.', links: [npm('react-native-webview/react-native-webview')]},
    {name: 'react-native-webrtc', license: 'MIT', note: 'Secure media delivery when casting.', links: [npm('react-native-webrtc/react-native-webrtc')]},
    {name: 'react-native-google-cast', license: 'MIT', note: 'Casting to Chromecast and Google TV.', links: [npm('react-native-google-cast/react-native-google-cast')]},
    {name: 'react-native-mmkv-storage', license: 'MIT', note: 'Connects MMKV to the app.', links: [npm('ammarahm-ed/react-native-mmkv-storage')]},
    {name: 'Notifee (@notifee/react-native)', license: 'Apache-2.0', note: 'Notifications.', links: [npm('invertase/notifee')]},
    {name: 'FlashList', license: 'MIT', note: 'Fast lists. By Shopify.', links: [npm('Shopify/flash-list')]},
    {name: 'TanStack Query', license: 'MIT', note: 'Loading and caching data.', links: [npm('TanStack/query')]},
    {name: 'zustand', license: 'MIT', note: 'App state.', links: [npm('pmndrs/zustand')]},
    {name: 'axios', license: 'MIT', note: 'HTTP requests.', links: [npm('axios/axios')]},
    {name: 'cheerio', license: 'MIT', note: 'Reads web pages.', links: [npm('cheeriojs/cheerio')]},
    {name: 'tldts', license: 'MIT', note: 'Reads domain names.', links: [npm('remusao/tldts')]},
    {name: 'base64-js and buffer', license: 'MIT', note: 'Binary data helpers.', links: [npm('beatgammit/base64-js'), npm('feross/buffer')]},
    {name: 'NativeWind and react-native-css-interop', license: 'MIT', note: 'Styling.', links: [npm('nativewind/nativewind')]},
    {name: '@dr.pogodin/react-native-fs', license: 'MIT', note: 'File access.', links: [npm('birdofpreyru/react-native-fs')]},
    {name: '@gorhom/bottom-sheet', license: 'MIT', note: 'Bottom sheets.', links: [npm('gorhom/react-native-bottom-sheet')]},
    {name: 'react-native-apk-installer', license: 'MIT', note: 'Installs app updates.', links: [npm('himanshu8443/react-native-apk-installer')]},
    {name: 'react-native-cookie-manager', license: 'MIT', note: 'Browser cookies.', links: [npm('Preeternal/react-native-cookie-manager')]},
    {name: 'react-native-bootsplash', license: 'MIT', note: 'Splash screen.', links: [npm('zoontek/react-native-bootsplash')]},
    {name: 'react-native-edge-to-edge', license: 'MIT', note: 'Full-screen layout.', links: [npm('zoontek/react-native-edge-to-edge')]},
    {name: 'react-native-fullscreen-chz', license: 'MIT', note: 'Full-screen player mode.', links: [npm('jasimchz/react-native-fullscreen-chz')]},
    {name: 'react-native-haptic-feedback', license: 'MIT', note: 'Vibration feedback.', links: [npm('mkuczera/react-native-haptic-feedback')]},
    {name: 'react-native-image-colors', license: 'MIT', note: 'Colours from posters.', links: [npm('osamaqarem/react-native-image-colors')]},
    {name: 'react-native-linear-gradient', license: 'MIT', note: 'Gradients.', links: [npm('react-native-linear-gradient/react-native-linear-gradient')]},
    {name: 'react-native-markdown-display', license: 'MIT', note: 'Shows release notes.', links: [npm('iamacup/react-native-markdown-display')]},
    {name: 'react-native-orientation-locker', license: 'MIT', note: 'Screen rotation.', links: [npm('wonday/react-native-orientation-locker')]},
    {name: 'react-native-safe-area-context', license: 'MIT', note: 'Screen insets.', links: [npm('appandflow/react-native-safe-area-context')]},
    {name: 'react-native-volume-manager', license: 'MIT', note: 'Player volume.', links: [npm('hirbod/react-native-volume-manager')]},
  ],
};

export const ALL_SECTIONS: CreditSection[] = [...CREDIT_SECTIONS, LICENSE_SECTION];
