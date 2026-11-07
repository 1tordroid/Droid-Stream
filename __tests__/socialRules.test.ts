import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';
import {atPath, fillUrl, ruleRegex} from '../src/lib/social/rules/active';
import {BUNDLED_RULES} from '../src/lib/social/rules/rules.default';
import {checkSafePattern, MAX_PATTERN_LENGTH, UnsafePattern} from '../src/lib/social/rules/safeRegex';
import {verifyRulesSignature} from '../src/lib/social/rules/signature';
import {RULE_SITES, SITE_SPEC} from '../src/lib/social/rules/ruleSchema';
import {parseRules, RulesError, validateRules} from '../src/lib/social/rules/validate';

const RULES_PATH = join(__dirname, '..', 'rules', 'social-rules.json');
const rulesText = () => readFileSync(RULES_PATH, 'utf8');
const rulesJson = () => JSON.parse(rulesText());

/** A deep copy of the repository rules with one change made by [edit]. */
const edited = (edit: (rules: any) => void): any => {
  const rules = rulesJson();
  edit(rules);
  return rules;
};

describe('the rules file in the repository', () => {
  it('is valid, covers every site and is what the app bundles', () => {
    const rules = parseRules(rulesText());
    expect(rules.schema).toBe(1);
    expect(Object.keys(rules.sites).sort()).toEqual([...RULE_SITES].sort());
    expect(Object.keys(SITE_SPEC).sort()).toEqual(['facebook', 'instagram', 'pinterest', 'reddit', 'threads', 'tumblr', 'twitter']);
    expect(BUNDLED_RULES).toEqual(rules);
  });

  it('has a signature made with the key in the app', () => {
    const signature = readFileSync(`${RULES_PATH}.sig`, 'utf8');
    expect(verifyRulesSignature(rulesText(), signature)).toBe(true);
    // A Windows checkout with CRLF line ends signs the same bytes.
    expect(verifyRulesSignature(rulesText().replace(/\r?\n/g, '\r\n'), signature)).toBe(true);
  });

  it('keeps the values the readers used before the rules file', () => {
    const {instagram, twitter} = BUNDLED_RULES.sites;
    expect(instagram.headers['X-IG-App-ID']).toBe('936619743392459');
    expect(instagram.graphql.docId).toBe('8845758582119845');
    expect(fillUrl('instagram', instagram.endpoints.mediaInfo, {id: '42'})).toBe('https://www.instagram.com/api/v1/media/42/info/');
    expect(fillUrl('twitter', twitter.endpoints.tweet, {id: '1', token: 'a'})).toBe('https://cdn.syndication.twimg.com/tweet-result?id=1&token=a&lang=en');
  });
});

describe('rules validation', () => {
  const rejects = (rules: unknown, message: RegExp) => {
    expect(() => validateRules(rules)).toThrow(RulesError);
    expect(() => validateRules(rules)).toThrow(message);
  };

  it('rejects a wrong schema, version or day', () => {
    rejects(edited(rules => (rules.schema = 2)), /schema/);
    rejects(edited(rules => (rules.version = 0)), /version/);
    rejects(edited(rules => (rules.version = 1.5)), /version/);
    rejects(edited(rules => (rules.version = '2')), /version/);
    rejects(edited(rules => (rules.updated = 'yesterday')), /updated/);
    rejects(null, /must be an object/);
    rejects([], /must be an object/);
  });

  it('rejects a missing site or value', () => {
    rejects(edited(rules => delete rules.sites.reddit), /sites\.reddit/);
    rejects(edited(rules => delete rules.sites.instagram.graphql.docId), /sites\.instagram\.graphql\.docId/);
    rejects(edited(rules => (rules.sites.tumblr.photoSizes = [])), /photoSizes/);
  });

  it('keeps links on the site and on https', () => {
    rejects(edited(rules => (rules.sites.instagram.endpoints.graphql = 'https://evil.example/graphql')), /instagram\.com/);
    rejects(edited(rules => (rules.sites.instagram.endpoints.graphql = 'https://instagram.com.evil.example/q')), /instagram\.com/);
    rejects(edited(rules => (rules.sites.instagram.endpoints.graphql = 'http://www.instagram.com/graphql/query')), /https/);
    rejects(edited(rules => (rules.sites.reddit.endpoints.post = 'https://user:pw@www.reddit.com/x')), /user name/);
    rejects(edited(rules => (rules.sites.reddit.endpoints.post = 'https://www.reddit.com/{id')), /placeholder/);
    // The X rules cannot point at Reddit either.
    rejects(edited(rules => (rules.sites.twitter.endpoints.tweet = 'https://www.reddit.com/{id}')), /twimg\.com/);
  });

  it('checks headers, paths and values', () => {
    rejects(edited(rules => (rules.sites.reddit.headers.Accept = 'a\r\nCookie: x')), /control character/);
    rejects(edited(rules => (rules.sites.reddit.headers.Cookie = 'sessionid=1')), /set by the app/);
    rejects(edited(rules => (rules.sites.reddit.headers['Bad Name'] = 'x')), /header name/);
    rejects(edited(rules => (rules.sites.pinterest.paths.pin = 'data[0].pin')), /dotted path/);
    rejects(edited(rules => (rules.sites.instagram.graphql.variables.nested = {a: 1})), /null, true, false/);
  });

  it('rejects unsafe or oversized patterns and unknown flags', () => {
    const withPattern = (pattern: string, flags?: string) =>
      edited(rules => (rules.sites.facebook.patterns.video = flags === undefined ? {pattern} : {pattern, flags}));
    rejects(withPattern('(a+)+$'), /not a safe pattern/);
    rejects(withPattern('x'.repeat(MAX_PATTERN_LENGTH + 1)), /longer than/);
    rejects(withPattern('video', 'g'), /flag "g"/);
    rejects(withPattern('video', 'y'), /flag "y"/);
    rejects(withPattern('video', 'ii'), /twice/);
    rejects(edited(rules => (rules.sites.facebook.patterns.video = 'video')), /pattern/);
  });

  it('leaves out keys it does not know, so newer files still load', () => {
    const rules = validateRules(edited(next => {
      next.sites.instagram.somethingNew = {deep: true};
      next.extra = 1;
    }));
    expect((rules.sites.instagram as Record<string, unknown>).somethingNew).toBeUndefined();
    expect((rules as unknown as Record<string, unknown>).extra).toBeUndefined();
  });

  it('rejects files that are too large or not JSON', () => {
    expect(() => parseRules('')).toThrow(/empty/);
    expect(() => parseRules('{nope')).toThrow(/not JSON/);
    const big = JSON.stringify({...rulesJson(), padding: 'x'.repeat(70 * 1024)});
    expect(() => parseRules(big)).toThrow(/larger than 64 KB/);
  });
});

