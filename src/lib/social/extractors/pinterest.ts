import {asArray, asNumber, asRecord, asString, extensionOf, metaContent, parseJson} from '../http';
import {atPath, fillUrl, ruleRegex, siteRules} from '../rules/active';
import {classifySocialUrl} from '../urls';
import {SocialError, type SocialContext, type SocialExtractor, type SocialMediaItem, type SocialPost, type SocialVariant} from '../types';

/** Sizes of an "images" object ({orig: {url, width, height}, "736x": {...}}), largest first. */
const imageSizes = (images: unknown, sizeKeys: string[]): SocialVariant[] => {
  const record = asRecord(images);
  if (!record) return [];
  const seen = new Set<string>();
  return sizeKeys.map(key => asRecord(record[key]))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && asString(entry.url)))
    .map(entry => ({url: asString(entry.url) || '', width: asNumber(entry.width), height: asNumber(entry.height)}))
    .filter(variant => !seen.has(variant.url) && Boolean(seen.add(variant.url)));
};

const bestVideo = (videoList: unknown): SocialVariant[] => {
  const list = asRecord(videoList);
  if (!list) return [];
  return Object.values(list)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && /\.mp4(\?|$)/.test(asString(entry.url) || '')))
    .map(entry => ({url: asString(entry.url) || '', width: asNumber(entry.width), height: asNumber(entry.height)}))
    .sort((left, right) => (right.width || 0) - (left.width || 0));
};

/** Reads a pin as PinResource returns it: a photo, a video, a carousel, or an idea pin's pages. */
export const parsePin = (pin: Record<string, unknown>, url: string, rulesContext?: Pick<SocialContext, 'rules'>): SocialPost => {
  const sizeKeys = siteRules(rulesContext, 'pinterest').sizeKeys;
  const pinId = asString(pin.id) || 'pin';
  const author =
    asString(asRecord(pin.native_creator)?.username) || asString(asRecord(pin.pinner)?.username) || asString(asRecord(pin.origin_pinner)?.username) || 'pinterest';
  const items: SocialMediaItem[] = [];
  const push = (kind: 'image' | 'video', variants: SocialVariant[], thumbnail?: string) => {
    if (!variants.length) return;
    const index = items.length + 1;
    items.push({id: `${pinId}-${index}`, kind, variants, thumbnail: thumbnail || variants[variants.length - 1].url, ext: kind === 'video' ? 'mp4' : extensionOf(variants[0].url, 'jpg'), postId: pinId, index});
  };
  const pages = asArray(asRecord(pin.story_pin_data)?.pages);
  for (const page of pages) {
    for (const block of asArray(asRecord(page)?.blocks)) {
      const entry = asRecord(block);
      const videos = bestVideo(asRecord(asRecord(entry?.video)?.video_list));
      const images = imageSizes(asRecord(entry?.image)?.images, sizeKeys);
      if (videos.length) push('video', videos, images[images.length - 1]?.url);
      else push('image', images);
    }
  }
  if (!items.length) {
    for (const slot of asArray(asRecord(pin.carousel_data)?.carousel_slots)) push('image', imageSizes(asRecord(slot)?.images, sizeKeys));
  }
  if (!items.length) {
    const images = imageSizes(pin.images, sizeKeys);
    const videos = bestVideo(asRecord(pin.videos)?.video_list);
    if (videos.length) push('video', videos, images[images.length - 1]?.url);
    push('image', images);
  }
  if (!items.length) throw new SocialError('empty', 'This pin has no photos.');
  const title = asString(pin.title) || asString(pin.grid_title) || asString(pin.description)?.slice(0, 80) || `Pin by ${author}`;
  return {site: 'pinterest', kind: 'post', url, author, title: title.trim(), items, hasVideo: items.some(item => item.kind === 'video')};
};

export const pinterestExtractor: SocialExtractor = {
  site: 'pinterest',
  async extract(link, context) {
    let id = link.id;
    let url = link.url;
    if (!id) {
      // pin.it short links redirect to the pin.
      const response = await context.fetch(link.url);
      url = response.url;
      id = classifySocialUrl(url)?.id;
      if (!id) throw new SocialError('notFound', 'This Pinterest link did not lead to a pin.');
    }
    const rules = siteRules(context, 'pinterest');
    const data = JSON.stringify({options: {id, field_set_key: rules.fieldSetKey}, context: {}});
    const api = fillUrl('pinterest', rules.endpoints.resource, {
      sourceUrl: encodeURIComponent(`/pin/${id}/`),
      data: encodeURIComponent(data),
    });
    const response = await context.fetch(api, {headers: {...rules.headers}});
    if (response.status < 400) {
      const json = parseJson<unknown>(response, 'This pin');
      const pin = asRecord(atPath(json, rules.paths.pin));
      if (pin) return parsePin(pin, url, context);
    }
    // The page itself still has the picture.
    const page = await context.fetch(fillUrl('pinterest', rules.endpoints.pin, {id: encodeURIComponent(id)}));
    const image = metaContent(page.text, 'og:image');
    if (!image) throw new SocialError(page.status === 404 ? 'notFound' : 'network', 'Pinterest did not show this pin.');
    const original = image.replace(ruleRegex(rules.patterns.sizeInLink), rules.originalSize);
    return {
      site: 'pinterest',
      kind: 'post',
      url,
      author: 'pinterest',
      title: metaContent(page.text, 'og:title') || 'Pin',
      items: [{id, kind: 'image', variants: [{url: original}, {url: image}], thumbnail: image, ext: extensionOf(image, 'jpg'), postId: id, index: 1}],
    };
  },
};
