import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, ToastAndroid, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText from '../../components/ui/Text';
import {getDownloadLocationDisplayValue, selectDownloadLocation} from '../../lib/downloadLocation';
import {settingsStorage} from '../../lib/storage';
import {sanitizeCustomArgs, splitArgs} from '../../lib/ytdl/args';
import {
  ytdlClearCookies,
  ytdlCookieSites,
  ytdlLatestVersion,
  ytdlResetToBundled,
  ytdlStatus,
  ytdlUpdate,
} from '../../lib/ytdl/native';
import {readYtdlSettings, updateYtdlSettings, type YtdlSettings as Settings} from '../../lib/ytdl/settings';
import type {
  YtdlAudioFormat,
  YtdlContainer,
  YtdlKind,
  YtdlSponsorMode,
  YtdlStatus,
  YtdlSubtitleMode,
} from '../../lib/ytdl/types';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {ChipRow, Choice, Field, Section, ToggleRow} from './components';

const YtdlSettings = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const [settings, setSettings] = useState<Settings>(readYtdlSettings);
  const [status, setStatus] = useState<YtdlStatus | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [location, setLocation] = useState(getDownloadLocationDisplayValue(settingsStorage.getDownloadLocationConfig()));
  const [templateName, setTemplateName] = useState('');
  const [templateArgs, setTemplateArgs] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [languagesText, setLanguagesText] = useState(settings.subtitleLanguages.join(', '));

  const save = (patch: Partial<Settings>) => setSettings(updateYtdlSettings(patch));

  const refresh = useCallback(() => {
    ytdlStatus().then(setStatus).catch(error => setStatus({available: false, error: String(error)}));
    ytdlCookieSites().then(setSites).catch(() => setSites([]));
  }, []);

  useFocusEffect(refresh);

  const run = async (name: string, task: () => Promise<void>) => {
    setBusy(name);
    try {
      await task();
    } catch (error) {
      ToastAndroid.show(error instanceof Error ? error.message : String(error), ToastAndroid.LONG);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const checkUpdate = () =>
    run('check', async () => {
      const version = await ytdlLatestVersion();
      setLatest(version);
      if (version === status?.version) ToastAndroid.show('yt-dlp is up to date', ToastAndroid.SHORT);
    });

  const update = () =>
    run('update', async () => {
      const result = await ytdlUpdate();
      ToastAndroid.show(
        !result.updated
          ? 'yt-dlp is up to date'
          : result.pending
            ? `yt-dlp ${result.version} is ready. It is used once the current downloads finish.`
            : `Updated to yt-dlp ${result.version}`,
        ToastAndroid.LONG,
      );
    });

  const reset = () =>
    run('reset', async () => {
      await ytdlResetToBundled();
      ToastAndroid.show('Using the yt-dlp that came with the app', ToastAndroid.SHORT);
    });

  const pickFolder = async () => {
    const picked = await selectDownloadLocation().catch(() => undefined);
    if (!picked) return;
    settingsStorage.setDownloadLocation(picked);
    setLocation(getDownloadLocationDisplayValue(picked));
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name || !templateArgs.trim()) {
      ToastAndroid.show('A template needs a name and options', ToastAndroid.SHORT);
      return;
    }
    let parsed: string[];
    try {
      parsed = splitArgs(templateArgs);
    } catch (error) {
      ToastAndroid.show(error instanceof Error ? error.message : String(error), ToastAndroid.SHORT);
      return;
    }
    const {removed} = sanitizeCustomArgs(parsed);
    const id = editingId || `t${Date.now().toString(36)}`;
    const templates = [
      ...settings.templates.filter(item => item.id !== id),
      {id, name, args: templateArgs.trim()},
    ];
    save({templates});
    setTemplateName('');
    setTemplateArgs('');
    setEditingId(null);
    if (removed.length) {
      ToastAndroid.show(`The app sets these itself and ignores them: ${removed.join(', ')}`, ToastAndroid.LONG);
    }
  };

  const deleteTemplate = (id: string) =>
    save({
      templates: settings.templates.filter(item => item.id !== id),
      defaultTemplateId: settings.defaultTemplateId === id ? '' : settings.defaultTemplateId,
    });

  const updateAvailable = Boolean(latest && status?.version && latest !== status.version);

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}}>Video downloader</AppText>
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <Section title="yt-dlp" hint="Downloads videos and audio from YouTube and many other sites.">
          {status ? (
            <>
              <AppText role="bodyMedium" style={{color: status.available ? colors.onSurface : colors.error}}>
                {status.available
                  ? `Version ${status.version}${status.source === 'updated' ? ' (updated)' : ' (came with the app)'}`
                  : status.error || 'Not available'}
              </AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
                {[
                  status.python ? `Python ${status.python}` : null,
                  status.jsSandbox ? 'YouTube challenges: JavaScript sandbox' : 'YouTube challenges: no JavaScript sandbox (update Android System WebView)',
                  status.pendingVersion ? `Version ${status.pendingVersion} starts after the current downloads` : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </AppText>
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
          {latest ? (
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
              Newest release: {latest}
            </AppText>
          ) : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'flex-end'}}>
            {status?.source === 'updated' ? (
              <Button variant="text" compact disabled={Boolean(busy)} onPress={reset}>Use bundled version</Button>
            ) : null}
            <Button variant="tonal" compact disabled={Boolean(busy)} onPress={checkUpdate}>
              {busy === 'check' ? 'Checking…' : 'Check for update'}
            </Button>
            <Button compact disabled={Boolean(busy) || (latest !== null && !updateAvailable)} onPress={update}>
              {busy === 'update' ? 'Updating…' : 'Update yt-dlp'}
            </Button>
          </View>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
            Updates come from github.com/yt-dlp/yt-dlp and are checked against the release&apos;s SHA-256 list.
          </AppText>
        </Section>

        <Section title="Saving">
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>Download location</AppText>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12}}>
            <AppText role="bodyMedium" style={{color: colors.onSurface, flex: 1}} numberOfLines={2}>{location}</AppText>
            <Button variant="tonal" compact onPress={pickFolder}>Change</Button>
          </View>
          <Field
            label="Folder inside it"
            value={settings.folderName}
            onChangeText={folderName => save({folderName})}
            placeholder="Video downloads"
          />
          <ToggleRow
            label="Open the Download sheet for shared links"
            description="Share a page from YouTube, Instagram, X or a browser to Droid Stream"
            value={settings.offerForAllLinks}
            onChange={offerForAllLinks => save({offerForAllLinks})}
          />
        </Section>

        <Section title="Defaults" hint="The Download sheet starts with these. It also remembers your last choices.">
          <Choice<YtdlKind> options={[{value: 'video', label: 'Video'}, {value: 'audio', label: 'Audio only'}]} value={settings.kind} onChange={kind => save({kind})} />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>Video quality</AppText>
          <Choice<number | null>
            options={[null, 2160, 1440, 1080, 720, 480, 360].map(value => ({value, label: value ? `${value}p` : 'Best'}))}
            value={settings.maxHeight}
            onChange={maxHeight => save({maxHeight})}
          />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>Video file type</AppText>
          <Choice<YtdlContainer> options={[{value: 'mp4', label: 'MP4'}, {value: 'mkv', label: 'MKV'}]} value={settings.container} onChange={container => save({container})} />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>Audio format</AppText>
          <Choice<YtdlAudioFormat>
            options={[{value: 'm4a', label: 'M4A'}, {value: 'mp3', label: 'MP3'}, {value: 'opus', label: 'Opus'}, {value: 'best', label: 'Original'}]}
            value={settings.audioFormat}
            onChange={audioFormat => save({audioFormat})}
          />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>Subtitles</AppText>
          <Choice<YtdlSubtitleMode>
            options={[{value: 'off', label: 'None'}, {value: 'embed', label: 'In the video'}, {value: 'separate', label: 'Separate files'}]}
            value={settings.subtitleMode}
            onChange={subtitleMode => save({subtitleMode})}
          />
          <View style={{marginTop: 10}}>
            <Field
              label="Subtitle languages (codes, such as en, hi)"
              value={languagesText}
              onChangeText={value => {
                setLanguagesText(value);
                save({subtitleLanguages: value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)});
              }}
            />
          </View>
          <ToggleRow label="Automatic captions" value={settings.autoSubtitles} onChange={autoSubtitles => save({autoSubtitles})} />
          <ToggleRow label="Cover image" value={settings.embedThumbnail} onChange={embedThumbnail => save({embedThumbnail})} />
          <ToggleRow label="Details" value={settings.embedMetadata} onChange={embedMetadata => save({embedMetadata})} />
          <ToggleRow label="Chapters" value={settings.embedChapters} onChange={embedChapters => save({embedChapters})} />
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>SponsorBlock</AppText>
          <Choice<YtdlSponsorMode>
            options={[{value: 'off', label: 'Off'}, {value: 'remove', label: 'Cut out'}, {value: 'mark', label: 'Mark'}]}
            value={settings.sponsorBlock}
            onChange={sponsorBlock => save({sponsorBlock})}
          />
          <View style={{marginTop: 10}}>
            <Field label="Speed limit (such as 2M, empty for none)" value={settings.rateLimit} onChangeText={rateLimit => save({rateLimit: rateLimit.trim()})} />
          </View>
        </Section>

        <Section title="Cookies" hint="Sign in to a site in the app's browser to download what needs an account. The cookies stay in the app's own storage.">
          {sites.length > 0 ? (
            <ChipRow>
              {sites.map(site => (
                <Chip
                  key={site}
                  label={site}
                  icon="close"
                  accessibilityLabel={`Remove cookies for ${site}`}
                  onPress={() => run('cookies', () => ytdlClearCookies(site))}
                />
              ))}
            </ChipRow>
          ) : (
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>No cookies saved.</AppText>
          )}
          <View style={{flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap'}}>
            {sites.length > 0 ? (
              <Button
                variant="text"
                compact
                onPress={() =>
                  showAppDialog({
                    title: 'Remove all cookies?',
                    message: 'yt-dlp will no longer be signed in to these sites. The sign-in browser keeps its own session until you sign out there.',
                    actions: [{label: 'Cancel'}, {label: 'Remove', variant: 'primary', onPress: () => run('cookies', () => ytdlClearCookies())}],
                  })
                }>
                Remove all
              </Button>
            ) : null}
            <Button variant="tonal" compact onPress={() => (navigation.navigate as (screen: string) => void)('YtdlCookies')}>
              Sign in to a site
            </Button>
          </View>
        </Section>

        <Section title="Templates" hint="Saved yt-dlp options, written as on a command line. Pick one in the Download sheet, or use one for every download.">
          {settings.templates.map(item => (
            <View key={item.id} style={{marginBottom: 12}}>
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>{item.name}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, fontFamily: 'monospace'}}>{item.args}</AppText>
              <ChipRow>
                <Chip
                  label={settings.defaultTemplateId === item.id ? 'Used for every download' : 'Use for every download'}
                  selected={settings.defaultTemplateId === item.id}
                  onPress={() => save({defaultTemplateId: settings.defaultTemplateId === item.id ? '' : item.id})}
                />
                <Chip
                  label="Edit"
                  onPress={() => {
                    setEditingId(item.id);
                    setTemplateName(item.name);
                    setTemplateArgs(item.args);
                  }}
                />
                <Chip label="Delete" onPress={() => deleteTemplate(item.id)} />
              </ChipRow>
            </View>
          ))}
          <Field label="Name" value={templateName} onChangeText={setTemplateName} placeholder="Small files" />
          <View style={{marginTop: 8}}>
            <Field
              label="yt-dlp options"
              value={templateArgs}
              onChangeText={setTemplateArgs}
              placeholder='-S "res:480,codec:h264" --limit-rate 1M'
              multiline
            />
          </View>
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12}}>
            {editingId ? (
              <Button
                variant="text"
                compact
                onPress={() => {
                  setEditingId(null);
                  setTemplateName('');
                  setTemplateArgs('');
                }}>
                Cancel
              </Button>
            ) : null}
            <Button variant="tonal" compact onPress={saveTemplate}>{editingId ? 'Save template' : 'Add template'}</Button>
          </View>
        </Section>
      </ScrollView>
    </ScreenSafeArea>
  );
};

export default YtdlSettings;
