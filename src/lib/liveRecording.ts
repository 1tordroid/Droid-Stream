/**
 * Adds Live TV recordings to the download queue: now (until stopped, or for a
 * set time) or for a guide programme (waits for its start, stops at its end).
 */
import {ensureDownloadLocationAccess, getDownloadFileName} from './downloadLocation';
import {advancedDownloadSettings, knownProtectedChannels, setEngineOptions} from './downloadEngine/engineStore';
import {canRecordChannel, isDrmProtected, PROTECTED_CHANNEL_MESSAGE} from './downloadEngine/recordable';
import {jioChannelId} from './livetv/jio/channels';
import type {GuideProgramme} from './livetv/guide';
import {settingsStorage} from './storage';
import useDownloadsStore from './zustand/downloadsStore';

export interface RecordableChannel {
  id: string;
  name: string;
  url: string;
  drm?: boolean;
  attrs?: Record<string, string>;
  logo?: string;
  group?: string;
  headers?: Record<string, string>;
}

/** Programmes start a little early and end a little late, as guides are rarely exact. */
export const RECORDING_PADDING_MS = 2 * 60_000;

const stamp = (time: number) => {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
};

/** Why this channel cannot be recorded, or undefined when it can. Record is shown only when it can. */
export const recordingBlocker = (channel: Pick<RecordableChannel, 'url' | 'drm' | 'attrs'>): string | undefined => {
  const known = knownProtectedChannels();
  if (isDrmProtected(channel, known)) return PROTECTED_CHANNEL_MESSAGE;
  return canRecordChannel(channel, known) ? undefined : 'This channel cannot be recorded.';
};

export const startLiveRecording = async (
  channel: RecordableChannel,
  options: {programme?: GuideProgramme; durationMs?: number} = {},
): Promise<'queued' | 'scheduled'> => {
  const blocker = recordingBlocker(channel);
  if (blocker) throw new Error(blocker);
  const location = await ensureDownloadLocationAccess(settingsStorage.getDownloadLocationConfig());
  if (!location) throw new Error('Choose a download folder first.');
  settingsStorage.setDownloadLocation(location);

  const now = Date.now();
  const programme = options.programme;
  const startAt = programme ? programme.start - RECORDING_PADDING_MS : undefined;
  const stopAt = programme ? programme.stop + RECORDING_PADDING_MS : undefined;
  if (stopAt && stopAt <= now) throw new Error('This programme has already ended.');
  const begins = startAt && startAt > now ? startAt : now;
  const title = programme ? `${programme.title} (${channel.name})` : `${channel.name} ${stamp(begins)}`;
  const id = `rec-${now}-${Math.floor(Math.random() * 1000)}`;
  const extension = advancedDownloadSettings.recordAsTs() ? 'ts' : 'mp4';
  const jioId = jioChannelId(channel.url);

  setEngineOptions(id, {
    live: {
      startAt: startAt && startAt > now ? startAt : undefined,
      stopAt,
      maxDurationMs: programme ? undefined : options.durationMs,
      jioChannelId: jioId || undefined,
      channelName: channel.name,
    },
  });
  useDownloadsStore.getState().enqueueDownload({
    id,
    title,
    type: 'movie',
    url: channel.url,
    headers: channel.headers,
    poster: channel.logo,
    provider: 'Live TV',
    server: channel.name,
    synopsis: programme?.desc,
    displayFileName: getDownloadFileName(title, extension),
    videoType: extension,
    sourceType: 'live',
    downloadLocation: location,
    filePath: '',
    status: 'queued',
  });
  const {scheduleQueuedDownloads} = require('./downloadManager') as typeof import('./downloadManager');
  await scheduleQueuedDownloads();
  return startAt && startAt > now ? 'scheduled' : 'queued';
};

/** Short text for a recording row: when it starts and stops. */
export const describeRecording = (options: {startAt?: number; stopAt?: number; maxDurationMs?: number}, now = Date.now()): string => {
  const clock = (time: number) => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if (options.startAt && options.startAt > now) {
    return options.stopAt ? `Records ${clock(options.startAt)} to ${clock(options.stopAt)}` : `Starts at ${clock(options.startAt)}`;
  }
  if (options.stopAt) return `Recording until ${clock(options.stopAt)}`;
  if (options.maxDurationMs) return `Recording for ${Math.round(options.maxDurationMs / 60_000)} min`;
  return 'Recording until you stop it';
};
