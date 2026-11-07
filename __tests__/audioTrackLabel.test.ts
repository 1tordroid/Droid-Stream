import {describe, expect, it} from '@jest/globals';
import {audioTrackFormatLabel} from '../src/lib/player/audioTrackLabel';

describe('audioTrackFormatLabel', () => {
  it('names common audio formats', () => {
    expect(audioTrackFormatLabel({type: 'audio/vnd.dts'})).toBe('DTS');
    expect(audioTrackFormatLabel({type: 'audio/true-hd'})).toBe('TrueHD');
    expect(audioTrackFormatLabel({type: 'audio/eac3-joc'})).toBe('E-AC3 Atmos');
    expect(audioTrackFormatLabel({type: 'audio/mp4a-latm'})).toBe('AAC');
  });

  it('marks tracks the app decodes in software', () => {
    expect(audioTrackFormatLabel({type: 'audio/vnd.dts', softwareDecoded: true})).toBe('DTS · software');
    expect(audioTrackFormatLabel({type: 'audio/true-hd', softwareDecoded: true})).toBe('TrueHD · software');
    expect(audioTrackFormatLabel({softwareDecoded: true})).toBe('software');
  });

  it('falls back to the MIME subtype and handles a missing type', () => {
    expect(audioTrackFormatLabel({type: 'audio/x-something'})).toBe('x-something');
    expect(audioTrackFormatLabel({})).toBe('');
  });
});
