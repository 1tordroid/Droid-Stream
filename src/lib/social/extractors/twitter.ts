import {asArray, asNumber, asRecord, asString, extensionOf, parseJson} from '../http';
import {SocialError, type SocialExtractor, type SocialMediaItem, type SocialVariant} from '../types';

/** The token the public embed widget sends with a tweet id. */
export const syndicationToken = (id: string): string =>
  ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

/** "https://pbs.twimg.com/media/AbC.jpg" -> the original upload: "...media/AbC?format=jpg&name=orig". */
export const originalPhoto = (url: string): string => {
  const match = url.match(/^(https:\/\/pbs\.twimg\.com\/media\/[^.?]+)(?:\.([a-z]+))?(?:\?(.*))?$/i);
  if (!match) return url;
  const format = match[2] || new URLSearchParams(match[3] || '').get('format') || 'jpg';
  return `${match[1]}?format=${format}&name=orig`;
};

const sized = (url: string, size: string) => originalPhoto(url).replace('name=orig', `name=${size}`);

export const twitterExtractor: SocialExtractor = {
  site: 'twitter',
  async extract(link, context) {
    const id = link.id;
    if (!id) throw new SocialError('unsupported', 'This X link has no post in it.');
    const response = await context.fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=en`,
      {headers: {Referer: 'https://platform.twitter.com/', Origin: 'https://platform.twitter.com'}},
    );
    if (response.status === 404 || !response.text.trim()) {
      throw new SocialError('notFound', 'This post was not found, or its account is private.');
    }
    const tweet = parseJson<Record<string, unknown>>(response, 'This post');
    if (tweet.__typename === 'TweetTombstone') {
      throw new SocialError('private', 'X hides this post outside the app (it may be age-restricted or private).');
    }
    const user = asRecord(tweet.user);
    const author = asString(user?.screen_name) || link.user || 'x';
    const items: SocialMediaItem[] = [];
    asArray(tweet.mediaDetails).forEach((entry, position) => {
      const media = asRecord(entry);
      if (!media) return;
      const info = asRecord(media.original_info);
      const base = asString(media.media_url_https) || '';
      const index = position + 1;
      const mediaId = asString(media.id_str) || `${id}-${index}`;
      if (media.type === 'photo' && base) {
        const original: SocialVariant = {url: originalPhoto(base), width: asNumber(info?.width), height: asNumber(info?.height)};
        items.push({
          id: mediaId,
          kind: 'image',
          variants: [original, {url: sized(base, 'large')}, {url: sized(base, 'medium')}],
          thumbnail: sized(base, 'small'),
          ext: extensionOf(original.url, 'jpg'),
          postId: id,
          index,
        });
        return;
      }
      // Videos and GIFs: the MP4 files, best first.
      const variants = asArray(asRecord(media.video_info)?.variants)
        .map(asRecord)
        .filter(variant => variant && asString(variant.content_type) === 'video/mp4' && asString(variant.url))
        .sort((left, right) => (asNumber(right?.bitrate) || 0) - (asNumber(left?.bitrate) || 0))
        .map(variant => {
          const url = asString(variant?.url) || '';
          const size = url.match(/\/(\d+)x(\d+)\//);
          return {url, width: size ? Number(size[1]) : undefined, height: size ? Number(size[2]) : undefined};
        });
      items.push({
        id: `${mediaId}-video`,
        kind: 'video',
        variants,
        thumbnail: base ? sized(base, 'small') : undefined,
        ext: 'mp4',
        postId: id,
        index,
        needsYtdl: variants.length === 0,
        pageUrl: link.url,
      });
    });
    if (!items.length) throw new SocialError('empty', 'This post has no photos or videos.');
    const text = asString(tweet.text)?.replace(/https:\/\/t\.co\/\S+/g, '').trim();
    return {
      site: 'twitter',
      kind: 'post',
      url: link.url,
      author,
      authorName: asString(user?.name),
      title: text ? (text.length > 80 ? `${text.slice(0, 77)}…` : text) : `Post by ${author}`,
      caption: text,
      items,
      hasVideo: items.some(item => item.kind === 'video'),
    };
  },
};
