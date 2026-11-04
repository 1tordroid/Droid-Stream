import {NativeModules, Platform} from 'react-native';

const {TorrentModule, TorrentClientModule, HttpDownloadModule} = NativeModules;

export interface TorrentFile {
  index: number;
  name: string;
  path: string;
  size: number;
}

export interface TorrentAddResult {
  infoHash: string;
  state: string;
  hasMetadata: boolean;
  name?: string;
  totalSize?: number;
  files?: TorrentFile[];
}

export interface TorrentStats {
  state: string;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  numPeers: number;
  numSeeds: number;
  totalDone: number;
  totalWanted: number;
  hasMetadata: boolean;
}

export interface TorrentCompleteResult {
  success: boolean;
  outputPath: string;
  fileName: string;
  size: number;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_BTIH = /(xt(?:\.\d+)?=urn:btih:)([a-z2-7]{32})(?=[&#]|$)/gi;

/** Decodes an RFC 4648 base32 string (no padding) to lowercase hex. */
export function base32ToHex(input: string): string {
  let bits = 0;
  let value = 0;
  let hex = '';
  for (const char of input.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((value >>> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

/**
 * The native module only recognizes 40-char hex info hashes, so base32
 * btih magnets are rewritten to hex. Anything else is returned unchanged.
 */
export function normalizeMagnetLink(magnetOrUrl: string): string {
  if (!/^magnet:/i.test(magnetOrUrl)) {
    return magnetOrUrl;
  }
  return magnetOrUrl.replace(
    BASE32_BTIH,
    (_match, prefix: string, hash: string) => prefix + base32ToHex(hash),
  );
}

class TorrentManager {
  private streamPort: number | null = null;
  private isInitialized = false;

  async isOnWifi(): Promise<boolean> {
    if (Platform.OS !== 'android' || !TorrentModule?.isOnWifi) return true;
    return Boolean(await TorrentModule.isOnWifi());
  }

  async init(): Promise<void> {
    if (Platform.OS !== 'android') {
      throw new Error('Torrent streaming is only supported on Android');
    }
    if (this.isInitialized) {
      return;
    }

    try {
      const result = await TorrentModule.initEngine();
      this.streamPort = result.streamPort;
      this.isInitialized = true;
      console.log('TorrentManager initialized, stream port:', this.streamPort);
    } catch (error) {
      console.error('Failed to init TorrentModule:', error);
      throw error;
    }
  }

  async addTorrent(
    magnetOrUrl: string,
    options?: {output_folder?: string; file_name?: string},
  ): Promise<TorrentAddResult> {
    await this.init();
    return await TorrentModule.addTorrent(
      normalizeMagnetLink(magnetOrUrl),
      options?.output_folder || null,
      options?.file_name || null,
    );
  }

  async getStats(infoHash: string): Promise<TorrentStats> {
    await this.init();
    return await TorrentModule.getStats(infoHash);
  }

  async getFiles(infoHash: string): Promise<TorrentFile[]> {
    await this.init();
    return await TorrentModule.getFiles(infoHash);
  }

  /**
   * Prioritizes the pieces a player reads first. [resuming] skips the opening
   * minutes, since playback starts mid-file. Without [fullDownload], only about
   * a minute ahead of playback downloads.
   */
  async prepareVideoFile(
    infoHash: string,
    fileIndex = 0,
    resuming = false,
    fullDownload = true,
  ): Promise<boolean> {
    await this.init();
    return await TorrentModule.prepareVideoFile(
      infoHash,
      fileIndex,
      resuming,
      fullDownload,
    );
  }

  /** Lets the stream server size its one-minute buffer from the video bitrate. */
  async setStreamDuration(
    infoHash: string,
    durationSeconds: number,
  ): Promise<void> {
    await this.init();
    await TorrentModule.setStreamDuration(infoHash, durationSeconds);
  }

  async getStreamUrl(infoHash: string, fileIndex = 0): Promise<string> {
    await this.init();
    return await TorrentModule.getStreamUrl(infoHash, fileIndex);
  }

  async pauseTorrent(infoHash: string): Promise<void> {
    await this.init();
    await TorrentModule.pauseTorrent(infoHash);
  }

  async resumeTorrent(infoHash: string): Promise<void> {
    await this.init();
    await TorrentModule.resumeTorrent(infoHash);
  }

  async completeTorrent(infoHash: string): Promise<TorrentCompleteResult> {
    await this.init();
    return await TorrentModule.completeTorrent(infoHash);
  }

  async deleteTorrent(infoHash: string, deleteFiles = true): Promise<void> {
    await this.init();
    await TorrentModule.deleteTorrent(infoHash, deleteFiles);
  }

  async applySettings(settings: Record<string, string | number | boolean>): Promise<void> {
    await this.init();
    await TorrentClientModule.applySettings(settings);
  }

  async enqueue(source: string, savePath?: string): Promise<{infoHash: string; name?: string; hasMetadata: boolean}> {
    await this.init();
    return TorrentClientModule.enqueue(source, savePath || null);
  }

  async listTorrents(): Promise<TorrentRow[]> {
    await this.init();
    return TorrentClientModule.listTorrents();
  }

  async getDetails(infoHash: string): Promise<TorrentDetails> {
    await this.init();
    return TorrentClientModule.getDetails(infoHash);
  }

  async setFilePriorities(infoHash: string, priorities: number[]): Promise<void> {
    await this.init();
    await TorrentClientModule.setFilePriorities(infoHash, priorities);
  }

  async setSequential(infoHash: string, enabled: boolean): Promise<void> {
    await this.init();
    await TorrentClientModule.setSequential(infoHash, enabled);
  }

  async setLimits(infoHash: string, download: number, upload: number): Promise<void> {
    await this.init();
    await TorrentClientModule.setLimits(infoHash, download, upload);
  }

  async setStopped(infoHash: string, stopped: boolean): Promise<void> {
    await this.init();
    await TorrentClientModule.setStopped(infoHash, stopped);
  }

  async setTrackers(infoHash: string, urls: string[]): Promise<void> {
    await this.init();
    await TorrentClientModule.setTrackers(infoHash, urls);
  }

  async moveStorage(infoHash: string, path: string): Promise<void> {
    await this.init();
    await TorrentClientModule.moveStorage(infoHash, path);
  }

  async createTorrent(path: string, trackers: string[], comment: string, outputPath: string): Promise<string> {
    await this.init();
    return TorrentClientModule.createTorrent(path, trackers, comment, outputPath);
  }

  async applyBlocklist(text: string): Promise<{applied: boolean; ranges: number; reason: string}> {
    await this.init();
    return TorrentClientModule.applyBlocklist(text);
  }

  async setTransfersAllowed(allowed: boolean): Promise<void> {
    await this.init();
    await TorrentClientModule.setTransfersAllowed(allowed);
  }

  async networkStatus(): Promise<NetworkStatus> {
    if (TorrentClientModule?.networkStatus) return TorrentClientModule.networkStatus();
    if (HttpDownloadModule?.networkPolicy) {
      const status = await HttpDownloadModule.networkPolicy();
      return {...status, vpnAddress: ''};
    }
    return {wifi: true, charging: true, vpn: false, powerSave: false, vpnAddress: ''};
  }

  async consumeLaunchIntent(): Promise<{kind: 'magnet' | 'torrent' | 'http'; value: string} | null> {
    return (await TorrentClientModule?.consumeLaunchIntent?.()) || null;
  }

  async readClipboard(): Promise<string> {
    return (await TorrentClientModule?.readClipboard?.()) || '';
  }

  async exportToFolder(infoHash: string, treeUri: string): Promise<number> {
    await this.init();
    return TorrentClientModule.exportToFolder(infoHash, treeUri);
  }
}

export interface TorrentRow {
  infoHash: string;
  name: string;
  state: string;
  paused: boolean;
  stopped: boolean;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  numPeers: number;
  numSeeds: number;
  totalDone: number;
  totalWanted: number;
  allTimeDownload: number;
  allTimeUpload: number;
  hasMetadata: boolean;
  savePath?: string;
}

export interface TorrentDetails extends TorrentRow {
  peers: {address: string; client: string; progress: number; downSpeed: number; upSpeed: number}[];
  trackers: {url: string; tier: number; verified: boolean}[];
  files?: {index: number; name: string; path: string; size: number; progress: number; priority: number}[];
  pieces?: string;
  sequential?: boolean;
}

export interface NetworkStatus {
  wifi: boolean;
  charging: boolean;
  vpn: boolean;
  powerSave: boolean;
  vpnAddress: string;
}

export const torrentManager = new TorrentManager();
