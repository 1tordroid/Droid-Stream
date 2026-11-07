/**
 * Quality and language filters for Live TV and the TV guide. A "Filters"
 * chip opens rows of chips; each choice shows how many channels it gives.
 * Chips sit in horizontal rows, so the D-pad moves left and right along a
 * row and up and down between rows.
 */
import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, View, type HostInstance} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {
  activeFilterCount,
  hasFilterChoices,
  resetFilters,
  toggleLanguage,
  type ChannelFilters,
  type FilterCounts,
} from '../../lib/livetv/filters';
import {countryLabel, flagOf} from '../../lib/livetv/countries';
import {isTV} from '../../lib/tv';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {useM3Colors} from '../../theme/M3PaletteContext';

const focusLater = (ref: React.RefObject<HostInstance | null>) => {
  if (!isTV) return;
  setTimeout(() => requestTVFocusByHandle(getNodeHandle(ref.current)), 80);
};

/**
 * Small quality tag ("1080p"). It sits beside the channel's text, never on
 * the logo, so it does not hide part of it.
 */
export const QualityBadge = ({label}: {label: string}) => {
  const colors = useM3Colors();
  return (
    <View
      accessible={false}
      testID="quality-badge"
      style={{flexShrink: 0, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: colors.secondaryContainer}}>
      <AppText role="labelSmall" numberOfLines={1} style={{color: colors.onSecondaryContainer}}>{label}</AppText>
    </View>
  );
};

const Row = ({title, children}: {title: string; children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingTop: 8, alignItems: 'center'}}>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, minWidth: isTV ? 90 : 72}}>{title}</AppText>
      {children}
    </ScrollView>
  );
};

/** "🇬🇧 United Kingdom" for a country chip. */
export const countryChipLabel = (code: string) => `${flagOf(code)} ${countryLabel(code)}`;

/** Country codes of All countries, most channels first. */
export const countryChoices = (counts: FilterCounts, picked?: string): string[] => {
  const codes = [...counts.countries.keys()].sort((a, b) => (counts.countries.get(b) || 0) - (counts.countries.get(a) || 0) || countryLabel(a).localeCompare(countryLabel(b)));
  if (picked && !codes.includes(picked)) codes.unshift(picked);
  return codes;
};

const ChannelFilterBar = ({
  filters,
  counts,
  groups,
  countries,
  shown,
  total,
  onChange,
  onTouch,
}: {
  filters: ChannelFilters;
  counts: FilterCounts;
  /** When given, a Group row is shown in the panel too (the guide has no group chips of its own). */
  groups?: string[];
  /** When true, a Country row is shown in the panel too (All countries in the guide). */
  countries?: boolean;
  shown: number;
  total: number;
  onChange: (next: ChannelFilters) => void;
  /** Called when any chip is used, so the screen can stop moving TV focus to its list. */
  onTouch?: () => void;
}) => {
  const colors = useM3Colors();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HostInstance>(null);
  const firstRef = useRef<HostInstance>(null);
  const active = activeFilterCount(filters);
  const showGroups = !!groups && groups.length > 1;
  const countryCodes = countries ? countryChoices(counts, filters.country) : [];
  const showCountries = countryCodes.length > 1;

  useEffect(() => {
    if (open) focusLater(firstRef);
  }, [open]);

  if (!hasFilterChoices(counts) && !active && !showGroups && !showCountries) return null;

  const change = (next: ChannelFilters) => {
    onTouch?.();
    onChange(next);
  };
  const reset = () => {
    change(resetFilters(filters));
    // The Reset chip goes away; keep the D-pad on the Filters chip.
    focusLater(toggleRef);
  };

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingTop: 12, alignItems: 'center'}}>
        <Chip
          ref={toggleRef}
          label={active ? `Filters (${active})` : 'Filters'}
          icon="filter-variant"
          selected={open}
          accessibilityLabel={open ? 'Hide filters' : active ? `Filters, ${active} on` : 'Filters'}
          onPress={() => {
            onTouch?.();
            setOpen(value => !value);
          }}
        />
        {active ? <Chip label="Reset filters" icon="filter-remove-outline" onPress={reset} /> : null}
        {open ? (
          <Chip
            label="Quality badge"
            icon={filters.qualityBadge ? 'check' : undefined}
            selected={filters.qualityBadge}
            accessibilityLabel={filters.qualityBadge ? 'Quality badge on. Names hide tags like (1080p).' : 'Quality badge off. Names show tags like (1080p).'}
            onPress={() => change({...filters, qualityBadge: !filters.qualityBadge})}
          />
        ) : null}
        {active ? (
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
            {shown} of {total} channels
          </AppText>
        ) : null}
      </ScrollView>
      {open ? (
        <>
          {showCountries ? (
            <Row title="Country">
              <Chip
                ref={firstRef}
                label="All"
                count={counts.allCountries}
                selected={!filters.country}
                onPress={() => change({...filters, country: undefined})}
              />
              {countryCodes.map(code => (
                <Chip
                  key={code}
                  label={countryChipLabel(code)}
                  accessibilityLabel={`${countryLabel(code)}, ${counts.countries.get(code) || 0}`}
                  count={counts.countries.get(code) || 0}
                  selected={filters.country === code}
                  onPress={() => change({...filters, country: code})}
                />
              ))}
            </Row>
          ) : null}
          {counts.resolutions.length > 1 ? (
            <Row title="Quality">
              {counts.resolutions.map((option, index) => (
                <Chip
                  key={option.id}
                  ref={index === 0 && !showCountries ? firstRef : undefined}
                  label={option.label}
                  count={option.count}
                  selected={filters.resolution === option.id}
                  onPress={() => change({...filters, resolution: option.id})}
                />
              ))}
            </Row>
          ) : null}
          {counts.languages.length > 1 ? (
            <Row title="Language">
              {counts.languages.map((option, index) => (
                <Chip
                  key={option.id || 'all'}
                  ref={index === 0 && !showCountries && counts.resolutions.length <= 1 ? firstRef : undefined}
                  label={option.label}
                  count={option.count}
                  icon={option.id && filters.languages.includes(option.id) ? 'check' : undefined}
                  selected={option.id ? filters.languages.includes(option.id) : !filters.languages.length}
                  onPress={() => change(option.id ? toggleLanguage(filters, option.id) : {...filters, languages: []})}
                />
              ))}
            </Row>
          ) : null}
          {showGroups ? (
            <Row title="Group">
              <Chip
                ref={!showCountries && counts.resolutions.length <= 1 && counts.languages.length <= 1 ? firstRef : undefined}
                label="All"
                count={counts.allGroups}
                selected={!filters.group}
                onPress={() => change({...filters, group: undefined})}
              />
              {groups!.map(group => (
                <Chip
                  key={group}
                  label={group}
                  count={counts.groups.get(group) || 0}
                  selected={filters.group === group}
                  onPress={() => change({...filters, group})}
                />
              ))}
            </Row>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

export default ChannelFilterBar;
