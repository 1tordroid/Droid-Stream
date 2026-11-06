// Generic react-native-reanimated stand-in for screens rendered in tests.
const React = require('react');
const RN = require('react-native');
const passthrough = value => value;
const animated = {
  View: RN.View,
  Text: RN.Text,
  Image: RN.Image,
  ScrollView: RN.ScrollView,
  FlatList: RN.FlatList,
  createAnimatedComponent: component => component,
  addWhitelistedUIProps: () => undefined,
  addWhitelistedNativeProps: () => undefined,
};
const known = {
  __esModule: true,
  default: animated,
  ...animated,
  useSharedValue: initial => React.useRef({value: initial, get() { return this.value; }, set(v) { this.value = v; }}).current,
  useAnimatedStyle: fn => { try { return fn(); } catch { return {}; } },
  useAnimatedProps: fn => { try { return fn(); } catch { return {}; } },
  useDerivedValue: fn => ({value: (() => { try { return fn(); } catch { return undefined; } })()}),
  useAnimatedScrollHandler: () => () => undefined,
  useAnimatedRef: () => React.useRef(null),
  useAnimatedReaction: () => undefined,
  useReducedMotion: () => false,
  withTiming: passthrough,
  withSpring: passthrough,
  withDelay: (_delay, value) => value,
  withRepeat: passthrough,
  withSequence: (...values) => values[values.length - 1],
  cancelAnimation: () => undefined,
  runOnJS: fn => fn,
  runOnUI: fn => fn,
  interpolate: (_value, _input, output) => output[0],
  interpolateColor: (_value, _input, output) => output[0],
  Extrapolation: {CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity'},
  Easing: new Proxy({}, {get: () => () => passthrough}),
  ReduceMotion: {System: 'system', Always: 'always', Never: 'never'},
};
const layout = new Proxy(function () {}, {
  get: () => layout,
  apply: () => layout,
});
module.exports = new Proxy(known, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && /^[A-Z]/.test(key)) return layout;
    return () => undefined;
  },
});
