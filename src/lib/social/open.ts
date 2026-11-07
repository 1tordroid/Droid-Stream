import {NativeModules} from 'react-native';
import type {DownloadItem} from '../zustand/downloadsStore';

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  avif: 'image/avif',
};

/** The MIME type when a download is a picture, which the video player cannot show. */
export const downloadImageType = (item: Pick<DownloadItem, 'videoType'>): string | undefined =>
  IMAGE_TYPES[(item.videoType || '').toLowerCase()];

/** Opens a downloaded picture in the phone's gallery or photo viewer. */
export const openDownloadedImage = async (item: Pick<DownloadItem, 'filePath' | 'videoType' | 'title'>): Promise<void> => {
  const type = downloadImageType(item) || 'image/*';
  const apps = NativeModules.ExternalApps as
    | {open(url: string, mime: string | null, target: string, headers: null, title: string | null): Promise<void>}
    | undefined;
  if (!apps) throw new Error('Open the picture from your gallery app.');
  await apps.open(item.filePath, type, 'ask', null, item.title);
};
