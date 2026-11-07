/**
 * Reads PikPak drive answers into small shapes the app uses: folder entries,
 * the transcoded HLS copies of a video, the storage and transfer quota, a
 * magnet's file list and share links. Pure functions, original code.
 */

export interface PikPakEntry {
  id: string;
  name: string;
  folder: boolean;
  size: number;
  mimeType?: string;
  /** A small preview picture PikPak made. */
  thumbnail?: string;
  /** Epoch ms. */
  modified?: number;
  /** The folder PikPak puts cloud downloads in. */
  downloads?: boolean;
}

const IMAGE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;

export const isImageName = (name: string): boolean => IMAGE.test(name) && !name.startsWith('.');

export const isImageEntry = (entry: Pick<PikPakEntry, 'name' | 'mimeType' | 'folder'>): boolean =>
  !entry.folder && (Boolean(entry.mimeType?.startsWith('image/')) || isImageName(entry.name));

export const toPikPakEntry = (raw: any): PikPakEntry | undefined => {
  if (!raw?.id || !raw?.name) return undefined;
  const modified = Date.parse(raw.modified_time || raw.created_time || '');
  return {
    id: String(raw.id),
    name: String(raw.name),
    folder: raw.kind === 'drive#folder',
    size: Number(raw.size) || 0,
    ...(raw.mime_type ? {mimeType: String(raw.mime_type)} : {}),
    ...(raw.thumbnail_link ? {thumbnail: String(raw.thumbnail_link)} : {}),
    ...(Number.isFinite(modified) ? {modified} : {}),
    ...(raw.folder_type === 'DOWNLOAD' ? {downloads: true} : {}),
  };
};

/** One playable copy of a video: a PikPak transcode (HLS) or the original file. */
export interface PikPakQuality {
  label: string;
  url: string;
  height?: number;
  /** HLS copies made by PikPak are m3u8; the original keeps its own container. */
  type: 'm3u8' | 'mp4';
  original: boolean;
}

const originalLink = (details: any): string =>
  String(details?.links?.['application/octet-stream']?.url || details?.web_content_link || '').trim();

const isHls = (url: string) => /\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url);

/**
 * The copies of a video to choose from, best first: PikPak's transcodes from
 * the highest resolution down, then the original file. A video PikPak has not
 * transcoded only has the original.
 */
export const pikpakQualities = (details: any): PikPakQuality[] => {
  const out: PikPakQuality[] = [];
  for (const media of Array.isArray(details?.medias) ? details.medias : []) {
    const url = String(media?.link?.url || '').trim();
    if (!url || out.some(item => item.url === url)) continue;
    const height = Number(media?.video?.height) || undefined;
    const original = Boolean(media?.is_origin);
    const name = String(media?.media_name || '').trim();
    out.push({
      label: original ? 'Original' : name || (height ? `${height}p` : 'Stream'),
      url,
      ...(height ? {height} : {}),
      type: !original || isHls(url) ? 'm3u8' : 'mp4',
      original,
    });
  }
  const file = originalLink(details);
  if (file && !out.some(item => item.url === file)) out.push({label: 'Original', url: file, type: 'mp4', original: true});
  return out.sort((a, b) => Number(a.original) - Number(b.original) || (b.height || 0) - (a.height || 0));
};

export interface QuotaUse {
  used: number;
  /** 0 when there is no limit. */
  limit: number;
}

export interface PikPakQuota {
  storage: QuotaUse & {trash: number; unlimited: boolean};
  /** Cloud downloads (magnets) PikPak fetched for you, by bytes. */
  cloudDownloads?: QuotaUse;
  /** Data downloaded from PikPak to your devices. */
  downloads?: QuotaUse;
  /** PikPak's own name for the period, such as a plan name. */
  period?: string;
  /** Free accounts can play a set number of videos a day. */
  playsToday?: QuotaUse;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const transferUse = (base: any, extra: any): QuotaUse | undefined => {
  if (!base && !extra) return undefined;
  const used = num(base?.size ?? base?.assets) + num(extra?.assets);
  const limit = num(base?.total_assets) + num(extra?.total_assets);
  return limit || used ? {used, limit} : undefined;
};

/**
 * Reads /drive/v1/about (storage) and /vip/v1/quantity/list?type=transfer
 * (transfer). The transfer part is the base allowance plus any extra package.
 */
export const parsePikPakQuota = (about: any, transfer?: any): PikPakQuota => {
  const quota = about?.quota || {};
  const playsLimit = num(quota.play_times_limit);
  const result: PikPakQuota = {
    storage: {
      used: num(quota.usage),
      limit: num(quota.limit),
      trash: num(quota.usage_in_trash),
      unlimited: Boolean(quota.is_unlimited),
    },
    ...(playsLimit > 0 ? {playsToday: {used: num(quota.play_times_usage), limit: playsLimit}} : {}),
  };
  const cloud = transferUse(transfer?.base?.offline, transfer?.transfer?.offline);
  const down = transferUse(transfer?.base?.download, transfer?.transfer?.download);
  if (cloud) result.cloudDownloads = cloud;
  if (down) result.downloads = down;
  const period = String(transfer?.base?.info || transfer?.transfer?.offline?.info || '').trim();
  if (period) result.period = period;
  return result;
};

const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export const formatQuotaBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '0 B';
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
};

