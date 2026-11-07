import {asRecord, asString, extensionOf, jsonScripts, metaContent, walkJson} from '../http';
import {captionFromV1, itemsFromV1, userFromV1} from '../igMedia';
import {fillUrl, ruleRegex, siteRules} from '../rules/active';
import {SocialError, type SocialContext, type SocialExtractor, type SocialPost} from '../types';

const isMedia = (node: Record<string, unknown>): boolean =>
  Boolean(asRecord(node.image_versions2) || Array.isArray(node.carousel_media) || Array.isArray(node.video_versions));

/** Finds the post in the JSON a Threads page carries for its web app. */
export const parseThreadsPage = (html: string, url: string, code: string, user?: string, rulesContext?: Pick<SocialContext, 'rules'>): SocialPost => {
  let media: Record<string, unknown> | undefined;
  for (const blob of jsonScripts(html)) {
    walkJson(blob, node => {
      if (node.code === code && isMedia(node)) {
        media = node;
        return true;
      }
    });
    if (media) break;
  }
  if (media) {
    const owner = userFromV1(media);
    const author = owner.username || user || 'threads';
    const caption = captionFromV1(media) || asString(asRecord(asRecord(media.text_post_app_info)?.share_info)?.quoted_post_caption);
    const items = itemsFromV1(media, code);
    const line = caption?.split('\n')[0]?.trim();
    if (items.length) {
      return {
        site: 'threads',
        kind: 'post',
        url,
        author,
        authorName: owner.fullName,
        title: line ? (line.length > 80 ? `${line.slice(0, 77)}…` : line) : `Post by ${author}`,
        caption,
        items,
        hasVideo: items.some(item => item.kind === 'video'),
      };
    }
  }
  // Signed out, some pages carry only the preview picture.
  const image = metaContent(html, 'og:image');
  if (!image || ruleRegex(siteRules(rulesContext, 'threads').patterns.placeholderImage).test(image)) {
    throw new SocialError('signIn', 'Threads did not show this post. Sign in to Threads under Video downloader > Cookies and try again.');
  }
  const author = user || 'threads';
  return {
    site: 'threads',
    kind: 'post',
    url,
    author,
    title: metaContent(html, 'og:description')?.slice(0, 80) || `Post by ${author}`,
    items: [{id: code, kind: 'image', variants: [{url: image}], thumbnail: image, ext: extensionOf(image, 'jpg'), postId: code, index: 1}],
    note: 'Only the preview picture was found. Sign in to Threads under Video downloader > Cookies for the full post.',
  };
};

export const threadsExtractor: SocialExtractor = {
  site: 'threads',
  async extract(link, context) {
    if (!link.id) throw new SocialError('unsupported', 'This Threads link has no post in it.');
    const rules = siteRules(context, 'threads');
    const id = encodeURIComponent(link.id);
    const page = link.user
      ? fillUrl('threads', rules.endpoints.postWithUser, {user: encodeURIComponent(link.user), id})
      : fillUrl('threads', rules.endpoints.post, {id});
    const response = await context.fetch(page, {headers: {...rules.headers}});
    if (response.status === 404) throw new SocialError('notFound', 'This post was not found. It may have been deleted.');
    return parseThreadsPage(response.text, link.url, link.id, link.user, context);
  },
};
