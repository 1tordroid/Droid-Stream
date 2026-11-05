import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ActivityIndicator, Clipboard, Image, Linking, ScrollView, Switch, TextInput, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {fetchStreams, installAddon, readAddons, removeAddon, setAddonEnabled, SUGGESTED_ADDONS, type InstalledAddon} from '../../lib/stremio';
import {toast} from '../../lib/torrentSearch/actions';
import {useM3Colors} from '../../theme/M3PaletteContext';

const StremioAddons = () => {
  const colors = useM3Colors();
  const [addons, setAddons] = useState<InstalledAddon[]>(readAddons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, string>>({});

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
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Stremio add-ons</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        Droid Stream speaks the open Stremio add-on protocol, so add-ons like Torrentio, Comet, and MediaFusion add streams to Find streams. Configured add-ons often include your debrid key and return links that play at once. Add-on URLs stay encrypted on this phone.
      </AppText>

      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 12, marginTop: 16}}>
        <TextInput accessibilityLabel="Add-on URL" value={url} onChangeText={setUrl} placeholder="https://…/manifest.json or stremio://…" placeholderTextColor={colors.outline}
          autoCapitalize="none" autoCorrect={false} style={{color: colors.onSurface, minHeight: 48, borderBottomWidth: 1, borderColor: colors.outlineVariant}} />
        <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
          <Chip label="Paste" icon="clipboard-text" onPress={async () => setUrl(await Clipboard.getString())} />
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
    </ScrollView>
  );
};

export default StremioAddons;
