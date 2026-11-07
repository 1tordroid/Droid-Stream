import {gzipSync, deflateRawSync, deflateSync} from 'zlib';
import {buildCatchupUrl, canReplay, catchupInfo, fillCatchupTemplate} from '../src/lib/livetv/catchup';
import {
  HOUR,
  MINUTE,
  SLOT_MS,
  cleanProgrammes,
  dayLabel,
  floorSlot,
  guideWindow,
  layoutRow,
  programmeAt,
  programmeState,
  timeSlots,
  type GuideProgramme,
} from '../src/lib/livetv/guide';
import {InflateError, Inflater, inflateAll} from '../src/lib/livetv/inflate';
import {parseJioEpg} from '../src/lib/livetv/jio/epg';
import {Utf8Stream, decodeUtf8} from '../src/lib/livetv/utf8';
import {XmltvParser, normalizeChannelName, parseXmltv} from '../src/lib/livetv/xmltv';

const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
const text = (data: Uint8Array) => Buffer.from(data).toString('utf8');

describe('inflate', () => {
  const sample = Array.from({length: 4000}, (_, i) => `<programme n="${i}">Show ${i % 37} – ünïcødé ${'x'.repeat(i % 50)}</programme>\n`).join('');

  it('decodes gzip, zlib and raw deflate the same as zlib does', () => {
    expect(text(inflateAll(new Uint8Array(gzipSync(sample))))).toBe(sample);
    expect(text(inflateAll(new Uint8Array(deflateSync(sample))))).toBe(sample);
    expect(text(inflateAll(new Uint8Array(deflateRawSync(sample))))).toBe(sample);
  });

  it('decodes stored and fixed blocks', () => {
    expect(text(inflateAll(new Uint8Array(gzipSync(sample, {level: 0}))))).toBe(sample);
    expect(text(inflateAll(new Uint8Array(gzipSync('abcabcabcabc', {level: 1}))))).toBe('abcabcabcabc');
  });

  it('gives output in chunks and handles back references across them', () => {
    const big = sample.repeat(6);
    const inflater = new Inflater(new Uint8Array(gzipSync(big)), 16 * 1024);
    const parts: Buffer[] = [];
    for (let chunk = inflater.read(); chunk; chunk = inflater.read()) parts.push(Buffer.from(chunk));
    expect(parts.length).toBeGreaterThan(5);
    expect(Buffer.concat(parts).toString('utf8')).toBe(big);
  });

  it('reads several gzip members', () => {
    const data = Buffer.concat([gzipSync('first '), gzipSync('second')]);
    expect(text(inflateAll(new Uint8Array(data)))).toBe('first second');
  });

  it('fails on a cut-off file', () => {
    const data = new Uint8Array(gzipSync(sample)).slice(0, 200);
    expect(() => inflateAll(data)).toThrow(InflateError);
  });
});

