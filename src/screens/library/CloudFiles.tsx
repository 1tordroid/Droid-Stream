import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {CardListSkeleton} from '../../components/PosterRowSkeleton';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {TVFocusable} from '../../components/tv';
import {connectedServices, debridKey, pickVideo} from '../../lib/debrid';
import {listCloudSources} from '../../lib/netlib/cloud';
import type {DebridService, DebridTransfer} from '../../lib/debrid/types';
import {downloadDebridFiles, playDebridFile, toast} from '../../lib/torrentSearch/actions';
import {formatBytes} from '../../lib/torrentSearch/util';
import {useM3Colors} from '../../theme/M3PaletteContext';

type ServiceState = {loading: boolean; error?: string; items: DebridTransfer[]};

const MAX_ITEMS = 100;

/** Files in PikPak and every connected debrid service, inside Library: poster libraries, or the plain list. */
const CloudFiles = ({navigation, route}: {navigation: any; route?: {params?: {mode?: 'list'}}}) => {
  const colors = useM3Colors();
  const [mode, setMode] = useState<'posters' | 'list'>(route?.params?.mode === 'list' ? 'list' : 'posters');
  const [cloud, setCloud] = useState(() => listCloudSources());
  const [services] = useState<DebridService[]>(() => connectedServices().filter(service => service.list));
  const [state, setState] = useState<Record<string, ServiceState>>({});

  const load = useCallback((service: DebridService) => {
    setState(current => ({...current, [service.id]: {loading: true, items: current[service.id]?.items || []}}));
    service.list!(debridKey(service.id))
      .then(items => setState(current => ({...current, [service.id]: {loading: false, items: items.slice(0, MAX_ITEMS)}})))
      .catch(error => setState(current => ({...current, [service.id]: {loading: false, error: error?.message || 'Could not load files', items: []}})));
  }, []);

  useFocusEffect(useCallback(() => {
    setCloud(listCloudSources());
    if (mode === 'list') services.forEach(load);
  }, [load, services, mode]));

  // Opened again with List view from a cloud library.
  useEffect(() => {
    if (route?.params?.mode === 'list') setMode('list');
  }, [route?.params?.mode]);

  // Listings often leave out the files, so they are fetched when needed.
  const withFiles = async (service: DebridService, transfer: DebridTransfer) =>
    transfer.files.length ? transfer : service.status(debridKey(service.id), transfer.id);

  const play = async (service: DebridService, transfer: DebridTransfer) => {
    try {
      const full = await withFiles(service, transfer);
      const video = pickVideo(full.files) || full.files.slice().sort((a, b) => b.size - a.size)[0];
      if (!video) throw new Error('No video in this item');
      await playDebridFile({service, transfer: full, files: full.files}, video, navigation, full.name);
    } catch (error: any) {
      toast(error?.message || 'Could not play this file');
    }
  };

  const download = async (service: DebridService, transfer: DebridTransfer) => {
    try {
      const full = await withFiles(service, transfer);
      const count = await downloadDebridFiles({service, transfer: full, files: full.files}, full.files);
      toast(`${count} ${count === 1 ? 'file' : 'files'} added to Downloads`);
    } catch (error: any) {
      toast(error?.message || 'Could not download this file');
    }
  };

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Cloud files</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        Files in PikPak and your debrid services. Play them at once or save them to this phone.
      </AppText>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
        <Chip label="Posters" icon="view-grid-outline" accessibilityLabel="Poster view" selected={mode === 'posters'} onPress={() => setMode('posters')} />
        <Chip label="List" icon="format-list-bulleted" accessibilityLabel="List view" selected={mode === 'list'} onPress={() => setMode('list')} />
      </View>
      {mode === 'posters' ? cloud.map(source => (
        <TVFocusable key={source.id} accessibilityRole="button" accessibilityLabel={`Open ${source.name}`} borderRadius={16} onPress={() => navigation.navigate('SourceLibrary', {sourceId: source.id})}
          style={{flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: 14, marginTop: 8, borderRadius: 16, backgroundColor: colors.surfaceContainer}}>
          <MaterialCommunityIcons name={source.kind === 'tdplus' ? 'account-group-outline' : source.kind === 'pikpak' ? 'cloud-download-outline' : 'lightning-bolt-outline'} size={24} color={colors.primary} />
          <View style={{flex: 1, marginLeft: 14}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>{source.name}</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{source.kind === 'debrid' ? 'Each transfer is a folder. Posters, shows and movies.' : 'Folders, posters, shows and movies.'}</AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
        </TVFocusable>
      )) : null}

      {!services.length && !cloud.length ? (
        <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 16, marginTop: 16}}>
          <MaterialCommunityIcons name="cloud-off-outline" size={32} color={colors.onSurfaceVariant} />
          <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 8}}>No cloud account connected</AppText>
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
            Sign in to PikPak, or add a TorBox, Real-Debrid, or other debrid key, and its files appear here.
          </AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12}}>
            <Chip label="Sign in to PikPak" icon="login" onPress={() => navigation.navigate('Sources', {kind: 'pikpak'})} />
            <Chip label="Add a debrid key" icon="key-outline" onPress={() => navigation.navigate('DebridSettings')} />
          </View>
        </View>
      ) : null}

      {mode === 'list' ? services.map(service => {
        const current = state[service.id];
        return (
          <View key={service.id} style={{marginTop: 20}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <AppText role="titleMedium" style={{color: colors.primary, flex: 1}}>{service.name}</AppText>
              <TVFocusable accessibilityRole="button" accessibilityLabel={`Refresh ${service.name}`} onPress={() => load(service)} borderRadius={22} style={{borderRadius: 22, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'}}>
                <MaterialCommunityIcons name="refresh" size={22} color={colors.onSurfaceVariant} />
              </TVFocusable>
            </View>
            {current?.loading && !current.items.length ? <CardListSkeleton count={2} /> : null}
            {current?.error ? <AppText role="bodyMedium" style={{color: colors.error}}>{current.error}</AppText> : null}
            {current && !current.loading && !current.error && !current.items.length ? (
              <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant}}>No files yet.</AppText>
            ) : null}
            {current?.items.map(item => {
              const size = item.files.reduce((total, file) => total + (file.size || 0), 0);
              return (
                <View key={item.id} style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 14, marginTop: 8}}>
                  <AppText role="titleSmall" numberOfLines={2} style={{color: colors.onSurface}}>{item.name}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
                    {item.ready ? ['Ready', size ? formatBytes(size) : ''].filter(Boolean).join(' · ') : `${Math.round(item.progress * 100)}% · ${item.status}`}
                  </AppText>
                  {item.ready ? (
                    <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
                      <Chip label="Play" icon="play" accessibilityLabel={`Play ${item.name}`} onPress={() => play(service, item)} />
                      <Chip label="Download" icon="download" accessibilityLabel={`Download ${item.name}`} onPress={() => download(service, item)} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      }) : null}
    </ScrollView>
  );
};

export default CloudFiles;
