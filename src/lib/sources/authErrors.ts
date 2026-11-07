import type {SourceKind} from './vault';

export const SOURCE_SERVICE_NAMES: Record<SourceKind, string> = {
  webdav: 'WebDAV',
  smb: 'SMB',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  plex: 'Plex',
};

/** HTTP statuses that mean the server no longer accepts the saved sign-in. */
export const isSourceAuthStatus = (status: number): boolean => status === 401 || status === 403;

/**
 * The server rejected the saved token or password. The source has to be
 * signed in again; retrying with the same details will not help.
 */
export class SourceAuthError extends Error {
  constructor(readonly kind: SourceKind, readonly status: number) {
    super(`${SOURCE_SERVICE_NAMES[kind]} ended this sign-in (${status}). Sign in again.`);
    this.name = 'SourceAuthError';
  }
}

export const isSourceAuthError = (error: unknown): error is SourceAuthError => error instanceof SourceAuthError;

/** What the user sees when a saved source stops working because of its sign-in. */
export const sourceSignedOutMessage = (source: {name: string; kind: SourceKind}): string => {
  const label = source.name || SOURCE_SERVICE_NAMES[source.kind];
  if (source.kind === 'webdav' || source.kind === 'smb') {
    return `${label}: ${SOURCE_SERVICE_NAMES[source.kind]} no longer accepts the saved password. Enter it again.`;
  }
  return `${label}: ${SOURCE_SERVICE_NAMES[source.kind]} ended this sign-in. Sign in again.`;
};
