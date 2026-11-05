/**
 * Provider titles often carry release details, like
 * "Show {S01E1-7 Added} Netflix : Dual Audio {Hindi-English} 480p".
 * This keeps only the name for display. Searches still use the full title.
 */
const RELEASE_DETAILS =
  /[{[]|\s(?:netflix|jiohotstar|hotstar|prime video|amazon|zee5|sonyliv|disney\+?)\s*[:|-]|\b(?:dual audio|multi audio|hindi-english|480p|720p|1080p|2160p|web-?dl|web-?rip|blu-?ray|hdrip|hdtc|camrip|x264|x265|hevc)\b/i;

export const displayTitle = (title: string): string => {
  const cut = title.search(RELEASE_DETAILS);
  if (cut <= 0) return title;
  const clean = title.slice(0, cut).replace(/[\s:|–—-]+$/, '').trim();
  return clean || title;
};
