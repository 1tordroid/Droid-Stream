import type {SocialMediaItem, SocialPost, SocialVariant} from './types';

export type SocialQuality = 'original' | 'large' | 'medium';

export const QUALITY_LABELS: Record<SocialQuality, string> = {
  original: 'Original',
  large: 'Up to 1080 px wide',
  medium: 'Up to 640 px wide',
};

const LIMIT: Record<SocialQuality, number> = {original: Infinity, large: 1080, medium: 640};

/** The size to save. Variants are largest first; sizes with no width count as the original. */
export const pickVariant = (item: SocialMediaItem, quality: SocialQuality): SocialVariant | undefined => {
  if (!item.variants.length) return undefined;
  if (quality === 'original') return item.variants[0];
  const limit = LIMIT[quality];
  // Limits are widths, as sites name their sizes ("1080 wide").
  const fits = item.variants.find(variant => variant.width !== undefined && variant.width <= limit);
  return fits || item.variants[item.variants.length - 1];
};

/** Items shown in the grid: "Photos only" hides the videos of mixed carousels. */
export const visibleItems = (items: SocialMediaItem[], photosOnly: boolean): SocialMediaItem[] =>
  photosOnly ? items.filter(item => item.kind === 'image') : items;

/** The picked items, in post order. */
export const chosenItems = (items: SocialMediaItem[], selected: ReadonlySet<string>, photosOnly: boolean): SocialMediaItem[] =>
  visibleItems(items, photosOnly).filter(item => selected.has(item.id));

/** Everything selectable starts selected, except the profile picture of a profile batch. */
export const defaultSelection = (post: SocialPost): Set<string> =>
  new Set(post.items.filter(item => !(post.kind === 'profile' && item.postId === 'profile' && post.items.length > 1)).map(item => item.id));

export const toggleItem = (selected: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export interface MusicChoice {
  photo: boolean;
  song: boolean;
  video: boolean;
}

export interface PlannedFile {
  item: SocialMediaItem;
  variant: SocialVariant;
}

export interface DownloadPlan {
  /** Photos and videos saved as files. */
  files: PlannedFile[];
  /** Videos with no direct file: these go to the video downloader. */
  ytdl: SocialMediaItem[];
  /** Save the song as its own file. */
  song: boolean;
  /** Photos for the "photo with song" video. */
  videoImages: PlannedFile[];
}

/** What to save for the picked items and choices. */
export const planDownloads = (
  post: SocialPost,
  selected: ReadonlySet<string>,
  options: {photosOnly: boolean; quality: SocialQuality; music?: MusicChoice},
): DownloadPlan => {
  const items = chosenItems(post.items, selected, options.photosOnly);
  const music = post.music ? options.music || {photo: true, song: false, video: false} : undefined;
  const files: PlannedFile[] = [];
  const ytdl: SocialMediaItem[] = [];
  for (const item of items) {
    if (item.needsYtdl || !item.variants.length) {
      if (item.kind === 'video') ytdl.push(item);
      continue;
    }
    if (music && !music.photo && item.kind === 'image') continue;
    const variant = pickVariant(item, options.quality);
    if (variant) files.push({item, variant});
  }
  const videoImages = music?.video
    ? items
        .filter(item => item.kind === 'image' && item.variants.length)
        .map(item => ({item, variant: pickVariant(item, 'large') as SocialVariant}))
    : [];
  return {files, ytdl, song: Boolean(music?.song), videoImages};
};

/** Number of files a plan saves, for the button label. */
export const planCount = (plan: DownloadPlan): number =>
  plan.files.length + (plan.song ? 1 : 0) + (plan.videoImages.length ? 1 : 0);
