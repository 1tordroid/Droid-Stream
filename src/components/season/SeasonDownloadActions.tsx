/**
 * "Download season", "Download next" and "Keep next ready" under a show's
 * season picker. Each asks for the source once (the servers of the first
 * episode), then finds the same kind of stream for every other episode.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, ToastAndroid, View, useWindowDimensions} from 'react-native';
import Chip from '../torrentSearch/Chip';
import Button from '../ui/Button';
import LoadingIndicator from '../ui/LoadingIndicator';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import AppText from '../ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {ensureDownloadLocationAccess} from '../../lib/downloadLocation';
import {settingsStorage, watchProgressStorage} from '../../lib/storage';
import type {Stream} from '../../lib/providers/types';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';
import {nextUnwatched, numberEpisodes, selectEpisodeRange, type NumberedEpisode, type SeasonEpisode} from '../../lib/seriesDownloads/episodes';
import {batchMessage, fetchProviderStreams, queueEpisodes, type EpisodeTarget, type ShowInfo} from '../../lib/seriesDownloads/queue';
import {isWatchedProgress, runSeriesDownloads} from '../../lib/seriesDownloads/runner';
import {findSeriesRule, removeSeriesRule, saveSeriesRule, subscribeSeriesRules} from '../../lib/seriesDownloads/rules';
import {MAX_KEEP, MIN_KEEP} from '../../lib/seriesDownloads/rolling';
import {choiceFromStream, describeChoice, lastSourceChoice, pickStream, rememberSourceChoice, type SourceChoice} from '../../lib/seriesDownloads/sourceChoice';

type Mode = 'season' | 'next' | 'rolling';

interface Props {
  show: ShowInfo;
  seasonTitle: string;
  /** Episodes of the season in season order, with their raw list positions. */
  episodes: SeasonEpisode[];
}

const NEXT_COUNTS = [1, 2, 3, 5, 10];
const KEEP_COUNTS = Array.from({length: MAX_KEEP - MIN_KEEP + 1}, (_, index) => MIN_KEEP + index);

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);
const isWatchedLink = (link: string) => isWatchedProgress(watchProgressStorage.getProgress(link));

const streamLabel = (stream: Stream): string => describeChoice(choiceFromStream(stream, ''));

const Stepper = ({label, value, min, max, onChange}: {label: string; value: number; min: number; max: number; onChange: (value: number) => void}) => {
  const colors = useM3Colors();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8}}>
      <AppText role="bodyLarge" style={{color: colors.onSurface, width: 56}}>{label}</AppText>
      <Chip label="−" accessibilityLabel={`${label} one less`} onPress={() => onChange(Math.max(min, value - 1))} />
      <AppText role="titleMedium" style={{color: colors.onSurface, minWidth: 40, textAlign: 'center'}}>{value}</AppText>
      <Chip label="+" accessibilityLabel={`${label} one more`} onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  );
};

