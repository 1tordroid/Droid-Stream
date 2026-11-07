/**
 * State behind the player's subtitle tools: the delay remembered per title,
 * the lines of the main subtitle (for Sync to a line, Auto sync and
 * translation), the second subtitle and a translated track.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {SubtitleCue} from '../../../lib/subtitles/cueParser';
import {
  loadSubtitleCues,
  subtitleRefFor,
  type ExternalSubtitle,
  type PlayerTextTrack,
} from '../../../lib/subtitles/subtitleCues';
import {
  clampSubtitleDelay,
  readTitleSubtitleDelay,
  writeTitleSubtitleDelay,
} from '../../../lib/subtitles/subtitleSync';
import {
  readTranslationKey,
  readTranslationSettings,
  translateCues,
  translationCacheKey,
  translationProblem,
  translationServiceLabel,
  type TranslationSettings,
} from '../../../lib/subtitles/translation';
import {normalizeLanguage, readLanguagePrefs} from '../../../lib/languagePrefs';

export type SecondChoice = {kind: 'off'} | {kind: 'track'; index: number} | {kind: 'translation'};

export interface TranslationState {
  cues: SubtitleCue[];
  texts: string[];
  done: number;
  total: number;
  running: boolean;
  error?: string;
  target: string;
  label: string;
}

export interface OverlayTrack {
  cues: SubtitleCue[];
  delayMs: number;
}

interface Options {
  /** Key of the title (show episode or film) the delay is remembered for. */
  titleKey?: string;
  /** Changes when another source starts playing. */
  streamKey: string;
  videoUri: string;
  headers?: Record<string, string>;
  videoType?: string;
  textTracks: PlayerTextTrack[];
  externalSubs: ExternalSubtitle[];
  /** 1000 when subtitles are off. */
  selectedTextTrackIndex: number;
  /** Video time now, for translating from where the viewer is. */
  getTime: () => number;
}

const NO_HEADERS: Record<string, string> = {};

/** The language subtitles are translated into: the setting, else the app's subtitle language, else English. */
export const translationTarget = (settings: TranslationSettings): string =>
  normalizeLanguage(settings.target) || normalizeLanguage(readLanguagePrefs().subtitlePrimary) || 'en';

