import {channelGroups, filterChannels, parseAttributes, parseM3U} from '../src/lib/livetv/m3u';
import {parseNowNext, parseXmltvTime, canLoadEpg} from '../src/lib/livetv/epg';

// Shape of the iptv-org country playlists.
const IPTV_ORG = `#EXTM3U
#EXTINF:-1 tvg-id="DDNational.in@SD" tvg-logo="https://i.imgur.com/dd.png" group-title="General",DD National (576p)
https://example.org/dd/index.m3u8
#EXTINF:-1 tvg-id="AajTak.in@SD" tvg-logo="https://i.imgur.com/aaj.png" group-title="News",Aaj Tak (720p) [Geo-blocked]
#EXTVLCOPT:http-referrer=https://www.aajtak.in/
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)
https://example.org/aajtak/master.m3u8
#EXTINF:-1 tvg-id="" group-title="Kids;Animation",Toon Channel
https://example.org/toon.m3u8
`;

// Shape of a jiotv_go playlist.
const JIOTV = `#EXTM3U x-tvg-url="http://192.168.1.5:5001/epg.xml.gz"
#EXTINF:-1 tvg-id="143" tvg-name="Colors HD" tvc-guide-stationid="" tvg-language="Hindi" tvg-type="Entertainment" group-title="Entertainment" tvg-logo="http://192.168.1.5:5001/jtvimage/Colors_HD.png", Colors HD
http://192.168.1.5:5001/live/143.m3u8
`;

