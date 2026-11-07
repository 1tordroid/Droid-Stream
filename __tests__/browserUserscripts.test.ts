import {describe, expect, it} from '@jest/globals';
import {includeToRegex, isUserscriptUrl, matchPatternToRegex, parseUserscript, runRules, scriptRunsOn} from '../src/lib/browser/userscripts/meta';

const SCRIPT = `// ==UserScript==
// @name         Wide pages
// @namespace    https://example.com
// @version      1.2
// @description  Makes pages wide
// @match        *://*.example.com/*
// @match        https://news.site.org/articles/*
// @include      http://www.google.tld/search*
// @exclude      *://*.example.com/login*
// @exclude-match https://news.site.org/articles/private/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.example.com
// @noframes
// ==/UserScript==
GM_addStyle('body{max-width:none}');
`;

describe('userscript metadata', () => {
  it('reads the metadata block', () => {
    const meta = parseUserscript(SCRIPT)!;
    expect(meta.name).toBe('Wide pages');
    expect(meta.version).toBe('1.2');
    expect(meta.match).toEqual(['*://*.example.com/*', 'https://news.site.org/articles/*']);
    expect(meta.include).toEqual(['http://www.google.tld/search*']);
    expect(meta.exclude).toEqual(['*://*.example.com/login*']);
    expect(meta.excludeMatch).toEqual(['https://news.site.org/articles/private/*']);
    expect(meta.runAt).toBe('document-start');
    expect(meta.grant).toEqual(['GM_addStyle', 'GM_xmlhttpRequest']);
    expect(meta.connect).toEqual(['api.example.com']);
    expect(meta.noframes).toBe(true);
  });

  it('defaults to document-idle and needs a name', () => {
    expect(parseUserscript('// ==UserScript==\n// @name x\n// ==/UserScript==')!.runAt).toBe('document-idle');
    expect(parseUserscript('// ==UserScript==\n// @match *://*/*\n// ==/UserScript==')).toBeNull();
    expect(parseUserscript('console.log(1)')).toBeNull();
  });
});

describe('@match and @include', () => {
  it('matches Chrome match patterns', () => {
    const any = matchPatternToRegex('*://*.example.com/*')!;
    expect(any.test('https://example.com/')).toBe(true);
    expect(any.test('http://a.b.example.com/x?y')).toBe(true);
    expect(any.test('https://notexample.com/')).toBe(false);
    expect(any.test('ftp://example.com/')).toBe(false);
    expect(matchPatternToRegex('<all_urls>')!.test('https://x.org/')).toBe(true);
    expect(matchPatternToRegex('https://a.com/path/*')!.test('https://a.com/other')).toBe(false);
    expect(matchPatternToRegex('not a pattern')).toBeNull();
  });

  it('matches globs, .tld and regex includes', () => {
    expect(includeToRegex('http://www.google.tld/search*')!.test('http://www.google.co.in/search?q=1')).toBe(true);
    expect(includeToRegex('*')!.test('https://anything/')).toBe(true);
    expect(includeToRegex('/^https:\\/\\/(www\\.)?reddit\\.com/')!.test('https://www.reddit.com/r/x')).toBe(true);
  });

  it('decides which pages a script runs on', () => {
    const meta = parseUserscript(SCRIPT)!;
    expect(scriptRunsOn(meta, 'https://www.example.com/page')).toBe(true);
    expect(scriptRunsOn(meta, 'https://www.example.com/login?next=/')).toBe(false);
    expect(scriptRunsOn(meta, 'https://news.site.org/articles/1')).toBe(true);
    expect(scriptRunsOn(meta, 'https://news.site.org/articles/private/2')).toBe(false);
    expect(scriptRunsOn(meta, 'http://www.google.com/search?q=a')).toBe(true);
    expect(scriptRunsOn(meta, 'https://other.com/')).toBe(false);
    expect(scriptRunsOn({match: [], include: [], exclude: [], excludeMatch: []}, 'https://any.com/')).toBe(true);
    expect(scriptRunsOn({match: [], include: [], exclude: [], excludeMatch: []}, 'about:blank')).toBe(false);
  });

  it('gives the page regexes that agree with the app', () => {
    const meta = parseUserscript(SCRIPT)!;
    const rules = runRules(meta);
    const test = (url: string) =>
      !rules.exclude.some(source => new RegExp(source, 'i').test(url)) &&
      (rules.everywhere || rules.include.some(source => new RegExp(source, 'i').test(url)));
    for (const url of ['https://www.example.com/page', 'https://www.example.com/login', 'https://news.site.org/articles/private/2', 'https://other.com/']) {
      expect(test(url)).toBe(scriptRunsOn(meta, url));
    }
  });

  it('spots userscript links', () => {
    expect(isUserscriptUrl('https://greasyfork.org/scripts/1/code/x.user.js')).toBe(true);
    expect(isUserscriptUrl('https://example.com/app.js')).toBe(false);
  });
});
