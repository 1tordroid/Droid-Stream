import {
  AppBuild,
  GithubRelease,
  buildLabel,
  compareBuilds,
  installedBuild,
  pickUpdate,
  releaseBuild,
  selectReleaseApk,
} from '../src/lib/updates/release';

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/1tordroid/Droid-Stream/releases/download/x/${name}`,
});

// Asset lists as release.yml and main.yml upload them.
const stable = (version: string, publishedAt: string, extra: string[] = []): GithubRelease => ({
  tag_name: `v${version}`,
  name: `Droid Stream v${version}`,
  prerelease: false,
  draft: false,
  published_at: publishedAt,
  assets: [
    asset(`DroidStream-universal-v${version}.apk`),
    asset(`DroidStream-arm64-v${version}.apk`),
    ...extra.map(asset),
  ],
});

// main.yml: tag nightly-YYYYMMDD, assets named with the BUILD_DATE (YYYY-MM-DD).
const nightly = (version: string, date: string, publishedAt: string): GithubRelease => nightlyRelease(version, date, `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, publishedAt);
const nightlyRelease = (version: string, date: string, day: string, publishedAt: string): GithubRelease => ({
  tag_name: `nightly-${date}`,
  name: `Nightly Build v${version} (${day})`,
  prerelease: true,
  draft: false,
  published_at: publishedAt,
  assets: [
    asset(`DroidStream-nightly-v${version}-universal-${day}.apk`),
    asset(`DroidStream-nightly-v${version}-arm64-${day}.apk`),
  ],
});

const ARM64 = ['arm64-v8a', 'armeabi-v7a', 'armeabi'];
const ARM32 = ['armeabi-v7a', 'armeabi'];

describe('APK choice on real release asset lists', () => {
  const release = stable('5.6.1', '2026-11-10T12:00:00Z', [
    'DroidStreamExt-universal-v5.6.1.apk',
    'DroidStreamExt-arm64-v5.6.1.apk',
    'DroidStreamTV-v5.6.1.apk',
  ]);
  const night = nightly('5.6.1', '20261111', '2026-11-11T20:10:00Z');

  test('a 64-bit phone gets the arm64 APK, a 32-bit one the universal APK', () => {
    expect(selectReleaseApk(release.assets, 'main', ARM64)?.name).toBe('DroidStream-arm64-v5.6.1.apk');
    expect(selectReleaseApk(release.assets, 'main', ARM32)?.name).toBe('DroidStream-universal-v5.6.1.apk');
    // Unknown ABIs (old native module): the universal APK runs everywhere.
    expect(selectReleaseApk(release.assets, 'main', [])?.name).toBe('DroidStream-universal-v5.6.1.apk');
  });

  test('nightly names pick the same way', () => {
    expect(selectReleaseApk(night.assets, 'main', ARM64)?.name).toBe('DroidStream-nightly-v5.6.1-arm64-2026-11-11.apk');
    expect(selectReleaseApk(night.assets, 'main', ARM32)?.name).toBe('DroidStream-nightly-v5.6.1-universal-2026-11-11.apk');
  });

  test('other editions never pick the main APKs', () => {
    expect(selectReleaseApk(release.assets, 'ext', ARM64)?.name).toBe('DroidStreamExt-arm64-v5.6.1.apk');
    expect(selectReleaseApk(release.assets, 'ext', ARM32)?.name).toBe('DroidStreamExt-universal-v5.6.1.apk');
    expect(selectReleaseApk(release.assets, 'tv', ARM64)?.name).toBe('DroidStreamTV-v5.6.1.apk');
    expect(selectReleaseApk(night.assets, 'tv', ARM64)).toBeUndefined();
    expect(selectReleaseApk(night.assets, 'ext', ARM64)).toBeUndefined();
  });

  test('5.5 and 5.6 clients, which look for mobile then universal, still get the universal APK', () => {
    const oldPick = (assets: GithubRelease['assets']) => {
      const apks = (assets || []).filter(item => item.name!.endsWith('.apk'));
      const named = (word: string) => apks.find(item => item.name!.toLowerCase().includes(word));
      return named('mobile') || named('universal') || apks[0];
    };
    expect(oldPick(release.assets)?.name).toBe('DroidStream-universal-v5.6.1.apk');
  });
});

