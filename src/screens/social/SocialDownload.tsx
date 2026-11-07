import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Image, Pressable, ScrollView, ToastAndroid, useWindowDimensions, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText from '../../components/ui/Text';
import {canMakeSongVideos} from '../../lib/social/native';
import {enqueueSocial} from '../../lib/social/queue';
import {resolveSocialPost} from '../../lib/social/resolve';
import {
  defaultSelection,
  planCount,
  planDownloads,
  QUALITY_LABELS,
  toggleItem,
  visibleItems,
  type MusicChoice,
  type SocialQuality,
} from '../../lib/social/select';
import {PROFILE_LIMITS, readSocialSettings, updateSocialSettings} from '../../lib/social/settings';
import {SocialError, type SocialPost} from '../../lib/social/types';
import {classifySocialUrl, SITE_LABELS, socialLinkInText} from '../../lib/social/urls';
import {ytdlExtract, ytdlSupported} from '../../lib/ytdl/native';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {ChipRow, Choice, Field, formatDuration, Section, ToggleRow} from '../ytdl/components';

type Params = {SocialDownload: {url: string} | undefined};
type Navigate = (screen: string, params?: object) => void;

const QUALITIES = (Object.keys(QUALITY_LABELS) as SocialQuality[]).map(value => ({value, label: QUALITY_LABELS[value]}));
const SECONDS = [2, 3, 5, 8].map(value => ({value, label: `${value} s`}));

