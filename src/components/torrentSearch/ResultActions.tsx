import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, View} from 'react-native';
import {connectedServices, getService, pickVideo, VIDEO_FILE, type DebridFile, type DebridId, type DebridResolution} from '../../lib/debrid';
import {
  copyMagnet,
  downloadDebridFiles,
  downloadWithClient,
  openExternally,
  openSite,
  playDebridFile,
  resolveDebrid,
  shareResult,
  streamOnDevice,
  toast,
} from '../../lib/torrentSearch/actions';
import {isBookmarked, toggleBookmark} from '../../lib/torrentSearch/store';
import {openWatchOnline} from '../../lib/watchOnline/store';
import type {TorrentResult} from '../../lib/torrentSearch/types';
import {formatBytes} from '../../lib/torrentSearch/util';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable} from '../tv';
import AppText from '../ui/Text';

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const Action = ({icon, label, detail, onPress, accent}: {icon: Icon; label: string; detail?: string; onPress: () => void; accent?: boolean}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} borderRadius={14}
      style={{flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, borderRadius: 14}}>
      <MaterialCommunityIcons name={icon} size={24} color={accent ? colors.primary : colors.onSurfaceVariant} />
      <View style={{marginLeft: 16, flex: 1}}>
        <AppText role="bodyLarge" style={{color: accent ? colors.primary : colors.onSurface}}>{label}</AppText>
        {detail ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{detail}</AppText> : null}
      </View>
    </TVFocusable>
  );
};

