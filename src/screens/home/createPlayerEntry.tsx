import React, {useEffect} from 'react';
import {ToastAndroid} from 'react-native';
import {settingsStorage} from '../../lib/storage';

/** MMKV flag: the "VLC can't send this sign-in" notice was shown once. */
export const VLC_HEADERS_NOTICE_KEY = 'vlcHeadersNoticeShown';
export const VLC_HEADERS_NOTICE =
  "This source needs a sign-in VLC can't send, so it opens in the built-in player.";

type EntryParams = {
  localContent?: boolean;
  directUrl?: string;
  file?: string;
  externalVideo?: unknown;
  initialStream?: {headers?: unknown};
};

/** Whether the stream to play first carries request headers (a sign-in). */
export const hasStreamHeaders = (params: EntryParams | undefined): boolean => {
  const headers = params?.initialStream?.headers;
  return (
    !!headers &&
    typeof headers === 'object' &&
    Object.keys(headers as object).length > 0
  );
};

/**
 * Picks the VLC screen for files and direct links when VLC is the engine.
 * VLC gets no request headers, so a stream that needs them (WebDAV with a
 * password, a media server token header) stays on the built-in player.
 */
export function createPlayerEntry<P extends {route: {params: EntryParams}}>(
  BuiltinPlayer: React.ComponentType<P>,
  VlcPlayer: React.ComponentType<P>,
): (props: P) => React.JSX.Element {
  return function PlayerEntry(props: P): React.JSX.Element {
    const params = props.route.params;
    const vlcEligible =
      settingsStorage.getPlayerEngine() === 'vlc' &&
      !!(
        params.localContent ||
        params.directUrl ||
        params.file ||
        params.externalVideo
      );
    const keepBuiltin = vlcEligible && hasStreamHeaders(params);

    useEffect(() => {
      if (keepBuiltin && !settingsStorage.getBool(VLC_HEADERS_NOTICE_KEY)) {
        settingsStorage.setBool(VLC_HEADERS_NOTICE_KEY, true);
        ToastAndroid.show(VLC_HEADERS_NOTICE, ToastAndroid.LONG);
      }
    }, [keepBuiltin]);

    if (vlcEligible && !keepBuiltin) {
      return <VlcPlayer {...props} />;
    }
    return <BuiltinPlayer {...props} />;
  };
}
