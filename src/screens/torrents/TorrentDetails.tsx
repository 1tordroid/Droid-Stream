import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import MoreOptions from '../../components/MoreOptions';
import AppText from '../../components/ui/Text';
import {useFeatureVisible} from '../../lib/advancedReveal';
import {torrentManager, type TorrentDetails as Details} from '../../lib/torrentManager';
import {useM3Colors} from '../../theme/M3PaletteContext';

const TorrentDetails = ({route, navigation}: {route: {params: {infoHash: string; highlight?: string}}; navigation: any}) => {
  const colors = useM3Colors();
  const highlight = route.params.highlight;
  const revealed = useFeatureVisible(highlight || '');
  const [details, setDetails] = useState<Details>();
  const [samples, setSamples] = useState<number[]>([]);
  useEffect(() => {
    const timer = setInterval(() => {
      torrentManager.getDetails(route.params.infoHash).then(next => {
        setDetails(next);
        setSamples(current => [...current, next.downloadRate].slice(-30));
      }).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [route.params.infoHash]);
  if (!details) return <View style={{flex: 1, backgroundColor: colors.background, padding: 16}}><AppText style={{color: colors.onSurface}}>Loading torrent…</AppText></View>;
  const max = Math.max(...samples, 1);
  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16}}>
      <Pressable accessibilityLabel="Back to torrents" onPress={() => navigation.goBack()} style={{minHeight: 48, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Torrents</AppText></Pressable>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>{details.name}</AppText>
      <AppText style={{color: colors.onSurfaceVariant, marginVertical: 8}}>{Math.round(details.progress * 100)}% · {Math.round(details.downloadRate / 1024)} KB/s down · {Math.round(details.uploadRate / 1024)} KB/s up</AppText>
      {(details.files || []).map(file => (
        <View key={file.index} style={{paddingVertical: 8, borderBottomWidth: 1, borderColor: highlight && revealed ? colors.primary : colors.outlineVariant}}>
          <AppText style={{color: colors.onSurface}}>{file.name}</AppText>
          <View style={{flexDirection: 'row', gap: 16}}>
            <Pressable accessibilityLabel={`Download ${file.name}`} onPress={() => torrentManager.setFilePriorities(details.infoHash, priorityList(details, file.index, file.priority === 0 ? 4 : 0))} style={{minHeight: 44, justifyContent: 'center'}}>
              <AppText style={{color: colors.primary}}>{file.priority === 0 ? 'Skip' : 'Download'}</AppText>
            </Pressable>
            <Pressable accessibilityLabel={`Play ${file.name}`} onPress={async () => {
              await torrentManager.prepareVideoFile(details.infoHash, file.index, false, true);
              const url = await torrentManager.getStreamUrl(details.infoHash, file.index);
              navigation.navigate('Player', {linkIndex: 0, episodeList: [{title: file.name, link: url}], directUrl: url, type: 'torrent', primaryTitle: file.name, poster: {}, initialStream: {server: 'Torrent', link: url, type: 'torrent'}});
            }} style={{minHeight: 44, justifyContent: 'center'}}><AppText style={{color: colors.primary}}>Play</AppText></Pressable>
          </View>
        </View>
      ))}
      <MoreOptions id="torrent-details" forceOpen={Boolean(highlight)}>
        <AppText style={{color: colors.onSurfaceVariant, marginTop: 8}}>Peers {details.peers?.length || 0} · Trackers {details.trackers?.length || 0}</AppText>
        <View style={{flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, marginVertical: 8}}>
          {samples.map((sample, index) => <View key={index} style={{width: 6, height: Math.max(2, (sample / max) * 48), backgroundColor: colors.primary}} />)}
        </View>
        <AppText style={{color: colors.onSurfaceVariant}}>{details.pieces}</AppText>
        {(details.peers || []).slice(0, 12).map(peer => <AppText key={peer.address} style={{color: colors.onSurface}}>{peer.address} · {peer.client}</AppText>)}
        {(details.trackers || []).map(tracker => <AppText key={tracker.url} style={{color: colors.onSurfaceVariant}}>{tracker.url}</AppText>)}
        <Pressable accessibilityLabel="Sequential download" onPress={() => torrentManager.setSequential(details.infoHash, !details.sequential)} style={{minHeight: 48, justifyContent: 'center'}}>
          <AppText style={{color: colors.primary}}>{details.sequential ? 'Sequential on' : 'Sequential off'}</AppText>
        </Pressable>
      </MoreOptions>
    </ScrollView>
  );
};

const priorityList = (details: Details, index: number, priority: number): number[] =>
  (details.files || []).map(file => (file.index === index ? priority : file.priority));

export default TorrentDetails;
