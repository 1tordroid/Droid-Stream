import type {YtdlJobSpec} from './types';

/**
 * Why a queued yt-dlp download should not start yet, or undefined when it may.
 * Other downloads never wait here; they follow the app-wide download rules.
 */
export const deferralReason = (
  spec: Pick<YtdlJobSpec, 'notBefore' | 'wifiOnly'> | undefined,
  now: number,
  onWifi: boolean,
): string | undefined => {
  if (!spec) return undefined;
  if (spec.notBefore && spec.notBefore > now) {
    const at = new Date(spec.notBefore);
    const sameDay = new Date(now).toDateString() === at.toDateString();
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return sameDay ? `Starts at ${time}` : `Starts ${at.getDate()}/${at.getMonth() + 1} at ${time}`;
  }
  if (spec.wifiOnly && !onWifi) return 'Waiting for Wi-Fi';
  return undefined;
};

/** The next time today or tomorrow at hours:minutes, as ms since epoch. */
export const nextTimeAt = (hours: number, minutes: number, now = Date.now()): number => {
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
};

let wifi = true;

export const lastKnownWifi = (): boolean => wifi;

export const setLastKnownWifi = (value: boolean): void => {
  wifi = value;
};
