// Device-code sign-in: polls at the given interval, slows down 5 s for each
// 429, stops for an expired, denied or used code, rides out a short network
// failure, and never acts again once cancelled.
import {DeviceCodeStopError, type DeviceCode} from '../src/lib/watchSync';
import {EXPIRED_MESSAGE, initialPollState, MAX_TRANSIENT_ERRORS, nextPollStep, startDevicePoll} from '../src/lib/watchSync/devicePoll';

const json = (status: number, body: unknown) =>
  Promise.resolve({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});

const code = (extra: Partial<DeviceCode> = {}): DeviceCode => ({
  userCode: 'ABCD1234',
  verificationUrl: 'https://trakt.tv/activate',
  deviceCode: 'dev',
  intervalSeconds: 5,
  expiresAt: 1_000_000 + 600_000,
  ...extra,
});

describe('device-code poll state machine', () => {
  const NOW = 1_000_000;

  it('waits the interval while pending and adds 5 s for each slow down', () => {
    let state = initialPollState(code());
    expect(state.intervalMs).toBe(5000);
    let out = nextPollStep(state, {type: 'result', result: 'pending'}, NOW);
    expect(out.step).toEqual({kind: 'wait', delayMs: 5000});
    out = nextPollStep(out.state, {type: 'result', result: 'slow'}, NOW);
    expect(out.step).toEqual({kind: 'wait', delayMs: 10000});
    out = nextPollStep(out.state, {type: 'result', result: 'slow'}, NOW);
    expect(out.step).toEqual({kind: 'wait', delayMs: 15000});
    state = out.state;
    // The slower pace stays for later pending answers.
    expect(nextPollStep(state, {type: 'result', result: 'pending'}, NOW).step).toEqual({kind: 'wait', delayMs: 15000});
  });

  it('finishes on approval', () => {
    expect(nextPollStep(initialPollState(code()), {type: 'result', result: 'approved'}, NOW).step).toEqual({kind: 'approved'});
  });

  it('checks once more right at expiry, then stops', () => {
    const state = initialPollState(code({expiresAt: NOW + 4000}));
    expect(nextPollStep(state, {type: 'result', result: 'pending'}, NOW).step).toEqual({kind: 'wait', delayMs: 4000});
    expect(nextPollStep(state, {type: 'result', result: 'pending'}, NOW + 4000).step).toEqual({kind: 'stop', message: EXPIRED_MESSAGE});
  });

  it('stops at once for a code the service will not approve', () => {
    const out = nextPollStep(initialPollState(code()), {type: 'error', error: new DeviceCodeStopError('Sign-in was denied on Trakt.')}, NOW);
    expect(out.step).toEqual({kind: 'stop', message: 'Sign-in was denied on Trakt.'});
  });

  it('retries network failures with a growing wait, then gives up', () => {
    let state = initialPollState(code());
    for (let failure = 1; failure <= MAX_TRANSIENT_ERRORS; failure++) {
      const out = nextPollStep(state, {type: 'error', error: new Error('Network request failed')}, NOW);
      expect(out.step).toEqual({kind: 'wait', delayMs: 5000 * failure});
      state = out.state;
    }
    expect(nextPollStep(state, {type: 'error', error: new Error('Network request failed')}, NOW).step).toEqual({kind: 'stop', message: 'Network request failed'});
    // A good answer resets the count.
    const reset = nextPollStep(state, {type: 'result', result: 'pending'}, NOW);
    expect(reset.state.transientErrors).toBe(0);
  });
});

describe('device-code poll runner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('polls after each interval until approved', async () => {
    const answers = ['pending', 'slow', 'approved'] as const;
    const poll = jest.fn(async () => answers[poll.mock.calls.length - 1]);
    const onApproved = jest.fn();
    const onStop = jest.fn();
    startDevicePoll(code({expiresAt: Date.now() + 600_000}), {poll, onApproved, onStop});
    await jest.advanceTimersByTimeAsync(4999);
    expect(poll).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(9999);
    expect(poll).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('ignores an answer that arrives after cancel', async () => {
    let resolve!: (value: 'approved') => void;
    const poll = jest.fn(() => new Promise<'approved'>(done => (resolve = done)));
    const onApproved = jest.fn();
    const cancel = startDevicePoll(code({expiresAt: Date.now() + 600_000}), {poll, onApproved, onStop: jest.fn()});
    await jest.advanceTimersByTimeAsync(5000);
    cancel();
    resolve('approved');
    await jest.advanceTimersByTimeAsync(0);
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('stops with the expiry message once the code lapses', async () => {
    const poll = jest.fn(async () => 'pending' as const);
    const onStop = jest.fn();
    startDevicePoll(code({expiresAt: Date.now() + 12_000}), {poll, onApproved: jest.fn(), onStop});
    await jest.advanceTimersByTimeAsync(30_000);
    // At 5 s, 10 s, and once more at the 12 s expiry.
    expect(poll).toHaveBeenCalledTimes(3);
    expect(onStop).toHaveBeenCalledWith(EXPIRED_MESSAGE);
  });
});

describe('Trakt device token answers', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  const load = () => require('../src/lib/watchSync');

  it.each([
    [400, 'pending'],
    [429, 'slow'],
  ])('maps %i to %s', async (status, result) => {
    const sync = load();
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret'});
    fetchMock.mockImplementation(() => json(status, {}));
    await expect(sync.traktPollDevice(code())).resolves.toBe(result);
  });

  it.each([404, 409, 410, 418])('stops polling on %i', async status => {
    const sync = load();
    sync.updateAccount('trakt', {clientId: 'cid', clientSecret: 'secret'});
    fetchMock.mockImplementation(() => json(status, {}));
    const error = await sync.traktPollDevice(code()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(sync.DeviceCodeStopError);
  });
});
