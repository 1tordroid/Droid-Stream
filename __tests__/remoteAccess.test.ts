import {ariaNgUrl, rpcAddress, urlSafeBase64} from '../src/lib/remoteAccess/ariaNg';
import {
  createAria2Rpc,
  parseAddOptions,
  parseAria2Speed,
  safeOutName,
  type Aria2Backend,
} from '../src/lib/remoteAccess/aria2Rpc';
import {aria2StatusOf, gidFor, pickKeys, sliceLikeAria2, toAria2Status} from '../src/lib/remoteAccess/aria2Status';
import {
  addSite,
  browserLikeYtdlArgs,
  cleanSites,
  CHROME_USER_AGENT,
  normalizeSite,
  usesBrowserLike,
} from '../src/lib/remoteAccess/browserLike';
import {commandExamples, commandTargets, formatCommandList, parseCommand} from '../src/lib/remoteAccess/commands';
import {isPrivateLanAddress} from '../src/lib/remoteAccess/lan';
import {FailedAttemptLimiter, isUsableToken, newToken, safeEqual, tokenFromBytes} from '../src/lib/remoteAccess/secret';
import {torrentNameFromBase64} from '../src/lib/remoteAccess/torrentName';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

const item = (overrides: Partial<DownloadItem>): DownloadItem => ({
  schemaVersion: 1,
  id: 'a',
  title: 'Movie',
  type: 'movie',
  url: 'https://example.com/movie.mp4',
  sourceType: 'http',
  isTorrent: false,
  filePath: '',
  totalBytes: 1000,
  downloadedBytes: 250,
  speed: 50,
  status: 'downloading',
  canPause: true,
  canResume: false,
  createdAt: 1,
  updatedAt: 1,
  displayFileName: 'movie.mp4',
  ...overrides,
});

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const LAN = '192.168.1.20';

const setup = (items: DownloadItem[] = []) => {
  const list = [...items];
  const backend: jest.Mocked<Aria2Backend> = {
    list: jest.fn(() => list),
    addUri: jest.fn(async () => 'new-id'),
    addTorrent: jest.fn(async () => 'torrent-id'),
    pause: jest.fn(async () => undefined),
    unpause: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    speedLimit: jest.fn(() => 0),
    setSpeedLimit: jest.fn(),
    maxConcurrentDownloads: jest.fn(() => 3),
  };
  let time = 1_000_000;
  const rpc = createAria2Rpc({backend, token: () => TOKEN, now: () => time, sessionId: 's1'});
  const call = async (method: string, params: unknown[] = [], client = LAN, withToken = true) => {
    const reply = await rpc.handle(
      JSON.stringify({jsonrpc: '2.0', id: 'q', method, params: withToken ? [`token:${TOKEN}`, ...params] : params}),
      client,
    );
    return JSON.parse(reply || 'null');
  };
  return {backend, rpc, call, list, advance: (ms: number) => (time += ms)};
};

describe('LAN address filter', () => {
  it.each(['192.168.0.5', '10.1.2.3', '172.16.0.1', '172.31.255.255', '127.0.0.1', '169.254.1.1', '::1', 'fe80::1%wlan0', 'fd12:3456::1', '::ffff:192.168.1.4', '[fd00::2]'])(
    'allows %s',
    address => expect(isPrivateLanAddress(address)).toBe(true),
  );
  it.each(['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8', '', 'example.com', '192.168.1', '300.1.1.1'])(
    'refuses %s',
    address => expect(isPrivateLanAddress(address)).toBe(false),
  );
});

