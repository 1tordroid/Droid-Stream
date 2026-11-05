const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

// Android tints the focused view after any key press from a keyboard or remote.
// React Native's root view can hold focus, which greys out the whole screen.
// Droid Stream draws its own focus rings through TVFocusable.
module.exports = config =>
  withAndroidStyles(config, mod => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'android:defaultFocusHighlightEnabled',
      value: 'false',
    });
    return mod;
  });
