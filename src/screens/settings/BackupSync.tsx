import React, {useCallback, useEffect, useState} from 'react';
import {BackHandler, ToastAndroid, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {reloadAppAsync} from 'expo';
import type {SettingsStackParamList} from '../../App';
import {TVFocusGuide} from '../../components/tv';
import Button from '../../components/ui/Button';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import {isCryptoAvailable, MIN_PASSPHRASE_LENGTH} from '../../lib/backupSync/crypto';
import {restoreSyncFile} from '../../lib/backupSync/payload';
import {backUpNow, downloadVersion, fetchVersions, testTarget, thisDevice} from '../../lib/backupSync/service';
import {
  DEFAULT_FOLDER,
  describeTarget,
  KEEP_CHOICES,
  readAutoMode,
  readKeep,
  readPassphrase,
  readStatus,
  readTarget,
  readWifiOnly,
  resolveTarget,
  writeAutoMode,
  writeKeep,
  writePassphrase,
  writeTarget,
  writeWifiOnly,
  type AutoMode,
  type SyncTarget,
} from '../../lib/backupSync/settings';
import {deviceLabel, type BackupVersion} from '../../lib/backupSync/versions';
import {isUsableServer} from '../../lib/backupSync/webdav';
import {formatDownloadBytes} from '../../lib/downloadFormatting';
import {listSources} from '../../lib/sources/vault';
import {isTV} from '../../lib/tv';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {SyncField, SyncHeader, SyncNote} from './components/SyncScreenParts';

type Props = NativeStackScreenProps<SettingsStackParamList, 'BackupSync'>;
type Mode = 'main' | 'target' | 'passphrase' | 'versions' | 'restore';

const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  daily: 'Once a day',
  change: 'When something changes',
};
const AUTO_ORDER: AutoMode[] = ['off', 'daily', 'change'];

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

const when = (time?: number) => (time ? new Date(time).toLocaleString() : '');

const statusText = (): string => {
  const status = readStatus();
  if (status.lastError && (status.lastAttemptAt ?? 0) > (status.lastSuccessAt ?? 0)) {
    return `Last try failed: ${status.lastError}`;
  }
  return status.lastSuccessAt ? `Last backup ${when(status.lastSuccessAt)}` : 'No backup yet';
};

