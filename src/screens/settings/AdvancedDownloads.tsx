/**
 * Settings > Advanced downloads: rare download options, off the main pages.
 *
 * To add an option, add an entry to ADVANCED_DOWNLOAD_SECTIONS: a key, a
 * section title and a component that renders its rows. Each child of a
 * section is one row on the page.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import SettingsPage from '../../components/ui/SettingsPage';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {
  advancedDownloadSettings,
  listFtpAccounts,
  parseFtpUrl,
  removeFtpAccount,
  saveFtpAccount,
} from '../../lib/downloadEngine/engineStore';
import {MIRROR_HOSTS, validateMirrorRule, type MirrorRule} from '../../lib/downloadEngine/mirrors';
import {isSmbPlaybackTesting, setSmbPlaybackTesting} from '../../lib/sources/smb';
import {useM3Colors} from '../../theme/M3PaletteContext';

const Note = ({children}: {children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 12}}>
      {children}
    </AppText>
  );
};

const useInputStyle = () => {
  const colors = useM3Colors();
  return {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    marginTop: 8,
  };
};

const ItemRow = ({title, subtitle, onRemove, removeLabel}: {title: string; subtitle?: string; onRemove: () => void; removeLabel: string}) => {
  const colors = useM3Colors();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant}}>
      <View style={{flex: 1}}>
        <AppText role="bodyLarge" numberOfLines={1} style={{color: colors.onSurface}}>{title}</AppText>
        {subtitle ? <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurfaceVariant}}>{subtitle}</AppText> : null}
      </View>
      <IconButton icon="delete-outline" label={removeLabel} onPress={onRemove} />
    </View>
  );
};

// ---- Links ----

const LinkSection = () => {
  const [refresh, setRefresh] = useState(advancedDownloadSettings.autoRefreshLinks());
  return (
    <SettingsSection title="Links">
      <SettingsSwitchRow
        title="Renew expired links"
        description="When a provider or debrid link expires, get a new one and continue from the saved part, if it is the same file."
        value={refresh}
        onValueChange={value => {
          advancedDownloadSettings.setAutoRefreshLinks(value);
          setRefresh(value);
        }}
      />
    </SettingsSection>
  );
};

// ---- Mirrors ----

const MirrorSection = () => {
  const inputStyle = useInputStyle();
  const colors = useM3Colors();
  const [enabled, setEnabled] = useState(advancedDownloadSettings.mirrorsEnabled());
  const [rules, setRules] = useState<MirrorRule[]>(advancedDownloadSettings.mirrorRules());
  const [match, setMatch] = useState('');
  const [mirror, setMirror] = useState('');
  const [error, setError] = useState('');
  const save = (next: MirrorRule[]) => {
    advancedDownloadSettings.setMirrorRules(next);
    setRules(next);
  };
  const add = () => {
    const result = validateMirrorRule(match, mirror);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    save([...rules.filter(rule => rule.match !== result.rule.match), {id: `m${Date.now()}`, ...result.rule}]);
    setMatch('');
    setMirror('');
    setError('');
  };
  return (
    <SettingsSection title="Mirrors">
      <SettingsSwitchRow
        title="Use mirrors"
        description={`Downloads from ${MIRROR_HOSTS.join(', ')} go through your mirror. If the mirror fails, the original link is used.`}
        value={enabled}
        onValueChange={value => {
          advancedDownloadSettings.setMirrorsEnabled(value);
          setEnabled(value);
        }}
      />
      {rules.map(rule => (
        <ItemRow key={rule.id} title={rule.match} subtitle={`→ ${rule.mirror}`} removeLabel={`Remove mirror for ${rule.match}`} onRemove={() => save(rules.filter(item => item.id !== rule.id))} />
      ))}
      <View style={{padding: 16}}>
        <AppText role="bodyMedium" style={{color: colors.onSurface}}>Add a mirror</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
          A host (github.com) or the start of a link (https://github.com/). That part of the link is replaced by the mirror address.
        </AppText>
        <TextInput
          value={match}
          onChangeText={setMatch}
          placeholder="https://github.com/"
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="Host or link start"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={inputStyle}
        />
        <TextInput
          value={mirror}
          onChangeText={setMirror}
          placeholder="https://my-mirror.example/https://github.com/"
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="Mirror address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={add}
          style={inputStyle}
        />
        {error ? <AppText role="bodySmall" style={{color: colors.error, marginTop: 6}}>{error}</AppText> : null}
        <View style={{flexDirection: 'row', marginTop: 10}}>
          <Button onPress={add} accessibilityLabel="Add mirror">Add</Button>
        </View>
      </View>
    </SettingsSection>
  );
};

// ---- FTP ----

const FtpSection = () => {
  const inputStyle = useInputStyle();
  const colors = useM3Colors();
  const [passive, setPassive] = useState(advancedDownloadSettings.ftpPassive());
  const [accounts, setAccounts] = useState(() => listFtpAccounts());
  const [link, setLink] = useState('');
  const [password, setPassword] = useState('');
  const add = () => {
    const parsed = parseFtpUrl(link.includes('://') ? link : `ftp://${link}`);
    if (!parsed || parsed.user === 'anonymous') {
      ToastAndroid.show('Enter the server as ftp://user@host (or ftps://, ftpes://).', ToastAndroid.LONG);
      return;
    }
    saveFtpAccount(parsed, password || parsed.password || '');
    setAccounts(listFtpAccounts());
    setLink('');
    setPassword('');
  };
  return (
    <SettingsSection title="FTP">
      <SettingsSwitchRow
        title="Passive mode"
        description="Works behind most routers. Turn it off only if your server needs active mode."
        value={passive}
        onValueChange={value => {
          advancedDownloadSettings.setFtpPassive(value);
          setPassive(value);
        }}
      />
      <Note>
        ftp:// links are not encrypted. Use ftpes:// for TLS on the normal port, or ftps:// for implicit TLS (port 990). Several connections are used only if the server allows them.
      </Note>
      {accounts.map(account => (
        <ItemRow
          key={account.key}
          title={`${account.user}@${account.host}`}
          subtitle={`${account.scheme}:// port ${account.port}`}
          removeLabel={`Remove sign-in for ${account.user} at ${account.host}`}
          onRemove={() => {
            removeFtpAccount(account.key);
            setAccounts(listFtpAccounts());
          }}
        />
      ))}
      <View style={{padding: 16}}>
        <AppText role="bodyMedium" style={{color: colors.onSurface}}>Add a sign-in</AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
          Passwords are kept in encrypted storage. Links with a password in them are saved here too.
        </AppText>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="ftp://user@server.example:21"
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="FTP server"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={inputStyle}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.onSurfaceVariant}
          accessibilityLabel="FTP password"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onSubmitEditing={add}
          style={inputStyle}
        />
        <View style={{flexDirection: 'row', marginTop: 10}}>
          <Button onPress={add} accessibilityLabel="Save FTP sign-in">Save</Button>
        </View>
      </View>
    </SettingsSection>
  );
};

// ---- Recording ----

const RecordingSection = () => {
  const [ts, setTs] = useState(advancedDownloadSettings.recordAsTs());
  return (
    <SettingsSection title="Live TV recording">
      <SettingsSwitchRow
        title="Save recordings as TS"
        description="TS keeps what was saved if the app stops while saving. MP4 plays everywhere."
        value={ts}
        onValueChange={value => {
          advancedDownloadSettings.setRecordAsTs(value);
          setTs(value);
        }}
      />
      <Note>Recordings of DRM-protected channels are not possible.</Note>
    </SettingsSection>
  );
};

// ---- Testing ----

const TestingSection = () => {
  const [smb, setSmb] = useState(isSmbPlaybackTesting);
  return (
    <SettingsSection title="Testing">
      <SettingsSwitchRow
        title="Try SMB playback (testing)"
        description="Play videos from SMB shares in Sources. Seeking in large files is still being tested."
        value={smb}
        onValueChange={value => {
          setSmbPlaybackTesting(value);
          setSmb(value);
        }}
      />
    </SettingsSection>
  );
};

/** The page: one entry per section, in order. */
export const ADVANCED_DOWNLOAD_SECTIONS: {key: string; Component: React.ComponentType}[] = [
  {key: 'links', Component: LinkSection},
  {key: 'mirrors', Component: MirrorSection},
  {key: 'ftp', Component: FtpSection},
  {key: 'recording', Component: RecordingSection},
  {key: 'testing', Component: TestingSection},
];

const AdvancedDownloads = () => {
  const colors = useM3Colors();
  return (
    <SettingsPage>
      <View key="intro" style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16}}>
        <MaterialCommunityIcons name="download-network-outline" size={22} color={colors.primary} />
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, flex: 1}}>
          Options most people never need. Changes apply to downloads that start after them.
        </AppText>
      </View>
      {ADVANCED_DOWNLOAD_SECTIONS.map(({key, Component}) => (
        <Component key={key} />
      ))}
    </SettingsPage>
  );
};

export default AdvancedDownloads;