const SocialDownload = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const navigate = navigation.navigate as Navigate;
  const route = useRoute<RouteProp<Params, 'SocialDownload'>>();
  const {width} = useWindowDimensions();
  const defaults = useMemo(() => readSocialSettings(), []);
  const [url, setUrl] = useState(route.params?.url || '');
  const [post, setPost] = useState<SocialPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<{message: string; signIn: boolean} | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photosOnly, setPhotosOnly] = useState(defaults.photosOnly);
  const [quality, setQuality] = useState<SocialQuality>(defaults.quality);
  const [music, setMusic] = useState<MusicChoice>({photo: true, song: false, video: false});
  const [secondsPerImage, setSecondsPerImage] = useState(defaults.secondsPerImage);
  const [crossfade, setCrossfade] = useState(defaults.crossfade);
  const [profileLimit, setProfileLimit] = useState(defaults.profileLimit);
  const [queueing, setQueueing] = useState(false);
  const lookup = useRef(0);

  const lookUp = useCallback(
    async (value: string, profileLimitToLoad?: number) => {
      const link = socialLinkInText(value) || value.trim();
      if (!classifySocialUrl(link)) {
        setError({message: 'Paste a link to a post, story, highlight or profile on Instagram, Facebook, X, Threads, Pinterest, Reddit or Tumblr.', signIn: false});
        return;
      }
      const run = ++lookup.current;
      setUrl(link);
      setLoading(true);
      setError(null);
      setProgress(profileLimitToLoad ? 'Reading posts…' : '');
      try {
        const result = await resolveSocialPost(link, {
          ytdl: ytdlSupported() ? ytdlExtract : undefined,
          profile: profileLimitToLoad
            ? {
                limit: profileLimitToLoad,
                delayMs: defaults.profileDelayMs,
                onProgress: count => run === lookup.current && setProgress(`Read ${count} posts…`),
              }
            : undefined,
        });
        if (run !== lookup.current) return;
        setPost(result);
        setSelected(defaultSelection(result));
        setMusic({photo: true, song: false, video: false});
      } catch (lookupError) {
        if (run !== lookup.current) return;
        const message = lookupError instanceof Error ? lookupError.message : String(lookupError);
        const signIn = lookupError instanceof SocialError && (lookupError.code === 'signIn' || lookupError.code === 'private');
        setError({message, signIn});
      } finally {
        if (run === lookup.current) {
          setLoading(false);
          setProgress('');
        }
      }
    },
    [defaults.profileDelayMs],
  );

  useEffect(() => {
    if (route.params?.url) lookUp(route.params.url).catch(() => undefined);
  }, [route.params?.url, lookUp]);

  const items = useMemo(() => (post ? visibleItems(post.items, photosOnly) : []), [post, photosOnly]);
  const mixed = Boolean(post?.items.some(item => item.kind === 'video') && post?.items.some(item => item.kind === 'image'));
  const plan = useMemo(
    () => (post ? planDownloads(post, selected, {photosOnly, quality, music: post.music ? music : undefined}) : null),
    [post, selected, photosOnly, quality, music],
  );
  const count = plan ? planCount(plan) : 0;
  const photosPicked = plan ? items.filter(item => item.kind === 'image' && selected.has(item.id)).length : 0;
  const songVideos = canMakeSongVideos();
  const cell = Math.floor((Math.min(width, 720) - 32 - 32 - 16) / 3);

  const openYtdl = (link: string) => navigate('YtdlDownload', {url: link});
  const openSignIn = () => navigate('TabStack', {screen: 'SettingsStack', params: {screen: 'YtdlCookies'}});

  const download = async () => {
    if (!post || !plan) return;
    if (plan.ytdl.length && !count) {
      // Only videos without a direct file: the video downloader saves those.
      openYtdl(plan.ytdl.length === 1 ? plan.ytdl[0].pageUrl || post.url : post.url);
      return;
    }
    setQueueing(true);
    try {
      updateSocialSettings({quality, photosOnly, secondsPerImage, crossfade, profileLimit});
      const result = await enqueueSocial(post, plan, {quality, secondsPerImage, crossfade});
      if (!result) return;
      const message =
        result.added === 0
          ? 'Already in Downloads'
          : `${result.added === 1 ? 'Added' : `Added ${result.added} files`} to Downloads${result.duplicates ? `, ${result.duplicates} already there` : ''}`;
      ToastAndroid.show(message, ToastAndroid.SHORT);
      if (plan.ytdl.length) {
        ToastAndroid.show('Videos go to the video downloader', ToastAndroid.SHORT);
        openYtdl(plan.ytdl.length === 1 ? plan.ytdl[0].pageUrl || post.url : post.url);
        return;
      }
      navigation.goBack();
    } catch (queueError) {
      ToastAndroid.show(queueError instanceof Error ? queueError.message : String(queueError), ToastAndroid.LONG);
    } finally {
      setQueueing(false);
    }
  };

  const musicLine = post?.music
    ? [post.music.title, post.music.artist, formatDuration(post.music.clip || post.music.duration)].filter(Boolean).join(' · ')
    : '';

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}}>Save photos from a post</AppText>
        <IconButton icon="account-key-outline" label="Sign in to a site" onPress={openSignIn} />
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <Section title="Link">
          <Field label="Post, story or profile link" value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url" />
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
            <Button variant="tonal" compact disabled={loading} onPress={() => lookUp(url)}>
              {post ? 'Look up again' : 'Look up'}
            </Button>
          </View>
        </Section>

        {loading ? (
          <View style={{alignItems: 'center', padding: 32}}>
            <ActivityIndicator color={colors.primary} />
            <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 12}}>
              {progress || 'Reading the post…'}
            </AppText>
          </View>
        ) : null}

        {error ? (
          <Section title="Could not read this link">
            <AppText role="bodyMedium" style={{color: colors.error}}>{error.message}</AppText>
            <View style={{flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap'}}>
              {ytdlSupported() ? (
                <Button variant="text" compact onPress={() => openYtdl(url)}>Video downloader (yt-dlp)</Button>
              ) : null}
              {error.signIn ? (
                <Button variant="tonal" compact onPress={openSignIn}>Sign in</Button>
              ) : null}
              <Button variant="tonal" compact onPress={() => lookUp(url)}>Try again</Button>
            </View>
          </Section>
        ) : null}

        {post && !loading ? (
          <>
            <Section title={SITE_LABELS[post.site]}>
              <AppText role="titleMedium" style={{color: colors.onSurface}} numberOfLines={3}>{post.title}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
                {[`@${post.author}`, `${post.items.length} ${post.items.length === 1 ? 'item' : 'items'}`].join(' · ')}
              </AppText>
              {post.note ? (
                <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>{post.note}</AppText>
              ) : null}
              {post.hasVideo && ytdlSupported() ? (
                <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
                  <Button variant="text" compact onPress={() => openYtdl(post.url)}>Video downloader (yt-dlp)</Button>
                </View>
              ) : null}
            </Section>

            {post.kind === 'profile' ? (
              <Section title="Latest posts" hint="Posts are read a page at a time with a pause, so the site does not limit your account.">
                <Choice options={PROFILE_LIMITS.map(value => ({value, label: String(value)}))} value={profileLimit} onChange={setProfileLimit} />
                <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
                  <Button variant="tonal" compact onPress={() => lookUp(post.url, profileLimit)}>Load posts</Button>
                </View>
              </Section>
            ) : null}

            <Section title={`Items (${items.filter(item => selected.has(item.id)).length} of ${items.length})`}>
              <ChipRow>
                <Chip label="All" onPress={() => setSelected(new Set(items.map(item => item.id)))} />
                <Chip label="None" onPress={() => setSelected(new Set())} />
              </ChipRow>
              {mixed ? (
                <ToggleRow label="Photos only" description="Skip the videos in this post" value={photosOnly} onChange={setPhotosOnly} />
              ) : null}
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12}}>
                {items.map(item => {
                  const picked = selected.has(item.id);
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{checked: picked}}
                      accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Photo'} ${item.index}`}
                      onPress={() => setSelected(current => toggleItem(current, item.id))}
                      style={{width: cell, height: cell, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceContainerHighest, borderWidth: 3, borderColor: picked ? colors.primary : 'transparent'}}>
                      {item.thumbnail ? (
                        <Image source={{uri: item.thumbnail}} style={{width: '100%', height: '100%', opacity: picked ? 1 : 0.5}} resizeMode="cover" />
                      ) : null}
                      {item.kind === 'video' ? (
                        <MaterialCommunityIcons name="play-circle" size={24} color="#fff" style={{position: 'absolute', left: 6, bottom: 6}} />
                      ) : null}
                      <MaterialCommunityIcons
                        name={picked ? 'check-circle' : 'checkbox-blank-circle-outline'}
                        size={22}
                        color={picked ? colors.primary : '#fff'}
                        style={{position: 'absolute', right: 6, top: 6}}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Photo quality">
              <Choice options={QUALITIES} value={quality} onChange={setQuality} />
            </Section>

            {post.music ? (
              <Section title="Song in this post" hint={musicLine || undefined}>
                <ToggleRow label="Photo" value={music.photo} onChange={value => setMusic(current => ({...current, photo: value}))} />
                <ToggleRow label="Song" description="Saved as an M4A file" value={music.song} onChange={value => setMusic(current => ({...current, song: value}))} />
                <ToggleRow
                  label="Video (photo with song)"
                  description={songVideos ? 'Made on this phone as an MP4' : 'Not part of this build'}
                  value={music.video && songVideos}
                  disabled={!songVideos}
                  onChange={value => setMusic(current => ({...current, video: value}))}
                />
                {music.video && photosPicked > 1 ? (
                  <View style={{marginTop: 8}}>
                    <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginBottom: 8}}>Each photo shows for</AppText>
                    <Choice options={SECONDS} value={secondsPerImage} onChange={setSecondsPerImage} />
                    <ToggleRow label="Crossfade" value={crossfade} onChange={setCrossfade} />
                  </View>
                ) : null}
              </Section>
            ) : null}

            <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
              <Button disabled={queueing || (!count && !plan?.ytdl.length)} onPress={download}>
                {queueing ? 'Adding…' : count ? `Download ${count === 1 ? '1 file' : `${count} files`}` : plan?.ytdl.length ? 'Open in video downloader' : 'Download'}
              </Button>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenSafeArea>
  );
};

export default SocialDownload;
