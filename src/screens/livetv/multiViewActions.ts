/** Live TV entry points to multi-view. */
import {addToMultiView, DRM_LIMIT_MESSAGE} from '../../lib/livetv/multiview';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import type {GridChannel} from './play';

export const openMultiView = (navigation: any) => navigation.navigate('MultiView');

/**
 * Long-press "Add to multi-view": adds the channel to the saved set and opens
 * multi-view, or says why it cannot (full, already there, a second DRM channel).
 */
export const addChannelToMultiView = (navigation: any, channel: GridChannel): void => {
  const result = addToMultiView(channel);
  if (result.ok) {
    openMultiView(navigation);
    return;
  }
  // Runs from the channel menu: wait until that dialog has closed.
  setTimeout(
    () =>
      showAppDialog({
        title: result.error === DRM_LIMIT_MESSAGE ? 'One protected channel at a time' : 'Multi-view',
        message: result.error,
        variant: 'warning',
        actions: [{label: 'Cancel'}, {label: 'Open multi-view', variant: 'primary', onPress: () => openMultiView(navigation)}],
      }),
    300,
  );
};
