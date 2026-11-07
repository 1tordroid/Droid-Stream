/** Record actions for Live TV channels and guide programmes. */
import {ToastAndroid} from 'react-native';
import type {GuideProgramme} from '../../lib/livetv/guide';
import {recordingBlocker, startLiveRecording} from '../../lib/liveRecording';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import type {GridChannel} from './play';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

const clock = (time: number) => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Could not start the recording.');

/** Records the channel from now until it is stopped in Downloads. */
export const recordChannel = (channel: GridChannel): void => {
  startLiveRecording(channel)
    .then(() => toast(`Recording ${channel.name}. Stop it in Downloads.`))
    .catch(error => toast(errorText(error)));
};

/** Records a programme on now or later, from a little before it starts until a little after it ends. */
export const recordProgramme = (channel: GridChannel, programme: GuideProgramme): void => {
  startLiveRecording(channel, {programme})
    .then(result =>
      toast(result === 'scheduled' ? `Will record ${programme.title} at ${clock(programme.start)}. Keep the app open.` : `Recording ${programme.title}`),
    )
    .catch(error => toast(errorText(error)));
};

export const canRecord = (channel: GridChannel): boolean => !recordingBlocker(channel);

/** Long-press menu of a channel tile: favourite and record. */
export const showChannelMenu = (channel: GridChannel, favourite: boolean, toggleFavourite: () => void): void => {
  const actions = [
    {label: 'Cancel'},
    {label: favourite ? 'Remove from favourites' : 'Add to favourites', onPress: toggleFavourite},
  ];
  if (canRecord(channel)) actions.push({label: 'Record', onPress: () => recordChannel(channel)});
  showAppDialog({title: channel.name, message: channel.group || 'Live TV channel', actions});
};

/** Long-press menu of a guide programme on now or later. */
export const showProgrammeMenu = (
  channel: GridChannel,
  programme: GuideProgramme,
  extra: {label: string; onPress: () => void}[] = [],
): void => {
  const actions: {label: string; onPress?: () => void}[] = [{label: 'Cancel'}, ...extra];
  if (canRecord(channel) && programme.stop > Date.now()) {
    actions.push({label: 'Record this programme', onPress: () => recordProgramme(channel, programme)});
  }
  showAppDialog({
    title: programme.title,
    message: `${channel.name} · ${clock(programme.start)} – ${clock(programme.stop)}`,
    actions,
  });
};
