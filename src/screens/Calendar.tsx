/**
 * Calendar: upcoming and recent episodes of the shows in the watch list,
 * Continue watching and (when signed in) Trakt, grouped by day in local time.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, SectionList, ToastAndroid, View} from 'react-native';
import Chip from '../components/torrentSearch/Chip';
import LoadingIndicator from '../components/ui/LoadingIndicator';
import AppText from '../components/ui/Text';
import {TVFocusable} from '../components/tv';
import {isTV} from '../lib/tv';
import {useM3Colors} from '../theme/M3PaletteContext';
import {useIsKidsProfile} from '../lib/profiles/useProfiles';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import {episodeCode, formatAirTime, groupCalendar, type CalendarDay} from '../lib/calendar/group';
import {alertsOnFor, alertTimeLabel} from '../lib/calendar/alerts';
import {
  readAlertSettings,
  readSavedCalendar,
  refreshCalendar,
  setAlertsEnabled,
  setShowAlert,
  subscribeCalendar,
  type SavedCalendar,
} from '../lib/calendar/service';
import type {CalendarEpisode} from '../lib/calendar/types';
import {cachedTraktPoster, findTraktPoster} from '../lib/watchSync/traktPosters';
import {TMDB_NOTICE} from './settings/creditsData';

const SOURCE_NAMES = {trakt: 'Trakt', tvmaze: 'TVmaze (CC BY-SA 4.0)', cinemeta: 'Cinemeta', tmdb: 'TMDB'} as const;

const Poster = ({episode}: {episode: CalendarEpisode}) => {
  const colors = useM3Colors();
  const lookup = episode.open.kind === 'finder' && !episode.poster ? {type: 'series' as const, imdbId: episode.open.imdbId} : undefined;
  const [found, setFound] = useState(() => (lookup?.imdbId ? cachedTraktPoster(lookup) : undefined));
  useEffect(() => {
    if (!lookup?.imdbId || found !== undefined) return;
    let alive = true;
    findTraktPoster(lookup)
      .then(url => alive && setFound(url || ''))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lookup?.imdbId]);
  const uri = episode.poster || found || undefined;
  const size = {width: isTV ? 60 : 48, height: isTV ? 90 : 72, borderRadius: 8};
  return uri ? (
    <Image source={{uri}} style={{...size, backgroundColor: colors.surfaceContainerHigh}} />
  ) : (
    <View style={{...size, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh}}>
      <MaterialCommunityIcons name="television-play" size={22} color={colors.onSurfaceVariant} />
    </View>
  );
};

const Calendar = ({navigation}: {navigation: any}) => {
  const colors = useM3Colors();
  const kids = useIsKidsProfile();
  const [calendar, setCalendar] = useState<SavedCalendar | undefined>(readSavedCalendar);
  const [settings, setSettings] = useState(readAlertSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    refreshCalendar()
      .then(setCalendar)
      .catch(failure => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      subscribeCalendar(() => {
        setCalendar(readSavedCalendar());
        setSettings(readAlertSettings());
      }),
    [],
  );

  // A calendar older than an hour loads again when the screen opens.
  useFocusEffect(
    useCallback(() => {
      const saved = readSavedCalendar();
      if (!saved || Date.now() - saved.at > 60 * 60 * 1000) load();
    }, [load]),
  );

  const sections = useMemo(() => {
    if (!calendar) return [];
    return groupCalendar(calendar.episodes, Date.now()).map(section => ({title: section.title, key: section.key, data: section.days}));
  }, [calendar]);
  const showByKey = useMemo(() => new Map((calendar?.shows || []).map(show => [show.key, show])), [calendar]);

  const open = (episode: CalendarEpisode) => {
    if (episode.open.kind === 'info') {
      navigation.navigate('Info', {link: episode.open.link, provider: episode.open.provider, poster: episode.open.poster});
      return;
    }
    if (kids) {
      ToastAndroid.show('Search for this show to watch it', ToastAndroid.SHORT);
      return;
    }
    const {title, imdbId, year, poster, season, episode: number} = episode.open;
    const params = {title, imdbId, year, poster, season, episode: number, type: 'series'};
    (navigation.getParent?.() ?? navigation).navigate('TorrentsStack', {screen: 'StreamFinder', initial: false, params});
  };

  const showMenu = (episode: CalendarEpisode) => {
    const show = showByKey.get(episode.showKey);
    if (!show) return;
    const on = alertsOnFor(show, settings);
    showAppDialog({
      title: episode.showTitle,
      message: settings.enabled
        ? on
          ? 'You get an alert when a new episode is out.'
          : 'No alerts for this show.'
        : 'New-episode alerts are off. Turn them on at the top of the calendar.',
      actions: [
        {label: 'Close'},
        ...(settings.enabled ? [{label: on ? 'Mute alerts' : 'Alert me', onPress: () => setShowAlert(show.key, !on)}] : []),
        {label: 'Open', onPress: () => open(episode)},
      ],
    });
  };

  const toggleAlerts = async () => {
    const ok = await setAlertsEnabled(!settings.enabled);
    if (!ok) {
      showAppDialog({title: 'Alerts are off', message: 'Allow notifications for Droid Stream in Android settings to get new-episode alerts.', actions: [{label: 'OK'}]});
      return;
    }
    setSettings(readAlertSettings());
    ToastAndroid.show(settings.enabled ? 'New-episode alerts off' : 'New-episode alerts on for your watch list', ToastAndroid.SHORT);
  };

  const renderDay = ({item}: {item: CalendarDay}) => (
    <View style={{marginBottom: 12}}>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>{item.label}</AppText>
      {item.items.map(episode => {
        const show = showByKey.get(episode.showKey);
        const muted = settings.enabled && show ? !alertsOnFor(show, settings) : false;
        return (
          <TVFocusable
            key={episode.id}
            accessibilityRole="button"
            accessibilityLabel={`${episode.showTitle} ${episodeCode(episode.season, episode.episode)}${episode.title ? ` ${episode.title}` : ''}`}
            borderRadius={14}
            onPress={() => open(episode)}
            onLongPress={() => showMenu(episode)}
            style={{flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 6, borderRadius: 14, backgroundColor: colors.surfaceContainer}}>
            <Poster episode={episode} />
            <View style={{flex: 1, minWidth: 0}}>
              <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>{episode.showTitle}</AppText>
              <AppText role="bodyMedium" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
                {episodeCode(episode.season, episode.episode)}
                {episode.title ? ` · ${episode.title}` : ''}
              </AppText>
            </View>
            <View style={{alignItems: 'flex-end', gap: 4}}>
              <AppText role="labelLarge" style={{color: colors.primary}}>{episode.timeKnown ? formatAirTime(episode.airsAt) : 'All day'}</AppText>
              {muted ? <MaterialCommunityIcons name="bell-off-outline" size={16} color={colors.onSurfaceVariant} /> : null}
            </View>
          </TVFocusable>
        );
      })}
    </View>
  );

  const credit = calendar?.sources.length
    ? `Episode data: ${calendar.sources.map(source => SOURCE_NAMES[source]).join(', ')}.${calendar.sources.includes('tmdb') ? ` ${TMDB_NOTICE}` : ''}`
    : 'Episode data: TVmaze (CC BY-SA 4.0), Cinemeta, Trakt and TMDB.';

  return (
    <SectionList
      style={{flex: 1, backgroundColor: colors.background}}
      contentContainerStyle={{padding: 16, paddingBottom: 96}}
      sections={sections}
      keyExtractor={item => String(item.day)}
      renderItem={renderDay}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({section}) => (
        <AppText role="titleLargeEmphasized" style={{color: colors.onBackground, marginTop: 12, marginBottom: 8}}>{section.title}</AppText>
      )}
      ListHeaderComponent={
        <View>
          <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Calendar</AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
            New episodes of shows in your watch list and Continue watching{calendar?.sources.includes('trakt') ? ', and on Trakt' : ''}. Times are local.
          </AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12}}>
            <Chip icon="refresh" label="Refresh" onPress={load} />
            <Chip
              icon={settings.enabled ? 'bell-ring-outline' : 'bell-off-outline'}
              label={settings.enabled ? `Alerts on · ${alertTimeLabel(settings.time)}` : 'Alerts off'}
              selected={settings.enabled}
              onPress={toggleAlerts}
            />
            {kids ? null : (
              <Chip
                icon="cog-outline"
                label="Alert settings"
                onPress={() => (navigation.getParent?.() ?? navigation).navigate('SettingsStack', {screen: 'NotificationSettings', initial: false})}
              />
            )}
          </View>
          {loading ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12}}>
              <LoadingIndicator />
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Checking for new episodes…</AppText>
            </View>
          ) : null}
          {error ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>{error}</AppText> : null}
          {calendar?.traktError ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>Trakt: {calendar.traktError}</AppText> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? undefined : (
          <View style={{alignItems: 'center', paddingVertical: 48, gap: 8}}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={40} color={colors.onSurfaceVariant} />
            <AppText role="titleMedium" style={{color: colors.onSurface}}>No episodes this week</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, textAlign: 'center'}}>
              Add shows to your watch list, or open a show once so the app knows it. Signed in to Trakt? Its shows appear here too.
            </AppText>
          </View>
        )
      }
      ListFooterComponent={
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 16}}>
          {credit}
        </AppText>
      }
    />
  );
};

export default Calendar;
