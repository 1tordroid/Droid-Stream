import bundled from '../../../../rules/social-rules.json';
import {validateRules} from './validate';

/**
 * The site rules that come with the app: rules/social-rules.json at build
 * time. A signed update from the repository replaces them when it has a
 * higher version.
 */
export const BUNDLED_RULES = validateRules(bundled);
