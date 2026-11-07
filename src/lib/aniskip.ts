/**
 * Crowd-sourced anime intro, recap, and credits times from AniSkip
 * (api.aniskip.com), matched to MyAnimeList ids through Jikan.
 */
import {openStore} from './storage/openStore';
import type {SkipInterval} from './providers/types';

const storage = openStore('droid-stream-aniskip');

export const isAniSkipEnabled = (): boolean => storage.getBool('enabled') !== false;
export const setAniSkipEnabled = (value: boolean): void => {
  storage.setBool('enabled', value);
};

const norm = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const getJson = async (url: string): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/json'}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/** MyAnimeList id for a title, only when a title matches exactly (avoids live-action mix-ups). */
export const malIdFor = async (title: string): Promise<number | undefined> => {
  const key = `mal:${norm(title)}`;
  const cached = storage.getString(key);
  if (cached !== undefined && cached !== null) return cached ? Number(cached) : undefined;
  const data = await getJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=8&sfw=true`);
  const want = norm(title);
  const hit = (data?.data || []).find((item: any) =>
    [item.title, item.title_english, item.title_japanese, ...(item.titles || []).map((entry: any) => entry.title)]
      .filter(Boolean)
      .some((name: string) => norm(name) === want),
  );
  storage.setString(key, hit?.mal_id ? String(hit.mal_id) : '');
  return hit?.mal_id;
};

const LABELS: Record<string, string> = {op: 'Intro', 'mixed-op': 'Intro', ed: 'Credits', 'mixed-ed': 'Credits', recap: 'Recap'};

export const aniSkipTimes = async (malId: number, episode: number, episodeLengthSeconds = 0): Promise<SkipInterval[]> => {
  const key = `skip:${malId}:${episode}`;
  const cached = storage.getString(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // refetch
    }
  }
  const types = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'].map(type => `types[]=${type}`).join('&');
  const data = await getJson(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}?${types}&episodeLength=${Math.round(episodeLengthSeconds)}`);
  const skips: SkipInterval[] = data?.found
    ? (data.results || [])
        .map((item: any) => ({title: LABELS[item.skipType] || 'Skip', from: Number(item.interval?.startTime), to: Number(item.interval?.endTime)}))
        .filter((item: SkipInterval) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from)
    : [];
  storage.setString(key, JSON.stringify(skips));
  return skips;
};

/** Skip times for an episode of an anime title, or [] when not anime or not found. */
export const findAnimeSkips = async (input: {title: string; episode?: number; malId?: number; durationSeconds?: number}): Promise<SkipInterval[]> => {
  if (!isAniSkipEnabled() || !input.episode) return [];
  const malId = input.malId || (await malIdFor(input.title).catch(() => undefined));
  if (!malId) return [];
  return aniSkipTimes(malId, input.episode, input.durationSeconds).catch(() => []);
};
