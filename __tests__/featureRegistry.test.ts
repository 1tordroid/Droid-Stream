import {describe, expect, it} from '@jest/globals';
import {FEATURES, searchFeatures} from '../src/lib/featureRegistry';

describe('feature search', () => {
  it('finds an advanced option from a synonym', () => {
    const hits = searchFeatures('kill switch');
    expect(hits[0]?.entry.id).toBe('torrent-vpn');
    expect(hits[0]?.entry.advanced).toBe(true);
  });

  it('tolerates a missing letter', () => {
    const hits = searchFeatures('subtitel size');
    expect(hits.some(hit => hit.entry.id === 'subtitles')).toBe(true);
  });

  it('matches download threads, nas, and support', () => {
    expect(searchFeatures('idm threads')[0]?.entry.id).toBe('download-connections');
    expect(searchFeatures('nas smb')[0]?.entry.id).toBe('source-smb');
    expect(searchFeatures('telegram')[0]?.entry.id).toBe('support');
    expect(searchFeatures('m3u8')[0]?.entry.id).toBe('download-hls');
  });

  it('returns nothing for a blank query and keeps every feature reachable', () => {
    expect(searchFeatures('   ')).toEqual([]);
    const ids = new Set(FEATURES.map(entry => entry.id));
    expect(ids.has('player-engine')).toBe(true);
    expect(ids.has('torrent-blocklist')).toBe(true);
    expect(ids.has('download-checksum')).toBe(true);
  });
});

describe('library features', () => {
  it('finds the poster library and fix match', () => {
    expect(searchFeatures('rescan')[0]?.entry.id).toBe('network-library');
    expect(searchFeatures('wrong poster')[0]?.entry.id).toBe('library-fix-match');
  });
});
describe('about features', () => {
  it('finds the update check, the credits page and the licence list', () => {
    expect(searchFeatures('check for updates')[0]?.entry.id).toBe('check-updates');
    expect(searchFeatures('check for updates')[0]?.entry.route).toEqual({tab: 'SettingsStack', screen: 'Settings'});
    expect(searchFeatures('credits')[0]?.entry.id).toBe('credits');
    expect(searchFeatures('licence')[0]?.entry.id).toBe('licenses');
  });
});
