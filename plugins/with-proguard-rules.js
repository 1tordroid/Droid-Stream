const fs = require('fs');
const path = require('path');
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');

// AGP 9 reads a bare "-keep class X" rule strictly: X's default constructor is
// no longer kept. Many library consumer rules rely on it (Room in WorkManager
// 2.8, Notifee, Firebase and ML Kit component registrars, expo-modules-core),
// and release builds then crash at start with "Failed to create an instance
// of class androidx.work.impl.WorkDatabase". Keep the AGP 8 reading until
// those libraries ship explicit constructor rules (AGP 10 drops this switch).
const STRICT_KEEP_RULES = 'android.r8.strictFullModeForKeepRules';

const withLenientKeepRules = config =>
  withGradleProperties(config, cfg => {
    cfg.modResults = cfg.modResults.filter(
      item => !(item.type === 'property' && item.key === STRICT_KEEP_RULES),
    );
    cfg.modResults.push({ type: 'property', key: STRICT_KEEP_RULES, value: 'false' });
    return cfg;
  });

const RULES = `
# Add any project specific keep options here:

# libtorrent4j (Required for JNI to find the classes and methods)
-keep class org.libtorrent4j.** { *; }
-keep interface org.libtorrent4j.** { *; }
-keep enum org.libtorrent4j.** { *; }

# Keep custom native modules (both com.vega and dynamic package)
-keep class com.vega.** { *; }
`;
// org.jitsi:webrtc:155.0.1 omits Dav1dDecoder and its Natives interface,
// but includes a leftover Dav1dDecoderJni stub. No decoder factory uses it.
const WEBRTC_RULES = `
# Optional AV1 JNI stub in the WebRTC data-channel dependency
-dontwarn org.webrtc.Dav1dDecoder$Natives
`;

// smbj (SMB sources) references Kerberos (org.ietf.jgss) and its event bus
// (mbassador) references javax.el. Android ships neither and Droid Stream
// uses neither path (NTLM only), so R8 must not fail on them.
const SMB_RULES = `
# smbj: optional Kerberos/SPNEGO and mbassador EL filters
-dontwarn org.ietf.jgss.**
-dontwarn javax.el.**
-keep class com.hierynomus.** { *; }
-keep class net.engio.mbassy.** { *; }
-keepattributes *Annotation*
`;

module.exports = function withProguardRules(config) {
  config = withLenientKeepRules(config);
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const proguardRulesFile = path.join(
        cfg.modRequest.projectRoot,
        'android',
        'app',
        'proguard-rules.pro'
      );
      
      const packageName = cfg.android?.package || 'com.tordroid.droidstream';

      if (fs.existsSync(proguardRulesFile)) {
        let content = fs.readFileSync(proguardRulesFile, 'utf8');
        if (!content.includes('org.libtorrent4j')) {
          content += RULES;
          // Add the current package name to proguard rules
          if (packageName !== 'com.vega') {
            content += `-keep class ${packageName}.** { *; }\n`;
          }
        }
        if (!content.includes('-dontwarn org.webrtc.Dav1dDecoder$Natives')) {
          content += WEBRTC_RULES;
        }
        if (!content.includes('-dontwarn org.ietf.jgss.**')) {
          content += SMB_RULES;
        }
        fs.writeFileSync(proguardRulesFile, content, 'utf8');
      }
      return cfg;
    },
  ]);
};
