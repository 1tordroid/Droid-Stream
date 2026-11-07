const tmdbApiKey =
  process.env.TMDB_API_KEY || process.env.EXPO_PUBLIC_TMDB_API_KEY || '';
const proxyApiUrl =
  process.env.PROXY_API_URL ||
  process.env.EXPO_PUBLIC_PROXY_API_URL ||
  process.env.META_PROXY_URL ||
  '';

module.exports = () => {
  const IS_PLAYSTORE = process.env.APP_VARIANT === 'playstore';
  const IS_TV = process.env.EXPO_TV === '1' || process.env.APP_VARIANT === 'tv';
  // Local test builds that install beside the release app, so an update can
  // be tested without touching the installed app or its data.
  const IS_PREVIEW = process.env.APP_VARIANT === 'preview';
  const APP_NAME = IS_PREVIEW ? 'Droid Stream Preview' : 'Droid Stream';
  // Distinct from Vega (com.vega / vega.app) so both apps can be installed.
  // The Play build drops REQUEST_INSTALL_PACKAGES, so it uses its own id. The
  // preview gets its own package as well (not just an application id suffix):
  // launcher aliases, the video player alias and notification taps build class
  // names from the package, so the code namespace must match it.
  const PACKAGE_NAME = IS_PLAYSTORE
    ? 'com.tordroid.droidstream.play'
    : IS_PREVIEW
      ? 'com.tordroid.droidstream.preview'
      : 'com.tordroid.droidstream';
  const plugins = [
    './plugins/with-custom-native-modules.js',
    // yt-dlp downloader: Chaquopy Python, the bundled yt-dlp release, JS sandbox.
    './plugins/with-ytdlp.js',
      [
        'expo-camera',
        {
          cameraPermission: 'Allow Droid Stream to scan receiver QR codes.',
          recordAudioAndroid: false,
        },
      ],
    './plugins/android-native-config.js',
    './plugins/with-saf-copy-module.js',
    './plugins/with-uri-permission-module.js',
    './plugins/with-proguard-rules.js',
    './plugins/with-no-focus-highlight.js',
    './plugins/with-jvm-args.js',
    './plugins/with-android-notification-icons.js',
    './plugins/with-notifee-service.js',
    './plugins/with-android-release-gradle.js',
    './plugins/with-native-scroll-performance.js',
    './plugins/with-android-signing.js',
    './plugins/with-android-okhttp.js',
    // Keeps the encrypted sign-in stores out of Auto Backup and device
    // transfer; their Keystore keys never leave the phone.
    './plugins/with-backup-rules.js',
    'react-native-vlc-media-player',
    [
      'react-native-video',
      {
        enableNotificationControls: true,
        enableAndroidPictureInPicture: true,
        androidExtensions: {
          useExoplayerRtsp: false,
          useExoplayerSmoothStreaming: true,
          useExoplayerHls: true,
          useExoplayerDash: true,
        },
      },
    ],
    [
      'react-native-google-cast',
      {
        // Avoid unreviewed SDK upgrades requiring a newer compileSdk/AGP/Kotlin.
        androidPlayServicesCastFrameworkVersion: '22.3.1',
        expandedController: true,
      },
    ],
    'react-native-edge-to-edge',
    // Manifest mods execute in reverse order: configure TV before moving its
    // launcher intent onto the color aliases.
    './plugins/with-dynamic-launcher-splash.js',
    [
      'react-native-bootsplash',
      {
        // v7 generates the splash at prebuild from this logo. Edge-to-edge is
        // the default, so there is no parentTheme any more.
        logo: './assets/bootsplash/logo@4x.png',
        logoWidth: 200,
        background: '#000000',
        assetsOutput: 'assets/bootsplash',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // libtorrent4j's native library is built for API 28 and calls libc
          // functions (getentropy, aligned_alloc) missing before Android 9.
          minSdkVersion: 28,
          // Windows only. React Native 0.88's codegen object paths pass 260
          // characters, and the Ninja in the default CMake 3.22.1 cannot open
          // them. CMake 3.31.6 ships Ninja 1.12, which can when Windows long
          // paths are on. Linux CI keeps the default CMake.
          ...(process.platform === 'win32' ? {cmakeVersion: '3.31.6'} : {}),
          usePrecompiledHeaders: true,
          // ByeDPI and WARP run bundled binaries from nativeLibraryDir, so the
          // .so files must be extracted on install.
          useLegacyPackaging: true,
          extraMavenRepos: [
            '../../node_modules/@notifee/react-native/android/libs',
          ],
          enableProguardInReleaseBuilds: true,
          splits: {
            abi: {
              enable: true,
              reset: false,
              include: ['armeabi-v7a', 'arm64-v8a'],
              universalApk: true,
            },
          },
          buildVariants: {
            release: {
              minifyEnabled: true,
              shrinkResources: true,
              splits: {
                abi: {
                  enable: true,
                  reset: false,
                  include: ['armeabi-v7a', 'arm64-v8a'],
                },
              },
            },
            debug: {minifyEnabled: false, debuggable: true},
          },
        },
        ios: {},
      },
    ],

    [
      'expo-font',
      {fonts: ['./assets/fonts/Inter_400Regular.ttf', './assets/fonts/Inter_500Medium.ttf', './assets/fonts/Inter_700Bold.ttf', './assets/fonts/Inter_800ExtraBold.ttf', './assets/fonts/Inter_400Regular_bold.ttf', './assets/fonts/Inter_500Medium_bold.ttf', './assets/fonts/Inter_700Bold_bold.ttf', './assets/fonts/Inter_800ExtraBold_bold.ttf', './assets/fonts/Inter_400Regular_italic.ttf', './assets/fonts/Inter_400Regular_bold_italic.ttf']},
    ],
    'expo-status-bar',
    ...(IS_TV
      ? [
          [
            '@react-native-tvos/config-tv',
            {
              isTV: true,
              androidTVBanner: './assets/tv-banner.png',
            },
          ],
        ]
      : []),
  ];
  return {
    expo: {
      name: APP_NAME,
      // com.vega, vegaapp, and vega-cast stay so existing provider, share,
      // and Vega Cast links still open this install.
      scheme: [
        'droidstream',
        'com.tordroid.droidstream',
        'com.vega',
        'vegaapp',
        'vega-cast',
      ],
      displayName: APP_NAME,
      jsEngine: 'hermes',
      newArchEnabled: true,
      autolinking: {exclude: ['expo-splash-screen']},
      plugins,
      slug: 'droid-stream',
      icon: './assets/icon.png',
      version: '5.5.0',
      userInterfaceStyle: 'dark',
      experiments: {
        reactCompiler: true,
      },
      android: {
        package: PACKAGE_NAME,
        versionCode: 221,
        permissions: [
          'FOREGROUND_SERVICE',
          'FOREGROUND_SERVICE_DATA_SYNC',
          'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
          'ACCESS_NETWORK_STATE',
          'ACCESS_WIFI_STATE',
          'CHANGE_WIFI_MULTICAST_STATE',
          'INTERNET',
          'WAKE_LOCK',
          'POST_NOTIFICATIONS',
          'RECEIVE_BOOT_COMPLETED',
        ],
        blockedPermissions: [
          // Casting uses WebRTC data channels, not microphone capture.
          'android.permission.RECORD_AUDIO',
          // No overlay windows: picture-in-picture does not need this.
          'android.permission.SYSTEM_ALERT_WINDOW',
          // Not used; blocked so older generated projects drop it too.
          'android.permission.WRITE_SETTINGS',
          'android.permission.MANAGE_EXTERNAL_STORAGE',
          'android.permission.READ_EXTERNAL_STORAGE',
          'android.permission.READ_MEDIA_VIDEO',
          'android.permission.WRITE_EXTERNAL_STORAGE',
          ...(IS_PLAYSTORE
            ? [
                'android.permission.REQUEST_INSTALL_PACKAGES',
                'com.google.android.gms.permission.AD_ID',
              ]
            : []),
        ],
        queries: [
          {action: 'VIEW', data: {scheme: 'http'}},
          {action: 'VIEW', data: {scheme: 'https'}},
          {action: 'VIEW', data: {scheme: 'vlc'}},
        ],
        allowBackup: true,
        adaptiveIcon: {
          foregroundImage: './assets/adaptive_icon.png',
          monochromeImage: './assets/adaptive_icon_monochrome.png',
          backgroundColor: '#000000',
        },
        launchMode: 'singleTask',
        supportsPictureInPicture: true,
      },
      ios: {},
      platforms: ['ios', 'android'],
      extra: {
        vegaCastServiceUrl:
          process.env.VEGA_CAST_SERVICE_URL ||
          'https://cast.vega-app.in/vega-cast/v1',
        // Optional STUN/TURN servers. Use short-lived TURN credentials in builds;
        // never commit a permanent relay secret. Empty means same-LAN ICE only.
        vegaCastIceServers: JSON.parse(
          process.env.VEGA_CAST_ICE_SERVERS || '[]',
        ),
        eas: {
          projectId: '40d98354-d3c8-4616-ab2e-70d9c297091f',
        },
        isPlayStore: IS_PLAYSTORE,
        isTV: IS_TV,
        tmdbApiKey,
        proxyApiUrl,
      },
    },
  };
};
