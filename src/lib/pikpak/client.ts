/**
 * Talks to the signed-in user's own PikPak account.
 * This client is original TypeScript. It does not include code from GPL projects.
 */

import {readPikPakDeviceId, savePikPakDeviceId} from '../sources/vault';

export interface PikPakSession {
  accessToken: string;
  userId?: string;
  refreshToken?: string;
  /** Epoch ms when the access token stops working. */
  expiresAt?: number;
}

/** PikPak rejected the token or the sign-in itself; the user has to sign in again. */
export class PikPakAuthError extends Error {
  constructor(message = 'Your PikPak sign-in has ended. Sign in again under Library > PikPak.') {
    super(message);
    this.name = 'PikPakAuthError';
  }
}

/** 16: token expired or invalid. 4126: refresh token rejected. */
const isAuthRejection = (status: number, data: any): boolean =>
  status === 401 || data?.error === 'invalid_grant' || data?.error === 'unauthenticated' || [16, 4126].includes(Number(data?.error_code));

export interface MagnetTask {
  id?: string;
  fileId?: string;
  name?: string;
  phase?: string;
  progress?: number;
  message?: string;
  playUrl?: string;
}

const CLIENT_ID = 'YNxT9w7GMdWvEOKa';
const DRIVE = 'https://api-drive.mypikpak.com/drive/v1';

export const assertMagnet = (value: string): string => {
  const magnet = value.trim();
  if (!magnet.startsWith('magnet:?xt=urn:')) {
    throw new Error('Paste a magnet link that starts with magnet:?xt=urn:');
  }
  return magnet;
};

const bearer = (session: PikPakSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
  'Content-Type': 'application/json',
});

const deviceId = (): string => {
  // A stable random id per install, kept across launches: PikPak ties captcha
  // and refresh tokens to it.
  let id = readPikPakDeviceId();
  if (!id) {
    id = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    savePikPakDeviceId(id);
  }
  return id;
};

/** Access tokens last about two hours; the refresh token keeps the sign-in going. */
const toSession = (data: any, previousRefreshToken?: string): PikPakSession => ({
  accessToken: data.access_token,
  refreshToken: data.refresh_token || previousRefreshToken,
  expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
  userId: data.sub,
});

/** PikPak asks for a captcha token before a password sign-in. */
const captchaToken = async (username: string): Promise<string | undefined> => {
  const meta = username.includes('@') ? {email: username} : /^\+?\d{6,}$/.test(username) ? {phone_number: username} : {username};
  try {
    const response = await fetch('https://user.mypikpak.com/v1/shield/captcha/init', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Device-Id': deviceId()},
      body: JSON.stringify({client_id: CLIENT_ID, action: 'POST:/v1/auth/signin', device_id: deviceId(), meta}),
    });
    const data = await response.json().catch(() => ({}));
    if (data.url) {
      throw new Error('PikPak wants a browser check for this account. Sign in once at mypikpak.com, or paste an access token instead.');
    }
    return data.captcha_token;
  } catch (error: any) {
    if (error?.message?.startsWith('PikPak wants')) throw error;
    return undefined;
  }
};

export const signInToPikPak = async (username: string, password: string): Promise<PikPakSession> => {
  const captcha = await captchaToken(username);
  const response = await fetch('https://user.mypikpak.com/v1/auth/signin', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Device-Id': deviceId(), ...(captcha ? {'X-Captcha-Token': captcha} : {})},
    body: JSON.stringify({client_id: CLIENT_ID, username, password, ...(captcha ? {captcha_token: captcha} : {})}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `PikPak sign-in failed (${response.status}). You can paste an access token instead.`);
  }
  return toSession(data);
};

/**
 * Trades the refresh token for a new access token (and usually a new refresh
 * token). Throws PikPakAuthError when PikPak ended the sign-in; network and
 * server errors throw a plain Error so the saved tokens are kept.
 */
export const refreshPikPakSession = async (refreshToken: string): Promise<PikPakSession> => {
  const response = await fetch('https://user.mypikpak.com/v1/auth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Device-Id': deviceId()},
    body: JSON.stringify({client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (isAuthRejection(response.status, data) || response.status === 400) throw new PikPakAuthError();
    throw new Error(data.error_description || data.error || `PikPak could not renew the sign-in (${response.status})`);
  }
  return toSession(data, refreshToken);
};

export const sessionFromToken = (accessToken: string): PikPakSession => ({accessToken: accessToken.trim()});

export const addMagnetTask = async (session: PikPakSession, magnet: string): Promise<MagnetTask> => {
  const response = await fetch(`${DRIVE}/files`, {
    method: 'POST',
    headers: bearer(session),
    body: JSON.stringify({
      kind: 'drive#file',
      parent_id: '',
      upload_type: 'UPLOAD_TYPE_URL',
      url: {url: assertMagnet(magnet)},
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (isAuthRejection(response.status, data)) throw new PikPakAuthError();
    throw new Error(data.error_description || data.error || `PikPak did not accept the magnet (${response.status})`);
  }
  return {
    id: data.task?.id,
    fileId: data.file?.id,
    name: data.file?.name || data.task?.name,
    phase: data.task?.phase,
    progress: Number(data.task?.progress) || 0,
    message: data.task?.message,
  };
};

export const readMagnetTask = async (session: PikPakSession, task: MagnetTask): Promise<MagnetTask> => {
  if (!task.id) return task;
  const response = await fetch(`${DRIVE}/tasks/${task.id}`, {headers: bearer(session)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (isAuthRejection(response.status, data)) throw new PikPakAuthError();
    return {...task, message: data.error || `Status ${response.status}`};
  }
  const fileId = data.file_id || task.fileId;
  let playUrl = task.playUrl;
  if (data.phase === 'PHASE_TYPE_COMPLETE' && fileId) {
    const file = await fetch(`${DRIVE}/files/${fileId}`, {headers: bearer(session)});
    const body = await file.json().catch(() => ({}));
    playUrl = body.web_content_link || body.links?.application_octet_stream?.url || playUrl;
  }
  return {
    ...task,
    fileId,
    name: data.name || task.name,
    phase: data.phase,
    progress: Number(data.progress) || task.progress,
    message: data.message,
    playUrl,
  };
};
