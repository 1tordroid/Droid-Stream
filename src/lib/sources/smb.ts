import {NativeModules} from 'react-native';
import {mainStorage} from '../storage/StorageService';

export interface SmbEntry {
  name: string;
  directory: boolean;
  size: number;
}

/**
 * SMB playback through the loopback stream server. Off until a large MKV has
 * been played and seeked on Windows and Samba shares on a phone and a TV;
 * until then SMB sources browse but do not play.
 */
export const SMB_STREAMING = {enabled: false};

const TESTING_KEY = 'smb-playback-testing';

/**
 * "Try SMB playback (testing)" in Advanced downloads: lets the owner test SMB
 * playback on a device while SMB_STREAMING stays off for everyone. Off by default.
 */
export const isSmbPlaybackTesting = (): boolean => mainStorage.getBool(TESTING_KEY, false);
export const setSmbPlaybackTesting = (value: boolean): void => {
  mainStorage.setBool(TESTING_KEY, value);
};

/** SMB playback is on for everyone, or for this device while testing. */
const streamingOn = (): boolean => SMB_STREAMING.enabled || isSmbPlaybackTesting();

const smbModule = () => NativeModules.SmbModule;

export const listSmbShare = async (
  host: string,
  share: string,
  path: string,
  username: string,
  password: string,
): Promise<SmbEntry[]> => {
  const module = smbModule();
  if (!module?.list) {
    throw new Error('SMB needs a build that includes the local SMB module.');
  }
  return module.list(host, share, path, username, password, '');
};

/** True when this build can play SMB files. */
export const canStreamSmb = (): boolean => streamingOn() && typeof smbModule()?.openStream === 'function';

/** The path inside a share, always with one leading slash and forward slashes. */
export const normalizeSmbPath = (path: string): string =>
  `/${path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')}`;

/** A stable name for an SMB file, used for watch progress. It holds no sign-in. */
export const smbFileLink = (host: string, share: string, path: string): string =>
  `smb://${host}/${share}${normalizeSmbPath(path)}`;

const STREAM_URL = /^http:\/\/127\.0\.0\.1:\d+\/([0-9a-f]{32})\/[^/]+$/;

/** The token of a loopback stream address, or undefined for anything else. */
export const smbStreamToken = (url: string): string | undefined => STREAM_URL.exec(url)?.[1];

let lastStream: string | undefined;

/**
 * Opens an SMB file for the player and returns its loopback address. The
 * address works only on this device, only for this file, and stops working 30
 * minutes after the last read. Opening another file closes the previous one.
 */
export const openSmbStream = async (
  host: string,
  share: string,
  path: string,
  username: string,
  password: string,
): Promise<string> => {
  const module = smbModule();
  if (!streamingOn() || typeof module?.openStream !== 'function') {
    throw new Error('Playing SMB files needs a newer build. You can still browse this share.');
  }
  const url: string = await module.openStream(host, share, normalizeSmbPath(path), username, password, '');
  if (!smbStreamToken(url)) throw new Error('The SMB stream did not start.');
  const previous = lastStream;
  lastStream = url;
  if (previous && previous !== url) closeSmbStream(previous);
  return url;
};

/** Ends a stream opened by openSmbStream. Safe to call twice. */
export const closeSmbStream = (url: string): void => {
  if (lastStream === url) lastStream = undefined;
  const module = smbModule();
  if (!smbStreamToken(url) || typeof module?.closeStream !== 'function') return;
  Promise.resolve(module.closeStream(url)).catch(() => undefined);
};
