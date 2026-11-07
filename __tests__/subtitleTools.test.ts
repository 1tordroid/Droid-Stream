import {cleanCueText, cuesAround, cueTextAt, detectSubtitleFormat, parseClock, parseSubtitles} from '../src/lib/subtitles/cueParser';
import {subtitleRefFor} from '../src/lib/subtitles/subtitleCues';
import {
  clampSubtitleDelay,
  delayForLine,
  estimateSubtitleDelay,
  MIN_SYNC_CONFIDENCE,
  readTitleSubtitleDelay,
  speechFromLevels,
  writeTitleSubtitleDelay,
} from '../src/lib/subtitles/subtitleSync';
import {
  batchOrderFrom,
  buildTranslationRequest,
  parseTranslationResponse,
  readCachedTranslation,
  translateCues,
  translationBatches,
  translationCacheKey,
  translationProblem,
  translationServiceLabel,
  type TranslationSettings,
} from '../src/lib/subtitles/translation';
import {normalizeSecondSubtitleStyle, secondLineBottom} from '../src/lib/subtitles/dualSubtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>Hello</i> there

2
00:00:04,000 --> 00:00:06,000
General Kenobi!
Second line

3
00:01:00,250 --> 00:01:02,000
Third &amp; last
`;

const VTT = `WEBVTT

NOTE a comment

00:01.000 --> 00:02.000 align:start
<v Bob>Hi</v>

intro
00:00:03.000 --> 00:00:04.500
Two
`;

const ASS = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}Top, with comma\\Nnext
Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,ignored
`;

describe('cue parser', () => {
  it('parses SRT with markup, entities and multiple lines', () => {
    const cues = parseSubtitles(SRT, 'a.srt');
    expect(cues).toEqual([
      {start: 1, end: 3.5, text: 'Hello there'},
      {start: 4, end: 6, text: 'General Kenobi!\nSecond line'},
      {start: 60.25, end: 62, text: 'Third & last'},
    ]);
  });

  it('parses WebVTT with cue settings, voices and identifiers', () => {
    expect(parseSubtitles(VTT)).toEqual([
      {start: 1, end: 2, text: 'Hi'},
      {start: 3, end: 4.5, text: 'Two'},
    ]);
  });

  it('parses ASS dialogue, keeping commas in the text', () => {
    expect(parseSubtitles(ASS)).toEqual([{start: 1.5, end: 3, text: 'Top, with comma\nnext'}]);
  });

  it('parses simple TTML', () => {
    const ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.500">One<br/>Two</p><p begin="3s" dur="1.5s">Three</p></div></body></tt>';
    expect(parseSubtitles(ttml)).toEqual([
      {start: 1, end: 2.5, text: 'One\nTwo'},
      {start: 3, end: 4.5, text: 'Three'},
    ]);
  });

  it('reads clocks and formats', () => {
    expect(parseClock('01:02:03,456')).toBeCloseTo(3723.456);
    expect(parseClock('0:00:01.50')).toBeCloseTo(1.5);
    expect(parseClock('02:03.5')).toBeCloseTo(123.5);
    expect(parseClock('nope')).toBeUndefined();
    expect(detectSubtitleFormat('WEBVTT\n')).toBe('vtt');
    expect(cleanCueText('{\\i1}a{\\i0}\\hb')).toBe('a b');
  });

  it('finds the line at a time, including overlapping lines', () => {
    const cues = [
      {start: 0, end: 10, text: 'long'},
      {start: 2, end: 3, text: 'short'},
      {start: 12, end: 13, text: 'later'},
    ];
    expect(cueTextAt(cues, 2.5)).toBe('long\nshort');
    expect(cueTextAt(cues, 5)).toBe('long');
    expect(cueTextAt(cues, 11)).toBe('');
    expect(cueTextAt(cues, 12.5)).toBe('later');
    expect(cuesAround(cues, 5, 1, 1).map(item => item.index)).toEqual([1, 2]);
  });
});

