const fs = require('fs');
const path = require('path');
const {withDangerousMod} = require('expo/config-plugins');

const SIGNING_VARIABLES = [
  'MYAPP_UPLOAD_STORE_FILE',
  'MYAPP_UPLOAD_STORE_PASSWORD',
  'MYAPP_UPLOAD_KEY_ALIAS',
  'MYAPP_UPLOAD_KEY_PASSWORD',
];

/** Builds meant for distribution set RELEASE=1 (release, nightly and action-build workflows). */
const isDistributionBuild = (env = process.env) => env.RELEASE === '1';

/** Names (never values) of the signing variables that are not set. */
const missingSigningVariables = (env = process.env) =>
  SIGNING_VARIABLES.filter(name => !env[name]);

/**
 * Stops a distribution build early, at prebuild, when the upload key is not
 * configured. The Gradle file below checks again at build time.
 */
const assertDistributionSigning = (env = process.env) => {
  if (!isDistributionBuild(env)) return;
  const missing = missingSigningVariables(env);
  if (missing.length) {
    throw new Error(
      `RELEASE=1 but these signing variables are missing: ${missing.join(', ')}. ` +
        'Set them, or unset RELEASE for a local test build signed with the debug key.',
    );
  }
};

/**
 * Adds release signing configuration that reads from env vars after prebuild.
 * Uses a Gradle file that applies signing config during the android block evaluation.
 */
