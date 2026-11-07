/**
 * "Series downloads" in Downloads: each show that keeps its next episodes
 * ready, with its progress, and the Wi-Fi and free space limits.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import React, {useEffect, useState} from 'react';
import {Image, View} from 'react-native';
import Chip from '../../../components/torrentSearch/Chip';
import Button from '../../../components/ui/Button';
import MaterialDialogSurface from '../../../components/ui/MaterialDialogSurface';
import AppText from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {MAX_KEEP, MIN_KEEP, rollingStatusText} from '../../../lib/seriesDownloads/rolling';
import {
  FREE_SPACE_CHOICES,
  readSeriesRules,
  readSeriesSettings,
  removeSeriesRule,
  subscribeSeriesRules,
  updateSeriesRule,
  writeSeriesSettings,
  type SeriesRule,
} from '../../../lib/seriesDownloads/rules';
import {describeChoice} from '../../../lib/seriesDownloads/sourceChoice';

// The runner loads providers; it is only needed once a button is pressed.
const runSeriesDownloads = (): Promise<void> =>
  (require('../../../lib/seriesDownloads/runner') as typeof import('../../../lib/seriesDownloads/runner')).runSeriesDownloads();

const KEEP_COUNTS = Array.from({length: MAX_KEEP - MIN_KEEP + 1}, (_, index) => MIN_KEEP + index);

const EditRuleDialog = ({rule, onClose}: {rule: SeriesRule; onClose: () => void}) => {
  const colors = useM3Colors();
  const [keep, setKeep] = useState(rule.keep);
  const [deleteAfter, setDeleteAfter] = useState(rule.deleteAfterWatching);
  return (
    <MaterialDialogSurface visible onDismiss={onClose}>
      <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 4}}>{rule.showTitle}</AppText>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>{describeChoice(rule.choice)}</AppText>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Episodes to keep</AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
        {KEEP_COUNTS.map(count => (
          <Chip key={count} label={String(count)} accessibilityLabel={`Keep ${count}`} selected={keep === count} onPress={() => setKeep(count)} />
        ))}
      </View>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Delete after watching</AppText>
      <View style={{flexDirection: 'row', gap: 8, marginBottom: 16}}>
        <Chip label="Off" selected={!deleteAfter} onPress={() => setDeleteAfter(false)} />
        <Chip label="On" selected={deleteAfter} onPress={() => setDeleteAfter(true)} />
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
        <Button variant="text" onPress={onClose}>Cancel</Button>
        <Button
          hasTVPreferredFocus
          onPress={() => {
            updateSeriesRule(rule.id, {keep, deleteAfterWatching: deleteAfter, updatedAt: Date.now()});
            runSeriesDownloads().catch(() => undefined);
            onClose();
          }}>
          Save
        </Button>
      </View>
    </MaterialDialogSurface>
  );
};

const RuleCard = ({rule, onEdit}: {rule: SeriesRule; onEdit: (rule: SeriesRule) => void}) => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const total = rule.lastTotal ?? rule.keep;
  const ready = rule.lastReady ?? 0;
  const status = rule.paused ? 'paused' : rule.lastStatus;
  const remove = () =>
    showAppDialog({
      title: 'Stop keeping episodes ready?',
      message: `${rule.showTitle}: downloaded episodes stay in Downloads.`,
      actions: [
        {label: 'Cancel'},
        {label: 'Remove', variant: 'destructive', onPress: () => removeSeriesRule(rule.id)},
      ],
    });
  return (
    <View style={{flexDirection: 'row', gap: 12, padding: 12, marginBottom: 8, borderRadius: 16, backgroundColor: colors.surfaceContainer}}>
      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel={`Open ${rule.showTitle}`}
        borderRadius={10}
        onPress={() => navigation.navigate('Info', {link: rule.infoUrl, provider: rule.provider, poster: rule.poster})}>
        {rule.poster ? (
          <Image source={{uri: rule.poster}} style={{width: 56, height: 84, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh}} />
        ) : (
          <View style={{width: 56, height: 84, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh}}>
            <MaterialCommunityIcons name="television-play" size={24} color={colors.onSurfaceVariant} />
          </View>
        )}
      </TVFocusable>
      <View style={{flex: 1, minWidth: 0}}>
        <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>{rule.showTitle}</AppText>
        <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>
          {`Keeps ${rule.keep} · ${rule.seasonTitle}${rule.deleteAfterWatching ? ' · deletes watched' : ''}`}
        </AppText>
        <AppText role="bodySmall" numberOfLines={2} style={{color: status === 'low-storage' || rule.lastError ? colors.error : colors.primary, marginTop: 2}}>
          {rollingStatusText(status, ready, total)}
          {rule.lastError && status !== 'paused' ? ` · ${rule.lastError}` : ''}
        </AppText>
        <View style={{height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHighest, marginTop: 6, overflow: 'hidden'}}>
          <View style={{height: 4, width: `${total ? Math.round((ready / total) * 100) : 0}%`, backgroundColor: colors.primary}} />
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8}}>
          <Chip
            icon={rule.paused ? 'play' : 'pause'}
            label={rule.paused ? 'Resume' : 'Pause'}
            onPress={() => {
              updateSeriesRule(rule.id, {paused: !rule.paused});
              if (rule.paused) runSeriesDownloads().catch(() => undefined);
            }}
          />
          <Chip icon="pencil-outline" label="Edit" onPress={() => onEdit(rule)} />
          <Chip icon="delete-outline" label="Remove" onPress={remove} />
        </View>
      </View>
    </View>
  );
};

const SeriesDownloadsSection = () => {
  const colors = useM3Colors();
  const [rules, setRules] = useState(readSeriesRules);
  const [settings, setSettings] = useState(readSeriesSettings);
  const [editing, setEditing] = useState<SeriesRule | null>(null);
  useEffect(
    () =>
      subscribeSeriesRules(() => {
        setRules(readSeriesRules());
        setSettings(readSeriesSettings());
      }),
    [],
  );
  if (!rules.length) return null;
  return (
    <View style={{marginBottom: 20}}>
      <AppText role="titleLargeEmphasized" style={{color: colors.onBackground, marginBottom: 4}}>Series downloads</AppText>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 10}}>
        Keeps the next episodes downloaded. Checks when the app opens, after you watch, and while downloads run.
      </AppText>
      {rules.map(rule => (
        <RuleCard key={rule.id} rule={rule} onEdit={setEditing} />
      ))}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4}}>
        <Chip
          icon="wifi"
          label={settings.wifiOnly ? 'Wi-Fi only' : 'Any network'}
          selected={settings.wifiOnly}
          accessibilityLabel={settings.wifiOnly ? 'Wi-Fi only, on' : 'Wi-Fi only, off'}
          onPress={() => writeSeriesSettings({wifiOnly: !settings.wifiOnly})}
        />
        <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginLeft: 4}}>Stop below</AppText>
        {FREE_SPACE_CHOICES.map(gb => (
          <Chip key={gb} label={`${gb} GB`} accessibilityLabel={`Stop below ${gb} GB free`} selected={settings.minFreeGb === gb} onPress={() => writeSeriesSettings({minFreeGb: gb})} />
        ))}
      </View>
      {editing ? <EditRuleDialog rule={editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
};

export default SeriesDownloadsSection;