describe('release builds', () => {
  test('reads stable and nightly releases', () => {
    expect(releaseBuild(stable('5.6.1', '2026-11-10T12:00:00Z'))).toEqual({
      version: '5.6.1',
      channel: 'stable',
      time: Date.parse('2026-11-10T12:00:00Z'),
    });
    expect(releaseBuild(nightly('5.6.1', '20261111', '2026-11-11T20:10:00Z'))).toEqual({
      version: '5.6.1',
      channel: 'nightly',
      nightlyDate: '20261111',
      time: Date.parse('2026-11-11T20:10:00Z'),
    });
  });

  test('takes a nightly version from the title when no APK name has one', () => {
    expect(releaseBuild({tag_name: 'nightly-20261111', prerelease: true, name: 'Nightly Build v5.6.2 (2026-11-11)'})?.version).toBe('5.6.2');
    expect(releaseBuild({tag_name: 'nightly-20261111', prerelease: true, name: 'Nightly'})).toBeNull();
  });

  test('leaves out drafts, other pre-releases and odd tags', () => {
    expect(releaseBuild({...stable('5.7.0', '2026-12-01T00:00:00Z'), draft: true})).toBeNull();
    expect(releaseBuild({...stable('5.7.0', '2026-12-01T00:00:00Z'), prerelease: true})).toBeNull();
    expect(releaseBuild({tag_name: 'v5.7.0-beta.1', prerelease: true})).toBeNull();
    expect(releaseBuild({tag_name: 'latest'})).toBeNull();
    expect(releaseBuild(undefined)).toBeNull();
  });

  test('labels builds for the update dialog', () => {
    expect(buildLabel({version: '5.6.1', channel: 'stable'})).toBe('v5.6.1');
    expect(buildLabel({version: '5.6.1', channel: 'nightly', nightlyDate: '20261111'})).toBe('v5.6.1 nightly (2026-11-11)');
  });
});

describe('installed build', () => {
  const releases = [stable('5.6.0', '2026-10-01T10:00:00Z'), stable('5.5.0', '2026-08-01T10:00:00Z')];

  test('a stable build takes its date from its own release', () => {
    expect(installedBuild('5.6.0', {buildChannel: 'stable'}, releases)).toEqual({
      version: '5.6.0',
      channel: 'stable',
      time: Date.parse('2026-10-01T10:00:00Z'),
    });
    expect(installedBuild('5.6.0', undefined, [])).toEqual({version: '5.6.0', channel: 'stable', time: undefined});
  });

  test('a nightly build reads its tag and build time from the app config', () => {
    expect(
      installedBuild('5.6.0', {buildChannel: 'nightly', buildTag: 'nightly-20261105', buildTime: '2026-11-05T18:35:00Z'}),
    ).toEqual({
      version: '5.6.0',
      channel: 'nightly',
      nightlyDate: '20261105',
      time: Date.parse('2026-11-05T18:35:00Z'),
    });
  });
});

describe('build order', () => {
  const s = (version: string, time?: string): AppBuild => ({version, channel: 'stable', time: time ? Date.parse(time) : undefined});
  const n = (version: string, nightlyDate: string, time?: string): AppBuild => ({
    version,
    channel: 'nightly',
    nightlyDate,
    time: time ? Date.parse(time) : undefined,
  });

  test('a higher version always wins, whatever the channel', () => {
    expect(compareBuilds(s('5.6.1'), n('5.6.0', '20261201'))).toBeGreaterThan(0);
    expect(compareBuilds(n('5.6.1', '20261101'), s('5.6.0', '2026-12-01T00:00:00Z'))).toBeGreaterThan(0);
    expect(compareBuilds(s('5.10.0'), s('5.9.9'))).toBeGreaterThan(0);
  });

  test('the same stable version is the same build', () => {
    expect(compareBuilds(s('5.6.1', '2026-11-10T00:00:00Z'), s('5.6.1'))).toBe(0);
  });

  test('nightlies of one version go by tag date only', () => {
    expect(compareBuilds(n('5.6.1', '20261112'), n('5.6.1', '20261111'))).toBeGreaterThan(0);
    // The installed nightly (build start time) against its own release (published later).
    expect(
      compareBuilds(n('5.6.1', '20261111', '2026-11-11T20:10:00Z'), n('5.6.1', '20261111', '2026-11-11T18:35:00Z')),
    ).toBe(0);
  });

  test('a stable and a nightly of one version: the later one wins', () => {
    const release = s('5.6.1', '2026-11-10T12:00:00Z');
    expect(compareBuilds(n('5.6.1', '20261111', '2026-11-11T20:10:00Z'), release)).toBeGreaterThan(0);
    expect(compareBuilds(release, n('5.6.1', '20261109', '2026-11-09T18:35:00Z'))).toBeGreaterThan(0);
    // Without a date to compare, neither replaces the other.
    expect(compareBuilds(n('5.6.1', '20261111', '2026-11-11T20:10:00Z'), s('5.6.1'))).toBe(0);
  });
});

