import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useMemo, useState} from 'react';
import {Switch, View} from 'react-native';
import IconButton from '../../components/ui/IconButton';
import AppText, {RawTextInput as TextInput} from '../../components/ui/Text';
import {type SavedLogin} from '../../lib/browser/passwords';
import {
  clearHistory,
  readBookmarks,
  readHistory,
  removeBookmark,
  removeHistory,
  type Layout,
} from '../../lib/browser/store';
import {displayUrl, hostOf} from '../../lib/browser/url';
import {useM3Colors} from '../../theme/M3PaletteContext';
import type {TabState} from '../../lib/browser/engine';
import {Sheet, SheetNote, SheetRow} from './Sheet';

export const TabsSheet = ({
  visible,
  onClose,
  tabs,
  activeId,
  onSelect,
  onCloseTab,
  onNew,
  onCloseAll,
}: {
  visible: boolean;
  onClose: () => void;
  tabs: TabState[];
  activeId: string;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNew: (isPrivate: boolean) => void;
  onCloseAll: () => void;
}) => (
  <Sheet visible={visible} onClose={onClose} title={`Tabs (${tabs.length})`}>
    {tabs.map(tab => (
      <SheetRow
        key={tab.id}
        icon={tab.private ? 'incognito' : tab.id === activeId ? 'tab' : 'tab-unselected'}
        label={tab.title || (tab.url ? displayUrl(tab.url) : 'New tab')}
        detail={[tab.id === activeId ? 'Open now' : undefined, tab.url ? hostOf(tab.url) : undefined, tab.desktop ? 'Desktop' : 'Mobile'].filter(Boolean).join(' · ')}
        onPress={() => onSelect(tab.id)}
        preferredFocus={tab.id === activeId}
        right={<IconButton icon="close" label={`Close ${tab.title || 'tab'}`} onPress={() => onCloseTab(tab.id)} size={18} />}
      />
    ))}
    <SheetRow icon="plus" label="New tab" onPress={() => onNew(false)} />
    <SheetRow icon="incognito" label="New private tab" onPress={() => onNew(true)} />
    {tabs.length > 1 ? <SheetRow icon="close-box-multiple-outline" label="Close all tabs" onPress={onCloseAll} danger /> : null}
  </Sheet>
);

export const LinksSheet = ({
  visible,
  onClose,
  kind,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  kind: 'bookmarks' | 'history';
  onOpen: (url: string) => void;
}) => {
  const colors = useM3Colors();
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const items = useMemo(() => {
    const list = kind === 'bookmarks' ? readBookmarks().map(item => ({key: item.id, url: item.url, title: item.title, id: item.id})) : readHistory().map(item => ({key: `${item.url}${item.visitedAt}`, url: item.url, title: item.title, id: item.url}));
    const needle = query.trim().toLowerCase();
    return (needle ? list.filter(item => item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)) : list).slice(0, 200);
    // revision re-reads after a delete.
  }, [kind, query, revision, visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={kind === 'bookmarks' ? 'Bookmarks' : 'History'}>
      <View style={{marginHorizontal: 20, marginBottom: 8, backgroundColor: colors.surfaceContainerHigh, borderRadius: 24, paddingHorizontal: 16}}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.onSurfaceVariant} style={{color: colors.onSurface, minHeight: 44}} accessibilityLabel="Search" />
      </View>
      {!items.length ? <SheetNote>{kind === 'bookmarks' ? 'No bookmarks yet. Use the menu to bookmark a page.' : 'No history yet.'}</SheetNote> : null}
      {items.map(item => (
        <SheetRow
          key={item.key}
          icon={kind === 'bookmarks' ? 'bookmark-outline' : 'history'}
          label={item.title || displayUrl(item.url)}
          detail={displayUrl(item.url)}
          onPress={() => onOpen(item.url)}
          right={
            <IconButton
              icon="delete-outline"
              label="Remove"
              size={18}
              onPress={() => {
                if (kind === 'bookmarks') removeBookmark(item.id);
                else removeHistory(item.url);
                setRevision(value => value + 1);
              }}
            />
          }
        />
      ))}
      {kind === 'history' && items.length ? (
        <SheetRow
          icon="delete-sweep-outline"
          label="Clear all history"
          danger
          onPress={() => {
            clearHistory();
            setRevision(value => value + 1);
          }}
        />
      ) : null}
    </Sheet>
  );
};

/** Desktop or mobile for a new tab, with "Remember for this site". */
export const LayoutSheet = ({
  request,
  onClose,
  onChoose,
}: {
  request: {url: string; layout: Layout} | null;
  onClose: () => void;
  onChoose: (layout: Layout, remember: boolean) => void;
}) => {
  const colors = useM3Colors();
  const [remember, setRemember] = useState(false);
  return (
    <Sheet visible={Boolean(request)} onClose={onClose} title={`Open ${request ? hostOf(request.url) : ''}`}>
      <SheetRow icon="monitor" label="Desktop" detail={request?.layout === 'desktop' ? 'Suggested' : undefined} onPress={() => onChoose('desktop', remember)} preferredFocus={request?.layout === 'desktop'} />
      <SheetRow icon="cellphone" label="Mobile" detail={request?.layout === 'mobile' ? 'Suggested' : undefined} onPress={() => onChoose('mobile', remember)} preferredFocus={request?.layout === 'mobile'} />
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface, flex: 1}}>Remember for this site</AppText>
        <Switch accessibilityLabel="Remember for this site" value={remember} onValueChange={setRemember} trackColor={{true: colors.primary, false: colors.surfaceContainerHighest}} thumbColor={remember ? colors.onPrimary : colors.outline} />
      </View>
    </Sheet>
  );
};

/** Saved sign-ins for the page, from the key button. */
export const LoginsSheet = ({
  visible,
  onClose,
  logins,
  onFill,
  onManage,
}: {
  visible: boolean;
  onClose: () => void;
  logins: SavedLogin[];
  onFill: (login: SavedLogin) => void;
  onManage: () => void;
}) => {
  const colors = useM3Colors();
  return (
    <Sheet visible={visible} onClose={onClose} title="Sign in with a saved password">
      {!logins.length ? <SheetNote>No saved passwords for this site. Sign in once and Droid Stream offers to save it.</SheetNote> : null}
      {logins.map((login, index) => (
        <SheetRow key={login.id} icon="key-variant" label={login.username || '(no user name)'} detail={hostOf(login.origin)} onPress={() => onFill(login)} preferredFocus={index === 0} />
      ))}
      <SheetRow icon="cog-outline" label="Manage passwords" onPress={onManage} />
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4}}>
        <MaterialCommunityIcons name="shield-key-outline" size={16} color={colors.onSurfaceVariant} style={{marginRight: 8}} />
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, flex: 1}}>Your phone's password manager can also fill this page.</AppText>
      </View>
    </Sheet>
  );
};
