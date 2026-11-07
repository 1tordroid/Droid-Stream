import {
  DashDrmError,
  DashLiveError,
  dashAudioChoices,
  dashVideoChoices,
  estimateDashBytes,
  expandTemplate,
  parseIsoDuration,
  parseMpd,
  parseXml,
  selectDash,
} from '../src/lib/downloadEngine/mpd';

const BASE = 'https://cdn.example.com/movie/manifest.mpd';

describe('MPD XML reader', () => {
  it('reads nested elements, attributes, entities, comments and self-closing tags', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><MPD a="1&amp;2"><Period><BaseURL> x/ </BaseURL><S t="0" d=\'5\'/></Period></MPD>');
    const mpd = doc.children[0];
    expect(mpd.name).toBe('MPD');
    expect(mpd.attrs.a).toBe('1&2');
    expect(mpd.children[0].children[0].text.trim()).toBe('x/');
    expect(mpd.children[0].children[1].attrs).toEqual({t: '0', d: '5'});
  });

  it('drops namespace prefixes', () => {
    const doc = parseXml('<mpd:MPD xmlns:mpd="urn:x"><mpd:Period cenc:x="y"/></mpd:MPD>');
    expect(doc.children[0].name).toBe('MPD');
    expect(doc.children[0].children[0].name).toBe('Period');
    expect(doc.children[0].children[0].attrs.x).toBe('y');
  });
});

describe('durations and templates', () => {
  it('reads ISO 8601 durations', () => {
    expect(parseIsoDuration('PT1H2M3.5S')).toBe(3723.5);
    expect(parseIsoDuration('PT634.566S')).toBeCloseTo(634.566);
    expect(parseIsoDuration('P1DT1S')).toBe(86401);
    expect(parseIsoDuration('nonsense')).toBe(0);
  });

  it('fills $Number$, $Time$, $RepresentationID$, $Bandwidth$, widths and $$', () => {
    expect(expandTemplate('$RepresentationID$/seg-$Number%05d$.m4s', {RepresentationID: 'v1', Number: 7})).toBe('v1/seg-00007.m4s');
    expect(expandTemplate('t$Time$-$Bandwidth$$$.mp4', {Time: 90000, Bandwidth: 128000})).toBe('t90000-128000$.mp4');
    expect(expandTemplate('$Number%03x$', {Number: 255})).toBe('0ff');
  });
});

