import React, {useState} from 'react';
import {ScrollView, ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import Surface from '../../components/ui/Surface';
import {formatDownloadBytes} from '../../lib/downloadFormatting';
import {handleEd2kLink, queueEd2kFile} from '../../lib/ed2k/intake';
import {parseEd2kLink} from '../../lib/ed2k/link';
import {importServerList, searchEd2k, type Ed2kSearchResult} from '../../lib/ed2k/native';
import {
  addEd2kServers,
  DEFAULT_SERVER_LIST_URL,
  preferEd2kServer,
  readEd2kServers,
  removeEd2kServer,
  serverKey,
} from '../../lib/ed2k/settings';
import {useM3Colors} from '../../theme/M3PaletteContext';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);

/** eD2k: paste a link, search the server, and manage the server list. */
const Ed2k = () => {
  const colors = useM3Colors();
  const [link, setLink] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Ed2kSearchResult[]>();
  const [searching, setSearching] = useState(false);
  const [servers, setServers] = useState(readEd2kServers);
  const [listUrl, setListUrl] = useState(DEFAULT_SERVER_LIST_URL);
  const [importing, setImporting] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');

  const inputStyle = {
    color: colors.onSurface,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    marginBottom: 12,
  };
  const heading = (text: string) => (
    <AppText role="titleMedium" style={{color: colors.onSurface, marginTop: 24, marginBottom: 8}}>
      {text}
    </AppText>
  );
  const note = (text: string) => (
    <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
      {text}
    </AppText>
  );

  const addLink = async () => {
    const parsed = parseEd2kLink(link);
    if (!parsed) {
      toast('That is not an ed2k:// link');
      return;
    }
    try {
      toast(await handleEd2kLink(parsed, link));
      setLink('');
      setServers(readEd2kServers());
    } catch (error: any) {
      toast(error?.message || 'That eD2k link did not work');
    }
  };

  const search = async () => {
    if (searching || !query.trim()) return;
    setSearching(true);
    try {
      setResults(await searchEd2k(query));
      setServers(readEd2kServers());
    } catch (error: any) {
      toast(error?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const download = async (result: Ed2kSearchResult) => {
    const parsed = {kind: 'file' as const, name: result.name, size: result.size, hash: result.hash, sources: []};
    const raw = `ed2k://|file|${encodeURIComponent(result.name)}|${result.size}|${result.hash}|/`;
    try {
      toast((await queueEd2kFile(parsed, raw)) === 'queued' ? 'Added to Downloads' : 'Already in Downloads');
    } catch (error: any) {
      toast(error?.message || 'Could not add the download');
    }
  };

  const importList = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const added = await importServerList(listUrl.trim());
      toast(`${added} server${added === 1 ? '' : 's'} added`);
      setServers(readEd2kServers());
    } catch (error: any) {
      toast(error?.message || 'Could not import the server list');
    } finally {
      setImporting(false);
    }
  };

  const addServer = () => {
    const number = Number(port);
    if (!/^[a-z0-9.-]+$/i.test(host.trim()) || !Number.isInteger(number) || number < 1 || number > 65535) {
      toast('Enter a server address and port');
      return;
    }
    toast(addEd2kServers([{host: host.trim(), port: number}]) > 0 ? 'Server added' : 'That server is already in the list');
    setHost('');
    setPort('');
    setServers(readEd2kServers());
  };

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: colors.background}}
      contentContainerStyle={{padding: 16, paddingBottom: 48}}
      keyboardShouldPersistTaps="handled">
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>
        eD2k
      </AppText>
      {note(
        'Droid Stream only downloads over eD2k. It shares no files and only connects while an eD2k download or search is running. eD2k downloads follow the torrent Wi-Fi only setting. Peers can see your IP address.',
      )}

      {heading('Add a link')}
      <TextInput
        accessibilityLabel="eD2k link"
        value={link}
        onChangeText={setLink}
        placeholder="ed2k://|file|..."
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={inputStyle}
      />
      <Button variant="tonal" onPress={addLink}>Add</Button>

      {heading('Search eD2k servers')}
      {note('Results come from the server you are connected to. Only download files you have the right to.')}
      <TextInput
        accessibilityLabel="Search eD2k"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={search}
        returnKeyType="search"
        placeholder="File name"
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        style={inputStyle}
      />
      <Button variant="tonal" disabled={searching} onPress={search}>
        {searching ? 'Searching…' : 'Search'}
      </Button>
      {results && results.length === 0 ? note('No results.') : null}
      {results?.map(result => (
        <Surface key={result.hash} level="low" style={{marginTop: 8, padding: 12, borderRadius: 16}}>
          <AppText role="bodyLarge" style={{color: colors.onSurface}} numberOfLines={3}>
            {result.name}
          </AppText>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginVertical: 4}}>
            {`${formatDownloadBytes(result.size)} · ${result.sources} source${result.sources === 1 ? '' : 's'}${
              result.completeSources ? ` (${result.completeSources} complete)` : ''
            }`}
          </AppText>
          <View style={{alignItems: 'flex-end'}}>
            <Button variant="text" compact onPress={() => download(result)}>Download</Button>
          </View>
        </Surface>
      ))}

      {heading(`Servers (${servers.length})`)}
      {note('The first servers in the list are tried first. Most servers give phones a "low ID", which is fine for downloading.')}
      <TextInput
        accessibilityLabel="Server list address"
        value={listUrl}
        onChangeText={setListUrl}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
      <Button variant="tonal" disabled={importing} onPress={importList}>
        {importing ? 'Importing…' : 'Import server list'}
      </Button>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
        <TextInput
          accessibilityLabel="Server address"
          value={host}
          onChangeText={setHost}
          placeholder="Address"
          placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="none"
          autoCorrect={false}
          style={{...inputStyle, flex: 2}}
        />
        <TextInput
          accessibilityLabel="Server port"
          value={port}
          onChangeText={setPort}
          placeholder="Port"
          placeholderTextColor={colors.onSurfaceVariant}
          keyboardType="number-pad"
          style={{...inputStyle, flex: 1}}
        />
      </View>
      <Button variant="tonal" onPress={addServer}>Add server</Button>
      {servers.map((server, index) => {
        const key = serverKey(server);
        return (
          <Surface key={key} level="low" style={{marginTop: 8, padding: 12, borderRadius: 16}}>
            <AppText role="bodyLarge" style={{color: colors.onSurface}} numberOfLines={1}>
              {server.name || key}
            </AppText>
            {server.name ? (
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{key}</AppText>
            ) : null}
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
              {index > 0 ? (
                <Button variant="text" compact onPress={() => {
                  preferEd2kServer(key);
                  setServers(readEd2kServers());
                }}>Try first</Button>
              ) : null}
              <Button variant="text" compact onPress={() => {
                removeEd2kServer(key);
                setServers(readEd2kServers());
              }}>Remove</Button>
            </View>
          </Surface>
        );
      })}
    </ScrollView>
  );
};

export default Ed2k;