describe('subtitle sync', () => {
  it('sets the delay that shows a picked line now', () => {
    expect(delayForLine({start: 10, end: 12, text: 'x'}, 12.34)).toBe(2340);
    expect(delayForLine({start: 10, end: 12, text: 'x'}, 8)).toBe(-2000);
    expect(clampSubtitleDelay(999999)).toBe(120000);
  });

  it('remembers the delay per title and forgets zero', () => {
    writeTitleSubtitleDelay('show:1', 1500);
    writeTitleSubtitleDelay('show:2', -300);
    expect(readTitleSubtitleDelay('show:1')).toBe(1500);
    expect(readTitleSubtitleDelay('show:2')).toBe(-300);
    writeTitleSubtitleDelay('show:1', 0);
    expect(readTitleSubtitleDelay('show:1')).toBe(0);
    expect(readTitleSubtitleDelay(undefined)).toBe(0);
  });

  it('finds speech in levels and bridges short pauses', () => {
    const levels = [...Array(50).fill(-70), ...Array(30).fill(-20), ...Array(10).fill(-70), ...Array(30).fill(-20), ...Array(3).fill(-20), ...Array(50).fill(-70)];
    const speech = speechFromLevels(levels);
    expect(speech[60]).toBe(1);
    // The 100 ms pause between the two words is bridged.
    expect(speech[85]).toBe(1);
    expect(speech[10]).toBe(0);
  });

  it('recovers a known shift between subtitles and speech', () => {
    // Three minutes of audio from 100 s; speech where the lines are, 2.37 s later.
    const shift = 2.37;
    const sliceStart = 100;
    const cues = [];
    for (let t = 95; t < 290; t += 4.3 + ((t * 7) % 3)) cues.push({start: t, end: t + 1.2 + ((t * 13) % 2), text: 'line'});
    const frames = 180 * 100;
    const levels = new Array(frames).fill(-65).map((value, index) => value + ((index * 31) % 7));
    for (const cue of cues) {
      for (let f = Math.round((cue.start + shift - sliceStart) * 100); f < Math.round((cue.end + shift - sliceStart) * 100); f++) {
        if (f >= 0 && f < frames) levels[f] = -18 + ((f * 17) % 5);
      }
    }
    const estimate = estimateSubtitleDelay(speechFromLevels(levels), cues, sliceStart, 30)!;
    expect(Math.abs(estimate.delayMs - 2370)).toBeLessThanOrEqual(20);
    expect(estimate.confidence).toBeGreaterThan(MIN_SYNC_CONFIDENCE);
  });

  it('reports low confidence on noise', () => {
    const cues = [];
    for (let t = 0; t < 180; t += 5) cues.push({start: t, end: t + 2, text: 'x'});
    const levels = new Array(18000).fill(0).map((_v, index) => -60 + ((index * 7919) % 40));
    const estimate = estimateSubtitleDelay(speechFromLevels(levels), cues, 0, 30);
    expect(estimate === undefined || estimate.confidence < 0.2).toBe(true);
  });
});

describe('subtitle tracks', () => {
  const tracks = [
    {index: 0, title: 'English', language: 'en'},
    {index: 1, title: 'Signs', language: 'en'},
    {index: 2, title: 'vega-saved-subtitle:abc', language: 'fr'},
  ];
  const externals = [{uri: 'file:///cache/abc.srt', title: 'vega-saved-subtitle:abc', type: 'application/x-subrip'}];
  it('tells embedded and added tracks apart', () => {
    expect(subtitleRefFor(tracks[0], tracks, externals)).toEqual({kind: 'embedded', key: 'emb:0', ordinal: 0});
    expect(subtitleRefFor(tracks[1], tracks, externals)).toEqual({kind: 'embedded', key: 'emb:1', ordinal: 1});
    expect(subtitleRefFor(tracks[2], tracks, externals)).toMatchObject({kind: 'external', uri: 'file:///cache/abc.srt'});
    expect(subtitleRefFor(undefined, tracks, externals)).toBeUndefined();
  });
});

describe('second subtitle style', () => {
  it('normalizes saved values and sits above two main lines', () => {
    expect(normalizeSecondSubtitleStyle({fontSize: 99, color: 'red', position: 'top'})).toEqual({fontSize: 15, color: '#FFE082', position: 'top'});
    expect(secondLineBottom(16, 10)).toBeGreaterThan(10 + 2 * 16);
  });
});

