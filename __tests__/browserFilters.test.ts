import {describe, expect, it} from '@jest/globals';
import {compileCosmetic, selectorsFor} from '../src/lib/browser/filters/cosmetic';
import {FilterEngine, inferRequestType, isThirdParty, urlTokens} from '../src/lib/browser/filters/engine';
import {compileNetwork, lineToRule, parseFilters, patternToRegex, patternToken, ruleToLine, TYPE} from '../src/lib/browser/filters/parse';

const engineFor = (text: string) => {
  const parsed = parseFilters(text);
  return {engine: FilterEngine.fromLines(compileNetwork(parsed)), parsed};
};

describe('filter parsing', () => {
  it('reads ||host^ rules as host rules without a regex', () => {
    const {parsed} = engineFor('||ads.example.com^');
    expect(parsed.network).toHaveLength(1);
    expect(parsed.network[0]).toMatchObject({host: 'ads.example.com', regex: '', exception: false});
  });

  it('keeps a regex when the host rule has a path', () => {
    const {parsed} = engineFor('||example.com/banners/*.gif');
    expect(parsed.network[0].host).toBe('example.com');
    expect(parsed.network[0].regex).toContain('banners');
  });

  it('reads options, exceptions and domains', () => {
    const {parsed} = engineFor('@@||cdn.example.com^$script,image,~third-party,domain=a.com|~b.a.com');
    const rule = parsed.network[0];
    expect(rule.exception).toBe(true);
    expect(rule.typesIn).toBe(TYPE.script | TYPE.image);
    expect(rule.party).toBe('1');
    expect(rule.domainsIn).toEqual(['a.com']);
    expect(rule.domainsOut).toEqual(['b.a.com']);
  });

  it('skips comments, scriptlets, procedural cosmetics and rewriting rules', () => {
    const parsed = parseFilters([
      '! a comment',
      '[Adblock Plus 2.0]',
      'example.com##+js(set-constant, x, 1)',
      'example.com##.ad:has-text(Sponsored)',
      '||example.com^$redirect=noop.js',
      '||example.com^$removeparam=utm_source',
      '||example.com^$popup',
      '||example.com^$csp=script-src none',
    ].join('\n'));
    expect(parsed.network).toHaveLength(0);
    expect(parsed.cosmetic).toHaveLength(0);
  });

  it('reads hosts files', () => {
    const {engine} = engineFor('0.0.0.0 tracker.example.net\n127.0.0.1 localhost');
    expect(engine.match('https://tracker.example.net/p.gif', 'https://site.com/', TYPE.image).blocked).toBe(true);
    expect(engine.size).toBe(1);
  });

  it('turns patterns into regexes that work in Java too', () => {
    expect(patternToRegex('example.com^', true, false, false)).toBe('^[a-z][a-z0-9+.\\-]*://(?:[^/?#]*\\.)?example\\.com(?:[^\\w\\-.%]|$)');
    expect(patternToRegex('*/ads/*', false, false, false)).toBe('/ads/');
    expect(patternToRegex('swf', false, false, true)).toBe('swf$');
    expect(patternToRegex('http://x.com/', false, true, false)).toBe('^http://x\\.com/');
  });

  it('indexes by a whole word of the pattern', () => {
    expect(patternToken('/adserver/*', false, false, false)).toBe('adserver');
    // "ad" touches a wildcard, so it may be part of a longer word.
    expect(patternToken('ad*', false, false, false)).toBe('');
    expect(patternToken('-banner-ad.', false, false, false)).toBe('banner');
    expect(urlTokens('https://Ex.com/AdServer/x.js')).toEqual(expect.arrayContaining(['adserver', 'ex', 'js']));
  });

  it('round-trips compiled lines and drops duplicates and $badfilter targets', () => {
    const parsed = parseFilters('||a.com^$third-party\n||a.com^$third-party\n||b.com^\n||b.com^$badfilter');
    const lines = compileNetwork(parsed);
    expect(lines).toHaveLength(1);
    expect(ruleToLine(lineToRule(lines[0])!)).toBe(lines[0]);
  });
});

