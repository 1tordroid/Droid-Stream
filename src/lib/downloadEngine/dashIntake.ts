/** Asks which video and audio to save from a DASH link, then queues it. */
import {ToastAndroid} from 'react-native';
import {loadDashManifest} from '../dashDownloader';
import {showAppDialog} from '../zustand/appDialogStore';
import {dashAudioChoices, dashVideoChoices, type DashRepresentation} from './mpd';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);

type Queue = (url: string, fileName: string, wanted: {video?: string; audio?: string}) => Promise<unknown>;

const nameFrom = (url: string) => (url.split('/').pop()?.split('?')[0] || 'video').replace(/\.mpd$/i, '') || 'video';

/** Up to [limit] choices as dialog actions; the best one goes last, as the highlighted button. */
const choiceActions = (choices: DashRepresentation[], pick: (choice: DashRepresentation) => void, limit = 4) => {
  const shown = choices.slice(0, limit);
  return [
    {label: 'Not now'},
    ...shown.slice(1).map(choice => ({label: choice.label, onPress: () => pick(choice)})),
    {label: shown[0].label, variant: 'primary' as const, onPress: () => pick(shown[0])},
  ];
};

export const offerDashDownload = async (url: string, headers: Record<string, string> | undefined, queue: Queue): Promise<void> => {
  let manifest;
  try {
    manifest = await loadDashManifest(url, headers);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not read this DASH link.');
    return;
  }
  const videos = dashVideoChoices(manifest);
  const audios = dashAudioChoices(manifest);
  const name = nameFrom(url);
  const save = (video?: DashRepresentation, audio?: DashRepresentation) =>
    queue(url, `${name}${video?.height ? ` ${video.height}p` : ''}.mpd`, {video: video?.id, audio: audio?.id})
      .catch(error => toast(error instanceof Error ? error.message : String(error)));
  const askAudio = (video?: DashRepresentation) => {
    if (video?.hasAudio || audios.length < 2) {
      save(video, audios[0]);
      return;
    }
    // After the quality dialog has closed, which happens right after its button runs.
    setTimeout(() => showAppDialog({title: 'Choose the audio', message: name, actions: choiceActions(audios, audio => save(video, audio))}), 50);
  };
  if (videos.length < 2) {
    askAudio(videos[0]);
    return;
  }
  showAppDialog({title: 'Choose a quality', message: name, actions: choiceActions(videos, askAudio)});
};
