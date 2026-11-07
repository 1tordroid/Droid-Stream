import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useMemo, useRef, useState} from 'react';
import {FlatList, View, type TextInputInstance} from 'react-native';
import {TVFocusable} from '../../components/tv';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {isTV} from '../../lib/tv';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {ALL_COUNTRIES, countryPickerRows, flagOf, INDIA, type Country} from '../../lib/livetv/countries';
import {allCountryCounts} from '../../lib/livetv/allCountries';
import {DETECTED_FROM, type DetectedCountry} from '../../lib/livetv/deviceCountry';
import {worldChannelCounts} from '../../lib/livetv/store';
import {worldSourceId} from '../../lib/livetv/world';
import {useM3Colors} from '../../theme/M3PaletteContext';

const countLabel = (count: number | undefined) =>
  count === undefined ? undefined : count === 0 ? 'No free channels' : count === 1 ? '1 channel' : `${count} channels`;

/**
 * Searchable country list for the World source. The detected country is
 * first, then All countries, then recent picks and the rest by name.
 */
const CountryPicker = ({detected, current, recent, header, onPick}: {
  detected?: DetectedCountry;
  /** The country shown now (upper-case code). */
  current?: string;
  recent: string[];
  header: React.ReactElement;
  onPick: (code: string) => void;
}) => {
  const colors = useM3Colors();
  const [query, setQuery] = useState('');
  const firstRow = useRef<React.ComponentRef<typeof TVFocusable>>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const countries = useMemo(() => countryPickerRows(query, {detected: detected?.code, recent}), [query, detected?.code, recent]);
  // Counts from countries opened before, else from the last All countries list.
  const counts = useMemo(() => worldChannelCounts(), []);
  const allCounts = useMemo(() => allCountryCounts(), []);
  const allKnown = Object.keys(allCounts).length > 0;
  const recentSet = useMemo(() => new Set(recent), [recent]);

  const subtitle = (country: Country) => {
    if (country.code === ALL_COUNTRIES) return 'Every country in one list';
    const parts: string[] = [];
    if (country.code === detected?.code) parts.push(DETECTED_FROM[detected.from][0].toUpperCase() + DETECTED_FROM[detected.from].slice(1));
    else if (recentSet.has(country.code)) parts.push('Recent');
    if (country.code === INDIA) parts.push('Opens Free Indian channels');
    else {
      const id = worldSourceId(country.code);
      const count = countLabel(id && id in counts ? counts[id] : allKnown ? allCounts[country.code] || 0 : undefined);
      if (count) parts.push(count);
    }
    return parts.join(' · ');
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
      <FlatList
        data={countries}
        keyExtractor={item => item.code}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{paddingBottom: 96}}
        initialNumToRender={20}
        windowSize={9}
        ListHeaderComponent={
          <View>
            {header}
            <View style={{paddingHorizontal: isTV ? 40 : 12, paddingBottom: 8}}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>Change country</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4, marginBottom: 8}}>
                Free channels listed by iptv-org for each country.
              </AppText>
              <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 28, minHeight: 48, paddingHorizontal: 16}}>
                <MaterialCommunityIcons name="magnify" size={22} color={colors.onSurfaceVariant} />
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search countries"
                  placeholderTextColor={colors.onSurfaceVariant}
                  accessibilityLabel="Search countries"
                  autoCorrect={false}
                  returnKeyType="search"
                  // On TV, Done moves focus to the first result.
                  onSubmitEditing={() => requestTVFocusByHandle(getNodeHandle(firstRow.current))}
                  style={{flex: 1, color: colors.onSurface, marginLeft: 8, fontSize: 16}}
                />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, paddingHorizontal: isTV ? 40 : 12}}>No country matches.</AppText>
        }
        renderItem={({item, index}) => {
          const selected = item.code === current;
          const details = subtitle(item);
          return (
            <TVFocusable
              ref={index === 0 ? firstRow : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${details ? `, ${details}` : ''}`}
              accessibilityState={{selected}}
              hasTVPreferredFocus={index === 0 && !query}
              onPress={() => onPick(item.code)}
              borderRadius={12}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginHorizontal: isTV ? 40 : 12,
                marginVertical: 3,
                paddingHorizontal: 14,
                minHeight: 56,
                borderRadius: 12,
                backgroundColor: selected ? colors.secondaryContainer : colors.surfaceContainer,
              }}>
              <AppText role="titleLarge" style={{marginRight: 12}}>{flagOf(item.code)}</AppText>
              <View style={{flex: 1, paddingVertical: 8}}>
                <AppText role="bodyLarge" numberOfLines={1} style={{color: selected ? colors.onSecondaryContainer : colors.onSurface}}>{item.name}</AppText>
                {details ? (
                  <AppText role="bodySmall" numberOfLines={1} style={{color: selected ? colors.onSecondaryContainer : colors.onSurfaceVariant}}>{details}</AppText>
                ) : null}
              </View>
              {selected ? <MaterialCommunityIcons name="check" size={20} color={colors.onSecondaryContainer} /> : null}
            </TVFocusable>
          );
        }}
      />
    </View>
  );
};

export default CountryPicker;
