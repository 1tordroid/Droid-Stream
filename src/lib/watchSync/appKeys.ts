/**
 * App keys built into release builds (from the TRAKT_CLIENT_ID,
 * TRAKT_CLIENT_SECRET and SIMKL_CLIENT_ID build secrets, see app.config.js).
 * A build without them falls back to asking for the user's own app.
 */
import Constants from 'expo-constants';

export interface AppKeys {
  clientId: string;
  clientSecret?: string;
}

const extra = (): Record<string, unknown> => (Constants.expoConfig?.extra as Record<string, unknown> | undefined) || {};
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const builtInTraktApp = (): AppKeys | undefined => {
  const clientId = text(extra().traktClientId);
  const clientSecret = text(extra().traktClientSecret);
  return clientId && clientSecret ? {clientId, clientSecret} : undefined;
};

export const builtInSimklApp = (): AppKeys | undefined => {
  const clientId = text(extra().simklClientId);
  return clientId ? {clientId} : undefined;
};
