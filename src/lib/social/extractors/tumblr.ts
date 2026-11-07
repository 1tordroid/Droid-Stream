import {asArray, asNumber, asRecord, asString, decodeHtml, extensionOf, metaContent, parseJson} from '../http';
import {fillUrl, ruleRegex, siteRules} from '../rules/active';
import {SocialError, type SocialContext, type SocialExtractor, type SocialMediaItem, type SocialPost, type SocialVariant} from '../types';

/** Images in post HTML, with every size from srcset, largest first. */
export const imagesInHtml = (html: string, rulesContext?: Pick<SocialContext, 'rules'>): SocialVariant[][] => {
  const mediaHost = ruleRegex(siteRules(rulesContext, 'tumblr').patterns.mediaHost);
  const found: SocialVariant[][] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = decodeHtml(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] || '');
    if (!mediaHost.test(src)) continue;
    const width = Number(tag.match(/data-orig-width=["'](\d+)["']/i)?.[1]) || undefined;
    const height = Number(tag.match(/data-orig-height=["'](\d+)["']/i)?.[1]) || undefined;
    const sizes = decodeHtml(tag.match(/srcset=["']([^"']+)["']/i)?.[1] || '')
      .split(',')
      .map(entry => entry.trim().split(/\s+/))
      .filter(([url]) => url)
      .map(([url, size]) => ({url, width: Number.parseInt(size, 10) || undefined}))
      .sort((left, right) => (right.width || 0) - (left.width || 0));
    const variants: SocialVariant[] = sizes.length ? sizes : [{url: src, width}];
    if (seen.has(variants[0].url)) continue;
    seen.add(variants[0].url);
    // The largest size is the original when srcset reaches it.
    if (width && variants[0].width === width) variants[0] = {...variants[0], height};
    found.push(variants);
  }
  return found;
};

const toItems = (groups: SocialVariant[][], postId: string): SocialMediaItem[] =>
  groups.map((variants, position) => ({
    id: `${postId}-${position + 1}`,
    kind: 'image',
    variants,
    thumbnail: variants[variants.length - 1].url,
    ext: extensionOf(variants[0].url, 'jpg'),
    postId,
    index: position + 1,
  }));

/** Reads the post from the blog's legacy JSON ("var tumblr_api_read = {...};"). */
export const parseTumblrRead = (text: string, url: string, blog: string, rulesContext?: Pick<SocialContext, 'rules'>): SocialPost => {
  const rules = siteRules(rulesContext, 'tumblr');
  const json = parseJson<Record<string, unknown>>(
    {status: 200, url, text: text.replace(ruleRegex(rules.patterns.readPrefix), '').replace(/;\s*$/, '')},
    'This post',
  );
  const post = asRecord(asArray(json.posts)[0]);
  if (!post) throw new SocialError('notFound', 'This post was not found.');
  const postId = asString(post.id) || 'post';
  const author = asString(asRecord(json.tumblelog)?.name) || blog;
  let groups: SocialVariant[][] = [];
  if (post.type === 'photo') {
    const photos = asArray(post.photos).map(asRecord).filter(Boolean) as Record<string, unknown>[];
    const list = photos.length ? photos : [post];
    groups = list
      .map(photo => {
        const width = asNumber(photo.width);
        const height = asNumber(photo.height);
        return rules.photoSizes
          .map(size => asString(photo[`photo-url-${size}`]))
          .filter((value): value is string => Boolean(value))
          .map((value, position) => (position === 0 ? {url: value, width, height} : {url: value}));
      })
      .filter(variants => variants.length);
  }
  // Newer posts keep their images inside the text.
  const html = rules.htmlFields.map(key => asString(post[key]) || '').join('\n');
  if (!groups.length) groups = imagesInHtml(html, rulesContext);
  const hasVideo = post.type === 'video' || ruleRegex(rules.patterns.video).test(html);
  const items = toItems(groups, postId);
  if (hasVideo) {
    items.push({id: `${postId}-video`, kind: 'video', variants: [], ext: 'mp4', postId, index: items.length + 1, needsYtdl: true, pageUrl: url});
  }
  if (!items.length) throw new SocialError('empty', 'This post has no photos.');
  const title = decodeHtml(asString(post['regular-title']) || asString(post.slug)?.replace(/-/g, ' ') || `Post by ${author}`);
  return {site: 'tumblr', kind: 'post', url, author, title, items, hasVideo};
};

export const tumblrExtractor: SocialExtractor = {
  site: 'tumblr',
  async extract(link, context) {
    const blog = link.user;
    if (!blog || !link.id) throw new SocialError('unsupported', 'This Tumblr link has no post in it.');
    const rules = siteRules(context, 'tumblr');
    const response = await context.fetch(fillUrl('tumblr', rules.endpoints.read, {blog, id: encodeURIComponent(link.id)}));
    if (response.status < 400 && ruleRegex(rules.patterns.readMarker).test(response.text)) {
      try {
        return parseTumblrRead(response.text, link.url, blog, context);
      } catch (error) {
        if (!(error instanceof SocialError) || error.code !== 'empty') throw error;
      }
    }
    // Some blogs need a sign-in (sensitive or private): the post page still has its picture.
    const page = await context.fetch(link.url);
    const images = imagesInHtml(page.text, context);
    const og = metaContent(page.text, 'og:image');
    const groups = images.length ? images : og ? [[{url: og}]] : [];
    if (!groups.length) {
      throw new SocialError(response.status === 404 ? 'notFound' : 'signIn', 'Tumblr did not show this post. Sign in to Tumblr under Video downloader > Cookies if it is marked sensitive.');
    }
    return {site: 'tumblr', kind: 'post', url: link.url, author: blog, title: metaContent(page.text, 'og:title') || `Post by ${blog}`, items: toItems(groups, link.id)};
  },
};
