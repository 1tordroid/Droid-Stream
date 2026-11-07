const reactNativeConfig = require('@react-native/eslint-config/flat');

module.exports = [
  {
    // Same files as the old .eslintrc setup: .js, .ts and .tsx sources only.
    ignores: ['android/**', 'ios/**', '**/*.cjs', '**/*.mjs'],
  },
  ...reactNativeConfig,
  {
    rules: {
      'react-native/no-inline-styles': 0,
      'react-hooks/exhaustive-deps': 0,
      'react-hooks/rules-of-hooks': 0,
      'react/no-unstable-nested-components': 0,
      'no-new-func': 0,
    },
  },
];