describe('parseM3U', () => {
  it('reads iptv-org entries with attributes, groups and VLC headers', () => {
    const {channels, epgUrl} = parseM3U(IPTV_ORG);
    expect(epgUrl).toBeUndefined();
    expect(channels).toHaveLength(3);
    expect(channels[0]).toMatchObject({
      name: 'DD National (576p)',
      url: 'https://example.org/dd/index.m3u8',
      logo: 'https://i.imgur.com/dd.png',
      group: 'General',
      tvgId: 'DDNational.in@SD',
    });
    expect(channels[0].headers).toBeUndefined();
    expect(channels[1].headers).toEqual({
      Referer: 'https://www.aajtak.in/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    expect(channels[2].tvgId).toBeUndefined();
    expect(channelGroups(channels)).toEqual(['General', 'News', 'Kids', 'Animation']);
  });

  it('reads the jiotv_go header guide and channel', () => {
    const {channels, epgUrl} = parseM3U(JIOTV);
    expect(epgUrl).toBe('http://192.168.1.5:5001/epg.xml.gz');
    expect(channels[0]).toMatchObject({name: 'Colors HD', tvgId: '143', tvgName: 'Colors HD', group: 'Entertainment'});
    expect(channels[0].attrs['tvg-language']).toBe('Hindi');
  });

  it('handles BOM, CRLF and blank lines', () => {
    const text = '﻿#EXTM3U url-tvg="https://g.example/guide.xml"\r\n\r\n#EXTINF:-1 tvg-name="One",One\r\nhttp://a.example/1.m3u8\r\n\r\n';
    const {channels, epgUrl} = parseM3U(text);
    expect(epgUrl).toBe('https://g.example/guide.xml');
    expect(channels).toEqual([expect.objectContaining({name: 'One', url: 'http://a.example/1.m3u8'})]);
  });

  it('handles CR-only line endings', () => {
    expect(parseM3U('#EXTM3U\r#EXTINF:-1,A\rhttp://x/a\r').channels[0].name).toBe('A');
  });

  it('falls back when attributes or titles are missing', () => {
    const {channels} = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Named",\nhttp://x/1\n#EXTINF:0\nhttp://x/2\nhttp://x/3\n');
    expect(channels.map(c => c.name)).toEqual(['Named', 'http://x/2', 'http://x/3']);
    expect(channels[1].logo).toBeUndefined();
    expect(channels[1].group).toBeUndefined();
  });

  it('keeps commas inside quoted attributes out of the title', () => {
    const {channels} = parseM3U("#EXTINF:-1 tvg-name=\"News, Live\" group-title='A, B',Real Title\nhttp://x/1");
    expect(channels[0]).toMatchObject({name: 'Real Title', tvgName: 'News, Live', group: 'A, B'});
  });

  it('ignores KODIPROP and other unknown lines safely', () => {
    const text = `#EXTM3U
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://lic.example/key
#EXTINF:-1 tvg-id="x",Protected
#EXT-X-SOMETHING
# just a comment
https://x.example/p.mpd`;
    const {channels} = parseM3U(text);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({name: 'Protected', url: 'https://x.example/p.mpd'});
  });

  it('reads #EXTGRP and Kodi pipe headers, skips non-URL lines', () => {
    const text = '#EXTM3U\n#EXTINF:-1,Pipe\n#EXTGRP:Sports\nhttp://x/s.m3u8|User-Agent=Foo%20Bar&Referer=http://r/\n#EXTINF:-1,Bad\nnot a url\n';
    const {channels} = parseM3U(text);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({url: 'http://x/s.m3u8', group: 'Sports', headers: {'User-Agent': 'Foo Bar', Referer: 'http://r/'}});
  });

  it('gives duplicate entries unique ids', () => {
    const {channels} = parseM3U('#EXTINF:-1 tvg-id="a",A\nhttp://x/1\n#EXTINF:-1 tvg-id="a",A\nhttp://x/1\n');
    expect(new Set(channels.map(c => c.id)).size).toBe(2);
  });

  it('returns nothing for empty or non-playlist text', () => {
    expect(parseM3U('').channels).toEqual([]);
    expect(parseM3U('<html>404</html>').channels).toEqual([]);
  });

  it('parses bare and single-quoted attributes', () => {
    expect(parseAttributes(" tvg-id=abc TVG-LOGO='l.png' group-title=\"G\"")).toEqual({'tvg-id': 'abc', 'tvg-logo': 'l.png', 'group-title': 'G'});
  });

  it('filters by search and group', () => {
    const {channels} = parseM3U(IPTV_ORG);
    expect(filterChannels(channels, 'aaj').map(c => c.name)).toEqual(['Aaj Tak (720p) [Geo-blocked]']);
    expect(filterChannels(channels, '', 'Animation').map(c => c.name)).toEqual(['Toon Channel']);
    expect(filterChannels(channels, 'news', 'General')).toEqual([]);
  });
});

describe('epg', () => {
  it('reads XMLTV times with offsets', () => {
    expect(parseXmltvTime('20261107183000 +0530')).toBe(Date.UTC(2026, 10, 7, 13, 0, 0));
    expect(parseXmltvTime('20261107183000')).toBe(Date.UTC(2026, 10, 7, 18, 30, 0));
    expect(parseXmltvTime('bad')).toBeNaN();
  });

  it('keeps now and next per wanted channel', () => {
    const xml = `<tv>
<programme start="20261107100000 +0000" stop="20261107110000 +0000" channel="a"><title>Old</title></programme>
<programme start="20261107110000 +0000" stop="20261107120000 +0000" channel="a"><title lang="en">News &amp; Views</title></programme>
<programme start="20261107130000 +0000" stop="20261107140000 +0000" channel="a"><title>Later</title></programme>
<programme start="20261107120000 +0000" stop="20261107130000 +0000" channel="a"><title>Next</title></programme>
<programme start="20261107110000 +0000" stop="20261107120000 +0000" channel="b"><title>Other</title></programme>
</tv>`;
    const guide = parseNowNext(xml, Date.UTC(2026, 10, 7, 11, 30), new Set(['a']));
    expect(guide.get('a')?.now?.title).toBe('News & Views');
    expect(guide.get('a')?.next?.title).toBe('Next');
    expect(guide.has('b')).toBe(false);
  });

  it('skips gzipped guides', () => {
    expect(canLoadEpg('http://h:5001/epg.xml.gz')).toBe(false);
    expect(canLoadEpg('https://g.example/guide.xml')).toBe(true);
    expect(canLoadEpg(undefined)).toBe(false);
  });
});
