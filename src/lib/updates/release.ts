export const UPDATE_REPOSITORY = '1tordroid/Droid-Stream';

export const UPDATE_RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

export interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  /** `sha256:<hex>`, set by GitHub on assets uploaded since mid-2025. */
  digest?: string | null;
}

export interface GithubRelease {
  tag_name?: string;
  body?: string | null;
  html_url?: string;
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
