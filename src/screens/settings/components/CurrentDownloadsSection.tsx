import React from 'react';
import {Text, View} from 'react-native';
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

const CurrentDownloadsSection = ({
  primary,
  firstActionRef,
  onFirstActionLayout,
  include,
}: {
  primary: string;
  firstActionRef?: React.RefObject<View | null>;
  onFirstActionLayout?: () => void;
  include?: (item: ReturnType<typeof selectCurrentDownloads>[number]) => boolean;
}) => {
  const colors = useM3Colors();
  const navigation = useNavigation<any>();
  const downloads = useDownloadsStore(useShallow(selectCurrentDownloads)).filter(item => !include || include(item));


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
        <CurrentDownloadRow
          key={item.id}
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
      ))}
    </View>
  );
};

export default CurrentDownloadsSection;
