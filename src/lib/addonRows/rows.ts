/**
 * The add-on rows each profile has on Home, and the edits the row editor
 * makes: add, remove, move, rename, hide. The edits are pure functions.
 */
import {create} from 'zustand';
import {hasAdultWords} from '../profiles/kids';
import {getActiveProfileId, profileKey} from '../profiles/scope';
import {mainStorage} from '../storage/StorageService';
import type {InstalledAddon} from '../stremio';
import {isAdultAddon, validExtra, type AddonCatalog, type CatalogType} from './catalogs';
import {ADDON_ROWS_KEY} from './keys';

export interface AddonRow {
  id: string;
  addonBase: string;
  addonName: string;
  type: CatalogType;
  catalogId: string;
  catalogName: string;
  /** Chosen filters, such as {genre: 'Action'}. */
  extra?: Record<string, string>;
  /** A name the user gave the row. */
  name?: string;
  hidden?: boolean;
}

export const MAX_ADDON_ROWS = 20;
export const MAX_ROW_NAME = 40;

export const createRowId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const sameExtra = (a: Record<string, string> = {}, b: Record<string, string> = {}) => {
  const keys = Object.keys(a).filter(key => a[key]);
  return keys.length === Object.keys(b).filter(key => b[key]).length && keys.every(key => a[key] === b[key]);
};

/** The same catalog with the same filters. */
export const sameCatalog = (
  row: Pick<AddonRow, 'addonBase' | 'type' | 'catalogId' | 'extra'>,
  other: Pick<AddonRow, 'addonBase' | 'type' | 'catalogId' | 'extra'>,
): boolean =>
  row.addonBase === other.addonBase && row.type === other.type && row.catalogId === other.catalogId && sameExtra(row.extra, other.extra);

const cleanExtra = (extra: Record<string, string> = {}) => {
  const entries = Object.entries(extra).filter(([, value]) => value);
  return entries.length ? Object.fromEntries(entries) : undefined;
};

export type AddResult = {rows: AddonRow[]; added?: AddonRow; reason?: 'exists' | 'full' | 'filters'};

/**
 * Adds a catalog as the last row. A catalog already there is shown again
 * instead of added twice.
 */
export const addRow = (
  rows: AddonRow[],
  catalog: AddonCatalog,
  extra: Record<string, string> = {},
  makeId: () => string = createRowId,
): AddResult => {
  const chosen = cleanExtra(extra);
  if (!validExtra(catalog, chosen)) return {rows, reason: 'filters'};
  const wanted = {addonBase: catalog.addonBase, type: catalog.type, catalogId: catalog.id, extra: chosen};
  const existing = rows.find(row => sameCatalog(row, wanted));
  if (existing) {
    return {rows: existing.hidden ? setRowHidden(rows, existing.id, false) : rows, reason: 'exists'};
  }
  if (rows.length >= MAX_ADDON_ROWS) return {rows, reason: 'full'};
  const added: AddonRow = {
    id: makeId(),
    addonBase: catalog.addonBase,
    addonName: catalog.addonName,
    type: catalog.type,
    catalogId: catalog.id,
    catalogName: catalog.name,
    ...(chosen ? {extra: chosen} : {}),
  };
  return {rows: [...rows, added], added};
};

export const removeRow = (rows: AddonRow[], id: string): AddonRow[] => rows.filter(row => row.id !== id);

/** Moves a row up (-1) or down (+1). At either end nothing changes. */
export const moveRow = (rows: AddonRow[], id: string, delta: number): AddonRow[] => {
  const from = rows.findIndex(row => row.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rows.length || to === from) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
};

/** An empty name goes back to the catalog's own name. */
export const renameRow = (rows: AddonRow[], id: string, name: string): AddonRow[] =>
  rows.map(row => {
    if (row.id !== id) return row;
    const trimmed = name.trim().slice(0, MAX_ROW_NAME);
    const next = {...row};
    delete next.name;
    return trimmed && trimmed !== defaultRowTitle(row) ? {...next, name: trimmed} : next;
  });

export const setRowHidden = (rows: AddonRow[], id: string, hidden: boolean): AddonRow[] =>
  rows.map(row => {
    if (row.id !== id) return row;
    const next = {...row};
    delete next.hidden;
    return hidden ? {...next, hidden: true} : next;
  });

const TYPE_LABEL: Record<CatalogType, string> = {movie: 'Movies', series: 'Shows'};

/** "Popular · Action", or "Popular movies" when the catalog name says nothing of the type. */
export const defaultRowTitle = (row: Pick<AddonRow, 'catalogName' | 'type' | 'extra'>): string => {
  const values = Object.values(row.extra || {}).filter(Boolean);
  const name = row.catalogName.trim();
  const base = /movie|film|series|show|tv/i.test(name) ? name : `${name} ${TYPE_LABEL[row.type].toLowerCase()}`;
  return values.length ? `${base} · ${values.join(', ')}` : base;
};

export const rowTitle = (row: AddonRow): string => row.name || defaultRowTitle(row);

/**
 * Rows Home shows: not hidden, from an add-on that is installed and on. A
 * kids profile skips adult add-ons and adult filter values.
 */
export const rowsForHome = (rows: AddonRow[], addons: InstalledAddon[], {kids = false}: {kids?: boolean} = {}): AddonRow[] =>
  rows.filter(row => {
    if (row.hidden) return false;
    const addon = addons.find(item => item.base === row.addonBase);
    if (!addon || !addon.enabled) return false;
    if (kids && (isAdultAddon(addon) || hasAdultWords(row.catalogName, ...Object.values(row.extra || {})))) return false;
    return true;
  });

const isRow = (value: any): value is AddonRow =>
  Boolean(value) &&
  typeof value.id === 'string' &&
  typeof value.addonBase === 'string' &&
  typeof value.catalogId === 'string' &&
  (value.type === 'movie' || value.type === 'series') &&
  typeof value.catalogName === 'string';

export const parseRows = (text?: string | null): AddonRow[] => {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed.filter(isRow).slice(0, MAX_ADDON_ROWS) : [];
  } catch {
    return [];
  }
};

/** A profile's rows. The profile in use when no id is given. */
export const readRows = (profileId: string = getActiveProfileId()): AddonRow[] =>
  parseRows(mainStorage.getString(profileKey(ADDON_ROWS_KEY, profileId)));

export const writeRows = (rows: AddonRow[], profileId: string = getActiveProfileId()): void => {
  mainStorage.setString(profileKey(ADDON_ROWS_KEY, profileId), JSON.stringify(rows));
  if (profileId === getActiveProfileId()) useAddonRowsStore.setState({rows});
};

interface AddonRowsState {
  rows: AddonRow[];
}

/** The rows of the profile in use, for Home. Updated by writeRows. */
export const useAddonRowsStore = create<AddonRowsState>(() => ({rows: readRows()}));
