const {withAndroidManifest, withAppBuildGradle, withMainApplication} = require('expo/config-plugins');

/**
 * The built-in browser: registers BrowserPackage (native-src/android/com/vega/
 * BrowserModule.kt, copied by with-custom-native-modules.js), adds
 * androidx.webkit for passkeys, and accepts file links that other browsers
 * hand to an outside download manager.
 */

// Types another browser sends with a file link. Video types already go to
// the player (.VideoPlayer); these become a download.
const DOWNLOAD_TYPES = [
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/vnd.android.package-archive',
  'application/pdf',
  'application/x-matroska',
  'application/x-bittorrent',
  'application/force-download',
  'binary/octet-stream',
  'audio/*',
];

const withBrowserPackage = config =>
  withMainApplication(config, cfg => {
    if (!cfg.modResults.contents.includes('add(BrowserPackage())')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /PackageList\(this\)\.packages\.apply \{\n/,
        match => `${match}              add(BrowserPackage())\n`,
      );
    }
    return cfg;
  });

// BrowserModule.kt sets passkey support through androidx.webkit, which
// react-native-webview only has as an implementation dependency.
const WEBKIT = 'androidx.webkit:webkit:1.14.0';

const withWebkit = config =>
  withAppBuildGradle(config, cfg => {
    if (!cfg.modResults.contents.includes('androidx.webkit:webkit')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n    implementation '${WEBKIT}'\n`,
      );
    }
    return cfg;
  });

const withBrowserManifest = config =>
  withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    const app = manifest.application?.[0];
    if (app) {
      app['activity-alias'] = (app['activity-alias'] || []).filter(alias => alias.$?.['android:name'] !== '.LinkDownloader');
      app['activity-alias'].push({
        $: {
          'android:name': '.LinkDownloader',
          'android:targetActivity': '.MainActivity',
          'android:exported': 'true',
          'android:enabled': 'true',
          'android:label': '@string/app_name',
        },
        'intent-filter': [
          {
            action: [{$: {'android:name': 'android.intent.action.VIEW'}}],
            category: [
              {$: {'android:name': 'android.intent.category.DEFAULT'}},
              {$: {'android:name': 'android.intent.category.BROWSABLE'}},
            ],
            data: [
              {$: {'android:scheme': 'http'}},
              {$: {'android:scheme': 'https'}},
              ...DOWNLOAD_TYPES.map(mime => ({$: {'android:mimeType': mime}})),
            ],
          },
        ],
      });
    }
    return cfg;
  });

module.exports = config => withBrowserManifest(withWebkit(withBrowserPackage(config)));
module.exports.DOWNLOAD_TYPES = DOWNLOAD_TYPES;
