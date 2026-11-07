// Passkey workarounds in the browser: the page script reports failed passkey
// sign-ins, the browser offers Sign in with Chrome once per site, and the
// passkey manager button falls back to older Settings screens.
import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockStartActivity = jest.fn();
jest.mock('expo-intent-launcher', () => ({startActivityAsync: (...args: unknown[]) => mockStartActivity(...args)}));
jest.mock('expo-application', () => ({applicationId: 'com.tordroid.droidstream'}));
const mockShowDialog = jest.fn();
jest.mock('../src/lib/zustand/appDialogStore', () => ({showAppDialog: (dialog: unknown) => mockShowDialog(dialog)}));
jest.mock('../src/components/ui/Text', () => {
  const {Text: NativeText, TextInput: Input} = require('react-native');
  return {__esModule: true, default: NativeText, RawText: NativeText, RawTextInput: Input};
});
jest.mock('react-native-reanimated', () => require('../__mocks__/reanimatedStub'));
jest.mock('../src/theme/M3PaletteContext', () => ({useM3Colors: () => ({})}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
  SafeAreaView: ({children}: any) => children,
}));
jest.mock('../src/components/ui/ScreenSafeArea', () => ({__esModule: true, default: ({children}: any) => children}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn(), getState: () => ({routeNames: []})}),
  useRoute: () => ({params: {url: 'https://site.test/login'}}),
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../src/lib/browser/filters/lists', () => ({ensureFilters: jest.fn(async () => undefined), hidingSelectorsFor: () => []}));
jest.mock('../src/lib/browser/handoff', () => ({
  downloadFile: jest.fn(),
  downloadStream: jest.fn(),
  handlePageDownload: jest.fn(),
  openExternally: jest.fn(),
  openInYtdl: jest.fn(),
  openTorrent: jest.fn(),
  shareLink: jest.fn(),
}));
jest.mock('../src/screens/browser/MediaSheet', () => () => null);
jest.mock('../src/lib/ytdl/native', () => ({ytdlSupported: () => false}));
jest.mock('../src/lib/browser/privacy', () => ({clearPrivateData: jest.fn(async () => undefined), rememberPrivateHost: jest.fn()}));

const {JSDOM} = require('jsdom');
import {Linking, ToastAndroid} from 'react-native';
import {setBrowserEngineForTests, type BrowserEngine, type BrowserTabViewProps} from '../src/lib/browser/engine';
import {buildBootstrap} from '../src/lib/browser/inject';
import {
// The Browser screen renders slowly when the machine is busy.
jest.setTimeout(30000);
  markPasskeyTipShown,
  openInChrome,
  openPasskeyProviderSettings,
  passkeyFailureFrom,
  providerSettingsHint,
  shouldShowPasskeyTip,
} from '../src/lib/browser/passkeys';

const notFound = () => Promise.reject(Object.assign(new Error('No Activity found'), {code: 'ERR_UNEXPECTED'}));
const opens = () => new Promise(() => undefined);

beforeEach(() => {
  mockStartActivity.mockReset();
  mockShowDialog.mockReset();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
});

