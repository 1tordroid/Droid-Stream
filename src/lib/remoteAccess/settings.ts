/**
 * Settings for remote control, command access and browser-like connections.
 * Everything is off until the user turns it on in Settings > Advanced downloads.
 */
import {openStore} from '../storage/openStore';
import {cleanSites} from './browserLike';
import {isUsableToken, newToken} from './secret';

const storage = openStore('droid-stream-remote-access');

/** aria2's usual port, so most clients need only the address and token. */
export const DEFAULT_RPC_PORT = 6800;

/** Ports below 1024 need root on Android. */
export const isValidPort = (value: number): boolean => Number.isInteger(value) && value >= 1024 && value <= 65535;

const bool = (key: string): boolean => storage.getBool(key) === true;

/** The saved token, made once when first needed. */
const token = (key: string): string => {
  const saved = storage.getString(key);
  if (saved && isUsableToken(saved)) return saved;
  const made = newToken();
  storage.setString(key, made);
  return made;
};

export const remoteAccessSettings = {
  rpcEnabled: () => bool('rpc-enabled'),
  setRpcEnabled: (value: boolean) => storage.setBool('rpc-enabled', value),
  rpcPort: (): number => {
    const value = Number(storage.getInt('rpc-port'));
    return isValidPort(value) ? value : DEFAULT_RPC_PORT;
  },
  setRpcPort: (value: number) => {
    if (isValidPort(value)) storage.setInt('rpc-port', value);
  },
  rpcToken: () => token('rpc-token'),
  resetRpcToken: () => {
    storage.setString('rpc-token', newToken());
    return token('rpc-token');
  },
  /** Bytes per second for all downloads set with aria2.changeGlobalOption, 0 for none. */
  speedLimit: (): number => Math.max(0, Number(storage.getInt('speed-limit')) || 0),
  setSpeedLimit: (value: number) => storage.setInt('speed-limit', Math.max(0, Math.round(value))),
  commandsEnabled: () => bool('commands-enabled'),
  setCommandsEnabled: (value: boolean) => storage.setBool('commands-enabled', value),
  commandToken: () => token('command-token'),
  resetCommandToken: () => {
    storage.setString('command-token', newToken());
    return token('command-token');
  },
  browserLikeSites: (): string[] => {
    try {
      return cleanSites(JSON.parse(storage.getString('browser-like-sites') || '[]'));
    } catch {
      return [];
    }
  },
  setBrowserLikeSites: (sites: string[]) => storage.setString('browser-like-sites', JSON.stringify(cleanSites(sites))),
};
