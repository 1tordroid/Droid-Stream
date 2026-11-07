import {hostSuffixes} from './engine';
import type {CosmeticRule} from './parse';

/**
 * Element hiding: selectors for every site, selectors for one site, and the
 * exceptions that turn them off. Saved as JSON beside the network rules.
 */
export interface CompiledCosmetic {
  generic: string[];
  specific: Record<string, string[]>;
  /** Selectors turned off on a site (and its subdomains). */
  exceptions: Record<string, string[]>;
  /** Selectors turned off everywhere. */
  genericExceptions: string[];
}

export const emptyCosmetic = (): CompiledCosmetic => ({generic: [], specific: {}, exceptions: {}, genericExceptions: []});

const push = (map: Record<string, string[]>, key: string, value: string) => {
  (map[key] ||= []).push(value);
};

export const compileCosmetic = (rules: CosmeticRule[]): CompiledCosmetic => {
  const out = emptyCosmetic();
  const generic = new Set<string>();
  for (const rule of rules) {
    if (rule.exception) {
      if (!rule.domainsIn.length) out.genericExceptions.push(rule.selector);
      for (const domain of rule.domainsIn) push(out.exceptions, domain, rule.selector);
      continue;
    }
    if (!rule.domainsIn.length) {
      generic.add(rule.selector);
      // "~site.com##.ad": everywhere except that site.
      for (const domain of rule.domainsOut) push(out.exceptions, domain, rule.selector);
      continue;
    }
    for (const domain of rule.domainsIn) push(out.specific, domain, rule.selector);
    for (const domain of rule.domainsOut) push(out.exceptions, domain, rule.selector);
  }
  const genericOff = new Set(out.genericExceptions);
  out.generic = Array.from(generic).filter(selector => !genericOff.has(selector));
  return out;
};

/**
 * Selectors to hide on a page. Page flags come from FilterEngine.pageFlags:
 * h turns hiding off, g drops the generic selectors, s drops the site ones.
 */
export const selectorsFor = (data: CompiledCosmetic, host: string, pageFlags = ''): string[] => {
  if (pageFlags.includes('h') || pageFlags.includes('d') || !host) return [];
  const suffixes = hostSuffixes(host.toLowerCase());
  const off = new Set<string>(data.genericExceptions);
  for (const suffix of suffixes) for (const selector of data.exceptions[suffix] || []) off.add(selector);
  const out: string[] = [];
  if (!pageFlags.includes('s')) {
    for (const suffix of suffixes) for (const selector of data.specific[suffix] || []) if (!off.has(selector)) out.push(selector);
  }
  if (!pageFlags.includes('g')) {
    if (!off.size) return out.concat(data.generic);
    for (const selector of data.generic) if (!off.has(selector)) out.push(selector);
  }
  return out;
};
