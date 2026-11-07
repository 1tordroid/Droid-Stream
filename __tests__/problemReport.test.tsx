// "Send a problem report": a prefilled GitHub issue, logs only when ticked, scrubbed and trimmed.
import React from 'react';
import renderer, {act} from 'react-test-renderer';

jest.mock('expo-application', () => ({nativeApplicationVersion: '5.6.1', nativeBuildVersion: '230'}));
jest.mock('expo-constants', () => ({__esModule: true, default: {expoConfig: {extra: {appEdition: 'ext'}}}}));
jest.mock('../src/lib/tv/constants', () => ({isTV: false}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: NativeText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: NativeText, RawText: NativeText, RawTextInput: Input};
});
jest.mock('react-native-reanimated', () => require('../__mocks__/reanimatedStub'));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import {Linking, Platform, ToastAndroid} from 'react-native';
import ProblemReportSheet from '../src/components/ProblemReportSheet';
import {
  buildProblemReport,
  deviceInfo,
  ISSUE_URL,
  MAX_ISSUE_URL_LENGTH,
  readRecentLogs,
  scrubLog,
} from '../src/lib/problemReport';

const device = {android: 'Android 15 (SDK 35)', device: 'OnePlus CPH2581'};
const app = {name: 'Droid Stream (with extension support)', edition: 'ext', version: '5.6.1 (230)'};
const bodyOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('body') || '');
const titleOf = (url: string) => new URL(url).searchParams.get('title') || '';

describe('scrubLog', () => {
  it('removes tokens, cookies and sign-in headers', () => {
    expect(scrubLog('{"token":"abc123","name":"x"}')).toBe('{"token":"<hidden>","name":"x"}');
    expect(scrubLog('refresh_token=zzz&x=1 api_key: K-123')).toBe('refresh_token=<hidden>&x=1 api_key: <hidden>');
    expect(scrubLog('Authorization: Bearer eyJhbGciOi.abcdefghij.klmnop')).toBe('Authorization: <hidden>');
    expect(scrubLog('sent Bearer abc.def-ghi')).toBe('sent Bearer <hidden>');
    expect(scrubLog('Cookie: sid=1; auth=2')).toBe('Cookie: <hidden>');
    expect(scrubLog('set-cookie: a=b; Path=/')).toBe('set-cookie: <hidden>');
    expect(scrubLog('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')).toBe('jwt <token>');
    expect(scrubLog('key 0123456789abcdef0123456789abcdef!')).toBe('key <id>!');
    expect(scrubLog('otp: 123456, pin=9999')).toBe('otp: <hidden>, pin=<hidden>');
  });

  it('removes emails, IP addresses and phone numbers', () => {
    expect(scrubLog('signed in as me.name+tag@mail.example.com')).toBe('signed in as <email>');
    expect(scrubLog('server 192.168.1.5:5001 up')).toBe('server <ip>:5001 up');
    expect(scrubLog('peer 2001:db8::1 and fe80::a1b2:c3d4%wlan0')).toBe('peer <ip> and <ip>%wlan0');
    expect(scrubLog('Jio number 9876543210 or +91 98765 43210')).toBe('Jio number <number> or <number>');
  });

  it('keeps link addresses but drops their query, and removes file paths', () => {
    expect(scrubLog('GET https://api.example.com/v1/search?q=secret&key=1#frag done')).toBe('GET https://api.example.com/v1/search?… done');
    expect(scrubLog('magnet:?xt=urn:btih:abc&dn=Name')).toBe('magnet:?…');
    expect(scrubLog('saved /storage/emulated/0/Download/Movie.mkv')).toBe('saved <path>');
    expect(scrubLog('db at /data/user/0/com.tordroid.droidstream/files/x.db, ok')).toBe('db at <path>, ok');
    expect(scrubLog('open file:///data/x.mp4 and content://media/external/video/1')).toBe('open <path> and <path>');
    expect(scrubLog('copied C:\\Users\\Me\\video.mp4')).toBe('copied <path>');
  });

  it('leaves ordinary log lines readable', () => {
    const line = '11-07 12:34:56.789 W/VegaJS: Player buffering for 2.5 s at 1080p (v5.6.1)';
    expect(scrubLog(line)).toBe(line);
    expect(scrubLog('https://github.com/1tordroid/Droid-Stream/releases/download/v5.6.1/app.apk')).toBe(
      'https://github.com/1tordroid/Droid-Stream/releases/download/v5.6.1/app.apk',
    );
  });
});

