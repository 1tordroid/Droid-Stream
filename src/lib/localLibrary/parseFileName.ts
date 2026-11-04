const QUALITY = /\b(2160p|1080p|720p|480p|hdr|hevc|x264|x265|bluray|webrip|web-dl)\b/gi;

export interface ParsedVideoName {
  title: string;
  year?: number;
  extension: string;
}

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'iso', 'webm', 'ts'];

export const isVideoFileName = (name: string): boolean => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(extension);
};

/** Turns "The.Matrix.1999.1080p.mkv" into a title and year for artwork lookup. */
export const parseVideoFileName = (name: string): ParsedVideoName => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  const stem = name.replace(/\.[^.]+$/, '');
  const yearMatch = stem.match(/(?:^|[^0-9])(19|20)\d{2}(?!\d)/);
  const year = yearMatch ? Number(yearMatch[0].replace(/\D/g, '')) : undefined;
  const title = stem
    .replace(QUALITY, ' ')
    .replace(/(?:^|[^0-9])(19|20)\d{2}(?!\d).*/, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {title: title || stem, year, extension};
};
