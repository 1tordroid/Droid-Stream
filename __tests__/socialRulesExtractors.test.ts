import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';
import {EXTRACTORS} from '../src/lib/social/extractors';
import {BUNDLED_RULES} from '../src/lib/social/rules/rules.default';
import {buildSiteIssueUrl, cleanErrorText, ISSUES_NEW_URL} from '../src/lib/social/rules/report';
import type {SocialRules} from '../src/lib/social/rules/ruleSchema';
import {validateRules} from '../src/lib/social/rules/validate';
import {classifySocialUrl} from '../src/lib/social/urls';
import type {SocialContext, SocialLink, SocialRequest} from '../src/lib/social/types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'social', name), 'utf8');

/** Bundled rules with one change, checked like a downloaded file. */
const rulesWith = (edit: (rules: any) => void): SocialRules => {
  const rules = JSON.parse(JSON.stringify(BUNDLED_RULES));
  edit(rules);
  return validateRules(rules);
};

const fakeContext = (routes: [string, number, string][], rules?: SocialRules, cookies: Record<string, string> = {}) => {
  const requests: {url: string; request?: SocialRequest}[] = [];
  const context: SocialContext = {
    fetch: async (url, request) => {
      requests.push({url, request});
      const route = routes.find(([prefix]) => url.startsWith(prefix));
      return route ? {status: route[1], text: route[2], url} : {status: 404, text: '', url};
    },
    cookie: (_host, name) => cookies[name],
    cookieHeader: () => '',
    sleep: async () => undefined,
    rules,
  };
  return {context, requests};
};

const link = (url: string): SocialLink => {
  const found = classifySocialUrl(url);
  if (!found) throw new Error(url);
  return found;
};

