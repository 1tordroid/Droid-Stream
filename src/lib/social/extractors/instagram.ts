import {asArray, asNumber, asRecord, asString, decodeHtml, extensionOf, parseJson, walkJson} from '../http';
import {
  captionFromGraph,
  captionFromV1,
  itemsFromGraph,
  itemsFromV1,
  mediaIdFromCode,
  musicFromV1,
  userFromV1,
} from '../igMedia';
import {
  SocialError,
  type ProfileOptions,
  type SocialContext,
  type SocialExtractor,
  type SocialLink,
  type SocialMediaItem,
  type SocialPost,
} from '../types';

const BASE = 'https://www.instagram.com';
// The id Instagram's own web app sends with every API call.
const WEB_APP_ID = '936619743392459';
// Public post query of the web app (the same one yt-dlp uses).
const POST_DOC_ID = '8845758582119845';

export const SIGN_IN_STORIES = 'Sign in to Instagram under Video downloader > Cookies to download stories.';
const SIGN_IN_POST = 'Instagram did not show this post. If it is from a private account you follow, sign in to Instagram under Video downloader > Cookies.';
const SIGN_IN_SONG = 'Sign in to Instagram under Video downloader > Cookies to get songs from photo posts.';

const signedIn = (context: SocialContext) => Boolean(context.cookie('instagram.com', 'sessionid'));

const apiHeaders = (context: SocialContext, referer = `${BASE}/`): Record<string, string> => ({
  Accept: '*/*',
  'X-IG-App-ID': WEB_APP_ID,
  'X-ASBD-ID': '129477',
  'X-IG-WWW-Claim': '0',
  'X-Requested-With': 'XMLHttpRequest',
  'X-CSRFToken': context.cookie('instagram.com', 'csrftoken') || '',
  Referer: referer,
});

const titleFrom = (caption: string | undefined, author: string): string => {
  const line = caption?.split('\n').find(text => text.trim())?.trim();
  if (!line) return `Post by ${author}`;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
};

const records = (list: unknown): Record<string, unknown>[] =>
  asArray(list).map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));

const postFromV1 = (media: Record<string, unknown>, link: SocialLink): SocialPost => {
  const code = asString(media.code) || link.id || asString(media.pk) || 'post';
  const user = userFromV1(media);
  const author = user.username || link.user || 'instagram';
  const caption = captionFromV1(media);
  const items = itemsFromV1(media, code);
  // A reel's sound is its own audio track; only photo posts get the song choices.
  const music = asNumber(media.media_type) === 2 ? undefined : musicFromV1(media);
  return {
    site: 'instagram',
    kind: 'post',
    url: link.url,
    author,
    authorName: user.fullName,
    title: titleFrom(caption, author),
    caption,
    items,
    music,
    hasVideo: items.some(item => item.kind === 'video'),
  };
};

const postFromGraph = (media: Record<string, unknown>, link: SocialLink, note?: string): SocialPost => {
  const code = asString(media.shortcode) || link.id || 'post';
  const owner = asRecord(media.owner);
  const author = asString(owner?.username) || link.user || 'instagram';
  const caption = captionFromGraph(media);
  const items = itemsFromGraph(media, code);
  return {
    site: 'instagram',
    kind: 'post',
    url: link.url,
    author,
    authorName: asString(owner?.full_name),
    title: titleFrom(caption, author),
    caption,
    items,
    hasVideo: items.some(item => item.kind === 'video'),
    note,
  };
};

const v1Media = async (context: SocialContext, code: string, link: SocialLink): Promise<Record<string, unknown> | undefined> => {
  const id = mediaIdFromCode(code);
  if (!id) return undefined;
  const response = await context.fetch(`${BASE}/api/v1/media/${id}/info/`, {headers: apiHeaders(context, link.url)});
  if (response.status === 404) throw new SocialError('notFound', 'This post was not found. It may have been deleted.');
  const json = parseJson<{items?: unknown[]}>(response, 'This post');
  return asRecord(json.items?.[0]);
};

const graphMedia = async (context: SocialContext, code: string): Promise<Record<string, unknown> | undefined> => {
  const variables = {shortcode: code, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null};
  const response = await context.fetch(`${BASE}/graphql/query`, {
    method: 'POST',
    headers: {
      ...apiHeaders(context, `${BASE}/p/${code}/`),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
      Origin: BASE,
    },
    body: `variables=${encodeURIComponent(JSON.stringify(variables))}&doc_id=${POST_DOC_ID}`,
  });
  if (response.status >= 400) return undefined;
  try {
    const data = asRecord(asRecord(JSON.parse(response.text))?.data);
    return asRecord(data?.xdt_shortcode_media) || asRecord(data?.shortcode_media);
  } catch {
    return undefined;
  }
};

