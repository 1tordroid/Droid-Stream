import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Image, ScrollView, ToastAndroid, View} from 'react-native';
import Chip from '../../components/torrentSearch/Chip';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ScreenSafeArea from '../../components/ui/ScreenSafeArea';
import AppText from '../../components/ui/Text';
import {formatDownloadBytes} from '../../lib/downloadFormatting';
import {readLanguagePrefs} from '../../lib/languagePrefs';
import {queueLink} from '../../lib/linkGrabber';
import {parseTimestamp} from '../../lib/ytdl/args';
import {
  bestAudioSize,
  defaultSubtitleSelection,
  describeFormat,
  qualityOptions,
  sortedFormats,
  subtitleLanguages,
  urlInSharedText,
} from '../../lib/ytdl/formats';
import {ytdlExtract, ytdlStatus} from '../../lib/ytdl/native';
import {cleanYtdlError} from '../../lib/ytdl/progress';
import {enqueueYtdl, type YtdlQueueItem} from '../../lib/ytdl/queue';
import {nextTimeAt} from '../../lib/ytdl/schedule';
import {readYtdlSettings, updateYtdlSettings} from '../../lib/ytdl/settings';
import {
  SPONSORBLOCK_CATEGORIES,
  type SponsorCategory,
  type YtdlAudioFormat,
  type YtdlContainer,
  type YtdlInfo,
  type YtdlKind,
  type YtdlRequest,
  type YtdlSponsorMode,
  type YtdlSubtitleMode,
} from '../../lib/ytdl/types';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {ChipRow, Choice, Field, formatDuration, Section, ToggleRow} from './components';

type Params = {YtdlDownload: {url?: string} | undefined};

const SPONSOR_LABELS: Record<SponsorCategory, string> = {
  sponsor: 'Sponsor',
  intro: 'Intro',
  outro: 'Outro',
  selfpromo: 'Self-promotion',
  preview: 'Preview',
  interaction: 'Subscribe reminder',
  music_offtopic: 'Non-music',
  filler: 'Filler',
};

const AUDIO_FORMATS: {value: YtdlAudioFormat; label: string}[] = [
  {value: 'm4a', label: 'M4A (AAC)'},
  {value: 'mp3', label: 'MP3'},
  {value: 'opus', label: 'Opus'},
  {value: 'best', label: 'Original'},
];

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter(item => item !== value) : [...list, value];