describe('page script', () => {
  const page = () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {url: 'https://site.test/login', runScripts: 'outside-only'});
    const window = dom.window;
    const messages: any[] = [];
    window.ReactNativeWebView = {postMessage: (text: string) => messages.push(JSON.parse(text))};
    let outcome: {name?: string} | 'ok' = 'ok';
    class CredentialsContainer {
      get() {
        return outcome === 'ok' ? Promise.resolve({id: 'cred'}) : Promise.reject(outcome);
      }
      create() {
        return outcome === 'ok' ? Promise.resolve({id: 'cred'}) : Promise.reject(outcome);
      }
    }
    window.CredentialsContainer = CredentialsContainer;
    Object.defineProperty(window.navigator, 'credentials', {value: new CredentialsContainer(), configurable: true});
    window.eval(buildBootstrap({token: 'TOK', desktop: false, darkPages: false, videoButton: false, detectLogins: false}));
    return {window, messages, fail: (name: string) => (outcome = {name}), succeed: () => (outcome = 'ok')};
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const failures = (messages: any[]) => messages.filter(message => message.type === 'passkeyFailed');

  it('reports a failed passkey sign-in and leaves the page its own error', async () => {
    const {window, messages, fail} = page();
    fail('NotAllowedError');
    const error = await window.navigator.credentials.get({publicKey: {challenge: new Uint8Array(1)}}).catch((reason: any) => reason);
    expect(error.name).toBe('NotAllowedError');
    await settle();
    expect(failures(messages)).toEqual([{type: 'passkeyFailed', op: 'get', error: 'NotAllowedError', url: 'https://site.test/login', __ds: 'TOK', __dsb: 1}]);

    fail('SecurityError');
    await window.navigator.credentials.create({publicKey: {}}).catch(() => undefined);
    await settle();
    expect(failures(messages).map(message => [message.op, message.error])).toEqual([['get', 'NotAllowedError'], ['create', 'SecurityError']]);
    window.close();
  });

  it('stays quiet for success, other errors and non-passkey requests', async () => {
    const {window, messages, fail, succeed} = page();
    succeed();
    await window.navigator.credentials.get({publicKey: {}});
    fail('AbortError');
    await window.navigator.credentials.get({publicKey: {}}).catch(() => undefined);
    fail('NotAllowedError');
    await window.navigator.credentials.get({password: true}).catch(() => undefined);
    await settle();
    expect(failures(messages)).toEqual([]);
    window.close();
  });
});

describe('failure messages and the once-per-site tip', () => {
  it('accepts only well-formed failures from https pages', () => {
    expect(passkeyFailureFrom({type: 'passkeyFailed', op: 'get', error: 'NotAllowedError', url: 'https://a.test/'})).toEqual({op: 'get', error: 'NotAllowedError', url: 'https://a.test/'});
    expect(passkeyFailureFrom({type: 'passkeyFailed', op: 'get', error: 'AbortError', url: 'https://a.test/'})).toBeNull();
    expect(passkeyFailureFrom({type: 'passkeyFailed', op: 'delete', error: 'NotAllowedError', url: 'https://a.test/'})).toBeNull();
    expect(passkeyFailureFrom({type: 'passkeyFailed', op: 'get', error: 'NotAllowedError', url: 'http://a.test/'})).toBeNull();
    expect(passkeyFailureFrom({type: 'page'})).toBeNull();
    expect(passkeyFailureFrom(null)).toBeNull();
  });

  it('shows the tip once per site, counting www and m. as the same site', () => {
    expect(shouldShowPasskeyTip('https://www.once.test/login')).toBe(true);
    markPasskeyTipShown('https://www.once.test/login');
    expect(shouldShowPasskeyTip('https://once.test/other')).toBe(false);
    expect(shouldShowPasskeyTip('https://m.once.test/')).toBe(false);
    expect(shouldShowPasskeyTip('https://another.test/')).toBe(true);
  });
});

describe('Sign in with Chrome', () => {
  it('opens a Chrome Custom Tab', async () => {
    mockStartActivity.mockImplementation(opens);
    await expect(openInChrome('https://site.test/login')).resolves.toBe('chrome');
    expect(mockStartActivity).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'https://site.test/login',
      packageName: 'com.android.chrome',
      className: 'com.google.android.apps.chrome.IntentDispatcher',
      extra: {'android.support.customtabs.extra.SESSION': false},
    });
  });

  it('falls back to the default browser, then to a plain link', async () => {
    mockStartActivity.mockImplementationOnce(notFound).mockImplementationOnce(opens);
    await expect(openInChrome('https://site.test/login')).resolves.toBe('browser');
    expect(mockStartActivity.mock.calls[1][1]).toEqual({data: 'https://site.test/login', extra: {'android.support.customtabs.extra.SESSION': false}});

    mockStartActivity.mockReset().mockImplementation(notFound);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await expect(openInChrome('https://site.test/login')).resolves.toBe('link');
    expect(openURL).toHaveBeenCalledWith('https://site.test/login');
  });

  it('does not open other kinds of links', async () => {
    await expect(openInChrome('ftp://files.test/file.zip')).resolves.toBe('failed');
    expect(mockStartActivity).not.toHaveBeenCalled();
  });
});

