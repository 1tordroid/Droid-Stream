import {safeDecode} from '../sources/webdav';
import type {NetlibKind} from './types';

/** Lower case, no accents or punctuation, "&" as "and". */
export const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const VERSION_PREFIX = 'netlib:v:';
const ITEM_PREFIX = 'netlib:i:';

/**
 * The episode link of a file in the player: the source and the file path.
 * It carries no sign-in, so progress and history can keep it.
 */
export const versionKey = (sourceId: string, path: string): string =>
  `${VERSION_PREFIX}${encodeURIComponent(sourceId)}:${encodeURIComponent(path)}`;

export const isVersionKey = (link?: string): link is string => Boolean(link?.startsWith(VERSION_PREFIX));

export const parseVersionKey = (link: string): {sourceId: string; path: string} | undefined => {
  if (!isVersionKey(link)) return undefined;
  const rest = link.slice(VERSION_PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0) return undefined;
  const sourceId = safeDecode(rest.slice(0, at));
  const path = safeDecode(rest.slice(at + 1));
  return path ? {sourceId, path} : undefined;
};

export const itemId = (sourceId: string, kind: NetlibKind, title: string, year?: number): string =>
  `${sourceId}|${kind}|${normalizeTitle(title)}|${kind === 'show' ? '' : year || ''}`;

/** Info link of a library title. */
export const netlibLink = (id: string): string => `${ITEM_PREFIX}${encodeURIComponent(id)}`;

export const netlibItemIdOf = (link?: string): string | undefined =>
  link?.startsWith(ITEM_PREFIX) ? safeDecode(link.slice(ITEM_PREFIX.length)) : undefined;

/** Provider value the Info screen and Continue Watching use for library titles. */
export const NETLIB_PROVIDER = 'netlib';