const templateNumberMpd = `<?xml version="1.0"?>
<MPD type="static" mediaPresentationDuration="PT20S" xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <SegmentTemplate media="$RepresentationID$/$Number$.m4s" initialization="$RepresentationID$/init.mp4" startNumber="1" timescale="1000" duration="6000"/>
      <Representation id="720" bandwidth="2000000" width="1280" height="720" codecs="avc1.64001f"/>
      <Representation id="1080" bandwidth="5000000" width="1920" height="1080" codecs="avc1.640028"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="en">
      <SegmentTemplate media="audio/$Number$.m4s" initialization="audio/init.mp4" timescale="1000" duration="6000"/>
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('SegmentTemplate with $Number$', () => {
  it('makes one segment per duration step, rounding the last up', () => {
    const manifest = parseMpd(templateNumberMpd, BASE);
    expect(manifest.duration).toBe(20);
    const video = manifest.representations.find(item => item.id === '1080')!;
    expect(video.kind).toBe('video');
    expect(video.init?.url).toBe('https://cdn.example.com/movie/1080/init.mp4');
    expect(video.segments.map(item => item.url)).toEqual([
      'https://cdn.example.com/movie/1080/1.m4s',
      'https://cdn.example.com/movie/1080/2.m4s',
      'https://cdn.example.com/movie/1080/3.m4s',
      'https://cdn.example.com/movie/1080/4.m4s',
    ]);
    expect(video.singleFile).toBe(false);
  });

  it('lists qualities best first and picks the best by default', () => {
    const manifest = parseMpd(templateNumberMpd, BASE);
    expect(dashVideoChoices(manifest).map(item => item.id)).toEqual(['1080', '720']);
    expect(dashAudioChoices(manifest).map(item => item.label)).toEqual(['en · MP4A · 128 kbps']);
    const selection = selectDash(manifest);
    expect(selection.video?.id).toBe('1080');
    expect(selection.audio?.id).toBe('a1');
    expect(selectDash(manifest, {video: '720'}).video?.id).toBe('720');
    expect(selectDash(manifest, {audio: 'none'}).audio).toBeUndefined();
    expect(estimateDashBytes(manifest, selection)).toBe(Math.round(((5_000_000 + 128_000) * 20) / 8));
  });
});

describe('SegmentTemplate with SegmentTimeline and $Time$', () => {
  it('expands repeats, explicit start times and r=-1 up to the period end', () => {
    const mpd = `<MPD mediaPresentationDuration="PT10S"><BaseURL>https://media.example.org/v/</BaseURL><Period>
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <Representation id="v" bandwidth="1000" height="480">
          <SegmentTemplate media="chunk-$Time$.m4s" initialization="init-$RepresentationID$.mp4" timescale="10" startNumber="5">
            <SegmentTimeline>
              <S t="100" d="20" r="1"/>
              <S d="30"/>
              <S t="200" d="10" r="-1"/>
            </SegmentTimeline>
          </SegmentTemplate>
        </Representation>
      </AdaptationSet></Period></MPD>`;
    const manifest = parseMpd(mpd, BASE);
    const video = manifest.representations[0];
    expect(video.init?.url).toBe('https://media.example.org/v/init-v.mp4');
    // The period ends at 10 s * 10 = 100 units, before t=200, so r=-1 keeps one entry.
    expect(video.segments.map(item => item.url.split('/').pop())).toEqual([
      'chunk-100.m4s', 'chunk-120.m4s', 'chunk-140.m4s', 'chunk-200.m4s',
    ]);
  });

  it('fills r=-1 up to the next entry start', () => {
    const mpd = `<MPD mediaPresentationDuration="PT60S"><Period>
      <AdaptationSet contentType="audio" mimeType="audio/mp4">
        <SegmentTemplate media="a/$Number$-$Time$.m4s" timescale="1" startNumber="0">
          <SegmentTimeline><S t="0" d="4" r="-1"/><S t="12" d="6"/></SegmentTimeline>
        </SegmentTemplate>
        <Representation id="a" bandwidth="64000"/>
      </AdaptationSet></Period></MPD>`;
    const audio = parseMpd(mpd, BASE).representations[0];
    expect(audio.kind).toBe('audio');
    expect(audio.init).toBeUndefined();
    expect(audio.segments.map(item => item.url.split('/').pop())).toEqual(['0-0.m4s', '1-4.m4s', '2-8.m4s', '3-12.m4s']);
  });
});

describe('SegmentList, SegmentBase and BaseURL', () => {
  it('reads SegmentList with init and byte ranges', () => {
    const mpd = `<MPD mediaPresentationDuration="PT8S"><Period><AdaptationSet mimeType="video/mp4">
      <Representation id="v" bandwidth="800000" height="360"><BaseURL>video.mp4</BaseURL>
        <SegmentList duration="4"><Initialization range="0-799"/>
          <SegmentURL mediaRange="800-1999"/><SegmentURL mediaRange="2000-2999"/>
        </SegmentList></Representation></AdaptationSet></Period></MPD>`;
    const video = parseMpd(mpd, BASE).representations[0];
    expect(video.init).toEqual({url: 'https://cdn.example.com/movie/video.mp4', range: '0-799'});
    expect(video.segments).toEqual([
      {url: 'https://cdn.example.com/movie/video.mp4', range: '800-1999'},
      {url: 'https://cdn.example.com/movie/video.mp4', range: '2000-2999'},
    ]);
  });

  it('reads SegmentList with separate files', () => {
    const mpd = `<MPD mediaPresentationDuration="PT8S"><Period><AdaptationSet mimeType="audio/mp4">
      <Representation id="a" bandwidth="96000"><SegmentList><Initialization sourceURL="a/init.mp4"/>
      <SegmentURL media="a/1.m4s"/><SegmentURL media="a/2.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>`;
    const audio = parseMpd(mpd, BASE).representations[0];
    expect(audio.init?.url).toBe('https://cdn.example.com/movie/a/init.mp4');
    expect(audio.segments.map(item => item.url)).toEqual(['https://cdn.example.com/movie/a/1.m4s', 'https://cdn.example.com/movie/a/2.m4s']);
  });

  it('treats SegmentBase and a bare BaseURL as one file, resolving nested BaseURLs', () => {
    const mpd = `<MPD mediaPresentationDuration="PT1M"><BaseURL>https://files.example.net/root/</BaseURL><Period><BaseURL>p1/</BaseURL>
      <AdaptationSet mimeType="video/webm"><Representation id="v" bandwidth="3000000" height="1080" codecs="vp9">
        <BaseURL>v.webm</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet>
      <AdaptationSet mimeType="audio/webm"><Representation id="a" bandwidth="160000" codecs="opus"><BaseURL>https://other.example.net/a.webm</BaseURL></Representation></AdaptationSet>
      </Period></MPD>`;
    const manifest = parseMpd(mpd, BASE);
    expect(manifest.representations.map(item => [item.id, item.singleFile, item.segments[0].url])).toEqual([
      ['v', true, 'https://files.example.net/root/p1/v.webm'],
      ['a', true, 'https://other.example.net/a.webm'],
    ]);
  });

  it('skips subtitle tracks and marks video that carries audio', () => {
    const mpd = `<MPD mediaPresentationDuration="PT1M"><Period>
      <AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="1" codecs="avc1.4d401e,mp4a.40.2"><BaseURL>v.mp4</BaseURL></Representation></AdaptationSet>
      <AdaptationSet mimeType="application/ttml+xml"><Representation id="t" bandwidth="1"><BaseURL>t.xml</BaseURL></Representation></AdaptationSet>
      </Period></MPD>`;
    const manifest = parseMpd(mpd, BASE);
    expect(manifest.representations.find(item => item.id === 't')?.kind).toBe('text');
    expect(manifest.representations.find(item => item.id === 'v')?.hasAudio).toBe(true);
    expect(selectDash(manifest).audio).toBeUndefined();
  });
});