const YtdlDownload = () => {
  const colors = useM3Colors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<Params, 'YtdlDownload'>>();
  const defaults = useMemo(() => readYtdlSettings(), []);
  const [url, setUrl] = useState(route.params?.url || '');
  const [info, setInfo] = useState<YtdlInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  const [kind, setKind] = useState<YtdlKind>(defaults.kind);
  const [maxHeight, setMaxHeight] = useState<number | null>(defaults.maxHeight);
  const [formatId, setFormatId] = useState<string | undefined>();
  const [container, setContainer] = useState<YtdlContainer>(defaults.container);
  const [audioFormat, setAudioFormat] = useState<YtdlAudioFormat>(defaults.audioFormat);
  const [subtitleMode, setSubtitleMode] = useState<YtdlSubtitleMode>(defaults.subtitleMode);
  const [languages, setLanguages] = useState<string[]>([]);
  const [autoSubtitles, setAutoSubtitles] = useState(defaults.autoSubtitles);
  const [embedThumbnail, setEmbedThumbnail] = useState(defaults.embedThumbnail);
  const [embedMetadata, setEmbedMetadata] = useState(defaults.embedMetadata);
  const [embedChapters, setEmbedChapters] = useState(defaults.embedChapters);
  const [sponsorMode, setSponsorMode] = useState<YtdlSponsorMode>(defaults.sponsorBlock);
  const [sponsorCategories, setSponsorCategories] = useState<SponsorCategory[]>(defaults.sponsorCategories);
  const [cutStart, setCutStart] = useState('');
  const [cutEnd, setCutEnd] = useState('');
  const [preciseCut, setPreciseCut] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState(defaults.defaultTemplateId);
  const [extraArgs, setExtraArgs] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startMode, setStartMode] = useState<'now' | 'later'>('now');
  const [startTime, setStartTime] = useState('');
  const [wifiOnly, setWifiOnly] = useState(false);

  const lookUp = useCallback(async (value: string) => {
    const link = urlInSharedText(value) || value.trim();
    if (!/^https?:\/\//i.test(link)) {
      setError('Enter a link that starts with http:// or https://');
      return;
    }
    setUrl(link);
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const status = await ytdlStatus();
      if (!status.available) throw new Error(status.error || 'yt-dlp is not available');
      const result = await ytdlExtract(link);
      setInfo(result);
      setFormatId(undefined);
      if (result.type === 'playlist') {
        setSelected(new Set(result.entries.map(entry => entry.url)));
      } else {
        const prefs = readLanguagePrefs();
        const preferred = [...defaults.subtitleLanguages, prefs.subtitlePrimary, prefs.subtitleSecondary].filter(Boolean);
        setLanguages(defaultSubtitleSelection(subtitleLanguages(result), preferred));
      }
    } catch (lookupError) {
      setError(cleanYtdlError(lookupError instanceof Error ? lookupError.message : String(lookupError)));
    } finally {
      setLoading(false);
    }
  }, [defaults.subtitleLanguages]);

  useEffect(() => {
    if (route.params?.url) lookUp(route.params.url).catch(() => undefined);
  }, [route.params?.url, lookUp]);

  const video = info?.type === 'video' ? info : null;
  const qualities = useMemo(() => (video ? qualityOptions(video) : []), [video]);
  const audioSize = useMemo(() => (video ? bestAudioSize(video) : undefined), [video]);
  const subtitleChoices = useMemo(() => (video ? subtitleLanguages(video) : []), [video]);
  const formats = useMemo(() => (video ? sortedFormats(video) : []), [video]);
  const template = defaults.templates.find(item => item.id === templateId);

  const startAt = (): number | undefined | null => {
    if (startMode === 'now') return undefined;
    const match = startTime.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return nextTimeAt(Number(match[1]), Number(match[2]));
  };

  const download = async () => {
    if (!info) return;
    const start = parseTimestamp(cutStart);
    const end = parseTimestamp(cutEnd);
    if ((cutStart && start === undefined) || (cutEnd && end === undefined)) {
      ToastAndroid.show('Write the cut times as 1:30 or 90', ToastAndroid.LONG);
      return;
    }
    if (start !== undefined && end !== undefined && end <= start) {
      ToastAndroid.show('The end of the cut must come after its start', ToastAndroid.LONG);
      return;
    }
    const notBefore = startAt();
    if (notBefore === null) {
      ToastAndroid.show('Write the start time as 21:30', ToastAndroid.LONG);
      return;
    }
    const request: YtdlRequest = {
      kind,
      maxHeight,
      formatId,
      container,
      audioFormat,
      subtitleMode,
      subtitleLanguages: languages,
      autoSubtitles,
      embedThumbnail,
      embedMetadata,
      embedChapters,
      sponsorBlock: sponsorMode,
      sponsorCategories,
      section: start !== undefined || end !== undefined ? {start, end} : undefined,
      preciseCut,
      rateLimit: defaults.rateLimit || undefined,
    };
    const items: YtdlQueueItem[] =
      info.type === 'playlist'
        ? info.entries
            .filter(entry => selected.has(entry.url))
            .map(entry => ({
              url: entry.url,
              title: entry.title,
              thumbnail: entry.thumbnail,
              index: entry.index,
              playlist: info.title,
              extractor: info.extractor,
            }))
        : [{url: info.webpageUrl || url, title: info.title, thumbnail: info.thumbnail, extractor: info.extractor}];
    if (items.length === 0) {
      ToastAndroid.show('Pick at least one item', ToastAndroid.SHORT);
      return;
    }
    setQueueing(true);
    try {
      const qualityLabel =
        kind === 'audio'
          ? AUDIO_FORMATS.find(item => item.value === audioFormat)?.label
          : qualities.find(item => item.height === maxHeight)?.label || 'Best';
      const result = await enqueueYtdl(items, request, {
        notBefore,
        wifiOnly,
        qualityLabel,
        templateArgs: [template?.args, extraArgs].filter(Boolean).join(' '),
      });
      if (!result) return;
      // The next download starts from these choices.
      updateYtdlSettings({
        kind,
        maxHeight,
        container,
        audioFormat,
        subtitleMode,
        autoSubtitles,
        embedThumbnail,
        embedMetadata,
        embedChapters,
        sponsorBlock: sponsorMode,
        sponsorCategories,
      });
      const message =
        result.added === 0
          ? 'Already in Downloads'
          : `${result.added === 1 ? 'Added' : `Added ${result.added} items`} to Downloads${result.duplicates ? `, ${result.duplicates} already there` : ''}`;
      ToastAndroid.show(message, ToastAndroid.SHORT);
      navigation.goBack();
    } catch (queueError) {
      ToastAndroid.show(queueError instanceof Error ? queueError.message : String(queueError), ToastAndroid.LONG);
    } finally {
      setQueueing(false);
    }
  };

  const downloadDirectly = () => {
    queueLink(url)
      .then(state => ToastAndroid.show(state === 'queued' ? 'Added to Downloads' : 'Already in Downloads', ToastAndroid.SHORT))
      .catch(directError => ToastAndroid.show(directError.message, ToastAndroid.LONG));
    navigation.goBack();
  };

  // Video sizes are without sound; add the audio stream to show the real file size.
  const sizeFor = (size?: number) => (size ? ` · ${formatDownloadBytes(size + (audioSize || 0))}` : '');

  return (
    <ScreenSafeArea style={{backgroundColor: colors.background}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8}}>
        <AppText role="titleLarge" style={{color: colors.onBackground, flex: 1}}>Download from link</AppText>
        <IconButton icon="cog-outline" label="Video downloader settings" onPress={() => (navigation.navigate as (screen: string, params?: object) => void)('TabStack', {screen: 'SettingsStack', params: {screen: 'YtdlSettings'}})} />
        <IconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 16, paddingBottom: 48}}>
        <Section title="Link">
          <Field label="Web page or video link" value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url" />
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
            <Button variant="tonal" compact disabled={loading} onPress={() => lookUp(url)}>
              {info ? 'Look up again' : 'Look up'}
            </Button>
          </View>
        </Section>

        {loading ? (
          <View style={{alignItems: 'center', padding: 32}}>
            <ActivityIndicator color={colors.primary} />
            <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 12}}>
              Reading the page with yt-dlp…
            </AppText>
          </View>
        ) : null}

        {error ? (
          <Section title="Could not read this link">
            <AppText role="bodyMedium" style={{color: colors.error}}>{error}</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
              Sites that need a sign-in work after you add their cookies in the video downloader settings.
            </AppText>
            <View style={{flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap'}}>
              <Button variant="text" compact onPress={downloadDirectly}>Download the file directly</Button>
              <Button variant="tonal" compact onPress={() => lookUp(url)}>Try again</Button>
            </View>
          </Section>
        ) : null}

        {info ? (
          <>
            <Section title={info.type === 'playlist' ? 'Playlist' : 'Video'}>
              <View style={{flexDirection: 'row', gap: 12}}>
                {info.type === 'video' && info.thumbnail ? (
                  <Image source={{uri: info.thumbnail}} style={{width: 128, height: 72, borderRadius: 12}} resizeMode="cover" />
                ) : null}
                <View style={{flex: 1}}>
                  <AppText role="titleMedium" style={{color: colors.onSurface}} numberOfLines={3}>{info.title}</AppText>
                  <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
                    {[
                      info.uploader,
                      info.type === 'video' ? formatDuration(info.duration) : `${info.entries.length} items`,
                      info.extractor,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                  {info.type === 'video' && info.isLive ? (
                    <AppText role="bodySmall" style={{color: colors.error, marginTop: 4}}>
                      This is a live stream. It records until the stream ends or you cancel.
                    </AppText>
                  ) : null}
                </View>
              </View>
            </Section>

            {info.type === 'playlist' ? (
              <Section title={`Items (${selected.size} of ${info.entries.length})`}>
                <ChipRow>
                  <Chip label="All" onPress={() => setSelected(new Set(info.entries.map(entry => entry.url)))} />
                  <Chip label="None" onPress={() => setSelected(new Set())} />
                </ChipRow>
                <View style={{marginTop: 8}}>
                  {info.entries.map(entry => (
                    <ToggleRow
                      key={entry.url}
                      label={`${entry.index}. ${entry.title}`}
                      description={formatDuration(entry.duration) || undefined}
                      value={selected.has(entry.url)}
                      onChange={() => setSelected(current => new Set(toggle([...current], entry.url)))}
                    />
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title="Save as">
              <Choice<YtdlKind>
                options={[{value: 'video', label: 'Video'}, {value: 'audio', label: 'Audio only'}]}
                value={kind}
                onChange={setKind}
              />
            </Section>

            {kind === 'video' ? (
              <Section title="Quality">
                {info.type === 'video' ? (
                  <ChipRow>
                    {qualities.map(option => (
                      <Chip
                        key={String(option.height)}
                        label={`${option.label}${sizeFor(option.size)}`}
                        selected={!formatId && option.height === maxHeight}
                        onPress={() => {
                          setFormatId(undefined);
                          setMaxHeight(option.height);
                        }}
                      />
                    ))}
                  </ChipRow>
                ) : (
                  <Choice<number | null>
                    options={[null, 2160, 1440, 1080, 720, 480, 360].map(value => ({value, label: value ? `Up to ${value}p` : 'Best'}))}
                    value={maxHeight}
                    onChange={setMaxHeight}
                  />
                )}
                <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>File type</AppText>
                <Choice<YtdlContainer>
                  options={[{value: 'mp4', label: 'MP4'}, {value: 'mkv', label: 'MKV'}]}
                  value={container}
                  onChange={setContainer}
                />
              </Section>
            ) : (
              <Section title="Audio format" hint="M4A and Opus keep the original sound when the site has it. MP3 is converted.">
                <Choice<YtdlAudioFormat> options={AUDIO_FORMATS} value={audioFormat} onChange={setAudioFormat} />
              </Section>
            )}

            {info.type === 'video' && subtitleChoices.length > 0 ? (
              <Section title="Subtitles">
                <Choice<YtdlSubtitleMode>
                  options={[
                    {value: 'off', label: 'None'},
                    ...(kind === 'video' ? [{value: 'embed' as const, label: 'In the video'}] : []),
                    {value: 'separate', label: 'Separate files'},
                  ]}
                  value={kind === 'audio' && subtitleMode === 'embed' ? 'separate' : subtitleMode}
                  onChange={setSubtitleMode}
                />
                {subtitleMode !== 'off' ? (
                  <>
                    <View style={{marginTop: 10}}>
                      <ChipRow>
                        {subtitleChoices
                          .filter(choice => autoSubtitles || !choice.auto || languages.includes(choice.code))
                          .slice(0, 60)
                          .map(choice => (
                            <Chip
                              key={choice.code}
                              label={choice.name}
                              selected={languages.includes(choice.code)}
                              onPress={() => setLanguages(current => toggle(current, choice.code))}
                            />
                          ))}
                      </ChipRow>
                    </View>
                    <ToggleRow
                      label="Automatic captions"
                      description="Machine-made subtitles, when there are no others"
                      value={autoSubtitles}
                      onChange={setAutoSubtitles}
                    />
                  </>
                ) : null}
              </Section>
            ) : null}

            <Section title="Extras">
              <ToggleRow
                label="Cover image"
                description={kind === 'audio' && (audioFormat === 'opus' || audioFormat === 'best') ? 'Not available for Opus or Original audio' : 'Embed the thumbnail'}
                value={embedThumbnail}
                disabled={kind === 'audio' && (audioFormat === 'opus' || audioFormat === 'best')}
                onChange={setEmbedThumbnail}
              />
              <ToggleRow label="Details" description="Title, artist, date and description" value={embedMetadata} onChange={setEmbedMetadata} />
              <ToggleRow label="Chapters" value={embedChapters} onChange={setEmbedChapters} />
            </Section>

            <Section title="SponsorBlock" hint="Community-marked segments on YouTube videos.">
              <Choice<YtdlSponsorMode>
                options={[{value: 'off', label: 'Off'}, {value: 'remove', label: 'Cut them out'}, {value: 'mark', label: 'Mark as chapters'}]}
                value={sponsorMode}
                onChange={setSponsorMode}
              />
              {sponsorMode !== 'off' ? (
                <View style={{marginTop: 10}}>
                  <ChipRow>
                    {SPONSORBLOCK_CATEGORIES.map(category => (
                      <Chip
                        key={category}
                        label={SPONSOR_LABELS[category]}
                        selected={sponsorCategories.includes(category)}
                        onPress={() => setSponsorCategories(current => toggle(current, category))}
                      />
                    ))}
                  </ChipRow>
                </View>
              ) : null}
            </Section>

            {info.type === 'video' ? (
              <Section title="Cut" hint="Save only part of the video. Leave both empty for all of it.">
                <View style={{flexDirection: 'row', gap: 12}}>
                  <Field label="From" value={cutStart} onChangeText={setCutStart} placeholder="0:00" keyboardType="numbers-and-punctuation" />
                  <Field label="To" value={cutEnd} onChangeText={setCutEnd} placeholder={formatDuration(info.duration) || 'end'} keyboardType="numbers-and-punctuation" />
                </View>
                <ToggleRow
                  label="Exact cut"
                  description="Cuts on the exact frame. Re-encodes, so it is slow on a phone."
                  value={preciseCut}
                  onChange={setPreciseCut}
                />
              </Section>
            ) : null}

            <Section title="When">
              <Choice<'now' | 'later'>
                options={[{value: 'now', label: 'Now'}, {value: 'later', label: 'At a time'}]}
                value={startMode}
                onChange={setStartMode}
              />
              {startMode === 'later' ? (
                <View style={{marginTop: 10}}>
                  <Field label="Start at (24-hour time)" value={startTime} onChangeText={setStartTime} placeholder="23:30" keyboardType="numbers-and-punctuation" />
                </View>
              ) : null}
              <ToggleRow label="Only on Wi-Fi" value={wifiOnly} onChange={setWifiOnly} />
            </Section>

            <Section title="Advanced">
              <ToggleRow label="Show advanced options" value={showAdvanced} onChange={setShowAdvanced} />
              {showAdvanced ? (
                <>
                  {defaults.templates.length > 0 ? (
                    <>
                      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>Template</AppText>
                      <Choice<string>
                        options={[{value: '', label: 'None'}, ...defaults.templates.map(item => ({value: item.id, label: item.name}))]}
                        value={templateId}
                        onChange={setTemplateId}
                      />
                    </>
                  ) : null}
                  <View style={{marginTop: 10}}>
                    <Field
                      label="Extra yt-dlp options"
                      value={extraArgs}
                      onChangeText={setExtraArgs}
                      placeholder="--limit-rate 2M --sub-format srt"
                      multiline
                    />
                  </View>
                  {info.type === 'video' && formats.length > 0 ? (
                    <>
                      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginVertical: 8}}>
                        Exact format (optional)
                      </AppText>
                      <ChipRow>
                        {formats.slice(0, 40).map(format => (
                          <Chip
                            key={format.id}
                            label={`${describeFormat(format)}${format.filesize ? ` · ${formatDownloadBytes(format.filesize)}` : ''}`}
                            selected={formatId === format.id}
                            onPress={() => setFormatId(current => (current === format.id ? undefined : format.id))}
                          />
                        ))}
                      </ChipRow>
                    </>
                  ) : null}
                </>
              ) : null}
            </Section>

            <Button disabled={queueing} onPress={download}>
              {info.type === 'playlist' ? `Download ${selected.size} items` : 'Download'}
            </Button>
          </>
        ) : null}
      </ScrollView>
    </ScreenSafeArea>
  );
};

export default YtdlDownload;
