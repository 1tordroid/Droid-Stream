import type {YtdlEvent} from './types';

export interface YtdlProgress {
  downloaded: number;
  total: number;
  speed: number;
  /** Seconds left, or null when unknown. */
  eta: number | null;
}

type ProgressEvent = Extract<YtdlEvent, {type: 'progress'}>;

/**
 * yt-dlp reports each file on its own: a video and its audio are two
 * downloads that are merged afterwards. This keeps one running total across
 * them so the queue shows a single bar that never jumps back.
 */
export class ProgressAggregator {
  private files = new Map<string, {downloaded: number; total: number; done: boolean}>();
  private planned = 0;
  private parts = 1;
  private best = 0;

  update(event: ProgressEvent): YtdlProgress {
    if (event.planned > 0) this.planned = event.planned;
    if (event.parts > 0) this.parts = event.parts;
    const key = event.file || event.formatId || 'file';
    const previous = this.files.get(key);
    let total = event.total > 0 ? event.total : previous?.total || 0;
    // Fragment downloads only estimate the size; use the fragment count when that is all there is.
    if (!total && event.fragments && event.fragment && event.downloaded > 0) {
      total = Math.round((event.downloaded / event.fragment) * event.fragments);
    }
    const done = event.status === 'finished';
    const downloaded = done ? Math.max(event.downloaded, total) : event.downloaded;
    this.files.set(key, {downloaded, total: done ? Math.max(total, downloaded) : total, done});

    let downloadedSum = 0;
    let totalSum = 0;
    for (const file of this.files.values()) {
      downloadedSum += file.downloaded;
      totalSum += Math.max(file.total, file.downloaded);
    }
    // Files that have not started yet count with the size planned for them.
    const unknownParts = Math.max(0, this.parts - this.files.size);
    if (this.planned > totalSum) {
      totalSum = this.planned;
    } else if (unknownParts > 0 && this.files.size > 0) {
      // Usually the audio after the video: guess a tenth of the size so far.
      totalSum += (totalSum / this.files.size) * unknownParts * 0.1;
    }
    const overall = Math.max(totalSum, downloadedSum);
    // The bar never moves backwards when a new file's size becomes known.
    const fraction = overall > 0 ? downloadedSum / overall : 0;
    this.best = Math.max(this.best, fraction);
    const shownDownloaded = overall > 0 ? Math.round(this.best * overall) : downloadedSum;
    const speed = done ? 0 : Math.max(0, event.speed || 0);
    const remaining = Math.max(0, overall - shownDownloaded);
    const eta = speed > 0 && overall > 0 ? Math.ceil(remaining / speed) : event.eta ?? null;
    return {downloaded: shownDownloaded, total: Math.round(overall), speed, eta};
  }
}

const STAGES: Record<string, string> = {
  Merger: 'Merging video and audio',
  FFmpegMerger: 'Merging video and audio',
  ExtractAudio: 'Converting audio',
  FFmpegExtractAudio: 'Converting audio',
  VideoRemuxer: 'Changing the container',
  FFmpegVideoRemuxer: 'Changing the container',
  VideoConvertor: 'Converting video',
  FFmpegVideoConvertor: 'Converting video',
  EmbedSubtitle: 'Adding subtitles',
  FFmpegEmbedSubtitle: 'Adding subtitles',
  SubtitlesConvertor: 'Converting subtitles',
  FFmpegSubtitlesConvertor: 'Converting subtitles',
  EmbedThumbnail: 'Adding the cover',
  ThumbnailsConvertor: 'Converting the cover',
  FFmpegThumbnailsConvertor: 'Converting the cover',
  Metadata: 'Adding details',
  FFmpegMetadata: 'Adding details',
  SponsorBlock: 'Finding sponsor segments',
  ModifyChapters: 'Cutting segments',
  FixupM3u8: 'Fixing the stream',
  FixupM4a: 'Fixing the audio',
  FixupStretched: 'Fixing the picture',
  FixupDuplicateMoov: 'Fixing the file',
  FixupTimestamp: 'Fixing timestamps',
  FFmpegFixupM3u8: 'Fixing the stream',
  FFmpegFixupM4a: 'Fixing the audio',
  FFmpegFixupDuplicateMoov: 'Fixing the file',
  FFmpegFixupTimestamp: 'Fixing timestamps',
  FFmpegCopyStream: 'Copying streams',
  FFmpegConcat: 'Joining parts',
  FFmpegSplitChapters: 'Splitting chapters',
};

/** A short label for the post-processing step yt-dlp names, or undefined for steps not worth showing. */
export const stageLabel = (name: string | undefined | null): string | undefined => {
  if (!name || name === 'MoveFiles' || name === 'MoveFilesAfterDownload') return undefined;
  return STAGES[name] || STAGES[name.replace(/PP$/, '')] || 'Processing';
};

/** "ERROR: [youtube] abc: Video unavailable" becomes "Video unavailable". */
export const cleanYtdlError = (message: string | undefined): string => {
  const first = (message || 'yt-dlp failed').split('\n').find(line => line.trim()) || 'yt-dlp failed';
  return first
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*[^:\s]+:\s*/, '')
    .replace(/\s*;\s*please report this issue on\s+https?:\/\/\S+.*$/i, '')
    .trim() || 'yt-dlp failed';
};
