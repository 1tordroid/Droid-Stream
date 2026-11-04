import {MMKVLoader} from 'react-native-mmkv-storage';

const storage = new MMKVLoader().withInstanceID('droid-stream-torrents').withEncryption().initialize();

export interface TorrentSettings {
  downloadRateLimit: number;
  uploadRateLimit: number;
  maxActiveDownloads: number;
  maxActiveSeeds: number;
  seedingEnabled: boolean;
  seedTimeLimitSeconds: number;
  shareRatioPercent: number;
  dht: boolean;
  lsd: boolean;
  pex: boolean;
  utp: boolean;
  encryption: number;
  proxyType: number;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
  publicTrackers: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
  pauseOnBatterySaver: boolean;
  requireVpn: boolean;
  scheduleEnabled: boolean;
  windows: {days: number[]; startMinutes: number; endMinutes: number}[];
  blocklist: string;
  rssFeeds: {id: string; url: string; keywords: string; seen: string[]}[];
  saveTreeUri: string;
  acknowledged: boolean;
}

export const defaultTorrentSettings = (): TorrentSettings => ({
  downloadRateLimit: 0,
  uploadRateLimit: 0,
  maxActiveDownloads: 3,
  maxActiveSeeds: 0,
  seedingEnabled: false,
  seedTimeLimitSeconds: 0,
  shareRatioPercent: 0,
  dht: true,
  lsd: true,
  pex: true,
  utp: true,
  encryption: 1,
  proxyType: 0,
  proxyHost: '',
  proxyPort: 0,
  proxyUsername: '',
  proxyPassword: '',
  publicTrackers: true,
  wifiOnly: true,
  chargingOnly: false,
  pauseOnBatterySaver: false,
  requireVpn: false,
  scheduleEnabled: false,
  windows: [],
  blocklist: '',
  rssFeeds: [],
  saveTreeUri: '',
  acknowledged: false,
});

const KEY = 'settings';

export const readTorrentSettings = (): TorrentSettings => {
  try {
    const raw = storage.getString(KEY);
    return raw ? {...defaultTorrentSettings(), ...JSON.parse(raw)} : defaultTorrentSettings();
  } catch {
    return defaultTorrentSettings();
  }
};

export const writeTorrentSettings = (settings: TorrentSettings): void => {
  storage.setString(KEY, JSON.stringify(settings));
};

export interface StoredTorrent {
  infoHash: string;
  source: string;
  name: string;
  savePath?: string;
  stopped?: boolean;
}

export const readStoredTorrents = (): StoredTorrent[] => {
  try {
    return JSON.parse(storage.getString('items') || '[]');
  } catch {
    return [];
  }
};

export const writeStoredTorrents = (items: StoredTorrent[]): void => {
  storage.setString('items', JSON.stringify(items));
};
