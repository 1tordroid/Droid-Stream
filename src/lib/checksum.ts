import * as RNFS from '@dr.pogodin/react-native-fs';

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256';

const toPath = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** Hashes a finished file. Large files take a while; the work runs natively. */
export const fileChecksum = async (uri: string, algorithm: ChecksumAlgorithm): Promise<string> => {
  if (/^content:\/\//i.test(uri)) {
    throw new Error('This file is in a folder chosen with Android storage access. Move it to app storage to verify it.');
  }
  return (await RNFS.hash(toPath(uri), algorithm)).toLowerCase();
};

/** Guesses the algorithm from the length of a pasted hash. */
export const algorithmFor = (expected: string): ChecksumAlgorithm | undefined => {
  const clean = expected.trim().toLowerCase();
  if (/^[a-f0-9]{32}$/.test(clean)) return 'md5';
  if (/^[a-f0-9]{40}$/.test(clean)) return 'sha1';
  if (/^[a-f0-9]{64}$/.test(clean)) return 'sha256';
  return undefined;
};

export const checksumMatches = (actual: string, expected: string): boolean => actual.trim().toLowerCase() === expected.trim().toLowerCase();
