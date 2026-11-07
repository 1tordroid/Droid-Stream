const fs = require('fs');
const path = require('path');
const {withDangerousMod} = require('expo/config-plugins');

/**
 * Ensures custom release build logic (APK renaming and buildTypes settings) is re-applied after prebuild.
 * Adds or updates a Gradle script at android/app/with-release-config.gradle and applies it.
 */
module.exports = function withAndroidReleaseGradle(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appDir = path.join(projectRoot, 'android', 'app');
      const buildGradle = path.join(appDir, 'build.gradle');
      const helperGradle = path.join(appDir, 'with-release-config.gradle');
      const abiSplitsGradle = path.join(appDir, 'with-abi-splits.gradle');

      // Write helper gradle to add the APK rename logic if not present
      const helperContent = `// Auto-applied by with-android-release-gradle config plugin
if (project.android) {
  // One APK for phone and TV: no variant in the name, so the in-app updater
  // picks the same file on both.
  def baseAppName = "DroidStream"
  project.ext { appName = baseAppName }

  project.android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
      def version = variant.versionName
      def newName = output.outputFile.name
      newName = newName.replace("app-", "\${project.ext.appName}-")
      newName = newName.replace("-release", "-v" + version)
      output.outputFileName = newName
    }
  }
}
`;
      fs.writeFileSync(helperGradle, helperContent, 'utf8');

      // Write ABI splits gradle which disables splits and ensures universal ARM build.
      // Release builds ship one APK with both ARM ABIs; the release workflows
      // derive the arm64 APK from it (scripts/release/arm64_apk.py).
      // -PdroidstreamArm64Only (local phone builds) or -PdroidstreamAbis=x86_64
      // (the CI emulator) narrow it; pass the same list as
      // -PreactNativeArchitectures.
      const abiSplitsContent = `// Auto-applied by with-android-release-gradle config plugin
if (project.android) {
  def droidstreamAbis = project.hasProperty('droidstreamAbis')
    ? project.property('droidstreamAbis').toString().split(',').collect { it.trim() }.findAll { it }
    : []
  project.android {
    splits {
      abi {
        enable false
      }
    }
    defaultConfig {
      ndk {
        if (!droidstreamAbis.isEmpty()) {
          abiFilters.addAll(droidstreamAbis)
        } else if (project.hasProperty('droidstreamArm64Only')) {
          abiFilters 'arm64-v8a'
        } else {
          abiFilters 'armeabi-v7a', 'arm64-v8a'
        }
      }
    }
    packagingOptions {
      jniLibs {
        useLegacyPackaging true
      }
      dex {
        useLegacyPackaging true
      }
      resources {
        pickFirsts += ['org/bouncycastle/**', 'META-INF/versions/**']
      }
    }
  }
  // The torrent engine for an x86_64 emulator build. ARM builds get theirs
  // from with-custom-native-modules.
  if (droidstreamAbis.contains('x86_64')) {
    project.dependencies {
      implementation 'org.libtorrent4j:libtorrent4j-android-x86_64:2.1.0-39'
    }
  }
}
`;
      fs.writeFileSync(abiSplitsGradle, abiSplitsContent, 'utf8');

      // Intentionally avoid modifying signing configs here to prevent AGP DSL timing issues.

      // Idempotently ensure the helper is applied in build.gradle
      let gradleText = fs.readFileSync(buildGradle, 'utf8');
      if (!gradleText.includes("apply from: 'with-release-config.gradle'")) {
        // Apply near top of file after existing plugins
        gradleText = gradleText.replace(
          /(apply plugin:[\s\S]*?\n)(?=\n|def|android\s*\{)/,
          `$1apply from: 'with-release-config.gradle'\n`,
        );
      }

      if (!gradleText.includes("apply from: 'with-abi-splits.gradle'")) {
        gradleText = gradleText.replace(
          /(apply plugin:[\s\S]*?\n)(?=\n|def|android\s*\{)/,
          `$1apply from: 'with-abi-splits.gradle'\n`,
        );
      }

      // Remove any stale apply of with-signing-config.gradle (from earlier versions)
      gradleText = gradleText.replace(
        /^apply from: 'with-signing-config.gradle'\s*\n/m,
        '',
      );

      fs.writeFileSync(buildGradle, gradleText, 'utf8');

      return cfg;
    },
  ]);
};
