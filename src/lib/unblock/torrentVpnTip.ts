/**
 * A one-time note the first time a torrent starts without a VPN: Smart
 * unblock covers app traffic, never torrent peers.
 */
import {mainStorage} from '../storage/StorageService';
import {SettingsKeys} from '../storage/SettingsStorage';

const listeners = new Set<() => void>();

export const isTorrentVpnTipSeen = (): boolean =>
  mainStorage.getBool(SettingsKeys.TORRENT_VPN_TIP_SEEN, false);

export const markTorrentVpnTipSeen = (): void => {
  mainStorage.setBool(SettingsKeys.TORRENT_VPN_TIP_SEEN, true);
};

/** Called when a torrent starts. Shows the note once, and only without a VPN. */
export const noteTorrentStarted = (vpnConnected: boolean): void => {
  if (vpnConnected || isTorrentVpnTipSeen()) return;
  listeners.forEach(listener => listener());
};

export const subscribeTorrentVpnTip = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
