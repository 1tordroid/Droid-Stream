/**
 * Smaller artwork for the pause screen and the screensaver: TMDB images are
 * asked for at 780 px wide, which is plenty for a slowly moving, dimmed
 * backdrop and keeps memory low on TV boxes.
 */
const TMDB_SIZE = /(image\.tmdb\.org\/t\/p\/)(original|w\d{3,4})\//i;

export const smallArtwork = (uri: string | undefined): string | undefined => {
  if (!uri || !/^https?:\/\//i.test(uri)) return uri || undefined;
  return uri.replace(TMDB_SIZE, '$1w780/');
};

/** Up to [max] distinct web images, in order. */
export const pickArtwork = (uris: (string | undefined)[], max: number): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const uri of uris) {
    if (result.length >= max) break;
    const small = smallArtwork(uri);
    if (!small || !/^https?:\/\//i.test(small) || seen.has(small)) continue;
    seen.add(small);
    result.push(small);
  }
  return result;
};
