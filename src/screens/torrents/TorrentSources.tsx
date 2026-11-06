import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useRef, useState} from 'react';
import {Pressable, Share, Switch, ToastAndroid, View, type TextInputInstance} from 'react-native';
import KeyboardForm from '../../components/ui/KeyboardForm';
import {copyText, readText} from '../../lib/clipboard';
import {RawTextInput as TextInput} from '../../components/ui/Text';
import Chip from '../../components/torrentSearch/Chip';
import AppText from '../../components/ui/Text';
import {ADAPTER_CATALOG, exportAdapters, importAdapters, validateAdapter, type AdapterType, type SiteAdapter} from '../../lib/torrentSearch/engines/custom';
import {BUILT_IN_ENGINES, customEngine, torznabEngine} from '../../lib/torrentSearch/engines';
import {engineErrorText} from '../../lib/torrentSearch/util';
import {engineBaseUrl, engineEnabled, testEngine} from '../../lib/torrentSearch/search';
import {readSearchSettings, writeSearchSettings, type TorrentSearchSettings} from '../../lib/torrentSearch/store';
import type {EngineStatus, TorrentEngine} from '../../lib/torrentSearch/types';
import {useM3Colors} from '../../theme/M3PaletteContext';

const toast = (text: string) => ToastAndroid.show(text, ToastAndroid.LONG);

const Section = ({title, children}: {title: string; children: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <View style={{marginTop: 20}}>
      <AppText role="titleMedium" style={{color: colors.primary, marginBottom: 8}}>{title}</AppText>
      <View style={{backgroundColor: colors.surfaceContainer, borderRadius: 20, padding: 4}}>{children}</View>
    </View>
  );
};

const Input = (props: React.ComponentProps<typeof TextInput> & {label: string}) => {
  const colors = useM3Colors();
  return (
    <View style={{marginBottom: 8}}>
      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>{props.label}</AppText>
      <TextInput accessibilityLabel={props.label} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.outline} {...props}
        style={[{color: colors.onSurface, minHeight: 44, borderBottomWidth: 1, borderColor: colors.outlineVariant}, props.style]} />
    </View>
  );
};