module.exports = function withAndroidSigning(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      assertDistributionSigning();
      const projectRoot = cfg.modRequest.projectRoot;
      const appDir = path.join(projectRoot, 'android', 'app');
      const buildGradle = path.join(appDir, 'build.gradle');
      const signingGradle = path.join(appDir, 'with-signing.gradle');

      // Auto-copy keystore to android/app if it exists
      const keystoreSrc = path.join(projectRoot, 'vega-key.keystore');
      const keystoreDest = path.join(appDir, 'vega-key.keystore');
      if (fs.existsSync(keystoreSrc)) {
        fs.copyFileSync(keystoreSrc, keystoreDest);
      }

      // Create signing gradle that extends signingConfigs during android block
      const signingContent = `// Auto-applied by with-android-signing config plugin
// Test builds without release secrets: sign "release" with the debug key so
// packageRelease works. Real releases set the four MYAPP_UPLOAD_* variables.
// Distribution builds (RELEASE=1) never fall back to the debug key: a
// debug-signed update cannot install over the release app, and uninstalling
// it to get past that deletes every saved sign-in.
def failIfDistribution = { reason ->
    if (System.getenv('RELEASE') == '1') {
        throw new GradleException("RELEASE=1 but \${reason}. Set MYAPP_UPLOAD_STORE_FILE, MYAPP_UPLOAD_STORE_PASSWORD, MYAPP_UPLOAD_KEY_ALIAS and MYAPP_UPLOAD_KEY_PASSWORD, or unset RELEASE for a local test build signed with the debug key.")
    }
}

def useDebugKeyFor = { config ->
    def candidates = [file('debug.keystore'), rootProject.file('../debug.keystore'), file("\${System.getProperty('user.home')}/.android/debug.keystore")]
    def debugStore = candidates.find { it.exists() }
    if (debugStore) {
        config.storeFile = debugStore
        config.storePassword = 'android'
        config.keyAlias = 'androiddebugkey'
        config.keyPassword = 'android'
        println "Release build signed with the debug key: \${debugStore}"
    } else {
        println "No debug.keystore found; the release build cannot be signed"
    }
}

android {
    signingConfigs {
        release {
            def envStoreFile = System.getenv('MYAPP_UPLOAD_STORE_FILE')
            def envStorePassword = System.getenv('MYAPP_UPLOAD_STORE_PASSWORD')
            def envKeyAlias = System.getenv('MYAPP_UPLOAD_KEY_ALIAS')
            def envKeyPassword = System.getenv('MYAPP_UPLOAD_KEY_PASSWORD')
            
            if (envStoreFile && envStorePassword && envKeyAlias && envKeyPassword) {
                def keystoreFile = file(envStoreFile)
                println "Keystore file path: \${envStoreFile}"
                println "Keystore file exists: \${keystoreFile.exists()}"
                
                if (keystoreFile.exists()) {
                    storeFile keystoreFile
                    storePassword envStorePassword
                    keyAlias envKeyAlias
                    keyPassword envKeyPassword
                    println "Release signing config configured successfully"
                } else {
                    println "Keystore file not found: \${envStoreFile}"
                    failIfDistribution("the keystore file \${envStoreFile} does not exist")
                    useDebugKeyFor(delegate)
                }
            } else {
                println "Missing signing environment variables:"
                println "  MYAPP_UPLOAD_STORE_FILE: \${envStoreFile}"
                println "  MYAPP_UPLOAD_STORE_PASSWORD: \${envStorePassword ? '***' : 'null'}"
                println "  MYAPP_UPLOAD_KEY_ALIAS: \${envKeyAlias}"
                println "  MYAPP_UPLOAD_KEY_PASSWORD: \${envKeyPassword ? '***' : 'null'}"
                def missing = ['MYAPP_UPLOAD_STORE_FILE', 'MYAPP_UPLOAD_STORE_PASSWORD', 'MYAPP_UPLOAD_KEY_ALIAS', 'MYAPP_UPLOAD_KEY_PASSWORD'].findAll { !System.getenv(it) }
                failIfDistribution("these signing variables are missing: \${missing.join(', ')}")
                useDebugKeyFor(delegate)
            }
        }
    }
}

// Use afterEvaluate to forcefully override the release signing config
afterEvaluate {
    def releaseSigningConfig = android.signingConfigs.release
    println "🔧 Final signing config check:"
    println "  Release signingConfig storeFile: \${releaseSigningConfig.storeFile}"
    println "  Current release buildType signingConfig: \${android.buildTypes.release.signingConfig?.name}"
    
    if (releaseSigningConfig.storeFile && releaseSigningConfig.storeFile.exists()) {
        // Force override the signing config
        android.buildTypes.release.signingConfig = releaseSigningConfig
        println "✅ Applied release signing config: \${releaseSigningConfig.storeFile.absolutePath}"
        println "  Final release buildType signingConfig: \${android.buildTypes.release.signingConfig?.name}"
    } else {
        println "❌ Release signing config not applied, using debug keystore"
        if (releaseSigningConfig.storeFile) {
            println "   Keystore file does not exist: \${releaseSigningConfig.storeFile.absolutePath}"
        } else {
            println "   No keystore file configured"
        }
    }
}
`;
      fs.writeFileSync(signingGradle, signingContent, 'utf8');

      // Idempotently add apply from with-signing.gradle
      let gradleText = fs.readFileSync(buildGradle, 'utf8');
      if (!gradleText.includes("apply from: 'with-signing.gradle'")) {
        // Find the last apply from line and add our line after it
        const applyFromLines = gradleText.match(/apply from: '[^']+'/g);
        if (applyFromLines && applyFromLines.length > 0) {
          const lastApplyFrom = applyFromLines[applyFromLines.length - 1];
          gradleText = gradleText.replace(
            lastApplyFrom,
            `${lastApplyFrom}\napply from: 'with-signing.gradle'`,
          );
        } else {
          // If no apply from lines found, add after React plugin
          gradleText = gradleText.replace(
            /apply plugin: "com\.facebook\.react"/,
            `apply plugin: "com.facebook.react"\napply from: 'with-signing.gradle'`,
          );
        }
        fs.writeFileSync(buildGradle, gradleText, 'utf8');
      }

      // Fix release buildType to use signingConfigs.release instead of debug
      gradleText = fs.readFileSync(buildGradle, 'utf8');
      gradleText = gradleText.replace(
        /release\s*\{[^}]*signingConfig\s+signingConfigs\.debug/,
        match =>
          match.replace('signingConfigs.debug', 'signingConfigs.release'),
      );
      fs.writeFileSync(buildGradle, gradleText, 'utf8');

      return cfg;
    },
  ]);
};

module.exports.SIGNING_VARIABLES = SIGNING_VARIABLES;
module.exports.isDistributionBuild = isDistributionBuild;
module.exports.missingSigningVariables = missingSigningVariables;
module.exports.assertDistributionSigning = assertDistributionSigning;
