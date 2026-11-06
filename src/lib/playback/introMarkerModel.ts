export interface ChapterMark {
  title: string;
  start: number;
}

export interface ShowMarkers {
  introEnd?: number;
  creditsStart?: number;
  chapters: ChapterMark[];
}

export const markerKey = (title?: string, provider?: string): string =>
  [provider, title].filter(Boolean).join('::') || 'unknown';

export const markersToSkips = (markers: ShowMarkers) => {
  const skips: {title: string; from: number; to: number}[] = [];
  if (markers.introEnd && markers.introEnd > 1) {
    skips.push({title: 'Intro', from: 0, to: markers.introEnd});
  }
  if (markers.creditsStart && markers.creditsStart > 1) {
    skips.push({
      title: 'Credits',
      from: markers.creditsStart,
      to: markers.creditsStart + 60 * 60 * 6,
    });
  }
  return skips;
};
