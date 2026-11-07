import {describe, expect, it} from '@jest/globals';
import {buildBootstrap, buildUserscriptInjection, callPage} from '../src/lib/browser/inject';
import {decideSave, loginOrigin, loginsForUrl, loginsToCsv, upsertLogin, type SavedLogin} from '../src/lib/browser/passwords';
import {forgetLayout, layoutFor, layoutSiteOf, readLayouts, readSettings, rememberLayout, shouldAskLayout, updateSettings} from '../src/lib/browser/store';

describe('page script', () => {
  it('is valid JavaScript for every option', () => {
    for (const desktop of [true, false]) {
      for (const darkPages of [true, false]) {
        const code = buildBootstrap({token: 'abc123', desktop, darkPages, videoButton: true, detectLogins: !desktop});
        expect(() => new Function(code)).not.toThrow();
      }
    }
  });

  it('wraps a userscript and page calls as valid JavaScript', () => {
    const code = buildUserscriptInjection('t', {id: 'us1', code: 'GM_addStyle("a{}"); // last line comment', runAt: 'document-end', name: 'X'}, {count: 1});
    expect(() => new Function(code)).not.toThrow();
    expect(callPage('__dsHide', ['.ad', 'a[href*="x"]'])).toContain('window.__dsHide([".ad","a[href*=\\"x\\"]"])');
  });
});

describe('saved passwords', () => {
  const base: SavedLogin = {id: '1', origin: 'https://www.example.com', username: 'me', password: 'old', createdAt: 1, updatedAt: 1};

  it('reads origins without default ports or paths', () => {
    expect(loginOrigin('https://Example.com:443/login?x')).toBe('https://example.com');
    expect(loginOrigin('http://example.com:8080/')).toBe('http://example.com:8080');
    expect(loginOrigin('ftp://example.com')).toBe('');
  });

  it('matches the same site with or without www, never an https login on http', () => {
    expect(loginsForUrl([base], 'https://example.com/signin')).toHaveLength(1);
    expect(loginsForUrl([base], 'https://evil-example.com/')).toHaveLength(0);
    expect(loginsForUrl([base], 'https://example.com.evil.net/')).toHaveLength(0);
    expect(loginsForUrl([base], 'http://www.example.com/')).toHaveLength(0);
  });

  it('decides between new, update and same', () => {
    expect(decideSave([base], 'https://example.com/', 'me', 'old')).toBe('same');
    expect(decideSave([base], 'https://example.com/', 'me', 'new')).toBe('update');
    expect(decideSave([base], 'https://example.com/', 'you', 'x')).toBe('new');
    const updated = upsertLogin([base], 'https://example.com/', 'me', 'new', 5);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({password: 'new', updatedAt: 5});
    expect(upsertLogin([base], 'https://other.com/', 'me', 'x', 5)).toHaveLength(2);
  });

  it('exports CSV that password managers import', () => {
    const csv = loginsToCsv([{...base, password: 'a,"b"'}]);
    expect(csv.split('\n')[0]).toBe('name,url,username,password');
    expect(csv.split('\n')[1]).toBe('example.com,https://www.example.com,me,"a,""b"""');
  });
});

describe('desktop or mobile', () => {
  it('uses the default, then what was remembered for the site', () => {
    expect(readSettings().defaultLayout).toBe('desktop');
    expect(layoutFor('https://m.example.com/x')).toBe('desktop');
    rememberLayout('https://m.example.com/x', 'mobile');
    expect(layoutSiteOf('https://www.example.com/')).toBe('example.com');
    expect(layoutFor('https://www.example.com/')).toBe('mobile');
    expect(readLayouts()).toEqual({'example.com': 'mobile'});
    forgetLayout('example.com');
    expect(layoutFor('https://www.example.com/')).toBe('desktop');
  });

  it('asks for new tabs only when that is on', () => {
    expect(shouldAskLayout('https://a.com/')).toBe(true);
    expect(shouldAskLayout('about:blank')).toBe(false);
    updateSettings({askLayoutForNewTabs: false, defaultLayout: 'mobile'});
    expect(shouldAskLayout('https://a.com/')).toBe(false);
    expect(layoutFor('https://a.com/')).toBe('mobile');
  });
});
