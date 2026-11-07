// JioTV channel list (merged, cached) and stream requests: HLS with the
// headers the JioTV app sends, and Widevine channels through the standard
// drm source with the licence headers JioTV expects.
const res = (status: number, body?: unknown, setCookie: string | null = null) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name: string) => (name.toLowerCase() === 'set-cookie' ? setCookie : null)},
    json: async () => body,
    text: async () => JSON.stringify(body ?? ''),
  });

const future = Math.floor(Date.now() / 1000) + 7200;
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (tag: string) => `${b64url({alg: 'x'})}.${b64url({exp: future, tag})}.s`;
const ACCESS = token('access');
const SSO = token('sso');

describe('JioTV channels', () => {
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockImplementationOnce(() =>
      res(200, {authToken: ACCESS, refreshToken: 'r1', ssoToken: SSO, sessionAttributes: {user: {subscriberId: 'crm-1', unique: 'uniq-1'}}}),
    );
    await require('../src/lib/livetv/jio/session').verifyOtp('9876543210', '123456');
    fetchMock.mockReset();
  });

  const load = () => require('../src/lib/livetv/jio/channels') as typeof import('../src/lib/livetv/jio/channels');

  it('merges the account and public lists, maps categories and logos, and caches them', async () => {
    const channels = load();
    fetchMock.mockImplementation((url: string) =>
      url.includes('jiotv.data.cdn')
        ? res(200, {result: [{channel_id: 143, channel_name: 'Sports HD', logoUrl: 'Sports_HD.png', channelCategoryId: 8, channelLanguageId: 6, isHD: true, business_type: 'premium'}]})
        : res(200, {result: [{channel_id: 143, channel_name: 'Sports HD dup'}, {channel_id: '154', channel_name: 'Comedy', channelCategoryId: 5, channelLanguageId: 1}]}),
    );
    const list = await channels.loadJioChannels();
    expect(list.map(c => c.name)).toEqual(['Sports HD', 'Comedy']);
    expect(list[0]).toMatchObject({
      id: '143',
      url: 'jiotv:143',
      group: 'Sports',
      tvgName: 'English',
      logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Sports_HD.png',
      attrs: {premium: 'true', hd: 'true', language: 'English'},
    });
    const accountCall = fetchMock.mock.calls.find(([url]) => url.includes('jiotv.data.cdn'));
    expect(accountCall[1].headers).toMatchObject({accessToken: ACCESS, ssotoken: SSO, crmid: 'crm-1', uniqueId: 'uniq-1'});
    const publicCall = fetchMock.mock.calls.find(([url]) => url.includes('jiotvapi.cdn'));
    expect(publicCall[1].headers.accessToken).toBeUndefined();
    fetchMock.mockClear();
    await channels.loadJioChannels();
    expect(fetchMock).not.toHaveBeenCalled();
    // Offline: the cached list still shows.
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await channels.loadJioChannels({force: true})).length).toBe(2);
    expect(channels.jioChannelId('jiotv:154')).toBe('154');
  });

  it('plays a plain channel as HLS with the JioTV headers and hdnea cookie', async () => {
    const channels = load();
    fetchMock.mockImplementationOnce(() =>
      res(200, {code: 200, bitrates: {auto: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Comedy/index.m3u8?hdnea=st=1~exp=9~hmac=abc'}}),
    );
    const stream = await channels.getJioStream('154');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://jiotvapi.media.jio.com/playback/apis/v1.1/geturl?langId=6');
    expect(init.method).toBe('POST');
    expect(init.body).toMatch(/^channel_id=154&stream_type=Seek&begin=\d{8}T\d{6}&srno=\d{8}$/);
    expect(init.headers).toMatchObject({accessToken: ACCESS, channel_id: '154', appkey: 'NzNiMDhlYzQyNjJm', crmid: 'crm-1', versionCode: '422'});
    expect(stream).toMatchObject({
      type: 'm3u8',
      url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Comedy/index.m3u8?hdnea=st=1~exp=9~hmac=abc',
      headers: {Cookie: '__hdnea__=st=1~exp=9~hmac=abc', ssotoken: SSO, channelId: '154', 'User-Agent': expect.stringMatching(/^plaYtv/)},
    });
    expect(stream.drm).toBeUndefined();
  });

  it('plays a Widevine channel as DASH with the licence server and headers JioTV issues', async () => {
    const channels = load();
    fetchMock
      .mockImplementationOnce(() =>
        res(200, {
          isDRM: true,
          bitrates: {auto: 'https://x.jio.com/hls/index.m3u8?hdnea=tok1'},
          mpd: {result: 'https://jiotvmpd.cdn.jio.com/bpk-tv/S/manifest.mpd?hdnea=tok1', key: 'https://tv.media.jio.com/wv/license', bitrates: {auto: 'https://jiotvmpd.cdn.jio.com/bpk-tv/S/index.mpd'}},
        }),
      )
      .mockImplementationOnce(() => res(200, undefined, '__hdnea__=tok2; path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, other=1; path=/'));
    const stream = await channels.getJioStream('143');
    expect(fetchMock.mock.calls[1][1].method).toBe('HEAD');
    expect(stream.type).toBe('mpd');
    expect(stream.url).toBe('https://jiotvmpd.cdn.jio.com/bpk-tv/S/index.mpd');
    expect(stream.drm).toMatchObject({
      type: 'widevine',
      licenseServer: 'https://tv.media.jio.com/wv/license?hdnea=tok1',
      headers: expect.objectContaining({
        accesstoken: ACCESS,
        ssotoken: SSO,
        channelid: '143',
        crmid: 'crm-1',
        appName: 'RJIL_JioTV',
        'Content-Type': 'application/octet-stream',
        Cookie: '__hdnea__=tok2; other=1',
      }),
    });
  });

  it('renews and retries once when the playback request is refused, and explains a subscription channel', async () => {
    const channels = load();
    fetchMock
      .mockImplementationOnce(() => res(401, {message: 'token expired'}))
      .mockImplementationOnce(() => res(200, {authToken: 'a2'}))
      .mockImplementationOnce(() => res(200, {ssoToken: 's2'}))
      .mockImplementationOnce(() => res(200, {bitrates: {auto: 'https://h.jio.com/a.m3u8'}}));
    const stream = await channels.getJioStream('154');
    expect(fetchMock.mock.calls[3][1].headers.accessToken).toBe('a2');
    expect(stream.headers.ssotoken).toBe('s2');
    fetchMock.mockImplementationOnce(() => res(400, {message: 'No eligible plans found'}));
    await expect(channels.getJioStream('999')).rejects.toThrow(/separate JioTV subscription/);
  });

  it('reads cookie pairs from a joined Set-Cookie header', () => {
    expect(load().cookiePairs('a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, b=2')).toEqual(['a=1', 'b=2']);
    expect(load().cookiePairs(null)).toEqual([]);
  });
});
