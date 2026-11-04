import {
  compareVersions,
  selectReleaseApk,
  stripVersionTag,
} from '../src/lib/updates/release';

describe('Droid Stream release selection', () => {
  it('strips a leading v from GitHub tags', () => {
    expect(stripVersionTag('v5.3.2')).toBe('5.3.2');
    expect(stripVersionTag('5.3.2')).toBe('5.3.2');
  });

  it('treats a higher major, minor, or patch as an update', () => {
    expect(compareVersions('5.3.2', 'v5.3.3')).toBe(true);
    expect(compareVersions('5.3.2', '5.4.0')).toBe(true);
    expect(compareVersions('5.3.2', 'v6.0.0')).toBe(true);
    expect(compareVersions('5.3.2', 'v5.3.2')).toBe(false);
    expect(compareVersions('5.3.2', 'v5.3.1')).toBe(false);
    expect(compareVersions('5.3.2', 'not-a-version')).toBe(false);
  });

  it('prefers a universal APK when the release has no phone or TV split', () => {
    const assets = [
      {name: 'DroidStream-v5.4.0.aab', browser_download_url: 'https://example.com/app.aab'},
      {
        name: 'DroidStream-universal-v5.4.0.apk',
        browser_download_url: 'https://example.com/universal.apk',
      },
    ];
    expect(selectReleaseApk(assets, false)?.name).toBe('DroidStream-universal-v5.4.0.apk');
    expect(selectReleaseApk(assets, true)?.name).toBe('DroidStream-universal-v5.4.0.apk');
  });

  it('lets a phone build and a TV build pick their own APK', () => {
    const assets = [
      {name: 'DroidStream-mobile-v5.4.0.apk', browser_download_url: 'https://example.com/mobile.apk'},
      {name: 'DroidStream-tv-v5.4.0.apk', browser_download_url: 'https://example.com/tv.apk'},
      {name: 'DroidStream-universal-v5.4.0.apk', browser_download_url: 'https://example.com/universal.apk'},
    ];
    expect(selectReleaseApk(assets, false)?.browser_download_url).toBe('https://example.com/mobile.apk');
    expect(selectReleaseApk(assets, true)?.browser_download_url).toBe('https://example.com/tv.apk');
  });
});