describe('Choose a passkey manager', () => {
  it('opens the credential provider screen on Android 14 and newer', async () => {
    mockStartActivity.mockImplementation(opens);
    await expect(openPasskeyProviderSettings(35)).resolves.toBe('credential-provider');
    expect(mockStartActivity).toHaveBeenCalledWith('android.settings.CREDENTIAL_PROVIDER', {data: 'package:com.tordroid.droidstream'});
  });

  it('falls back to the screen without a package, then Accounts, then Settings', async () => {
    mockStartActivity.mockImplementation(notFound);
    await expect(openPasskeyProviderSettings(34)).resolves.toBe('failed');
    expect(mockStartActivity.mock.calls.map(call => [call[0], call[1]])).toEqual([
      ['android.settings.CREDENTIAL_PROVIDER', {data: 'package:com.tordroid.droidstream'}],
      ['android.settings.CREDENTIAL_PROVIDER', {}],
      ['android.settings.SYNC_SETTINGS', {}],
      ['android.settings.SETTINGS', {}],
    ]);

    mockStartActivity.mockReset().mockImplementationOnce(notFound).mockImplementationOnce(notFound).mockImplementationOnce(opens);
    await expect(openPasskeyProviderSettings(34)).resolves.toBe('accounts');
  });

  it('goes straight to Accounts on older Android and says so', async () => {
    mockStartActivity.mockImplementation(opens);
    await expect(openPasskeyProviderSettings(31)).resolves.toBe('accounts');
    expect(mockStartActivity).toHaveBeenCalledTimes(1);
    expect(mockStartActivity.mock.calls[0][0]).toBe('android.settings.SYNC_SETTINGS');
    expect(providerSettingsHint(31)).toMatch(/Android 14/);
    expect(providerSettingsHint(34)).toMatch(/Bitwarden, 1Password, Proton Pass, KeePassDX/);
  });
});

describe('browser screen', () => {
  let tabProps: BrowserTabViewProps | undefined;
  const fakeEngine: BrowserEngine = {
    name: 'test',
    TabView: (props: BrowserTabViewProps) => {
      tabProps = props;
      return null;
    },
    requestHook: () => false,
    userAgents: {desktop: 'desktop', mobile: 'mobile'},
    blocking: {load: async () => 0, clear: () => undefined, configure: () => undefined, check: async () => false},
    cookies: {header: async () => '', clearSite: async () => undefined, clearAll: async () => undefined, flush: () => undefined},
    clearSiteData: async () => undefined,
    passkeysSupported: async () => true,
    onEvent: () => () => undefined,
  };
  beforeAll(() => setBrowserEngineForTests(fakeEngine));
  afterAll(() => setBrowserEngineForTests(undefined));

  it('offers Sign in with Chrome when a passkey sign-in fails, once per site', async () => {
    const Browser = require('../src/screens/browser/Browser').default;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Browser />);
    });
    expect(tabProps).toBeDefined();
    const token = /"token":"([^"]+)"/.exec(tabProps!.bootstrap)![1];
    const send = (message: object) => act(async () => tabProps!.callbacks.onMessage(tabProps!.tab.id, JSON.stringify({__dsb: 1, ...message})));
    const failure = {type: 'passkeyFailed', op: 'get', error: 'NotAllowedError', url: 'https://screen.test/login'};

    // Without the page script's token (a page pretending), nothing happens.
    await send({...failure, __ds: 'nope'});
    expect(mockShowDialog).not.toHaveBeenCalled();

    await send({...failure, __ds: token});
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    const dialog = mockShowDialog.mock.calls[0][0];
    expect(dialog.message).toMatch(/stays in Chrome/);
    const action = dialog.actions.find((item: any) => item.label === 'Sign in with Chrome');
    mockStartActivity.mockImplementation(opens);
    await act(async () => {
      action.onPress();
      await new Promise(resolve => setTimeout(resolve, 450));
    });
    expect(mockStartActivity.mock.calls[0][1]).toMatchObject({data: 'https://screen.test/login', packageName: 'com.android.chrome'});
    expect(ToastAndroid.show).toHaveBeenCalledWith('Sign in there. The sign-in stays in Chrome.', expect.anything());

    // The same site again: no second tip.
    await send({...failure, url: 'https://screen.test/again', __ds: token});
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