describe('subtitle translation', () => {
  const libre: TranslationSettings = {service: 'libretranslate', libreUrl: 'https://lt.example.org/', target: ''};
  it('is off until set up, and names the service', () => {
    expect(translationProblem({service: 'off', libreUrl: '', target: ''}, '')).toMatch(/Turn on/);
    expect(translationProblem({service: 'deepl', libreUrl: '', target: ''}, '')).toMatch(/API key/);
    expect(translationProblem({service: 'libretranslate', libreUrl: 'nope', target: ''}, '')).toMatch(/server address/);
    expect(translationProblem(libre, '')).toBeUndefined();
    expect(translationServiceLabel(libre)).toBe('LibreTranslate (lt.example.org)');
    expect(translationServiceLabel({service: 'google', libreUrl: '', target: ''})).toBe('Google Cloud Translation');
  });

  it('builds requests for each service', () => {
    const lt = buildTranslationRequest(libre, 'k', ['a', 'b'], 'de');
    expect(lt.url).toBe('https://lt.example.org/translate');
    expect(JSON.parse(lt.body)).toEqual({q: ['a', 'b'], source: 'auto', target: 'de', format: 'text', api_key: 'k'});
    const free = buildTranslationRequest({service: 'deepl', libreUrl: '', target: ''}, 'abc:fx', ['a'], 'en');
    expect(free.url).toBe('https://api-free.deepl.com/v2/translate');
    expect(free.headers.Authorization).toBe('DeepL-Auth-Key abc:fx');
    expect(JSON.parse(free.body).target_lang).toBe('EN-US');
    expect(buildTranslationRequest({service: 'deepl', libreUrl: '', target: ''}, 'pro', ['a'], 'de').url).toBe('https://api.deepl.com/v2/translate');
    const google = buildTranslationRequest({service: 'google', libreUrl: '', target: ''}, 'g k', ['a'], 'FR');
    expect(google.url).toBe('https://translation.googleapis.com/language/translate/v2?key=g%20k');
    expect(JSON.parse(google.body)).toEqual({q: ['a'], target: 'fr', format: 'text'});
  });

  it('reads answers and refuses ones that do not match', () => {
    expect(parseTranslationResponse('libretranslate', {translatedText: ['x', 'y']}, 2)).toEqual(['x', 'y']);
    expect(parseTranslationResponse('libretranslate', {translatedText: 'x'}, 1)).toEqual(['x']);
    expect(parseTranslationResponse('deepl', {translations: [{text: 'x'}]}, 1)).toEqual(['x']);
    expect(parseTranslationResponse('google', {data: {translations: [{translatedText: 'x\r\ny'}]}}, 1)).toEqual(['x\ny']);
    expect(() => parseTranslationResponse('deepl', {translations: []}, 1)).toThrow();
    expect(() => parseTranslationResponse('libretranslate', {error: 'Invalid API key'}, 1)).toThrow('Invalid API key');
  });

  it('batches by count and size, starting where the viewer is', () => {
    const texts = Array.from({length: 120}, (_v, index) => `line ${index}`);
    expect(translationBatches(texts, 'deepl').map(batch => batch.length)).toEqual([50, 50, 20]);
    expect(translationBatches(['a'.repeat(3000), 'b'.repeat(3000)], 'google').length).toBe(2);
    const cues = texts.map((text, index) => ({start: index * 10, end: index * 10 + 5, text}));
    const ordered = batchOrderFrom(translationBatches(texts, 'deepl'), cues, 700);
    expect(ordered[0][0]).toBe(50);
    expect(ordered[2][0]).toBe(0);
  });

  it('translates in batches, saves progress and reuses it', async () => {
    const cues = Array.from({length: 45}, (_v, index) => ({start: index, end: index + 0.5, text: `hello ${index}`}));
    const calls: string[][] = [];
    const fetchImpl = (async (_url: string, init: {body: string}) => {
      const q = JSON.parse(init.body).q as string[];
      calls.push(q);
      return {ok: true, status: 200, json: async () => ({translatedText: q.map(text => text.replace('hello', 'hallo'))})};
    }) as unknown as typeof fetch;
    const cacheKey = translationCacheKey('title|ext:file', cues, libre, 'de');
    const progress: number[] = [];
    const texts = await translateCues(cues, {settings: libre, key: '', target: 'de', cacheKey, fetchImpl, onProgress: (_t, done) => progress.push(done)});
    expect(calls.map(call => call.length)).toEqual([40, 5]);
    expect(texts[44]).toBe('hallo 44');
    expect(progress[progress.length - 1]).toBe(45);
    expect(readCachedTranslation(cacheKey, 45)?.[0]).toBe('hallo 0');
    calls.length = 0;
    await translateCues(cues, {settings: libre, key: '', target: 'de', cacheKey, fetchImpl});
    expect(calls).toEqual([]);
  });

  it('stops with a clear message when the key is refused', async () => {
    const cues = [{start: 0, end: 1, text: 'a'}];
    const fetchImpl = (async () => ({ok: false, status: 403, json: async () => ({message: 'Forbidden'})})) as unknown as typeof fetch;
    await expect(
      translateCues(cues, {settings: {service: 'deepl', libreUrl: '', target: ''}, key: 'k', target: 'de', cacheKey: 'subtr:t:deepl:de', fetchImpl}),
    ).rejects.toThrow('did not accept the API key');
  });
});