describe('tokens', () => {
  it('compares tokens fully', () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true);
    expect(safeEqual(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(safeEqual(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(TOKEN.replace('a', 'b'), TOKEN)).toBe(false);
  });

  it('makes 32-character URL-safe tokens from 24 random bytes', () => {
    const token = newToken(size => Uint8Array.from({length: size}, (_, index) => (index * 37) % 256));
    expect(token).toHaveLength(32);
    expect(isUsableToken(token)).toBe(true);
    expect(tokenFromBytes(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
    expect(() => newToken(() => new Uint8Array(3))).toThrow('No secure random source');
  });

  it('locks out a client after five wrong tokens and doubles the lock', () => {
    const limiter = new FailedAttemptLimiter();
    for (let index = 0; index < 4; index += 1) limiter.recordFailure('x', 1000);
    expect(limiter.isLocked('x', 1000)).toBe(false);
    limiter.recordFailure('x', 1000);
    expect(limiter.isLocked('x', 1000)).toBe(true);
    expect(limiter.isLocked('y', 1000)).toBe(false);
    expect(limiter.isLocked('x', 61_001)).toBe(false);
    for (let index = 0; index < 5; index += 1) limiter.recordFailure('x', 70_000);
    expect(limiter.isLocked('x', 70_000 + 119_000)).toBe(true);
    expect(limiter.isLocked('x', 70_000 + 121_000)).toBe(false);
  });
});

describe('aria2 status mapping', () => {
  it('maps app statuses to aria2 statuses', () => {
    expect(aria2StatusOf('downloading')).toBe('active');
    expect(aria2StatusOf('queued')).toBe('waiting');
    expect(aria2StatusOf('paused')).toBe('paused');
    expect(aria2StatusOf('interrupted')).toBe('paused');
    expect(aria2StatusOf('error')).toBe('error');
    expect(aria2StatusOf('completed')).toBe('complete');
    expect(aria2StatusOf('canceling')).toBe('removed');
  });

  it('gives each download a stable 16-digit GID', () => {
    expect(gidFor('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(gidFor('a')).toBe(gidFor('a'));
    expect(gidFor('a')).not.toBe(gidFor('b'));
  });

  it('describes a download with aria2 fields as strings', () => {
    const status = toAria2Status(item({}));
    expect(status).toMatchObject({
      gid: gidFor('a'),
      status: 'active',
      totalLength: '1000',
      completedLength: '250',
      downloadSpeed: '50',
      dir: '/Droid Stream',
    });
    expect(status.files).toEqual([
      expect.objectContaining({path: '/Droid Stream/movie.mp4', length: '1000', uris: [{uri: 'https://example.com/movie.mp4', status: 'used'}]}),
    ]);
    const failed = toAria2Status(item({status: 'error', errorMessage: 'HTTP 404'}));
    expect(failed).toMatchObject({status: 'error', errorCode: '1', errorMessage: 'HTTP 404', downloadSpeed: '0'});
    const torrent = toAria2Status(item({sourceType: 'torrent', url: 'magnet:?xt=urn:btih:abc', torrentInfoHash: 'abc', displayFileName: 'Show'}));
    expect(torrent).toMatchObject({infoHash: 'abc', bittorrent: {info: {name: 'Show'}}});
    expect((torrent.files as {uris: unknown[]}[])[0].uris).toEqual([]);
  });

  it('picks keys and slices lists the aria2 way', () => {
    expect(pickKeys({gid: '1', status: 'active', dir: '/'}, ['gid', 'status', 'nope'])).toEqual({gid: '1', status: 'active'});
    expect(pickKeys({gid: '1'}, undefined)).toEqual({gid: '1'});
    expect(sliceLikeAria2([1, 2, 3, 4], 1, 2)).toEqual([2, 3]);
    expect(sliceLikeAria2([1, 2, 3, 4], -1, 2)).toEqual([4, 3]);
    expect(sliceLikeAria2([1, 2, 3, 4], 0, 0)).toEqual([]);
  });
});

describe('aria2 JSON-RPC', () => {
  it('refuses calls without the right token and locks out guessers', async () => {
    const {call, backend} = setup([item({})]);
    expect((await call('aria2.tellActive', [], LAN, false)).error).toEqual({code: 1, message: 'Unauthorized'});
    expect((await call('aria2.tellActive', ['token:wrong'], LAN, false)).error.message).toBe('Unauthorized');
    for (let index = 0; index < 3; index += 1) await call('aria2.tellActive', ['token:wrong'], LAN, false);
    // Locked now: even the right token is refused for this client.
    expect((await call('aria2.tellActive')).error.message).toBe('Unauthorized');
    expect((await call('aria2.tellActive', [], '192.168.1.21')).result).toHaveLength(1);
    expect(backend.list).toHaveBeenCalled();
  });

  it('refuses clients outside the home network', async () => {
    const {call} = setup();
    expect((await call('aria2.getVersion', [], '8.8.8.8')).error.message).toBe('Unauthorized');
  });

  it('answers getVersion, listMethods without a token, and parse errors', async () => {
    const {call, rpc} = setup();
    expect((await call('aria2.getVersion')).result.version).toBe('1.37.0');
    const methods = (await call('system.listMethods', [], LAN, false)).result;
    expect(methods).toEqual(expect.arrayContaining(['aria2.addUri', 'aria2.tellStatus', 'system.multicall']));
    expect(JSON.parse((await rpc.handle('{nope', LAN)) || '').error.code).toBe(-32700);
    expect((await call('aria2.shutdown')).error.code).toBe(-32601);
  });

  it('adds links with safe options only', async () => {
    const {call, backend} = setup();
    const reply = await call('aria2.addUri', [
      ['https://example.com/a.mkv'],
      {dir: '/sdcard/Evil', out: '../../etc/a.mkv', header: ['Cookie: c=1', 'Host: evil', 'Referer: https://example.com/'], 'max-download-limit': '1K'},
    ]);
    expect(reply.result).toBe(gidFor('new-id'));
    expect(backend.addUri).toHaveBeenCalledWith('https://example.com/a.mkv', {
      out: 'a.mkv',
      headers: {Cookie: 'c=1', Referer: 'https://example.com/'},
    });
    expect((await call('aria2.addUri', [['file:///sdcard/secret']])).error.message).toMatch(/Only http/);
    expect((await call('aria2.addUri', [[]])).error.message).toBe('No URI to download');
  });

  it('adds base64 torrents within the size limit', async () => {
    const {call, backend} = setup();
    expect((await call('aria2.addTorrent', ['ZDQ6aW5mb2Vl', [], {out: 'x'}])).result).toBe(gidFor('torrent-id'));
    expect(backend.addTorrent).toHaveBeenCalledWith('ZDQ6aW5mb2Vl', {out: 'x', headers: {}});
    expect((await call('aria2.addTorrent', ['not base64!'])).error.message).toBe('The torrent is not base64');
  });

  it('lists active, waiting and stopped downloads', async () => {
    const {call} = setup([
      item({id: 'run', createdAt: 2}),
      item({id: 'wait', status: 'queued', createdAt: 3}),
      item({id: 'held', status: 'paused', createdAt: 1}),
      item({id: 'done', status: 'completed', completedAt: 5}),
      item({id: 'bad', status: 'error', updatedAt: 4}),
    ]);
    expect((await call('aria2.tellActive', [['gid']])).result).toEqual([{gid: gidFor('run')}]);
    expect((await call('aria2.tellWaiting', [0, 10, ['gid', 'status']])).result).toEqual([
      {gid: gidFor('held'), status: 'paused'},
      {gid: gidFor('wait'), status: 'waiting'},
    ]);
    expect((await call('aria2.tellStopped', [0, 10, ['gid']])).result).toEqual([{gid: gidFor('bad')}, {gid: gidFor('done')}]);
    expect((await call('aria2.tellStatus', [gidFor('done'), ['status', 'completedLength']])).result).toEqual({status: 'complete', completedLength: '1000'});
    expect((await call('aria2.tellStatus', ['0000000000000000'])).error.message).toMatch(/not found/);
    expect((await call('aria2.getGlobalStat')).result).toEqual({
      downloadSpeed: '50',
      uploadSpeed: '0',
      numActive: '1',
      numWaiting: '2',
      numStopped: '2',
      numStoppedTotal: '2',
    });
  });

  it('pauses, unpauses and removes, never finished files', async () => {
    const {call, backend} = setup([item({id: 'run'}), item({id: 'held', status: 'paused'}), item({id: 'done', status: 'completed'}), item({id: 'bad', status: 'error'})]);
    expect((await call('aria2.pause', [gidFor('run')])).result).toBe(gidFor('run'));
    expect(backend.pause).toHaveBeenCalledWith('run');
    expect((await call('aria2.unpause', [gidFor('held')])).result).toBe(gidFor('held'));
    expect(backend.unpause).toHaveBeenCalledWith('held');
    expect((await call('aria2.forceRemove', [gidFor('run')])).result).toBe(gidFor('run'));
    expect(backend.remove).toHaveBeenCalledWith('run');
    expect((await call('aria2.remove', [gidFor('done')])).error).toBeDefined();
    expect((await call('aria2.removeDownloadResult', [gidFor('done')])).result).toBe('OK');
    expect(backend.remove).not.toHaveBeenCalledWith('done');
    expect((await call('aria2.removeDownloadResult', [gidFor('bad')])).result).toBe('OK');
    expect(backend.remove).toHaveBeenCalledWith('bad');
  });

  it('changes only the overall download limit', async () => {
    const {call, backend} = setup();
    expect((await call('aria2.changeGlobalOption', [{'max-overall-download-limit': '2M'}])).result).toBe('OK');
    expect(backend.setSpeedLimit).toHaveBeenCalledWith(2 * 1024 * 1024);
    expect((await call('aria2.changeGlobalOption', [{dir: '/sdcard'}])).error.message).toMatch(/Only max-overall-download-limit/);
    expect((await call('aria2.getGlobalOption')).result['max-concurrent-downloads']).toBe('3');
  });

  it('runs multicall with a token in each call and batches', async () => {
    const {rpc} = setup([item({})]);
    const reply = JSON.parse(
      (await rpc.handle(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'system.multicall',
          params: [[
            {methodName: 'aria2.getVersion', params: [`token:${TOKEN}`]},
            {methodName: 'aria2.tellActive', params: ['token:bad']},
            {methodName: 'system.multicall', params: []},
          ]],
        }),
        LAN,
      )) || '',
    );
    expect(reply.result[0][0].version).toBe('1.37.0');
    expect(reply.result[1]).toEqual({code: 1, message: 'Unauthorized'});
    expect(reply.result[2].code).toBe(1);
    const batch = JSON.parse(
      (await rpc.handle(
        JSON.stringify([
          {jsonrpc: '2.0', id: 1, method: 'aria2.getVersion', params: [`token:${TOKEN}`]},
          {jsonrpc: '2.0', method: 'aria2.getVersion', params: [`token:${TOKEN}`]},
        ]),
        LAN,
      )) || '',
    );
    expect(batch).toHaveLength(1);
    expect(batch[0].id).toBe(1);
  });

  it('reads speeds and option values', () => {
    expect(parseAria2Speed('0')).toBe(0);
    expect(parseAria2Speed('500K')).toBe(512000);
    expect(parseAria2Speed('1.5M')).toBe(1572864);
    expect(parseAria2Speed('fast')).toBeUndefined();
    expect(safeOutName('..')).toBeUndefined();
    expect(safeOutName('C:\\x\\a?.mp4')).toBe('a.mp4');
    expect(parseAddOptions({'user-agent': 'UA', referer: '*', header: 'Range: bytes=0-'})).toEqual({headers: {'User-Agent': 'UA'}});
  });
});

describe('command access', () => {
  it('parses broadcasts', () => {
    expect(parseCommand('com.tordroid.droidstream.ADD_DOWNLOAD', {url: ' https://x.example/a.mp4 ', name: 'a/b.mp4'})).toEqual({
      kind: 'add',
      url: 'https://x.example/a.mp4',
      name: 'a_b.mp4',
    });
    expect(parseCommand('com.tordroid.droidstream.ADD_DOWNLOAD', {})).toHaveProperty('error');
    expect(parseCommand('com.tordroid.droidstream.ADD_DOWNLOAD', {url: 'file:///sdcard/a'})).toHaveProperty('error');
    expect(parseCommand('com.tordroid.droidstream.ADD_DOWNLOAD', {url: 'magnet:?xt=urn:btih:abc'})).toEqual({kind: 'add', url: 'magnet:?xt=urn:btih:abc'});
    expect(parseCommand('com.tordroid.droidstream.PAUSE', {})).toEqual({kind: 'pause', target: 'all'});
    expect(parseCommand('com.tordroid.droidstream.RESUME', {id: 'abc'})).toEqual({kind: 'resume', target: 'abc'});
    expect(parseCommand('com.tordroid.droidstream.RESUME', {id: 'a b'})).toHaveProperty('error');
    expect(parseCommand('com.tordroid.droidstream.LIST', {})).toEqual({kind: 'list'});
    expect(parseCommand('com.tordroid.droidstream.DELETE', {})).toHaveProperty('error');
  });

  it('targets downloads by id or GID and lists them', () => {
    const download = item({id: 'xyz'});
    expect(commandTargets('all', download)).toBe(true);
    expect(commandTargets('xyz', download)).toBe(true);
    expect(commandTargets(gidFor('xyz').toUpperCase(), download)).toBe(true);
    expect(commandTargets('other', download)).toBe(false);
    expect(formatCommandList([download])).toBe(`${gidFor('xyz')} active 25% movie.mp4`);
    expect(formatCommandList([])).toBe('No downloads.');
  });

  it('shows commands with the edition package and quoted values', () => {
    const examples = commandExamples('com.tordroid.droidstream.preview', 'tok_en', "https://x.example/a?b=1&c='2'");
    expect(examples.add).toBe(
      "am broadcast -a com.tordroid.droidstream.ADD_DOWNLOAD -p com.tordroid.droidstream.preview --es token 'tok_en' --es url 'https://x.example/a?b=1&c='\\''2'\\'''",
    );
    expect(examples.list).toBe("am broadcast -a com.tordroid.droidstream.LIST -p com.tordroid.droidstream.preview --es token 'tok_en'");
    expect(examples.adb.startsWith('adb shell "am broadcast')).toBe(true);
  });
});

describe('browser-like connection rules', () => {
  it('reads sites and refuses debrid and local hosts', () => {
    expect(normalizeSite('https://www.Example.com/path?q=1')).toEqual({host: 'example.com'});
    expect(normalizeSite('*.cdn.example.org')).toEqual({host: 'cdn.example.org'});
    expect(normalizeSite('real-debrid.com')).toHaveProperty('error');
    expect(normalizeSite('download.real-debrid.com')).toHaveProperty('error');
    expect(normalizeSite('192.168.1.2')).toHaveProperty('error');
    expect(normalizeSite('localhost')).toHaveProperty('error');
    expect(normalizeSite('com')).toHaveProperty('error');
    expect(addSite(['b.com'], 'a.com')).toEqual({sites: ['a.com', 'b.com']});
    expect(addSite(['a.com'], 'A.com')).toEqual({sites: ['a.com']});
    expect(cleanSites(['x.com', 'torbox.app', 5, 'x.com'])).toEqual(['x.com']);
  });

  it('applies to listed sites and their subdomains only', () => {
    expect(usesBrowserLike('video.example.com', ['example.com'])).toBe(true);
    expect(usesBrowserLike('badexample.com', ['example.com'])).toBe(false);
    expect(usesBrowserLike('example.com', [])).toBe(false);
    expect(usesBrowserLike('real-debrid.com', ['real-debrid.com'])).toBe(false);
  });

  it("adds Chrome's headers to yt-dlp for listed sites", () => {
    const args = browserLikeYtdlArgs('https://www.example.com/watch?v=1', ['example.com']);
    expect(args.slice(0, 2)).toEqual(['--add-headers', `User-Agent:${CHROME_USER_AGENT}`]);
    expect(args).toContain('Sec-CH-UA-Mobile:?1');
    expect(browserLikeYtdlArgs('https://other.com/x', ['example.com'])).toEqual([]);
  });
});

describe('AriaNg link and torrent names', () => {
  it('builds the address and the AriaNg command URL', () => {
    expect(rpcAddress('192.168.1.5', 6800)).toBe('http://192.168.1.5:6800/jsonrpc');
    expect(urlSafeBase64('ab?')).toBe('YWI_');
    expect(urlSafeBase64('a')).toBe('YQ==');
    expect(ariaNgUrl('192.168.1.5', 6800, 'a')).toBe('http://ariang.mayswind.net/latest/#!/settings/rpc/set/http/192.168.1.5/6800/jsonrpc/YQ==');
  });

  it('reads the name from a torrent', () => {
    const torrent = 'd8:announce3:url4:infod6:lengthi5e4:name9:Film.2024e12:piece lengthi1ee';
    const base64 = Buffer.from(torrent, 'latin1').toString('base64');
    expect(torrentNameFromBase64(base64)).toBe('Film.2024');
    expect(torrentNameFromBase64(Buffer.from('d4:infod6:lengthi1eee').toString('base64'))).toBeUndefined();
  });
});
