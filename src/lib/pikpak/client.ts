/**
 * Talks to the signed-in user's own PikPak account.
 * This client is original TypeScript. It does not include code from GPL projects.
 */

export interface PikPakSession {
  accessToken: string;
  userId?: string;
}

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

export const signInToPikPak = async (username: string, password: string): Promise<PikPakSession> => {
  const response = await fetch('https://user.mypikpak.com/v1/auth/signin', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_id: CLIENT_ID, username, password}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `PikPak sign-in failed (${response.status}). You can paste an access token instead.`);
  }
  return {accessToken: data.access_token, userId: data.sub};
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
  if (!response.ok) return {...task, message: data.error || `Status ${response.status}`};
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
