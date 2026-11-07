import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {reloadAppAsync} from 'expo';
import type {SettingsStackParamList} from '../../App';
import QrCode from '../../components/QrCode';
import {TVFocusGuide} from '../../components/tv';
import Button from '../../components/ui/Button';
import SettingsPage from '../../components/ui/SettingsPage';
import Surface from '../../components/ui/Surface';
import AppText from '../../components/ui/Text';
import {applySetupPayload, summarizeSetup, type SetupPayload} from '../../lib/backupSync/payload';
import {buildSetupLink, formatCode, SETUP_PORT} from '../../lib/setupTransfer/code';
import {startReceiving, type Receiving} from '../../lib/setupTransfer/receiver';
import {isTV} from '../../lib/tv';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {SyncHeader, SyncNote} from './components/SyncScreenParts';

type Props = NativeStackScreenProps<SettingsStackParamList, 'ReceiveSetup'>;
type Stage = 'starting' | 'waiting' | 'received' | 'expired' | 'error' | 'applying';

export default function ReceiveSetup({navigation}: Props) {
  const colors = useM3Colors();
  const [stage, setStage] = useState<Stage>('starting');
  const [receiving, setReceiving] = useState<Receiving>();
  const [payload, setPayload] = useState<SetupPayload>();
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const current = useRef<Receiving | undefined>(undefined);
  const mounted = useRef(true);

  const start = useCallback(async () => {
    current.current?.stop();
    current.current = undefined;
    setReceiving(undefined);
    setPayload(undefined);
    setError('');
    setStage('starting');
    try {
      const next = await startReceiving(
        received => {
          if (!mounted.current) return;
          setPayload(received);
          setStage('received');
        },
        () => mounted.current && setStage('expired'),
      );
      if (!mounted.current) {
        next.stop();
        return;
      }
      current.current = next;
      setReceiving(next);
      setStage('waiting');
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : 'Could not start');
      setStage('error');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    start();
    return () => {
      mounted.current = false;
      current.current?.stop();
    };
  }, [start]);

  useEffect(() => {
    if (stage !== 'waiting' || !receiving) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((receiving.session.expiresAt - Date.now()) / 60_000)));
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [stage, receiving]);

  const back = useCallback(() => {
    if (stage !== 'applying') navigation.goBack();
    return true;
  }, [navigation, stage]);

  useFocusEffect(
    useCallback(() => {
      if (!isTV) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', back);
      return () => sub.remove();
    }, [back]),
  );

  const apply = async (mode: 'merge' | 'replace') => {
    if (!payload) return;
    setStage('applying');
    try {
      await applySetupPayload(payload, mode);
      await reloadAppAsync('Setup received');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not apply the setup');
      setStage('received');
    }
  };

  const confirmReplace = () =>
    showAppDialog({
      title: 'Replace what is here?',
      message: 'The chosen parts on this device are replaced by the ones sent. Droid Stream will restart.',
      actions: [
        {label: 'Cancel'},
        {label: 'Replace', variant: 'destructive', onPress: () => apply('replace')},
      ],
    });

  let body: React.ReactNode;
  if (stage === 'received' || stage === 'applying') {
    body = (
      <>
        <SyncNote>{`Setup from ${payload?.from || 'another device'}:`}</SyncNote>
        <Surface level="low" style={{borderRadius: 20, padding: 16, marginBottom: 16}}>
          {payload ? summarizeSetup(payload).map(line => (
            <AppText key={line} role="bodyLarge" style={{color: colors.onSurface, marginBottom: 6}}>
              {line}
            </AppText>
          )) : null}
        </Surface>
        <SyncNote>Add adds what this device is missing and keeps what is here. Droid Stream restarts after.</SyncNote>
        {error ? <SyncNote error>{error}</SyncNote> : null}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Button hasTVPreferredFocus disabled={stage === 'applying'} onPress={() => apply('merge')}>
            {stage === 'applying' ? 'Applying…' : 'Add to this device'}
          </Button>
          <Button variant="tonal" disabled={stage === 'applying'} onPress={confirmReplace}>
            Replace what's here
          </Button>
          <Button variant="text" disabled={stage === 'applying'} onPress={() => navigation.goBack()}>
            Cancel
          </Button>
        </View>
      </>
    );
  } else if (stage === 'waiting' && receiving) {
    const link = buildSetupLink({host: receiving.address, port: receiving.port, code: receiving.session.code});
    body = (
      <>
        <SyncNote>
          On your phone, open Settings, Data management, Send setup. Scan this QR code or type the code. Both devices must be on the
          same Wi-Fi.
        </SyncNote>
        <View style={{flexDirection: isTV ? 'row' : 'column', alignItems: 'center', gap: 24, marginBottom: 16}}>
          <View style={{borderRadius: 16, overflow: 'hidden'}}>
            <QrCode value={link} size={isTV ? 240 : 220} accessibilityLabel="QR code for Send setup" />
          </View>
          <View style={{alignItems: isTV ? 'flex-start' : 'center'}}>
            <AppText role="labelLarge" style={{color: colors.onSurfaceVariant}}>
              Code
            </AppText>
            <AppText
              role="displayMedium"
              style={{color: colors.onSurface, letterSpacing: 4, fontVariant: ['tabular-nums']}}
              accessibilityLabel={`Code ${receiving.session.code.split('').join(' ')}`}>
              {formatCode(receiving.session.code)}
            </AppText>
            <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
              {`Address: ${receiving.address}${receiving.port === SETUP_PORT ? '' : `:${receiving.port}`}`}
            </AppText>
            <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
              {left > 0 ? `The code works for ${left} more minute${left === 1 ? '' : 's'}` : 'The code is about to run out'}
            </AppText>
          </View>
        </View>
        <View style={{flexDirection: 'row', gap: 8}}>
          <Button variant="tonal" hasTVPreferredFocus onPress={start}>
            New code
          </Button>
        </View>
      </>
    );
  } else if (stage === 'expired') {
    body = (
      <>
        <SyncNote>The code ran out. Get a new one to try again.</SyncNote>
        <Button hasTVPreferredFocus onPress={start}>
          New code
        </Button>
      </>
    );
  } else if (stage === 'error') {
    body = (
      <>
        <SyncNote error>{error}</SyncNote>
        <Button hasTVPreferredFocus onPress={start}>
          Try again
        </Button>
      </>
    );
  } else {
    body = <SyncNote>Getting a code ready…</SyncNote>;
  }

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <SettingsPage key={stage}>
        <SyncHeader title="Receive setup" subtitle="Get providers, add-ons, keys and settings from another device" onBack={back} focusBack={false} />
        {body}
      </SettingsPage>
    </TVFocusGuide>
  );
}
