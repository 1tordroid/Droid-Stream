import {mainStorage} from '../storage/StorageService';
import {ShowMarkers} from './introMarkerModel';

export type {ChapterMark, ShowMarkers} from './introMarkerModel';
export {markerKey, markersToSkips} from './introMarkerModel';

const keyFor = (showKey: string) => `show-markers:${showKey.trim().toLowerCase()}`;

export const readShowMarkers = (showKey: string): ShowMarkers => {
  const stored = mainStorage.getObject<ShowMarkers>(keyFor(showKey));
  return {
    introEnd: stored?.introEnd,
    creditsStart: stored?.creditsStart,
    chapters: Array.isArray(stored?.chapters) ? stored.chapters : [],
  };
};

export const writeShowMarkers = (showKey: string, markers: ShowMarkers): void => {
  mainStorage.setObject(keyFor(showKey), markers);
};
