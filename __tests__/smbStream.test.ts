// SMB playback: a loopback address per opened file, a stable smb:// link for
// progress, the previous stream closed, and browse-only while the gate is off.
import {NativeModules} from 'react-native';

const TOKEN = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('SMB streams', () => {
  let native: {list: jest.Mock; openStream: jest.Mock; closeStream: jest.Mock};

  beforeEach(() => {
    jest.resetModules();
    native = {
      list: jest.fn(async () => [{name: 'Movie (2020).mkv', directory: false, size: 4e9}, {name: 'Shows', directory: true, size: 0}]),
      openStream: jest.fn(async () => `http://127.0.0.1:41234/${TOKEN}/Movie%20(2020).mkv`),
      closeStream: jest.fn(async () => null),
    };
    (NativeModules as any).SmbModule = native;
  });

  const load = (enabled: boolean) => {
    const smb = require('../src/lib/sources/smb');
    smb.SMB_STREAMING.enabled = enabled;
    return {smb, accounts: require('../src/lib/sources/accounts')};
  };

  const source = {id: 's1', kind: 'smb', name: 'NAS', server: '192.168.1.5', username: 'me', secret: 'pw', share: 'Media'};

  it('reads only loopback stream addresses with a 128-bit token', () => {
    const {smb} = load(true);
    expect(smb.smbStreamToken(`http://127.0.0.1:5000/${TOKEN}/a.mkv`)).toBe(TOKEN);
    expect(smb.smbStreamToken(`http://192.168.1.2:5000/${TOKEN}/a.mkv`)).toBeUndefined();
    expect(smb.smbStreamToken('http://127.0.0.1:5000/short/a.mkv')).toBeUndefined();
    expect(smb.smbFileLink('nas', 'Media', 'Movies\\A.mkv')).toBe('smb://nas/Media/Movies/A.mkv');
  });

  it('keeps SMB browse-only while streaming is off', async () => {
    const {smb, accounts} = load(false);
    const rows = await accounts.listSourceRows(source);
    expect(rows.find((row: any) => !row.directory).playUrl).toBeUndefined();
    await expect(smb.openSmbStream('h', 's', '/a.mkv', 'u', 'p')).rejects.toThrow(/browse/);
    expect(native.openStream).not.toHaveBeenCalled();
  });

  it('opens a stream on play and passes the smb:// link for progress', async () => {
    const {accounts} = load(true);
    const rows = await accounts.listSourceRows(source, '/Movies');
    const file = rows.find((row: any) => !row.directory);
    expect(file.playUrl).toBe('smb-path:/Movies/Movie (2020).mkv');
    const navigate = jest.fn();
    await accounts.playSource({navigate}, source, file.title, file.playUrl);
    expect(native.openStream).toHaveBeenCalledWith('192.168.1.5', 'Media', '/Movies/Movie (2020).mkv', 'me', 'pw', '');
    const params = navigate.mock.calls[0][1];
    expect(params.episodeList[0].link).toBe('smb://192.168.1.5/Media/Movies/Movie (2020).mkv');
    expect(params.initialStream.link).toBe(`http://127.0.0.1:41234/${TOKEN}/Movie%20(2020).mkv`);
    expect(params.initialStream.headers).toBeUndefined();
  });

  it('closes the previous stream when another file opens', async () => {
    const {smb} = load(true);
    await smb.openSmbStream('h', 's', '/a.mkv', 'u', 'p');
    native.openStream.mockResolvedValueOnce(`http://127.0.0.1:41234/${OTHER}/b.mkv`);
    await smb.openSmbStream('h', 's', '/b.mkv', 'u', 'p');
    expect(native.closeStream).toHaveBeenCalledWith(`http://127.0.0.1:41234/${TOKEN}/Movie%20(2020).mkv`);
    smb.closeSmbStream('http://example.com/x');
    expect(native.closeStream).toHaveBeenCalledTimes(1);
  });
});
