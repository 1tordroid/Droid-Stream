import {authFailureInBody, DebridAuthError, keyedFetch} from './auth';
import {form, FORM_HEADERS} from './http';
import type {DebridFile, DebridService, DebridTransfer} from './types';

const hashOf = (magnet: string): string | undefined => magnet.match(/btih:([a-z0-9]{32,40})/i)?.[1]?.toLowerCase();

// ---------------------------------------------------------------- TorBox
const TB = 'https://api.torbox.app/v1/api';
const tbAuth = (key: string) => ({Authorization: `Bearer ${key}`});
const tbFetch = keyedFetch('torbox', 'TorBox');

const tbTransfer = (data: any): DebridTransfer => ({
  id: String(data.id),
  name: data.name || 'TorBox',
  progress: Math.min(1, Number(data.progress) || (data.download_finished ? 1 : 0)),
  ready: Boolean(data.download_finished && data.download_present),
  status: data.download_state || (data.download_finished ? 'ready' : 'downloading'),
  files: (data.files || []).map((file: any) => ({id: String(file.id), name: file.short_name || file.name, size: Number(file.size) || 0})),
});

export const torbox: DebridService = {
  id: 'torbox',
  name: 'TorBox',
  keyUrl: 'https://torbox.app/settings',
  keyHelp: 'TorBox → Settings → API key',
  canCheckCache: true,
  async account(key) {
    const data = await tbFetch(key, `${TB}/user/me`, {headers: tbAuth(key)});
    const user = data.data || {};
    return {username: user.email || 'TorBox', premium: Number(user.plan) > 0, expiresAt: user.premium_expires_at ? Date.parse(user.premium_expires_at) : undefined};
  },
  async checkCached(key, hashes) {
    const out: Record<string, boolean> = {};
    for (let i = 0; i < hashes.length; i += 80) {
      const chunk = hashes.slice(i, i + 80);
      const data = await tbFetch(key, `${TB}/torrents/checkcached?hash=${chunk.join(',')}&format=list&list_files=false`, {headers: tbAuth(key)});
      chunk.forEach(hash => (out[hash] = false));
      const list = Array.isArray(data.data) ? data.data : Object.values(data.data || {});
      list.forEach((item: any) => item?.hash && (out[String(item.hash).toLowerCase()] = true));
    }
    return out;
  },
  async addMagnet(key, magnet) {
    const body = new FormData();
    body.append('magnet', magnet);
    body.append('seed', '3');
    const data = await tbFetch(key, `${TB}/torrents/createtorrent`, {method: 'POST', headers: tbAuth(key), body});
    const id = data.data?.torrent_id ?? data.data?.id;
    if (id === undefined) throw new Error(data.detail || 'TorBox did not accept the magnet');
    return {id: String(id)};
  },
  async status(key, id) {
    const data = await tbFetch(key, `${TB}/torrents/mylist?id=${id}&bypass_cache=true`, {headers: tbAuth(key)});
    return tbTransfer(data.data || {});
  },
  async fileLink(key, transfer, file) {
    // requestdl takes the key as ?token=; it stays there until TorBox documents a header for it.
    const data = await tbFetch(key, `${TB}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${transfer.id}&file_id=${file.id}&zip_link=false`);
    if (typeof data.data !== 'string') throw new Error('TorBox did not return a link');
    return data.data;
  },
  async remove(key, id) {
    await tbFetch(key, `${TB}/torrents/controltorrent`, {method: 'POST', headers: {...tbAuth(key), 'Content-Type': 'application/json'}, body: JSON.stringify({torrent_id: Number(id), operation: 'delete'})});
  },
  async list(key) {
    const data = await tbFetch(key, `${TB}/torrents/mylist?bypass_cache=true`, {headers: tbAuth(key)});
    return (data.data || []).map(tbTransfer);
  },
};

// ---------------------------------------------------------------- Real-Debrid
const RD = 'https://api.real-debrid.com/rest/1.0';
const rdAuth = (key: string) => ({Authorization: `Bearer ${key}`});
const rdFetch = keyedFetch('realdebrid', 'Real-Debrid');

const rdTransfer = (data: any): DebridTransfer => {
  const selected = (data.files || []).filter((file: any) => file.selected);
  return {
    id: String(data.id),
    name: data.filename || data.original_filename || 'Real-Debrid',
    progress: (Number(data.progress) || 0) / 100,
    ready: data.status === 'downloaded',
    status: data.status || 'unknown',
    error: /error|virus|dead|magnet_error/.test(data.status || '') ? data.status : undefined,
    // Real-Debrid lists one link per selected file, in order.
    files: selected.map((file: any, index: number) => ({
      id: String(file.id),
      name: String(file.path || '').split('/').pop() || `File ${index + 1}`,
      size: Number(file.bytes) || 0,
      link: data.links?.[index],
    })),
  };
};

