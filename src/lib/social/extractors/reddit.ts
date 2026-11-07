import {asArray, asNumber, asRecord, asString, decodeHtml, extensionOf, parseJson} from '../http';
import {classifySocialUrl} from '../urls';
import {SocialError, type SocialExtractor, type SocialMediaItem, type SocialPost, type SocialVariant} from '../types';

const clean = (url: string | undefined): string => decodeHtml(url || '');

/** Sizes from a preview entry: the source, then the smaller resolutions. */
const previewVariants = (image: Record<string, unknown> | undefined): SocialVariant[] => {
  const source = asRecord(image?.source);
  const list = [source, ...asArray(image?.resolutions).map(asRecord).reverse()].filter(Boolean) as Record<string, unknown>[];
  return list
    .map(entry => ({url: clean(asString(entry.url)), width: asNumber(entry.width), height: asNumber(entry.height)}))
    .filter(variant => variant.url);
};

const galleryItems = (post: Record<string, unknown>, postId: string): SocialMediaItem[] => {
  const metadata = asRecord(post.media_metadata) || {};
  const order = asArray(asRecord(post.gallery_data)?.items)
    .map(entry => asString(asRecord(entry)?.media_id))
    .filter((id): id is string => Boolean(id));
  const ids = order.length ? order : Object.keys(metadata);
  const items: SocialMediaItem[] = [];
  ids.forEach((mediaId, position) => {
    const media = asRecord(metadata[mediaId]);
    if (!media || media.status === 'failed') return;
    const source = asRecord(media.s);
    const previews = asArray(media.p).map(asRecord).filter(Boolean) as Record<string, unknown>[];
    const thumbnail = clean(asString(previews[Math.min(1, previews.length - 1)]?.u)) || undefined;
    const index = position + 1;
    // Animated images come as MP4 or GIF.
    if (media.e === 'AnimatedImage' && (source?.mp4 || source?.gif)) {
      const url = clean(asString(source?.mp4) || asString(source?.gif));
      items.push({id: mediaId, kind: source?.mp4 ? 'video' : 'image', variants: [{url, width: asNumber(source?.x), height: asNumber(source?.y)}], thumbnail, ext: source?.mp4 ? 'mp4' : 'gif', postId, index});
      return;
    }
    const url = clean(asString(source?.u));
    if (!url) return;
    const mime = asString(media.m) || '';
    // The full file without resizing lives on i.redd.it.
    const original = `https://i.redd.it/${mediaId}.${mime.split('/')[1]?.replace('jpeg', 'jpg') || extensionOf(url, 'jpg')}`;
    items.push({
      id: mediaId,
      kind: 'image',
      variants: [{url: original, width: asNumber(source?.x), height: asNumber(source?.y)}, {url}],
      thumbnail,
      ext: extensionOf(original, 'jpg'),
      postId,
      index,
    });
  });
  return items;
};

/** Reads one post from Reddit's JSON listing. */
export const parseRedditPost = (json: unknown, url: string): SocialPost => {
  const listing = asArray(json)[0];
  let post = asRecord(asRecord(asArray(asRecord(asRecord(listing)?.data)?.children)[0])?.data);
  if (!post) throw new SocialError('notFound', 'This post was not found.');
  // A crosspost points at the original.
  const parent = asRecord(asArray(post.crosspost_parent_list)[0]);
  if (parent && !post.media_metadata && !post.preview) post = parent;
  const postId = asString(post.id) || 'post';
  const author = asString(post.author) || 'reddit';
  let items: SocialMediaItem[] = [];
  if (post.is_gallery === true || post.media_metadata) items = galleryItems(post, postId);
  const link = clean(asString(post.url_overridden_by_dest) || asString(post.url));
  const preview = asRecord(asArray(asRecord(post.preview)?.images)[0]);
  if (!items.length && post.is_video !== true) {
    if (/^https:\/\/i\.redd\.it\//.test(link) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(link)) {
      const sizes = previewVariants(preview);
      const source = sizes[0];
      items.push({
        id: postId,
        kind: 'image',
        variants: [{url: link, width: source?.width, height: source?.height}, ...sizes],
        thumbnail: sizes[Math.min(2, sizes.length - 1)]?.url || link,
        ext: extensionOf(link, 'jpg'),
        postId,
        index: 1,
      });
    } else if (preview) {
      // A link post: its preview picture is all there is.
      const sizes = previewVariants(preview);
      if (sizes.length) items.push({id: postId, kind: 'image', variants: sizes, thumbnail: sizes[sizes.length - 1].url, ext: extensionOf(sizes[0].url, 'jpg'), postId, index: 1});
    }
  }
  const hasVideo = post.is_video === true || Boolean(asRecord(post.secure_media)?.reddit_video);
  if (hasVideo) {
    // Reddit keeps the sound in a separate file, so yt-dlp saves these.
    const sizes = previewVariants(preview);
    items.push({
      id: `${postId}-video`,
      kind: 'video',
      variants: [],
      thumbnail: sizes[sizes.length - 1]?.url,
      ext: 'mp4',
      postId,
      index: items.length + 1,
      needsYtdl: true,
      pageUrl: url,
    });
  }
  if (!items.length) throw new SocialError('empty', 'This post has no photos.');
  const title = decodeHtml(asString(post.title) || `Post by ${author}`);
  return {site: 'reddit', kind: 'post', url, author, title, items, hasVideo};
};

export const redditExtractor: SocialExtractor = {
  site: 'reddit',
  async extract(link, context) {
    let id = link.id;
    let url = link.url;
    if (!id) {
      // A share link: follow it to the post.
      const response = await context.fetch(link.url);
      url = response.url;
      id = classifySocialUrl(url)?.id;
      if (!id) throw new SocialError('notFound', 'This Reddit share link did not lead to a post.');
    }
    const api = (host: string) => `https://${host}/comments/${id}/.json?raw_json=1&limit=1`;
    let response = await context.fetch(api('www.reddit.com'), {headers: {Accept: 'application/json'}});
    // Signed out, Reddit sometimes blocks the main site but not old.reddit.com.
    if (response.status === 403 || response.status === 429 || !response.text.trim().startsWith('[')) {
      response = await context.fetch(api('old.reddit.com'), {headers: {Accept: 'application/json'}});
    }
    if (!response.text.trim().startsWith('[') && response.status < 400) {
      throw new SocialError('signIn', 'Reddit blocked the request. Sign in to Reddit under Video downloader > Cookies and try again.');
    }
    return parseRedditPost(parseJson(response, 'This post'), url);
  },
};
