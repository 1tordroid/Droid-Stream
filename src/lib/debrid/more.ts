import {readPikPakAccount} from '../sources/vault';
import {debridFetch} from './http';
import type {DebridFile, DebridService, DebridTransfer} from './types';

// ---------------------------------------------------------------- Offcloud
const OC = 'https://offcloud.com/api';
const ocKey = (key: string) => `key=${encodeURIComponent(key)}`;
const JSON_HEADERS = {'Content-Type': 'application/json'};

export const offcloud: DebridService = {
  id: 'offcloud',
  name: 'Offcloud',
  keyUrl: 'https://offcloud.com/#/account',
  keyHelp: 'offcloud.com → Account → API key',
  canCheckCache: true,
  async account(key) {
    const data = await debridFetch(`${OC}/account/stats?${ocKey(key)}`);
    return {username: data.email || data.userId || 'Offcloud', premium: Boolean(data.isPremium ?? data.premium ?? true), expiresAt: data.expirationDate ? Date.parse(data.expirationDate) : undefined};
  },
  async checkCached(key, hashes) {
    const data = await debridFetch(`${OC}/cache?${ocKey(key)}`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({hashes})});
    const cached = new Set<string>((data.cachedItems || []).map((hash: string) => hash.toLowerCase()));
    return Object.fromEntries(hashes.map(hash => [hash, cached.has(hash)]));
  },
  async addMagnet(key, magnet) {
    const data = await debridFetch(`${OC}/cloud?${ocKey(key)}`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({url: magnet})});
    if (data.error || !data.requestId) throw new Error(data.error || 'Offcloud did not accept the magnet');
    return {id: String(data.requestId)};
  },
  async status(key, id) {
    const data = await debridFetch(`${OC}/cloud/status?${ocKey(key)}`, {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({requestIds: [id]})});
    const request = data.requests?.[0] || data.status || {};
    const ready = request.status === 'downloaded';
    let files: DebridFile[] = [];
    if (ready) {
      const listing = await debridFetch<any>(`${OC}/cloud/explore/${id}?${ocKey(key)}`).catch(() => null);
      const urls: string[] = Array.isArray(listing) ? listing : [];
      files = urls.length
        ? urls.map(url => ({id: url, name: decodeURIComponent(url.split('/').pop() || 'file'), size: 0, link: url}))
        : [{id, name: request.fileName, size: Number(request.fileSize) || 0, link: `https://${request.server}.offcloud.com/cloud/download/${id}/${encodeURIComponent(request.fileName)}`}];
    }
    return {id, name: request.fileName || 'Offcloud', progress: ready ? 1 : (Number(request.amount) && Number(request.fileSize) ? Number(request.amount) / Number(request.fileSize) : 0), ready, status: request.status || 'unknown', error: request.status === 'error' ? request.errorMessage || 'error' : undefined, files};
  },
  async fileLink(_key, _transfer, file) {
    if (!file.link) throw new Error('No link yet');
    return file.link;
  },
};

// ---------------------------------------------------------------- Debrid-Link
const DL = 'https://debrid-link.com/api/v2';
const dlAuth = (key: string) => ({Authorization: `Bearer ${key}`});
const dlValue = (data: any) => {
  if (data?.success === false) throw new Error(data.error || 'Debrid-Link error');
  return data.value;
};

const dlTransfer = (item: any): DebridTransfer => ({
  id: String(item.id),
  name: item.name || 'Debrid-Link',
  progress: (Number(item.downloadPercent) || 0) / 100,
  ready: Number(item.downloadPercent) >= 100,
  status: Number(item.downloadPercent) >= 100 ? 'ready' : 'downloading',
  files: (item.files || []).map((file: any) => ({id: String(file.id), name: file.name, size: Number(file.size) || 0, link: file.downloadUrl})),
});

export const debridLink: DebridService = {
  id: 'debridlink',
  name: 'Debrid-Link',
  keyUrl: 'https://debrid-link.com/webapp/apikey',
  keyHelp: 'debrid-link.com → Web app → API key',
  canCheckCache: true,
  async account(key) {
    const value = dlValue(await debridFetch(`${DL}/account/infos`, {headers: dlAuth(key)}));
    return {username: value.pseudo || value.email, premium: Number(value.accountType) >= 1, expiresAt: value.premiumLeft ? Date.now() + Number(value.premiumLeft) * 1000 : undefined};
  },
  async checkCached(key, hashes) {
    const value = dlValue(await debridFetch(`${DL}/seedbox/cached?url=${hashes.join(',')}`, {headers: dlAuth(key)})) || {};
    const cached = new Set(Object.keys(value).map(hash => hash.toLowerCase()));
    return Object.fromEntries(hashes.map(hash => [hash, cached.has(hash)]));
  },
  async addMagnet(key, magnet) {
    const value = dlValue(await debridFetch(`${DL}/seedbox/add`, {method: 'POST', headers: {...dlAuth(key), 'Content-Type': 'application/json'}, body: JSON.stringify({url: magnet, async: true})}));
    return {id: String(value.id)};
  },
  async status(key, id) {
    const value = dlValue(await debridFetch(`${DL}/seedbox/list?ids=${id}`, {headers: dlAuth(key)}));
    return dlTransfer(Array.isArray(value) ? value[0] || {id} : value);
  },
  async fileLink(_key, _transfer, file) {
    if (!file.link) throw new Error('No link yet');
    return file.link;
  },
  async remove(key, id) {
    await debridFetch(`${DL}/seedbox/${id}/remove`, {method: 'DELETE', headers: dlAuth(key)});
  },
};