export const realDebrid: DebridService = {
  id: 'realdebrid',
  name: 'Real-Debrid',
  keyUrl: 'https://real-debrid.com/apitoken',
  keyHelp: 'real-debrid.com/apitoken → copy the private API token',
  // The instant availability endpoint was retired; cache shows after adding.
  canCheckCache: false,
  async account(key) {
    const data = await rdFetch(key, `${RD}/user`, {headers: rdAuth(key)});
    return {username: data.username, premium: data.type === 'premium', expiresAt: data.expiration ? Date.parse(data.expiration) : undefined};
  },
  async checkCached() {
    return {};
  },
  async addMagnet(key, magnet) {
    const data = await rdFetch(key, `${RD}/torrents/addMagnet`, {method: 'POST', headers: {...rdAuth(key), ...FORM_HEADERS}, body: form({magnet})});
    await rdFetch(key, `${RD}/torrents/selectFiles/${data.id}`, {method: 'POST', headers: {...rdAuth(key), ...FORM_HEADERS}, body: form({files: 'all'})}).catch(() => undefined);
    return {id: String(data.id)};
  },
  async status(key, id) {
    const data = await rdFetch(key, `${RD}/torrents/info/${id}`, {headers: rdAuth(key)});
    if (data.status === 'waiting_files_selection') {
      await rdFetch(key, `${RD}/torrents/selectFiles/${id}`, {method: 'POST', headers: {...rdAuth(key), ...FORM_HEADERS}, body: form({files: 'all'})}).catch(() => undefined);
    }
    return rdTransfer(data);
  },
  async fileLink(key, _transfer, file) {
    if (!file.link) throw new Error('Real-Debrid has not made this file ready yet');
    const data = await rdFetch(key, `${RD}/unrestrict/link`, {method: 'POST', headers: {...rdAuth(key), ...FORM_HEADERS}, body: form({link: file.link})});
    return data.download;
  },
  async remove(key, id) {
    await rdFetch(key, `${RD}/torrents/delete/${id}`, {method: 'DELETE', headers: rdAuth(key)});
  },
  async list(key) {
    const rows = await rdFetch<any[]>(key, `${RD}/torrents?limit=50`, {headers: rdAuth(key)});
    return (rows || []).map(row => ({...rdTransfer(row), files: []}));
  },
};

// ---------------------------------------------------------------- AllDebrid
const AD = 'https://api.alldebrid.com';
const adFetch = keyedFetch('alldebrid', 'AllDebrid');
/** Throws AllDebrid's error with its code kept, and a DebridAuthError when the key was refused. */
const adCheck = (data: any) => {
  if (data?.status !== 'success') {
    const code = data?.error?.code;
    const message = data?.error?.message || 'AllDebrid error';
    const state = authFailureInBody('alldebrid', data);
    if (state) throw new DebridAuthError(message, 'alldebrid', state, code);
    throw Object.assign(new Error(message), {code});
  }
  return data.data;
};
// The key goes in the Authorization header, as AllDebrid's docs ask, so it
// never sits in a URL. https://docs.alldebrid.com/
const adGet = (key: string, path: string, params = '') =>
  adFetch(key, `${AD}${path}?agent=droidstream${params}`, {headers: {Authorization: `Bearer ${key}`}}, adCheck);

const flattenAd = (nodes: any[], out: DebridFile[] = []): DebridFile[] => {
  for (const node of nodes || []) {
    if (node.l) out.push({id: node.l, name: node.n, size: Number(node.s) || 0, link: node.l});
    else if (node.link) out.push({id: node.link, name: node.filename || node.n, size: Number(node.size || node.s) || 0, link: node.link});
    if (node.e) flattenAd(node.e, out);
    if (node.files) flattenAd(node.files, out);
  }
  return out;
};

export const allDebrid: DebridService = {
  id: 'alldebrid',
  name: 'AllDebrid',
  keyUrl: 'https://alldebrid.com/apikeys',
  keyHelp: 'alldebrid.com/apikeys → create a key',
  canCheckCache: false,
  async account(key) {
    const data = await adGet(key, '/v4/user');
    return {username: data.user?.username, premium: Boolean(data.user?.isPremium), expiresAt: data.user?.premiumUntil ? data.user.premiumUntil * 1000 : undefined};
  },
  async checkCached() {
    return {};
  },
  async addMagnet(key, magnet) {
    const data = await adGet(key, '/v4/magnet/upload', `&magnets[]=${encodeURIComponent(magnet)}`);
    const item = data.magnets?.[0];
    if (!item || item.error) throw new Error(item?.error?.message || 'AllDebrid did not accept the magnet');
    return {id: String(item.id)};
  },
  async status(key, id) {
    const data = await adGet(key, '/v4.1/magnet/status', `&id=${id}`);
    const magnet = Array.isArray(data.magnets) ? data.magnets[0] : data.magnets;
    const ready = Number(magnet?.statusCode) === 4;
    let files: DebridFile[] = flattenAd(magnet?.links || []);
    if (ready && !files.length) {
      const fileData = await adGet(key, '/v4/magnet/files', `&id[]=${id}`);
      files = flattenAd(fileData.magnets?.[0]?.files || []);
    }
    return {
      id: String(id),
      name: magnet?.filename || 'AllDebrid',
      progress: ready ? 1 : magnet?.size ? Number(magnet.downloaded || 0) / Number(magnet.size) : 0,
      ready,
      status: magnet?.status || 'unknown',
      error: Number(magnet?.statusCode) >= 5 ? magnet?.status : undefined,
      files,
    };
  },
  async fileLink(key, _transfer, file) {
    const data = await adGet(key, '/v4/link/unlock', `&link=${encodeURIComponent(file.link || file.id)}`);
    return data.link;
  },
  async remove(key, id) {
    await adGet(key, '/v4/magnet/delete', `&id=${id}`);
  },
};

