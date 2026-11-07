import React, {useCallback, useRef, useState} from 'react';
import {BackHandler, Linking, View} from 'react-native';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {SettingsStackParamList} from '../../App';
import {TVFocusGuide} from '../../components/tv';
import Button from '../../components/ui/Button';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import {createSetupPayload, SECTION_LABELS, SETUP_SECTIONS, type SetupSection} from '../../lib/backupSync/payload';
import {syncNative} from '../../lib/backupSync/native';
import {normalizeCode, parseSetupLink, SETUP_PORT} from '../../lib/setupTransfer/code';
import {findReceivers, hello, sendSetup, type Receiver} from '../../lib/setupTransfer/sender';
import {isTV} from '../../lib/tv';
import {SyncField, SyncHeader, SyncNote} from './components/SyncScreenParts';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SendSetup'>;
type Step = 'choose' | 'connect' | 'scan' | 'pick' | 'sending' | 'done';

/** "192.168.1.5" or "192.168.1.5:47861". */
const parseAddress = (text: string): {host: string; port: number} | undefined => {
  const match = text.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?$/);
  if (!match) return undefined;
  const port = match[2] ? Number(match[2]) : SETUP_PORT;
  return port >= 1024 && port <= 65535 ? {host: match[1], port} : undefined;
};

