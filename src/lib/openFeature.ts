import {revealFeature} from './advancedReveal';
import type {FeatureEntry} from './featureRegistry';
import {isKidsProfileActive} from './profiles/profiles';

export const openFeature = (entry: FeatureEntry): void => {
  // Features live in Settings, Torrents and sign-in pages, which a kids profile does not have.
  if (isKidsProfileActive()) return;
  if (entry.advanced) revealFeature(entry.id);
  const {navigationRef} = require('../App') as typeof import('../App');
  if (!navigationRef.isReady()) return;
  const params = {...(entry.route.params || {}), highlight: entry.id};
  navigationRef.navigate('TabStack', {
    screen: entry.route.tab,
    params: (entry.route.screen ? {screen: entry.route.screen, params} : params) as never,
  });
};
