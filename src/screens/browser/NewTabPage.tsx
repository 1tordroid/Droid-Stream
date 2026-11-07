import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {ScrollView, View} from 'react-native';
import {TVFocusable} from '../../components/tv';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {readBookmarks, readHistory, readShortcuts, saveShortcuts} from '../../lib/browser/store';
import {displayUrl, hostOf, resolveInput, type Shortcut} from '../../lib/browser/url';
import {isTV} from '../../lib/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {Field} from '../ytdl/components';
import {Sheet} from './Sheet';

const Tile = ({shortcut, onPress, onLongPress}: {shortcut: Shortcut; onPress: () => void; onLongPress?: () => void}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={shortcut.title}
      borderRadius={20}
      style={{width: isTV ? 120 : 76, alignItems: 'center', paddingVertical: 8}}>
      <View style={{width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 6}}>
        {shortcut.icon ? (
          <MaterialCommunityIcons name={shortcut.icon as never} size={26} color={colors.primary} />
        ) : (
          <AppText role="titleMedium" style={{color: colors.primary}}>
            {(shortcut.title || hostOf(shortcut.url)).slice(0, 1).toUpperCase()}
          </AppText>
        )}
      </View>
      <AppText role="labelMedium" style={{color: colors.onSurface, textAlign: 'center'}} numberOfLines={1}>
        {shortcut.title}
      </AppText>
    </TVFocusable>
  );
};

const LinkRow = ({title, url, icon, onPress}: {title: string; url: string; icon: string; onPress: () => void}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable onPress={onPress} accessibilityLabel={title} borderRadius={14} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8}}>
      <MaterialCommunityIcons name={icon as never} size={20} color={colors.onSurfaceVariant} style={{marginRight: 14}} />
      <View style={{flex: 1}}>
        <AppText role="bodyMedium" style={{color: colors.onSurface}} numberOfLines={1}>
          {title}
        </AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}} numberOfLines={1}>
          {displayUrl(url)}
        </AppText>
      </View>
    </TVFocusable>
  );
};

/** The page a new tab shows: site shortcuts, bookmarks and recent pages. */
const NewTabPage = ({onOpen, isPrivate}: {onOpen: (url: string) => void; isPrivate: boolean}) => {
  const colors = useM3Colors();
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [editing, setEditing] = useState<{index: number; title: string; url: string} | null>(null);
  const bookmarks = readBookmarks().slice(0, 6);
  const history = isPrivate ? [] : readHistory().slice(0, 6);

  const saveEdit = () => {
    if (!editing) return;
    const url = resolveInput(editing.url);
    if (!/^https?:\/\//i.test(url)) return;
    const item: Shortcut = {id: `s${Date.now().toString(36)}`, title: editing.title.trim() || hostOf(url), url};
    const next = shortcuts.slice();
    if (editing.index >= 0) next[editing.index] = {...next[editing.index], title: item.title, url, icon: next[editing.index].url === url ? next[editing.index].icon : undefined};
    else next.push(item);
    setShortcuts(next);
    saveShortcuts(next);
    setEditing(null);
  };

  const remove = () => {
    if (!editing || editing.index < 0) return;
    const next = shortcuts.filter((_, index) => index !== editing.index);
    setShortcuts(next);
    saveShortcuts(next);
    setEditing(null);
  };

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={{padding: 16, paddingBottom: 96}} keyboardShouldPersistTaps="handled">
      {isPrivate ? (
        <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerHigh, borderRadius: 20, padding: 14, marginBottom: 16}}>
          <MaterialCommunityIcons name="incognito" size={26} color={colors.onSurface} style={{marginRight: 12}} />
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, flex: 1}}>
            Private tab: no history, passwords or tabs are saved. When you close it, cookies and data of the sites you visited are deleted, which also signs you out of them in normal tabs.
          </AppText>
        </View>
      ) : null}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: 4}}>
        {shortcuts.map((shortcut, index) => (
          <Tile
            key={shortcut.id}
            shortcut={shortcut}
            onPress={() => onOpen(shortcut.url)}
            onLongPress={() => setEditing({index, title: shortcut.title, url: shortcut.url})}
          />
        ))}
        <Tile shortcut={{id: 'add', title: 'Add', url: '', icon: 'plus'}} onPress={() => setEditing({index: -1, title: '', url: ''})} />
      </View>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4, marginBottom: 12}}>
        Press and hold a shortcut to change or remove it.
      </AppText>
      {bookmarks.length ? (
        <>
          <AppText role="titleSmall" style={{color: colors.onSurface, marginTop: 8, marginBottom: 4}}>Bookmarks</AppText>
          {bookmarks.map(item => (
            <LinkRow key={item.id} title={item.title} url={item.url} icon="bookmark-outline" onPress={() => onOpen(item.url)} />
          ))}
        </>
      ) : null}
      {history.length ? (
        <>
          <AppText role="titleSmall" style={{color: colors.onSurface, marginTop: 12, marginBottom: 4}}>Recent</AppText>
          {history.map(item => (
            <LinkRow key={`${item.url}${item.visitedAt}`} title={item.title} url={item.url} icon="history" onPress={() => onOpen(item.url)} />
          ))}
        </>
      ) : null}
      <Sheet visible={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.index === -1 ? 'Add a shortcut' : 'Change shortcut'}>
        <View style={{paddingHorizontal: 20, gap: 12}}>
          <Field label="Name" value={editing?.title || ''} onChangeText={title => setEditing(value => (value ? {...value, title} : value))} placeholder="My site" />
          <Field label="Address" value={editing?.url || ''} onChangeText={url => setEditing(value => (value ? {...value, url} : value))} placeholder="example.com" keyboardType="url" />
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4}}>
            {editing && editing.index >= 0 ? (
              <Button variant="text" onPress={remove}>Remove</Button>
            ) : null}
            <Button variant="text" onPress={() => setEditing(null)}>Cancel</Button>
            <Button onPress={saveEdit}>Save</Button>
          </View>
        </View>
      </Sheet>
    </ScrollView>
  );
};

export default NewTabPage;
