import {MMKVLoader} from 'react-native-mmkv-storage';
import type {QueueMeta} from './planner';

const storage = new MMKVLoader().withInstanceID('droid-stream-download-queue').initialize();
const KEY = 'queue-meta';

export const readQueueMeta = (): Record<string, QueueMeta> => {
  try {
    return JSON.parse(storage.getString(KEY) || '{}');
  } catch {
    return {};
  }
};

export const writeQueueMeta = (meta: Record<string, QueueMeta>): void => {
  storage.setString(KEY, JSON.stringify(meta));
};

export const setQueueOrder = (ids: string[], queue = 'Downloads'): void => {
  const current = readQueueMeta();
  ids.forEach((id, index) => {
    current[id] = {queue, priority: current[id]?.priority || 0, order: index};
  });
  writeQueueMeta(current);
};

let open = true;

export const transfersOpen = (): boolean => open;

export const setTransfersOpen = (allowed: boolean): void => {
  open = allowed;
};