describe('update choice', () => {
  const v560 = stable('5.6.0', '2026-10-01T10:00:00Z');
  const v561 = stable('5.6.1', '2026-11-10T12:00:00Z');
  const n1105 = nightly('5.6.0', '20261105', '2026-11-05T20:00:00Z');
  const n1111 = nightly('5.6.1', '20261111', '2026-11-11T20:10:00Z');
  const options = (beta: boolean) => ({beta, edition: 'main' as const, supportedAbis: ARM64});

  test('beta off: only stable releases count', () => {
    const releases = [n1105, v560];
    const installed = installedBuild('5.6.0', undefined, releases);
    expect(pickUpdate(releases, installed, options(false))).toBeUndefined();
    const update = pickUpdate([n1111, v561, v560], installed, options(false));
    expect(update?.release.tag_name).toBe('v5.6.1');
    expect(update?.asset?.name).toBe('DroidStream-arm64-v5.6.1.apk');
  });

  test('beta on: a nightly built after the installed release is offered, with the best APK', () => {
    const releases = [n1105, v560];
    const installed = installedBuild('5.6.0', undefined, releases);
    const update = pickUpdate(releases, installed, options(true));
    expect(update?.release.tag_name).toBe('nightly-20261105');
    expect(update?.asset?.name).toBe('DroidStream-nightly-v5.6.0-arm64-2026-11-05.apk');
    expect(pickUpdate(releases, installed, {...options(true), supportedAbis: ARM32})?.asset?.name).toBe(
      'DroidStream-nightly-v5.6.0-universal-2026-11-05.apk',
    );
  });

  test('beta on: the newest of stable and nightly wins', () => {
    const installed = installedBuild('5.6.0', undefined, [v560]);
    // The 5.6.1 nightly came out after v5.6.1.
    expect(pickUpdate([n1111, v561, v560], installed, options(true))?.release.tag_name).toBe('nightly-20261111');
    // v5.6.1 came out after the last 5.6.1 nightly.
    const early = nightly('5.6.1', '20261108', '2026-11-08T20:00:00Z');
    expect(pickUpdate([v561, early, v560], installed, options(true))?.release.tag_name).toBe('v5.6.1');
  });

  test('a nightly install moves to the stable release that replaces it', () => {
    const installed = installedBuild('5.6.1', {
      buildChannel: 'nightly',
      buildTag: 'nightly-20261108',
      buildTime: '2026-11-08T18:35:00Z',
    });
    expect(pickUpdate([v561], installed, options(false))?.release.tag_name).toBe('v5.6.1');
    expect(pickUpdate([v561], installed, options(true))?.release.tag_name).toBe('v5.6.1');
  });

  test('turning beta off on a newer nightly never goes back to an older stable', () => {
    const installed = installedBuild('5.6.1', {
      buildChannel: 'nightly',
      buildTag: 'nightly-20261111',
      buildTime: '2026-11-11T18:35:00Z',
    });
    expect(pickUpdate([v561, v560], installed, options(false))).toBeUndefined();
    // The next stable release is newer, so it is offered.
    const v562 = stable('5.6.2', '2026-12-01T12:00:00Z');
    expect(pickUpdate([v562], installed, options(false))?.release.tag_name).toBe('v5.6.2');
  });

  test('the installed nightly is not offered again', () => {
    const installed = installedBuild('5.6.1', {
      buildChannel: 'nightly',
      buildTag: 'nightly-20261111',
      buildTime: '2026-11-11T18:35:00Z',
    });
    expect(pickUpdate([n1111, v561], installed, options(true))).toBeUndefined();
  });

  test('a nightly without an APK for this edition is skipped; a stable one still opens its page', () => {
    const installed = installedBuild('5.6.0', undefined, [v560]);
    expect(pickUpdate([n1111, v560], installed, {...options(true), edition: 'tv'})).toBeUndefined();
    const update = pickUpdate([v561, v560], installed, {...options(true), edition: 'tv'});
    expect(update?.release.tag_name).toBe('v5.6.1');
    expect(update?.asset).toBeUndefined();
  });
});
