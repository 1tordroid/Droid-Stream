/**
 * Extra actions under a current download: "Edit link" for paused or failed
 * downloads, and "Stop and save" plus timing for Live TV recordings.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Pressable, ToastAndroid, View} from 'react-native';
import {RawText as Text} from '../../../components/ui/Text';
import {canEditDownloadLink} from '../../../lib/downloadEngine/editLink';
import {getEngineOptions} from '../../../lib/downloadEngine/engineStore';
import {describeRecording} from '../../../lib/liveRecording';
import {stopLiveRecording} from '../../../lib/liveRecorder';
import type {DownloadItem} from '../../../lib/zustand/downloadsStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const Action = ({icon, label, accessibilityLabel, onPress}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) => {
  const colors = useM3Colors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.surfaceContainerHighest}}>
      <MaterialCommunityIcons name={icon} size={18} color={colors.primary} />
      <Text className="ml-1 text-sm font-medium" style={{color: colors.onSurface}}>{label}</Text>
    </Pressable>
  );
};

// Loaded when first opened, so the downloads list does not load dialog code.
const EditLinkDialog = (props: {item: DownloadItem; onClose: () => void}) => {
  const Dialog = (require('../../../components/downloads/EditDownloadLinkDialog') as typeof import('../../../components/downloads/EditDownloadLinkDialog')).default;
  return <Dialog {...props} />;
};

const DownloadEngineActions = ({item}: {item: DownloadItem}) => {
  const colors = useM3Colors();
  const [editing, setEditing] = useState(false);
  const recording = item.sourceType === 'live';
  const editable = canEditDownloadLink(item);
  if (!recording && !editable) return null;
  const live = recording ? getEngineOptions(item.id).live : undefined;
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: -4, marginBottom: 10}}>
      {recording ? (
        <Text className="text-xs" style={{color: colors.onSurfaceVariant, flex: 1}} numberOfLines={1}>
          {describeRecording(live || {})}
        </Text>
      ) : null}
      {recording && (item.status === 'downloading' || item.status === 'starting') ? (
        <Action
          icon="stop-circle-outline"
          label="Stop and save"
          accessibilityLabel={`Stop recording ${item.title} and save it`}
          onPress={() => {
            if (stopLiveRecording(item.id)) ToastAndroid.show('Saving the recording', ToastAndroid.SHORT);
          }}
        />
      ) : null}
      {editable ? (
        <Action icon="link-variant" label="Edit link" accessibilityLabel={`Edit the link of ${item.title}`} onPress={() => setEditing(true)} />
      ) : null}
      {editing ? <EditLinkDialog item={item} onClose={() => setEditing(false)} /> : null}
    </View>
  );
};

export default DownloadEngineActions;
