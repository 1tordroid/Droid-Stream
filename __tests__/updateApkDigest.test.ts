import * as RNFS from '@dr.pogodin/react-native-fs';
import {isAllowedUpdateUrl, parseSha256Digest} from '../src/lib/updates/release';
import {verifyApkDigest} from '../src/lib/updates/verifyApk';

const HEX = 'ab'.repeat(32);
const hash = RNFS.hash as jest.Mock;

describe('update APK digest', () => {
  beforeEach(() => hash.mockReset());

  it('accepts a matching hash', async () => {
    hash.mockResolvedValue(HEX.toUpperCase());
    await expect(verifyApkDigest('/cache/a.apk', `sha256:${HEX}`)).resolves.toBe('match');
    expect(hash).toHaveBeenCalledWith('/cache/a.apk', 'sha256');
  });

  it('reports a mismatch', async () => {
    hash.mockResolvedValue('cd'.repeat(32));
    await expect(verifyApkDigest('/cache/a.apk', `sha256:${HEX}`)).resolves.toBe('mismatch');
  });

  it('skips the check when the release has no digest', async () => {
    await expect(verifyApkDigest('/cache/a.apk', undefined)).resolves.toBe('unchecked');
    await expect(verifyApkDigest('/cache/a.apk', 'md5:abc')).resolves.toBe('unchecked');
    expect(hash).not.toHaveBeenCalled();
    expect(parseSha256Digest(null)).toBeNull();
  });

  it('only allows GitHub download hosts over HTTPS', () => {
    expect(isAllowedUpdateUrl('https://github.com/1tordroid/Droid-Stream/releases/download/v1/a.apk')).toBe(true);
    expect(isAllowedUpdateUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedUpdateUrl('http://github.com/a.apk')).toBe(false);
    expect(isAllowedUpdateUrl('https://github.com.evil.example/a.apk')).toBe(false);
    expect(isAllowedUpdateUrl('https://evil.example/github.com/a.apk')).toBe(false);
  });
});
