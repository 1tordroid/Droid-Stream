export interface FeatureRoute {
  tab: 'HomeStack' | 'SearchStack' | 'TorrentsStack' | 'WatchListStack' | 'SettingsStack';
  screen?: string;
  params?: Record<string, string>;
}

export interface FeatureEntry {
  id: string;
  title: string;
  keywords: string[];
  category: string;
  subtitle: string;
  icon: string;
  advanced?: boolean;
  route: FeatureRoute;
}

export const FEATURES: FeatureEntry[] = [
  {id: 'home', title: 'Home', keywords: ['vega', 'providers', 'catalog'], category: 'Browse', subtitle: 'Provider home', icon: 'home-variant', route: {tab: 'HomeStack'}},
  {id: 'search-content', title: 'Search providers', keywords: ['find', 'titles'], category: 'Browse', subtitle: 'Search the providers you added', icon: 'magnify', route: {tab: 'SearchStack'}},
  {id: 'search-features', title: 'Search settings and features', keywords: ['commands', 'where is'], category: 'Browse', subtitle: 'Jump to any setting', icon: 'feature-search-outline', route: {tab: 'SearchStack', params: {mode: 'features'}}},
  {id: 'torrents', title: 'Torrents', keywords: ['magnet', 'bittorrent', 'torrent'], category: 'Torrents', subtitle: 'Add a magnet or torrent file', icon: 'magnet', route: {tab: 'TorrentsStack', screen: 'Torrents'}},
  {id: 'torrent-search', title: 'Search torrent sites', keywords: ['torrent search', 'find torrent', '1337x', 'pirate bay', 'tpb', 'yts', 'eztv', 'nyaa', 'knaben', 'torrentgalaxy', 'limetorrents', 'trending', 'magnet search'], category: 'Torrents', subtitle: 'Search many sites at once, with filters and trending', icon: 'magnify', route: {tab: 'TorrentsStack', screen: 'TorrentSearch'}},
  {id: 'torrent-sites', title: 'Torrent sites and mirrors', keywords: ['sites', 'mirror', 'domain', 'custom site', 'adapter', 'jackett', 'prowlarr', 'torznab', 'import adapter'], category: 'Torrents', subtitle: 'Turn sites on or off, add your own, Jackett or Prowlarr', icon: 'web', route: {tab: 'TorrentsStack', screen: 'TorrentSources'}},
  {id: 'debrid', title: 'Debrid and cloud', keywords: ['debrid', 'torbox', 'real-debrid', 'realdebrid', 'alldebrid', 'premiumize', 'offcloud', 'debrid-link', 'pikpak', 'cache', 'cached', 'instant'], category: 'Torrents', subtitle: 'Play cached torrents instantly with your own account', icon: 'lightning-bolt', route: {tab: 'TorrentsStack', screen: 'DebridSettings'}},
  {id: 'torrent-bookmarks', title: 'Saved torrents', keywords: ['bookmark', 'favorites', 'saved', 'watch later'], category: 'Torrents', subtitle: 'Torrents you saved from search', icon: 'bookmark', route: {tab: 'TorrentsStack', screen: 'TorrentSearch'}},
  {id: 'stream-finder', title: 'Find streams', keywords: ['play best', 'auto play', 'best source', 'stremio', 'torrentio', 'find movie', 'watch'], category: 'Torrents', subtitle: 'Add-ons, torrent sites, and debrid caches in one list', icon: 'play-network', route: {tab: 'TorrentsStack', screen: 'StreamFinder'}},
  {id: 'stremio-addons', title: 'Stremio add-ons and plugins', keywords: ['stremio', 'nuvio', 'plugin', 'script plugin', 'addon', 'add-on', 'torrentio', 'comet', 'mediafusion', 'opensubtitles', 'cinemeta', 'manifest'], category: 'Torrents', subtitle: 'Torrentio, Comet, MediaFusion, and more', icon: 'puzzle', route: {tab: 'TorrentsStack', screen: 'StremioAddons'}},
  {id: 'torrent-speed', title: 'Torrent speed limit', keywords: ['speed limit', 'bandwidth', 'throttle', 'upload', 'download limit'], category: 'Torrents', subtitle: 'Global and per-torrent limits', icon: 'speedometer', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-scheduler', title: 'Torrent scheduler', keywords: ['schedule', 'start time', 'stop time', 'wifi only', 'charging'], category: 'Torrents', subtitle: 'When torrents are allowed to run', icon: 'calendar-clock', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-proxy', title: 'Torrent proxy', keywords: ['socks5', 'socks', 'http proxy', 'proxy'], category: 'Torrents', subtitle: 'SOCKS5 or HTTP proxy', icon: 'server-network', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-vpn', title: 'VPN bind and kill switch', keywords: ['vpn', 'kill switch', 'interface', 'bind'], category: 'Torrents', subtitle: 'Pause if the VPN drops', icon: 'vpn', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-trackers', title: 'Trackers', keywords: ['tracker', 'public trackers', 'announce'], category: 'Torrents', subtitle: 'Tracker list and public tracker auto-add', icon: 'radar', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-encryption', title: 'Torrent encryption', keywords: ['encryption', 'pe', 'protocol encryption', 'utp', 'dht', 'pex', 'lsd'], category: 'Torrents', subtitle: 'Encryption, DHT, PEX, LSD, and uTP', icon: 'lock', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-blocklist', title: 'IP blocklist', keywords: ['ip filter', 'blocklist', 'ban', 'ip'], category: 'Torrents', subtitle: 'Block peer address ranges', icon: 'ip-network', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-rss', title: 'Torrent RSS', keywords: ['rss', 'feed', 'auto download'], category: 'Torrents', subtitle: 'Optional feeds you add yourself', icon: 'rss', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-create', title: 'Create torrent', keywords: ['create torrent', 'make torrent', '.torrent'], category: 'Torrents', subtitle: 'Build a torrent from files on this device', icon: 'file-plus', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'torrent-seeding', title: 'Seeding limits', keywords: ['seed', 'ratio', 'share ratio'], category: 'Torrents', subtitle: 'Seeding stays off until you enable it', icon: 'sprout', advanced: true, route: {tab: 'TorrentsStack', screen: 'TorrentOptions'}},
  {id: 'library', title: 'Library', keywords: ['saved', 'watchlist', 'my list'], category: 'Library', subtitle: 'Saved titles, device videos, and network sources', icon: 'bookmark', route: {tab: 'WatchListStack', screen: 'LibraryHome'}},
  {id: 'library-device', title: 'Videos on this device', keywords: ['local', 'poster', 'folder', 'files'], category: 'Library', subtitle: 'Poster library for videos on this device', icon: 'movie-open', route: {tab: 'WatchListStack', screen: 'LocalLibrary'}},
  {id: 'network-library', title: 'Poster library for your sources', keywords: ['poster library', 'network library', 'movies and shows', 'scan', 'rescan', 'infuse', 'vidhub', 'webdav library', 'library folder'], category: 'Library', subtitle: 'Movies, Shows, Other and Folders for WebDAV, SMB and device folders', icon: 'view-grid', route: {tab: 'WatchListStack', screen: 'LibraryHome'}},
  {id: 'library-fix-match', title: 'Fix a wrong poster or title', keywords: ['fix match', 'wrong poster', 'wrong title', 'wrong movie', 'artwork', 'match', 'identify'], category: 'Library', subtitle: 'Long-press a title in a source, or use the menu on its page', icon: 'image-edit', route: {tab: 'WatchListStack', screen: 'LibraryHome'}},
  {id: 'source-smb', title: 'SMB source', keywords: ['smb', 'nas', 'samba', 'share', 'windows share'], category: 'Library', subtitle: 'Add a network share', icon: 'folder-network', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'smb'}}},
  {id: 'source-webdav', title: 'WebDAV source', keywords: ['webdav', 'nas', 'cloud folder'], category: 'Library', subtitle: 'Add a WebDAV folder', icon: 'cloud', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'webdav'}}},
  {id: 'source-jellyfin', title: 'Jellyfin', keywords: ['jellyfin', 'media server'], category: 'Library', subtitle: 'Sign in to Jellyfin', icon: 'play-box-multiple', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'jellyfin'}}},
  {id: 'source-emby', title: 'Emby', keywords: ['emby', 'media server'], category: 'Library', subtitle: 'Sign in to Emby', icon: 'play-box', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'emby'}}},
  {id: 'source-plex', title: 'Plex', keywords: ['plex', 'media server'], category: 'Library', subtitle: 'Sign in to Plex', icon: 'plex', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'plex'}}},
  {id: 'source-pikpak', title: 'PikPak', keywords: ['pikpak', 'magnet', 'cloud download'], category: 'Library', subtitle: 'Send a magnet to your PikPak account', icon: 'cloud-download', route: {tab: 'WatchListStack', screen: 'Sources', params: {kind: 'pikpak'}}},
  {id: 'downloads', title: 'Downloads', keywords: ['download', 'queue', 'files'], category: 'Downloads', subtitle: 'Progress, pause, and completed files', icon: 'download', route: {tab: 'SettingsStack', screen: 'DownloadsStack'}},
  {id: 'download-connections', title: 'Download connections', keywords: ['connections', 'threads', 'segments', 'idm', 'parallel'], category: 'Downloads', subtitle: '1 to 32 connections, default 8', icon: 'lan', advanced: true, route: {tab: 'SettingsStack', screen: 'Preferences'}},
  {id: 'download-speed', title: 'Download speed limit', keywords: ['speed limit', 'idm', 'bandwidth', 'throttle'], category: 'Downloads', subtitle: 'Global and per-download limits', icon: 'speedometer', advanced: true, route: {tab: 'SettingsStack', screen: 'Preferences'}},
  {id: 'download-scheduler', title: 'Download scheduler', keywords: ['scheduler', 'schedule', 'wifi only', 'charging', 'idm'], category: 'Downloads', subtitle: 'Start and stop times', icon: 'calendar-clock', advanced: true, route: {tab: 'SettingsStack', screen: 'Preferences'}},
  {id: 'download-hls', title: 'HLS and DASH downloads', keywords: ['m3u8', 'hls', 'dash', 'mpd', 'quality'], category: 'Downloads', subtitle: 'Choose a stream quality before saving', icon: 'movie-roll', advanced: true, route: {tab: 'SettingsStack', screen: 'DownloadsStack'}},
  {id: 'social-downloads', title: 'Photos from social posts', keywords: ['instagram photo', 'carousel', 'stories', 'highlights', 'profile picture', 'reels cover', 'photo with song', 'instagram music', 'pinterest', 'reddit', 'tumblr', 'threads', 'facebook photo', 'twitter photo', 'x photo', 'save image'], category: 'Downloads', subtitle: 'Photos, carousels, stories and songs from Instagram, X, Reddit and more', icon: 'image-multiple-outline', route: {tab: 'SettingsStack', screen: 'DownloadsStack'}},
  {id: 'download-clipboard', title: 'Clipboard link grabber', keywords: ['clipboard', 'copied link', 'grabber', 'share'], category: 'Downloads', subtitle: 'Ask before saving a copied link', icon: 'clipboard-text', advanced: true, route: {tab: 'SettingsStack', screen: 'Preferences'}},
  {id: 'advanced-downloads', title: 'Advanced downloads', keywords: ['ftp', 'ftps', 'mirror', 'github mirror', 'hugging face', 'huggingface', 'expired link', 'renew link', 'record', 'recording format'], category: 'Downloads', subtitle: 'FTP, mirrors, link renewal and recording', icon: 'download-network-outline', advanced: true, route: {tab: 'SettingsStack', screen: 'AdvancedDownloads'}},
  {id: 'download-ed2k', title: 'eD2k downloads', keywords: ['ed2k', 'emule', 'edonkey', 'p2p', 'server.met'], category: 'Downloads', subtitle: 'Off by default', icon: 'lan-connect', advanced: true, route: {tab: 'SettingsStack', screen: 'Preferences'}},
  {id: 'download-checksum', title: 'Download checksum', keywords: ['md5', 'sha-256', 'sha256', 'checksum', 'verify'], category: 'Downloads', subtitle: 'Verify a finished file', icon: 'check-decagram', advanced: true, route: {tab: 'SettingsStack', screen: 'DownloadsStack'}},
  {id: 'languages', title: 'Audio and subtitle languages', keywords: ['language', 'audio language', 'subtitle language', 'preferred language', 'dub', 'dubbed', 'hindi', 'english', 'secondary language', 'forced subtitles'], category: 'Player', subtitle: 'Primary and secondary audio and subtitle languages', icon: 'translate', route: {tab: 'SettingsStack', screen: 'Languages'}},
  {id: 'profiles', title: 'Profiles', keywords: ['profile', 'profiles', 'kids', 'kids mode', 'parental', 'pin', 'lock', 'switch profile', 'family', 'user'], category: 'Settings', subtitle: 'Switch, add, lock or make a kids profile', icon: 'account-multiple', route: {tab: 'SettingsStack', screen: 'Profiles'}},
  {id: 'watch-sync', title: 'Watch sync', keywords: ['trakt', 'simkl', 'anilist', 'scrobble', 'history', 'sync', 'aniskip', 'skip intro anime', 'myanimelist', 'mal'], category: 'Settings', subtitle: 'Trakt, Simkl, AniList, and AniSkip', icon: 'sync', route: {tab: 'SettingsStack', screen: 'WatchSync'}},
  {id: 'advanced-mode', title: 'Advanced mode', keywords: ['simple mode', 'more options', 'advanced'], category: 'Settings', subtitle: 'Show every extra control', icon: 'tune-variant', route: {tab: 'SettingsStack', screen: 'Settings'}},
  {id: 'appearance', title: 'Appearance', keywords: ['theme', 'color', 'gold', 'icon', 'dark', 'amoled', 'black'], category: 'Settings', subtitle: 'Accent and launcher icon', icon: 'palette', route: {tab: 'SettingsStack', screen: 'Appearance'}},
  {id: 'player-engine', title: 'Player engine', keywords: ['player engine', 'vlc', 'built-in', 'exoplayer'], category: 'Player', subtitle: 'Built-in player or VLC', icon: 'play-circle', advanced: true, route: {tab: 'SettingsStack', screen: 'PlayerSettings'}},
  {id: 'subtitles', title: 'Subtitle style', keywords: ['subtitle size', 'subtitles', 'captions', 'font'], category: 'Player', subtitle: 'Size, color, and placement', icon: 'subtitles', advanced: true, route: {tab: 'SettingsStack', screen: 'SubTitlesPreferences'}},
  {id: 'extensions', title: 'Provider extensions', keywords: ['extensions', 'vega providers', 'plugins', 'source'], category: 'Settings', subtitle: 'Install and update providers', icon: 'puzzle', route: {tab: 'SettingsStack', screen: 'Extensions'}},
  {id: 'updates', title: 'App updates', keywords: ['update', 'version', 'upgrade'], category: 'Settings', subtitle: 'In-app updater', icon: 'update', route: {tab: 'SettingsStack', screen: 'About'}},
  {id: 'support', title: 'Telegram support', keywords: ['telegram support', 'support', 'tordroid', 'help'], category: 'Settings', subtitle: 'Message Tordroid', icon: 'send', route: {tab: 'SettingsStack', screen: 'About'}},
  {id: 'credits', title: 'Credits', keywords: ['credits', 'thanks', 'vega', 'stremio', 'cloudstream', 'nuvio'], category: 'Settings', subtitle: 'Projects behind Droid Stream', icon: 'heart-outline', route: {tab: 'SettingsStack', screen: 'Credits'}},
  {id: 'video-downloader', title: 'Video downloader', keywords: ['yt-dlp', 'ytdlp', 'youtube-dl', 'youtube download', 'download video', 'download from link', 'instagram', 'twitter', 'x.com', 'tiktok', 'mp3', 'audio', 'sponsorblock', 'cookies', 'playlist'], category: 'Settings', subtitle: 'yt-dlp version, updates, formats and cookies', icon: 'youtube', route: {tab: 'SettingsStack', screen: 'YtdlSettings'}},
  {id: 'licenses', title: 'Open-source licenses', keywords: ['license', 'libtorrent', 'vlc', 'notice'], category: 'Settings', subtitle: 'Third-party licenses', icon: 'scale-balance', route: {tab: 'SettingsStack', screen: 'OpenSourceLicenses'}},
  {id: 'data', title: 'Data management', keywords: ['backup', 'cache', 'sync', 'watch progress'], category: 'Settings', subtitle: 'Backups, cache, and sync', icon: 'database', route: {tab: 'SettingsStack', screen: 'DataManagement'}},
];

