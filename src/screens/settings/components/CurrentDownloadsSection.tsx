import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Pressable, View, type HostInstance} from 'react-native';
import {RawText as Text} from '../../../components/ui/Text';
import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  startQueuedDownloadNow,
} from '../../../lib/downloadManager';
import useDownloadsStore, {
  selectCurrentDownloads,
} from '../../../lib/zustand/downloadsStore';
import {useShallow} from 'zustand/react/shallow';
import {useNavigation} from '@react-navigation/native';
import {getDownloadPlayerParams} from '../../../lib/downloadPlayback';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import CurrentDownloadRow from './CurrentDownloadRow';
import DownloadEngineActions from './DownloadEngineActions';
import {compareQueue, moveQueueItem} from '../../../lib/downloadEngine/planner';
import {readQueueMeta, setQueueOrder} from '../../../lib/downloadEngine/queueStore';

const CurrentDownloadsSection = ({
  primary,
  firstActionRef,
  onFirstActionLayout,
  include,
}: {
  primary: string;
  firstActionRef?: React.RefObject<HostInstance | null>;
  onFirstActionLayout?: () => void;
  include?: (item: ReturnType<typeof selectCurrentDownloads>[number]) => boolean;
}) => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const current = useDownloadsStore(useShallow(selectCurrentDownloads)).filter(item => !include || include(item));
  const [, setOrderVersion] = useState(0);
  const meta = readQueueMeta();
  // Waiting downloads show in the order they will start.
  const queued = current.filter(item => item.status === 'queued').sort((left, right) => compareQueue(left, right, meta));
  const downloads = [...current.filter(item => item.status !== 'queued'), ...queued];
  const moveQueued = (id: string, direction: -1 | 1) => {
    setQueueOrder(moveQueueItem(queued.map(item => item.id), id, direction));
    setOrderVersion(version => version + 1);
  };


  if (downloads.length === 0) {
    return null;
  }

  return (
    <View className="mb-5">
      <View className="mb-3 flex-row items-center justify-between">
        <Text
          className="text-xl font-bold"
          style={{color: colors.onBackground}}>
          Current Downloads
        </Text>
        <View
          className="min-w-8 items-center px-2 py-1"
          style={{
            backgroundColor: colors.secondaryContainer,
            borderRadius: 12,
          }}>
          <Text
            className="text-xs font-bold"
            style={{color: colors.onSecondaryContainer}}>
            {downloads.length}
          </Text>
        </View>
      </View>
      {downloads.map((item, index) => (
        <View key={item.id}>
        <CurrentDownloadRow
          item={item}
          primary={primary}
          firstActionRef={index === 0 ? firstActionRef : undefined}
          onFirstActionLayout={index === 0 ? onFirstActionLayout : undefined}
          onCancel={() => cancelDownload(item.id).catch(console.error)}
          onPause={() => pauseDownload(item.id).catch(console.error)}
          onResume={() => resumeDownload(item.id).catch(console.error)}
          onRetry={() => retryDownload(item.id).catch(console.error)}
          onWatch={() => {
            const params = getDownloadPlayerParams(item);
            if (params) navigation.navigate('Player', params);
          }}
          onStartNow={() =>
            startQueuedDownloadNow(item.id).catch(console.error)
          }
        />
        <DownloadEngineActions item={item} />
        {item.status === 'queued' && queued.length > 1 ? (
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: -4, marginBottom: 8}}>
            {([[-1, 'arrow-up', 'earlier'], [1, 'arrow-down', 'later']] as const).map(([direction, icon, word]) => {
              const position = queued.findIndex(entry => entry.id === item.id);
              const disabled = direction === -1 ? position === 0 : position === queued.length - 1;
              return (
                <Pressable
                  key={icon}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${item.title} ${word}`}
                  accessibilityState={{disabled}}
                  disabled={disabled}
                  onPress={() => moveQueued(item.id, direction)}
                  style={{minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1}}>
                  <MaterialCommunityIcons name={icon} size={22} color={colors.onSurfaceVariant} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
        </View>
      ))}
    </View>
  );
};

export default CurrentDownloadsSection;