/** The embed page works signed out for public posts. */
export const parseEmbed = (html: string, link: SocialLink): SocialPost | undefined => {
  const code = link.id || 'post';
  // Newer embed pages carry the post as an escaped JSON string.
  const context = html.match(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
  if (context) {
    try {
      let found: Record<string, unknown> | undefined;
      walkJson(JSON.parse(JSON.parse(context)), node => {
        const media = asRecord(node.shortcode_media);
        if (media) {
          found = media;
          return true;
        }
      });
      if (found) return postFromGraph(found, link, SIGN_IN_SONG);
    } catch {
      // fall back to the image tag
    }
  }
  const image = html.match(/<img[^>]*class="[^"]*EmbeddedMediaImage[^"]*"[^>]*>/i)?.[0];
  if (!image) return undefined;
  const srcset = image.match(/srcset="([^"]+)"/i)?.[1];
  const variants = (srcset ? decodeHtml(srcset).split(',') : [])
    .map(entry => entry.trim().split(/\s+/))
    .map(([url, width]) => ({url, width: Number.parseInt(width, 10) || undefined}))
    .filter(variant => variant.url)
    .sort((left, right) => (right.width || 0) - (left.width || 0));
  const src = image.match(/src="([^"]+)"/i)?.[1];
  if (src && !variants.length) variants.push({url: decodeHtml(src), width: undefined});
  if (!variants.length) return undefined;
  const author = decodeHtml(html.match(/class="UsernameText"[^>]*>([^<]+)</)?.[1] || link.user || 'instagram').trim();
  const item: SocialMediaItem = {
    id: code,
    kind: 'image',
    variants,
    thumbnail: variants[variants.length - 1].url,
    ext: extensionOf(variants[0].url, 'jpg'),
    postId: code,
    index: 1,
  };
  return {
    site: 'instagram',
    kind: 'post',
    url: link.url,
    author,
    title: `Post by ${author}`,
    items: [item],
    // The embed shows only the first photo of a carousel.
    note: 'Signed out, Instagram may show only the first photo. Sign in under Video downloader > Cookies for all of them.',
  };
};

const post = async (link: SocialLink, context: SocialContext): Promise<SocialPost> => {
  const code = link.id;
  if (!code) throw new SocialError('unsupported', 'This Instagram link has no post in it.');
  if (signedIn(context)) {
    try {
      const media = await v1Media(context, code, link);
      if (media) return postFromV1(media, link);
    } catch (error) {
      // An old sign-in still lets the public reader below try.
      if (error instanceof SocialError && (error.code === 'notFound' || error.code === 'rateLimit')) throw error;
    }
  }
  const graph = await graphMedia(context, code).catch(() => undefined);
  if (graph) return postFromGraph(graph, link, signedIn(context) ? undefined : SIGN_IN_SONG);
  const embed = await context.fetch(`${BASE}/p/${code}/embed/captioned/`, {headers: {Referer: `${BASE}/`}}).catch(() => undefined);
  const parsed = embed && embed.status < 400 ? parseEmbed(embed.text, link) : undefined;
  if (parsed) return parsed;
  throw new SocialError(signedIn(context) ? 'private' : 'signIn', SIGN_IN_POST);
};

interface ProfileInfo {
  id: string;
  username: string;
  fullName?: string;
  picture?: string;
  isPrivate: boolean;
  /** Posts the profile page already lists (signed out: the first 12). */
  edges: Record<string, unknown>[];
}

