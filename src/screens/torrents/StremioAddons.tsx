import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ActivityIndicator, Image, Linking, ScrollView, Switch, View} from 'react-native';
import {readText} from '../../lib/clipboard';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {installRepo, readPlugins, removeRepo, runPlugin, setPluginEnabled, type ScriptPlugin} from '../../lib/jsPlugins';
import {fetchStreams, installAddon, readAddons, removeAddon, setAddonEnabled, SUGGESTED_ADDONS, type InstalledAddon} from '../../lib/stremio';
import {toast} from '../../lib/torrentSearch/actions';
import {useM3Colors} from '../../theme/M3PaletteContext';

const StremioAddons = () => {
  const colors = useM3Colors();
  const [addons, setAddons] = useState<InstalledAddon[]>(readAddons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [plugins, setPlugins] = useState<ScriptPlugin[]>(readPlugins);
  const [repoUrl, setRepoUrl] = useState('');

  const addRepo = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const added = await installRepo(value);
      setPlugins(readPlugins());
      setRepoUrl('');
      toast(`Added ${added.length} ${added.length === 1 ? 'plugin' : 'plugins'}. Turn on the ones you want.`);
    } catch (error: any) {
      toast(error?.message || 'Could not add that repository');
    } finally {
      setBusy(false);
    }
  };

  const testPlugin = async (plugin: ScriptPlugin) => {
    const key = `${plugin.repoUrl}:${plugin.id}`;
    setTests(current => ({...current, [key]: 'Testing…'}));
    const started = Date.now();
    try {
      // The Matrix on TMDB, or Game of Thrones S1:E1 for series-only plugins.
      const request = plugin.types.includes('movie') ? {tmdbId: 603, mediaType: 'movie' as const} : {tmdbId: 1399, mediaType: 'tv' as const, season: 1, episode: 1};
      const streams = await runPlugin(plugin, request);
      setTests(current => ({...current, [key]: `OK, ${streams.length} ${streams.length === 1 ? 'stream' : 'streams'} in ${((Date.now() - started) / 1000).toFixed(1)}s`}));
    } catch (error: any) {
      setTests(current => ({...current, [key]: `Failed: ${error?.message || error}`}));
    }
  };

  const repos = Array.from(new Set(plugins.map(plugin => plugin.repoUrl)));

  const add = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const addon = await installAddon(value);
      setAddons(readAddons());
      setUrl('');
      toast(`Added ${addon.manifest.name}`);
    } catch (error: any) {
      toast(error?.message || 'Could not add that add-on');
    } finally {
      setBusy(false);
    }
  };

  const test = async (addon: InstalledAddon) => {
    setTests(current => ({...current, [addon.base]: 'Testing…'}));
    // The Shawshank Redemption: every movie add-on knows it.
    const [result] = await fetchStreams('movie', 'tt0111161', [addon]);
    setTests(current => ({...current, [addon.base]: !result ? 'No streams for movies' : result.error ? `Failed: ${result.error}` : `OK, ${result.streams.length} streams in ${(result.ms / 1000).toFixed(1)}s`}));
  };

  const resources = (addon: InstalledAddon) =>
    Array.from(new Set(addon.manifest.resources.map(entry => (typeof entry === 'string' ? entry : entry.name)))).join(', ');

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Add-ons and plugins</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        Droid Stream speaks the open Stremio add-on protocol, so add-ons like Torrentio, Comet, and MediaFusion add streams to Find streams. Configured add-ons often include your debrid key and return links that play at once. Add-on URLs stay encrypted on this phone.
      </AppText>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 16}}>
        <TextInput accessibilityLabel="Add-on URL" value={url} onChangeText={setUrl} placeholder="https://…/manifest.json or stremio://…" placeholderTextColor={colors.outline}
          autoCapitalize="none" autoCorrect={false} style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
        <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
          <Chip label="Paste" icon="clipboard-text" onPress={async () => setUrl(await readText())} />
          <Chip label="Add" icon="plus" onPress={() => add(url)} />
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </View>

      <AppText role="titleMedium" style={{color: colors.primary, marginTop: 20, marginBottom: 8}}>Popular add-ons</AppText>
      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 4}}>
        {SUGGESTED_ADDONS.map(item => (
          <View key={item.name} style={{paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.outlineVariant}}>
            <AppText role="bodyLarge" style={{color: colors.onSurface}}>{item.name}</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{item.note}</AppText>
            <View style={{flexDirection: 'row', gap: 8, marginTop: 6}}>
              {item.manifest ? <Chip label="Add" icon="plus" onPress={() => add(item.manifest)} /> : null}
              {item.configure ? <Chip label="Configure" icon="open-in-new" onPress={() => Linking.openURL(item.configure)} /> : null}
            </View>
          </View>
        ))}
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, padding: 12}}>
          After you configure an add-on in the browser, copy its install link (it ends in manifest.json) and paste it above.
        </AppText>
      </View>

      <AppText role="titleMedium" style={{color: colors.primary, marginTop: 20, marginBottom: 8}}>Installed</AppText>
      {!addons.length ? <AppText style={{color: colors.onSurfaceVariant}}>No add-ons yet.</AppText> : null}
      {addons.map(addon => (
        <View key={addon.base} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginBottom: 8}}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            {addon.manifest.logo ? <Image source={{uri: addon.manifest.logo}} style={{width: 36, height: 36, borderRadius: 8, marginRight: 12}} /> : <MaterialCommunityIcons name="puzzle" size={28} color={colors.primary} style={{marginRight: 12}} />}
            <View style={{flex: 1}}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>{addon.manifest.name}{addon.manifest.version ? ` ${addon.manifest.version}` : ''}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{resources(addon)} · {addon.manifest.types.join(', ')}</AppText>
            </View>
            <Switch accessibilityLabel={`Use ${addon.manifest.name}`} value={addon.enabled} onValueChange={value => { setAddonEnabled(addon.base, value); setAddons(readAddons()); }} thumbColor={addon.enabled ? colors.primary : undefined} />
          </View>
          {addon.manifest.description ? <AppText role="bodySmall" numberOfLines={3} style={{color: colors.onSurfaceVariant, marginTop: 6}}>{addon.manifest.description}</AppText> : null}
          {tests[addon.base] ? <AppText role="bodySmall" style={{color: colors.onSurface, marginTop: 6}}>{tests[addon.base]}</AppText> : null}
          <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
            <Chip label="Test" icon="play-circle-outline" onPress={() => test(addon)} />
            {addon.manifest.behaviorHints?.configurable ? <Chip label="Configure" icon="cog" onPress={() => Linking.openURL(`${addon.base}/configure`)} /> : null}
            <Chip label="Remove" icon="delete-outline" tone="warn" onPress={() => { removeAddon(addon.base); setAddons(readAddons()); }} />
          </View>
        </View>
      ))}

      <AppText role="titleMedium" style={{color: colors.primary, marginTop: 20}}>Script plugins</AppText>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2, marginBottom: 8}}>
        Add a plugin repository in the Nuvio format and its plugins add streams to Find streams. Plugins are code from the repository you add. They run in the app's sandbox and start switched off, so only add repositories you trust.
      </AppText>
      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12}}>
        <TextInput accessibilityLabel="Plugin repository URL" value={repoUrl} onChangeText={setRepoUrl} placeholder="https://…/manifest.json" placeholderTextColor={colors.outline}
          autoCapitalize="none" autoCorrect={false} style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
        <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
          <Chip label="Paste" icon="clipboard-text" accessibilityLabel="Paste repository URL" onPress={async () => setRepoUrl(await readText())} />
          <Chip label="Add repository" icon="plus" onPress={() => addRepo(repoUrl)} />
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </View>
      {repos.map(repo => (
        <View key={repo} style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 8}}>
          <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurfaceVariant}}>{repo}</AppText>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4}}>
            <Chip label="Refresh" icon="refresh" onPress={() => addRepo(repo)} />
            <Chip label="Remove" icon="delete-outline" tone="warn" accessibilityLabel="Remove repository" onPress={() => { removeRepo(repo); setPlugins(readPlugins()); }} />
          </View>
          {plugins.filter(plugin => plugin.repoUrl === repo).map(plugin => {
            const key = `${plugin.repoUrl}:${plugin.id}`;
            return (
              <View key={key} style={{paddingVertical: 8, borderTopWidth: 1, borderColor: colors.outlineVariant, marginTop: 4}}>
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <View style={{flex: 1}}>
                    <AppText role="bodyLarge" style={{color: colors.onSurface}}>{plugin.name}{plugin.version ? ` · v${plugin.version}` : ''}</AppText>
                    {plugin.description ? <AppText role="bodySmall" numberOfLines={2} style={{color: colors.onSurfaceVariant}}>{plugin.description}</AppText> : null}
                  </View>
                  <Switch accessibilityLabel={`Use ${plugin.name}`} value={plugin.enabled} onValueChange={value => { setPluginEnabled(plugin, value); setPlugins(readPlugins()); }} thumbColor={plugin.enabled ? colors.primary : undefined} />
                </View>
                {tests[key] ? <AppText role="bodySmall" style={{color: colors.onSurface, marginTop: 4}}>{tests[key]}</AppText> : null}
                <View style={{flexDirection: 'row', marginTop: 6}}>
                  <Chip label="Test" icon="play-circle-outline" accessibilityLabel={`Test ${plugin.name}`} onPress={() => testPlugin(plugin)} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
};

export default StremioAddons;
