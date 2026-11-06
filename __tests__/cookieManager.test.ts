const mockNative = {
  clearByName: jest.fn(),
  set: jest.fn(),
  flush: jest.fn(),
};

jest.mock('@preeternal/react-native-cookie-manager', () => ({
  __esModule: true,
  default: mockNative,
}));

import {deleteCookie} from '../src/lib/services/cookieManager';

const notSupported = () =>
  Object.assign(new Error('clearByName requires GET_COOKIE_INFO'), {
    code: 'not_supported',
  });

describe('deleteCookie', () => {
  beforeEach(() => {
    mockNative.clearByName.mockReset().mockResolvedValue(true);
    mockNative.set.mockReset().mockResolvedValue(true);
    mockNative.flush.mockReset().mockResolvedValue(undefined);
  });

  it('removes the cookie with clearByName', async () => {
    await deleteCookie('https://site.example/page', 'cf_clearance', '.site.example');
    expect(mockNative.clearByName).toHaveBeenCalledWith(
      'https://site.example/page',
      'cf_clearance',
    );
    expect(mockNative.set).not.toHaveBeenCalled();
  });

  it('expires the cookie when the WebView cannot clear by name', async () => {
    mockNative.clearByName.mockRejectedValue(notSupported());
    await deleteCookie('https://site.example/page', 'cf_clearance', '.example');
    const domains = mockNative.set.mock.calls.map(([, cookie]) => cookie.domain);
    expect(domains).toEqual([undefined, 'site.example', '.site.example', '.example']);
    expect(mockNative.set.mock.calls[0][1]).toMatchObject({
      name: 'cf_clearance',
      value: '',
      expires: '1970-01-01T00:00:00.00Z',
    });
    expect(mockNative.flush).toHaveBeenCalled();
  });

  it('does not write expired copies for other failures', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockNative.clearByName.mockRejectedValue(
      Object.assign(new Error('bad url'), {code: 'invalid_url'}),
    );
    await expect(deleteCookie('nope', 'a')).resolves.toBeUndefined();
    expect(mockNative.set).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
