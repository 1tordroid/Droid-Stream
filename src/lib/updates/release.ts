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

/**
 * Phone builds prefer an APK whose name contains "mobile", TV builds prefer
 * "tv", then either accepts "universal", then any APK. One universal asset
 * therefore updates both.
 */
export function selectReleaseApk(
  assets: ReleaseAsset[] | undefined,
  preferTv: boolean,
): ReleaseAsset | undefined {
  const apks = (assets || []).filter(
    asset =>
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.length > 0,
  );
  const keyword = preferTv ? 'tv' : 'mobile';
  return (
    apks.find(asset => asset.name!.toLowerCase().includes(keyword)) ||
    apks.find(asset => asset.name!.toLowerCase().includes('universal')) ||
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
