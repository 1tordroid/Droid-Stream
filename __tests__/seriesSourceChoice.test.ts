import {describe, expect, it} from '@jest/globals';
import {choiceFromStream, describeChoice, pickStream, serverFamily, streamLanguage, streamQuality} from '../src/lib/seriesDownloads/sourceChoice';
import type {Stream} from '../src/lib/providers/types';

const stream = (server: string, quality?: string): Stream => ({server, link: `https://x/${encodeURIComponent(server)}`, type: 'mp4', ...(quality ? {quality} : {})});

describe('source choice', () => {
  it('reads quality and language from the stream', () => {
    expect(streamQuality(stream('Filepress 1080p Hindi'))).toBe('1080');
    expect(streamQuality(stream('GDrive', '720'))).toBe('720');
    expect(streamQuality(stream('Server 4K'))).toBe('2160');
    expect(streamLanguage(stream('Filepress 1080p Hindi'))).toBe('hindi');
    expect(streamLanguage(stream('HubCloud [Eng]'))).toBe('english');
    expect(serverFamily('Filepress 1080p Hindi')).toBe('filepress');
  });

  it('picks the same server and quality for another episode', () => {
    const choice = choiceFromStream(stream('Filepress 720p'), 'vega');
    const streams = [stream('HubCloud 1080p'), stream('Filepress 1080p'), stream('Filepress 720p')];
    expect(pickStream(streams, choice)?.server).toBe('Filepress 720p');
  });

  it('falls back to the same server family, then a lower quality', () => {
    const choice = {provider: 'vega', server: 'Filepress 720p', quality: '720'};
    expect(pickStream([stream('HubCloud 1080p'), stream('Filepress 480p'), stream('Filepress 2160p')], choice)?.server).toBe('Filepress 480p');
    expect(pickStream([stream('HubCloud 1080p'), stream('GDrive 480p')], choice)?.server).toBe('GDrive 480p');
  });

  it('keeps the language', () => {
    const choice = {provider: 'vega', quality: '1080', language: 'tamil'};
    expect(pickStream([stream('A 1080p Hindi'), stream('B 1080p Tamil')], choice)?.server).toBe('B 1080p Tamil');
  });

  it('uses the provider order without a choice or a match', () => {
    expect(pickStream([stream('One'), stream('Two')])?.server).toBe('One');
    expect(pickStream([stream('One'), stream('Two')], {provider: 'vega', server: 'Three'})?.server).toBe('One');
    expect(pickStream([], {provider: 'vega'})).toBeUndefined();
  });

  it('describes a choice', () => {
    expect(describeChoice({provider: 'vega', server: 'Filepress', quality: '1080', language: 'hindi'})).toBe('Filepress · 1080p · Hindi');
    expect(describeChoice(undefined)).toBe('First server');
  });
});
