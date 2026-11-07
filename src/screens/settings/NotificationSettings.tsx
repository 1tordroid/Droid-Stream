/**
 * Settings > Notifications: new-episode alerts for the profile in use, the
 * time they arrive, and which shows alert.
 */
import React, {useEffect, useState} from 'react';
import {Switch, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {ALERT_TIME_CHOICES, alertsOnFor, alertTimeLabel} from '../../lib/calendar/alerts';
import {
  followedShows,
  readAlertSettings,
  readSavedCalendar,
  setAlertTime,
  setAlertsEnabled,
  setShowAlert,
  subscribeCalendar,
} from '../../lib/calendar/service';
import type {CalendarShow} from '../../lib/calendar/types';

const showsToList = (): CalendarShow[] => {
  const byKey = new Map<string, CalendarShow>();
  for (const show of [...followedShows(), ...(readSavedCalendar()?.shows || [])]) {
    const existing = byKey.get(show.key);
    byKey.set(show.key, existing ? {...existing, ...show, inWatchList: existing.inWatchList || show.inWatchList} : show);
  }
  return [...byKey.values()].sort((a, b) => Number(b.inWatchList) - Number(a.inWatchList) || a.title.localeCompare(b.title));
};

const NotificationSettings = () => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState(readAlertSettings);
  const [shows, setShows] = useState(showsToList);
  useEffect(
    () =>
      subscribeCalendar(() => {
        setSettings(readAlertSettings());
        setShows(showsToList());
      }),
    [],
  );

  const toggle = async (next: boolean) => {
    const ok = await setAlertsEnabled(next);
    if (!ok) {
      showAppDialog({title: 'Alerts are off', message: 'Allow notifications for Droid Stream in Android settings to get new-episode alerts.', actions: [{label: 'OK'}]});
    }
    setSettings(readAlertSettings());
  };

  return (
    <SettingsPage>
      <AppText key="title" role="headlineSmallEmphasized" style={{color: colors.onBackground, marginBottom: 12}}>Notifications</AppText>
      <SettingsSection key="alerts" title="New episodes">
        <SettingsSwitchRow
          title="New-episode alerts"
          description="A notification when a show in your watch list has a new episode. Uses the Calendar's air times."
          value={settings.enabled}
          onValueChange={value => {
            toggle(value).catch(() => undefined);
          }}
          divider={false}
        />
      </SettingsSection>
      {settings.enabled ? (
        <View key="time" style={{marginBottom: 20}}>
          <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>When to alert</AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            {ALERT_TIME_CHOICES.map(time => (
              <Chip key={time} label={alertTimeLabel(time)} selected={settings.time === time} onPress={() => setAlertTime(time)} />
            ))}
          </View>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 6}}>
            A set time alerts on the day the episode is out, or the day after when it airs later. Shows with a date only alert at 09:00.
          </AppText>
        </View>
      ) : null}
      {settings.enabled ? (
        <View key="shows">
          <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Shows</AppText>
          {shows.length ? (
            shows.map(show => {
              const on = alertsOnFor(show, settings);
              return (
                <TVFocusable
                  key={show.key}
                  accessibilityRole="switch"
                  accessibilityLabel={`Alerts for ${show.title}`}
                  accessibilityState={{checked: on}}
                  borderRadius={14}
                  onPress={() => setShowAlert(show.key, !on)}
                  style={{flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 6, borderRadius: 14, backgroundColor: colors.surfaceContainer}}>
                  <View style={{flex: 1, minWidth: 0}}>
                    <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>{show.title}</AppText>
                    <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                      {show.inWatchList ? 'Watch list' : show.fromContinueWatching ? 'Continue watching' : 'Trakt'}
                    </AppText>
                  </View>
                  <Switch value={on} onValueChange={value => setShowAlert(show.key, value)} focusable={false} />
                </TVFocusable>
              );
            })
          ) : (
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
              No shows yet. Add shows to your watch list, then open the Calendar.
            </AppText>
          )}
        </View>
      ) : null}
    </SettingsPage>
  );
};

export default NotificationSettings;