describe('filter matching', () => {
  const {engine} = engineFor([
    '||ads.example.com^',
    '||tracker.net^$third-party',
    '/adserver/*',
    '-banner-ad.',
    '||cdn.site.com/ads/$image',
    '||widgets.net^$script,domain=news.com|~sports.news.com',
    '@@||ads.example.com/allowed/',
    '||important.com^$important',
    '@@||important.com^',
    '@@||trusted.org^$document',
    '|https://start.com/x',
    'end.js|',
    '/\\/pop[0-9]+\\.js/',
  ].join('\n'));

  const blocked = (url: string, page: string, type: number = TYPE.script) => engine.shouldBlock(url, page, type);

  it('blocks a host and its subdomains, not look-alikes', () => {
    expect(blocked('https://ads.example.com/a.js', 'https://site.com/')).toBe(true);
    expect(blocked('https://x.ads.example.com/a.js', 'https://site.com/')).toBe(true);
    expect(blocked('https://ads.example.com.evil.net/a.js', 'https://site.com/')).toBe(false);
    expect(blocked('https://badads.example.com/a.js', 'https://site.com/')).toBe(false);
  });

  it('applies exceptions', () => {
    expect(blocked('https://ads.example.com/allowed/x.js', 'https://site.com/')).toBe(false);
    expect(engine.match('https://ads.example.com/allowed/x.js', 'https://site.com/', TYPE.script).exception).toBeDefined();
  });

  it('lets $important beat exceptions', () => {
    expect(blocked('https://important.com/x.js', 'https://site.com/')).toBe(true);
  });

  it('checks third party', () => {
    expect(blocked('https://tracker.net/p.js', 'https://site.com/')).toBe(true);
    expect(blocked('https://tracker.net/p.js', 'https://www.tracker.net/')).toBe(false);
    expect(isThirdParty('static.bbc.co.uk', 'www.bbc.co.uk')).toBe(false);
    expect(isThirdParty('a.com', 'b.com')).toBe(true);
  });

  it('checks $domain including excluded subdomains', () => {
    expect(blocked('https://widgets.net/w.js', 'https://news.com/')).toBe(true);
    expect(blocked('https://widgets.net/w.js', 'https://www.news.com/')).toBe(true);
    expect(blocked('https://widgets.net/w.js', 'https://sports.news.com/')).toBe(false);
    expect(blocked('https://widgets.net/w.js', 'https://other.com/')).toBe(false);
  });

  it('checks request types', () => {
    expect(blocked('https://cdn.site.com/ads/x.png', 'https://site.com/', TYPE.image)).toBe(true);
    expect(blocked('https://cdn.site.com/ads/x.js', 'https://site.com/', TYPE.script)).toBe(false);
  });

  it('matches plain patterns, anchors and regex rules', () => {
    expect(blocked('https://x.com/adserver/1.js', 'https://site.com/')).toBe(true);
    expect(blocked('https://x.com/img-banner-ad.png', 'https://site.com/', TYPE.image)).toBe(true);
    expect(blocked('https://start.com/xyz', 'https://site.com/')).toBe(true);
    expect(blocked('https://other.com/?u=https://start.com/x', 'https://site.com/')).toBe(false);
    expect(blocked('https://a.com/end.js', 'https://site.com/')).toBe(true);
    expect(blocked('https://a.com/end.js?v=1', 'https://site.com/')).toBe(false);
    expect(blocked('https://a.com/js/pop12.js', 'https://site.com/')).toBe(true);
  });

  it('allows everything on a page with a $document exception, and never blocks the page itself', () => {
    expect(blocked('https://ads.example.com/a.js', 'https://www.trusted.org/')).toBe(false);
    expect(engine.pageFlags('https://www.trusted.org/page')).toContain('d');
    expect(blocked('https://ads.example.com/', 'https://site.com/', TYPE.document)).toBe(false);
  });

  it('infers request types from Accept and the file name', () => {
    expect(inferRequestType('https://a.com/', 'text/html,application/xhtml+xml', false)).toBe(TYPE.subdocument);
    expect(inferRequestType('https://a.com/x.png', '*/*', false)).toBe(TYPE.image);
    expect(inferRequestType('https://a.com/x', 'image/avif,image/webp', false)).toBe(TYPE.image);
    expect(inferRequestType('https://a.com/app.js?v=2', '*/*', false)).toBe(TYPE.script);
    expect(inferRequestType('https://a.com/', '', true)).toBe(TYPE.document);
  });
});

describe('element hiding', () => {
  const parsed = parseFilters([
    '##.ad-banner',
    '###sponsored',
    'news.com##.promo',
    '~shop.com##.side-ad',
    'shop.com##.side-ad-2',
    'news.com#@#.ad-banner',
    '#@#.never',
    '##.never',
    'example.com##div:has-text(Ad)',
  ].join('\n'));
  const cosmetic = compileCosmetic(parsed.cosmetic);

  it('combines generic and site rules with their exceptions', () => {
    expect(selectorsFor(cosmetic, 'www.news.com')).toEqual(expect.arrayContaining(['.promo', '#sponsored', '.side-ad']));
    expect(selectorsFor(cosmetic, 'www.news.com')).not.toContain('.ad-banner');
    expect(selectorsFor(cosmetic, 'other.com')).toContain('.ad-banner');
    expect(selectorsFor(cosmetic, 'shop.com')).not.toContain('.side-ad');
    expect(selectorsFor(cosmetic, 'shop.com')).toContain('.side-ad-2');
    expect(selectorsFor(cosmetic, 'any.com')).not.toContain('.never');
  });

  it('honours page flags from $elemhide and $generichide', () => {
    expect(selectorsFor(cosmetic, 'news.com', 'h')).toEqual([]);
    expect(selectorsFor(cosmetic, 'news.com', 'g')).toEqual(['.promo']);
  });
});
