import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import Button from '../ui/Button';
import AppText from '../ui/Text';
import SignInCode from './SignInCode';
import {
  checkQuickConnect,
  finishQuickConnect,
  QUICK_CONNECT_OFF_MESSAGE,
  quickConnectEnabled,
  startQuickConnect,
} from '../../lib/sources/quickConnect';
import {startDevicePoll} from '../../lib/watchSync/devicePoll';
import type {DeviceCode} from '../../lib/watchSync';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Phase = {step: 'busy'; message: string} | {step: 'code'; code: DeviceCode} | {step: 'error'; message: string};

/**
 * Jellyfin Quick Connect: shows a 6-digit code to approve in Jellyfin on a
 * device that is already signed in, then calls onSignedIn with this
 * device's own sign-in. Starts as soon as it shows.
 */
const QuickConnectSignIn = ({
  server,
  deviceId,
  onSignedIn,
}: {
  server: string;
  /** The DeviceId the token is issued for; the saved source keeps it. */
  deviceId: string;
  onSignedIn: (session: {userId: string; token: string; userName: string}) => void;
}) => {
  const colors = useM3Colors();
  const [phase, setPhase] = useState<Phase>({step: 'busy', message: 'Getting a code…'});
  const run = useRef(0);
  const cancelPoll = useRef<(() => void) | undefined>(undefined);
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  const start = async () => {
    cancelPoll.current?.();
    const current = ++run.current;
    setPhase({step: 'busy', message: 'Getting a code…'});
    try {
      if (!(await quickConnectEnabled(server, deviceId))) throw new Error(QUICK_CONNECT_OFF_MESSAGE);
      if (current !== run.current) return;
      const code = await startQuickConnect(server, deviceId);
      if (current !== run.current) return;
      setPhase({step: 'code', code});
      cancelPoll.current = startDevicePoll(code, {
        poll: next => checkQuickConnect(server, next, deviceId),
        onApproved: async () => {
          if (current !== run.current) return;
          setPhase({step: 'busy', message: 'Signing in…'});
          try {
            const session = await finishQuickConnect(server, code, deviceId);
            if (current === run.current) signedIn.current(session);
          } catch (error: any) {
            if (current === run.current) setPhase({step: 'error', message: error?.message || 'Jellyfin sign-in failed. Try again.'});
          }
        },
        onStop: message => {
          if (current === run.current) setPhase({step: 'error', message});
        },
      });
    } catch (error: any) {
      if (current === run.current) setPhase({step: 'error', message: error?.message || 'Could not get a code. Try again.'});
    }
  };

  useEffect(() => {
    start();
    return () => {
      run.current += 1;
      cancelPoll.current?.();
    };
    // One run per server and device id.
  }, [server, deviceId]);

  if (phase.step === 'busy') {
    return (
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16}}>
        <ActivityIndicator color={colors.primary} />
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{phase.message}</AppText>
      </View>
    );
  }
  if (phase.step === 'code') {
    return (
      <SignInCode
        code={phase.code.userCode}
        before="Enter this code in Jellyfin:"
        after="Settings > Quick Connect, on a phone or computer that is signed in."
        status="Waiting for you to approve…"
        action={{label: 'Get a new code', onPress: start}}
      />
    );
  }
  return (
    <View style={{marginVertical: 12}}>
      <AppText role="bodyLarge" style={{color: colors.error, marginBottom: 12}}>{phase.message}</AppText>
      <View style={{flexDirection: 'row'}}>
        <Button onPress={start} hasTVPreferredFocus={isTV}>Get a new code</Button>
      </View>
    </View>
  );
};

export default QuickConnectSignIn;
