/**
 * The signed-in user's own PikPak drive: folders, video copies, quota, share
 * links and magnet previews. Every call goes through withPikPak, which renews
 * an ending sign-in. Original TypeScript.
 */
import {debridKey} from '../debrid';
import {debridFetch} from '../debrid/http';
import {withPikPak} from './session';
import {
  parsePikPakQuota,
  parseResourceList,
  parseShareLink,
  parseWhatsLink,
  pikpakQualities,
  toPikPakEntry,
  type MagnetPreview,
  type PikPakEntry,
  type PikPakQuality,
  type PikPakQuota,
  type ShareLink,
} from './parse';

const DRIVE = 'https://api-drive.mypikpak.com/drive/v1';
const VIP = 'https://api-drive.mypikpak.com/vip/v1';
/** Folders with more files than this list only the first ones. */
const MAX_ENTRIES = 1000;

const auth = (token: string) => ({Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'});

const call = <T = any>(url: string, init: RequestInit = {}): Promise<T> =>
  withPikPak(debridKey('pikpak'), token => debridFetch<T>(url, {...init, headers: {...auth(token), ...(init.headers as any)}}));

export const isPikPakSignedIn = (): boolean => Boolean(debridKey('pikpak'));

/** One folder of the drive ('' is the top). Trashed files are left out. */
export const listPikPakFolder = async (parentId: string): Promise<PikPakEntry[]> => {
  const filters = encodeURIComponent(JSON.stringify({trashed: {eq: false}}));
  const out: PikPakEntry[] = [];
  let pageToken = '';
  do {
    const data = await call(
      `${DRIVE}/files?parent_id=${encodeURIComponent(parentId)}&limit=200&thumbnail_size=SIZE_MEDIUM&filters=${filters}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`,
    );
    for (const raw of data?.files || []) {
      const entry = toPikPakEntry(raw);
      if (entry) out.push(entry);
    }
    pageToken = String(data?.next_page_token || '');
  } while (pageToken && out.length < MAX_ENTRIES);
  return out;
};

export const pikpakFileDetails = (fileId: string): Promise<any> =>
  call(`${DRIVE}/files/${encodeURIComponent(fileId)}?thumbnail_size=SIZE_LARGE`);

/** The copies of a video PikPak can play: its HLS transcodes and the original. */
export const pikpakStreams = async (fileId: string): Promise<PikPakQuality[]> => {
  const qualities = pikpakQualities(await pikpakFileDetails(fileId));
  if (!qualities.length) throw new Error('PikPak has no link for this file yet');
  return qualities;
};

/** A picture to show for an image file: the file itself, else PikPak's large thumbnail. */
export const pikpakImageUrl = async (fileId: string): Promise<string> => {
  const details = await pikpakFileDetails(fileId);
  const url = details?.web_content_link || details?.links?.['application/octet-stream']?.url || details?.thumbnail_link;
  if (!url) throw new Error('PikPak has no picture for this file');
  return String(url);
};

/** Storage, cloud download and play allowances. The transfer part is left out when PikPak does not answer it. */
export const pikpakQuota = async (): Promise<PikPakQuota> => {
  const [about, transfer] = await Promise.all([call(`${DRIVE}/about`), call(`${VIP}/quantity/list?type=transfer`).catch(() => undefined)]);
  return parsePikPakQuota(about, transfer);
};

/** A public share link with no code and no end date. */
export const sharePikPakFile = async (fileId: string): Promise<ShareLink> =>
  parseShareLink(
    await call(`${DRIVE}/share`, {
      method: 'POST',
      body: JSON.stringify({file_ids: [fileId], share_to: 'publiclink', expiration_days: -1, pass_code_option: 'NOT_REQUIRED'}),
    }),
  );

const WHATSLINK = 'https://whatslink.info/api/v1/link';

/**
 * What a magnet holds before it is added: PikPak's own lookup lists every file
 * when the user is signed in; whatslink.info gives the totals and pictures
 * otherwise, or when PikPak cannot read it.
 */
export const previewMagnet = async (magnet: string, fetcher: typeof fetch = fetch): Promise<MagnetPreview> => {
  if (isPikPakSignedIn()) {
    try {
      const data = await call(`${DRIVE}/resource/list`, {method: 'POST', body: JSON.stringify({urls: magnet, page_size: 500, thumbnail_type: 'FROM_HASH'})});
      const preview = parseResourceList(data);
      if (preview && preview.files.length) return preview;
    } catch {
      // Fall through to the public lookup.
    }
  }
  const response = await fetcher(`${WHATSLINK}?url=${encodeURIComponent(magnet)}`, {headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error(`Could not look up this magnet (${response.status})`);
  return parseWhatsLink(await response.json());
};

/** PikPak's WebDAV server, for the WebDAV source the user adds with their own WebDAV login. */
export const PIKPAK_WEBDAV_SERVER = 'https://dav.mypikpak.com';
export const PIKPAK_WEBDAV_HELP = 'https://mypikpak.com';
