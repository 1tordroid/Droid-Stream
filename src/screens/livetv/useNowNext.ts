/**
 * The "on now" line under each Live TV tile.
 *
 * A playlist with a small plain guide is read as before (epg.ts). World
 * countries and Free Indian channels use the free guide for the country
 * (worldGuides.ts) through the same loader and 12-hour cache as the TV
 * guide, asking for the same channels, so opening the guide afterwards
 * reuses the result. On a device with 2 GB of RAM or less the grid only uses
 * a guide that is already cached (by opening the TV guide); it never
 * downloads one itself.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {getTotalRamMB} from '../../lib/deviceMemory';
import {canLoadEpg, loadNowNext, type NowNext} from '../../lib/livetv/epg';
import {loadXmltvGuide, peekXmltvGuide, programmesFor} from '../../lib/livetv/guideLoader';
import {guideBackMs, mergeGuides, planGuideLoads} from '../../lib/livetv/guideSources';
import {normalizeChannelName, type XmltvResult} from '../../lib/livetv/xmltv';
import {AUTO_GUIDE_MAX_BYTES, autoGuideUrls, isLowMemoryRam} from '../../lib/livetv/worldGuides';
import type {GridChannel} from './play';

/** Wait before reading a guide for the grid, so the tiles draw first. */
const AUTO_DELAY_MS = 1500;
/** Plain guides are read for this many shown channels at most. */
const PLAIN_LIMIT = 400;

export const useNowNext = ({
  sourceId,
  epgUrl,
  shown,
  guideChannels,
  country,
}: {
  sourceId: string;
  /** The playlist's own guide address. */
  epgUrl: string | undefined;
  /** Channels on screen (for a plain guide). */
  shown: GridChannel[];
  /** Every channel the TV guide would ask for (for the free country guide). */
  guideChannels: GridChannel[];
  /** All countries: the country picked. */
  country?: string;
}): ((channel: GridChannel) => string | undefined) => {
  const [plain, setPlain] = useState<Map<string, NowNext>>(() => new Map());
  const [auto, setAuto] = useState<XmltvResult | undefined>();
  const lowMemory = useMemo(() => isLowMemoryRam(getTotalRamMB()), []);

  // ---- The playlist's own guide (plain XML, small) ----
  const ids = useMemo(
    () => (shown.length > PLAIN_LIMIT ? '' : shown.map(channel => channel.tvgId).filter(Boolean).join(',')),
    [shown],
  );
  useEffect(() => {
    setPlain(new Map());
    if (!canLoadEpg(epgUrl) || !ids) return;
    let alive = true;
    loadNowNext(epgUrl, new Set(ids.split(',')))
      .then(result => alive && setPlain(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [epgUrl, ids]);

  // ---- The free guide for the country ----
  const urls = useMemo(() => (epgUrl ? [] : autoGuideUrls(sourceId, {country, lowMemory})), [epgUrl, sourceId, country, lowMemory]);
  const loads = useMemo(
    () => (urls.length ? planGuideLoads(guideChannels, () => urls, normalizeChannelName) : []),
    [urls, guideChannels],
  );
  const backMs = useMemo(() => guideBackMs(guideChannels), [guideChannels]);
  const loadsKey = loads.map(load => load.key).join('\n');
  useEffect(() => {
    setAuto(undefined);
    if (!loads.length) return;
    let alive = true;
    const timer = setTimeout(async () => {
      let merged: XmltvResult | undefined;
      for (const load of loads) {
        const request = {ids: load.ids, names: load.names, backMs};
        try {
          const result = lowMemory
            ? await peekXmltvGuide(load.url, request)
            : await loadXmltvGuide(load.url, request, {maxBytes: AUTO_GUIDE_MAX_BYTES});
          if (result) merged = mergeGuides(merged, result);
        } catch {
          // No "on now" line from this guide.
        }
        if (!alive) return;
      }
      setAuto(merged);
    }, AUTO_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // loadsKey stands for loads.
  }, [loadsKey, backMs, lowMemory]);

  return useCallback(
    (channel: GridChannel) => {
      if (channel.tvgId) {
        const title = plain.get(channel.tvgId)?.now?.title;
        if (title) return title;
      }
      if (!auto) return undefined;
      const now = Date.now();
      return programmesFor(auto, channel, normalizeChannelName)?.find(item => item.start <= now && item.stop > now)?.title;
    },
    [plain, auto],
  );
};
