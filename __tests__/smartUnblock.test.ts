import {describe, expect, it} from '@jest/globals';
import {
  planRoute,
  pruneRoutes,
  rememberRoute,
  resolveUnblockMode,
  UNBLOCK_ROUTE_TTL_MS,
  type RouteContext,
} from '../src/lib/unblock/routing';
import {isSinkholeAddress, looksDnsBlocked, matchBlockPage} from '../src/lib/unblock/blockMatcher';
import {BLOCK_RULES} from '../src/lib/unblock/blockSignatures';
import {DEBRID_HOSTS, isDebridHost, isLocalHost} from '../src/lib/unblock/unblockHosts';

const NOW = 1_700_000_000_000;
const auto = (extra: Partial<RouteContext> = {}): RouteContext => ({
  mode: 'auto',
  warpConsent: true,
  now: NOW,
  ...extra,
});

describe('Smart unblock mode migration', () => {
  it('keeps a saved mode', () => {
    expect(resolveUnblockMode({stored: 'off', warpEnabled: true})).toEqual({
      mode: 'off',
      migrated: false,
      warpConsent: false,
    });
  });

  it('moves WARP users to Always WARP with WARP agreed', () => {
    expect(resolveUnblockMode({warpEnabled: true, byeDpiEnabled: false})).toEqual({
      mode: 'warp',
      migrated: true,
      warpConsent: true,
    });
  });

  it('moves users who turned ByeDPI on to Always ByeDPI', () => {
    expect(resolveUnblockMode({warpEnabled: false, byeDpiEnabled: true}).mode).toBe('byedpi');
  });

  it('moves everyone else, including the old unsaved ByeDPI default, to Auto without WARP', () => {
    expect(resolveUnblockMode({})).toEqual({mode: 'auto', migrated: true, warpConsent: false});
    expect(resolveUnblockMode({byeDpiEnabled: false, warpEnabled: false}).mode).toBe('auto');
  });

  it('ignores an unknown saved value', () => {
    expect(resolveUnblockMode({stored: 'vpn'}).mode).toBe('auto');
  });
});

describe('Smart unblock routing', () => {
  it('tries direct, then ByeDPI, then WARP in Auto', () => {
    expect(planRoute('example.org', auto())).toEqual(['direct', 'byedpi', 'warp']);
  });

  it('uses ByeDPI only until the user agrees to WARP', () => {
    expect(planRoute('example.org', auto({warpConsent: false}))).toEqual(['direct', 'byedpi']);
    expect(
      planRoute('example.org', auto({warpConsent: false, remembered: {route: 'warp', until: NOW + 1000}})),
    ).toEqual(['direct', 'byedpi']);
  });

  it('never sends debrid hosts through WARP in any mode', () => {
    const hosts = [
      'api.real-debrid.com',
      '12.download.real-debrid.com',
      'api.torbox.app',
      'api.alldebrid.com',
      'www.premiumize.me',
      'offcloud.com',
      'debrid-link.com',
      'api-drive.mypikpak.com',
    ];
    for (const host of hosts) {
      for (const mode of ['auto', 'byedpi', 'warp', 'off'] as const) {
        const plan = planRoute(host, {mode, warpConsent: true, now: NOW, remembered: {route: 'warp', until: NOW + 1000}});
        expect(plan).not.toContain('warp');
      }
    }
    expect(planRoute('api.real-debrid.com', {mode: 'warp', warpConsent: true, now: NOW})).toEqual(['direct', 'byedpi']);
  });

  it('starts at the remembered route until it expires, then tests direct again', () => {
    const remembered = {route: 'byedpi' as const, until: NOW + 1000};
    expect(planRoute('blocked.example', auto({remembered}))).toEqual(['byedpi', 'warp']);
    expect(planRoute('blocked.example', auto({remembered, now: NOW + 1000}))).toEqual(['direct', 'byedpi', 'warp']);
    expect(planRoute('blocked.example', auto({remembered: {route: 'warp', until: NOW + 1}}))).toEqual(['warp']);
  });

  it('keeps fixed routes for the Always modes and Off', () => {
    expect(planRoute('example.org', {mode: 'byedpi', warpConsent: false, now: NOW})).toEqual(['byedpi']);
    expect(planRoute('example.org', {mode: 'warp', warpConsent: true, now: NOW})).toEqual(['warp']);
    expect(planRoute('example.org', {mode: 'off', warpConsent: true, now: NOW})).toEqual(['direct']);
  });

  it('keeps Trakt, Simkl, AniList and TMDB direct first in Always WARP', () => {
    for (const host of ['api.trakt.tv', 'api.simkl.com', 'graphql.anilist.co', 'api.themoviedb.org', 'image.tmdb.org']) {
      expect(planRoute(host, {mode: 'warp', warpConsent: true, now: NOW})[0]).toBe('direct');
    }
  });

  it('never routes local addresses', () => {
    for (const host of ['localhost', '127.0.0.1', '192.168.1.5', '10.0.0.2', '172.20.1.1', 'nas.local', '[::1]']) {
      expect(isLocalHost(host)).toBe(true);
      expect(planRoute(host, {mode: 'byedpi', warpConsent: true, now: NOW})).toEqual(['direct']);
    }
    expect(isLocalHost('8.8.8.8')).toBe(false);
  });

  it('matches debrid subdomains but not look-alike names', () => {
    expect(isDebridHost('real-debrid.com')).toBe(true);
    expect(isDebridHost('x.REAL-DEBRID.com.')).toBe(true);
    expect(isDebridHost('notreal-debrid.com')).toBe(false);
    expect(isDebridHost('real-debrid.com.evil.example')).toBe(false);
    expect(DEBRID_HOSTS.length).toBeGreaterThan(0);
  });
});