const TorrentSources = () => {
  const colors = useM3Colors();
  const [settings, setSettings] = useState<TorrentSearchSettings>(readSearchSettings);
  const [open, setOpen] = useState<string>();
  const [tests, setTests] = useState<Record<string, EngineStatus>>({});
  const [editor, setEditor] = useState<'torznab' | 'adapter' | 'import' | 'catalog'>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const torznabUrl = useRef<TextInputInstance>(null);
  const torznabKey = useRef<TextInputInstance>(null);
  // Typed custom mirrors, so Test uses them even if the field still has focus.
  const pendingMirror = useRef<Record<string, string>>({});

  const save = (next: TorrentSearchSettings) => {
    setSettings(next);
    writeSearchSettings(next);
  };
  const setEngine = (id: string, patch: {enabled?: boolean; mirror?: string}) =>
    save({...settings, engines: {...settings.engines, [id]: {...settings.engines[id], enabled: patch.enabled ?? settings.engines[id]?.enabled ?? true, ...(patch.mirror ? {mirror: patch.mirror} : {})}}});

  const runTest = async (engine: TorrentEngine) => {
    setTests(current => ({...current, [engine.id]: {engine: engine.id, state: 'loading', count: 0, ms: 0}}));
    const result = await testEngine(engine, draft.testQuery || undefined);
    setTests(current => ({...current, [engine.id]: result}));
  };

  const row = (engine: TorrentEngine, removable?: () => void) => {
    const on = engineEnabled(engine, settings);
    const test = tests[engine.id];
    const expanded = open === engine.id;
    return (
      <View key={engine.id} style={{borderBottomWidth: 1, borderColor: colors.outlineVariant, paddingHorizontal: 12, paddingVertical: 8}}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${engine.name} details`} onPress={() => setOpen(expanded ? undefined : engine.id)} style={{flex: 1, minHeight: 48, justifyContent: 'center'}}>
            <AppText role="bodyLarge" style={{color: colors.onSurface}}>{engine.name}</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
              {engine.description}
              {test ? ` · ${test.state === 'loading' ? 'testing…' : test.state === 'done' ? `OK, ${test.count} ${test.count === 1 ? 'result' : 'results'} in ${(test.ms / 1000).toFixed(1)}s` : `failed: ${engineErrorText(test.error)}`}` : ''}
            </AppText>
          </Pressable>
          <Switch accessibilityLabel={`Use ${engine.name}`} value={on} onValueChange={value => setEngine(engine.id, {enabled: value})} thumbColor={on ? colors.primary : undefined} />
        </View>
        {expanded ? (
          <View style={{paddingBottom: 8}}>
            <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>Covers: {engine.categories.join(', ')}</AppText>
            {engine.mirrors.length > 1 || !engine.id.startsWith('torznab:') ? (
              <>
                <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>Mirror</AppText>
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4}}>
                  {engine.mirrors.map(mirror => (
                    <Chip key={mirror} label={mirror.replace(/^https?:\/\//, '')} selected={engineBaseUrl(engine, settings) === mirror} onPress={() => setEngine(engine.id, {mirror, enabled: on})} />
                  ))}
                </View>
                <Input label="Custom mirror URL" placeholder="https://new-domain.example" defaultValue={engine.mirrors.includes(engineBaseUrl(engine, settings)) ? '' : engineBaseUrl(engine, settings)}
                  onChangeText={text => {
                    pendingMirror.current[engine.id] = text;
                  }}
                  keyboardType="url" returnKeyType="done"
                  onEndEditing={event => event.nativeEvent.text.trim() && setEngine(engine.id, {mirror: event.nativeEvent.text.trim(), enabled: on})} />
              </>
            ) : null}
            <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
              <Chip label="Test" icon="play-circle-outline" onPress={() => {
                const typed = pendingMirror.current[engine.id]?.trim();
                if (typed) {
                  delete pendingMirror.current[engine.id];
                  setEngine(engine.id, {mirror: typed, enabled: on});
                }
                runTest(engine);
              }} />
              {removable ? <Chip label="Remove" icon="delete-outline" tone="warn" onPress={removable} /> : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const addTorznab = () => {
    if (!/^https?:\/\//.test(draft.url || '')) return toast('Enter the Torznab URL from Jackett or Prowlarr');
    const instance = {id: `${Date.now()}`, name: draft.name || 'Jackett', url: draft.url!.trim(), apiKey: (draft.apiKey || '').trim()};
    save({...settings, torznab: [...settings.torznab, instance]});
    setEditor(undefined);
    setDraft({});
    runTest(torznabEngine(instance));
  };

  const addAdapters = (adapters: SiteAdapter[]) => {
    const ids = new Set(adapters.map(item => item.id));
    save({...settings, adapters: [...settings.adapters.filter(item => !ids.has(item.id)), ...adapters]});
    toast(`Added ${adapters.map(item => item.name).join(', ')}`);
  };

  const saveAdapter = () => {
    try {
      const selectors = draft.row ? {row: draft.row, title: draft.title || 'a', size: draft.size, seeders: draft.seeders, leechers: draft.leechers, magnet: draft.magnet} : undefined;
      const adapter = validateAdapter({
        name: draft.name,
        searchUrl: draft.searchUrl,
        type: (draft.type as AdapterType) || (selectors ? 'selectors' : 'auto'),
        spaces: draft.spaces || '+',
        detailMagnet: draft.detail === 'yes',
        selectors,
        json: draft.type === 'json' ? {list: draft.list || '', title: draft.jsonTitle || 'name', magnet: draft.jsonMagnet, hash: draft.jsonHash, size: draft.jsonSize, seeders: draft.jsonSeeders, leechers: draft.jsonLeechers} : undefined,
      });
      addAdapters([adapter]);
      setEditor(undefined);
      setDraft({});
      runTest(customEngine(adapter));
    } catch (error: any) {
      toast(error.message);
    }
  };

  const installed = new Set(settings.adapters.map(item => item.id));

  return (
    <KeyboardForm style={{backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}}>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Torrent sites</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        Turn sites on or off, switch to a working mirror when a domain changes, or add any site yourself. Every search runs on all sites at once.
      </AppText>
      <Input label="Test search words" placeholder="ubuntu" value={draft.testQuery || ''} onChangeText={testQuery => setDraft({...draft, testQuery})} />
      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        <Chip label="Test all" icon="speedometer" onPress={() => [...BUILT_IN_ENGINES, ...settings.adapters.map(customEngine), ...settings.torznab.map(torznabEngine)].filter(engine => engineEnabled(engine, settings)).forEach(runTest)} />
        <Chip label="Add more sites" icon="plus-circle-outline" selected={editor === 'catalog'} onPress={() => setEditor(editor === 'catalog' ? undefined : 'catalog')} />
        <Chip label="Custom site" icon="code-braces" selected={editor === 'adapter'} onPress={() => setEditor(editor === 'adapter' ? undefined : 'adapter')} />
        <Chip label="Jackett / Prowlarr" icon="server-network" selected={editor === 'torznab'} onPress={() => setEditor(editor === 'torznab' ? undefined : 'torznab')} />
        <Chip label="Import" icon="import" selected={editor === 'import'} onPress={() => setEditor(editor === 'import' ? undefined : 'import')} />
        {settings.adapters.length ? (
          <Chip label="Export" icon="export" onPress={() => {
            const text = exportAdapters(settings.adapters);
            copyText(text);
            Share.share({message: text, title: 'Droid Stream site adapters'}).catch(() => undefined);
          }} />
        ) : null}
      </View>

      {editor === 'catalog' ? (
        <Section title="More sites">
          {ADAPTER_CATALOG.map(adapter => (
            <View key={adapter.id} style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56, borderBottomWidth: 1, borderColor: colors.outlineVariant}}>
              <View style={{flex: 1}}>
                <AppText role="bodyLarge" style={{color: colors.onSurface}}>{adapter.name}</AppText>
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{adapter.description}</AppText>
              </View>
              {installed.has(adapter.id) ? (
                <MaterialCommunityIcons name="check" size={22} color={colors.primary} />
              ) : (
                <Chip label="Add" icon="plus" onPress={() => addAdapters([adapter])} />
              )}
            </View>
          ))}
        </Section>
      ) : null}

      {editor === 'torznab' ? (
        <Section title="Add Jackett or Prowlarr">
          <View style={{padding: 12}}>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
              Jackett: copy the Torznab feed URL of an indexer, or use /api/v2.0/indexers/all/results/torznab. Prowlarr: Indexers → an indexer → copy the Torznab URL. The API key is on the same page.
            </AppText>
            <Input label="Name" placeholder="Home Jackett" value={draft.name || ''} onChangeText={name => setDraft({...draft, name})}
              returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => torznabUrl.current?.focus()} />
            <Input ref={torznabUrl} label="Torznab URL" placeholder="http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab" value={draft.url || ''} onChangeText={url => setDraft({...draft, url})}
              keyboardType="url" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => torznabKey.current?.focus()} />
            <Input ref={torznabKey} label="API key" value={draft.apiKey || ''} onChangeText={apiKey => setDraft({...draft, apiKey})} secureTextEntry
              returnKeyType="go" onSubmitEditing={addTorznab} />
            <Chip label="Save and test" icon="content-save" onPress={addTorznab} />
          </View>
        </Section>
      ) : null}

      {editor === 'adapter' ? (
        <Section title="Custom site adapter">
          <View style={{padding: 12}}>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
              Search the site in a browser, copy the results URL, and put {'{query}'} where your words are and {'{page}'} where the page number is. Auto mode finds magnet links on the page by itself. Use CSS selectors or JSON paths for sites it cannot read.
            </AppText>
            <Input label="Name" value={draft.name || ''} onChangeText={name => setDraft({...draft, name})} />
            <Input label="Search URL" placeholder="https://example.org/search/{query}/{page}/" value={draft.searchUrl || ''} onChangeText={searchUrl => setDraft({...draft, searchUrl})} />
            <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8}}>
              {(['auto', 'selectors', 'json', 'rss'] as AdapterType[]).map(type => (
                <Chip key={type} label={type === 'rss' ? 'RSS / Torznab' : type === 'auto' ? 'Auto' : type === 'json' ? 'JSON API' : 'CSS selectors'} selected={(draft.type || 'auto') === type} onPress={() => setDraft({...draft, type})} />
              ))}
            </View>
            <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8}}>
              {['+', '%20', '-', '_'].map(spaces => (
                <Chip key={spaces} label={`Spaces as ${spaces}`} selected={(draft.spaces || '+') === spaces} onPress={() => setDraft({...draft, spaces})} />
              ))}
              <Chip label="Magnet on detail page" selected={draft.detail === 'yes'} onPress={() => setDraft({...draft, detail: draft.detail === 'yes' ? '' : 'yes'})} />
            </View>
            {draft.type === 'selectors' ? (
              <>
                <Input label="Row selector" placeholder="table tbody tr" value={draft.row || ''} onChangeText={value => setDraft({...draft, row: value})} />
                <Input label="Title selector" placeholder="td.name a" value={draft.title || ''} onChangeText={value => setDraft({...draft, title: value})} />
                <Input label="Magnet selector (optional)" placeholder='a[href^="magnet:"]' value={draft.magnet || ''} onChangeText={value => setDraft({...draft, magnet: value})} />
                <Input label="Size selector" value={draft.size || ''} onChangeText={value => setDraft({...draft, size: value})} />
                <Input label="Seeders selector" value={draft.seeders || ''} onChangeText={value => setDraft({...draft, seeders: value})} />
                <Input label="Leechers selector" value={draft.leechers || ''} onChangeText={value => setDraft({...draft, leechers: value})} />
              </>
            ) : null}
            {draft.type === 'json' ? (
              <>
                <Input label="Path to the list (empty if the reply is a list)" placeholder="data.items" value={draft.list || ''} onChangeText={value => setDraft({...draft, list: value})} />
                <Input label="Title field" placeholder="name" value={draft.jsonTitle || ''} onChangeText={value => setDraft({...draft, jsonTitle: value})} />
                <Input label="Magnet field" value={draft.jsonMagnet || ''} onChangeText={value => setDraft({...draft, jsonMagnet: value})} />
                <Input label="Info hash field" value={draft.jsonHash || ''} onChangeText={value => setDraft({...draft, jsonHash: value})} />
                <Input label="Size field" value={draft.jsonSize || ''} onChangeText={value => setDraft({...draft, jsonSize: value})} />
                <Input label="Seeders field" value={draft.jsonSeeders || ''} onChangeText={value => setDraft({...draft, jsonSeeders: value})} />
                <Input label="Leechers field" value={draft.jsonLeechers || ''} onChangeText={value => setDraft({...draft, jsonLeechers: value})} />
              </>
            ) : null}
            <Chip label="Save and test" icon="content-save" onPress={saveAdapter} />
          </View>
        </Section>
      ) : null}

      {editor === 'import' ? (
        <Section title="Import adapters">
          <View style={{padding: 12}}>
            <Input label="Paste adapter JSON" multiline value={draft.json || ''} onChangeText={json => setDraft({...draft, json})} style={{minHeight: 120, textAlignVertical: 'top'}} />
            <View style={{flexDirection: 'row', gap: 8}}>
              <Chip label="Paste from clipboard" icon="clipboard-text" onPress={async () => setDraft({...draft, json: await readText()})} />
              <Chip label="Import" icon="import" onPress={() => {
                try {
                  addAdapters(importAdapters(draft.json || ''));
                  setEditor(undefined);
                } catch (error: any) {
                  toast(error.message || 'That is not adapter JSON');
                }
              }} />
            </View>
          </View>
        </Section>
      ) : null}

      {settings.torznab.length ? (
        <Section title="Your Jackett and Prowlarr servers">
          {settings.torznab.map(instance => row(torznabEngine(instance), () => save({...settings, torznab: settings.torznab.filter(item => item.id !== instance.id)})))}
        </Section>
      ) : null}
      {settings.adapters.length ? (
        <Section title="Added sites">
          {settings.adapters.map(adapter => row(customEngine(adapter), () => save({...settings, adapters: settings.adapters.filter(item => item.id !== adapter.id)})))}
        </Section>
      ) : null}
      <Section title="Built-in sites">{BUILT_IN_ENGINES.map(engine => row(engine))}</Section>
    </KeyboardForm>
  );
};

export default TorrentSources;