describe('multiple periods', () => {
  it('joins periods that share representation ids', () => {
    const period = (start: string, first: number) => `<Period start="${start}" duration="PT4S"><AdaptationSet mimeType="video/mp4">
      <SegmentTemplate media="$RepresentationID$-$Number$.m4s" startNumber="${first}" duration="2" timescale="1"/>
      <Representation id="v" bandwidth="1"/></AdaptationSet></Period>`;
    const manifest = parseMpd(`<MPD mediaPresentationDuration="PT8S">${period('PT0S', 1)}${period('PT4S', 3)}</MPD>`, BASE);
    expect(manifest.duration).toBe(8);
    expect(manifest.representations[0].segments.map(item => item.url.split('/').pop())).toEqual(['v-1.m4s', 'v-2.m4s', 'v-3.m4s', 'v-4.m4s']);
  });
});

describe('refusals', () => {
  it('refuses any ContentProtection', () => {
    const mpd = `<MPD><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation id="v" bandwidth="1"><BaseURL>v.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    expect(() => parseMpd(mpd, BASE)).toThrow(DashDrmError);
  });

  it('refuses live (dynamic) manifests', () => {
    expect(() => parseMpd('<MPD type="dynamic"><Period/></MPD>', BASE)).toThrow(DashLiveError);
  });

  it('refuses text that is not an MPD', () => {
    expect(() => parseMpd('<html></html>', BASE)).toThrow('not a DASH manifest');
  });
});