describe('Smart unblock remembered routes', () => {
  it('keeps a route for seven days', () => {
    const table = rememberRoute({}, 'Blocked.Example', 'byedpi', NOW);
    expect(table).toEqual({'blocked.example': {route: 'byedpi', until: NOW + UNBLOCK_ROUTE_TTL_MS}});
    expect(pruneRoutes(table, NOW + UNBLOCK_ROUTE_TTL_MS - 1)).toEqual(table);
    expect(pruneRoutes(table, NOW + UNBLOCK_ROUTE_TTL_MS)).toEqual({});
  });

  it('forgets a host that works directly again', () => {
    const table = rememberRoute({}, 'blocked.example', 'warp', NOW);
    expect(rememberRoute(table, 'blocked.example', 'direct', NOW)).toEqual({});
  });

  it('never saves or keeps WARP for a debrid host', () => {
    expect(rememberRoute({}, 'api.torbox.app', 'warp', NOW)).toEqual({});
    expect(pruneRoutes({'api.torbox.app': {route: 'warp', until: NOW + 5000}}, NOW)).toEqual({});
    expect(pruneRoutes({'api.torbox.app': {route: 'byedpi', until: NOW + 5000}}, NOW)).toEqual({
      'api.torbox.app': {route: 'byedpi', until: NOW + 5000},
    });
  });

  it('drops damaged entries', () => {
    expect(pruneRoutes({a: {route: 'direct' as any, until: NOW + 5}, b: null as any}, NOW)).toEqual({});
  });
});

describe('Block page matching', () => {
  const page = (body: string, extra = {}) => ({
    status: 200,
    requestUrl: 'http://blocked.example/',
    contentType: 'text/html; charset=utf-8',
    body,
    ...extra,
  });

  it('spots the Department of Telecommunications page', () => {
    const body = '<html><body><p>Your requested URL has been blocked as per the directions received from <b>Department of Telecommunications</b>, Government of India.</p></body></html>';
    expect(matchBlockPage(page(body))?.id).toBe('dot-directions');
  });

  it('spots the Jio DoT compliance page', () => {
    const body = '<h1>YOU ARE NOT AUTHORIZED TO ACCESS THIS WEB PAGE AS PER THE DOT COMPLIANCE</h1>';
    expect(matchBlockPage(page(body))?.id).toBe('jio-dot-compliance');
  });

  it('spots court order and government authority pages', () => {
    expect(matchBlockPage(page('This website has been blocked until further notice either pursuant to court orders or on the directions issued'))?.id).toBe('court-order');
    expect(matchBlockPage(page('This URL has been blocked under instructions of a competent Government Authority'))?.id).toBe('government-authority');
  });

  it('spots a 451 and a redirect to an ISP block page', () => {
    expect(matchBlockPage({status: 451, requestUrl: 'https://a.example/'})?.id).toBe('status-451');
    expect(
      matchBlockPage({status: 200, requestUrl: 'http://a.example/', redirects: ['http://www.airtel.in/dot/']})?.id,
    ).toBe('airtel-dot');
  });

  it('leaves normal pages alone', () => {
    expect(matchBlockPage(page('<p>Welcome. Our team blocked spam last week.</p>'))).toBeNull();
    expect(matchBlockPage(page('News: the Department of Telecommunications held a meeting.'))).toBeNull();
    expect(matchBlockPage({status: 200, requestUrl: 'http://a.example/', redirects: ['http://a.example/blocked']})).toBeNull();
  });

  it('does not read big pages or non-HTML bodies', () => {
    const body = 'has been blocked as per the Department of Telecommunications ' + 'x'.repeat(BLOCK_RULES.maxBodyBytes);
    expect(matchBlockPage(page(body))).toBeNull();
    expect(matchBlockPage(page('has been blocked by the Department of Telecommunications', {contentType: 'application/json'}))).toBeNull();
  });

  it('keeps every pattern valid for both JavaScript and Java', () => {
    for (const signature of BLOCK_RULES.pages) {
      for (const source of signature.all) {
        expect(() => new RegExp(source, 'i')).not.toThrow();
        expect(source).not.toMatch(/\(\?<|\(\?P/);
      }
    }
  });
});

describe('DNS block detection', () => {
  it('treats sinkhole answers as blocks only when DNS over HTTPS has a real address', () => {
    expect(isSinkholeAddress('0.0.0.0')).toBe(true);
    expect(isSinkholeAddress('127.0.0.1')).toBe(true);
    expect(isSinkholeAddress('10.10.34.35')).toBe(true);
    expect(isSinkholeAddress('104.21.3.4')).toBe(false);
    expect(looksDnsBlocked(['0.0.0.0'], ['104.21.3.4'])).toBe(true);
    expect(looksDnsBlocked(null, ['104.21.3.4'])).toBe(true);
    expect(looksDnsBlocked(['104.21.3.4'], ['104.21.3.4'])).toBe(false);
    expect(looksDnsBlocked(['192.168.1.10'], null)).toBe(false);
    expect(looksDnsBlocked(null, null)).toBe(false);
  });
});
