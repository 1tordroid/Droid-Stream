import {NativeModules} from 'react-native';
import {downloadManager} from './downloader';
import {fileCategory, findDuplicate, parseDashRepresentations, parseHlsVariants} from './downloadEngine/planner';
import useDownloadsStore from './zustand/downloadsStore';
import {setEngineOptions, type DownloadEngineOptions} from './downloadEngine/engineStore';

const linksIn = (text: string): string[] =>
  Array.from(text.matchAll(/magnet:\?[^\s]+|https?:\/\/[^\s]+/gi)).map(match => match[0]);

export const detectLinks = (text: string): string[] => linksIn(text);

export interface ProbedLink {
  url: string;
  fileName: string;
  size: number;
  mime: string;
  category: string;
  acceptRanges: boolean;
  variants: {url: string; label: string; kind: string}[];
}

export const probeLink = async (url: string): Promise<ProbedLink> => {
  const native = NativeModules.HttpDownloadModule;
  const probed = native?.probe ? await native.probe(url, null) : {};
  let variants: ProbedLink['variants'] = [];
  if (/\.m3u8(\?|$)/i.test(url) || /\.mpd(\?|$)/i.test(url)) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      variants = (url.includes('.mpd') ? parseDashRepresentations(text, url) : parseHlsVariants(text, url))
        .map(item => ({url: item.url, label: item.label, kind: item.kind}));
    } catch {
      variants = [];
    }
  }
  const fileName = probed.fileName || url.split('/').pop()?.split('?')[0] || 'download';
  return {
    url,
    fileName,
    size: Number(probed.size || 0),
    mime: probed.mime || '',
    category: fileCategory(fileName, probed.mime || ''),
    acceptRanges: probed.acceptRanges !== false,
    variants,
  };
};

/** Streams with several qualities: the choices, best first, with duplicates removed. */
export const qualityChoices = (variants: ProbedLink['variants'], limit = 4): ProbedLink['variants'] => {
  const seen = new Set<string>();
  const rank = (label: string) => Number(label.match(/\d+/)?.[0] || 0) * (/kbps/i.test(label) ? 0.001 : 1);
  return variants
    .filter(item => item.kind !== 'audio' && item.kind !== 'subtitle')
    .filter(item => !seen.has(item.label) && Boolean(seen.add(item.label)))
    .sort((left, right) => rank(right.label) - rank(left.label))
    .slice(0, limit);
};

export const queueLink = async (
  url: string,
  fileName?: string,
  /** DASH choice or debrid file, kept so the engine can use it later. */
  engine?: DownloadEngineOptions,
): Promise<'queued' | 'duplicate'> => {
  const name = fileName || url.split('/').pop()?.split('?')[0] || 'download';
  const existing = Object.values(useDownloadsStore.getState().downloads).map(item => ({
    url: item.url,
    fileName: item.displayFileName,
    size: item.totalBytes,
  }));
  if (findDuplicate(existing, {url, fileName: name})) return 'duplicate';
  const extension = name.includes('.') ? name.split('.').pop() || 'mp4' : 'mp4';
  const downloadId = `link-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  if (engine) setEngineOptions(downloadId, engine);
  await downloadManager({
    downloadId,
    // The saved file may change format (an HLS stream becomes one video), so the title has no extension.
    title: name.replace(/\.[^.]+$/, ''),
    mediaType: 'movie',
    url,
    fileName: name.replace(/\.[^.]+$/, ''),
    fileType: /\.m3u8(\?|$)/i.test(url) ? 'm3u8' : extension,
    provider: 'Link',
    deleteDownload: () => undefined,
  });
  return 'queued';
};