export default function SendSetup({navigation}: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [chosen, setChosen] = useState<Record<SetupSection, boolean>>(
    () => Object.fromEntries(SETUP_SECTIONS.map(section => [section, true])) as Record<SetupSection, boolean>,
  );
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [found, setFound] = useState<Receiver[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const busy = useRef(false);

  const back = useCallback(() => {
    if (step === 'sending') return true;
    if (step === 'scan' || step === 'pick') setStep('connect');
    else if (step === 'connect') setStep('choose');
    else navigation.goBack();
    setError('');
    return true;
  }, [navigation, step]);

  useFocusEffect(
    useCallback(() => {
      if (!isTV && step === 'choose') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', back);
      return () => sub.remove();
    }, [back, step]),
  );

  const sections = SETUP_SECTIONS.filter(section => chosen[section]);

  const deliver = async (receiver: Receiver, secret: string) => {
    setStep('sending');
    setStatus(`Sending to ${receiver.name}…`);
    try {
      const payload = await createSetupPayload(sections);
      await sendSetup(receiver, secret, payload);
      setSentTo(receiver.name);
      setStep('done');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send');
      setStep('connect');
    }
  };

  const run = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send');
      setStep('connect');
    } finally {
      busy.current = false;
      setStatus('');
    }
  };

  const sendTyped = () =>
    run(async () => {
      const secret = normalizeCode(code);
      if (!secret) throw new Error('Type the 8-character code shown on the other device');
      if (address.trim()) {
        const target = parseAddress(address);
        if (!target) throw new Error('Type the address as shown, for example 192.168.1.20');
        setStep('sending');
        setStatus('Connecting…');
        const receiver = await hello(target.host, target.port);
        if (!receiver) throw new Error('Nothing answered at that address. Check that Receive setup is open there.');
        await deliver(receiver, secret);
        return;
      }
      setStep('sending');
      setStatus('Looking for the other device…');
      const own = await syncNative.lanAddress();
      if (!own) throw new Error('Connect to Wi-Fi first');
      const receivers = await findReceivers(own);
      if (!receivers.length) {
        throw new Error('No device found. Open Receive setup on the other device, or type the address it shows.');
      }
      if (receivers.length === 1) {
        await deliver(receivers[0], secret);
        return;
      }
      setFound(receivers);
      setStep('pick');
    });

  const onScanned = (data: string) => {
    if (scanned.current) return;
    const link = parseSetupLink(data);
    if (!link) return;
    scanned.current = true;
    run(async () => {
      setStep('sending');
      setStatus('Connecting…');
      const receiver = await hello(link.host, link.port);
      if (!receiver) throw new Error('Could not reach the other device. Check that both are on the same Wi-Fi.');
      await deliver(receiver, link.code);
    }).finally(() => {
      scanned.current = false;
    });
  };

  const errorNote = error ? <SyncNote error>{error}</SyncNote> : null;
  let body: React.ReactNode;

  if (step === 'choose') {
    body = (
      <>
        <SettingsSection title="What to send">
          {SETUP_SECTIONS.map((section, index) => (
            <SettingsSwitchRow
              key={section}
              title={SECTION_LABELS[section].title}
              description={SECTION_LABELS[section].description}
              value={chosen[section]}
              divider={index < SETUP_SECTIONS.length - 1}
              onValueChange={value => setChosen(current => ({...current, [section]: value}))}
            />
          ))}
        </SettingsSection>
        <SyncNote>Everything is encrypted with the code and goes straight over your home network. No internet needed.</SyncNote>
        <Button hasTVPreferredFocus={isTV} disabled={!sections.length} onPress={() => setStep('connect')}>
          Next
        </Button>
      </>
    );
  } else if (step === 'connect') {
    body = (
      <>
        <SyncNote>On the TV or other device, open Settings, Data management, Receive setup.</SyncNote>
        {!isTV ? (
          <View style={{marginBottom: 20}}>
            <Button
              onPress={async () => {
                setError('');
                if (!permission?.granted) {
                  const result = await requestPermission();
                  if (!result.granted) {
                    if (!result.canAskAgain) Linking.openSettings();
                    setError('Allow camera access to scan, or type the code below.');
                    return;
                  }
                }
                setStep('scan');
              }}>
              Scan the QR code
            </Button>
          </View>
        ) : null}
        <SyncField
          label="Code"
          value={code}
          onChangeText={setCode}
          placeholder="ABCD-1234"
          autoCapitalize="characters"
          maxLength={12}
        />
        <SyncField
          label="Address (optional)"
          value={address}
          onChangeText={setAddress}
          placeholder="Found automatically"
          keyboardType="numbers-and-punctuation"
          onSubmitEditing={sendTyped}
        />
        {errorNote}
        <View style={{flexDirection: 'row', gap: 8}}>
          <Button hasTVPreferredFocus={isTV} onPress={sendTyped}>
            Send
          </Button>
          <Button variant="text" onPress={back}>
            Back
          </Button>
        </View>
      </>
    );
  } else if (step === 'scan') {
    body = (
      <>
        <SyncNote>Point the camera at the QR code on the other device.</SyncNote>
        <View style={{height: 320, borderRadius: 16, overflow: 'hidden', marginBottom: 16}}>
          <CameraView
            style={{flex: 1}}
            facing="back"
            barcodeScannerSettings={{barcodeTypes: ['qr']}}
            onMountError={() => {
              setError('Camera unavailable. Type the code instead.');
              setStep('connect');
            }}
            onBarcodeScanned={({data}) => onScanned(data)}
          />
        </View>
        <Button variant="text" onPress={back}>
          Type the code instead
        </Button>
      </>
    );
  } else if (step === 'pick') {
    body = (
      <>
        <SyncNote>More than one device is waiting. Pick the one showing your code.</SyncNote>
        <View style={{gap: 8}}>
          {found.map((receiver, index) => (
            <Button
              key={`${receiver.host}:${receiver.port}`}
              variant="tonal"
              hasTVPreferredFocus={isTV && index === 0}
              onPress={() => {
                const secret = normalizeCode(code);
                if (secret) run(() => deliver(receiver, secret));
              }}>
              {`${receiver.name} (${receiver.host})`}
            </Button>
          ))}
        </View>
      </>
    );
  } else if (step === 'sending') {
    body = <SyncNote>{status || 'Sending…'}</SyncNote>;
  } else {
    body = (
      <>
        <SyncNote>{`Sent to ${sentTo}. Check it and confirm there.`}</SyncNote>
        <Button hasTVPreferredFocus={isTV} onPress={() => navigation.goBack()}>
          Done
        </Button>
      </>
    );
  }

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <SettingsPage key={step}>
        <SyncHeader title="Send setup" subtitle="Send your setup to a TV or another phone" onBack={back} focusBack={false} />
        {body}
      </SettingsPage>
    </TVFocusGuide>
  );
}
