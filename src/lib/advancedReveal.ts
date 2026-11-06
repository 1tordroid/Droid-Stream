import {useEffect, useState} from 'react';
import {settingsStorage} from './storage';

const revealed = new Set<string>();
const listeners = new Set<() => void>();

export const revealFeature = (id: string): void => {
  revealed.add(id);
  listeners.forEach(listener => listener());
};

export const useFeatureVisible = (id: string): boolean => {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh(value => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return settingsStorage.isAdvancedMode() || revealed.has(id);
};

export const alwaysShowAdvanced = (): void => {
  settingsStorage.setAdvancedMode(true);
  listeners.forEach(listener => listener());
};