const profileInfo = async (context: SocialContext, username: string): Promise<ProfileInfo> => {
  const response = await context.fetch(`${BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
    headers: apiHeaders(context, `${BASE}/${username}/`),
  });
  if (response.status === 404) throw new SocialError('notFound', `No Instagram account called ${username}.`);
  const json = parseJson<{data?: {user?: Record<string, unknown> | null}}>(response, 'This profile');
  const user = asRecord(json.data?.user);
  const id = asString(user?.id);
  if (!user || !id) throw new SocialError('notFound', `No Instagram account called ${username}.`);
  return {
    id,
    username: asString(user.username) || username,
    fullName: asString(user.full_name),
    picture: asString(user.profile_pic_url_hd) || asString(user.profile_pic_url),
    isPrivate: user.is_private === true,
    edges: records(asRecord(user.edge_owner_to_timeline_media)?.edges)
      .map(edge => asRecord(edge.node))
      .filter((node): node is Record<string, unknown> => Boolean(node)),
  };
};

/** Full-size profile picture; the signed-in API has a larger one than the profile page. */
const profilePicture = async (context: SocialContext, info: ProfileInfo): Promise<SocialMediaItem | undefined> => {
  let url = info.picture;
  let width: number | undefined;
  let height: number | undefined;
  if (signedIn(context)) {
    const response = await context.fetch(`${BASE}/api/v1/users/${info.id}/info/`, {headers: apiHeaders(context)}).catch(() => undefined);
    try {
      const user = asRecord(asRecord(JSON.parse(response?.text || '{}'))?.user);
      const hd = asRecord(user?.hd_profile_pic_url_info);
      if (asString(hd?.url)) {
        url = asString(hd?.url);
        width = asNumber(hd?.width);
        height = asNumber(hd?.height);
      }
    } catch {
      // keep the profile page's picture
    }
  }
  if (!url) return undefined;
  return {
    id: `profile-${info.id}`,
    kind: 'image',
    variants: [{url, width, height}],
    thumbnail: url,
    ext: extensionOf(url, 'jpg'),
    postId: 'profile',
    index: 1,
  };
};

/** Latest posts of a profile, a page at a time with a pause between pages. */
const profilePosts = async (context: SocialContext, info: ProfileInfo, options?: ProfileOptions): Promise<SocialMediaItem[]> => {
  const fromEdges = () =>
    info.edges.flatMap(node => itemsFromGraph(node, asString(node.shortcode) || asString(node.id) || 'post'));
  if (!options || !signedIn(context)) {
    const items = fromEdges();
    const limit = options?.limit;
    if (!limit) return items;
    const posts = [...new Set(items.map(item => item.postId))].slice(0, limit);
    return items.filter(item => posts.includes(item.postId));
  }
  const items: SocialMediaItem[] = [];
  let posts = 0;
  let maxId: string | undefined;
  while (posts < options.limit) {
    const query = `count=12${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
    const response = await context.fetch(`${BASE}/api/v1/feed/user/${info.id}/?${query}`, {headers: apiHeaders(context, `${BASE}/${info.username}/`)});
    const json = parseJson<{items?: unknown[]; more_available?: boolean; next_max_id?: string}>(response, 'This profile');
    for (const media of records(json.items)) {
      if (posts >= options.limit) break;
      posts += 1;
      items.push(...itemsFromV1(media, asString(media.code) || asString(media.pk) || `post-${posts}`, false));
    }
    options.onProgress?.(posts);
    maxId = json.more_available ? asString(json.next_max_id) : undefined;
    if (!maxId) break;
    await context.sleep(options.delayMs);
  }
  return items;
};

const profile = async (link: SocialLink, context: SocialContext, options?: ProfileOptions): Promise<SocialPost> => {
  const username = link.user || '';
  const info = await profileInfo(context, username);
  const picture = await profilePicture(context, info);
  const posts = info.isPrivate && !signedIn(context) ? [] : await profilePosts(context, info, options);
  let note: string | undefined;
  if (info.isPrivate && !signedIn(context)) note = 'This account is private. Sign in under Video downloader > Cookies to see posts you can already see.';
  else if (!signedIn(context)) note = 'Signed out, Instagram lists only the latest posts. Sign in under Video downloader > Cookies for more.';
  return {
    site: 'instagram',
    kind: 'profile',
    url: link.url,
    author: info.username,
    authorName: info.fullName,
    title: info.fullName ? `${info.fullName} (@${info.username})` : `@${info.username}`,
    items: [...(picture ? [picture] : []), ...posts],
    hasVideo: posts.some(item => item.kind === 'video'),
    note,
    profile: {userId: info.id, picture},
  };
};

/** Current stories of one account, or the stories of a highlight. */
const reel = async (link: SocialLink, context: SocialContext): Promise<SocialPost> => {
  if (!signedIn(context)) throw new SocialError('signIn', SIGN_IN_STORIES);
  let reelId: string;
  let author = link.user || 'instagram';
  if (link.kind === 'highlight') {
    reelId = `highlight:${link.id}`;
  } else {
    reelId = (await profileInfo(context, author)).id;
  }
  const response = await context.fetch(`${BASE}/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`, {headers: apiHeaders(context, link.url)});
  const json = parseJson<{reels?: Record<string, unknown>; reels_media?: unknown[]}>(response, 'These stories');
  const found = asRecord(json.reels?.[reelId]) || asRecord(asArray(json.reels_media)[0]);
  let stories = records(found?.items);
  if (link.kind === 'story' && link.id) stories = stories.filter(story => asString(story.pk) === link.id || asString(story.id)?.startsWith(`${link.id}_`));
  if (!stories.length) {
    throw new SocialError('empty', link.kind === 'highlight' ? 'This highlight is empty or was removed.' : 'No stories to download. Stories last 24 hours.');
  }
  author = asString(asRecord(found?.user)?.username) || author;
  const items = stories.flatMap((story, position) =>
    itemsFromV1(story, asString(story.pk) || `story-${position + 1}`, false).map(item => ({...item, index: position + 1})),
  );
  const title = link.kind === 'highlight' ? asString(found?.title) || 'Highlight' : `Stories of ${author}`;
  return {site: 'instagram', kind: link.kind, url: link.url, author, title, items, hasVideo: items.some(item => item.kind === 'video')};
};

export const instagramExtractor: SocialExtractor = {
  site: 'instagram',
  extract: (link, context, options) => {
    switch (link.kind) {
      case 'profile':
        return profile(link, context, options);
      case 'story':
      case 'highlight':
        return reel(link, context);
      default:
        return post(link, context);
    }
  },
};