const SeasonDownloadDialog = ({mode, show, seasonTitle, episodes, onClose}: Props & {mode: Mode; onClose: () => void}) => {
  const colors = useM3Colors();
  const {height} = useWindowDimensions();
  const numbered = useMemo(() => numberEpisodes(episodes, seasonTitle), [episodes, seasonTitle]);
  const existingRule = mode === 'rolling' ? findSeriesRule(show.provider, show.infoUrl) : undefined;
  const [useRange, setUseRange] = useState(false);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(numbered.length);
  const [nextCount, setNextCount] = useState(3);
  const [keep, setKeep] = useState(existingRule?.keep ?? 2);
  const [deleteAfter, setDeleteAfter] = useState(existingRule?.deleteAfterWatching ?? false);
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [streamError, setStreamError] = useState('');
  const [picked, setPicked] = useState<number>(-1);
  const [progress, setProgress] = useState<{done: number; total: number} | null>(null);
  const controller = useRef<AbortController | null>(null);

  const targets: NumberedEpisode[] = useMemo(() => {
    if (mode === 'season') return selectEpisodeRange(numbered, useRange ? {from, to} : undefined);
    if (mode === 'next') return nextUnwatched(numbered, episode => isWatchedLink(episode.link), nextCount);
    return nextUnwatched(numbered, episode => isWatchedLink(episode.link), 1);
  }, [mode, numbered, useRange, from, to, nextCount]);
  // The source is picked from the first episode the dialog would download.
  const sample = targets[0] ?? numbered[0];

  useEffect(() => {
    if (!sample) return;
    const loader = new AbortController();
    setStreams(null);
    setStreamError('');
    fetchProviderStreams(show, sample.link, loader.signal)
      .then(list => {
        if (loader.signal.aborted) return;
        const usable = list.filter(stream => stream?.link);
        setStreams(usable);
        const saved = existingRule?.choice ?? lastSourceChoice(show.provider, show.infoUrl);
        const best = pickStream(usable, saved);
        setPicked(best ? usable.indexOf(best) : -1);
      })
      .catch(error => {
        if (loader.signal.aborted) return;
        setStreams([]);
        setStreamError(error instanceof Error ? error.message : String(error));
      });
    return () => loader.abort();
    // The sample changes with the range; reloading on every step is fine.
  }, [sample?.link, show.provider, show.infoUrl]);

  useEffect(() => () => controller.current?.abort(), []);

  const choice: SourceChoice | undefined = streams && picked >= 0 && streams[picked] ? choiceFromStream(streams[picked], show.provider) : existingRule?.choice;

  const asTargets = (list: NumberedEpisode[]): EpisodeTarget[] =>
    list.map(episode => ({title: episode.title, link: episode.link, index: episode.index, seasonTitle, season: episode.season, episode: episode.episode, skip: episode.skip}));

  const prepareLocation = async (): Promise<boolean> => {
    const location = await ensureDownloadLocationAccess(settingsStorage.getDownloadLocationConfig());
    if (!location) return false;
    settingsStorage.setDownloadLocation(location);
    return true;
  };

  const startBatch = async () => {
    if (!targets.length || progress) return;
    if (!(await prepareLocation())) return;
    if (choice) rememberSourceChoice(show.infoUrl, choice);
    const own = new AbortController();
    controller.current = own;
    setProgress({done: 0, total: targets.length});
    const result = await queueEpisodes(show, asTargets(targets), choice, {
      signal: own.signal,
      onProgress: (done, total) => !own.signal.aborted && setProgress({done, total}),
      known: sample && streams ? {link: sample.link, streams} : undefined,
    });
    if (controller.current === own) controller.current = null;
    if (result.cancelled) return;
    setProgress(null);
    toast(batchMessage(result));
    onClose();
  };

  const saveRule = async () => {
    if (!(await prepareLocation())) return;
    if (choice) rememberSourceChoice(show.infoUrl, choice);
    saveSeriesRule({...show, seasonTitle: existingRule?.seasonTitle ?? seasonTitle, keep, deleteAfterWatching: deleteAfter, choice});
    runSeriesDownloads().catch(() => undefined);
    toast(`Keeping the next ${keep} episode${keep === 1 ? '' : 's'} ready`);
    onClose();
  };

  const cancel = () => {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setProgress(null);
      toast('Stopped. Episodes already queued keep downloading.');
      return;
    }
    onClose();
  };

  const title = mode === 'season' ? 'Download season' : mode === 'next' ? 'Download next episodes' : 'Keep next episodes ready';

  return (
    <MaterialDialogSurface visible onDismiss={cancel} style={{maxHeight: Math.max(280, height - 48)}}>
      <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
        <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 4}}>{title}</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
          {mode === 'rolling'
            ? 'Downloads the next unwatched episodes and keeps them ready, also into the next season. Runs while the app is open or downloading.'
            : `${show.showTitle} · ${seasonTitle}`}
        </AppText>

        {mode === 'season' ? (
          <View style={{marginBottom: 12}}>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10}}>
              <Chip label={`All ${numbered.length} episodes`} selected={!useRange} onPress={() => setUseRange(false)} />
              <Chip label="Pick a range" selected={useRange} onPress={() => setUseRange(true)} />
            </View>
            {useRange ? (
              <>
                <Stepper label="From" value={from} min={1} max={numbered.length} onChange={value => {
                  setFrom(value);
                  if (value > to) setTo(value);
                }} />
                <Stepper label="To" value={to} min={1} max={numbered.length} onChange={value => {
                  setTo(value);
                  if (value < from) setFrom(value);
                }} />
              </>
            ) : null}
          </View>
        ) : null}

        {mode === 'next' ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
            {NEXT_COUNTS.map(count => (
              <Chip key={count} label={String(count)} accessibilityLabel={`Next ${count}`} selected={nextCount === count} onPress={() => setNextCount(count)} />
            ))}
          </View>
        ) : null}

        {mode === 'rolling' ? (
          <View style={{marginBottom: 12}}>
            <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Episodes to keep</AppText>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
              {KEEP_COUNTS.map(count => (
                <Chip key={count} label={String(count)} accessibilityLabel={`Keep ${count}`} selected={keep === count} onPress={() => setKeep(count)} />
              ))}
            </View>
            <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Delete after watching</AppText>
            <View style={{flexDirection: 'row', gap: 8}}>
              <Chip label="Off" selected={!deleteAfter} onPress={() => setDeleteAfter(false)} />
              <Chip label="On" selected={deleteAfter} onPress={() => setDeleteAfter(true)} />
            </View>
          </View>
        ) : null}

        {mode !== 'rolling' ? (
          <AppText role="bodyMedium" style={{color: colors.onSurface, marginBottom: 8}}>
            {targets.length
              ? `${targets.length} episode${targets.length === 1 ? '' : 's'}: ${targets[0].title}${targets.length > 1 ? ` to ${targets[targets.length - 1].title}` : ''}`
              : 'Nothing left to download in this season.'}
          </AppText>
        ) : null}

        <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Source</AppText>
        {streams === null ? (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40}}>
            <LoadingIndicator />
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Loading servers…</AppText>
          </View>
        ) : streams.length ? (
          <View style={{gap: 6}}>
            {streams.map((stream, index) => (
              <Chip key={`${stream.server}-${index}`} label={streamLabel(stream)} selected={picked === index} onPress={() => setPicked(index)} />
            ))}
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
              Each episode uses the closest match: same server, quality and language.
            </AppText>
          </View>
        ) : (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
            {streamError ? `Could not load servers: ${streamError}. ` : 'No servers found for this episode. '}
            The first server found for each episode is used.
          </AppText>
        )}

        {progress ? (
          <AppText role="bodyMedium" style={{color: colors.primary, marginTop: 12}}>
            Queuing {progress.done} of {progress.total}…
          </AppText>
        ) : null}

        <View style={{flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 16}}>
          {existingRule && !progress ? (
            <Button variant="text" onPress={() => {
              removeSeriesRule(existingRule.id);
              toast('Stopped keeping episodes ready');
              onClose();
            }}>Turn off</Button>
          ) : null}
          <Button variant="text" onPress={cancel}>{progress ? 'Stop' : 'Cancel'}</Button>
          {mode === 'rolling' ? (
            <Button onPress={saveRule} hasTVPreferredFocus>{existingRule ? 'Save' : 'Start'}</Button>
          ) : (
            <Button onPress={startBatch} disabled={!targets.length || Boolean(progress) || streams === null} hasTVPreferredFocus>
              {`Download ${targets.length || ''}`.trim()}
            </Button>
          )}
        </View>
      </ScrollView>
    </MaterialDialogSurface>
  );
};

const SeasonDownloadActions = (props: Props) => {
  const kids = useIsKidsProfile();
  const [mode, setMode] = useState<Mode | null>(null);
  const [ruleOn, setRuleOn] = useState(() => Boolean(findSeriesRule(props.show.provider, props.show.infoUrl)));
  useEffect(() => {
    const update = () => setRuleOn(Boolean(findSeriesRule(props.show.provider, props.show.infoUrl)));
    update();
    return subscribeSeriesRules(update);
  }, [props.show.provider, props.show.infoUrl]);

  if (props.episodes.length < 2 && !ruleOn) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingVertical: 4}} style={{marginBottom: 8}}>
        <Chip icon="download-multiple" label="Download season" onPress={() => setMode('season')} />
        <Chip icon="download-outline" label="Download next" onPress={() => setMode('next')} />
        {kids ? null : (
          <Chip icon="playlist-check" label={ruleOn ? 'Next episodes: on' : 'Keep next ready'} selected={ruleOn} onPress={() => setMode('rolling')} />
        )}
      </ScrollView>
      {mode ? <SeasonDownloadDialog {...props} mode={mode} onClose={() => setMode(null)} /> : null}
    </>
  );
};

export default SeasonDownloadActions;
