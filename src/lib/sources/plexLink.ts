/**
 * Plex sign-in with a code (plex.tv/link): this device asks plex.tv for a
 * PIN, the user enters its code on plex.tv/link from any phone or computer,
 * and the PIN then carries the account token. With the token, the user's
 * servers come from plex.tv, and the best address of the chosen server is
 * picked by trying them: on this network first, then over the internet,
 * then through the Plex relay.
 *
 * Written from the public plex.tv API (pins and resources).
 */
import {DeviceCodeStopError, type DeviceCode, type PollResult} from '../watchSync';
import {EXPIRED_MESSAGE} from '../watchSync/devicePoll';

export const PLEX_LINK_URL = 'https://plex.tv/link';
const PLEX_API = 'https://plex.tv/api/v2';
export const PLEX_PRODUCT = 'Droid Stream';
/** How often the PIN is checked. Plex asks clients not to poll faster than once a second. */
export const PLEX_POLL_SECONDS = 2;
/** plex.tv/link codes last 15 minutes when plex.tv does not say otherwise. */
const DEFAULT_PIN_SECONDS = 15 * 60;
/** How long one address of a server gets to answer. */
export const PROBE_TIMEOUT_MS = 4000;

export const plexHeaders = (clientId: string, token?: string): Record<string, string> => ({
  Accept: 'application/json',
  'X-Plex-Client-Identifier': clientId,
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Version': '1.0',
  ...(token ? {'X-Plex-Token': token} : {}),
});

/**
 * Asks plex.tv for a new PIN. Its short code is what the user types on
 * plex.tv/link. The long "strong" codes are only for the hosted sign-in
 * page, and plex.tv/link does not take them, so this asks for a short one.
 */
export const startPlexPin = async (clientId: string, now = Date.now()): Promise<DeviceCode> => {
  const response = await fetch(`${PLEX_API}/pins?strong=false`, {method: 'POST', headers: plexHeaders(clientId)});
  if (!response.ok) throw new Error(`plex.tv did not give a code (${response.status}). Try again.`);
  const data = await response.json();
  const id = data?.id;
  const code = data?.code;
  if (id === undefined || id === null || typeof code !== 'string' || !code) throw new Error('plex.tv did not give a code. Try again.');
  // The device clock may be off, so the time left counts from now.
  const seconds = Number(data?.expiresIn) > 0 ? Number(data.expiresIn) : DEFAULT_PIN_SECONDS;
  return {
    userCode: code.toUpperCase(),
    verificationUrl: PLEX_LINK_URL,
    deviceCode: String(id),
    intervalSeconds: PLEX_POLL_SECONDS,
    expiresAt: now + seconds * 1000,
  };
};

/**
 * Checks the PIN once. Approved carries the account token. plex.tv answers
 * 404 once the PIN has expired or was used; that ends the sign-in. Other
 * failures (offline, server errors) throw a plain Error, which the poll
 * tolerates a few times in a row.
 */
export const checkPlexPin = async (code: DeviceCode, clientId: string): Promise<{result: PollResult; token?: string}> => {
  const response = await fetch(`${PLEX_API}/pins/${encodeURIComponent(code.deviceCode)}`, {headers: plexHeaders(clientId)});
  if (response.status === 404 || response.status === 410) throw new DeviceCodeStopError(EXPIRED_MESSAGE);
  if (response.status === 429) return {result: 'slow'};
  if (!response.ok) throw new Error(`plex.tv did not answer (${response.status}).`);
  const data = await response.json();
  const token = typeof data?.authToken === 'string' && data.authToken ? (data.authToken as string) : undefined;
  return token ? {result: 'approved', token} : {result: 'pending'};
};

export interface PlexConnection {
  uri: string;
  protocol: string;
  local: boolean;
  relay: boolean;
  ipv6: boolean;
}

export interface PlexServer {
  /** The server's machine identifier. */
  id: string;
  name: string;
  owned: boolean;
  /** The token for this server. Shared servers have their own. */
  accessToken: string;
  httpsRequired: boolean;
  connections: PlexConnection[];
}

