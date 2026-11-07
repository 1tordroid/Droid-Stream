import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, ToastAndroid, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText from '../../components/ui/Text';
import {addList, ensureFilters, LIST_CREDITS, readLists, rebuildFilters, removeList, setListEnabled, type FilterList} from '../../lib/browser/filters/lists';
import {browserEngine} from '../../lib/browser/engine';
import {openPasskeyProviderSettings, providerSettingsHint} from '../../lib/browser/passkeys';
import {readNeverSites, removeNeverSite} from '../../lib/browser/passwords';
import {clearHistory, forgetLayout, readLayouts, readSettings, updateSettings, type BrowserSettings as Settings} from '../../lib/browser/store';
import {SEARCH_ENGINES} from '../../lib/browser/url';
import {installUserscript, installUserscriptFromUrl, onUserscriptsChange, readUserscripts, removeUserscript, setUserscriptEnabled} from '../../lib/browser/userscripts/store';
import {useIsKidsProfile} from '../../lib/profiles/useProfiles';
import {isTV} from '../../lib/tv';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {ChipRow, Choice, Field, Section, ToggleRow} from '../ytdl/components';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.LONG);

const ago = (time?: number): string => {
  if (!time) return 'not downloaded yet';
  const days = Math.floor((Date.now() - time) / 86400000);
  return days <= 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`;
};

const ItemRow = ({title, detail, children}: {title: string; detail?: string; children?: React.ReactNode}) => {
  const colors = useM3Colors();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', minHeight: 48}}>
      <View style={{flex: 1, paddingRight: 8}}>
        <AppText role="bodyLarge" style={{color: colors.onSurface}} numberOfLines={1}>{title}</AppText>
        {detail ? <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}} numberOfLines={2}>{detail}</AppText> : null}
      </View>
      {children}
    </View>
  );
};

const BrowserSettings = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [lists, setLists] = useState<FilterList[]>(readLists);
  const [scripts, setScripts] = useState(readUserscripts);
  const [layouts, setLayouts] = useState(readLayouts);
  const [never, setNever] = useState(readNeverSites);
  const [listUrl, setListUrl] = useState('');
  const [rules, setRules] = useState(settings.customRules);
  const [scriptUrl, setScriptUrl] = useState('');
  const [scriptCode, setScriptCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<boolean | null>(null);
  const kids = useIsKidsProfile();

  useEffect(() => {
    if (kids) navigation.goBack();
  }, [kids, navigation]);

  useFocusEffect(
    useCallback(() => {
      setLists(readLists());
      setLayouts(readLayouts());
      setNever(readNeverSites());
      setScripts(readUserscripts());
      return onUserscriptsChange(() => setScripts(readUserscripts()));
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      browserEngine().passkeysSupported().then(setPasskeys);
    }, []),
  );

  const save = (patch: Partial<Settings>) => {
    const next = updateSettings(patch);
    setSettings(next);
    if ('blockAds' in patch || 'allowedSites' in patch) browserEngine().blocking.configure(next.blockAds, next.allowedSites);
  };

  const run = async (name: string, task: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      setLists(readLists());
    }
  };

  if (kids) return null;

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}}>Browser</AppText>
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <Section title="Search engine">
          <Choice options={SEARCH_ENGINES.map(engine => ({value: engine.id, label: engine.name}))} value={settings.searchEngine} onChange={searchEngine => save({searchEngine})} />
        </Section>

        <Section title="Desktop or mobile" hint="Desktop shows sites as on a computer. You can switch any tab in the menu with Desktop site.">
          <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginBottom: 6}}>Default layout</AppText>
          <Choice options={[{value: 'desktop' as const, label: 'Desktop'}, {value: 'mobile' as const, label: 'Mobile'}]} value={settings.defaultLayout} onChange={defaultLayout => save({defaultLayout})} />
          <ToggleRow label="Ask for new tabs and pop-ups" description="Choose Desktop or Mobile when a page opens a new tab. Off: use the site's saved choice or the default." value={settings.askLayoutForNewTabs} onChange={askLayoutForNewTabs => save({askLayoutForNewTabs})} />
          {Object.entries(layouts).length ? (
            <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>Saved for sites</AppText>
          ) : null}
          {Object.entries(layouts).map(([site, layout]) => (
            <ItemRow key={site} title={site} detail={layout === 'desktop' ? 'Desktop' : 'Mobile'}>
              <Button variant="text" compact onPress={() => { forgetLayout(site); setLayouts(readLayouts()); }}>Forget</Button>
            </ItemRow>
          ))}
        </Section>

        <Section title="Pages">
          <ToggleRow label="Dark pages" description="Turns light pages dark. Pictures and videos keep their colours." value={settings.darkPages} onChange={darkPages => save({darkPages})} />
          <ToggleRow label="Download button on videos" value={settings.showVideoButton} onChange={showVideoButton => save({showVideoButton})} />
          <ToggleRow label="Ask before opening other apps" value={settings.confirmExternalApps} onChange={confirmExternalApps => save({confirmExternalApps})} />
        </Section>

        <Section title="Ad and tracker blocker" hint="Filter lists are downloaded by the app and updated every week.">
          <ToggleRow label="Block ads and trackers" value={settings.blockAds} onChange={blockAds => { save({blockAds}); if (blockAds) run('lists', () => ensureFilters()); }} />
          {lists.map(list => (
            <ItemRow
              key={list.id}
              title={list.name}
              detail={[list.error ? `Failed: ${list.error}` : ago(list.updatedAt), list.rules ? `${list.rules.toLocaleString()} rules` : undefined].filter(Boolean).join(' · ')}>
              {!list.builtIn ? <IconButton icon="delete-outline" label={`Remove ${list.name}`} onPress={() => { setLists(removeList(list.id)); run('lists', () => rebuildFilters()); }} /> : null}
              <ChipRow>
                <Chip label={list.enabled ? 'On' : 'Off'} selected={list.enabled} onPress={() => { setLists(setListEnabled(list.id, !list.enabled)); run('lists', () => rebuildFilters()); }} />
              </ChipRow>
            </ItemRow>
          ))}
          <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8}}>
            <Field label="Add a list (https link)" value={listUrl} onChangeText={setListUrl} placeholder="https://example.com/list.txt" keyboardType="url" />
            <Button compact disabled={!listUrl.trim() || busy !== null} onPress={() => run('lists', async () => { setLists(addList(listUrl)); setListUrl(''); await rebuildFilters(); })}>Add</Button>
          </View>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}>
            <Button variant="tonal" compact disabled={busy !== null || !settings.blockAds} onPress={() => run('lists', () => rebuildFilters(true))}>{busy === 'lists' ? 'Updating…' : 'Update lists now'}</Button>
          </View>
          <View style={{marginTop: 12}}>
            <Field label="Your own rules (Adblock Plus syntax)" value={rules} onChangeText={setRules} placeholder={'||ads.example.com^\nexample.com##.banner'} multiline />
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8}}>
              <Button compact disabled={rules === settings.customRules || busy !== null} onPress={() => { save({customRules: rules}); run('lists', () => rebuildFilters()); }}>Save rules</Button>
            </View>
          </View>
          {settings.allowedSites.length ? <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>Blocking off on</AppText> : null}
          {settings.allowedSites.map(site => (
            <ItemRow key={site} title={site}>
              <Button variant="text" compact onPress={() => save({allowedSites: settings.allowedSites.filter(item => item !== site)})}>Turn on</Button>
            </ItemRow>
          ))}
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
            Supports blocking rules, exceptions and element hiding. Scriptlets and rules that rewrite pages are skipped. {LIST_CREDITS}
          </AppText>
        </Section>

        <Section title="Userscripts" hint="Greasemonkey and Tampermonkey scripts. Only install scripts you trust: they can read and change the pages they run on.">
          <ToggleRow label="Run userscripts" value={settings.userscripts} onChange={userscripts => save({userscripts})} />
          {scripts.map(script => (
            <ItemRow key={script.id} title={script.meta.name} detail={[script.meta.version ? `Version ${script.meta.version}` : undefined, script.meta.description].filter(Boolean).join(' · ')}>
              <IconButton
                icon="delete-outline"
                label={`Remove ${script.meta.name}`}
                onPress={() =>
                  showAppDialog({
                    title: `Remove ${script.meta.name}?`,
                    message: 'Its saved values are deleted too.',
                    actions: [{label: 'Cancel'}, {label: 'Remove', variant: 'destructive', onPress: () => removeUserscript(script.id)}],
                  })
                }
              />
              <Chip label={script.enabled ? 'On' : 'Off'} selected={script.enabled} onPress={() => setUserscriptEnabled(script.id, !script.enabled)} />
            </ItemRow>
          ))}
          <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8}}>
            <Field label="Install from a link (.user.js)" value={scriptUrl} onChangeText={setScriptUrl} placeholder="https://…/script.user.js" keyboardType="url" />
            <Button compact disabled={!scriptUrl.trim() || busy !== null} onPress={() => run('script', async () => { const script = await installUserscriptFromUrl(scriptUrl.trim()); setScriptUrl(''); toast(`Installed ${script.meta.name}`); })}>Install</Button>
          </View>
          <View style={{marginTop: 8}}>
            <Field label="Or paste a script" value={scriptCode} onChangeText={setScriptCode} placeholder="// ==UserScript== …" multiline />
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8}}>
              <Button compact disabled={!scriptCode.trim() || busy !== null} onPress={() => run('script', async () => { const script = await installUserscript(scriptCode); setScriptCode(''); toast(`Installed ${script.meta.name}`); })}>Install</Button>
            </View>
          </View>
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
            Scripts get GM_addStyle, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_xmlhttpRequest (not to your home network), GM_openInTab, GM_setClipboard and GM_notification. Scripts set to run at document-start run as early as the app can, which can be just after the page's first script.
          </AppText>
        </Section>

        <Section title="Passwords and sign-in">
          <ToggleRow label="Use Droid Stream passwords" description="Offers to save passwords you type, and fills them on the same site. Not in private tabs." value={settings.useAppPasswords} onChange={useAppPasswords => save({useAppPasswords})} />
          <ToggleRow label="Use device autofill" description="Lets your phone's password manager (Google, Bitwarden, 1Password) fill pages. Applies to new tabs." value={settings.useDevicePasswords} onChange={useDevicePasswords => save({useDevicePasswords})} />
          <ItemRow title="Saved passwords" detail="Your screen lock is needed to see or export them">
            <Button variant="tonal" compact onPress={() => (navigation.navigate as (name: string) => void)('BrowserPasswords')}>Open</Button>
          </ItemRow>
          {never.map(site => (
            <ItemRow key={site} title={site} detail="Never saves passwords">
              <Button variant="text" compact onPress={() => { removeNeverSite(site); setNever(readNeverSites()); }}>Forget</Button>
            </ItemRow>
          ))}
          <ToggleRow label="Passkeys" description="Applies to new tabs." value={settings.passkeys} onChange={value => save({passkeys: value})} />
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
            {passkeys === false
              ? 'This phone\'s Android System WebView does not support passkeys yet. Update it from the Play Store.'
              : 'Google Password Manager only serves the browsers on its own list, so its passkeys often fail here. Two ways around it: choose a passkey manager that lets you trust any browser, or use Sign in with Chrome in the browser menu (that sign-in stays in Chrome).'}
          </AppText>
          {!isTV ? (
            <>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{providerSettingsHint()}</AppText>
              <View style={{flexDirection: 'row', marginTop: 8}}>
                <Button
                  variant="tonal"
                  compact
                  onPress={() =>
                    openPasskeyProviderSettings().then(screen => {
                      if (screen === 'accounts' || screen === 'settings') toast('Open Passwords and accounts, then choose your passkey manager');
                      else if (screen === 'failed') toast('Could not open Settings');
                    })
                  }>
                  Choose a passkey manager
                </Button>
              </View>
            </>
          ) : null}
        </Section>

        <Section title="Privacy">
          <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
            Sign-ins stay after you close the app. Private tabs save no history, passwords or tabs, and delete the cookies and data of the sites they visited when they close. Android has one cookie store for the whole app, so this also signs you out of those sites in normal tabs.
          </AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            <Button variant="tonal" compact onPress={() => showAppDialog({title: 'Clear browsing history?', message: 'Bookmarks stay.', actions: [{label: 'Cancel'}, {label: 'Clear', variant: 'destructive', onPress: () => { clearHistory(); toast('History cleared'); }}]})}>Clear history</Button>
            <Button
              variant="tonal"
              compact
              onPress={() =>
                showAppDialog({
                  title: 'Delete all cookies?',
                  message: 'You are signed out of every site in the browser, and of sites you signed in to for the video downloader and providers.',
                  actions: [{label: 'Cancel'}, {label: 'Delete', variant: 'destructive', onPress: () => browserEngine().cookies.clearAll().then(() => toast('Cookies deleted')).catch(() => undefined)}],
                })
              }>
              Delete cookies
            </Button>
          </View>
        </Section>

      </ScrollView>
    </ScreenSafeArea>
  );
};

export default BrowserSettings;
