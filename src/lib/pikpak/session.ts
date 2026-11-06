/**
 * Keeps a PikPak password sign-in alive. Access tokens last about two hours;
 * the saved refresh token renews them before they expire and after PikPak
 * rejects one, so the user stays signed in until PikPak ends the session.
 */
import {DebridHttpError} from '../debrid/http';
import {clearPikPakAccount, readPikPakAccount, updatePikPakTokens} from '../sources/vault';
import {PikPakAuthError, refreshPikPakSession} from './client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const RESIGN_IN = 'PikPak needs you to sign in once more so Droid Stream can keep you signed in.';

let refreshing: Promise<string> | undefined;
/** Access tokens this process replaced; callers holding one get the current token. */
const retired = new Set<string>();

export const isPikPakAuthError = (error: unknown): boolean =>
  error instanceof PikPakAuthError ||
  (error instanceof DebridHttpError && (error.status === 401 || Number(error.body?.error_code) === 16));

/** One renewal at a time: a rotated refresh token must never be spent twice. */
const renew = (): Promise<string> => {
  if (!refreshing) {
    refreshing = (async () => {
      const account = readPikPakAccount();
      if (!account?.refreshToken) throw new PikPakAuthError();
      try {
        const next = await refreshPikPakSession(account.refreshToken);
        retired.add(account.accessToken);
        updatePikPakTokens({accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt});
        return next.accessToken;
      } catch (error) {
        if (error instanceof PikPakAuthError) {
          retired.add(account.accessToken);
          clearPikPakAccount();
        }
        throw error;
      }
    })().finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
};

/** The current access token, renewed first when it is about to expire (or when forced). */
export const getPikPakToken = async ({force = false}: {force?: boolean} = {}): Promise<string> => {
  const account = readPikPakAccount();
  if (!account) throw new PikPakAuthError();
  const expiring = account.expiresAt !== undefined && account.expiresAt - Date.now() < REFRESH_MARGIN_MS;
  if (account.refreshToken && (force || expiring)) return renew();
  return account.accessToken;
};

/**
 * Runs a PikPak request with a live token. Tokens from the saved sign-in are
 * renewed and retried once on rejection; a token pasted by the user is used as
 * is, because it cannot be renewed.
 */
export const withPikPak = async <T>(passedToken: string, request: (token: string) => Promise<T>): Promise<T> => {
  const account = readPikPakAccount();
  const fromSignIn = Boolean(account) && (!passedToken || passedToken === account?.accessToken || retired.has(passedToken));
  if (!fromSignIn) return request(passedToken);
  if (!account?.refreshToken) {
    // Saved before 5.5.0: no refresh token. Ask for one more sign-in when it ends.
    try {
      return await request(account!.accessToken);
    } catch (error) {
      if (!isPikPakAuthError(error)) throw error;
      clearPikPakAccount();
      throw new PikPakAuthError(RESIGN_IN);
    }
  }
  try {
    return await request(await getPikPakToken());
  } catch (error) {
    if (!isPikPakAuthError(error)) throw error;
    return request(await getPikPakToken({force: true}));
  }
};
