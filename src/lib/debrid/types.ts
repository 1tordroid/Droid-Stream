/**
 * Debrid and cloud-torrent services. Each person signs in with their own
 * account or API key; keys stay in encrypted storage on the device and are
 * sent only to that service. Original TypeScript, no third-party client code.
 */

export type DebridId = 'torbox' | 'realdebrid' | 'alldebrid' | 'premiumize' | 'offcloud' | 'debridlink' | 'pikpak';

export interface DebridFile {
  id: string;
  name: string;
  size: number;
  /** Ready-made direct link, when the service returns one with the listing. */
  link?: string;
}

export interface DebridTransfer {
  id: string;
  name: string;
  /** 0..1 */
  progress: number;
  ready: boolean;
  files: DebridFile[];
  status: string;
  error?: string;
}

export interface DebridAccount {
  username: string;
  premium: boolean;
  expiresAt?: number;
}

export interface DebridService {
  id: DebridId;
  name: string;
  /** Where the user gets a key. */
  keyUrl: string;
  keyHelp: string;
  /** True when the service can say "cached" before adding the torrent. */
  canCheckCache: boolean;
  account(key: string): Promise<DebridAccount>;
  /** Hash → cached. Services without a check return {}. */
  checkCached(key: string, hashes: string[]): Promise<Record<string, boolean>>;
  addMagnet(key: string, magnet: string): Promise<{id: string}>;
  /** Uploads a .torrent file by URL when the service supports it. */
  addTorrentUrl?(key: string, url: string): Promise<{id: string}>;
  status(key: string, id: string): Promise<DebridTransfer>;
  /** A direct HTTPS link the player and downloader can use. */
  fileLink(key: string, transfer: DebridTransfer, file: DebridFile): Promise<string>;
  remove?(key: string, id: string): Promise<void>;
  list?(key: string): Promise<DebridTransfer[]>;
}

export const VIDEO_FILE = /\.(mkv|mp4|avi|mov|m4v|webm|ts|wmv|flv|mpg|mpeg)$/i;
