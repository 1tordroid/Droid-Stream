import {frameRateMatchingNativeValue, getFrameRateMatching, normalizeFrameRateMatching, setFrameRateMatching} from '../src/lib/player/frameRate';

describe('frame-rate matching setting', () => {
  it('defaults to seamless and maps to the native values', () => {
    expect(normalizeFrameRateMatching(undefined)).toBe('seamless');
    expect(getFrameRateMatching()).toBe('seamless');
    setFrameRateMatching('always');
    expect(getFrameRateMatching()).toBe('always');
    expect(frameRateMatchingNativeValue('off')).toBe(0);
    expect(frameRateMatchingNativeValue('seamless')).toBe(1);
    expect(frameRateMatchingNativeValue('always')).toBe(2);
    setFrameRateMatching('seamless');
  });
});
