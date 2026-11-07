import {ensureDownloadLocationAccess, getDownloadFileName} from '../downloadLocation';
import {scheduleQueuedDownloads} from '../downloadManager';
import {settingsStorage} from '../storage';
import useDownloadsStore, {CURRENT_DOWNLOAD_STATUSES, type DownloadInput, type DownloadItem} from '../zustand/downloadsStore';
import {BROWSER_AGENT, extensionOf} from './http';
import {itemFileName, socialFolders, songFileName, songVideoFileName} from './paths';
import {QUALITY_LABELS, type DownloadPlan, type SocialQuality} from './select';
import {SITE_LABELS} from './urls';
import type {SocialMediaItem, SocialPost, SocialSite, SocialVideoJob} from './types';

const REFERERS: Record<SocialSite, string> = {
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
  twitter: 'https://x.com/',
  threads: 'https://www.threads.com/',
  pinterest: 'https://www.pinterest.com/',
  reddit: 'https://www.reddit.com/',
  tumblr: 'https://www.tumblr.com/',
};

/** Headers for the image and video files: a browser, coming from the site. No cookies are needed for these. */
export const mediaHeaders = (site: SocialSite): Record<string, string> => ({
  'User-Agent': BROWSER_AGENT,
  Referer: REFERERS[site],
});

/** "Photo 2", "Video", "Profile picture": the name shown in Downloads. */
export const itemLabel = (post: SocialPost, item: SocialMediaItem): string => {
  if (item.postId === 'profile') return 'Profile picture';
  const kind = item.kind === 'video' ? 'Video' : 'Photo';
  const posts = new Set(post.items.filter(other => other.postId !== 'profile').map(other => other.postId)).size;
  const inPost = post.items.filter(other => other.postId === item.postId && other.kind === item.kind).length;
  const prefix = posts > 1 ? `${item.postId} ` : '';
  return inPost > 1 ? `${prefix}${kind} ${item.index}` : `${prefix}${kind}`;
};

const newId = (): string => `social-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const inQueue = (existing: DownloadItem[], url: string, sourceType: DownloadItem['sourceType']) =>
  existing.some(item => item.url === url && item.sourceType === sourceType && CURRENT_DOWNLOAD_STATUSES.has(item.status));

export interface SocialRecordOptions {
  quality: SocialQuality;
  secondsPerImage: number;
  crossfade: boolean;
}

/**
 * The download records for a plan. Pure, so the rules can be tested: photos
 * and videos are plain file downloads, the song too; the "photo with song"
 * video is one record that the social backend makes on the phone.
 */
export const buildSocialRecords = (
  post: SocialPost,
  plan: DownloadPlan,
  options: SocialRecordOptions,
  existing: DownloadItem[],
  makeId: () => string = newId,
): {records: DownloadInput[]; duplicates: number} => {
  const folders = socialFolders(post);
  const site = SITE_LABELS[post.site];
  const headers = mediaHeaders(post.site);
  const records: DownloadInput[] = [];
  let duplicates = 0;
  const base = (label: string, fileName: string, ext: string, url: string, poster?: string): DownloadInput => ({
    id: makeId(),
    title: `${folders.subFolder} · ${label}`,
    type: 'series',
    ...folders,
    episodeName: label,
    url,
    poster,
    provider: site,
    infoUrl: post.url,
    videoType: ext,
    displayFileName: getDownloadFileName(fileName, ext),
    filePath: '',
    status: 'queued',
    headers,
    sourceType: 'http',
  });
  for (const {item, variant} of plan.files) {
    if (inQueue(existing, variant.url, 'http')) {
      duplicates += 1;
      continue;
    }
    const ext = item.kind === 'video' ? 'mp4' : item.ext || extensionOf(variant.url, 'jpg');
    records.push({
      ...base(itemLabel(post, item), itemFileName(post, item), ext, variant.url, item.thumbnail),
      episodeIndex: item.index,
      quality: item.kind === 'image' ? QUALITY_LABELS[options.quality] : undefined,
    });
  }
  const music = post.music;
  if (music && plan.song) {
    if (inQueue(existing, music.url, 'http')) duplicates += 1;
    else {
      const ext = extensionOf(music.url, 'm4a') === 'mp3' ? 'mp3' : 'm4a';
      records.push(base(music.title ? `Song: ${music.title}` : 'Song', songFileName(post), ext, music.url, plan.files[0]?.item.thumbnail));
    }
  }
  if (music && plan.videoImages.length) {
    const job: SocialVideoJob = {
      images: plan.videoImages.map(({item, variant}) => ({url: variant.url, ext: item.ext || 'jpg'})),
      audioUrl: music.url,
      headers,
      start: music.start,
      duration: music.clip,
      secondsPerImage: options.secondsPerImage,
      crossfade: options.crossfade,
      width: plan.videoImages[0].variant.width,
      height: plan.videoImages[0].variant.height,
    };
    if (inQueue(existing, post.url, 'social')) {
      duplicates += 1;
    } else {
      records.push({
        ...base('Video with song', songVideoFileName(post), 'mp4', post.url, plan.videoImages[0].item.thumbnail),
        sourceType: 'social',
        headers: undefined,
        social: job,
      });
    }
  }
  return {records, duplicates};
};

/** Adds the plan to Downloads. Returns how many were added and how many were already there. */
export const enqueueSocial = async (
  post: SocialPost,
  plan: DownloadPlan,
  options: SocialRecordOptions,
): Promise<{added: number; duplicates: number} | undefined> => {
  const location = await ensureDownloadLocationAccess(settingsStorage.getDownloadLocationConfig());
  if (!location) return undefined;
  settingsStorage.setDownloadLocation(location);
  const store = useDownloadsStore.getState();
  const {records, duplicates} = buildSocialRecords(post, plan, options, Object.values(store.downloads));
  for (const record of records) store.enqueueDownload({...record, downloadLocation: location});
  await scheduleQueuedDownloads();
  return {added: records.length, duplicates};
};