const ResultActions = ({
  result,
  cached,
  navigation,
  onClose,
  onBookmarkChange,
}: {
  result: TorrentResult;
  cached?: DebridId[];
  navigation: any;
  onClose: () => void;
  onBookmarkChange?: () => void;
}) => {
  const colors = useM3Colors();
  const [busy, setBusy] = useState<string>();
  const [resolution, setResolution] = useState<DebridResolution>();
  const [saved, setSaved] = useState(() => isBookmarked(result.id));
  const services = connectedServices();

  const run = async (label: string, task: () => Promise<unknown>, close = true) => {
    setBusy(label);
    try {
      await task();
      if (close) onClose();
    } catch (error: any) {
      toast(error?.message || 'That did not work');
    } finally {
      setBusy(undefined);
    }
  };

  const viaDebrid = (service: DebridId, mode: 'stream' | 'download' | 'pick') =>
    run(
      `Asking ${getService(service).name}…`,
      async () => {
        const resolved = await resolveDebrid(result, service, progress => setBusy(`${getService(service).name}: ${progress.percent}% · ${progress.status}`));
        if (mode === 'stream') {
          const file = pickVideo(resolved.files);
          if (!file) throw new Error('No files');
          onClose();
          await playDebridFile(resolved, file, navigation, result.title);
        } else if (mode === 'download' && resolved.files.length === 1) {
          const count = await downloadDebridFiles(resolved, resolved.files);
          toast(count ? 'Saving at full speed from the cloud' : 'Already in Downloads');
          onClose();
        } else {
          setResolution(resolved);
        }
      },
      false,
    );

  const files = resolution?.files || [];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={resolution ? () => setResolution(undefined) : onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{flex: 1, backgroundColor: '#0008'}} />
      <View style={{maxHeight: '85%', backgroundColor: colors.surfaceContainerLow, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12}}>
        <View style={{alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.outline, marginBottom: 12}} />
        <AppText role="titleMedium" numberOfLines={3} style={{color: colors.onSurface, paddingHorizontal: 24}}>{result.title}</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 24, marginTop: 4}}>
          {formatBytes(result.sizeBytes)} · {result.webSeeded ? 'web seed' : `${result.seeders} seeders`}{cached?.length ? ` · cached on ${cached.map(id => getService(id).name).join(', ')}` : ''}
        </AppText>
        {busy ? (
          <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 12}}>
            <ActivityIndicator color={colors.primary} />
            <AppText role="bodyMedium" style={{color: colors.onSurface, marginLeft: 12, flex: 1}}>{busy}</AppText>
          </View>
        ) : null}
        <ScrollView contentContainerStyle={{padding: 12, paddingBottom: 32}}>
          {resolution ? (
            <>
              <Action icon="arrow-left" label="Back" onPress={() => setResolution(undefined)} />
              <Action icon="download-multiple" label={`Download all ${files.length} files`} detail={`From ${resolution.service.name} with the fast downloader`} accent
                onPress={() => run('Queueing…', async () => toast(`${await downloadDebridFiles(resolution, files)} files queued`))} />
              {files.map((file: DebridFile) => (
                <View key={file.id} style={{borderTopWidth: 1, borderColor: colors.outlineVariant, paddingVertical: 4}}>
                  <AppText role="bodyMedium" numberOfLines={2} style={{color: colors.onSurface, paddingHorizontal: 12, paddingTop: 8}}>{file.name}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 12}}>{formatBytes(file.size)}</AppText>
                  <View style={{flexDirection: 'row'}}>
                    {VIDEO_FILE.test(file.name) ? (
                      <View style={{flex: 1}}><Action icon="play" label="Play" accent onPress={() => run('Opening…', () => playDebridFile(resolution, file, navigation, result.title))} /></View>
                    ) : null}
                    <View style={{flex: 1}}><Action icon="download" label="Download" onPress={() => run('Queueing…', async () => toast((await downloadDebridFiles(resolution, [file])) ? 'Queued' : 'Already in Downloads'), false)} /></View>
                  </View>
                </View>
              ))}
            </>
          ) : (
            <>
              <Action icon="play-circle-outline" accent label="Watch online" detail="Cached debrid first, then PikPak, then the torrent"
                onPress={() => { onClose(); openWatchOnline({result, cachedOn: cached, navigate: (screen, params) => navigation.navigate(screen, params)}); }} />
              {services.map(service => {
                const isCached = cached?.includes(service.id);
                return (
                  <View key={service.id}>
                    <Action icon="lightning-bolt" accent label={`Stream with ${service.name}`}
                      detail={isCached ? 'Cached: starts instantly' : service.canCheckCache ? 'Not cached yet: the service fetches it first' : 'Starts instantly when the service has it cached'}
                      onPress={() => viaDebrid(service.id, 'stream')} />
                    <Action icon="cloud-download" label={`Download with ${service.name}`} detail="Direct HTTPS download, no peers needed"
                      onPress={() => viaDebrid(service.id, 'download')} />
                    <Action icon="folder-open" label={`Choose files on ${service.name}`} onPress={() => viaDebrid(service.id, 'pick')} />
                  </View>
                );
              })}
              <Action icon="play-circle" label="Stream on this device" detail="Plays while the torrent downloads" accent={!services.length}
                onPress={() => run('Starting…', () => streamOnDevice(result, navigation), false).then(onClose)} />
              <Action icon="download" label="Download with the torrent client" onPress={() => run('Adding…', () => downloadWithClient(result))} />
              {!services.length ? (
                <Action icon="cloud-cog" label="Set up TorBox, Real-Debrid, PikPak…" detail="Cached torrents play instantly at full speed"
                  onPress={() => { onClose(); navigation.navigate('DebridSettings'); }} />
              ) : null}
              <Action icon="content-copy" label="Copy magnet" onPress={() => run('Copying…', () => copyMagnet(result))} />
              <Action icon="share-variant" label="Share" onPress={() => run('Sharing…', () => shareResult(result))} />
              <Action icon="open-in-app" label="Open in another torrent app" onPress={() => run('Opening…', () => openExternally(result))} />
              {result.detailUrl ? <Action icon="web" label="Open the site page" onPress={() => run('Opening…', () => openSite(result))} /> : null}
              <Action icon={saved ? 'bookmark-remove' : 'bookmark-plus'} label={saved ? 'Remove from saved' : 'Save for later'}
                onPress={() => { setSaved(toggleBookmark(result)); onBookmarkChange?.(); }} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

export default ResultActions;
