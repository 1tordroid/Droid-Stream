export const UPDATE_REPOSITORY = '1tordroid/Droid-Stream';

export const UPDATE_RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

/** Newest releases first, pre-releases (nightly builds) included. Used for beta builds. */
export const UPDATE_RELEASES_LIST_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`;

export interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  /** `sha256:<hex>`, set by GitHub on assets uploaded since mid-2025. */
  digest?: string | null;
}

export interface GithubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: ReleaseAsset[];
}

export const stripVersionTag = (tag: string): string => tag.trim().replace(/^v/i, '');

/**
 * True when the remote semver is newer than the installed version.
 * Tags are `vX.Y.Z`. Pre-release suffixes are ignored by GitHub's
 * `/releases/latest`, which only returns a stable release.
 */
export function compareVersions(localVersion: string, remoteVersion: string): boolean {
  try {
    const local = stripVersionTag(localVersion).split('.').map(part => Number(part));
    const remote = stripVersionTag(remoteVersion).split('.').map(part => Number(part));
    if (local.some(part => Number.isNaN(part)) || remote.some(part => Number.isNaN(part))) {
      return false;
    }

    if (remote[0] > local[0]) {
      return true;
    }
    if (remote[0] < local[0]) {
      return false;
    }

    if (remote[1] > local[1]) {
      return true;
    }
    if (remote[1] < local[1]) {
      return false;
    }

    if (remote[2] > local[2]) {
      return true;
    }

    return false;
  } catch {
    console.error('Invalid version format');
    return false;
  }
}

export type AppEdition = 'main' | 'ext' | 'tv';

/**
 * Which edition an APK on a release belongs to, from its file name:
 * DroidStreamExt-... is the edition with extension support, DroidStreamTV-...
 * (or a name with a "tv" word) is the TV edition, anything else is the main app.
 */
export function apkEdition(name: string): AppEdition {
  const lower = name.toLowerCase();
  if (lower.startsWith('droidstreamext') || /(^|[-_.])ext([-_.]|$)/.test(lower)) {
    return 'ext';
  }
  if (lower.startsWith('droidstreamtv') || /(^|[-_.])tv([-_.]|$)/.test(lower)) {
    return 'tv';
  }
  return 'main';
}

/**
 * Picks the APK for this app from a release. Only APKs of the same edition count,
 * so the main app never installs the extension or TV edition, and the other way
 * round. Among those, a 64-bit-only APK ("arm64" in the name) is used when the
 * device supports arm64-v8a; otherwise the universal one, then any of them.
 * The older boolean form (true = TV) is still accepted.
 */
export function selectReleaseApk(
  assets: ReleaseAsset[] | undefined,
  editionOrTv: AppEdition | boolean,
  supportedAbis: string[] = [],
): ReleaseAsset | undefined {
  const edition: AppEdition =
    typeof editionOrTv === 'boolean' ? (editionOrTv ? 'tv' : 'main') : editionOrTv;
  const apks = (assets || []).filter(
    asset =>
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.length > 0 &&
      apkEdition(asset.name) === edition,
  );
  const named = (word: string) => apks.find(asset => asset.name!.toLowerCase().includes(word));
  const arm64 = supportedAbis.includes('arm64-v8a') ? named('arm64') : undefined;
  return (
    arm64 ||
    named(edition === 'tv' ? 'tv' : 'mobile') ||
    named('universal') ||
    apks.find(asset => !asset.name!.toLowerCase().includes('arm64')) ||
    apks[0]
  );
}

/** The lowercase hex SHA-256 from a GitHub asset `digest`, or null when absent or not SHA-256. */
export function parseSha256Digest(digest: string | null | undefined): string | null {
  if (typeof digest !== 'string') {
    return null;
  }
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim());
  return match ? match[1].toLowerCase() : null;
}

const UPDATE_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com'];

/** Update APKs are only fetched over HTTPS from GitHub's release hosts. */
export function isAllowedUpdateUrl(url: string): boolean {
  const match = /^https:\/\/([^/?#:]+)(?::443)?(?:[/?#]|$)/i.exec(url.trim());
  return !!match && UPDATE_DOWNLOAD_HOSTS.includes(match[1].toLowerCase());
}

export type BuildChannel = 'stable' | 'nightly';

/** One build of the app: the installed one, or the one on a GitHub release. */
export interface AppBuild {
  /** `X.Y.Z`, without a leading v. */
  version: string;
  channel: BuildChannel;
  /** Nightly builds only: the `YYYYMMDD` of the `nightly-YYYYMMDD` tag. */
  nightlyDate?: string;
  /**
   * When the build came out, in ms. A release's `published_at`; for an
   * installed nightly, the time its build started.
   */
  time?: number;
}

/** What the build put in `expo.extra` (see app.config.js). */
export interface BuildInfo {
  buildChannel?: unknown;
  buildTag?: unknown;
  buildTime?: unknown;
}

const NIGHTLY_TAG = /^nightly-(\d{8})$/i;

const parseVersion = (value: string): number[] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stripVersionTag(value));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const parseTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
};

/**
 * The app version of a nightly release, from its APK names
 * (`DroidStream-nightly-v5.6.1-arm64-20261107.apk`) or else its title
 * (`Nightly Build v5.6.1 (2026-11-07)`). Nightly tags carry only the date.
 */
const nightlyVersion = (release: GithubRelease): string | undefined => {
  for (const asset of release.assets || []) {
    const match = /-v(\d+\.\d+\.\d+)[-.]/i.exec(asset.name || '');
    if (match) {
      return match[1];
    }
  }
  return /\bv(\d+\.\d+\.\d+)\b/i.exec(release.name || '')?.[1];
};

/**
 * The build a GitHub release holds, or null when it is not one the updater uses:
 * drafts, tags that are not `vX.Y.Z` or `nightly-YYYYMMDD`, and other
 * pre-releases are left out.
 */
export function releaseBuild(release: GithubRelease | undefined): AppBuild | null {
  const tag = release?.tag_name?.trim();
  if (!release || !tag || release.draft) {
    return null;
  }
  const time = parseTime(release.published_at);
  const nightly = NIGHTLY_TAG.exec(tag);
  if (nightly) {
    const version = nightlyVersion(release);
    return version ? {version, channel: 'nightly', nightlyDate: nightly[1], time} : null;
  }
  if (release.prerelease || !parseVersion(tag)) {
    return null;
  }
  return {version: stripVersionTag(tag), channel: 'stable', time};
}

/**
 * The installed build. A nightly build says so in `expo.extra`; anything else
 * is a stable build, and its time is when its release (`vX.Y.Z`) came out,
 * when that release is in `releases`.
 */
export function installedBuild(
  versionName: string,
  info: BuildInfo | undefined,
  releases: GithubRelease[] = [],
): AppBuild {
  const version = stripVersionTag(versionName || '');
  if (info?.buildChannel === 'nightly') {
    const tag = typeof info.buildTag === 'string' ? NIGHTLY_TAG.exec(info.buildTag.trim()) : null;
    return {version, channel: 'nightly', nightlyDate: tag?.[1], time: parseTime(info.buildTime)};
  }
  const own = releases
    .map(releaseBuild)
    .find(build => build?.channel === 'stable' && build.version === version);
  return {version, channel: 'stable', time: own?.time};
}

/**
 * Orders two builds: above 0 when `a` is newer than `b`, below 0 when older,
 * 0 when they count as the same build. The rule:
 * 1. A higher X.Y.Z is newer.
 * 2. Same version, both stable: the same build.
 * 3. Same version, both nightly: the later nightly date is newer. Dates only,
 *    never times: a nightly release is published after its build started, so
 *    times would make a nightly look newer than itself.
 * 4. Same version, one stable and one nightly: the one that came out later is
 *    newer. A nightly built after v5.6.1 shipped has the fixes since, and a
 *    v5.6.1 published after a 5.6.1 nightly was built replaces it. When either
 *    time is unknown they count as the same, so nothing is offered.
 */
export function compareBuilds(a: AppBuild, b: AppBuild): number {
  const left = parseVersion(a.version);
  const right = parseVersion(b.version);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index] ? 1 : -1;
    }
  }
  if (a.channel === 'stable' && b.channel === 'stable') {
    return 0;
  }
  if (a.channel === 'nightly' && b.channel === 'nightly') {
    if (!a.nightlyDate || !b.nightlyDate || a.nightlyDate === b.nightlyDate) {
      return 0;
    }
    return a.nightlyDate > b.nightlyDate ? 1 : -1;
  }
  if (a.time === undefined || b.time === undefined || a.time === b.time) {
    return 0;
  }
  return a.time > b.time ? 1 : -1;
}

/** `v5.6.1`, or `v5.6.1 nightly (2026-11-07)`. */
export function buildLabel(build: AppBuild): string {
  if (build.channel !== 'nightly') {
    return `v${build.version}`;
  }
  const date = build.nightlyDate;
  return date
    ? `v${build.version} nightly (${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)})`
    : `v${build.version} nightly`;
}

export interface UpdateChoice {
  release: GithubRelease;
  build: AppBuild;
  /** The same-edition APK for this device; missing when the release has none. */
  asset?: ReleaseAsset;
}

/**
 * The newest release that is newer than the installed build, or undefined.
 * Only stable releases count unless `beta` is on; then nightly builds count
 * too. Nothing older than the installed build is ever returned, so turning
 * beta off on a nightly waits for the next stable release that is newer. A
 * nightly needs an APK of this edition; a stable release without one is still
 * returned so its page can be opened.
 */
export function pickUpdate(
  releases: GithubRelease[],
  installed: AppBuild,
  options: {beta: boolean; edition: AppEdition; supportedAbis?: string[]},
): UpdateChoice | undefined {
  let best: UpdateChoice | undefined;
  for (const release of releases) {
    const build = releaseBuild(release);
    if (!build || (build.channel === 'nightly' && !options.beta)) {
      continue;
    }
    if (compareBuilds(build, installed) <= 0) {
      continue;
    }
    const asset = selectReleaseApk(release.assets, options.edition, options.supportedAbis);
    if (!asset && build.channel === 'nightly') {
      continue;
    }
    const order = best ? compareBuilds(build, best.build) : 1;
    // On a tie the stable release wins over the nightly.
    if (order > 0 || (order === 0 && build.channel === 'stable' && best?.build.channel === 'nightly')) {
      best = {release, build, asset};
    }
  }
  return best;
}
