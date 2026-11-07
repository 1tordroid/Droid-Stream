import React, {useEffect, useState} from 'react';
import {NativeModules, ToastAndroid} from 'react-native';
import {copyText} from '../../lib/clipboard';
import {formatDownloadBytes} from '../../lib/downloadFormatting';
import {
  canOpenSocial,
  downloadFile,
  downloadStream,
  openInYtdl,
  openSocial,
  openTorrent,
  playMedia,
  requestHeaders,
  type Navigate,
  type PageContext,
} from '../../lib/browser/handoff';
import {fileNameOf, hostOfUrl, isPlayable, isYtdlSite, KIND_LABEL, sortMedia, type MediaItem, type MediaKind} from '../../lib/browser/media';
import {isTV} from '../../lib/tv';
import {ytdlSupported} from '../../lib/ytdl/native';
import {Sheet, SheetNote, SheetRow} from './Sheet';

const ICONS: Record<MediaKind, string> = {
  video: 'filmstrip',
  audio: 'music-note',
  image: 'image-outline',
  hls: 'playlist-play',
  dash: 'playlist-play',
  torrent: 'magnet',
  magnet: 'magnet',
  file: 'file-download-outline',
};

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

const labelOf = (item: MediaItem): string => {
  if (item.blob) return 'Video in the page player';
  if (item.kind === 'magnet') return decodeURIComponent(/[?&]dn=([^&]+)/i.exec(item.url)?.[1] || 'Magnet link').replace(/\+/g, ' ');
  return fileNameOf(item.url, KIND_LABEL[item.kind]);
};

const detailOf = (item: MediaItem): string =>
  [
    KIND_LABEL[item.kind],
    item.quality,
    item.width && item.height && item.kind === 'image' ? `${item.width}×${item.height}` : undefined,
    item.size ? formatDownloadBytes(item.size) : undefined,
    item.kind === 'magnet' ? undefined : hostOfUrl(item.url),
  ]
    .filter(Boolean)
    .join(' · ');

