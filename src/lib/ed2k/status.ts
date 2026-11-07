import {create} from 'zustand';
import type {Ed2kProgressEvent} from './native';

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** One short line for the downloads list. */
export const formatEd2kStatus = (
  event: Pick<
    Ed2kProgressEvent,
    'state' | 'sources' | 'downloading' | 'queueRank' | 'message'
  >,
): string => {
  switch (event.state) {
    case 'downloading':
      return `eD2k · ${event.downloading} of ${plural(event.sources, 'source')} sending`;
    case 'queued':
      return `eD2k · Waiting in queue (${event.queueRank}) · ${plural(event.sources, 'source')}`;
    case 'waitingForNetwork':
      return `eD2k · ${event.message || 'Waiting for network'}`;
    case 'connecting':
      return event.message
        ? `eD2k · Connecting to a server · ${event.message}`
        : 'eD2k · Connecting to a server';
    case 'completed':
      return 'eD2k · Checked and complete';
    default:
      return event.sources > 0
        ? `eD2k · ${plural(event.sources, 'source')}, connecting`
        : 'eD2k · Looking for sources';
  }
};

interface Ed2kStatusState {
  status: Record<string, string>;
  set: (downloadId: string, text: string) => void;
  clear: (downloadId: string) => void;
}

/** Live status lines for running eD2k downloads; not saved. */
export const useEd2kStatusStore = create<Ed2kStatusState>(set => ({
  status: {},
  set: (downloadId, text) =>
    set(state =>
      state.status[downloadId] === text
        ? state
        : {status: {...state.status, [downloadId]: text}},
    ),
  clear: downloadId =>
    set(state => {
      if (!(downloadId in state.status)) return state;
      const next = {...state.status};
      delete next[downloadId];
      return {status: next};
    }),
}));