export function useSubtitleTools(options: Options) {
  const {titleKey, streamKey, videoUri, videoType, textTracks, externalSubs, selectedTextTrackIndex, getTime} = options;
  const headers = options.headers || NO_HEADERS;

  // The delay, kept per title. Saving waits for the buttons to settle.
  const [subtitleDelayMs, setDelayState] = useState(() => readTitleSubtitleDelay(titleKey));
  const titleKeyRef = useRef(titleKey);
  titleKeyRef.current = titleKey;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDelayState(readTitleSubtitleDelay(titleKey));
  }, [titleKey, streamKey]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);
  const setSubtitleDelayMs = useCallback((delayMs: number) => {
    const value = clampSubtitleDelay(delayMs);
    setDelayState(value);
    const key = titleKeyRef.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeTitleSubtitleDelay(key, value), 600);
  }, []);

  // The main subtitle's lines.
  const primaryTrack = selectedTextTrackIndex === 1000 ? undefined : textTracks.find(track => track.index === selectedTextTrackIndex);
  const primaryRef = useMemo(
    () => subtitleRefFor(primaryTrack, textTracks, externalSubs),
    [primaryTrack, textTracks, externalSubs],
  );
  const loadPrimaryCues = useCallback(
    (): Promise<SubtitleCue[]> =>
      primaryRef ? loadSubtitleCues(primaryRef, videoUri, headers, videoType) : Promise.reject(new Error('Pick a subtitle first')),
    [primaryRef, videoUri, headers, videoType],
  );

  // The second subtitle.
  const [secondChoice, setSecondChoice] = useState<SecondChoice>({kind: 'off'});
  const [secondDelayMs, setSecondDelayMs] = useState(0);
  const [secondCues, setSecondCues] = useState<SubtitleCue[]>([]);
  const [secondStatus, setSecondStatus] = useState('');
  useEffect(() => {
    if (secondChoice.kind !== 'track') {
      setSecondCues([]);
      setSecondStatus('');
      return;
    }
    const track = textTracks.find(item => item.index === secondChoice.index);
    const ref = subtitleRefFor(track, textTracks, externalSubs);
    if (!ref) {
      setSecondCues([]);
      setSecondStatus('The lines of this subtitle cannot be read');
      return;
    }
    let live = true;
    setSecondStatus('Loading…');
    loadSubtitleCues(ref, videoUri, headers, videoType)
      .then(cues => {
        if (!live) return;
        setSecondCues(cues);
        setSecondStatus('');
      })
      .catch(error => {
        if (!live) return;
        setSecondCues([]);
        setSecondStatus(error instanceof Error ? error.message : 'Could not load this subtitle');
      });
    return () => {
      live = false;
    };
  }, [secondChoice, textTracks, externalSubs, videoUri, headers, videoType]);

  // Translation of the main subtitle.
  const [translation, setTranslation] = useState<TranslationState>();
  const [translationAsMain, setTranslationAsMain] = useState(false);
  const abortRef = useRef<{aborted: boolean} | null>(null);
  const stopTranslation = useCallback(() => {
    if (abortRef.current) abortRef.current.aborted = true;
    abortRef.current = null;
    setTranslation(previous => (previous ? {...previous, running: false} : previous));
  }, []);

  useEffect(() => {
    // Another source: its tracks and timing differ.
    if (abortRef.current) abortRef.current.aborted = true;
    abortRef.current = null;
    setSecondChoice({kind: 'off'});
    setSecondDelayMs(0);
    setTranslation(undefined);
    setTranslationAsMain(false);
  }, [streamKey]);
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.aborted = true;
  }, []);

  const startTranslation = useCallback(async () => {
    const settings = readTranslationSettings();
    const key = readTranslationKey(settings.service);
    const problem = translationProblem(settings, key);
    const target = translationTarget(settings);
    const label = translationServiceLabel(settings);
    if (problem) {
      setTranslation({cues: [], texts: [], done: 0, total: 0, running: false, error: problem, target, label});
      return;
    }
    if (abortRef.current) abortRef.current.aborted = true;
    const signal = {aborted: false};
    abortRef.current = signal;
    let cues: SubtitleCue[];
    try {
      setTranslation({cues: [], texts: [], done: 0, total: 0, running: true, target, label});
      cues = await loadPrimaryCues();
    } catch (error) {
      if (!signal.aborted) {
        setTranslation({cues: [], texts: [], done: 0, total: 0, running: false, target, label, error: error instanceof Error ? error.message : 'Could not read the subtitle'});
      }
      return;
    }
    if (signal.aborted) return;
    setSecondChoice(previous => (previous.kind === 'off' ? {kind: 'translation'} : previous));
    const cacheKey = translationCacheKey(`${titleKeyRef.current || videoUri}|${primaryRef?.key || ''}`, cues, settings, target);
    try {
      await translateCues(cues, {
        settings,
        key,
        target,
        cacheKey,
        signal,
        fromTime: getTime(),
        onProgress: (texts, done, total) => {
          if (!signal.aborted) setTranslation({cues, texts: [...texts], done, total, running: done < total, target, label});
        },
      });
      if (!signal.aborted) setTranslation(previous => (previous ? {...previous, running: false} : previous));
    } catch (error) {
      if (!signal.aborted) {
        setTranslation(previous => ({
          ...(previous || {cues, texts: cues.map(() => ''), done: 0, total: cues.length, target, label}),
          running: false,
          error: error instanceof Error ? error.message : 'Translation failed',
        }));
      }
    } finally {
      if (abortRef.current === signal) abortRef.current = null;
    }
  }, [loadPrimaryCues, primaryRef?.key, videoUri, getTime]);

  const translatedCues = useMemo(
    () => (translation ? translation.cues.map((cue, index) => ({...cue, text: translation.texts[index] || ''})) : []),
    [translation],
  );

  const secondOverlay: OverlayTrack | undefined =
    secondChoice.kind === 'translation' && !translationAsMain && translatedCues.length
      ? {cues: translatedCues, delayMs: subtitleDelayMs}
      : secondChoice.kind === 'track' && secondCues.length
        ? {cues: secondCues, delayMs: secondDelayMs}
        : undefined;
  const mainOverlay: OverlayTrack | undefined =
    translationAsMain && translatedCues.length ? {cues: translatedCues, delayMs: subtitleDelayMs} : undefined;

  return {
    subtitleDelayMs,
    setSubtitleDelayMs,
    primaryRef,
    loadPrimaryCues,
    secondChoice,
    setSecondChoice,
    secondDelayMs,
    setSecondDelayMs,
    secondStatus,
    translation,
    startTranslation,
    stopTranslation,
    translationAsMain,
    setTranslationAsMain,
    secondOverlay,
    mainOverlay,
  };
}

export type SubtitleTools = ReturnType<typeof useSubtitleTools>;
