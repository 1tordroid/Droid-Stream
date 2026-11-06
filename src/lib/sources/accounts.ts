/**
 * Signs saved sources in, lists their folders and starts playback with the
 * saved sign-in. Tokens and passwords stay in the encrypted source vault.
 */
import {SOURCE_SERVICE_NAMES} from './authErrors';
import {ToastAndroid} from 'react-native';
import {listEmby, listJellyfin, listPlex, resolvePlexPlayUrl, signInEmby, signInJellyfin, signInPlex, type LibraryItem} from './mediaServers';
import {listSmbShare} from './smb';
import {getInstallId, type SavedSource, type SourceKind} from './vault';
import {listWebDav, webDavDownloadHeaders, type RemoteFile} from './webdav';

/** What the add, edit and sign-in-again form holds. The saved password or token is never filled in. */
export interface SourceForm {
  /** Empty for a new source; the saved id when editing or signing in again. */
  id: string;
  kind: SourceKind;
  name: string;
  server: string;
  /** The name typed to sign in. */
  username: string;
  secret: string;
  share: string;
}

export interface SourceRow {
  id: string;
  title: string;
  directory: boolean;
  playUrl?: string;
}

export const emptySourceForm = (kind: SourceKind = 'webdav'): SourceForm => ({
  id: '',
  kind,
  name: '',
  server: '',
  username: '',
  secret: '',
  share: '',
});

const usesServerUserId = (kind: SourceKind) => kind === 'jellyfin' || kind === 'emby';

/** The name the user signs in with. Jellyfin and Emby save the server's user id as username, so they keep it apart. */
export const loginOf = (source: SavedSource): string =>
  usesServerUserId(source.kind) ? source.loginName || '' : source.username;

/** The form for editing a source or signing in again: same id, details filled in, password empty. */
export const formFromSource = (source: SavedSource): SourceForm => ({
  id: source.id,
  kind: source.kind,
  name: source.name,
  server: source.server,
  username: loginOf(source),
  secret: '',
  share: source.share || '',
});

/** True when saving this form leaves the current sign-in as it is: an unchanged login and no new password. */
export const keepsSignIn = (form: SourceForm, existing?: SavedSource): boolean =>
  existing !== undefined &&
  existing.authState !== 'signedOut' &&
  existing.kind === form.kind &&
  !form.secret &&
  loginOf(existing) === form.username.trim();

/**
 * The Jellyfin or Emby DeviceId for a sign-in. A source keeps the id this
 * install made for it. A source saved before 5.5.0 (the shared 'droid-stream')
 * or brought over from another install gets a new one, so signing in here
 * never ends another install's sign-in.
 */
export const mediaDeviceIdFor = (sourceId: string, previous?: string): string => {
  const install = getInstallId();
  return previous && previous.startsWith(`${install}-`) ? previous : `${install}-${sourceId}`;
};

/**
 * Turns the form into the source to save, signing in where the service needs
 * it. Editing with the password left empty keeps the current sign-in. Throws
 * before anything is saved when the sign-in fails, so the saved source stays
 * as it was.
 */
export const completeSourceForm = async (form: SourceForm, existing?: SavedSource): Promise<SavedSource> => {
  const id = existing?.id || form.id || `${Date.now()}`;
  const server = form.server.trim();
  const login = form.username.trim();
  if (!server) throw new Error('Enter the server address');
  const base = {
    id,
    kind: form.kind,
    name: form.name.trim() || SOURCE_SERVICE_NAMES[form.kind],
    server,
    share: form.kind === 'smb' ? form.share : '',
  };

  if (existing && keepsSignIn(form, existing)) return {...existing, ...base};

  if (form.kind === 'jellyfin' || form.kind === 'emby') {
    const deviceId = mediaDeviceIdFor(id, existing?.deviceId);
    const signIn = form.kind === 'emby' ? signInEmby : signInJellyfin;
    const session = await signIn(server, login, form.secret, deviceId);
    return {...base, username: session.userId, secret: session.token, loginName: login, deviceId, authState: 'ok'};
  }
  if (form.kind === 'plex') {
    if (login) {
      // Plex asks for one identifier per app install.
      const clientId = getInstallId();
      const token = await signInPlex(login, form.secret, clientId);
      return {...base, username: login, secret: token, deviceId: clientId, authState: 'ok'};
    }
    const token = form.secret.trim();
    if (!token) throw new Error('Paste a Plex token, or enter your Plex email or username and password');
    return {...base, username: '', secret: token, authState: 'ok'};
  }
  return {...base, username: login, secret: form.secret, authState: 'ok'};
};

