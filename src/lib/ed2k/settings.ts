import {openStore} from '../storage/openStore';

/** eD2k is off unless the user turns it on in Settings. */
const storage = openStore('droid-stream-ed2k');

const ENABLED_KEY = 'enabled';
const SERVERS_KEY = 'servers';

/** The server list eMule users commonly import. Used when no servers are saved yet. */
export const DEFAULT_SERVER_LIST_URL = 'http://upd.emule-security.org/server.met';

export interface Ed2kServer {
  host: string;
  port: number;
  name?: string;
}

export const serverKey = (server: Pick<Ed2kServer, 'host' | 'port'>): string =>
  `${server.host.toLowerCase()}:${server.port}`;

export const isEd2kEnabled = (): boolean => storage.getBool(ENABLED_KEY) === true;

export const setEd2kEnabled = (enabled: boolean): void => {
  storage.setBool(ENABLED_KEY, enabled);
};

const isServer = (value: unknown): value is Ed2kServer => {
  const item = value as Ed2kServer;
  return (
    Boolean(item) &&
    typeof item.host === 'string' &&
    item.host.length > 0 &&
    Number.isInteger(item.port) &&
    item.port > 0 &&
    item.port < 65536
  );
};

export const readEd2kServers = (): Ed2kServer[] => {
  try {
    const parsed = JSON.parse(storage.getString(SERVERS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isServer) : [];
  } catch {
    return [];
  }
};

export const saveEd2kServers = (servers: Ed2kServer[]): void => {
  storage.setString(SERVERS_KEY, JSON.stringify(servers.filter(isServer)));
};

/** Adds servers that are not in the list yet. Returns how many were new. */
export const addEd2kServers = (servers: Ed2kServer[]): number => {
  const current = readEd2kServers();
  const known = new Set(current.map(serverKey));
  const fresh = servers.filter(server => {
    if (!isServer(server) || known.has(serverKey(server))) return false;
    known.add(serverKey(server));
    return true;
  });
  if (fresh.length > 0) {
    saveEd2kServers([...current, ...fresh]);
  }
  return fresh.length;
};

export const removeEd2kServer = (key: string): void => {
  saveEd2kServers(readEd2kServers().filter(server => serverKey(server) !== key));
};

/** Moves a server to the top, so it is tried first. */
export const preferEd2kServer = (key: string): void => {
  const servers = readEd2kServers();
  const chosen = servers.find(server => serverKey(server) === key);
  if (!chosen) return;
  saveEd2kServers([chosen, ...servers.filter(server => server !== chosen)]);
};
