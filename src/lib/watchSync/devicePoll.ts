/**
 * Polls a device-code sign-in (Trakt device flow, Simkl PIN) until the user
 * approves it on another device, the code expires, or the service says stop.
 *
 * Trakt answers 400 while pending, 429 to ask for a slower pace, and 404,
 * 409, 410 or 418 when the code can no longer be approved; the service
 * functions map those to PollResult values and DeviceCodeStopError.
 */
import {DeviceCodeStopError, type DeviceCode, type PollResult} from './index';

/** Added to the interval each time the service asks for a slower pace (RFC 8628). */
export const SLOW_DOWN_MS = 5000;
/** Network failures in a row tolerated before giving up, so a Wi-Fi blip does not end the sign-in. */
export const MAX_TRANSIENT_ERRORS = 3;
export const EXPIRED_MESSAGE = 'The code expired. Try again.';

export interface PollState {
  intervalMs: number;
  expiresAt: number;
  transientErrors: number;
}

export type PollEvent = {type: 'result'; result: PollResult} | {type: 'error'; error: unknown};

export type PollStep = {kind: 'wait'; delayMs: number} | {kind: 'approved'} | {kind: 'stop'; message: string};

export const initialPollState = (code: DeviceCode): PollState => ({
  intervalMs: Math.max(1, code.intervalSeconds) * 1000,
  expiresAt: code.expiresAt,
  transientErrors: 0,
});

/** What to do after one poll answered (or failed). Pure, so the rules are easy to test. */
export const nextPollStep = (state: PollState, event: PollEvent, now: number): {state: PollState; step: PollStep} => {
  if (event.type === 'result') {
    if (event.result === 'approved') return {state, step: {kind: 'approved'}};
    const intervalMs = event.result === 'slow' ? state.intervalMs + SLOW_DOWN_MS : state.intervalMs;
    const next = {...state, intervalMs, transientErrors: 0};
    if (now >= state.expiresAt) return {state: next, step: {kind: 'stop', message: EXPIRED_MESSAGE}};
    // One last check right at expiry, so an approval in the final seconds still counts.
    return {state: next, step: {kind: 'wait', delayMs: Math.min(intervalMs, state.expiresAt - now)}};
  }
  const message = (event.error as any)?.message || 'Sign-in failed. Try again.';
  if (event.error instanceof DeviceCodeStopError) return {state, step: {kind: 'stop', message}};
  const transientErrors = state.transientErrors + 1;
  const next = {...state, transientErrors};
  if (transientErrors > MAX_TRANSIENT_ERRORS) return {state: next, step: {kind: 'stop', message}};
  if (now >= state.expiresAt) return {state: next, step: {kind: 'stop', message: EXPIRED_MESSAGE}};
  // Wait a little longer after each failure in a row.
  return {state: next, step: {kind: 'wait', delayMs: Math.min(state.intervalMs * transientErrors, state.expiresAt - now)}};
};

export interface DevicePollHandlers {
  poll: (code: DeviceCode) => Promise<PollResult>;
  onApproved: () => void;
  onStop: (message: string) => void;
  now?: () => number;
}

/**
 * Starts polling after the first interval. Returns a cancel function; once
 * cancelled, no handler runs again, even for a request still in flight.
 */
export const startDevicePoll = (code: DeviceCode, {poll, onApproved, onStop, now = Date.now}: DevicePollHandlers): (() => void) => {
  let state = initialPollState(code);
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const handle = (event: PollEvent) => {
    if (cancelled) return;
    const result = nextPollStep(state, event, now());
    state = result.state;
    const {step} = result;
    if (step.kind === 'wait') {
      timer = setTimeout(tick, step.delayMs);
      return;
    }
    cancelled = true;
    if (step.kind === 'approved') onApproved();
    else onStop(step.message);
  };

  const tick = () => {
    if (cancelled) return;
    if (now() > state.expiresAt) {
      cancelled = true;
      onStop(EXPIRED_MESSAGE);
      return;
    }
    poll(code).then(
      result => handle({type: 'result', result}),
      error => handle({type: 'error', error}),
    );
  };

  timer = setTimeout(tick, state.intervalMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
};