/** "1.2 TB of 6 TB" or "1.2 TB used" without a limit. */
export const quotaText = (use: QuotaUse): string =>
  use.limit > 0 ? `${formatQuotaBytes(use.used)} of ${formatQuotaBytes(use.limit)}` : `${formatQuotaBytes(use.used)} used`;

/** Short lines for the quota card. */
export const quotaLines = (quota: PikPakQuota): string[] => {
  const lines = [
    `Storage: ${quota.storage.unlimited ? `${formatQuotaBytes(quota.storage.used)} used, no limit` : quotaText(quota.storage)}`,
  ];
  if (quota.cloudDownloads) lines.push(`Cloud downloads: ${quotaText(quota.cloudDownloads)}`);
  if (quota.downloads) lines.push(`Downloads to devices: ${quotaText(quota.downloads)}`);
  if (quota.playsToday) lines.push(`Plays today: ${quota.playsToday.used} of ${quota.playsToday.limit}`);
  return lines;
};

export interface MagnetPreviewFile {
  name: string;
  /** Folders inside the torrent, joined with "/". */
  path: string;
  size: number;
}

export interface MagnetPreview {
  name: string;
  size: number;
  /** Number of files; can be more than `files` holds when only totals are known. */
  count: number;
  files: MagnetPreviewFile[];
  /** Preview pictures, when the lookup has them. */
  screenshots: string[];
  source: 'pikpak' | 'whatslink';
}

/**
 * Reads PikPak's magnet lookup (POST /drive/v1/resource/list): one resource
 * for the magnet, folders with their own resources inside.
 */
export const parseResourceList = (data: any): MagnetPreview | undefined => {
  const top = data?.list?.resources?.[0];
  if (!top) return undefined;
  const files: MagnetPreviewFile[] = [];
  const walk = (resources: any[], path: string, depth: number) => {
    for (const item of resources || []) {
      const name = String(item?.name || '');
      if (!name) continue;
      if (item.is_dir) {
        if (depth < 6) walk(item?.dir?.resources || [], path ? `${path}/${name}` : name, depth + 1);
      } else {
        files.push({name, path, size: num(item.file_size)});
      }
    }
  };
  if (top.is_dir) walk(top?.dir?.resources || [], '', 0);
  else files.push({name: String(top.name || 'File'), path: '', size: num(top.file_size)});
  const size = num(top.file_size) || files.reduce((total, file) => total + file.size, 0);
  return {name: String(top.name || 'Magnet'), size, count: num(top.file_count) || files.length, files, screenshots: [], source: 'pikpak'};
};

/** Reads whatslink.info's answer: totals and preview pictures, no file list. */
export const parseWhatsLink = (data: any): MagnetPreview => {
  if (!data || data.error) throw new Error(typeof data?.error === 'string' && data.error ? data.error : 'No details for this magnet yet');
  const screenshots: string[] = (Array.isArray(data.screenshots) ? data.screenshots : [])
    .map((item: any) => (typeof item === 'string' ? item : item?.screenshot))
    .filter((url: unknown): url is string => typeof url === 'string' && url.startsWith('http'));
  return {name: String(data.name || 'Magnet'), size: num(data.size), count: num(data.count), files: [], screenshots, source: 'whatslink'};
};

export interface ShareLink {
  url: string;
  passCode?: string;
}

export const parseShareLink = (data: any): ShareLink => {
  const url = String(data?.share_url || data?.url || '').trim();
  if (!url) throw new Error(data?.error || 'No share link came back');
  const passCode = String(data?.pass_code || '').trim();
  return {url, ...(passCode ? {passCode} : {})};
};

/** Text to send with the system share sheet. */
export const shareMessage = (name: string, link: ShareLink): string =>
  [name, link.url, ...(link.passCode ? [`Code: ${link.passCode}`] : [])].join('\n');
