import React, {useEffect, useState} from 'react';
import {Image, Pressable, ScrollView, View} from 'react-native';
import {searchCinemeta, type StremioMeta} from '../../lib/stremio';
import {useM3Colors} from '../../theme/M3PaletteContext';
import FadeIn from '../FadeIn';
import PosterRowSkeleton from '../PosterRowSkeleton';
import AppText from '../ui/Text';

export interface TitleMatch {
  meta: StremioMeta;
  type: 'movie' | 'series';
}

const MAX_MATCHES = 12;

const rank = (query: string, name: string): number => {
  const clean = (value: string) => value.trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  const want = clean(query);
  const text = clean(name);
  return text === want ? 0 : text.startsWith(want) ? 1 : text.includes(want) ? 2 : 3;
};

/** Poster row that lets people confirm the title before looking for sources. */
const TitleMatches = ({
  query,
  selectedId,
  onPick,
}: {
  query: string;
  selectedId?: string;
  onPick: (match: TitleMatch) => void;
}) => {
  const colors = useM3Colors();
  const [matches, setMatches] = useState<TitleMatch[]>([]);
  const [loading, setLoading] = useState(false);
  // Posters that fail to load leave blank tiles, so those titles drop out.
  const [broken, setBroken] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setMatches([]);
      return;
    }
    let current = true;
    setLoading(true);
    Promise.all(
      (['movie', 'series'] as const).map(type =>
        searchCinemeta(text, type)
          .then(metas => metas.map(meta => ({meta, type})))
          .catch(() => [] as TitleMatch[]),
      ),
    ).then(([movies, series]) => {
      if (!current) return;
      const found = [...movies, ...series]
        // Titles that do not contain the search words are noise, so the row hides.
        .filter(item => item.meta.poster && rank(text, item.meta.name) < 3)
        .sort((left, right) => rank(text, left.meta.name) - rank(text, right.meta.name))
        .slice(0, MAX_MATCHES);
      setMatches(found);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [query]);

  const visible = matches.filter(match => !broken.has(match.meta.id));
  if (loading && !visible.length) return <View style={{marginHorizontal: -20, marginTop: -12}}><PosterRowSkeleton count={4} width={96} title={false} /></View>;
  if (!visible.length) return null;

  return (
    <FadeIn style={{marginTop: 12}}>
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Pick the right title</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>
        {visible.map(match => {
          const selected = match.meta.id === selectedId;
          const year = String(match.meta.releaseInfo || match.meta.year || '').slice(0, 4);
          return (
            <Pressable
              key={`${match.type}:${match.meta.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${match.meta.name}${year ? `, ${year}` : ''}, ${match.type}`}
              accessibilityState={{selected}}
              onPress={() => onPick(match)}
              style={{width: 96}}>
              <Image
                source={{uri: match.meta.poster}}
                accessibilityIgnoresInvertColors
                onError={() => setBroken(current => new Set(current).add(match.meta.id))}
                style={{width: 96, height: 142, borderRadius: 12, backgroundColor: colors.surfaceContainerHigh, borderWidth: selected ? 2 : 0, borderColor: colors.primary}}
              />
              <AppText role="labelMedium" numberOfLines={2} style={{color: selected ? colors.primary : colors.onSurface, marginTop: 4}}>{match.meta.name}</AppText>
              <AppText role="labelSmall" numberOfLines={1} style={{color: colors.onSurfaceVariant}}>{[year, match.type === 'series' ? 'Series' : 'Movie'].filter(Boolean).join(' · ')}</AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </FadeIn>
  );
};

export default TitleMatches;