describe('safe patterns', () => {
  const unsafe = (pattern: string, flags = '') => expect(() => checkSafePattern(pattern, flags)).toThrow(UnsafePattern);
  const safe = (pattern: string, flags = '') => expect(checkSafePattern(pattern, flags)).toBeInstanceOf(RegExp);

  it('accepts every pattern the bundled rules use', () => {
    for (const site of RULE_SITES) {
      for (const rule of Object.values(BUNDLED_RULES.sites[site].patterns)) safe(rule.pattern, rule.flags);
    }
    safe('"(?:[^"\\\\]|\\\\.)*"');
    safe('(?:ab|cd)+');
    safe('[a-z]{2,8}');
    safe('(?:\\.([a-z]+))?');
  });

  it('rejects patterns that can backtrack for ever', () => {
    unsafe('(a+)+$');
    unsafe('(a*)*');
    unsafe('(?:a|a)*');
    unsafe('(?:a|ab)*');
    unsafe('(?:a?a?)*');
    unsafe('(?:(?:a|aa))*');
    unsafe('(?:\\w|\\d)+');
    unsafe('(?:[a-z]|[k-q])+');
    unsafe('(?:A|a)+', 'i');
    unsafe('(?:[^a]|[^b])*');
    unsafe('(.*){2,5}');
  });

  it('rejects features outside the subset', () => {
    unsafe('(a)\\1');
    unsafe('(?<name>a)');
    unsafe('(?=a)b');
    unsafe('(?<=a)b');
    unsafe('\\p{L}');
    unsafe('a{1,5000}');
    unsafe('x{');
    unsafe('[]');
    unsafe('(abc');
    unsafe('abc)');
    unsafe('^*');
    unsafe('a**');
    unsafe(Array.from({length: 13}, () => 'a+').join(''));
  });

  it('gives working patterns', () => {
    const rule = BUNDLED_RULES.sites.reddit.patterns.imageExtension;
    expect(ruleRegex(rule).test('https://i.example/x.JPEG?y')).toBe(true);
    // A "g" copy keeps no state between uses.
    const global = ruleRegex({pattern: 'a'}, 'g');
    expect([...'aaa'.matchAll(global)]).toHaveLength(3);
    expect(ruleRegex({pattern: 'a'}, 'g').lastIndex).toBe(0);
  });
});

describe('rule helpers', () => {
  it('fills links only on the site', () => {
    expect(fillUrl('tumblr', 'https://{blog}.tumblr.com/api/read/json?id={id}', {blog: 'staff', id: '1'})).toBe(
      'https://staff.tumblr.com/api/read/json?id=1',
    );
    expect(() => fillUrl('tumblr', 'https://{blog}.tumblr.com/x', {blog: 'evil.example/'})).toThrow(/outside/);
    expect(() => fillUrl('tumblr', 'https://{blog}.tumblr.com/x', {blog: 'evil.example?'})).toThrow(/outside/);
  });

  it('reads dotted paths without touching prototypes', () => {
    expect(atPath({data: {user: {id: 1}}}, 'data.user')).toEqual({id: 1});
    expect(atPath({data: null}, 'data.user')).toBeUndefined();
    expect(atPath({}, 'constructor')).toBeUndefined();
    expect(atPath({data: [1]}, 'data.0')).toBeUndefined();
  });
});