// ---------------------------------------------------------------- Premiumize
const PM = 'https://www.premiumize.me/api';
const pmFetch = keyedFetch('premiumize', 'Premiumize');
const pmCheck = (data: any) => {
  if (data?.status && data.status !== 'success') {
    // Premiumize answers a missing, invalid or expired key with HTTP 200 and
    // the code authentication_failed, so the body decides, not the status.
    const state = authFailureInBody('premiumize', data);
    if (state) throw new DebridAuthError(data.message || 'Premiumize error', 'premiumize', state, data.code);
    throw new Error(data.message || 'Premiumize error');
  }
  return data;
};
// Premiumize's docs recommend the Bearer header for the API key; ?apikey= is
// their legacy form. https://www.premiumize.me/api
const pmGet = (key: string, url: string, init: RequestInit = {}) =>
  pmFetch(key, url, {...init, headers: {...(init.headers as Record<string, string>), Authorization: `Bearer ${key}`}}, pmCheck);

export const premiumize: DebridService = {
  id: 'premiumize',
  name: 'Premiumize',
  keyUrl: 'https://www.premiumize.me/account',
  keyHelp: 'premiumize.me/account → API key',
  canCheckCache: true,
  async account(key) {
    const data = await pmGet(key, `${PM}/account/info`);
    return {username: String(data.customer_id || 'Premiumize'), premium: Number(data.premium_until) * 1000 > Date.now(), expiresAt: data.premium_until ? data.premium_until * 1000 : undefined};
  },
  async checkCached(key, hashes) {
    const out: Record<string, boolean> = {};
    for (let i = 0; i < hashes.length; i += 100) {
      const chunk = hashes.slice(i, i + 100);
      const data = await pmGet(key, `${PM}/cache/check?${chunk.map(hash => `items[]=${hash}`).join('&')}`);
      chunk.forEach((hash, index) => (out[hash] = Boolean(data.response?.[index])));
    }
    return out;
  },
  async addMagnet(key, magnet) {
    // Cached items come back at once from directdl; others become a transfer.
    try {
      const direct = await pmGet(key, `${PM}/transfer/directdl`, {method: 'POST', headers: FORM_HEADERS, body: form({src: magnet})});
      if (direct.content?.length) {
        directCache.set(`direct:${hashOf(magnet)}`, direct.content);
        return {id: `direct:${hashOf(magnet)}`};
      }
    } catch (error) {
      // A refused key fails the transfer too, so say so now.
      if (error instanceof DebridAuthError) throw error;
      // Not cached; fall through to a transfer.
    }
    const data = await pmGet(key, `${PM}/transfer/create`, {method: 'POST', headers: FORM_HEADERS, body: form({src: magnet})});
    return {id: String(data.id)};
  },
  async status(key, id) {
    if (id.startsWith('direct:')) {
      const content = directCache.get(id) || [];
      return {id, name: content[0]?.path?.split('/')[0] || 'Premiumize', progress: 1, ready: true, status: 'cached', files: content.map(toPmFile)};
    }
    const list = await pmGet(key, `${PM}/transfer/list`);
    const transfer = (list.transfers || []).find((item: any) => String(item.id) === id);
    if (!transfer) throw new Error('Transfer not found');
    const ready = transfer.status === 'finished';
    let files: DebridFile[] = [];
    if (ready && transfer.folder_id) {
      const folder = await pmGet(key, `${PM}/folder/list?id=${transfer.folder_id}&includebreadcrumbs=false`);
      files = (folder.content || []).filter((item: any) => item.type === 'file').map(toPmFile);
    } else if (ready && transfer.file_id) {
      const item = await pmGet(key, `${PM}/item/details?id=${transfer.file_id}`);
      files = [toPmFile(item)];
    }
    return {id, name: transfer.name, progress: Number(transfer.progress) || (ready ? 1 : 0), ready, status: transfer.status, error: transfer.status === 'error' ? transfer.message : undefined, files};
  },
  async fileLink(_key, _transfer, file) {
    if (!file.link) throw new Error('No link for this file yet');
    return file.link;
  },
};

const directCache = new Map<string, any[]>();
const toPmFile = (item: any): DebridFile => ({
  id: String(item.id || item.link),
  name: String(item.name || item.path || '').split('/').pop() || 'file',
  size: Number(item.size) || 0,
  link: item.stream_link && item.stream_link !== 'null' ? item.link || item.stream_link : item.link,
});
