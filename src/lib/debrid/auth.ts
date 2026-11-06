/**
 * Tells a refused debrid key apart from every other failure. These keys do not
 * expire on their own, so a refusal means the key was reset, deleted or
 * blocked and the user has to act. Network errors, timeouts and server errors
 * never count as a refusal, and a refused key is never deleted.
 */
import {debridFetch, DebridHttpError} from './http';
import type {DebridId} from './types';

/**
 * ok: the last call with the saved key worked. rejected: paste a new key.
 * blocked: AllDebrid wants a new location confirmed. banned: AllDebrid banned
 * the account, so a new key would not help.
 */
export type DebridAuthState = 'ok' | 'rejected' | 'blocked' | 'banned';
export type DebridAuthFailure = Exclude<DebridAuthState, 'ok'>;

export const KEY_REJECTED = 'Key rejected - paste a new key';
export const ALLDEBRID_BLOCKED = 'AllDebrid blocked this new location - confirm the email AllDebrid sent';
export const ALLDEBRID_BANNED = 'AllDebrid banned this account - contact AllDebrid support';
export const TORBOX_PLAN_RESTRICTED = 'Your TorBox plan does not include this - it needs an active paid plan';

/** The service refused the key. `code` is the service's own error code, when it sent one. */
export class DebridAuthError extends Error {
  constructor(message: string, readonly service: DebridId, readonly state: DebridAuthFailure, readonly code?: string) {
    super(message);
    this.name = 'DebridAuthError';
  }
}

// https://docs.alldebrid.com/ - AUTH_BLOCKED also means AllDebrid wants a new
// location, device or app confirmed from the email it sent (/user/verif).
const ALLDEBRID_CODES = new Map<string, DebridAuthFailure>([
  ['AUTH_BAD_APIKEY', 'rejected'],
  ['AUTH_USER_BANNED', 'banned'],
  ['AUTH_BLOCKED', 'blocked'],
]);

/**
 * Refusals a service names in the answer body. AllDebrid, Premiumize and
 * Debrid-Link can send these with HTTP 200, so their check functions ask here
 * too, not only isAuthFailure.
 */
export const authFailureInBody = (id: DebridId, body: any): DebridAuthFailure | undefined => {
  switch (id) {
    case 'alldebrid': {
      const code = body?.error?.code;
      return typeof code === 'string' ? ALLDEBRID_CODES.get(code) : undefined;
    }
    case 'premiumize':
      // "API key missing, invalid, or expired", sent with HTTP 200. https://www.premiumize.me/api
      return body?.code === 'authentication_failed' ? 'rejected' : undefined;
    case 'debridlink':
      // Debrid-Link's official error list only loads in a browser. badToken is
      // the code other clients treat as a refused key.
      return body?.success === false && body.error === 'badToken' ? 'rejected' : undefined;
    default:
      return undefined;
  }
};

/**
 * TorBox answers 403 with PLAN_RESTRICTED_FEATURE when a free or lapsed plan
 * asks for a paid feature. TorBox took the key; a new one would not help.
 */
export const isPlanRestricted = (id: DebridId, error: unknown): boolean =>
  id === 'torbox' && error instanceof DebridHttpError && String(error.body?.error ?? '').toUpperCase() === 'PLAN_RESTRICTED_FEATURE';

/** How the service refused the key, or undefined when the error is about something else. */
export const isAuthFailure = (id: DebridId, error: unknown): DebridAuthFailure | undefined => {
  if (error instanceof DebridAuthError) return error.service === id ? error.state : undefined;
  if (!(error instanceof DebridHttpError)) return undefined;
  if (isPlanRestricted(id, error)) return undefined;
  const inBody = authFailureInBody(id, error.body);
  if (inBody) return inBody;
  const {status} = error;
  switch (id) {
    case 'torbox':
    case 'offcloud':
      // Neither has official docs for its auth error codes, so the HTTP status decides.
      return status === 401 || status === 403 ? 'rejected' : undefined;
    case 'realdebrid':
      // 401 is a bad or expired token. 403 is a locked or non-premium account,
      // which a new key would not fix; only its bad-token code (8) counts there.
      // https://api.real-debrid.com/
      return status === 401 || Number(error.body?.error_code) === 8 ? 'rejected' : undefined;
    case 'debridlink':
      // ResolveURL treats an HTTP 401 from Debrid-Link as an ended token.
      return status === 401 ? 'rejected' : undefined;
    default:
      // AllDebrid and Premiumize name a refusal in the body (above). PikPak
      // signs in with a password and renews its own session.
      return undefined;
  }
};

/** The short line the settings screen shows instead of "connected". */
export const authProblemLabel = (state: DebridAuthState | undefined): string | undefined =>
  state === 'blocked' ? ALLDEBRID_BLOCKED : state === 'banned' ? ALLDEBRID_BANNED : state === 'rejected' ? KEY_REJECTED : undefined;

/** What a refusal asks the user to do. */
const refusalMessage = (name: string, state: DebridAuthFailure): string =>
  state === 'blocked' ? ALLDEBRID_BLOCKED : state === 'banned' ? ALLDEBRID_BANNED : `${name} rejected the key - paste a new key in Torrents → Debrid and cloud`;

const codeOf = (error: unknown): string | undefined => {
  if (error instanceof DebridAuthError) return error.code;
  const body = error instanceof DebridHttpError ? error.body : undefined;
  const code = body?.error?.code ?? body?.code ?? body?.error_code ?? body?.error;
  return code === undefined || code === null || typeof code === 'object' ? undefined : String(code);
};

type Reporter = (id: DebridId, key: string, state: DebridAuthState) => void;
let reporter: Reporter | undefined;

/** index.ts saves what each call learned about the saved key. */
export const setDebridAuthReporter = (next: Reporter | undefined): void => {
  reporter = next;
};

const report = (id: DebridId, key: string, state: DebridAuthState) => {
  try {
    reporter?.(id, key, state);
  } catch {
    // Saving the state must never break the request itself.
  }
};

/**
 * A fetch for one service that notes whether the service took the key.
 * `check` reads the body and throws for service errors that come with HTTP 200.
 * A refusal is rethrown as DebridAuthError with a message that says what to do.
 */
export const keyedFetch =
  (id: DebridId, name: string) =>
  async <T = any>(key: string, url: string, init: RequestInit = {}, check: (data: any) => T = data => data): Promise<T> => {
    let result: T;
    try {
      result = check(await debridFetch(url, init));
    } catch (error) {
      if (isPlanRestricted(id, error)) {
        // The service knew the key; only the plan stands in the way.
        report(id, key, 'ok');
        throw Object.assign(new Error(TORBOX_PLAN_RESTRICTED), {code: 'PLAN_RESTRICTED_FEATURE'});
      }
      const state = isAuthFailure(id, error);
      if (!state) throw error;
      report(id, key, state);
      throw new DebridAuthError(refusalMessage(name, state), id, state, codeOf(error));
    }
    report(id, key, 'ok');
    return result;
  };
