import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useMemo, useState} from 'react';
import {ScrollView, ToastAndroid, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {listAddonCatalogs, type AddonCatalog} from '../../lib/addonRows/catalogs';
import {
  addRow,
  defaultRowTitle,
  MAX_ADDON_ROWS,
  MAX_ROW_NAME,
  moveRow,
  readRows,
  removeRow,
  renameRow,
  rowTitle,
  setRowHidden,
  writeRows,
  type AddonRow,
} from '../../lib/addonRows/rows';
import {hasAdultWords} from '../../lib/profiles/kids';
import useProfilesStore from '../../lib/profiles/useProfiles';
import {readAddons, type InstalledAddon} from '../../lib/stremio';
import {useM3Colors} from '../../theme/M3PaletteContext';
import SubpageHeader from './components/SubpageHeader';

const TYPE_LABEL = {movie: 'Movies', series: 'Shows'} as const;

const catalogKey = (catalog: AddonCatalog) => `${catalog.addonBase}|${catalog.type}|${catalog.id}`;

const filterLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Settings > Home rows: rows from Stremio add-on catalogs, per profile. */
export default function HomeRowsSettings() {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const profiles = useProfilesStore(state => state.profiles);
  const activeId = useProfilesStore(state => state.activeId);
  const [profileId, setProfileId] = useState(activeId);
  const profile = profiles.find(item => item.id === profileId);
  const kids = Boolean(profile?.kids);
  const [rows, setRows] = useState<AddonRow[]>(() => readRows(activeId));
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [renaming, setRenaming] = useState<{id: string; text: string}>();
  const [picked, setPicked] = useState<string>();
  const [extra, setExtra] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      setAddons(readAddons());
      setRows(readRows(profileId));
    }, [profileId]),
  );

  const catalogs = useMemo(() => listAddonCatalogs(addons, {kids}), [addons, kids]);
  const byAddon = useMemo(() => {
    const groups = new Map<string, AddonCatalog[]>();
    for (const catalog of catalogs) groups.set(catalog.addonBase, [...(groups.get(catalog.addonBase) || []), catalog]);
    return [...groups.values()];
  }, [catalogs]);
  const pickedCatalog = catalogs.find(catalog => catalogKey(catalog) === picked);

  const save = (next: AddonRow[]) => {
    setRows(next);
    writeRows(next, profileId);
  };

  const chooseProfile = (id: string) => {
    setProfileId(id);
    setRows(readRows(id));
    setRenaming(undefined);
    setPicked(undefined);
    setExtra({});
  };

  const add = (catalog: AddonCatalog) => {
    const result = addRow(rows, catalog, extra);
    if (result.reason === 'full') ToastAndroid.show(`Up to ${MAX_ADDON_ROWS} rows`, ToastAndroid.SHORT);
    else if (result.reason === 'exists') ToastAndroid.show(result.rows !== rows ? 'Row shown again' : 'That row is already there', ToastAndroid.SHORT);
    else if (result.reason === 'filters') ToastAndroid.show('Pick a filter first', ToastAndroid.SHORT);
    else ToastAndroid.show('Row added', ToastAndroid.SHORT);
    if (result.rows !== rows) save(result.rows);
    setPicked(undefined);
    setExtra({});
  };

  const addonName = (row: AddonRow) => addons.find(addon => addon.base === row.addonBase)?.manifest.name || row.addonName;
  const missing = (row: AddonRow) => !addons.some(addon => addon.base === row.addonBase && addon.enabled);

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: colors.background}}
      contentContainerStyle={{padding: 20, paddingBottom: 96}}
      keyboardShouldPersistTaps="handled">
      <SubpageHeader title="Home rows" subtitle="Rows from your Stremio add-ons. They show on Home after the provider and Top 10 rows." />

      {profiles.length > 1 ? (
        <>
          <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Profile</AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20}}>
            {profiles.map(item => (
              <Chip
                key={item.id}
                label={`${item.emoji} ${item.name}${item.kids ? ' (kids)' : ''}`}
                selected={item.id === profileId}
                onPress={() => chooseProfile(item.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Your rows</AppText>
      {rows.length ? (
        rows.map((row, index) => (
          <View key={row.id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginBottom: 10, padding: 14}}>
            <AppText role="titleMedium" numberOfLines={1} style={{color: row.hidden ? colors.onSurfaceVariant : colors.onSurface}}>
              {rowTitle(row)}
            </AppText>
            <AppText role="bodySmall" numberOfLines={1} style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              {[addonName(row), TYPE_LABEL[row.type], row.hidden ? 'Hidden' : '', missing(row) ? 'Add-on off or removed' : ''].filter(Boolean).join(' · ')}
            </AppText>
            {renaming?.id === row.id ? (
              <View style={{marginTop: 8}}>
                <TextInput
                  accessibilityLabel="Row name"
                  value={renaming.text}
                  onChangeText={text => setRenaming({id: row.id, text})}
                  onSubmitEditing={() => {
                    save(renameRow(rows, row.id, renaming.text));
                    setRenaming(undefined);
                  }}
                  maxLength={MAX_ROW_NAME}
                  placeholder={defaultRowTitle(row)}
                  placeholderTextColor={colors.outline}
                  autoFocus
                  style={{borderBottomWidth: 1, borderColor: colors.outlineVariant, color: colors.onSurface, minHeight: 44}}
                />
                <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
                  <Button
                    compact
                    onPress={() => {
                      save(renameRow(rows, row.id, renaming.text));
                      setRenaming(undefined);
                    }}>
                    Save
                  </Button>
                  <Button compact variant="tonal" onPress={() => setRenaming(undefined)}>Cancel</Button>
                </View>
              </View>
            ) : (
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10}}>
                {index > 0 ? <Chip label="Up" icon="arrow-up" accessibilityLabel={`Move ${rowTitle(row)} up`} onPress={() => save(moveRow(rows, row.id, -1))} /> : null}
                {index < rows.length - 1 ? <Chip label="Down" icon="arrow-down" accessibilityLabel={`Move ${rowTitle(row)} down`} onPress={() => save(moveRow(rows, row.id, 1))} /> : null}
                <Chip label="Rename" icon="pencil" onPress={() => setRenaming({id: row.id, text: row.name || ''})} />
                <Chip
                  label={row.hidden ? 'Show' : 'Hide'}
                  icon={row.hidden ? 'eye' : 'eye-off'}
                  onPress={() => save(setRowHidden(rows, row.id, !row.hidden))}
                />
                <Chip label="Remove" icon="delete-outline" tone="warn" onPress={() => save(removeRow(rows, row.id))} />
              </View>
            )}
          </View>
        ))
      ) : (
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 10}}>No rows yet. Add one below.</AppText>
      )}

      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8, marginTop: 14}}>Add a row</AppText>
      {kids ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
          Kids profile: adult add-ons are left out, and adult titles are hidden from rows.
        </AppText>
      ) : null}
      {byAddon.length ? (
        byAddon.map(group => (
          <View key={group[0].addonBase} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, marginBottom: 10, padding: 14}}>
            <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface, marginBottom: 8}}>{group[0].addonName}</AppText>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
              {group.map(catalog => (
                <Chip
                  key={catalogKey(catalog)}
                  label={`${catalog.name} · ${TYPE_LABEL[catalog.type]}`}
                  selected={picked === catalogKey(catalog)}
                  onPress={() => {
                    if (!catalog.filters.length) {
                      add(catalog);
                      return;
                    }
                    setPicked(picked === catalogKey(catalog) ? undefined : catalogKey(catalog));
                    setExtra({});
                  }}
                />
              ))}
            </View>
            {pickedCatalog && pickedCatalog.addonBase === group[0].addonBase ? (
              <View style={{marginTop: 12}}>
                {pickedCatalog.filters.map(filter => (
                  <View key={filter.name} style={{marginBottom: 10}}>
                    <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>
                      {filterLabel(filter.name)}{filter.required ? '' : ' (optional)'}
                    </AppText>
                    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                      {filter.options
                        .filter(option => !kids || !hasAdultWords(option))
                        .map(option => (
                          <Chip
                            key={option}
                            label={option}
                            selected={extra[filter.name] === option}
                            onPress={() =>
                              setExtra(current => {
                                const next = {...current};
                                if (next[filter.name] === option) delete next[filter.name];
                                else next[filter.name] = option;
                                return next;
                              })
                            }
                          />
                        ))}
                    </View>
                  </View>
                ))}
                <View style={{flexDirection: 'row', gap: 8}}>
                  <Button
                    compact
                    disabled={pickedCatalog.filters.some(filter => filter.required && !extra[filter.name])}
                    onPress={() => add(pickedCatalog)}>
                    Add row
                  </Button>
                  <Button compact variant="tonal" onPress={() => setPicked(undefined)}>Cancel</Button>
                </View>
              </View>
            ) : null}
          </View>
        ))
      ) : (
        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 14}}>
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>
            None of your add-ons have movie or show catalogs. Add one, such as Cinemeta.
          </AppText>
          <View style={{flexDirection: 'row', marginTop: 10}}>
            <Button
              compact
              variant="tonal"
              onPress={() => (navigation.getParent() ?? navigation).navigate('TorrentsStack', {screen: 'StremioAddons', initial: false})}>
              Stremio add-ons
            </Button>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
