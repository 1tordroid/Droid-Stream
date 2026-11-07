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
import {isTV} from '../../lib/tv';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {useM3Colors} from '../../theme/M3PaletteContext';

const focusLater = (ref: React.RefObject<HostInstance | null>) => {
  if (!isTV) return;
  setTimeout(() => requestTVFocusByHandle(getNodeHandle(ref.current)), 80);
};

/** Small quality label on a channel logo. */
export const QualityBadge = ({label}: {label: string}) => {
  const colors = useM3Colors();
  return (
    <View
      accessible={false}
      style={{position: 'absolute', left: 4, bottom: 4, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: colors.secondaryContainer}}>
      <AppText role="labelSmall" style={{color: colors.onSecondaryContainer}}>{label}</AppText>
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

const ChannelFilterBar = ({
  filters,
  counts,
  groups,
  shown,
  total,
  onChange,
  onTouch,
}: {
  filters: ChannelFilters;
  counts: FilterCounts;
  /** When given, a Group row is shown in the panel too (the guide has no group chips of its own). */
  groups?: string[];
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

  useEffect(() => {
    if (open) focusLater(firstRef);
  }, [open]);

  if (!hasFilterChoices(counts) && !active && !showGroups) return null;

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
          {counts.resolutions.length > 1 ? (
            <Row title="Quality">
              {counts.resolutions.map((option, index) => (
                <Chip
                  key={option.id}
                  ref={index === 0 ? firstRef : undefined}
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
                  ref={index === 0 && counts.resolutions.length <= 1 ? firstRef : undefined}
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
                ref={counts.resolutions.length <= 1 && counts.languages.length <= 1 ? firstRef : undefined}
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