describe('utf8 stream', () => {
  it('joins characters split across chunks', () => {
    const data = bytes('a€b😀c');
    for (const useNative of [false, true]) {
      const stream = new Utf8Stream(useNative);
      let out = '';
      for (let i = 0; i < data.length; i++) out += stream.decode(data.subarray(i, i + 1));
      out += stream.decode(new Uint8Array(0), true);
      expect(out).toBe('a€b😀c');
    }
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b');
  });
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="dd.in"><display-name lang="en">DD National</display-name><icon src="x"/></channel>
  <channel id="star1.in"><display-name>Star Sports 1 HD</display-name></channel>
  <channel id="other"><display-name>Other</display-name></channel>
  <programme start="20261107180000 +0530" stop="20261107183000 +0530" channel="dd.in">
    <title lang="en">Evening News &amp; Views</title>
    <desc>Headlines &#8211; today</desc>
  </programme>
  <programme start="20261107183000 +0530" stop="20261107193000 +0530" channel="dd.in" catchup-id="abc 1">
    <title><![CDATA[Film <Night>]]></title>
  </programme>
  <programme start="20261101000000 +0000" stop="20261101010000 +0000" channel="dd.in"><title>Too old</title></programme>
  <programme start="20261107120000 +0000" stop="20261107130000 +0000" channel="star1.in"><title>Cricket</title></programme>
  <programme start="20261107120000 +0000" stop="20261107130000 +0000" channel="other"><title>Skipped</title></programme>
</tv>`;

describe('XMLTV', () => {
  const from = Date.UTC(2026, 10, 6);
  const to = Date.UTC(2026, 10, 9);

  it('keeps wanted channels inside the time range, matching by id and by name', () => {
    const result = parseXmltv(XML, {from, to, ids: new Set(['dd.in']), names: new Set([normalizeChannelName('Star Sports 1')])});
    expect(Object.keys(result.programmes).sort()).toEqual(['dd.in', 'star1.in']);
    expect(result.names).toEqual({starsports1: 'star1.in'});
    const dd = result.programmes['dd.in'];
    expect(dd.map(p => p.title)).toEqual(['Evening News & Views', 'Film <Night>']);
    expect(dd[0].start).toBe(Date.UTC(2026, 10, 7, 12, 30));
    expect(dd[0].stop).toBe(Date.UTC(2026, 10, 7, 13, 0));
    expect(dd[0].desc).toBe('Headlines – today');
    expect(dd[1].catchupId).toBe('abc 1');
  });

  it('gives the same result when fed in small pieces', () => {
    const whole = parseXmltv(XML, {from, to});
    const parser = new XmltvParser({from, to});
    for (let i = 0; i < XML.length; i += 7) parser.push(XML.slice(i, i + 7));
    const streamed = parser.finish();
    expect(streamed).toEqual(whole);
    expect(Object.keys(streamed.programmes).sort()).toEqual(['dd.in', 'other', 'star1.in']);
  });

  it('normalises channel names', () => {
    expect(normalizeChannelName('Star Sports 1 HD')).toBe('starsports1');
    expect(normalizeChannelName('Zee  TV')).toBe('zeetv');
    expect(normalizeChannelName('HD')).toBe('hd');
    expect(normalizeChannelName('Tom & Jerry')).toBe('tomandjerry');
  });
});

describe('guide time slots', () => {
  const now = Date.UTC(2026, 10, 7, 12, 40);
  const p = (h: number, m: number, minutes: number, title = `${h}:${m}`): GuideProgramme => {
    const start = Date.UTC(2026, 10, 7, h, m);
    return {start, stop: start + minutes * MINUTE, title};
  };

  it('builds a window of whole half-hour slots', () => {
    expect(floorSlot(now)).toBe(Date.UTC(2026, 10, 7, 12, 30));
    const window = guideWindow(now, HOUR, 2 * HOUR);
    expect(window.start).toBe(Date.UTC(2026, 10, 7, 11, 30));
    expect(window.end).toBe(Date.UTC(2026, 10, 7, 15, 0));
    expect(timeSlots(window)).toHaveLength(7);
    expect(timeSlots(window)[1] - timeSlots(window)[0]).toBe(SLOT_MS);
  });

  it('lays out programmes and fills gaps with one empty cell per slot', () => {
    const window = guideWindow(now, HOUR, 2 * HOUR); // 11:30 - 15:00
    const pxPerMs = 4 / MINUTE;
    const cells = layoutRow([p(11, 0, 45), p(12, 30, 30), p(13, 0, 15)], window, pxPerMs, now);
    expect(cells.map(c => [c.left, c.width, c.programme?.title ?? '-'])).toEqual([
      [0, 60, '11:0'], // clipped to 11:30
      [60, 60, '-'], // 11:45 - 12:00
      [120, 120, '-'], // 12:00 - 12:30
      [240, 120, '12:30'],
      [360, 60, '13:0'],
      [420, 60, '-'], // 13:15 - 13:30
      [480, 120, '-'],
      [600, 120, '-'],
      [720, 120, '-'],
    ]);
    expect(cells.map(c => c.state).slice(2, 5)).toEqual(['past', 'now', 'future']);
  });

  it('only returns cells in the visible range', () => {
    const window = guideWindow(now, HOUR, 2 * HOUR);
    const visible = {start: Date.UTC(2026, 10, 7, 12, 50), end: Date.UTC(2026, 10, 7, 13, 20)};
    const cells = layoutRow([p(11, 0, 45), p(12, 30, 30), p(13, 0, 15)], window, 4 / MINUTE, now, visible);
    expect(cells.map(c => c.programme?.title ?? '-')).toEqual(['12:30', '13:0', '-']);
    expect(layoutRow([], window, 1, now, visible).map(c => c.start)).toEqual([Date.UTC(2026, 10, 7, 12, 30), Date.UTC(2026, 10, 7, 13, 0)]);
  });

  it('finds the programme on air and sorts out overlaps', () => {
    const list = cleanProgrammes([p(13, 0, 60, 'b'), p(12, 0, 90, 'a'), p(13, 0, 30, 'dup'), p(14, 0, 0, 'empty')]);
    expect(list.map(x => [x.title, (x.stop - x.start) / MINUTE])).toEqual([['a', 60], ['b', 60]]);
    expect(programmeAt(list, now)?.title).toBe('a');
    expect(programmeAt(list, Date.UTC(2026, 10, 7, 13, 59))?.title).toBe('b');
    expect(programmeAt(list, Date.UTC(2026, 10, 7, 15))).toBeUndefined();
    expect(programmeState(list[0], now)).toBe('now');
    expect(programmeState(list[1], now)).toBe('future');
  });

  it('labels days', () => {
    const base = new Date(2026, 10, 7, 12).getTime();
    expect(dayLabel(base, base)).toBe('Today');
    expect(dayLabel(base - 24 * HOUR, base)).toBe('Yesterday');
    expect(dayLabel(base + 24 * HOUR, base)).toBe('Tomorrow');
    expect(dayLabel(base + 48 * HOUR, base)).toBe('Mon 9 Nov');
  });
});

describe('catch-up', () => {
  const start = Date.UTC(2026, 10, 7, 10, 0); // 1794045600
  const stop = start + 90 * MINUTE;
  const now = Date.UTC(2026, 10, 7, 12, 0);
  const programme = {start, stop, title: 'Show'};
  const S = start / 1000;
  const E = stop / 1000;
  const N = now / 1000;

  it('fills placeholders', () => {
    const times = {start, stop, now, catchupId: 'id/1'};
    expect(fillCatchupTemplate('{utc}|{start}|${start}|{utcend}|{end}|${end}', times)).toBe(`${S}|${S}|${S}|${E}|${E}|${E}`);
    expect(fillCatchupTemplate('{lutc}|{now}|${now}|${timestamp}|{timestamp}', times)).toBe(Array(5).fill(N).join('|'));
    expect(fillCatchupTemplate('{duration}|${duration}|{duration:60}|{offset}|{offset:60}', times)).toBe(`5400|5400|90|7200|120`);
    expect(fillCatchupTemplate('{Y}-{m}-{d}T{H}:{M}:{S}', times)).toBe('2026-11-07T10:00:00');
    expect(fillCatchupTemplate('{utc:YmdHMS}/{utcend:Y-m-d H:M}', times)).toBe('20261107100000/2026-11-07 11:30');
    expect(fillCatchupTemplate('x={catchup-id}', times)).toBe('x=id%2F1');
  });

  it('reads the attributes', () => {
    expect(catchupInfo({url: 'http://a/b', attrs: {catchup: 'default', 'catchup-source': 'http://a/{utc}', 'catchup-days': '3'}})).toEqual({mode: 'default', source: 'http://a/{utc}', days: 3});
    expect(catchupInfo({url: 'http://a/b', attrs: {'catchup-type': 'append', 'catchup-source': '?s={utc}'}})).toEqual({mode: 'append', source: '?s={utc}', days: 1});
    expect(catchupInfo({url: 'http://a/b', attrs: {'tvg-rec': '2'}})).toEqual({mode: 'shift', days: 2});
    expect(catchupInfo({url: 'http://a/b', attrs: {catchup: 'shift', 'catchup-days': '0'}})).toBeUndefined();
    expect(catchupInfo({url: 'http://a/b', attrs: {catchup: 'default'}})).toBeUndefined();
    expect(catchupInfo({url: 'http://a/b', attrs: {catchup: 'append'}})).toBeUndefined();
    expect(catchupInfo({url: 'http://a/b', attrs: {catchup: 'vod'}})).toBeUndefined();
    expect(catchupInfo({url: 'http://a/b', attrs: {}})).toBeUndefined();
    expect(catchupInfo({url: 'http://a/b.m3u8', attrs: {catchup: 'xc'}})).toBeUndefined();
    expect(catchupInfo({url: 'jiotv:143', attrs: {catchup: 'jio', 'catchup-days': '7'}})).toEqual({mode: 'jio', days: 7});
  });

  it('replays only ended programmes inside the catch-up days', () => {
    const info = {mode: 'shift' as const, days: 1};
    expect(canReplay(info, programme, now)).toBe(true);
    expect(canReplay(info, {start: now - HOUR, stop: now + HOUR}, now)).toBe(false);
    expect(canReplay(info, {start: now - 25 * HOUR, stop: now - 24 * HOUR}, now)).toBe(false);
    expect(canReplay(undefined, programme, now)).toBe(false);
  });

  it('builds default, append and shift addresses', () => {
    expect(buildCatchupUrl({url: 'http://a/live.m3u8', attrs: {catchup: 'default', 'catchup-source': 'http://a/arc.m3u8?b={utc}&e={utcend}'}}, programme, now)).toBe(
      `http://a/arc.m3u8?b=${S}&e=${E}`,
    );
    expect(buildCatchupUrl({url: 'http://a/live.m3u8?t=1', attrs: {catchup: 'append', 'catchup-source': '?utc={utc}&lutc={lutc}'}}, programme, now)).toBe(
      `http://a/live.m3u8?t=1&utc=${S}&lutc=${N}`,
    );
    expect(buildCatchupUrl({url: 'http://a/live.m3u8', attrs: {catchup: 'append', 'catchup-source': '&from=${start}'}}, programme, now)).toBe(
      `http://a/live.m3u8?from=${S}`,
    );
    expect(buildCatchupUrl({url: 'http://a/live.m3u8', attrs: {catchup: 'shift'}}, programme, now)).toBe(`http://a/live.m3u8?utc=${S}&lutc=${N}`);
    expect(buildCatchupUrl({url: 'http://a/live/{utc}.m3u8', attrs: {catchup: 'default'}}, programme, now)).toBe(`http://a/live/${S}.m3u8`);
  });

  it('builds flussonic addresses', () => {
    expect(buildCatchupUrl({url: 'http://f.tv:8080/ch1/index.m3u8?token=x', attrs: {catchup: 'flussonic'}}, programme, now)).toBe(
      `http://f.tv:8080/ch1/index-${S}-5400.m3u8?token=x`,
    );
    expect(buildCatchupUrl({url: 'http://f.tv/ch1/video.m3u8', attrs: {catchup: 'fs'}}, programme, now)).toBe(`http://f.tv/ch1/video-${S}-5400.m3u8`);
    expect(buildCatchupUrl({url: 'http://f.tv/ch1/mpegts?token=x', attrs: {catchup: 'flussonic-ts'}}, programme, now)).toBe(
      `http://f.tv/ch1/timeshift_abs-${S}.ts?token=x`,
    );
  });

  it('builds Xtream Codes addresses', () => {
    expect(buildCatchupUrl({url: 'http://xc.tv:80/live/user/pass/1234.m3u8', attrs: {catchup: 'xc', 'catchup-days': '5'}}, programme, now)).toBe(
      'http://xc.tv:80/timeshift/user/pass/90/2026-11-07:10-00/1234.m3u8',
    );
    expect(buildCatchupUrl({url: 'http://xc.tv/user/pass/1234', attrs: {catchup: 'xc'}}, programme, now)).toBe(
      'http://xc.tv/timeshift/user/pass/90/2026-11-07:10-00/1234.ts',
    );
  });

  it('gives nothing for live or too old programmes', () => {
    const channel = {url: 'http://a/live.m3u8', attrs: {catchup: 'shift'}};
    expect(buildCatchupUrl(channel, {start: now - HOUR, stop: now + HOUR}, now)).toBeUndefined();
    expect(buildCatchupUrl(channel, {start: now - 3 * 24 * HOUR, stop: now - 3 * 24 * HOUR + HOUR}, now)).toBeUndefined();
    expect(buildCatchupUrl({url: 'jiotv:1', attrs: {catchup: 'jio'}}, programme, now)).toBeUndefined();
  });
});

describe('JioTV guide', () => {
  it('reads getepg answers with seconds or ms epochs', () => {
    const list = parseJioEpg({
      epg: [
        {showname: 'News', startEpoch: 1794045600000, endEpoch: 1794047400000, srno: 2611071000, description: 'Top stories'},
        {showname: 'Old style', startEpoch: 1794047400, endEpoch: 1794049200, srno: '99'},
        {showname: '', startEpoch: 1, endEpoch: 2},
        {showname: 'Broken', startEpoch: 5, endEpoch: 1},
      ],
    });
    expect(list).toEqual([
      {title: 'News', start: 1794045600000, stop: 1794047400000, srno: '2611071000', desc: 'Top stories'},
      {title: 'Old style', start: 1794047400000, stop: 1794049200000, srno: '99'},
    ]);
    expect(parseJioEpg({})).toEqual([]);
  });
});
