import React from 'react';
import {View} from 'react-native';
import {chapterIndexAt, type Chapter} from '../../../lib/player/chapters';
import PlayerSheet, {SheetRow} from './PlayerSheet';
import {formatTVTimelineTime} from './playerHelpers';

const SOURCE_NAMES: Record<string, string> = {
  file: 'From the file',
  jellyfin: 'From Jellyfin',
  emby: 'From Emby',
  plex: 'From Plex',
};

/** The chapters of what is playing; picking one jumps there. */
export default function ChaptersMenu({
  chapters,
  source,
  time,
  color,
  onSeek,
  onPrevious,
  onNext,
  onClose,
}: {
  chapters: Chapter[];
  source?: string;
  time: number;
  color: string;
  onSeek: (seconds: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const current = chapterIndexAt(chapters, time);
  return (
    <PlayerSheet
      title="Chapters"
      subtitle={`${chapters.length} chapters${source && SOURCE_NAMES[source] ? ` · ${SOURCE_NAMES[source]}` : ''}`}
      color={color}
      onClose={onClose}>
      <View style={{flexDirection: 'row', gap: 8}}>
        <View style={{flex: 1}}>
          <SheetRow icon="skip-previous" title="Previous chapter" color={color} disabled={current < 0} onPress={onPrevious} />
        </View>
        <View style={{flex: 1}}>
          <SheetRow icon="skip-next" title="Next chapter" color={color} disabled={current >= chapters.length - 1} onPress={onNext} />
        </View>
      </View>
      {chapters.map((chapter, index) => (
        <SheetRow
          key={`${chapter.start}-${index}`}
          image={chapter.thumbnail}
          icon={chapter.thumbnail ? undefined : 'bookmark-outline'}
          title={chapter.title}
          detail={formatTVTimelineTime(chapter.start)}
          selected={index === current}
          preferred={index === Math.max(0, current)}
          color={color}
          onPress={() => onSeek(chapter.start)}
        />
      ))}
    </PlayerSheet>
  );
}
