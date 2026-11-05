import React, {useRef} from 'react';
import {Clipboard, View} from 'react-native';
import {algorithmFor, checksumMatches, fileChecksum} from '../../../lib/checksum';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import ManagedEpisodeRow from '../../../components/ManagedEpisodeRow';
import LocalVideoThumbnail from '../../../components/local-content/LocalVideoThumbnail';
import {formatDownloadBytes} from '../../../lib/downloadFormatting';
import type {DownloadItem} from '../../../lib/zustand/downloadsStore';

interface DownloadedEpisodeRowProps {
  item: DownloadItem;
  isDeleting: boolean;
  onPlay: (item: DownloadItem) => void;
  onBeforePlay?: (control: View | null) => void;
  onDelete: (item: DownloadItem) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelection?: (item: DownloadItem) => void;
  onStartSelection?: (item: DownloadItem) => void;
}

export const DownloadedEpisodeRow: React.FC<DownloadedEpisodeRowProps> = ({
  item,
  isDeleting,
  onPlay,
  onBeforePlay,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelection,
  onStartSelection,
}) => {
  const controlRef = useRef<View>(null);
  return (
    <ManagedEpisodeRow
      controlRef={controlRef}
      title={item.episodeName || item.title}
      description={formatDownloadBytes(item.totalBytes)}
      thumbnail={<LocalVideoThumbnail uri={item.filePath} />}
      selecting={selecting}
      selected={selected}
      busy={isDeleting}
      onPress={() => {
        if (selecting) onToggleSelection?.(item);
        else {
          onBeforePlay?.(controlRef.current);
          onPlay(item);
        }
      }}
      onLongPress={() => onStartSelection?.(item)}
      onDelete={() => onDelete(item)}
      onShowDetails={() => showFileDetails(item)}
    />
  );
};
const verify = async (item: DownloadItem) => {
  const copied = (await Clipboard.getString().catch(() => '')) || '';
  const expected = algorithmFor(copied) ? copied.trim() : '';
  showAppDialog({title: 'Verifying…', message: 'Computing the checksum. Large files can take a minute.', actions: [{label: 'Hide'}]});
  try {
    if (expected) {
      const actual = await fileChecksum(item.filePath, algorithmFor(expected)!);
      const ok = checksumMatches(actual, expected);
      showAppDialog({
        title: ok ? 'Checksum matches' : 'Checksum does not match',
        message: `${algorithmFor(expected)!.toUpperCase()}\nExpected ${expected.toLowerCase()}\nFile     ${actual}`,
        variant: ok ? 'success' : 'error',
        actions: [{label: 'OK'}],
      });
      return;
    }
    const [md5, sha256] = [await fileChecksum(item.filePath, 'md5'), await fileChecksum(item.filePath, 'sha256')];
    showAppDialog({
      title: 'Checksums',
      message: `MD5\n${md5}\n\nSHA-256\n${sha256}\n\nTip: copy the expected hash first and Droid Stream compares it for you.`,
      actions: [{label: 'Copy SHA-256', onPress: () => Clipboard.setString(sha256)}, {label: 'OK'}],
    });
  } catch (error: any) {
    showAppDialog({title: 'Could not verify', message: error?.message || String(error), variant: 'error', actions: [{label: 'OK'}]});
  }
};

const showFileDetails = (item: DownloadItem) =>
  showAppDialog({
    title: item.episodeName || item.title,
    message: `${formatDownloadBytes(item.totalBytes)}\n${decodeURIComponent(item.filePath)}`,
    actions: [{label: 'Close'}, {label: 'Verify checksum', variant: 'primary', onPress: () => { verify(item).catch(() => undefined); }}],
  });

export default React.memo(DownloadedEpisodeRow);
