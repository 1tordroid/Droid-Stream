import {revealFeature} from './advancedReveal';
import type {FeatureEntry} from './featureRegistry';

export const openFeature = (entry: FeatureEntry): void => {
  if (entry.advanced) revealFeature(entry.id);
  const {navigationRef} = require('../App') as typeof import('../App');
  if (!navigationRef.isReady()) return;
  const params = {...(entry.route.params || {}), highlight: entry.id};
  navigationRef.navigate('TabStack', {
    screen: entry.route.tab,
    params: (entry.route.screen ? {screen: entry.route.screen, params} : params) as never,
  });
};
