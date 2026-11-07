import * as RNFS from '@dr.pogodin/react-native-fs';
import {parseSha256Digest} from './release';

export type ApkDigestResult = 'match' | 'mismatch' | 'unchecked';

/**
 * Compare a downloaded APK with the release asset's `sha256:<hex>` digest.
 * Older releases have no digest, so those stay 'unchecked' and install as before.
 */
export async function verifyApkDigest(
  filePath: string,
  digest: string | null | undefined,
): Promise<ApkDigestResult> {
  const expected = parseSha256Digest(digest);
  if (!expected) {
    return 'unchecked';
  }
  const actual = String(await RNFS.hash(filePath, 'sha256')).toLowerCase();
  return actual === expected ? 'match' : 'mismatch';
}
