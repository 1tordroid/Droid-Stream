/**
 * The sending side of "Send setup": find the receiving device on the home
 * network, then send the setup encrypted with the key from its code.
 */
import {nativeCrypto, fromBase64, sealWithKey, type CryptoBackend} from '../backupSync/crypto';
import type {SetupPayload} from '../backupSync/payload';
import {isPrivateLanAddress} from '../remoteAccess/lan';
import {deriveCodeKeys, neighbourAddresses, SETUP_AAD, SETUP_PORT} from './code';
import {MAX_TRANSFER_BYTES, type HelloReply, type SessionError} from './session';

type Fetch = typeof fetch;

const HELLO_TIMEOUT_MS = 1500;
const SEND_TIMEOUT_MS = 60_000;
const SCAN_BATCH = 32;

export interface Receiver {
  host: string;
  port: number;
  name: string;
  salt: string;
}

const hostForUrl = (host: string) => (host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host);

const post = async (fetcher: Fetch, host: string, port: number, body: string, timeoutMs: number): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(`http://${hostForUrl(host)}:${port}/jsonrpc`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted ? 'The other device did not answer' : 'Could not reach the other device');
    }
    if (!response.ok) throw new Error(response.status === 413 ? 'The setup is too large to send' : 'The other device refused the setup');
    try {
      return await response.json();
    } catch {
      throw new Error('The other device did not answer');
    }
  } finally {
    clearTimeout(timer);
  }
};

const isHello = (value: unknown): value is HelloReply => {
  const hello = value as HelloReply;
  return hello?.ok === true && hello.app === 'droid-stream-setup' && hello.v === 1 && typeof hello.salt === 'string';
};

/** Asks one address for its hello. Undefined when nothing answers there. */
export const hello = async (host: string, port = SETUP_PORT, fetcher: Fetch = fetch, timeoutMs = HELLO_TIMEOUT_MS): Promise<Receiver | undefined> => {
  if (!isPrivateLanAddress(host)) return undefined;
  try {
    const reply = await post(fetcher, host, port, JSON.stringify({op: 'hello'}), timeoutMs);
    if (!isHello(reply)) return undefined;
    return {host, port, name: typeof reply.name === 'string' ? reply.name.slice(0, 80) : 'Device', salt: reply.salt};
  } catch {
    return undefined;
  }
};

/** Looks for devices showing "Receive setup" on this /24 network. */
export const findReceivers = async (
  ownAddress: string,
  fetcher: Fetch = fetch,
  port = SETUP_PORT,
  shouldStop: () => boolean = () => false,
): Promise<Receiver[]> => {
  const found: Receiver[] = [];
  const hosts = isPrivateLanAddress(ownAddress) ? neighbourAddresses(ownAddress) : [];
  for (let index = 0; index < hosts.length && !shouldStop(); index += SCAN_BATCH) {
    const batch = await Promise.all(hosts.slice(index, index + SCAN_BATCH).map(host => hello(host, port, fetcher)));
    for (const receiver of batch) if (receiver) found.push(receiver);
  }
  return found;
};

const MESSAGES: Record<SessionError, string> = {
  'not-lan': 'Both devices must be on the same home network',
  expired: 'The code has run out. Open Receive setup again on the other device.',
  done: 'That code was already used. Open Receive setup again on the other device.',
  locked: 'Too many wrong codes. Wait a minute and try again.',
  'bad-token': 'Wrong code. Check the code on the other device.',
  'bad-request': 'The other device could not read the setup',
  'too-large': 'The setup is too large to send',
  'bad-data': 'The other device could not read the setup',
};

export const sessionErrorMessage = (code: unknown): string =>
  typeof code === 'string' && code in MESSAGES ? MESSAGES[code as SessionError] : 'The other device refused the setup';

/** Encrypts and sends [payload] to [receiver]. Throws with a message for the user. */
export const sendSetup = async (
  receiver: Receiver,
  code: string,
  payload: SetupPayload,
  backend: CryptoBackend = nativeCrypto,
  fetcher: Fetch = fetch,
): Promise<void> => {
  if (!isPrivateLanAddress(receiver.host)) throw new Error(MESSAGES['not-lan']);
  const {key, token} = await deriveCodeKeys(code, fromBase64(receiver.salt), backend);
  const data = await sealWithKey(key, JSON.stringify(payload), SETUP_AAD, backend);
  const body = JSON.stringify({op: 'send', token, data});
  if (body.length > MAX_TRANSFER_BYTES) throw new Error(MESSAGES['too-large']);
  let reply: {ok?: unknown; error?: unknown};
  try {
    reply = (await post(fetcher, receiver.host, receiver.port, body, SEND_TIMEOUT_MS)) as typeof reply;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not reach the other device');
  }
  if (reply?.ok !== true) throw new Error(sessionErrorMessage(reply?.error));
};