/** "Media on this page": every video, audio, image and stream found, with what to do with each. */
const MediaSheet = ({
  visible,
  onClose,
  items,
  focus,
  context,
  navigate,
  routeNames,
}: {
  visible: boolean;
  onClose: () => void;
  items: MediaItem[];
  /** Opens straight on one item (the download button on a video). */
  focus?: MediaItem | null;
  context: PageContext;
  navigate: Navigate;
  routeNames: readonly string[];
}) => {
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    if (visible) setSelected(focus || null);
    else setSelected(null);
  }, [visible, focus]);

  // Sizes of the first files, asked with the page's headers.
  useEffect(() => {
    if (!visible) return;
    const probe = NativeModules.HttpDownloadModule?.probe as ((url: string, headers: object | null) => Promise<{size?: number}>) | undefined;
    if (!probe) return;
    let cancelled = false;
    const wanted = items.filter(item => (item.kind === 'video' || item.kind === 'audio' || item.kind === 'file') && !item.blob && sizes[item.url] === undefined).slice(0, 8);
    (async () => {
      for (const item of wanted) {
        const headers = await requestHeaders(item.url, context).catch(() => ({}));
        const result = await probe(item.url, headers).catch(() => null);
        if (cancelled) return;
        setSizes(previous => ({...previous, [item.url]: Number(result?.size) > 0 ? Number(result?.size) : 0}));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Probes once per opening.
  }, [visible, items.length]);

  const ytdl = ytdlSupported();
  const pageUrl = context.pageUrl;
  const run = (task: () => Promise<unknown> | void) => {
    onClose();
    Promise.resolve()
      .then(task)
      .catch(error => toast(error instanceof Error ? error.message : String(error)));
  };

  const download = (item: MediaItem) => {
    if (item.blob) return run(() => openInYtdl(pageUrl, context, navigate));
    if (item.kind === 'hls' || item.kind === 'dash') return run(() => downloadStream(item, context, navigate));
    if (item.kind === 'torrent' || item.kind === 'magnet') return run(() => openTorrent(item.url, navigate));
    return run(() => downloadFile({url: item.url, title: item.title, poster: item.poster, mime: item.mime}, context));
  };

  if (selected) {
    const playable = isPlayable(selected) && !selected.blob;
    return (
      <Sheet visible={visible} onClose={onClose} title={labelOf(selected)}>
        <SheetNote>{detailOf({...selected, size: selected.size || sizes[selected.url]})}</SheetNote>
        {selected.blob ? (
          <SheetNote>This player hides its file. yt-dlp can often still save it from the page.</SheetNote>
        ) : null}
        {!selected.blob || ytdl ? (
          <SheetRow icon="download" label={selected.blob ? 'Download with yt-dlp' : 'Download'} onPress={() => download(selected)} preferredFocus />
        ) : null}
        {ytdl && !selected.blob && (isYtdlSite(pageUrl) || selected.kind === 'video') ? (
          <SheetRow icon="youtube" label="Download the page with yt-dlp" detail="Picks quality, audio and subtitles" onPress={() => run(() => openInYtdl(pageUrl, context, navigate))} />
        ) : null}
        {playable ? <SheetRow icon="play-circle-outline" label="Play" onPress={() => run(() => playMedia(selected, context, navigate))} /> : null}
        {playable && !isTV ? <SheetRow icon="cast" label="Cast" onPress={() => run(() => playMedia(selected, context, navigate, true))} /> : null}
        {!selected.blob ? (
          <SheetRow icon="content-copy" label="Copy link" onPress={() => run(() => {
            copyText(selected.url);
            toast('Link copied');
          })} />
        ) : null}
        {canOpenSocial(pageUrl, routeNames) ? (
          <SheetRow icon="image-multiple-outline" label="Photos and post" onPress={() => run(() => {
            openSocial(pageUrl, routeNames, navigate);
          })} />
        ) : null}
        {items.length > 1 && !focus ? <SheetRow icon="arrow-left" label="All media on this page" onPress={() => setSelected(null)} /> : null}
      </Sheet>
    );
  }

  const sorted = sortMedia(items).map(item => ({...item, size: item.size || sizes[item.url]}));
  const images = sorted.filter(item => item.kind === 'image');
  const others = sorted.filter(item => item.kind !== 'image');
  return (
    <Sheet visible={visible} onClose={onClose} title="Media on this page">
      {ytdl && /^https?:/i.test(pageUrl) ? (
        <SheetRow icon="youtube" label="Download this page with yt-dlp" detail={isYtdlSite(pageUrl) ? 'Best for this site' : 'Works on many video sites'} onPress={() => run(() => openInYtdl(pageUrl, context, navigate))} preferredFocus={!others.length} />
      ) : null}
      {canOpenSocial(pageUrl, routeNames) ? (
        <SheetRow icon="image-multiple-outline" label="Photos and post" onPress={() => run(() => {
          openSocial(pageUrl, routeNames, navigate);
        })} />
      ) : null}
      {!items.length ? <SheetNote>Nothing found yet. Play the video, then open this again.</SheetNote> : null}
      {others.map((item, index) => (
        <SheetRow key={item.url} icon={ICONS[item.kind] as never} label={labelOf(item)} detail={detailOf(item)} onPress={() => setSelected(item)} preferredFocus={index === 0} />
      ))}
      {images.length ? (
        <SheetRow icon={showImages ? 'chevron-up' : 'chevron-down'} label={`Images (${images.length})`} onPress={() => setShowImages(value => !value)} />
      ) : null}
      {showImages
        ? images.map(item => <SheetRow key={item.url} icon="image-outline" label={labelOf(item)} detail={detailOf(item)} onPress={() => setSelected(item)} />)
        : null}
    </Sheet>
  );
};

export default MediaSheet;
