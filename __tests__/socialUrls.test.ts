import {describe, expect, it} from '@jest/globals';
import {classifySocialUrl, isSocialPostUrl, socialLinkInText} from '../src/lib/social/urls';

const kindOf = (url: string) => {
  const link = classifySocialUrl(url);
  return link ? [link.site, link.kind, link.id, link.user] : undefined;
};

describe('classifySocialUrl', () => {
  it('reads Instagram posts, reels, stories, highlights and profiles', () => {
    expect(kindOf('https://www.instagram.com/p/C3xYzAbCdEf/?igsh=abc')).toEqual(['instagram', 'post', 'C3xYzAbCdEf', undefined]);
    expect(kindOf('https://instagram.com/reel/C9AbCdEfGh/')).toEqual(['instagram', 'post', 'C9AbCdEfGh', undefined]);
    expect(kindOf('https://www.instagram.com/sample.user/p/C3xYzAbCdEf/')).toEqual(['instagram', 'post', 'C3xYzAbCdEf', 'sample.user']);
    expect(kindOf('https://www.instagram.com/stories/sample.user/3300000000000000001/')).toEqual(['instagram', 'story', '3300000000000000001', 'sample.user']);
    expect(kindOf('https://www.instagram.com/stories/sample.user/')).toEqual(['instagram', 'story', undefined, 'sample.user']);
    expect(kindOf('https://www.instagram.com/stories/highlights/17900000000000001/')).toEqual(['instagram', 'highlight', '17900000000000001', undefined]);
    // "/s/" share links carry "highlight:<id>" in base64.
    const share = Buffer.from('highlight:17900000000000001').toString('base64');
    expect(kindOf(`https://www.instagram.com/s/${share}?story_media_id=1`)).toEqual(['instagram', 'highlight', '17900000000000001', undefined]);
    expect(kindOf('https://www.instagram.com/sample.user/')).toEqual(['instagram', 'profile', undefined, 'sample.user']);
    expect(classifySocialUrl('https://www.instagram.com/explore/')).toBeUndefined();
    expect(classifySocialUrl('https://www.instagram.com/accounts/login/')).toBeUndefined();
  });

  it('reads X, Threads, Pinterest, Reddit and Tumblr posts', () => {
    expect(kindOf('https://x.com/SampleAcct/status/1850000000000000001/photo/2')).toEqual(['twitter', 'post', '1850000000000000001', 'SampleAcct']);
    expect(kindOf('https://mobile.twitter.com/i/web/status/1850000000000000001')).toEqual(['twitter', 'post', '1850000000000000001', undefined]);
    expect(kindOf('https://vxtwitter.com/a/status/1850000000000000001')?.[0]).toBe('twitter');
    expect(kindOf('https://www.threads.com/@walker/post/DAbCdEfGhIj')).toEqual(['threads', 'post', 'DAbCdEfGhIj', 'walker']);
    expect(kindOf('https://www.threads.net/@walker/post/DAbCdEfGhIj?xmt=1')?.[0]).toBe('threads');
    expect(kindOf('https://www.pinterest.com/pin/123456789012345678/')).toEqual(['pinterest', 'post', '123456789012345678', undefined]);
    expect(kindOf('https://de.pinterest.com/pin/cozy-corner--123456789012345678/')?.[2]).toBe('123456789012345678');
    expect(kindOf('https://pin.it/AbCdEf')).toEqual(['pinterest', 'post', undefined, undefined]);
    expect(kindOf('https://www.reddit.com/r/gardening/comments/1abcde/my_garden/')).toEqual(['reddit', 'post', '1abcde', 'gardening']);
    expect(kindOf('https://old.reddit.com/comments/1abcde')?.[2]).toBe('1abcde');
    expect(kindOf('https://redd.it/1abcde')?.[2]).toBe('1abcde');
    expect(kindOf('https://www.reddit.com/r/pics/s/AbCdEf')).toEqual(['reddit', 'post', undefined, undefined]);
    expect(kindOf('https://sampleblog.tumblr.com/post/712345678901234567/two-photos')).toEqual(['tumblr', 'post', '712345678901234567', 'sampleblog']);
    expect(kindOf('https://www.tumblr.com/sampleblog/712345678901234567')).toEqual(['tumblr', 'post', '712345678901234567', 'sampleblog']);
  });

  it('reads Facebook photo and post pages, and leaves videos to yt-dlp', () => {
    expect(kindOf('https://www.facebook.com/photo/?fbid=9001&set=a.1')).toEqual(['facebook', 'post', '9001', undefined]);
    expect(kindOf('https://www.facebook.com/SamplePage/posts/pfbid02abc')).toEqual(['facebook', 'post', 'pfbid02abc', 'SamplePage']);
    expect(kindOf('https://www.facebook.com/share/p/1AbCdEf/')).toEqual(['facebook', 'post', '1AbCdEf', undefined]);
    expect(kindOf('https://m.facebook.com/groups/12345/permalink/67890/')).toEqual(['facebook', 'post', '67890', '12345']);
    expect(classifySocialUrl('https://www.facebook.com/watch/?v=123')).toBeUndefined();
    expect(classifySocialUrl('https://www.facebook.com/share/v/1AbCdEf/')).toBeUndefined();
    expect(classifySocialUrl('https://www.facebook.com/SamplePage/videos/123/')).toBeUndefined();
  });

  it('ignores other sites, direct files and home pages', () => {
    expect(isSocialPostUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isSocialPostUrl('https://i.redd.it/sunset123.jpeg')).toBe(false);
    expect(isSocialPostUrl('https://x.com/home')).toBe(false);
    expect(isSocialPostUrl('https://www.instagram.com/')).toBe(false);
    expect(isSocialPostUrl('not a link')).toBe(false);
    expect(isSocialPostUrl('https://www.instagram.com/p/C3xYzAbCdEf/')).toBe(true);
  });

  it('finds a post link inside shared text', () => {
    expect(socialLinkInText('Look at this https://www.instagram.com/p/C3xYzAbCdEf/?igsh=1, nice!')).toBe('https://www.instagram.com/p/C3xYzAbCdEf/?igsh=1');
    expect(socialLinkInText('https://example.com/a https://x.com/a/status/1850000000000000001')).toBe('https://x.com/a/status/1850000000000000001');
    expect(socialLinkInText('https://example.com/page')).toBeUndefined();
  });
});
