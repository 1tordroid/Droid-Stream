import {asNumber, asRecord, asString, decodeHtml, extensionOf, jsonScripts, metaContent, walkJson} from '../http';
import {SocialError, type SocialExtractor, type SocialMediaItem, type SocialPost, type SocialVariant} from '../types';

const SIGN_IN = 'Facebook did not show this post. Sign in to Facebook under Video downloader > Cookies, then try again.';

const imageOf = (value: unknown): SocialVariant | undefined => {
  const image = asRecord(value);
  const url = asString(image?.uri);
  return url ? {url, width: asNumber(image?.width), height: asNumber(image?.height)} : undefined;
};

const unescapeJsonString = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\\//g, '/');
  }
};

/** Photos in a Facebook page, as its web app receives them. */
export const parseFacebookPage = (html: string, url: string, user?: string): SocialPost => {
  const photos = new Map<string, SocialVariant[]>();
  const add = (id: string, variants: (SocialVariant | undefined)[]) => {
    const list = variants.filter((variant): variant is SocialVariant => Boolean(variant));
    if (!list.length || photos.has(id)) return;
    const seen = new Set<string>();
    photos.set(
      id,
      list
        .filter(variant => !seen.has(variant.url) && Boolean(seen.add(variant.url)))
        .sort((left, right) => (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0)),
    );
  };
  for (const blob of jsonScripts(html)) {
    walkJson(blob, node => {
      if (node.__typename !== 'Photo') return;
      const id = asString(node.id) || String(photos.size + 1);
      add(id, [imageOf(node.viewer_image), imageOf(node.photo_image), imageOf(node.image), imageOf(node.max_image)]);
    });
  }
  if (!photos.size) {
    // Pages without JSON blocks still name the full-size image.
    for (const match of html.matchAll(/"viewer_image":\{"height":(\d+),"width":(\d+),"uri":"((?:[^"\\]|\\.)+)"/g)) {
      const link = unescapeJsonString(match[3]);
      add(link, [{url: link, width: Number(match[2]), height: Number(match[1])}]);
    }
  }
  const hasVideo = /"(?:browser_native_hd_url|browser_native_sd_url|playable_url)":"https?:/.test(html);
  const items: SocialMediaItem[] = [...photos.entries()].map(([id, variants], position) => ({
    id,
    kind: 'image',
    variants,
    thumbnail: variants[variants.length - 1].url,
    ext: extensionOf(variants[0].url, 'jpg'),
    postId: 'post',
    index: position + 1,
  }));
  if (!items.length && !hasVideo) {
    const og = metaContent(html, 'og:image');
    if (og && /fbcdn|scontent/.test(og)) {
      items.push({id: 'og', kind: 'image', variants: [{url: og}], thumbnail: og, ext: extensionOf(og, 'jpg'), postId: 'post', index: 1});
    }
  }
  if (hasVideo) {
    items.push({id: 'video', kind: 'video', variants: [], ext: 'mp4', postId: 'post', index: items.length + 1, needsYtdl: true, pageUrl: url});
  }
  if (!items.length) throw new SocialError('signIn', SIGN_IN);
  const owner =
    html.match(/"(?:owner|actors)":\[?\{"__typename":"(?:User|Page)"[^{}]*?"name":"((?:[^"\\]|\\.)+)"/)?.[1] ||
    metaContent(html, 'og:title')?.replace(/\s*\|\s*Facebook$/, '');
  const author = owner ? decodeHtml(unescapeJsonString(owner)).trim() : user || 'facebook';
  const title = metaContent(html, 'og:description')?.split('\n')[0]?.slice(0, 80) || `Post by ${author}`;
  return {site: 'facebook', kind: 'post', url, author, title, items, hasVideo};
};

export const facebookExtractor: SocialExtractor = {
  site: 'facebook',
  async extract(link, context) {
    const response = await context.fetch(link.url, {headers: {Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate'}});
    if (response.status === 404) throw new SocialError('notFound', 'This post was not found. It may have been deleted.');
    if (/\/login(\.php)?[/?]|checkpoint/.test(response.url) && !context.cookie('facebook.com', 'c_user')) {
      throw new SocialError('signIn', SIGN_IN);
    }
    const post = parseFacebookPage(response.text, link.url, link.user);
    return {...post, url: link.url};
  },
};
