import {asNumber, asRecord, asString, decodeHtml, extensionOf, jsonScripts, metaContent, walkJson} from '../http';
import {ruleRegex, siteRules} from '../rules/active';
import {SocialError, type SocialContext, type SocialExtractor, type SocialMediaItem, type SocialPost, type SocialVariant} from '../types';

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
export const parseFacebookPage = (html: string, url: string, user?: string, rulesContext?: Pick<SocialContext, 'rules'>): SocialPost => {
  const rules = siteRules(rulesContext, 'facebook');
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
      if (node.__typename !== rules.photoType) return;
      const id = asString(node.id) || String(photos.size + 1);
      add(id, rules.imageKeys.map(key => imageOf(node[key])));
    });
  }
  if (!photos.size) {
    // Pages without JSON blocks still name the full-size image.
    for (const match of html.matchAll(ruleRegex(rules.patterns.viewerImage, 'g'))) {
      const link = unescapeJsonString(match[3]);
      add(link, [{url: link, width: Number(match[2]), height: Number(match[1])}]);
    }
  }
  const hasVideo = ruleRegex(rules.patterns.video).test(html);
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
    if (og && ruleRegex(rules.patterns.cdnImage).test(og)) {
      items.push({id: 'og', kind: 'image', variants: [{url: og}], thumbnail: og, ext: extensionOf(og, 'jpg'), postId: 'post', index: 1});
    }
  }
  if (hasVideo) {
    items.push({id: 'video', kind: 'video', variants: [], ext: 'mp4', postId: 'post', index: items.length + 1, needsYtdl: true, pageUrl: url});
  }
  if (!items.length) throw new SocialError('signIn', SIGN_IN);
  const owner =
    html.match(ruleRegex(rules.patterns.owner))?.[1] || metaContent(html, 'og:title')?.replace(ruleRegex(rules.patterns.titleSuffix), '');
  const author = owner ? decodeHtml(unescapeJsonString(owner)).trim() : user || 'facebook';
  const title = metaContent(html, 'og:description')?.split('\n')[0]?.slice(0, 80) || `Post by ${author}`;
  return {site: 'facebook', kind: 'post', url, author, title, items, hasVideo};
};

export const facebookExtractor: SocialExtractor = {
  site: 'facebook',
  async extract(link, context) {
    const rules = siteRules(context, 'facebook');
    const response = await context.fetch(link.url, {headers: {...rules.headers}});
    if (response.status === 404) throw new SocialError('notFound', 'This post was not found. It may have been deleted.');
    if (ruleRegex(rules.patterns.loginRedirect).test(response.url) && !context.cookie('facebook.com', rules.signInCookie)) {
      throw new SocialError('signIn', SIGN_IN);
    }
    const post = parseFacebookPage(response.text, link.url, link.user, context);
    return {...post, url: link.url};
  },
};
