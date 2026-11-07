import React, {useEffect, useRef, useState} from 'react';
import PlayerDelayControl, {formatDelay} from '../../../components/PlayerDelayControl';
import {isLocalSource, playerTools} from '../../../lib/player/playerTools';
import {cuesAround, type SubtitleCue} from '../../../lib/subtitles/cueParser';
import {
  delayForLine,
  estimateSubtitleDelay,
  MAX_SUBTITLE_DELAY_MS,
  MIN_SYNC_CONFIDENCE,
  speechFromLevels,
} from '../../../lib/subtitles/subtitleSync';
import PlayerSheet, {SheetHeading, SheetNote, SheetRow} from './PlayerSheet';
import {formatTVTimelineTime} from './playerHelpers';
import type {SubtitleTools} from './useSubtitleTools';

/** Seconds of audio Auto sync listens to, around the current position. */
const LISTEN_SECONDS = 180;

const signed = (seconds: number) => `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(1)} s`;

/**
 * Subtitle sync: the delay buttons, Sync to a line (pick the line being
 * spoken now) and Auto sync (lines matched to speech in the audio).
 */
export default function SubtitleSyncMenu({
  tools,
  color,
  videoUri,
  headers,
  getTime,
  isPlaying,
  onPause,
  onResume,
  onToast,
  onClose,
}: {
  tools: SubtitleTools;
  color: string;
  videoUri: string;
  headers?: Record<string, string>;
  getTime: () => number;
  isPlaying: () => boolean;
  onPause: () => void;
  onResume: () => void;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'main' | 'lines'>('main');
  const [lines, setLines] = useState<{cue: SubtitleCue; index: number}[]>([]);
  const [heardAt, setHeardAt] = useState(0);
  const [linesStatus, setLinesStatus] = useState('');
  const [auto, setAuto] = useState<{running: boolean; text: string}>({running: false, text: ''});
  const pausedHere = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      playerTools?.cancelSpeechLevels();
    };
  }, []);

  const close = () => {
    if (pausedHere.current) onResume();
    pausedHere.current = false;
    onClose();
  };

  const openLines = async () => {
    if (isPlaying()) {
      onPause();
      pausedHere.current = true;
    }
    const now = getTime();
    setHeardAt(now);
    setView('lines');
    setLines([]);
    setLinesStatus('Loading the lines…');
    try {
      const cues = await tools.loadPrimaryCues();
      if (!live.current) return;
      setLines(cuesAround(cues, now - tools.subtitleDelayMs / 1000, 8, 12));
      setLinesStatus('');
    } catch (error) {
      if (live.current) setLinesStatus(error instanceof Error ? error.message : 'Could not read this subtitle');
    }
  };

  // Picking a line sets the delay and plays on, so the result shows at once.
  const pickLine = (cue: SubtitleCue) => {
    const delay = delayForLine(cue, heardAt);
    tools.setSubtitleDelayMs(delay);
    onToast(`Subtitle delay ${formatDelay(delay)}`);
    close();
  };

  const backToMain = () => {
    if (pausedHere.current) onResume();
    pausedHere.current = false;
    setView('main');
  };

  const runAutoSync = async () => {
    if (!playerTools) return;
    setAuto({running: true, text: 'Reading the subtitle…'});
    try {
      const cues = await tools.loadPrimaryCues();
      const now = getTime();
      const start = Math.max(0, now - LISTEN_SECONDS / 3);
      if (!live.current) return;
      setAuto({running: true, text: 'Listening to the audio…'});
      const levels = await playerTools.readSpeechLevels(videoUri, headers || {}, start, LISTEN_SECONDS);
      if (!live.current) return;
      const estimate = estimateSubtitleDelay(speechFromLevels(levels), cues, start, 30);
      if (!estimate || estimate.confidence < MIN_SYNC_CONFIDENCE) {
        setAuto({running: false, text: 'No clear match here. Try again in a part with more talking, or use Sync to a line.'});
        return;
      }
      tools.setSubtitleDelayMs(estimate.delayMs);
      setAuto({running: false, text: `Set to ${formatDelay(estimate.delayMs)} from ${estimate.linesUsed} lines.`});
    } catch (error) {
      if (live.current) {
        const message = error instanceof Error ? error.message : '';
        setAuto({running: false, text: message === 'Stopped' ? '' : message || 'Auto sync failed'});
      }
    }
  };

  if (view === 'lines') {
    const delaySeconds = tools.subtitleDelayMs / 1000;
    const showing = lines.findIndex(({cue}) => cue.start + delaySeconds <= heardAt && cue.end + delaySeconds > heardAt);
    const next = lines.findIndex(({cue}) => cue.start + delaySeconds > heardAt);
    const preferred = showing >= 0 ? showing : next >= 0 ? next : lines.length - 1;
    return (
      <PlayerSheet
        title="Sync to a line"
        subtitle={`Pick the line you hear at ${formatTVTimelineTime(heardAt)}. Playback is paused.`}
        color={color}
        width={560}
        onClose={close}>
        <SheetRow icon="arrow-left" title="Back" color={color} onPress={backToMain} />
        {linesStatus ? <SheetNote>{linesStatus}</SheetNote> : null}
        {lines.map(({cue, index}, position) => (
          <SheetRow
            key={index}
            title={cue.text}
            detail={`Shown ${signed(cue.start + delaySeconds - heardAt)} from now`}
            selected={position === showing}
            preferred={position === preferred}
            color={color}
            onPress={() => pickLine(cue)}
          />
        ))}
      </PlayerSheet>
    );
  }

  const canRead = Boolean(tools.primaryRef);
  return (
    <PlayerSheet title="Subtitle sync" color={color} width={560} onClose={close}>
      <PlayerDelayControl
        title="Subtitle delay"
        icon="closed-caption"
        laterLabel="Text shows later"
        earlierLabel="Text shows earlier"
        delayMs={tools.subtitleDelayMs}
        accentColor={color}
        stepMs={100}
        coarseStepMs={1000}
        maxMs={MAX_SUBTITLE_DELAY_MS}
        onChange={tools.setSubtitleDelayMs}
      />
      <SheetNote>Kept for this title.</SheetNote>
      <SheetHeading>Line up</SheetHeading>
      <SheetRow
        icon="format-list-text"
        title="Sync to a line"
        detail={canRead ? 'Pick the line being spoken now' : 'Not available for this subtitle'}
        disabled={!canRead}
        preferred
        color={color}
        onPress={openLines}
      />
      {playerTools ? (
        <SheetRow
          icon="waveform"
          title={auto.running ? 'Auto sync: working…' : 'Auto sync (beta)'}
          detail={
            auto.text ||
            (isLocalSource(videoUri)
              ? 'Matches the lines to speech in 3 minutes of audio around now'
              : 'Matches the lines to speech. Downloads about 3 minutes of this video.')
          }
          disabled={!canRead || auto.running}
          color={color}
          onPress={runAutoSync}
        />
      ) : null}
    </PlayerSheet>
  );
}
