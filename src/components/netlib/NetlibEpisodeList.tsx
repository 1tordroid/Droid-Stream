import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useMemo, useState} from 'react';
import {View} from 'react-native';
import {readLocalProgress} from '../../lib/localContent/progress';
import {isWatchedProgress} from '../../lib/netlib/history';
import {episodeLabel, playNetlibVersion} from '../../lib/netlib/playback';
import {netlibResume} from '../../lib/netlib/continueWatching';
import type {NetlibItem, NetlibVersion} from '../../lib/netlib/types';
import {formatBytes} from '../../lib/torrentSearch/util';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {EpisodeCardRow} from '../SeasonList';
import {TVFocusable} from '../tv';
import DropdownField from '../ui/DropdownField';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
import AppText from '../ui/Text';

const versionLabel = (version: NetlibVersion) =>
  [version.part ? `Part ${version.part}` : undefined, version.resolution, version.size ? formatBytes(version.size) : undefined].filter(Boolean).join(' · ') ||
  'Video file';

const watched = (key: string) => {
  const progress = readLocalProgress(key);
  return isWatchedProgress(progress.position, progress.duration);
};

const formatLeft = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min left` : `${minutes} min left`;
};

/** Info's body for a library title: play or resume, the files of a movie, or a show's episodes. */
export default function NetlibEpisodeList({item}: {item: NetlibItem}) {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const [, refresh] = useState(0);
  const [season, setSeason] = useState<number>();
  const [versionsOf, setVersionsOf] = useState<NetlibVersion[]>();
  useFocusEffect(useCallback(() => refresh(value => value + 1), []));

  const resume = netlibResume(item, readLocalProgress);
  const seasons = useMemo(() => [...new Set(item.episodes.map(episode => episode.season))].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b)), [item.episodes]);
  const resumeSeason = resume?.episode?.season;
  const activeSeason = season !== undefined && seasons.includes(season) ? season : resumeSeason ?? seasons[0];
  const episodes = item.episodes.filter(episode => episode.season === activeSeason);
  const play = (key: string) => playNetlibVersion(navigation, item, key);

  const playLabel = !resume ? 'Play' : resume.mode === 'resume' ? 'Resume' : resume.mode === 'next' ? 'Play next' : 'Play';
  const playDetail = resume
    ? [resume.episode ? episodeLabel(resume.episode) : undefined, resume.mode === 'resume' && resume.remainingSeconds ? formatLeft(resume.remainingSeconds) : undefined]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={{gap: 16}}>
      {resume ? (
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel={`${playLabel} ${playDetail}`.trim()}
          hasTVPreferredFocus={isTV}
          onPress={() => play(resume.key)}
          borderRadius={20}
          focusScale={1.02}
          style={{flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, backgroundColor: colors.primaryContainer}}>
          <MaterialCommunityIcons name="play-circle" size={36} color={colors.onPrimaryContainer} />
          <View style={{flex: 1}}>
            <AppText role="titleMedium" style={{color: colors.onPrimaryContainer}}>{playLabel}</AppText>
            {playDetail ? <AppText role="bodySmall" style={{color: colors.onPrimaryContainer}}>{playDetail}</AppText> : null}
          </View>
          {resume.progress ? (
            <View style={{width: 64, height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHighest, overflow: 'hidden'}}>
              <View style={{width: `${Math.round(resume.progress * 100)}%`, height: 4, backgroundColor: colors.primary}} />
            </View>
          ) : null}
        </TVFocusable>
      ) : null}

      {item.kind !== 'show' && item.versions.length > 1 ? (
        <View style={{gap: 8}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>Files</AppText>
          {item.versions.map(version => (
            <TVFocusable key={version.key} accessibilityRole="button" accessibilityLabel={`Play ${version.name}`} onPress={() => play(version.key)} borderRadius={16} focusScale={1}
              style={{flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surfaceContainer}}>
              <MaterialCommunityIcons name={watched(version.key) ? 'check-circle' : 'play-circle-outline'} size={24} color={colors.primary} />
              <View style={{flex: 1}}>
                <AppText role="bodyLarge" style={{color: colors.onSurface}}>{versionLabel(version)}</AppText>
                <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{version.name}</AppText>
              </View>
            </TVFocusable>
          ))}
        </View>
      ) : null}

      {item.kind === 'show' ? (
        <>
          {seasons.length > 1 ? (
            <DropdownField
              options={seasons}
              value={activeSeason}
              getKey={value => String(value)}
              getLabel={value => (value === 0 ? 'Specials' : `Season ${value}`)}
              onChange={setSeason}
              placeholder="Select season"
            />
          ) : null}
          {episodes.map((episode, index) => {
            const version = episode.versions[0];
            return (
              <EpisodeCardRow
                key={`${episode.season}x${episode.episode}`}
                item={{link: version.key, description: episode.versions.length > 1 ? `${episode.versions.length} files: ${episode.versions.map(versionLabel).join(', ')}` : version.name}}
                index={index}
                isFirst={index === 0}
                displayTitle={episodeLabel(episode)}
                primary={colors.primary}
                isCompleted={watched(version.key)}
                isSticky={false}
                onPress={() => play(version.key)}
                onLongPress={() => (episode.versions.length > 1 ? setVersionsOf(episode.versions) : undefined)}
              />
            );
          })}
        </>
      ) : null}

      <MaterialDialogSurface visible={Boolean(versionsOf)} onDismiss={() => setVersionsOf(undefined)}>
        <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 12}}>Choose a file</AppText>
        <View style={{gap: 8}}>
          {versionsOf?.map((version, index) => (
            <TVFocusable key={version.key} accessibilityRole="button" accessibilityLabel={`Play ${version.name}`} hasTVPreferredFocus={isTV && index === 0}
              onPress={() => {
                setVersionsOf(undefined);
                play(version.key);
              }}
              borderRadius={16} focusScale={1} style={{padding: 12, borderRadius: 16, backgroundColor: colors.surfaceContainerHighest}}>
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>{versionLabel(version)}</AppText>
              <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{version.name}</AppText>
            </TVFocusable>
          ))}
        </View>
      </MaterialDialogSurface>
    </View>
  );
}
