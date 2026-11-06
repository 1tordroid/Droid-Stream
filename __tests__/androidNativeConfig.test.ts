import {describe, expect, it} from '@jest/globals';

const withAndroidNativeConfig = require('../plugins/android-native-config');

const runManifestMod = async () => {
  const config = withAndroidNativeConfig({name: 'test', slug: 'test'});
  const result = await config.mods.android.manifest({
    modResults: {
      manifest: {
        $: {},
        application: [
          {$: {}, activity: [{$: {'android:name': '.MainActivity'}}]},
        ],
      },
    },
    modRequest: {platform: 'android'},
    modRawConfig: {},
  });
  return result.modResults.manifest;
};

describe('android-native-config plugin', () => {
  it('removes the WebRTC screen capture service from the merged manifest', async () => {
    const manifest = await runManifestMod();
    expect(manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(manifest.application[0].service).toEqual([
      {
        $: {
          'android:name': 'com.oney.WebRTCModule.MediaProjectionService',
          'tools:node': 'remove',
        },
      },
    ]);
  });
});

describe('app.config.js permissions', () => {
  it('does not ask for system settings or overlay access', () => {
    const appConfig = require('../app.config.js');
    const resolved =
      typeof appConfig === 'function' ? appConfig({config: {}}) : appConfig;
    const android = (resolved.expo ?? resolved).android;
    expect(android.permissions).not.toContain('WRITE_SETTINGS');
    expect(android.blockedPermissions).toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
  });
});
