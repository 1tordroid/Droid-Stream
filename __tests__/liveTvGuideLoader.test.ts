// The guide loader reads a downloaded file in pieces, gunzips it when needed and streams it through the XMLTV parser.
import {gzipSync} from 'zlib';

const files: Record<string, Buffer> = {};
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  stat: jest.fn(async (path: string) => ({size: files[path].length})),
  read: jest.fn(async (path: string, length: number, position: number) => files[path].subarray(position, position + length).toString('base64')),
}));

import {parseGuideFile, programmesFor} from '../src/lib/livetv/guideLoader';
import {normalizeChannelName} from '../src/lib/livetv/xmltv';
import {playbackBody, toLiveChannel} from '../src/lib/livetv/jio/channels';

const programme = (channel: string, hour: number, title: string) =>
  `<programme start="202611${String(7 + Math.floor(hour / 24)).padStart(2, '0')}${String(hour % 24).padStart(2, '0')}0000 +0000" stop="202611${String(7 + Math.floor((hour + 1) / 24)).padStart(2, '0')}${String((hour + 1) % 24).padStart(2, '0')}0000 +0000" channel="${channel}"><title>${title}</title><desc>${'Long text. '.repeat(40)}</desc></programme>\n`;

// Large enough to span several 1 MB reads once unzipped.
const XML =
  '<?xml version="1.0"?><tv><channel id="a"><display-name>Alpha TV</display-name></channel><channel id="b"><display-name>Beta</display-name></channel>\n' +
  Array.from({length: 6000}, (_, i) => programme(i % 2 ? 'a' : 'b', (i >> 1) % 40, `Show ${i} ✓`)).join('') +
  '</tv>';

const options = {from: Date.UTC(2026, 10, 7), to: Date.UTC(2026, 10, 9), ids: new Set(['a']), names: new Set([normalizeChannelName('Beta')])};

it('streams a plain and a gzipped guide to the same result', async () => {
  files['/plain.xml'] = Buffer.from(XML, 'utf8');
  files['/guide.xml.gz'] = gzipSync(XML);
  expect(files['/plain.xml'].length).toBeGreaterThan(2 * 1024 * 1024);
  const plain = await parseGuideFile('/plain.xml', options);
  const zipped = await parseGuideFile('/guide.xml.gz', options);
  expect(zipped).toEqual(plain);
  expect(Object.keys(plain.programmes).sort()).toEqual(['a', 'b']);
  // 40 hours of hourly programmes per channel, duplicates removed.
  expect(plain.programmes.a).toHaveLength(40);
  expect(plain.programmes.a[0].title).toMatch(/^Show \d+ ✓$/);
  expect(plain.programmes.a[0].desc!.length).toBeLessThanOrEqual(240);
  expect(programmesFor(plain, {name: 'Beta HD'}, normalizeChannelName)).toBe(plain.programmes.b);
  expect(programmesFor(plain, {tvgId: 'a', name: 'x'}, normalizeChannelName)).toBe(plain.programmes.a);
  expect(programmesFor(plain, {name: 'Gamma'}, normalizeChannelName)).toBeUndefined();
});

it('builds the JioTV catch-up request the way jiotv_go does', () => {
  const start = Date.UTC(2026, 10, 7, 10, 0, 0);
  const body = playbackBody('143', {start, stop: start + 30 * 60_000, srno: '261107100000'});
  expect(body).toBe('stream_type=Catchup&channel_id=143&programId=261107100000&showtime=000000&srno=261107100000&begin=20261107T100000&end=20261107T103000');
  expect(playbackBody('143', undefined, new Date(start))).toBe('channel_id=143&stream_type=Seek&begin=20261107T100000&srno=20261107');
  expect(toLiveChannel({channel_id: 143, channel_name: 'News', isCatchupAvailable: true})?.attrs).toMatchObject({catchup: 'jio', 'catchup-days': '7'});
  expect(toLiveChannel({channel_id: 144, channel_name: 'Music'})?.attrs.catchup).toBeUndefined();
});