export default function BackupSync({navigation}: Props) {
  const [mode, setMode] = useState<Mode>('main');
  const [target, setTarget] = useState<SyncTarget | undefined>(readTarget);
  const [hasPassphrase, setHasPassphrase] = useState(() => Boolean(readPassphrase()));
  const [auto, setAuto] = useState<AutoMode>(readAutoMode);
  const [wifiOnly, setWifiOnly] = useState(readWifiOnly);
  const [keep, setKeep] = useState(readKeep);
  const [status, setStatus] = useState(statusText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Folder form
  const webdavSources = listSources().filter(source => source.kind === 'webdav');
  const [sourceId, setSourceId] = useState(target?.kind === 'source' ? target.sourceId : '');
  const [server, setServer] = useState(target?.kind === 'custom' ? target.server : '');
  const [username, setUsername] = useState(target?.kind === 'custom' ? target.username : '');
  const [password, setPassword] = useState(target?.kind === 'custom' ? target.password : '');
  const [folder, setFolder] = useState(target?.folder || DEFAULT_FOLDER);

  // Passphrase form
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');

  // Restore
  const [versions, setVersions] = useState<BackupVersion[]>();
  const [picked, setPicked] = useState<BackupVersion>();
  const [restorePassphrase, setRestorePassphrase] = useState('');

  const back = useCallback(() => {
    if (busy) return true;
    if (mode === 'restore') setMode('versions');
    else if (mode !== 'main') setMode('main');
    else navigation.goBack();
    setError('');
    return true;
  }, [busy, mode, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (!isTV && mode === 'main') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', back);
      return () => sub.remove();
    }, [back, mode]),
  );

  useEffect(() => {
    if (mode === 'main') setStatus(statusText());
  }, [mode]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const saveTarget = () =>
    run(async () => {
      const next: SyncTarget = sourceId
        ? {kind: 'source', sourceId, folder: folder.trim() || DEFAULT_FOLDER}
        : {kind: 'custom', server: server.trim(), username: username.trim(), password, folder: folder.trim() || DEFAULT_FOLDER};
      if (next.kind === 'custom' && !isUsableServer(next.server)) {
        throw new Error('Enter a WebDAV address that starts with http:// or https://');
      }
      const resolved = resolveTarget(next);
      if (!resolved) throw new Error('That saved source is gone. Pick another one.');
      const found = await testTarget(resolved);
      writeTarget(next);
      setTarget(next);
      toast(found ? `Folder ready. ${found} backup${found === 1 ? '' : 's'} found.` : 'Folder ready');
      setMode('main');
    });

  const savePassphrase = () => {
    if (first.length < MIN_PASSPHRASE_LENGTH) {
      setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters`);
      return;
    }
    if (first !== second) {
      setError('The two passphrases are different');
      return;
    }
    writePassphrase(first);
    setHasPassphrase(true);
    setFirst('');
    setSecond('');
    setError('');
    toast('Passphrase saved');
    setMode('main');
  };

  const removePassphrase = () => {
    showAppDialog({
      title: 'Remove the passphrase?',
      message: 'New backups will leave out sign-ins, keys and passwords. Older backups keep theirs and still need the old passphrase.',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => {
            writePassphrase('');
            setHasPassphrase(false);
            setMode('main');
          },
        },
      ],
    });
  };

  const backUp = () =>
    run(async () => {
      try {
        const result = await backUpNow();
        toast(result.withSignIns ? 'Backed up' : 'Backed up without sign-ins');
      } finally {
        setStatus(statusText());
      }
    });

  const openVersions = () => {
    setMode('versions');
    setVersions(undefined);
    run(async () => setVersions(await fetchVersions()));
  };

  const pick = (version: BackupVersion) => {
    setPicked(version);
    setRestorePassphrase(readPassphrase());
    setError('');
    setMode('restore');
  };

  const restore = (restoreMode: 'merge' | 'replace', skipSecrets: boolean) =>
    run(async () => {
      if (!picked) return;
      const file = await downloadVersion(picked.name);
      await restoreSyncFile(file, {mode: restoreMode, passphrase: restorePassphrase, skipSecrets});
      await reloadAppAsync('Backup restored');
    });

  const confirmRestore = (restoreMode: 'merge' | 'replace', skipSecrets = false) => {
    showAppDialog({
      title: restoreMode === 'merge' ? 'Add this backup?' : 'Replace with this backup?',
      message:
        (restoreMode === 'merge'
          ? 'Adds what this device is missing. Settings and sign-ins already here stay.'
          : 'Replaces settings, providers, sign-ins and library on this device with the backup. Watch history and positions are combined.') +
        ' Droid Stream will restart.',
      actions: [
        {label: 'Cancel'},
        {
          label: restoreMode === 'merge' ? 'Add' : 'Replace',
          variant: restoreMode === 'merge' ? 'primary' : 'destructive',
          onPress: () => restore(restoreMode, skipSecrets),
        },
      ],
    });
  };

  const cycleAuto = () => {
    const next = AUTO_ORDER[(AUTO_ORDER.indexOf(auto) + 1) % AUTO_ORDER.length];
    writeAutoMode(next);
    setAuto(next);
  };

  const cycleKeep = () => {
    const next = KEEP_CHOICES[(KEEP_CHOICES.indexOf(keep as (typeof KEEP_CHOICES)[number]) + 1) % KEEP_CHOICES.length];
    writeKeep(next);
    setKeep(next);
  };

  const errorNote = error ? <SyncNote error>{error}</SyncNote> : null;
  const where = describeTarget(target);
  const thisDeviceSlug = thisDevice();

  let body: React.ReactNode;
  if (mode === 'target') {
    body = (
      <>
        <SyncHeader title="WebDAV folder" subtitle="Nextcloud, a NAS, PikPak WebDAV or any other WebDAV server" onBack={back} focusBack={false} />
        {webdavSources.length ? (
          <>
            <SyncNote>Use a saved WebDAV source:</SyncNote>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16}}>
              {webdavSources.map((source, index) => (
                <Button
                  key={source.id}
                  variant={sourceId === source.id ? 'filled' : 'tonal'}
                  hasTVPreferredFocus={isTV && index === 0}
                  onPress={() => setSourceId(sourceId === source.id ? '' : source.id)}>
                  {source.name}
                </Button>
              ))}
            </View>
          </>
        ) : null}
        {!sourceId ? (
          <>
            <SyncNote>{webdavSources.length ? 'Or enter a server:' : 'Enter a server:'}</SyncNote>
            <SyncField label="Address" value={server} onChangeText={setServer} placeholder="https://cloud.example.com/remote.php/dav/files/me" keyboardType="url" />
            <SyncField label="User name" value={username} onChangeText={setUsername} />
            <SyncField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          </>
        ) : null}
        <SyncField label="Folder" value={folder} onChangeText={setFolder} placeholder={DEFAULT_FOLDER} />
        {errorNote}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Button disabled={busy} onPress={saveTarget}>
            {busy ? 'Checking…' : 'Save'}
          </Button>
          <Button variant="text" disabled={busy} onPress={back}>
            Cancel
          </Button>
          {target ? (
            <Button
              variant="text"
              disabled={busy}
              onPress={() => {
                writeTarget(undefined);
                setTarget(undefined);
                setMode('main');
              }}>
              Stop using this folder
            </Button>
          ) : null}
        </View>
      </>
    );
  } else if (mode === 'passphrase') {
    body = (
      <>
        <SyncHeader title="Sync passphrase" onBack={back} focusBack={false} />
        <SyncNote>
          With a passphrase, backups also carry debrid keys, sign-ins, passwords, PINs and the browser's saved passwords, encrypted
          with AES-256. Without one, they are left out. Keep the passphrase safe: without it, those parts of a backup cannot be
          restored.
        </SyncNote>
        {!isCryptoAvailable() ? <SyncNote error>Update Droid Stream to use a passphrase.</SyncNote> : null}
        <SyncField label="New passphrase" value={first} onChangeText={setFirst} secureTextEntry autoFocus={!isTV} />
        <SyncField label="Type it again" value={second} onChangeText={setSecond} secureTextEntry onSubmitEditing={savePassphrase} />
        {errorNote}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Button hasTVPreferredFocus={isTV} disabled={!isCryptoAvailable()} onPress={savePassphrase}>
            Save
          </Button>
          <Button variant="text" onPress={back}>
            Cancel
          </Button>
          {hasPassphrase ? (
            <Button variant="text" onPress={removePassphrase}>
              Remove passphrase
            </Button>
          ) : null}
        </View>
      </>
    );
  } else if (mode === 'versions') {
    body = (
      <>
        <SyncHeader title="Restore from sync" subtitle={where} onBack={back} focusBack={!versions?.length} />
        {errorNote}
        {!versions && busy ? <SyncNote>Loading…</SyncNote> : null}
        {versions && !versions.length ? <SyncNote>No backups in this folder yet.</SyncNote> : null}
        {versions?.length ? (
          <SettingsSection title="Backups">
            {versions.map((version, index) => (
              <SettingsRow
                key={version.name}
                title={when(version.createdAt)}
                description={[
                  version.device === thisDeviceSlug ? 'This device' : deviceLabel(version.device),
                  version.size ? formatDownloadBytes(version.size) : '',
                  version.encrypted ? 'With sign-ins' : 'Without sign-ins',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                icon={version.encrypted ? 'lock-outline' : 'file-outline'}
                hasTVPreferredFocus={index === 0}
                divider={index < versions.length - 1}
                onPress={() => pick(version)}
              />
            ))}
          </SettingsSection>
        ) : null}
      </>
    );
  } else if (mode === 'restore' && picked) {
    body = (
      <>
        <SyncHeader title="Restore" subtitle={`${when(picked.createdAt)} · ${deviceLabel(picked.device)}`} onBack={back} focusBack={false} />
        {picked.encrypted ? (
          <>
            <SyncNote>This backup has sign-ins. Enter its passphrase to restore them.</SyncNote>
            <SyncField label="Passphrase" value={restorePassphrase} onChangeText={setRestorePassphrase} secureTextEntry />
          </>
        ) : (
          <SyncNote>This backup has no sign-ins. Sign-ins on this device stay as they are.</SyncNote>
        )}
        {errorNote}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Button hasTVPreferredFocus={isTV} disabled={busy} onPress={() => confirmRestore('merge')}>
            {busy ? 'Restoring…' : 'Add to this device'}
          </Button>
          <Button variant="tonal" disabled={busy} onPress={() => confirmRestore('replace')}>
            Replace what's here
          </Button>
          {picked.encrypted ? (
            <Button variant="text" disabled={busy} onPress={() => confirmRestore('merge', true)}>
              Add without sign-ins
            </Button>
          ) : null}
        </View>
      </>
    );
  } else {
    body = (
      <>
        <SyncHeader title="Backup sync" subtitle="Back up to a WebDAV folder and restore on any device" onBack={back} />
        <SettingsSection title="Folder">
          <SettingsRow
            title="WebDAV folder"
            description={where || (target ? 'The saved source is gone. Choose a folder again.' : 'Not set')}
            icon="folder-network-outline"
            divider={false}
            onPress={() => {
              setError('');
              setMode('target');
            }}
          />
        </SettingsSection>
        <SettingsSection title="Sign-ins">
          <SettingsRow
            title="Sync passphrase"
            description={
              hasPassphrase
                ? 'Set. Sign-ins, keys and passwords are backed up encrypted.'
                : 'Not set. Sign-ins, keys and passwords are left out of backups.'
            }
            icon={hasPassphrase ? 'lock-outline' : 'lock-open-outline'}
            divider={false}
            onPress={() => {
              setError('');
              setMode('passphrase');
            }}
          />
        </SettingsSection>
        <SettingsSection title="Back up">
          <SettingsRow
            title={busy ? 'Backing up…' : 'Back up now'}
            description={status}
            icon="cloud-upload-outline"
            onPress={target ? backUp : () => setMode('target')}
          />
          <SettingsRow title="Automatic backup" description={AUTO_LABELS[auto]} icon="update" onPress={cycleAuto} />
          <SettingsSwitchRow
            title="Wi-Fi only"
            description="Automatic backups wait for Wi-Fi or Ethernet"
            value={wifiOnly}
            onValueChange={value => {
              writeWifiOnly(value);
              setWifiOnly(value);
            }}
          />
          <SettingsRow
            title="Versions to keep"
            description={`The last ${keep} backups of this device`}
            icon="layers-outline"
            divider={false}
            onPress={cycleKeep}
          />
        </SettingsSection>
        {errorNote}
        <SettingsSection title="Restore">
          <SettingsRow
            title="Restore from sync"
            description="Pick a backup from this folder, from any device"
            icon="cloud-download-outline"
            divider={false}
            onPress={target ? openVersions : () => setMode('target')}
          />
        </SettingsSection>
      </>
    );
  }

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <SettingsPage key={mode}>{body}</SettingsPage>
    </TVFocusGuide>
  );
}