const normalize = (value: string): string =>
  value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const levenshtein = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = Array.from({length: right.length + 1}, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = saved;
    }
  }
  return row[right.length];
};

const tokenScore = (query: string, text: string): number => {
  if (!query || !text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  if (text.includes(query)) return 60;
  const limit = query.length >= 8 ? 2 : 1;
  if (query.length >= 4 && text.length >= 4 && levenshtein(query, text) <= limit) return 50;
  return 0;
};

export interface FeatureHit {
  entry: FeatureEntry;
  score: number;
}

/** Fuzzy, typo-tolerant search across titles, categories, and synonyms. */
export const searchFeatures = (query: string, entries: FeatureEntry[] = FEATURES): FeatureHit[] => {
  const tokens = normalize(query).split(' ').filter(token => token.length > 1 || token.length === 1 && query.trim().length === 1);
  if (!tokens.length) return [];
  const hits: FeatureHit[] = [];
  for (const entry of entries) {
    const haystack = [entry.title, entry.category, entry.subtitle, ...entry.keywords].map(normalize);
    let score = 0;
    for (const token of tokens) {
      let best = 0;
      for (const field of haystack) {
        best = Math.max(best, tokenScore(token, field));
        for (const word of field.split(' ')) best = Math.max(best, tokenScore(token, word));
      }
      if (best === 0) {
        score = 0;
        break;
      }
      score += best;
    }
    if (score > 0) hits.push({entry, score});
  }
  return hits.sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title));
};
