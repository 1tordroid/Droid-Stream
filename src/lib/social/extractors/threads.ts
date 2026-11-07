import {asRecord, asString, extensionOf, jsonScripts, metaContent, walkJson} from '../http';
import {captionFromV1, itemsFromV1, userFromV1} from '../igMedia';
import {SocialError, type SocialExtractor, type SocialPost} from '../types';

const isMedia = (node: Record<string, unknown>): boolean =>
  Boolean(asRecord(node.image_versions2) || Array.isArray(node.carousel_media) || Array.isArray(node.video_versions));

/** Finds the post in the JSON a Threads page carries for its web app. */
export const parseThreadsPage = (html: string, url: string, code: string, user?: string): SocialPost => {
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
  if (!image || /threads-logo|static\.cdninstagram/i.test(image)) {
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
    const page = link.user ? `https://www.threads.com/@${link.user}/post/${link.id}` : `https://www.threads.com/t/${link.id}`;
    const response = await context.fetch(page, {headers: {Accept: 'text/html'}});
    if (response.status === 404) throw new SocialError('notFound', 'This post was not found. It may have been deleted.');
    return parseThreadsPage(response.text, link.url, link.id, link.user);
  },
};