describe('site readers use the active rules', () => {
  it('Instagram: query id, app id, endpoint and response path', async () => {
    const graph = JSON.parse(fixture('ig_graphql_sidecar.json'));
    // The site moved the post to another key and endpoint.
    const moved = JSON.stringify({result: {post: graph.data.xdt_shortcode_media || graph.data.shortcode_media}});
    const rules = rulesWith(next => {
      next.sites.instagram.graphql.docId = '999';
      next.sites.instagram.graphql.media = ['result.post'];
      next.sites.instagram.headers['X-IG-App-ID'] = '111';
      next.sites.instagram.endpoints.graphql = 'https://www.instagram.com/api/graphql';
    });
    const {context, requests} = fakeContext([['https://www.instagram.com/api/graphql', 200, moved]], rules);
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/C4pQrStUvWx/'), context);
    expect(post.items.map(item => item.kind)).toEqual(['image', 'video', 'image']);
    expect(requests[0].url).toBe('https://www.instagram.com/api/graphql');
    expect(requests[0].request?.body).toContain('doc_id=999');
    expect(requests[0].request?.headers?.['X-IG-App-ID']).toBe('111');
  });

  it('Instagram: the embed page pattern', async () => {
    const html = fixture('ig_embed.html').replace(/EmbeddedMediaImage/g, 'PostPhoto');
    const routes: [string, number, string][] = [['https://www.instagram.com/p/EmbedCode1/embed/captioned/', 200, html]];
    // With the old pattern the renamed class is not found.
    await expect(EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/EmbedCode1/'), fakeContext(routes).context)).rejects.toMatchObject({code: 'signIn'});
    const rules = rulesWith(next => (next.sites.instagram.patterns.embedImage.pattern = '<img[^>]*class="[^"]*PostPhoto[^"]*"[^>]*>'));
    const post = await EXTRACTORS.instagram.extract(link('https://www.instagram.com/p/EmbedCode1/'), fakeContext(routes, rules).context);
    expect(post.items[0].variants.map(variant => variant.width)).toEqual([1080, 750, 640]);
  });

  it('X: the tweet endpoint and headers', async () => {
    const rules = rulesWith(next => {
      next.sites.twitter.endpoints.tweet = 'https://cdn.syndication.twimg.com/tweet-result-v2?id={id}&token={token}';
      next.sites.twitter.headers = {Referer: 'https://platform.x.com/'};
    });
    const {context, requests} = fakeContext([['https://cdn.syndication.twimg.com/tweet-result-v2', 200, fixture('x_tweet_result.json')]], rules);
    const post = await EXTRACTORS.twitter.extract(link('https://x.com/someone/status/1790000000000000000'), context);
    expect(post.items.length).toBeGreaterThan(0);
    expect(requests[0].url).toMatch(/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result-v2\?id=1790000000000000000&token=/);
    expect(requests[0].request?.headers).toEqual({Referer: 'https://platform.x.com/'});
  });

  it('Reddit, Tumblr, Pinterest and Threads: endpoints from the rules', async () => {
    const reddit = rulesWith(next => (next.sites.reddit.endpoints.post = 'https://api.reddit.com/comments/{id}?raw_json=1'));
    const redditRun = fakeContext([['https://api.reddit.com/comments/1abcde', 200, fixture('reddit_gallery.json')]], reddit);
    await EXTRACTORS.reddit.extract(link('https://www.reddit.com/r/pics/comments/1abcde/title/'), redditRun.context);
    expect(redditRun.requests[0].url).toBe('https://api.reddit.com/comments/1abcde?raw_json=1');

    const tumblr = rulesWith(next => (next.sites.tumblr.endpoints.read = 'https://{blog}.tumblr.com/api/read/json?post={id}'));
    const tumblrRun = fakeContext([['https://sampleblog.tumblr.com/api/read/json?post=712345678901234567', 200, fixture('tumblr_read_photo.txt')]], tumblr);
    const tumblrPost = await EXTRACTORS.tumblr.extract(link('https://sampleblog.tumblr.com/post/712345678901234567/x'), tumblrRun.context);
    expect(tumblrPost.items.length).toBeGreaterThan(0);

    const pinterest = rulesWith(next => (next.sites.pinterest.headers = {Accept: 'application/json', 'X-Test': '1'}));
    const pinRun = fakeContext([['https://www.pinterest.com/resource/PinResource/get/', 200, fixture('pinterest_pin.json')]], pinterest);
    await EXTRACTORS.pinterest.extract(link('https://www.pinterest.com/pin/1234567890/'), pinRun.context);
    expect(pinRun.requests[0].request?.headers).toEqual({Accept: 'application/json', 'X-Test': '1'});

    const threads = rulesWith(next => (next.sites.threads.endpoints.postWithUser = 'https://www.threads.net/@{user}/post/{id}'));
    const threadsRun = fakeContext([['https://www.threads.net/@walker/post/DAbCdEfGhIj', 200, fixture('threads_post.html')]], threads);
    const threadsPost = await EXTRACTORS.threads.extract(link('https://www.threads.com/@walker/post/DAbCdEfGhIj'), threadsRun.context);
    expect(threadsPost.items.length).toBeGreaterThan(0);
  });

  it('Facebook: the photo type name', async () => {
    const routes: [string, number, string][] = [['https://www.facebook.com/SamplePage/posts/', 200, fixture('facebook_post.html')]];
    const url = 'https://www.facebook.com/SamplePage/posts/pfbid0abc';
    const usual = await EXTRACTORS.facebook.extract(link(url), fakeContext(routes).context);
    const renamed = rulesWith(next => {
      next.sites.facebook.photoType = 'Image';
      next.sites.facebook.patterns.viewerImage.pattern = 'nothing-matches-this';
    });
    const changed = await EXTRACTORS.facebook.extract(link(url), fakeContext(routes, renamed).context).catch(() => undefined);
    expect(usual.items.length).toBeGreaterThan(0);
    expect(changed?.items.filter(item => item.kind === 'image').length || 0).toBeLessThan(usual.items.length);
  });
});

describe('report a site', () => {
  const query = (url: string) => {
    expect(url.startsWith(`${ISSUES_NEW_URL}?`)).toBe(true);
    return new URL(url).searchParams;
  };

  it('fills in the site, versions and error without personal data', () => {
    const url = buildSiteIssueUrl({
      site: 'instagram',
      appVersion: '5.6.1 (230)',
      rulesVersion: 3,
      error: 'No Instagram account called secret.user. See https://www.instagram.com/secret.user/?igsh=abc or mail me@example.com',
      postUrl: 'https://www.instagram.com/secret.user/?igsh=abc',
      hide: ['secret.user', undefined],
    });
    const params = query(url);
    expect(params.get('title')).toBe('Instagram stopped working');
    const body = params.get('body') || '';
    expect(body).toContain('Site: Instagram');
    expect(body).toContain('App version: 5.6.1 (230)');
    expect(body).toContain('Site rules version: 3');
    expect(body).toContain('Post link: not shared');
    expect(body).not.toMatch(/secret\.user|igsh|instagram\.com|me@example\.com/);
    expect(body).toContain('Error: No Instagram account called [hidden]. See [link] or mail [e-mail]');
  });

  it('adds the post link only when the person agrees, without its query', () => {
    const body =
      query(
        buildSiteIssueUrl({
          site: 'twitter',
          appVersion: '5.6.1',
          rulesVersion: 1,
          error: 'X hides this post',
          postUrl: 'https://x.com/a/status/123?s=20&t=token',
          includeLink: true,
        }),
      ).get('body') || '';
    expect(body).toContain('Post link: https://x.com/a/status/123\n');
    expect(body).not.toContain('token');
    expect(query(buildSiteIssueUrl({site: 'reddit', appVersion: '', rulesVersion: 1, includeLink: true, postUrl: 'file:///sdcard/secret.txt'})).get('body')).toContain(
      'Post link: not shared',
    );
  });

  it('cuts long errors', () => {
    expect(cleanErrorText('x'.repeat(2000))).toHaveLength(500);
    expect(cleanErrorText('a\n\n  b')).toBe('a b');
  });
});
