import {checkSafePattern, UnsafePattern} from './safeRegex';
import {RULES_SCHEMA, SITE_HOSTS, SITE_SPEC, type RuleKind, type SocialRules} from './ruleSchema';
import type {SocialSite} from '../types';

/** Size limits for a rules file and the values in it. */
export const RULES_LIMITS = {
  fileBytes: 64 * 1024,
  url: 300,
  text: 200,
  listItems: 32,
  headers: 16,
  headerValue: 256,
  values: 16,
  pathSegments: 8,
} as const;

export class RulesError extends Error {}

const fail = (where: string, why: string): never => {
  throw new RulesError(`${where}: ${why}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Control characters would let a value end a header line or hide text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_$-]{1,64}$/;
const PLACEHOLDER = /\{([A-Za-z]{1,24})\}/g;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (where: string, value: unknown, max: number = RULES_LIMITS.text): string => {
  if (typeof value !== 'string' || !value) return fail(where, 'must be a text');
  if (value.length > max) fail(where, `is longer than ${max} characters`);
  if (CONTROL.test(value)) fail(where, 'has a control character');
  return value;
};

const hostAllowed = (site: SocialSite, host: string): boolean =>
  SITE_HOSTS[site].some(allowed => host === allowed || host.endsWith(`.${allowed}`));

/** A link template: https, on the site's own hosts, placeholders only as {name}. */
const url = (site: SocialSite, where: string, value: unknown): string => {
  const template = text(where, value, RULES_LIMITS.url);
  const sample = template.replace(PLACEHOLDER, 'x');
  if (/[{}\s\\]/.test(sample)) fail(where, 'has a broken placeholder or a space');
  let parsed: URL;
  try {
    parsed = new URL(sample);
  } catch {
    return fail(where, 'is not a link');
  }
  if (parsed.protocol !== 'https:') fail(where, 'must start with https://');
  if (parsed.username || parsed.password || parsed.port) fail(where, 'must not have a user name, password or port');
  if (!hostAllowed(site, parsed.hostname.toLowerCase())) fail(where, `must be on ${SITE_HOSTS[site].join(' or ')}`);
  return template;
};

const path = (where: string, value: unknown): string => {
  const dotted = text(where, value);
  const segments = dotted.split('.');
  if (segments.length > RULES_LIMITS.pathSegments) fail(where, `has more than ${RULES_LIMITS.pathSegments} parts`);
  if (!segments.every(segment => PATH_SEGMENT.test(segment))) fail(where, 'is not a dotted path of plain names');
  return dotted;
};

const list = <T>(where: string, value: unknown, item: (where: string, value: unknown) => T): T[] => {
  if (!Array.isArray(value) || !value.length) return fail(where, 'must be a list that is not empty');
  if (value.length > RULES_LIMITS.listItems) fail(where, `has more than ${RULES_LIMITS.listItems} items`);
  return value.map((entry, index) => item(`${where}[${index}]`, entry));
};

const headers = (where: string, value: unknown): Record<string, string> => {
  if (!isRecord(value)) return fail(where, 'must be header names and values');
  const entries = Object.entries(value);
  if (entries.length > RULES_LIMITS.headers) fail(where, `has more than ${RULES_LIMITS.headers} headers`);
  const result: Record<string, string> = {};
  for (const [name, headerValue] of entries) {
    if (!HEADER_NAME.test(name)) fail(`${where}.${name}`, 'is not a header name');
    if (/^(cookie|host|authorization|content-length)$/i.test(name)) fail(`${where}.${name}`, 'is set by the app');
    if (typeof headerValue !== 'string') fail(`${where}.${name}`, 'must be a text');
    if ((headerValue as string).length > RULES_LIMITS.headerValue || CONTROL.test(headerValue as string)) {
      fail(`${where}.${name}`, 'is too long or has a control character');
    }
    result[name] = headerValue as string;
  }
  return result;
};

const values = (where: string, value: unknown): Record<string, string | number | boolean | null> => {
  if (!isRecord(value)) return fail(where, 'must be names and values');
  const entries = Object.entries(value);
  if (entries.length > RULES_LIMITS.values) fail(where, `has more than ${RULES_LIMITS.values} values`);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [name, entry] of entries) {
    if (!PATH_SEGMENT.test(name)) fail(`${where}.${name}`, 'is not a plain name');
    if (entry === null || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))) {
      result[name] = entry;
    } else if (typeof entry === 'string') {
      result[name] = text(`${where}.${name}`, entry);
    } else {
      fail(`${where}.${name}`, 'must be null, true, false, a number or a short text');
    }
  }
  return result;
};

const pattern = (where: string, value: unknown): {pattern: string; flags?: string} => {
  if (!isRecord(value)) return fail(where, 'must be {"pattern": "...", "flags": "i"}');
  const source = value.pattern;
  const flags = value.flags === undefined ? '' : value.flags;
  if (typeof source !== 'string' || typeof flags !== 'string') return fail(where, 'pattern and flags must be texts');
  if (CONTROL.test(source)) fail(where, 'has a control character');
  try {
    checkSafePattern(source, flags);
  } catch (error) {
    if (error instanceof UnsafePattern) fail(where, `is not a safe pattern (${error.message})`);
    throw error;
  }
  return flags ? {pattern: source, flags} : {pattern: source};
};

const readKind = (site: SocialSite, kind: RuleKind, where: string, value: unknown): unknown => {
  switch (kind) {
    case 'url':
      return url(site, where, value);
    case 'text':
      return text(where, value);
    case 'texts':
      return list(where, value, (at, entry) => text(at, entry));
    case 'headers':
      return headers(where, value);
    case 'path':
      return path(where, value);
    case 'paths':
      return list(where, value, path);
    case 'pattern':
      return pattern(where, value);
    case 'values':
      return values(where, value);
  }
};

type Spec = RuleKind | {readonly [key: string]: Spec};

/** Reads the parts the spec knows; other keys are left out, so newer files still work on older apps. */
const readNode = (site: SocialSite, spec: Spec, where: string, value: unknown): unknown => {
  if (typeof spec === 'string') return readKind(site, spec, where, value);
  if (!isRecord(value)) return fail(where, 'is missing or not an object');
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec)) result[key] = readNode(site, child, `${where}.${key}`, value[key]);
  return result;
};

/** UTF-8 length of a text, without TextEncoder. */
export const utf8Length = (value: string): number => {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0) as number;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/**
 * Checks a parsed rules file and returns a clean copy of it with only the
 * known parts. Throws RulesError with the first problem.
 */
export const validateRules = (input: unknown): SocialRules => {
  if (!isRecord(input)) return fail('rules', 'must be an object');
  if (input.schema !== RULES_SCHEMA) fail('schema', `must be ${RULES_SCHEMA}`);
  const version = input.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) fail('version', 'must be a whole number from 1');
  const updated = text('updated', input.updated, 10);
  if (!DAY.test(updated) || Number.isNaN(Date.parse(`${updated}T00:00:00Z`))) fail('updated', 'must be a day as YYYY-MM-DD');
  if (!isRecord(input.sites)) fail('sites', 'is missing');
  const sites = input.sites as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [site, spec] of Object.entries(SITE_SPEC)) {
    result[site] = readNode(site as SocialSite, spec, `sites.${site}`, sites[site]);
  }
  return {schema: RULES_SCHEMA, version: version as number, updated, sites: result as unknown as SocialRules['sites']};
};

/** Parses and checks the text of a rules file, with the size limit. */
export const parseRules = (raw: string): SocialRules => {
  if (typeof raw !== 'string' || !raw.trim()) return fail('rules', 'the file is empty');
  if (utf8Length(raw) > RULES_LIMITS.fileBytes) fail('rules', `the file is larger than ${RULES_LIMITS.fileBytes / 1024} KB`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('rules', 'the file is not JSON');
  }
  return validateRules(parsed);
};
