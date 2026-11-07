import type {YtdlInfo} from '../ytdl/types';
import {EXTRACTORS} from './extractors';
import {createSocialContext} from './http';
import {classifySocialUrl} from './urls';
import {SocialError, type ProfileOptions, type SocialContext, type SocialLink, type SocialPost} from './types';

export interface ResolveOptions {
  profile?: ProfileOptions;
  context?: SocialContext;
  /** yt-dlp's view of the page, used when the site's own reader finds nothing. */
  ytdl?: (url: string) => Promise<YtdlInfo>;
}

/** A post as yt-dlp sees it: its videos (saved with yt-dlp) and its cover picture. */
export const postFromYtdl = (info: YtdlInfo, link: SocialLink): SocialPost => {
  const author = (info.uploader || link.user || link.site).replace(/^@/, '');
  if (info.type === 'playlist') {
    return {
      site: link.site,
      kind: link.kind,
      url: link.url,
      author,
      title: info.title,
      hasVideo: true,
      items: info.entries.map(entry => ({
        id: entry.id || entry.url,
        kind: 'video' as const,
        variants: [],
        thumbnail: entry.thumbnail || undefined,
        ext: 'mp4',
        postId: link.id || 'post',
        index: entry.index,
        needsYtdl: true,
        pageUrl: entry.url,
      })),
    };
  }
  const postId = link.id || info.id || 'post';
  return {
    site: link.site,
    kind: link.kind,
    url: link.url,
    author,
    title: info.title,
    hasVideo: true,
    items: [
      {id: `${postId}-video`, kind: 'video', variants: [], thumbnail: info.thumbnail || undefined, ext: 'mp4', postId, index: 1, needsYtdl: true, pageUrl: info.webpageUrl || link.url},
      ...(info.thumbnail
        ? [{id: `${postId}-cover`, kind: 'image' as const, variants: [{url: info.thumbnail}], thumbnail: info.thumbnail, ext: 'jpg', postId, index: 1}]
        : []),
    ],
  };
};

/**
 * Reads a post. The site's own reader runs first because the app's yt-dlp
 * lookup only reports videos (photo posts make it fail); yt-dlp is asked
 * when the reader finds nothing, so video posts still work.
 */
export const resolveSocialPost = async (url: string, options: ResolveOptions = {}): Promise<SocialPost> => {
  const link = classifySocialUrl(url);
  if (!link) throw new SocialError('unsupported', 'This link is not a post the photo downloader can read.');
  const context = options.context || (await createSocialContext());
  try {
    const post = await EXTRACTORS[link.site].extract(link, context, options.profile);
    if (!post.items.length) throw new SocialError('empty', 'Nothing to download in this post.');
    return post;
  } catch (error) {
    // Sign-in and rate-limit messages matter more than yt-dlp's guess.
    const code = error instanceof SocialError ? error.code : 'network';
    if (!options.ytdl || link.kind === 'profile' || code === 'rateLimit') throw error;
    const info = await options.ytdl(url).catch(() => undefined);
    if (!info || (info.type === 'playlist' && !info.entries.length)) throw error;
    return postFromYtdl(info, link);
  }
};