describe('buildProblemReport', () => {
  it('fills in the app, version, Android version and device, and no logs unless asked', () => {
    const report = buildProblemReport({device, app});
    expect(report.url.startsWith(`${ISSUE_URL}?title=`)).toBe(true);
    expect(ISSUE_URL).toBe('https://github.com/1tordroid/Droid-Stream/issues/new');
    expect(titleOf(report.url)).toBe('Problem in Droid Stream (with extension support) 5.6.1 (230)');
    const body = bodyOf(report.url);
    expect(body).toContain('- Droid Stream (with extension support) (ext)');
    expect(body).toContain('- Version 5.6.1 (230)');
    expect(body).toContain('- Android 15 (SDK 35)');
    expect(body).toContain('- Device: OnePlus CPH2581');
    expect(body).not.toContain('Recent logs');
    expect(report.trimmed).toBe(false);
  });

  it('uses the defaults from the app and the phone', () => {
    const constants = jest.spyOn(Platform, 'constants', 'get').mockReturnValue({Release: '15', Manufacturer: 'OnePlus', Model: 'CPH2581'} as any);
    expect(deviceInfo().device).toBe('OnePlus CPH2581');
    const body = bodyOf(buildProblemReport().url);
    expect(body).toContain('- Version 5.6.1 (230)');
    expect(body).toContain('- Droid Stream (with extension support) (ext)');
    expect(body).toContain('- Device: OnePlus CPH2581');
    constants.mockRestore();
  });

  it('adds scrubbed logs and an error', () => {
    const report = buildProblemReport({
      device,
      app,
      logs: ['I/VegaJS: start', 'W/VegaJS: failed https://cdn.example/a.m3u8?token=abc for me@mail.test'],
      error: {message: 'Cannot read x of undefined at /data/user/0/app/files/x', stack: 'TypeError: boom\n    at render (index.bundle:1:2)'},
    });
    const body = bodyOf(report.url);
    expect(titleOf(report.url)).toBe('App error: Cannot read x of undefined at <path>');
    expect(body).toContain('### Error');
    expect(body).toContain('at render (index.bundle:1:2)');
    expect(body).toContain('W/VegaJS: failed https://cdn.example/a.m3u8?… for <email>');
    expect(body).not.toMatch(/token=abc|me@mail\.test/);
  });

  it('keeps the newest lines that fit in the link and says it was trimmed', () => {
    const logs = Array.from({length: 150}, (_, index) => `I/VegaJS: line ${index} ${'x'.repeat(120)}`);
    const report = buildProblemReport({device, app, logs});
    expect(report.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    expect(report.trimmed).toBe(true);
    expect(report.logLines).toBeGreaterThan(10);
    expect(report.logLines).toBeLessThan(150);
    const body = bodyOf(report.url);
    expect(body).toContain('I/VegaJS: line 149');
    expect(body).not.toContain('I/VegaJS: line 0 ');
    expect(body).toContain(`Trimmed: ${150 - report.logLines} older lines left out`);
    // Copy logs gets every line.
    expect(report.logText.split('\n')).toHaveLength(150);

    const small = buildProblemReport({device, app, logs: logs.slice(0, 3)});
    expect(small.trimmed).toBe(false);
    expect(bodyOf(small.url)).not.toContain('Trimmed');
  });

  it('keeps only the last 150 lines and stops code fences in logs from breaking the issue', () => {
    const logs = Array.from({length: 200}, (_, index) => `l${index}`);
    logs[199] = 'has ``` inside';
    const report = buildProblemReport({device, app, logs, maxLength: 100000});
    expect(report.logLines).toBe(150);
    expect(bodyOf(report.url)).not.toContain('l49\n');
    expect(bodyOf(report.url)).toContain("has ''' inside");
  });
});

describe('readRecentLogs', () => {
  it('reads the newest lines from the current log, then the older one', async () => {
    const read = FileSystem.readAsStringAsync as jest.Mock;
    read.mockImplementation(async (path: string) =>
      path.endsWith('vega-0.log') ? 'c1\nc2\n' : path.endsWith('vega-1.log') ? 'o1\no2\no3\n' : '',
    );
    await expect(readRecentLogs(4)).resolves.toEqual(['o2', 'o3', 'c1', 'c2']);
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/logs\/vega-0\.log$/));
    read.mockReset();
    read.mockImplementation(async () => '');
  });
});

describe('the sheet', () => {
  const press = async (tree: renderer.ReactTestRenderer, label: string) =>
    act(async () => {
      tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress();
      await new Promise(resolve => setTimeout(resolve, 300));
    });

  beforeEach(() => {
    jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  });

  it('opens the issue without logs by default', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const read = FileSystem.readAsStringAsync as jest.Mock;
    read.mockClear();
    const onClose = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProblemReportSheet visible onClose={onClose} />);
    });
    await press(tree, 'Open GitHub issue');
    expect(read).not.toHaveBeenCalled();
    expect(bodyOf(openURL.mock.calls[0][0])).not.toContain('Recent logs');
    expect(onClose).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('adds logs when ticked and offers Copy logs when they did not all fit', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    openURL.mockClear();
    const read = FileSystem.readAsStringAsync as jest.Mock;
    const longLog = Array.from({length: 150}, (_, index) => `I/VegaJS: line ${index} token=secret${index} ${'y'.repeat(100)}`).join('\n');
    read.mockImplementation(async (path: string) => (path.endsWith('vega-0.log') ? longLog : ''));
    const onClose = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProblemReportSheet visible onClose={onClose} />);
    });
    await press(tree, 'Include recent logs');
    await press(tree, 'Open GitHub issue');
    const body = bodyOf(openURL.mock.calls[0][0]);
    expect(body).toContain('### Recent logs');
    expect(body).not.toContain('secret');
    expect(onClose).not.toHaveBeenCalled();

    await press(tree, 'Copy logs');
    const copied = (Clipboard.setStringAsync as jest.Mock).mock.calls.at(-1)[0] as string;
    expect(copied.split('\n')).toHaveLength(150);
    expect(copied).not.toContain('secret');
    read.mockReset();
    read.mockImplementation(async () => '');
    act(() => tree.unmount());
  });
});
