jest.mock('../src/lib/downloader', () => ({downloadManager: jest.fn()}));
jest.mock('../src/lib/zustand/downloadsStore', () => ({__esModule: true, default: {getState: () => ({downloads: {}})}}));

import {qualityChoices} from '../src/lib/linkGrabber';

const variant = (label: string, kind = 'video') => ({url: `https://a.test/${label}`, label, kind});

describe('qualityChoices', () => {
  it('lists the best quality first and leaves out audio and subtitles', () => {
    const choices = qualityChoices([variant('480p'), variant('1080p'), variant('English', 'audio'), variant('720p'), variant('Subs', 'subtitle')]);
    expect(choices.map(item => item.label)).toEqual(['1080p', '720p', '480p']);
  });

  it('removes duplicates and keeps the limit', () => {
    expect(qualityChoices([variant('720p'), variant('720p')])).toHaveLength(1);
    expect(qualityChoices([variant('1080p'), variant('720p'), variant('480p')], 2)).toHaveLength(2);
  });

  it('ranks resolutions above bitrates', () => {
    expect(qualityChoices([variant('900 kbps'), variant('240p')]).map(item => item.label)).toEqual(['240p', '900 kbps']);
  });
});
