import {
  compareVersions,
  selectReleaseApk,
  apkEdition,
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
    // The TV edition only installs a TV APK, never the phone app.
    expect(selectReleaseApk(assets, true)).toBeUndefined();
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

describe('selectReleaseApk with editions', () => {
  const url = (name: string) => ({name, browser_download_url: `https://example.com/${name}`});
  const assets = [
    url('DroidStream-universal-v5.7.0.apk'),
    url('DroidStream-arm64-v5.7.0.apk'),
    url('DroidStreamExt-arm64-v5.7.0.apk'),
    url('DroidStreamExt-universal-v5.7.0.apk'),
    url('DroidStreamTV-v5.7.0.apk'),
  ];

  test('tells the editions apart by file name', () => {
    expect(apkEdition('DroidStream-universal-v5.7.0.apk')).toBe('main');
    expect(apkEdition('DroidStreamExt-arm64-v5.7.0.apk')).toBe('ext');
    expect(apkEdition('DroidStreamTV-v5.7.0.apk')).toBe('tv');
    expect(apkEdition('DroidStream-nightly-v5.7.0-universal-20261107.apk')).toBe('main');
  });

  test('the main app never picks another edition', () => {
    expect(selectReleaseApk(assets, 'main', ['arm64-v8a', 'armeabi-v7a'])?.name).toBe('DroidStream-arm64-v5.7.0.apk');
    expect(selectReleaseApk(assets, 'main', ['armeabi-v7a'])?.name).toBe('DroidStream-universal-v5.7.0.apk');
    expect(selectReleaseApk(assets, 'main')?.name).toBe('DroidStream-universal-v5.7.0.apk');
  });

  test('the extension edition picks its own APK', () => {
    expect(selectReleaseApk(assets, 'ext', ['arm64-v8a'])?.name).toBe('DroidStreamExt-arm64-v5.7.0.apk');
    expect(selectReleaseApk(assets, 'ext', ['armeabi-v7a'])?.name).toBe('DroidStreamExt-universal-v5.7.0.apk');
  });

  test('the TV edition picks its own APK, and none if the release has none', () => {
    expect(selectReleaseApk(assets, 'tv', ['arm64-v8a'])?.name).toBe('DroidStreamTV-v5.7.0.apk');
    expect(selectReleaseApk(assets.slice(0, 2), 'tv')).toBeUndefined();
  });
});
