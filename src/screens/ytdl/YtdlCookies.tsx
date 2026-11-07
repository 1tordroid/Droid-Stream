import {useNavigation} from '@react-navigation/native';
import React, {useRef, useState} from 'react';
import {ScrollView, ToastAndroid, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText from '../../components/ui/Text';
import {WebView} from '../../lib/webview';
import {ytdlSaveCookies} from '../../lib/ytdl/native';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {Field} from './components';

const SITES = ['youtube.com', 'instagram.com', 'x.com', 'facebook.com', 'tiktok.com', 'reddit.com', 'vimeo.com'];

// Sign-in pages refuse the WebView's own user agent, which says "wv".
const BROWSER_AGENT =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const pageFor = (site: string): string => {
  const trimmed = site.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
};

/**
 * A browser to sign in to a site. "Save cookies" copies that site's cookies
 * into the cookie file yt-dlp reads, in the app's private storage.
 */
const YtdlCookies = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const webView = useRef<WebView>(null);
  const [site, setSite] = useState('youtube.com');
  const [page, setPage] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const count = await ytdlSaveCookies(page || pageFor(site));
      ToastAndroid.show(
        count > 0 ? `Saved ${count} cookies. yt-dlp now uses this sign-in.` : 'No cookies yet. Sign in first.',
        ToastAndroid.LONG,
      );
      if (count > 0) navigation.goBack();
    } catch (error) {
      ToastAndroid.show(error instanceof Error ? error.message : String(error), ToastAndroid.LONG);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}} numberOfLines={1}>
          {page ? current || page : 'Sign in to a site'}
        </AppText>
        {page ? <IconButton icon="arrow-left" label="Back" onPress={() => webView.current?.goBack()} /> : null}
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      {page ? (
        <>
          <WebView
            ref={webView}
            source={{uri: page}}
            userAgent={BROWSER_AGENT}
            domStorageEnabled
            javaScriptEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            onNavigationStateChange={state => setCurrent(state.url)}
            onShouldStartLoadWithRequest={request => /^https?:\/\//i.test(request.url) || request.url === 'about:blank'}
          />
          <View style={{flexDirection: 'row', gap: 8, padding: 12, justifyContent: 'flex-end', backgroundColor: colors.surfaceContainer}}>
            <Button variant="text" compact onPress={() => setPage(null)}>Other site</Button>
            <Button compact disabled={saving} onPress={save}>{saving ? 'Saving…' : 'Save cookies'}</Button>
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{padding: 16}} keyboardShouldPersistTaps="handled">
          <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
            Open the site, sign in, then tap Save cookies. Use an account you do not mind risking: sites can limit
            accounts that download a lot. Google may refuse to sign in inside apps; signing in to YouTube still often
            works from youtube.com.
          </AppText>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
            {SITES.map(item => (
              <Chip key={item} label={item} selected={site === item} onPress={() => setSite(item)} />
            ))}
          </View>
          <Field label="Site" value={site} onChangeText={setSite} placeholder="example.com" keyboardType="url" />
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
            <Button onPress={() => setPage(pageFor(site))}>Open</Button>
          </View>
        </ScrollView>
      )}
    </ScreenSafeArea>
  );
};

export default YtdlCookies;
