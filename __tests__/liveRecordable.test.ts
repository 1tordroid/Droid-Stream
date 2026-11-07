import {
  canRecordChannel,
  isDrmOption,
  isDrmProtected,
  manifestUsesDrm,
} from '../src/lib/downloadEngine/recordable';
import {parseM3U} from '../src/lib/livetv/m3u';

describe('DRM licence options in playlists', () => {
  it('finds Kodi and VLC licence options', () => {
    expect(isDrmOption('#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha')).toBe(true);
    expect(isDrmOption('#KODIPROP:inputstream.adaptive.license_key=https://lic.example/wv')).toBe(true);
    expect(isDrmOption('#KODIPROP:inputstream.adaptive.license_type=clearkey')).toBe(true);
    expect(isDrmOption('#EXTVLCOPT:drm=playready')).toBe(true);
    expect(isDrmOption('#KODIPROP:inputstream.adaptive.drm_legacy=org.w3.clearkey|abc:def')).toBe(true);
  });

  it('leaves plain options alone', () => {
    expect(isDrmOption('#KODIPROP:inputstream.adaptive.manifest_type=hls')).toBe(false);
    expect(isDrmOption('#KODIPROP:inputstream=inputstream.adaptive')).toBe(false);
    expect(isDrmOption('#EXTVLCOPT:http-user-agent=Mozilla')).toBe(false);
  });
});

describe('protected manifests', () => {
  it('spots ContentProtection and DRM keys, not AES-128', () => {
    expect(manifestUsesDrm('<MPD><Period><AdaptationSet><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/>')).toBe(true);
    expect(manifestUsesDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k"\n')).toBe(true);
    expect(manifestUsesDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:x"\n')).toBe(true);
    expect(manifestUsesDrm('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k",KEYFORMAT="com.widevine"\n')).toBe(true);
    expect(manifestUsesDrm('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://k"\n')).toBe(true);
    expect(manifestUsesDrm('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\na.ts')).toBe(false);
    expect(manifestUsesDrm('#EXTM3U\n#EXTINF:6,\na.ts')).toBe(false);
  });
});

describe('which channels show Record', () => {
  const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="free",Free HLS',
    'https://cdn.example.com/free/index.m3u8',
    '#EXTINF:-1 tvg-id="wv",Widevine channel',
    '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
    '#KODIPROP:inputstream.adaptive.license_key=https://lic.example/wv',
    'https://cdn.example.com/wv/index.m3u8',
    '#EXTINF:-1 tvg-id="ck" drm-license-key="abc:def",ClearKey channel',
    'https://cdn.example.com/ck/index.m3u8',
    '#EXTINF:-1 tvg-id="dash",DASH channel',
    'https://cdn.example.com/dash/live.mpd',
  ].join('\n');

  it('records plain HLS, not DRM, licence or DASH channels', () => {
    const channels = parseM3U(playlist).channels;
    const byName = Object.fromEntries(channels.map(channel => [channel.name, channel]));
    expect(byName['Widevine channel'].drm).toBe(true);
    expect(canRecordChannel(byName['Free HLS'])).toBe(true);
    expect(canRecordChannel(byName['Widevine channel'])).toBe(false);
    expect(canRecordChannel(byName['ClearKey channel'])).toBe(false);
    expect(canRecordChannel(byName['DASH channel'])).toBe(false);
  });

  it('a KODIPROP line only marks its own channel', () => {
    const channels = parseM3U(playlist).channels;
    expect(channels.filter(channel => channel.drm).map(channel => channel.name)).toEqual(['Widevine channel']);
  });

  it('hides Record for JioTV channels found to use DRM, and for addresses it cannot record', () => {
    const jio = {url: 'jiotv:154'};
    expect(canRecordChannel(jio)).toBe(true);
    expect(canRecordChannel(jio, new Set(['jiotv:154']))).toBe(false);
    expect(isDrmProtected(jio, new Set(['jiotv:154']))).toBe(true);
    expect(canRecordChannel({url: 'rtmp://example/live'})).toBe(false);
  });
});
