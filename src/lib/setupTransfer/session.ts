/**
 * The receiving side of "Send setup": one session per code shown on screen.
 *
 * A session answers two requests over the home network: "hello" (the salt
 * and this device's name, nothing secret) and "send" (the token and the
 * encrypted setup). It takes one setup only, ends after a few minutes, locks
 * out a client that keeps guessing, refuses addresses outside the home
 * network and checks the token in constant time before it decrypts.
 */
import {nativeCrypto, openWithKey, toBase64, type CryptoBackend} from '../backupSync/crypto';
import {parseSetupPayload, type SetupPayload} from '../backupSync/payload';
import {isPrivateLanAddress} from '../remoteAccess/lan';
import {FailedAttemptLimiter, safeEqual} from '../remoteAccess/secret';
import {deriveCodeKeys, newCode, SETUP_AAD} from './code';

export const SESSION_MS = 10 * 60 * 1000;
/** Largest request body; the native server refuses larger ones before reading them. */
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
/** Wrong tokens from all clients together before the code stops working. */
const MAX_TOTAL_FAILURES = 20;

export type SessionError = 'not-lan' | 'expired' | 'done' | 'locked' | 'bad-token' | 'bad-request' | 'too-large' | 'bad-data';

export interface HelloReply {
  ok: true;
  app: 'droid-stream-setup';
  v: 1;
  salt: string;
  name: string;
}

export interface SessionResult {
  reply: string;
  received?: SetupPayload;
}

export interface ReceiveSessionOptions {
  code: string;
  salt: Uint8Array;
  key: Uint8Array;
  token: string;
  deviceName: string;
  expiresAt: number;
  now?: () => number;
  backend?: CryptoBackend;
  limiter?: FailedAttemptLimiter;
}

const error = (code: SessionError): SessionResult => ({reply: JSON.stringify({ok: false, error: code})});

export class ReceiveSession {
  readonly code: string;
  readonly expiresAt: number;
  private readonly salt: string;
  private readonly key: Uint8Array;
  private readonly token: string;
  private readonly name: string;
  private readonly now: () => number;
  private readonly backend: CryptoBackend;
  private readonly limiter: FailedAttemptLimiter;
  private failures = 0;
  private finished = false;

  constructor(options: ReceiveSessionOptions) {
    this.code = options.code;
    this.expiresAt = options.expiresAt;
    this.salt = toBase64(options.salt);
    this.key = options.key;
    this.token = options.token;
    this.name = options.deviceName;
    this.now = options.now || Date.now;
    this.backend = options.backend || nativeCrypto;
    this.limiter = options.limiter || new FailedAttemptLimiter();
  }

  get isOpen(): boolean {
    return !this.finished && this.now() < this.expiresAt;
  }

  close(): void {
    this.finished = true;
  }

  async handle(client: string, body: string): Promise<SessionResult> {
    if (!isPrivateLanAddress(client)) return error('not-lan');
    if (this.finished) return error('done');
    if (this.now() >= this.expiresAt) {
      this.finished = true;
      return error('expired');
    }
    if (body.length > MAX_TRANSFER_BYTES) return error('too-large');
    let request: {op?: unknown; token?: unknown; data?: unknown};
    try {
      request = JSON.parse(body);
    } catch {
      return error('bad-request');
    }
    if (request?.op === 'hello') {
      const hello: HelloReply = {ok: true, app: 'droid-stream-setup', v: 1, salt: this.salt, name: this.name};
      return {reply: JSON.stringify(hello)};
    }
    if (request?.op !== 'send' || typeof request.token !== 'string' || typeof request.data !== 'string') {
      return error('bad-request');
    }
    const now = this.now();
    if (this.limiter.isLocked(client, now)) return error('locked');
    if (!safeEqual(request.token, this.token)) {
      this.limiter.recordFailure(client, now);
      this.failures += 1;
      if (this.failures >= MAX_TOTAL_FAILURES) this.finished = true;
      return error('bad-token');
    }
    this.limiter.recordSuccess(client);
    let payload: SetupPayload;
    try {
      payload = parseSetupPayload(await openWithKey(this.key, request.data, SETUP_AAD, this.backend));
    } catch {
      return error('bad-data');
    }
    // A late second request may have finished the session while this one decrypted.
    if (this.finished) return error('done');
    this.finished = true;
    return {reply: JSON.stringify({ok: true}), received: payload};
  }
}

/** A new code with its salt, key and token. Stretching the code takes a moment. */
export const createReceiveSession = async (
  deviceName: string,
  backend: CryptoBackend = nativeCrypto,
  now: () => number = Date.now,
  iterations?: number,
): Promise<ReceiveSession> => {
  const code = newCode(size => backend.randomBytes(size));
  const salt = backend.randomBytes(16);
  const {key, token} = await deriveCodeKeys(code, salt, backend, iterations);
  return new ReceiveSession({code, salt, key, token, deviceName, expiresAt: now() + SESSION_MS, now, backend});
};