// ---------------------------------------------------------------- PikPak (cloud download)
const PP = 'https://api-drive.mypikpak.com/drive/v1';
const ppAuth = (token: string) => ({Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'});

/** PikPak signs in with a username and password; the key is the saved access token. */
export const pikpakKey = (): string => readPikPakAccount()?.accessToken || '';

const ppFiles = async (token: string, parentId: string, depth = 0): Promise<DebridFile[]> => {
  const filters = encodeURIComponent(JSON.stringify({trashed: {eq: false}}));
  const data = await debridFetch(`${PP}/files?parent_id=${parentId}&limit=200&filters=${filters}`, {headers: ppAuth(token)});
  const out: DebridFile[] = [];
  for (const file of data.files || []) {
    if (file.kind === 'drive#folder' && depth < 3) out.push(...(await ppFiles(token, file.id, depth + 1)));
    else if (file.kind === 'drive#file') out.push({id: file.id, name: file.name, size: Number(file.size) || 0});
  }
  return out;
};

export const pikpak: DebridService = {
  id: 'pikpak',
  name: 'PikPak',
  keyUrl: 'https://mypikpak.com',
  keyHelp: 'Sign in under Library → PikPak, or paste an access token',
  // PikPak finishes popular torrents at once but has no public cache check.
  canCheckCache: false,
  async account(token) {
    const data = await debridFetch('https://user.mypikpak.com/v1/user/me', {headers: ppAuth(token)});
    return {username: data.name || data.email || 'PikPak', premium: true};
  },
  async checkCached() {
    return {};
  },
  async addMagnet(token, magnet) {
    const data = await debridFetch(`${PP}/files`, {method: 'POST', headers: ppAuth(token), body: JSON.stringify({kind: 'drive#file', parent_id: '', upload_type: 'UPLOAD_TYPE_URL', url: {url: magnet}, folder_type: 'DOWNLOAD'})});
    const id = data.task?.id;
    if (!id) throw new Error('PikPak did not accept the magnet');
    return {id: `${id}|${data.task?.file_id || data.file?.id || ''}`};
  },
  async status(token, id) {
    const [taskId, knownFile] = id.split('|');
    // Items from the file list have no task, only a file id.
    const task = taskId ? await debridFetch(`${PP}/tasks/${taskId}`, {headers: ppAuth(token)}).catch(() => ({}) as any) : ({} as any);
    const fileId = task.file_id || knownFile;
    const ready = task.phase === 'PHASE_TYPE_COMPLETE' || (!task.phase && Boolean(fileId));
    let files: DebridFile[] = [];
    if (ready && fileId) {
      const file = await debridFetch(`${PP}/files/${fileId}`, {headers: ppAuth(token)});
      files = file.kind === 'drive#folder' ? await ppFiles(token, fileId) : [{id: file.id, name: file.name, size: Number(file.size) || 0}];
    }
    return {id, name: task.name || task.file_name || 'PikPak', progress: ready ? 1 : (Number(task.progress) || 0) / 100, ready, status: task.phase || 'unknown', error: task.phase === 'PHASE_TYPE_ERROR' ? task.message : undefined, files};
  },
  async list(token) {
    const filters = encodeURIComponent(JSON.stringify({trashed: {eq: false}, phase: {eq: 'PHASE_TYPE_COMPLETE'}}));
    const page = (parent: string) =>
      debridFetch(`${PP}/files?parent_id=${parent}&limit=100&filters=${filters}`, {headers: ppAuth(token)}).then((data: any) => (data?.files || []) as any[]);
    const top = await page('');
    // Downloads land in PikPak's download folder, so its contents list at the top.
    const packs = top.filter(file => file.kind === 'drive#folder' && file.folder_type === 'DOWNLOAD');
    const inner = (await Promise.all(packs.map(folder => page(folder.id).catch(() => [])))).flat();
    return [...top.filter(file => !packs.includes(file)), ...inner].map(file => ({
      id: `|${file.id}`,
      name: file.name,
      progress: 1,
      ready: true,
      status: 'ready',
      files: file.kind === 'drive#file' ? [{id: file.id, name: file.name, size: Number(file.size) || 0}] : [],
    }));
  },
  async fileLink(token, _transfer, file) {
    const data = await debridFetch(`${PP}/files/${file.id}?thumbnail_size=SIZE_MEDIUM`, {headers: ppAuth(token)});
    const media = (data.medias || []).find((item: any) => item.link?.url);
    const link = data.web_content_link || data.links?.['application/octet-stream']?.url || media?.link?.url;
    if (!link) throw new Error('PikPak has no link for this file yet');
    return link;
  },
};
