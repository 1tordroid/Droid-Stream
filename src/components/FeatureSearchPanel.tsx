import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useMemo, useState} from 'react';
import {Pressable, View} from 'react-native';
import {RawTextInput as TextInput} from './ui/Text';
import {alwaysShowAdvanced, useFeatureVisible} from '../lib/advancedReveal';
import {searchFeatures, type FeatureHit} from '../lib/featureRegistry';
import {openFeature} from '../lib/openFeature';
import {settingsStorage} from '../lib/storage';
import {useM3Colors} from '../theme/M3PaletteContext';
import {TVFocusable} from './tv';
import AppText from './ui/Text';

const FeatureSearchPanel = ({initialQuery = '', autoFocus = false}: {initialQuery?: string; autoFocus?: boolean}) => {
  const colors = useM3Colors();
  const [query, setQuery] = useState(initialQuery);
  const hits = useMemo(() => searchFeatures(query).slice(0, 30), [query]);
  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        autoFocus={autoFocus}
        placeholder="Search settings and features"
        placeholderTextColor={colors.onSurfaceVariant}
        accessibilityLabel="Search settings and features"
        style={{color: colors.onSurface, backgroundColor: colors.surfaceContainerHigh, borderRadius: 16, minHeight: 52, paddingHorizontal: 16, marginBottom: 12}}
      />
      {query.trim().length > 0 && hits.length === 0 ? (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>No matching setting. Try vpn, subtitles, or smb.</AppText>
      ) : null}
      {hits.map(hit => (
        <FeatureHitRow key={hit.entry.id} hit={hit} />
      ))}
    </View>
  );
};

const FeatureHitRow = ({hit}: {hit: FeatureHit}) => {
  const colors = useM3Colors();
  const visible = useFeatureVisible(hit.entry.id);
  const showAdvanced = Boolean(hit.entry.advanced && !settingsStorage.isAdvancedMode());
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={`${hit.entry.title}. ${hit.entry.subtitle}`}
      onPress={() => openFeature(hit.entry)}
      style={{minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12}}>
      <MaterialCommunityIcons name={hit.entry.icon as any} size={24} color={colors.primary} />
      <View style={{flex: 1}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <AppText role="titleMedium" style={{color: colors.onSurface}}>{hit.entry.title}</AppText>
          {showAdvanced ? <AppText role="labelMedium" style={{color: colors.primary}}>Advanced</AppText> : null}
        </View>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{hit.entry.category} · {hit.entry.subtitle}</AppText>
        {showAdvanced && visible ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Always show advanced options" onPress={alwaysShowAdvanced} style={{minHeight: 44, justifyContent: 'center'}}>
            <AppText style={{color: colors.primary}}>Always show advanced options</AppText>
          </Pressable>
        ) : null}
      </View>
    </TVFocusable>
  );
};

export default FeatureSearchPanel;
