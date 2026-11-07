/**
 * Media objects as Instagram and Threads send them to their web clients
 * (the "v1" shape with image_versions2, and the GraphQL shape with
 * display_resources).
 */
import {asArray, asNumber, asRecord, asString, extensionOf} from './http';
import type {SocialMediaItem, SocialMusic, SocialVariant} from './types';

const bySize = (left: SocialVariant, right: SocialVariant) =>
  (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0);

const variantsFrom = (list: unknown, urlKey = 'url', widthKey = 'width', heightKey = 'height'): SocialVariant[] => {
  const seen = new Set<string>();
  return asArray(list)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map(entry => ({url: asString(entry[urlKey]) || '', width: asNumber(entry[widthKey]), height: asNumber(entry[heightKey])}))
    .filter(variant => {
      if (!variant.url || seen.has(variant.url)) return false;
      seen.add(variant.url);
      return true;
    })
    .sort(bySize);
};

/** Image sizes of a v1 media object, largest first. */
export const imageVariants = (media: Record<string, unknown>): SocialVariant[] =>
  variantsFrom(asRecord(media.image_versions2)?.candidates);

export const videoVariants = (media: Record<string, unknown>): SocialVariant[] => variantsFrom(media.video_versions);

const smallest = (variants: SocialVariant[]): string | undefined => {
  const usable = variants.filter(variant => !variant.width || variant.width >= 240);
  return (usable[usable.length - 1] || variants[variants.length - 1])?.url;
};

/** One v1 media object (a photo, a video, or one slide of a carousel). */
const v1Item = (media: Record<string, unknown>, postId: string, index: number, options: {photosForVideo?: boolean}): SocialMediaItem[] => {
  const images = imageVariants(media);
  const videos = videoVariants(media);
  const id = asString(media.pk) || asString(media.id) || `${postId}-${index}`;
  const isVideo = asNumber(media.media_type) === 2 || videos.length > 0;
  const items: SocialMediaItem[] = [];
  if (isVideo && videos.length) {
    items.push({id: `${id}-video`, kind: 'video', variants: videos, thumbnail: smallest(images), ext: 'mp4', postId, index});
  }
  if (images.length && (!isVideo || options.photosForVideo)) {
    items.push({
      id: isVideo ? `${id}-cover` : id,
      kind: 'image',
      variants: images,
      thumbnail: smallest(images),
      ext: extensionOf(images[0].url, 'jpg'),
      postId,
      index,
    });
  }
  return items;
};

/**
 * Items of a v1 media object. A carousel gives one entry per slide. A reel
 * also gives its cover photo, which is listed after the video.
 */
export const itemsFromV1 = (media: Record<string, unknown>, postId: string, withCover = true): SocialMediaItem[] => {
  const slides = asArray(media.carousel_media).map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (slides.length) return slides.flatMap((slide, position) => v1Item(slide, postId, position + 1, {}));
  return v1Item(media, postId, 1, {photosForVideo: withCover});
};

/** The song on a photo post (or a reel), from what the signed-in web client receives. */
export const musicFromV1 = (media: Record<string, unknown>): SocialMusic | undefined => {
  const info =
    asRecord(asRecord(media.music_metadata)?.music_info) ||
    asRecord(asRecord(media.clips_metadata)?.music_info);
  const asset = asRecord(info?.music_asset_info);
  const consumption = asRecord(info?.music_consumption_info);
  const url = asString(asset?.progressive_download_url) || asString(asset?.fast_start_progressive_download_url);
  if (!asset || !url) return undefined;
  const ms = (value: unknown) => {
    const number = asNumber(value);
    return number !== undefined && number >= 0 ? number / 1000 : undefined;
  };
  return {
    url,
    title: asString(asset.title),
    artist: asString(asset.display_artist),
    duration: ms(asset.duration_in_ms),
    start: ms(consumption?.audio_asset_start_time_in_ms),
    clip: ms(consumption?.overlap_duration_in_ms) || undefined,
  };
};

export const captionFromV1 = (media: Record<string, unknown>): string | undefined =>
  asString(asRecord(media.caption)?.text);

export const userFromV1 = (media: Record<string, unknown>): {username?: string; fullName?: string} => {
  const user = asRecord(media.user) || asRecord(media.owner);
  return {username: asString(user?.username), fullName: asString(user?.full_name)};
};

/** One node of the GraphQL shape ("shortcode_media" and its sidecar children). */
const graphItem = (node: Record<string, unknown>, postId: string, index: number, withCover: boolean): SocialMediaItem[] => {
  const images = variantsFrom(node.display_resources, 'src', 'config_width', 'config_height');
  const display = asString(node.display_url);
  const dimensions = asRecord(node.dimensions);
  if (display && !images.some(image => image.url === display)) {
    images.unshift({url: display, width: asNumber(dimensions?.width), height: asNumber(dimensions?.height)});
    images.sort(bySize);
  }
  const id = asString(node.id) || `${postId}-${index}`;
  const items: SocialMediaItem[] = [];
  const videoUrl = asString(node.video_url);
  const isVideo = node.is_video === true || Boolean(videoUrl);
  if (isVideo) {
    items.push({
      id: `${id}-video`,
      kind: 'video',
      variants: videoUrl ? [{url: videoUrl, width: asNumber(dimensions?.width), height: asNumber(dimensions?.height)}] : [],
      thumbnail: smallest(images),
      ext: 'mp4',
      postId,
      index,
      needsYtdl: !videoUrl,
    });
  }
  if (images.length && (!isVideo || withCover)) {
    items.push({id: isVideo ? `${id}-cover` : id, kind: 'image', variants: images, thumbnail: smallest(images), ext: extensionOf(images[0].url, 'jpg'), postId, index});
  }
  return items;
};

export const itemsFromGraph = (media: Record<string, unknown>, postId: string): SocialMediaItem[] => {
  const children = asArray(asRecord(media.edge_sidecar_to_children)?.edges)
    .map(edge => asRecord(asRecord(edge)?.node))
    .filter((node): node is Record<string, unknown> => Boolean(node));
  if (children.length) return children.flatMap((node, position) => graphItem(node, postId, position + 1, false));
  return graphItem(media, postId, 1, true);
};

export const captionFromGraph = (media: Record<string, unknown>): string | undefined =>
  asString(asRecord(asRecord(asArray(asRecord(media.edge_media_to_caption)?.edges)[0])?.node)?.text);

/** Turns "C3xYz_AbC" into the numeric media id the v1 API wants. */
export const mediaIdFromCode = (code: string): string | undefined => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // Private posts have longer codes; the id is in the first 11 characters.
  const short = code.length > 11 ? code.slice(0, 11) : code;
  let id = BigInt(0);
  for (const char of short) {
    const value = alphabet.indexOf(char);
    if (value < 0) return undefined;
    id = id * BigInt(64) + BigInt(value);
  }
  return id.toString();
};