/**
 * Row playUrl of a Plex video whose listing had no media part: the rating key
 * behind this prefix is resolved to the part's address by playSource.
 */
export const PLEX_PART_PREFIX = 'plex-part:';

/** Lists one folder of a source. Throws SourceAuthError when the server rejects the saved sign-in. */
export const listSourceRows = async (source: SavedSource, folder = ''): Promise<SourceRow[]> => {
  if (source.kind === 'webdav') {
    const files = await listWebDav(source.server, folder || source.server, source.username, source.secret);
    return files.map((file: RemoteFile) => ({id: file.href, title: file.name, directory: file.directory, playUrl: file.directory ? undefined : file.href}));
  }
  if (source.kind === 'smb') {
    const files = await listSmbShare(source.server, source.share || '', folder, source.username, source.secret);
    return files.map(file => ({id: `${folder}/${file.name}`, title: file.name, directory: file.directory}));
  }
  const toRow = (item: LibraryItem): SourceRow => ({id: item.id, title: item.title, directory: item.kind === 'folder', playUrl: item.playUrl});
  if (source.kind === 'plex') {
    return (await listPlex(source.server, source.secret, folder || '/library/sections')).map(item => {
      const row = toRow(item);
      // A video listed without its media part gets the part when it is opened.
      return item.kind === 'video' && !row.playUrl ? {...row, playUrl: `${PLEX_PART_PREFIX}${item.id}`} : row;
    });
  }
  const list = source.kind === 'emby' ? listEmby : listJellyfin;
  return (await list(source.server, source.username, source.secret, folder || undefined, source.deviceId)).map(toRow);
};

/**
 * Headers the player sends for a file of this source. WebDAV checks Basic
 * auth on every request; the built-in player forwards Stream.headers. The VLC
 * player screen takes no headers, so protected WebDAV files need the built-in
 * player.
 */
export const playbackHeaders = (source: SavedSource): Record<string, string> | undefined => {
  if (source.kind !== 'webdav' || (!source.username && !source.secret)) return undefined;
  return webDavDownloadHeaders(source.username, source.secret);
};

const TOKEN_PARAM = /^(?:ApiKey|api_key|X-Plex-Token)$/i;

/** A play address without the media server token that listing added to it. */
export const withoutToken = (url: string): string => {
  const at = url.indexOf('?');
  if (at < 0) return url;
  const kept = url
    .slice(at + 1)
    .split('&')
    .filter(pair => !TOKEN_PARAM.test(pair.split('=')[0]));
  return kept.length ? `${url.slice(0, at)}?${kept.join('&')}` : url.slice(0, at);
};

type PlayerNavigation = {navigate: (screen: string, params: object) => void};

/**
 * Opens the player for a file of this source. A Plex video listed without its
 * media part is looked up first; the returned promise settles once the player
 * opened or the lookup failed (with a toast).
 */
export const playSource = (
  navigation: PlayerNavigation,
  source: SavedSource,
  title: string,
  url?: string,
): void | Promise<void> => {
  if (!url) return;
  if (url.startsWith(PLEX_PART_PREFIX)) {
    if (source.kind !== 'plex') return;
    return resolvePlexPlayUrl(source.server, source.secret, url.slice(PLEX_PART_PREFIX.length)).then(
      partUrl => openSourcePlayer(navigation, source, title, partUrl),
      (error: unknown) => {
        ToastAndroid.show(error instanceof Error ? error.message : 'Plex could not open this video.', ToastAndroid.SHORT);
      },
    );
  }
  openSourcePlayer(navigation, source, title, url);
};

const openSourcePlayer = (navigation: PlayerNavigation, source: SavedSource, title: string, url: string): void => {
  const headers = playbackHeaders(source);
  // The player keys watch progress by the episode link, hands it to providers
  // and logs it, so that link leaves the token out. The stream keeps it.
  const link = source.kind === 'webdav' || source.kind === 'smb' ? url : withoutToken(url);
  navigation.navigate('Player', {
    linkIndex: 0,
    episodeList: [{title, link}],
    directUrl: url,
    type: 'movie',
    primaryTitle: title,
    poster: {},
    initialStream: {server: 'Source', link: url, type: 'mkv', ...(headers ? {headers} : {})},
  });
};