type RawConnection = {uri?: string; protocol?: string; local?: boolean | number; relay?: boolean | number; IPv6?: boolean | number};
type RawResource = {
  name?: string;
  clientIdentifier?: string;
  provides?: string;
  owned?: boolean | number;
  accessToken?: string;
  httpsRequired?: boolean | number;
  connections?: RawConnection[];
};

const flag = (value: unknown) => value === true || value === 1 || value === '1';

/** The servers among plex.tv resources: players and other apps are left out. */
export const parsePlexServers = (data: unknown, accountToken: string): PlexServer[] => {
  const list: RawResource[] = Array.isArray(data) ? data : [];
  return list
    .filter(item => String(item?.provides || '').split(',').includes('server'))
    .map(item => ({
      id: String(item.clientIdentifier || item.name || ''),
      name: String(item.name || 'Plex'),
      owned: flag(item.owned),
      accessToken: item.accessToken || accountToken,
      httpsRequired: flag(item.httpsRequired),
      connections: (item.connections || [])
        .filter(connection => typeof connection?.uri === 'string' && /^https?:\/\//i.test(connection.uri))
        .map(connection => ({
          uri: String(connection.uri).replace(/\/+$/, ''),
          protocol: String(connection.protocol || (String(connection.uri).startsWith('https') ? 'https' : 'http')),
          local: flag(connection.local),
          relay: flag(connection.relay),
          ipv6: flag(connection.IPv6),
        })),
    }))
    .filter(server => server.connections.length > 0);
};

/** The user's Plex servers, owned ones first. */
export const listPlexServers = async (accountToken: string, clientId: string): Promise<PlexServer[]> => {
  const response = await fetch(`${PLEX_API}/resources?includeHttps=1&includeRelay=1`, {headers: plexHeaders(clientId, accountToken)});
  if (response.status === 401 || response.status === 403) throw new Error('plex.tv did not accept this sign-in. Try again.');
  if (!response.ok) throw new Error(`plex.tv did not list your servers (${response.status}).`);
  const servers = parsePlexServers(await response.json(), accountToken);
  return [...servers.filter(server => server.owned), ...servers.filter(server => !server.owned)];
};

/**
 * Lower is better: an address on this network, then a direct one over the
 * internet, then the Plex relay (slow, and limited in speed). Within each,
 * a secure address comes first, and IPv6 last.
 */
export const connectionRank = (connection: PlexConnection): number =>
  (connection.relay ? 200 : connection.local ? 0 : 100) + (connection.protocol === 'https' ? 0 : 10) + (connection.ipv6 ? 1 : 0);

/** The addresses worth trying, best first. A server that requires secure connections drops plain http. */
export const orderedConnections = (server: PlexServer): PlexConnection[] =>
  server.connections
    .filter(connection => !server.httpsRequired || connection.protocol === 'https')
    .map((connection, index) => ({connection, index}))
    .sort((a, b) => connectionRank(a.connection) - connectionRank(b.connection) || a.index - b.index)
    .map(entry => entry.connection);

/** True when the server answers on this address within the timeout. */
export const probePlexConnection = async (uri: string, token: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${uri}/identity`, {headers: {Accept: 'application/json', 'X-Plex-Token': token}, signal: controller.signal});
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The best address of the server that answers. All are tried at once, and
 * the answer comes as soon as every better address has failed, so a working
 * local address does not wait for the relay. Undefined when none answers.
 */
export const chooseConnection = async (
  server: PlexServer,
  probe: (uri: string, token: string) => Promise<boolean> = probePlexConnection,
): Promise<PlexConnection | undefined> => {
  const ordered = orderedConnections(server);
  const checks = ordered.map(connection => probe(connection.uri, server.accessToken).catch(() => false));
  for (let index = 0; index < ordered.length; index += 1) {
    if (await checks[index]) return ordered[index];
  }
  return undefined;
};

/** What a plex.tv sign-in saves for one server. */
export interface PlexLinkResult {
  server: PlexServer;
  connection: PlexConnection;
  clientId: string;
}
