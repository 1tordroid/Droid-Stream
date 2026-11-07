import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';
import {cookieHeaderFor, cookieValue, parseNetscapeCookies} from '../src/lib/social/cookies';
import {EXTRACTORS} from '../src/lib/social/extractors';
import {SIGN_IN_STORIES} from '../src/lib/social/extractors/instagram';
import {originalPhoto, syndicationToken} from '../src/lib/social/extractors/twitter';
import {mediaIdFromCode} from '../src/lib/social/igMedia';
import {resolveSocialPost} from '../src/lib/social/resolve';
import {classifySocialUrl} from '../src/lib/social/urls';
import {SocialError, type SocialContext, type SocialLink, type SocialRequest} from '../src/lib/social/types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'social', name), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

type Route = [string | RegExp, number, string] | [string | RegExp, (url: string, request?: SocialRequest) => {status: number; text: string; url?: string}];

/** A network that answers from fixtures; unknown URLs get a 404. */
const fakeContext = (routes: Route[], cookies: Record<string, string> = {}) => {
  const requests: {url: string; request?: SocialRequest}[] = [];
  const sleeps: number[] = [];
  const context: SocialContext = {
    fetch: async (url, request) => {
      requests.push({url, request});
      for (const route of routes) {
        const [match] = route;
        if (typeof match === 'string' ? url.startsWith(match) : match.test(url)) {
          if (typeof route[1] === 'function') {
            const answer = route[1](url, request);
            return {status: answer.status, text: answer.text, url: answer.url || url};
          }
          return {status: route[1], text: route[2] as string, url};
        }
      }
      return {status: 404, text: '', url};
    },
    cookie: (_host, name) => cookies[name],
    cookieHeader: () => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; '),
    sleep: async ms => {
      sleeps.push(ms);
    },
  };
  return {context, requests, sleeps};
};

const link = (url: string): SocialLink => {
  const found = classifySocialUrl(url);
  if (!found) throw new Error(`not a social link: ${url}`);
  return found;
};

const SIGNED_IN = {sessionid: 'abc', csrftoken: 'tok', ds_user_id: '1'};

describe('cookies', () => {
  const file = [
    '# Netscape HTTP Cookie File',
    '.instagram.com\tTRUE\t/\tTRUE\t4102444800\tsessionid\tabc',
    '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t4102444800\tcsrftoken\ttok',
    '.x.com\tTRUE\t/\tTRUE\t1000\told\tgone',
    'not a cookie line',
  ].join('\n');
  const cookies = parseNetscapeCookies(file);

  it('reads the sign-in cookie file and builds headers per site', () => {
    expect(cookies).toHaveLength(3);
    expect(cookieHeaderFor(cookies, 'https://www.instagram.com/api/v1/x')).toBe('sessionid=abc; csrftoken=tok');
    expect(cookieValue(cookies, 'instagram.com', 'csrftoken')).toBe('tok');
    // Expired cookies and other sites are left out.
    expect(cookieHeaderFor(cookies, 'https://x.com/')).toBe('');
    expect(cookieHeaderFor(cookies, 'https://notinstagram.com/')).toBe('');
  });
});

