import React, {useState} from 'react';
import PlayerDelayControl from '../../../components/PlayerDelayControl';
import {languageNameFor} from '../../../lib/languagePrefs';
import type {PlayerTextTrack} from '../../../lib/subtitles/subtitleCues';
import {MAX_SUBTITLE_DELAY_MS} from '../../../lib/subtitles/subtitleSync';
import {
  readTranslationKey,
  readTranslationSettings,
  translationProblem,
  translationServiceLabel,
} from '../../../lib/subtitles/translation';
import PlayerSheet, {SheetHeading, SheetNote, SheetRow} from './PlayerSheet';
import {translationTarget, type SubtitleTools} from './useSubtitleTools';

/**
 * Dual subtitles and translation: a second track shown above the main one
 * (or at the top), and the main subtitle translated by the viewer's own
 * translation service.
 */
export default function SecondSubtitleMenu({
  tools,
  textTracks,
  mainTrackIndex,
  trackLabel,
  color,
  onClose,
}: {
  tools: SubtitleTools;
  textTracks: PlayerTextTrack[];
  mainTrackIndex: number;
  trackLabel: (track: PlayerTextTrack) => {title: string; detail?: string};
  color: string;
  onClose: () => void;
}) {
  // Read when the menu opens, so a change in Settings shows up.
  const [settings] = useState(readTranslationSettings);
  const [problem] = useState(() => translationProblem(settings, readTranslationKey(settings.service)));
  const service = translationServiceLabel(settings);
  const target = languageNameFor(translationTarget(settings));
  const {secondChoice, translation} = tools;
  const hasMain = mainTrackIndex !== 1000;

  return (
    <PlayerSheet title="Second subtitle" subtitle="Shown above the main subtitle. Style it in Settings > Subtitle style." color={color} width={560} onClose={onClose}>
      <SheetRow
        icon="close-circle-outline"
        title="Off"
        selected={secondChoice.kind === 'off'}
        preferred={secondChoice.kind === 'off'}
        color={color}
        onPress={() => tools.setSecondChoice({kind: 'off'})}
      />
      {textTracks.map(track => {
        const label = trackLabel(track);
        const isMain = track.index === mainTrackIndex;
        const selected = secondChoice.kind === 'track' && secondChoice.index === track.index;
        return (
          <SheetRow
            key={track.index}
            icon="subtitles"
            title={label.title}
            detail={isMain ? 'Main subtitle' : label.detail}
            disabled={isMain}
            selected={selected}
            preferred={selected}
            color={color}
            onPress={() => tools.setSecondChoice({kind: 'track', index: track.index})}
          />
        );
      })}
      {translation && translation.cues.length > 0 ? (
        <SheetRow
          icon="translate"
          title={`Translation (${languageNameFor(translation.target)})`}
          detail={tools.translationAsMain ? 'Shown as the main subtitle' : undefined}
          selected={secondChoice.kind === 'translation'}
          preferred={secondChoice.kind === 'translation'}
          color={color}
          onPress={() => tools.setSecondChoice({kind: 'translation'})}
        />
      ) : null}
      {tools.secondStatus ? <SheetNote>{tools.secondStatus}</SheetNote> : null}
      {secondChoice.kind === 'track' ? (
        <PlayerDelayControl
          title="Second subtitle delay"
          icon="subtitles"
          laterLabel="Text shows later"
          earlierLabel="Text shows earlier"
          delayMs={tools.secondDelayMs}
          accentColor={color}
          stepMs={100}
          coarseStepMs={1000}
          maxMs={MAX_SUBTITLE_DELAY_MS}
          onChange={tools.setSecondDelayMs}
        />
      ) : null}

      <SheetHeading>Translate</SheetHeading>
      {problem ? (
        <SheetNote>{problem}</SheetNote>
      ) : (
        <>
          <SheetNote>{`Uses ${service}. The lines of the main subtitle are sent there, nothing else.`}</SheetNote>
          {translation?.running ? (
            <SheetRow
              icon="stop-circle-outline"
              title={`Translating… ${translation.done} of ${translation.total || '?'}`}
              detail="Select to stop. Translated lines show as they arrive."
              color={color}
              onPress={tools.stopTranslation}
            />
          ) : (
            <SheetRow
              icon="translate"
              title={`Translate main subtitle into ${target}`}
              detail={
                hasMain
                  ? translation && translation.total > 0 && translation.done < translation.total
                    ? `${translation.done} of ${translation.total} done. Select to continue.`
                    : 'A translated track is kept for this file'
                  : 'Pick a main subtitle first'
              }
              disabled={!hasMain}
              color={color}
              onPress={tools.startTranslation}
            />
          )}
          {translation?.error ? <SheetNote>{translation.error}</SheetNote> : null}
          {translation && translation.cues.length > 0 ? (
            <SheetRow
              icon={tools.translationAsMain ? 'toggle-switch' : 'toggle-switch-off-outline'}
              title="Show translation as the main subtitle"
              detail={tools.translationAsMain ? 'On: the original is hidden' : 'Off: the translation is the second line'}
              selected={tools.translationAsMain}
              color={color}
              onPress={() => {
                const next = !tools.translationAsMain;
                tools.setTranslationAsMain(next);
                if (!next && secondChoice.kind === 'off') tools.setSecondChoice({kind: 'translation'});
              }}
            />
          ) : null}
        </>
      )}
    </PlayerSheet>
  );
}
