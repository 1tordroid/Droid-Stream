import React, {useMemo, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, View} from 'react-native';
import {TextTrackType} from 'react-native-video';
import {findMatchedSubtitles, languageName, type MatchedSubtitle} from '../lib/subtitles/hashMatch';
import type {WatchMeta} from '../lib/watchMeta';
import {useM3Colors} from '../theme/M3PaletteContext';
import type {FoundSubtitle} from './SearchSubtitles';
import PlayerMenuRow from './PlayerMenuRow';
import {TVFocusable} from './tv';
import AppText from './ui/Text';

/** Player menu row: subtitles matched to this exact file by its OpenSubtitles hash. */
const MatchedSubtitles = ({
  url,
  headers,
  meta,
  onAddSubtitle,
}: {
  url?: string;
  headers?: Record<string, string>;
  meta?: WatchMeta;
  onAddSubtitle: (track: FoundSubtitle) => void;
}) => {
  const colors = useM3Colors();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<MatchedSubtitle[]>([]);
  const [language, setLanguage] = useState<string>();

  const search = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const found = await findMatchedSubtitles({url, headers, meta});
      setResults(found);
      if (!found.length) setError('No subtitles found for this video.');
    } catch (e: any) {
      setError(e?.message || 'Subtitle search failed');
    } finally {
      setLoading(false);
    }
  };

  const languages = useMemo(() => Array.from(new Set(results.map(item => item.lang))).sort((a, b) => (a === 'eng' ? -1 : b === 'eng' ? 1 : languageName(a).localeCompare(languageName(b)))), [results]);
  const shown = results.filter(item => !language || item.lang === language).slice(0, 60);

  return (
    <View>
      <PlayerMenuRow
        title="Match subtitles to this file"
        detail={meta?.title ? 'OpenSubtitles, matched by file hash' : 'Needs a known title'}
        accentColor={colors.primary}
        icon="fingerprint"
        onPress={search}
      />
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 24}}>
          <View style={{backgroundColor: colors.surfaceContainerHigh, borderRadius: 24, padding: 16, maxHeight: '90%'}}>
            <AppText role="titleLarge" style={{color: colors.onSurface}}>Matched subtitles</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
              {results[0]?.exact ? 'Matched to this exact file first.' : 'Matched by title and episode.'} {meta?.title}
              {meta?.season !== undefined ? ` S${meta.season}E${meta.episode}` : ''}
            </AppText>
            {loading ? <ActivityIndicator color={colors.primary} style={{marginVertical: 24}} /> : null}
            {error ? <AppText style={{color: colors.error, marginVertical: 8}}>{error}</AppText> : null}
            {languages.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingBottom: 8}}>
                {[undefined, ...languages].map(code => (
                  <TVFocusable key={code || 'all'} accessibilityRole="button" accessibilityLabel={code ? languageName(code) : 'All languages'} onPress={() => setLanguage(code)}
                    style={{paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 10, backgroundColor: language === code ? colors.secondaryContainer : colors.surfaceContainer}}>
                    <AppText role="labelLarge" style={{color: colors.onSurface}}>{code ? languageName(code) : 'All'}</AppText>
                  </TVFocusable>
                ))}
              </ScrollView>
            ) : null}
            <ScrollView>
              {shown.map(item => (
                <TVFocusable key={item.url} accessibilityRole="button" accessibilityLabel={`Use ${languageName(item.lang)} subtitle`}
                  onPress={() => {
                    onAddSubtitle({type: TextTrackType.SUBRIP, language: item.lang, title: `${languageName(item.lang)} · ${item.addon}`, uri: item.url});
                    setOpen(false);
                  }}
                  style={{minHeight: 48, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.outlineVariant}}>
                  <AppText role="bodyLarge" style={{color: colors.onSurface}}>{languageName(item.lang)}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{item.addon}{item.id ? ` · ${item.id}` : ''}</AppText>
                </TVFocusable>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={{minHeight: 48, justifyContent: 'center', alignItems: 'flex-end'}}>
              <AppText style={{color: colors.primary}}>Close</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default MatchedSubtitles;