describe('Instagram', () => {
  it('turns a post code into the numeric media id', () => {
    expect(mediaIdFromCode('B')).toBe('1');
    expect(mediaIdFromCode('BA')).toBe('64');
    expect(mediaIdFromCode('C3xYzAbCdEf')).toMatch(/^\d{15,20}$/);
    expect(mediaIdFromCode('bad*code')).toBeUndefined();
  });

  it('reads a carousel with its song when signed in', async () => {
    const {context, requests} = fakeContext([['https://www.instagram.com/api/v1/media/', 200, fixture('ig_media_info_carousel_music.json')]], SIGNED_IN);
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/C3xYzAbCdEf/'), context);
    expect(requests[0].request?.headers?.['X-IG-App-ID']).toBe('936619743392459');
    expect(requests[0].request?.headers?.['X-CSRFToken']).toBe('tok');
    expect(post.author).toBe('sample.user');
    expect(post.title).toBe('Weekend by the sea');
    expect(post.items.map(item => [item.kind, item.index, item.ext])).toEqual([
      ['image', 1, 'jpg'],
      ['video', 2, 'mp4'],
      ['image', 3, 'webp'],
    ]);
    // Largest size first.
    expect(post.items[0].variants[0]).toEqual({url: 'https://scontent.cdninstagram.com/v/t51/slide1_1440.jpg?_nc_ht=x', width: 1440, height: 1800});
    expect(post.items[1].variants[0].width).toBe(1080);
    expect(post.music).toEqual({
      url: 'https://scontent.cdninstagram.com/v/t39/ocean_song.mp4?_nc_ht=x',
      title: 'Ocean Song',
      artist: 'The Band',
      duration: 182,
      start: 45,
      clip: 15,
    });
  });

  it('reads a public carousel signed out, with the video and without the song', async () => {
    const {context, requests} = fakeContext([['https://www.instagram.com/graphql/query', 200, fixture('ig_graphql_sidecar.json')]]);
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/C4pQrStUvWx/'), context);
    expect(requests[0].request?.method).toBe('POST');
    expect(requests[0].request?.body).toContain('doc_id=');
    expect(decodeURIComponent(requests[0].request?.body || '')).toContain('"shortcode":"C4pQrStUvWx"');
    expect(post.author).toBe('public.page');
    expect(post.items.map(item => item.kind)).toEqual(['image', 'video', 'image']);
    expect(post.items[1].variants[0].url).toBe('https://scontent.cdninstagram.com/o1/v/t16/child2.mp4');
    expect(post.music).toBeUndefined();
    expect(post.note).toMatch(/Sign in/);
    expect(post.hasVideo).toBe(true);
  });

  it('falls back to the embed page for a single public photo', async () => {
    const {context} = fakeContext([
      ['https://www.instagram.com/graphql/query', 200, '{"data":{"xdt_shortcode_media":null}}'],
      ['https://www.instagram.com/p/EmbedCode1/embed/captioned/', 200, fixture('ig_embed.html')],
    ]);
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/EmbedCode1/'), context);
    expect(post.author).toBe('embed.user');
    expect(post.items).toHaveLength(1);
    expect(post.items[0].variants.map(variant => variant.width)).toEqual([1080, 750, 640]);
    expect(post.items[0].variants[2].url).toBe('https://scontent.cdninstagram.com/v/t51/embed_640.jpg?stp=dst-jpg&_nc_ht=x');
  });

  it('asks for a sign-in when nothing shows the post', async () => {
    const {context} = fakeContext([]);
    await expect(EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/Private1234/'), context)).rejects.toMatchObject({code: 'signIn'});
  });

  it('needs a sign-in for stories, and reads them and highlights when signed in', async () => {
    await expect(EXTRACTORS.instagram.extract(link('https://www.instagram.com/stories/sample.user/'), fakeContext([]).context)).rejects.toThrow(SIGN_IN_STORIES);
    const routes: Route[] = [
      ['https://www.instagram.com/api/v1/users/web_profile_info/', 200, fixture('ig_web_profile_info.json')],
      ['https://www.instagram.com/api/v1/feed/reels_media/', 200, fixture('ig_reels_media.json')],
    ];
    const stories = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/stories/sample.user/'), fakeContext(routes, SIGNED_IN).context);
    expect(stories.kind).toBe('story');
    // A video story gives the video only, not its cover.
    expect(stories.items.map(item => [item.kind, item.index])).toEqual([['image', 1], ['video', 2]]);
    const one = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/stories/sample.user/6002/'), fakeContext(routes, SIGNED_IN).context);
    expect(one.items.map(item => item.kind)).toEqual(['video']);
    const {context, requests} = fakeContext(routes, SIGNED_IN);
    const highlight = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/stories/highlights/17900000000000001/'), context);
    expect(requests[0].url).toContain('reel_ids=highlight%3A17900000000000001');
    expect(highlight.title).toBe('Trips');
    expect(highlight.items).toHaveLength(1);
  });

  it('reads a profile picture and the first grid page signed out', async () => {
    const {context} = fakeContext([['https://www.instagram.com/api/v1/users/web_profile_info/', 200, fixture('ig_web_profile_info.json')]]);
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/sample.user/'), context);
    expect(post.kind).toBe('profile');
    expect(post.items[0]).toMatchObject({postId: 'profile', variants: [{url: 'https://scontent.cdninstagram.com/v/t51/profile_320.jpg'}]});
    // The grid video has no file link signed out: yt-dlp saves it.
    expect(post.items.slice(1).map(item => [item.postId, item.kind, Boolean(item.needsYtdl)])).toEqual([
      ['GridOne1111', 'image', false],
      ['GridTwo2222', 'video', true],
      ['GridTwo2222', 'image', false],
    ]);
  });

  it('reads the latest posts of a profile page by page, pausing between pages', async () => {
    const pages = json('ig_feed_user.json');
    const feed = (url: string) => ({status: 200, text: JSON.stringify(url.includes('max_id=') ? pages.pages[1] : pages.pages[0])});
    const {context, requests, sleeps} = fakeContext(
      [
        ['https://www.instagram.com/api/v1/users/web_profile_info/', 200, fixture('ig_web_profile_info.json')],
        ['https://www.instagram.com/api/v1/users/123456/info/', 200, JSON.stringify(pages.userInfo)],
        ['https://www.instagram.com/api/v1/feed/user/123456/', feed],
      ],
      SIGNED_IN,
    );
    const seen: number[] = [];
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/sample.user/'), context, {limit: 3, delayMs: 2500, onProgress: count => seen.push(count)});
    expect(post.items[0].variants[0]).toEqual({url: 'https://scontent.cdninstagram.com/v/t51/profile_1080.jpg', width: 1080, height: 1080});
    expect([...new Set(post.items.slice(1).map(item => item.postId))]).toEqual(['FeedOne0001', 'FeedTwo0002', 'FeedThree03']);
    expect(sleeps).toEqual([2500]);
    expect(seen).toEqual([2, 3]);
    expect(requests.filter(request => request.url.includes('/feed/user/'))[1].url).toContain('max_id=5002_123456');
  });
});

describe('X', () => {
  it('builds the embed token and original photo links', () => {
    expect(syndicationToken('1850000000000000001')).toMatch(/^[0-9a-z]+$/);
    expect(originalPhoto('https://pbs.twimg.com/media/GaBcDeFgHiJ.jpg')).toBe('https://pbs.twimg.com/media/GaBcDeFgHiJ?format=jpg&name=orig');
    expect(originalPhoto('https://pbs.twimg.com/media/GaBc?format=png&name=small')).toBe('https://pbs.twimg.com/media/GaBc?format=png&name=orig');
  });

  it('reads photos in original size and the best MP4', async () => {
    const {context, requests} = fakeContext([['https://cdn.syndication.twimg.com/tweet-result', 200, fixture('x_tweet_result.json')]]);
    const post = await EXTRACTORS.twitter.extract(link('https://x.com/SampleAcct/status/1850000000000000001'), context);
    expect(requests[0].url).toContain('id=1850000000000000001&token=');
    expect(post.author).toBe('SampleAcct');
    expect(post.title).toBe('Two photos and a clip from today');
    expect(post.items.map(item => [item.kind, item.ext])).toEqual([['image', 'jpg'], ['image', 'png'], ['video', 'mp4']]);
    expect(post.items[0].variants[0]).toEqual({url: 'https://pbs.twimg.com/media/GaBcDeFgHiJ?format=jpg&name=orig', width: 1536, height: 2048});
    expect(post.items[2].variants.map(variant => variant.width)).toEqual([720, 480, 320]);
  });

  it('explains hidden posts', async () => {
    const {context} = fakeContext([['https://cdn.syndication.twimg.com/', 200, '{"__typename":"TweetTombstone"}']]);
    await expect(EXTRACTORS.twitter.extract(link('https://x.com/a/status/1850000000000000009'), context)).rejects.toMatchObject({code: 'private'});
  });
});

describe('Reddit', () => {
  it('reads a gallery in order, with originals and an animated item', async () => {
    const {context, requests} = fakeContext([['https://www.reddit.com/comments/1abcde/.json', 200, fixture('reddit_gallery.json')]]);
    const post = await EXTRACTORS.reddit.extract(link('https://www.reddit.com/r/gardening/comments/1abcde/my_garden/'), context);
    expect(requests[0].url).toContain('raw_json=1');
    expect(post.author).toBe('green_thumb');
    expect(post.title).toBe('My garden & the cat');
    expect(post.items.map(item => [item.id, item.kind, item.ext])).toEqual([
      ['img2xyz', 'image', 'png'],
      ['img1xyz', 'image', 'jpg'],
      ['gif3xyz', 'video', 'mp4'],
    ]);
    expect(post.items[1].variants[0]).toEqual({url: 'https://i.redd.it/img1xyz.jpg', width: 4000, height: 3000});
  });

  it('reads a single image post, trying old.reddit.com when blocked', async () => {
    const {context} = fakeContext([
      ['https://www.reddit.com/', 403, '<html>blocked</html>'],
      ['https://old.reddit.com/comments/2fghij/.json', 200, fixture('reddit_image.json')],
    ]);
    const post = await EXTRACTORS.reddit.extract(link('https://www.reddit.com/r/pics/comments/2fghij/sunset/'), context);
    expect(post.items).toHaveLength(1);
    expect(post.items[0].variants[0]).toEqual({url: 'https://i.redd.it/sunset123.jpeg', width: 3024, height: 4032});
    expect(post.items[0].ext).toBe('jpg');
  });

  it('follows share links to the post', async () => {
    const {context} = fakeContext([
      ['https://www.reddit.com/r/pics/s/', () => ({status: 200, text: '<html></html>', url: 'https://www.reddit.com/r/pics/comments/2fghij/sunset/'})],
      ['https://www.reddit.com/comments/2fghij/.json', 200, fixture('reddit_image.json')],
    ]);
    const post = await EXTRACTORS.reddit.extract(link('https://www.reddit.com/r/pics/s/AbCdEf'), context);
    expect(post.items[0].postId).toBe('2fghij');
  });
});

describe('Tumblr', () => {
  it('reads photo posts from the blog JSON', async () => {
    const {context} = fakeContext([['https://sampleblog.tumblr.com/api/read/json?id=712345678901234567', 200, fixture('tumblr_read_photo.txt')]]);
    const post = await EXTRACTORS.tumblr.extract(link('https://sampleblog.tumblr.com/post/712345678901234567/two-photos'), context);
    expect(post.author).toBe('sampleblog');
    expect(post.items.map(item => [item.variants[0].url, item.ext])).toEqual([
      ['https://64.media.tumblr.com/aaa/s1280x1920/one.jpg', 'jpg'],
      ['https://64.media.tumblr.com/bbb/s1280x1920/two.png', 'png'],
    ]);
  });

  it('reads images inside newer text posts, largest size first, skipping site images', async () => {
    const {context} = fakeContext([['https://sampleblog.tumblr.com/api/read/json', 200, fixture('tumblr_read_npf.txt')]]);
    const post = await EXTRACTORS.tumblr.extract(link('https://www.tumblr.com/sampleblog/712345678901234999'), context);
    expect(post.title).toBe('New art');
    expect(post.items).toHaveLength(1);
    expect(post.items[0].variants[0]).toEqual({url: 'https://64.media.tumblr.com/ccc/s1600x3200/art.jpg', width: 1600, height: 2000});
  });
});

describe('Pinterest', () => {
  it('reads the pages of an idea pin', async () => {
    const {context, requests} = fakeContext([['https://www.pinterest.com/resource/PinResource/get/', 200, fixture('pinterest_pin.json')]]);
    const post = await EXTRACTORS.pinterest.extract(link('https://www.pinterest.com/pin/123456789012345678/'), context);
    expect(decodeURIComponent(requests[0].url)).toContain('"id":"123456789012345678"');
    expect(post.author).toBe('home.ideas');
    expect(post.title).toBe('Cozy reading corner');
    expect(post.items.map(item => [item.kind, item.variants[0].url])).toEqual([
      ['image', 'https://i.pinimg.com/originals/11/22/33/page1.jpg'],
      ['video', 'https://v1.pinimg.com/videos/iht/expMp4/page2_720w.mp4'],
    ]);
  });

  it('reads a plain pin, and falls back to the page picture', async () => {
    const pin = json('pinterest_pin.json');
    delete pin.resource_response.data.story_pin_data;
    const {context} = fakeContext([['https://www.pinterest.com/resource/', 200, JSON.stringify(pin)]]);
    const post = await EXTRACTORS.pinterest.extract(link('https://www.pinterest.com/pin/123456789012345678/'), context);
    expect(post.items[0].variants.map(variant => variant.width)).toEqual([1000, 736, 236]);

    const page = '<meta property="og:image" content="https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg">';
    const fallback = await EXTRACTORS.pinterest.extract(
      link('https://www.pinterest.com/pin/123456789012345678/'),
      fakeContext([['https://www.pinterest.com/resource/', 500, ''], ['https://www.pinterest.com/pin/', 200, page]]).context,
    );
    expect(fallback.items[0].variants[0].url).toBe('https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg');
  });
});

describe('Threads', () => {
  it('finds the post in the page JSON', async () => {
    const {context} = fakeContext([['https://www.threads.com/@walker/post/DAbCdEfGhIj', 200, fixture('threads_post.html')]]);
    const post = await EXTRACTORS.threads.extract(link('https://www.threads.net/@walker/post/DAbCdEfGhIj'), context);
    expect(post.author).toBe('walker');
    expect(post.title).toBe('Morning walk');
    expect(post.items.map(item => item.variants[0].url)).toEqual([
      'https://scontent.cdninstagram.com/v/t51/threads_a_1440.jpg',
      'https://scontent.cdninstagram.com/v/t51/threads_b_1440.jpg',
    ]);
  });

  it('falls back to the preview picture', async () => {
    const html = fixture('threads_post.html').replace(/<script[\s\S]*<\/script>/g, '');
    const {context} = fakeContext([['https://www.threads.com/', 200, html]]);
    const post = await EXTRACTORS.threads.extract(link('https://www.threads.com/@walker/post/DAbCdEfGhIj'), context);
    expect(post.items).toHaveLength(1);
    expect(post.note).toMatch(/Sign in to Threads/);
  });
});

describe('Facebook', () => {
  it('reads every photo of a post at its largest size', async () => {
    const {context} = fakeContext([['https://www.facebook.com/SamplePage/posts/', 200, fixture('facebook_post.html')]]);
    const post = await EXTRACTORS.facebook.extract(link('https://www.facebook.com/SamplePage/posts/pfbid02abc'), context);
    expect(post.author).toBe('Sample Page');
    expect(post.items.map(item => item.variants[0].url)).toEqual([
      'https://scontent.xx.fbcdn.net/v/t39/photo1_2048.jpg',
      'https://scontent.xx.fbcdn.net/v/t39/photo2_960.jpg',
    ]);
  });

  it('asks for a sign-in when Facebook sends the login page', async () => {
    const {context} = fakeContext([['https://www.facebook.com/', () => ({status: 200, text: '<html></html>', url: 'https://www.facebook.com/login/?next=x'})]]);
    await expect(EXTRACTORS.facebook.extract(link('https://www.facebook.com/SamplePage/posts/1'), context)).rejects.toMatchObject({code: 'signIn'});
  });
});

describe('resolveSocialPost', () => {
  it('asks yt-dlp when the site reader finds nothing', async () => {
    const {context} = fakeContext([['https://cdn.syndication.twimg.com/', 404, '']]);
    const post = await resolveSocialPost('https://x.com/a/status/1850000000000000002', {
      context,
      ytdl: async () => ({
        type: 'video',
        title: 'A clip',
        uploader: 'a',
        thumbnail: 'https://pbs.twimg.com/thumb.jpg',
        webpageUrl: 'https://x.com/a/status/1850000000000000002',
        isLive: false,
        chapters: 0,
        formats: [],
        subtitles: {},
        automaticCaptions: [],
      }),
    });
    expect(post.items.map(item => [item.kind, Boolean(item.needsYtdl)])).toEqual([['video', true], ['image', false]]);
  });

  it('keeps sign-in errors when yt-dlp has nothing either', async () => {
    const {context} = fakeContext([]);
    await expect(
      resolveSocialPost('https://www.instagram.com/stories/sample.user/', {context, ytdl: async () => Promise.reject(new Error('no video'))}),
    ).rejects.toBeInstanceOf(SocialError);
  });

  it('refuses other links', async () => {
    await expect(resolveSocialPost('https://example.com/', {context: fakeContext([]).context})).rejects.toMatchObject({code: 'unsupported'});
  });
});
