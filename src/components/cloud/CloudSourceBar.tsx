import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Linking, ScrollView, Share, ToastAndroid, View} from 'react-native';
import {PIKPAK_SOURCE_ID, TORDROID_PLUS_SOURCE_ID} from '../../lib/netlib/cloud';
import type {NetlibEntry, NetlibSource} from '../../lib/netlib/types';
import {PIKPAK_WEBDAV_HELP, PIKPAK_WEBDAV_SERVER, pikpakQuota, sharePikPakFile} from '../../lib/pikpak/drive';
import {quotaLines, shareMessage, type PikPakQuota} from '../../lib/pikpak/parse';
import {shareTordroidPlusFile, tordroidPlusQuota} from '../../lib/tordroidPlus/client';
import {useM3Colors} from '../../theme/M3PaletteContext';
import Chip from '../torrentSearch/Chip';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

type Navigation = {navigate: (screen: string, params?: object) => void};

/** Where "Check sign-in" goes for a cloud source. */
export const openCloudSignIn = (navigation: Navigation, source: NetlibSource): void => {
  if (source.kind === 'pikpak') navigation.navigate('Sources', {kind: 'pikpak'});
  else if (source.kind === 'tdplus') navigation.navigate('TordroidPlus');
  else navigation.navigate('DebridSettings');
};

/** Storage and transfer use of a PikPak or Tordroid Plus account, read when the library opens. */
export const QuotaCard = ({load}: {load: () => Promise<PikPakQuota>}) => {
  const colors = useM3Colors();
  const [quota, setQuota] = useState<PikPakQuota>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    load()
      .then(next => live && setQuota(next))
      .catch(cause => live && setError(cause?.message || 'Could not read the quota'));
    return () => {
      live = false;
    };
    // Reads once per screen visit.
  }, []);
  return (
    <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 16, padding: 12, marginTop: 8}}>
      {quota ? (
        <>
          {quotaLines(quota).map(line => (
            <AppText key={line} role="bodySmall" style={{color: colors.onSurfaceVariant}}>{line}</AppText>
          ))}
          {quota.period ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>Plan: {quota.period}</AppText> : null}
        </>
      ) : error ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{error}</AppText>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
};

/** Quota and account actions above a cloud library's grid. */
const CloudSourceBar = ({source, navigation}: {source: NetlibSource; navigation: Navigation}) => {
  const colors = useM3Colors();
  const listView = <Chip label="List view" icon="format-list-bulleted" onPress={() => navigation.navigate('CloudFiles', {mode: 'list'})} />;
  return (
    <View style={{paddingHorizontal: 16}}>
      {source.kind === 'pikpak' ? <QuotaCard load={pikpakQuota} /> : source.kind === 'tdplus' ? <QuotaCard load={tordroidPlusQuota} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingTop: 10}}>
        {source.kind === 'pikpak' ? (
          <>
            <Chip label="Add magnet" icon="magnet" onPress={() => navigation.navigate('Sources', {kind: 'pikpak'})} />
            <Chip label="Add PikPak WebDAV" icon="cloud-outline" accessibilityLabel="Add PikPak WebDAV as a library source"
              onPress={() => navigation.navigate('Sources', {kind: 'webdav', prefill: {name: 'PikPak WebDAV', server: PIKPAK_WEBDAV_SERVER}})} />
            <Chip label="WebDAV help" icon="help-circle-outline" accessibilityLabel="How to turn on WebDAV in PikPak" onPress={() => Linking.openURL(PIKPAK_WEBDAV_HELP).catch(() => undefined)} />
          </>
        ) : null}
        {source.kind === 'tdplus' ? <Chip label="Family downloads" icon="download-multiple" onPress={() => navigation.navigate('TordroidPlus')} /> : null}
        {source.kind === 'debrid' ? <Chip label="Debrid settings" icon="key-outline" onPress={() => navigation.navigate('DebridSettings')} /> : null}
        {listView}
      </ScrollView>
      {source.kind === 'pikpak' ? (
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 6}}>
          WebDAV: turn it on in the PikPak app (Me, then WebDAV), make a login there, then add it here.
        </AppText>
      ) : null}
    </View>
  );
};

/** Makes a share link for a PikPak or Tordroid Plus file and opens the share sheet. */
export const shareCloudEntry = async (sourceId: string, entry: NetlibEntry): Promise<void> => {
  try {
    const id = entry.path.startsWith('d:') ? entry.path.slice(2) : entry.path;
    const link = sourceId === PIKPAK_SOURCE_ID ? await sharePikPakFile(id) : await shareTordroidPlusFile(id);
    await Share.share({message: shareMessage(entry.name, link), title: entry.name});
  } catch (error: any) {
    ToastAndroid.show(error?.message || 'Could not make a share link', ToastAndroid.LONG);
  }
};

export const canShareCloud = (sourceId: string): boolean => sourceId === PIKPAK_SOURCE_ID || sourceId === TORDROID_PLUS_SOURCE_ID;

/** A share button beside a folder row; its own focus stop on TV. */
export const CloudShareButton = ({sourceId, entry}: {sourceId: string; entry: NetlibEntry}) => {
  const colors = useM3Colors();
  const [busy, setBusy] = useState(false);
  return (
    <TVFocusable accessibilityRole="button" accessibilityLabel={`Share ${entry.name}`} borderRadius={22} style={{padding: 10, borderRadius: 22}}
      onPress={() => {
        if (busy) return;
        setBusy(true);
        shareCloudEntry(sourceId, entry).finally(() => setBusy(false));
      }}>
      {busy ? <ActivityIndicator color={colors.primary} /> : <MaterialCommunityIcons name="share-variant-outline" size={22} color={colors.onSurfaceVariant} />}
    </TVFocusable>
  );
};

export default CloudSourceBar;
