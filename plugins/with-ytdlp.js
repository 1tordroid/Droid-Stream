const {Buffer} = require('buffer');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} = require('expo/config-plugins');

/**
 * The yt-dlp downloader: CPython through Chaquopy (MIT), our own Python bridge
 * from native-src/android/python, one pinned yt-dlp release (Unlicense) as an
 * asset, and Jetpack's JavaScript sandbox for YouTube's challenges.
 *
 * Python 3.11 is the newest version Chaquopy builds for 32-bit ARM, and the
 * app still ships armeabi-v7a. yt-dlp supports 3.11 today; when it moves past
 * 3.11, move this to a newer Python and limit the downloader to arm64.
 */
const CHAQUOPY_VERSION = '17.2.0';
const PYTHON_VERSION = '3.11';
const JS_ENGINE = 'androidx.javascriptengine:javascriptengine:1.1.1';
// The release bundled in the APK. "Update yt-dlp" replaces it at run time.
const YTDLP_VERSION = '2026.10.26';
const YTDLP_SHA256 = 'e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3';
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp`;

const CLASSPATH = `classpath('com.chaquo.python:gradle:${CHAQUOPY_VERSION}')`;
const APPLY = 'apply plugin: "com.chaquo.python"';
const BLOCK_MARKER = '// Droid Stream: Python for the yt-dlp downloader.';

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

const addClasspath = contents => {
  if (contents.includes('com.chaquo.python:gradle')) {
    return contents.replace(
      /classpath\(['"]com\.chaquo\.python:gradle:[^'"]+['"]\)/,
      CLASSPATH,
    );
  }
  return contents.replace(
    /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
    match => `${match}\n    ${CLASSPATH}`,
  );
};

const addAppGradle = contents => {
  let next = contents;
  if (!next.includes(APPLY)) {
    next = next.replace(
      /apply plugin: ["']com\.android\.application["']\n/,
      match => `${match}${APPLY}\n`,
    );
  }
  if (next.includes('androidx.javascriptengine:javascriptengine:')) {
    next = next.replace(/androidx\.javascriptengine:javascriptengine:[0-9.]+/g, JS_ENGINE);
  } else {
    next = next.replace(
      /dependencies\s*\{/,
      match => `${match}\n    implementation '${JS_ENGINE}'\n`,
    );
  }
  if (!next.includes(BLOCK_MARKER)) {
    next += `
${BLOCK_MARKER}
chaquopy {
    defaultConfig {
        version = "${PYTHON_VERSION}"
        pyc {
            // No Python is needed on the build machine. Chaquopy's standard
            // library is precompiled; yt-dlp writes its own cache at run time.
            src = false
        }
    }
}
`;
  }
  return next;
};

const downloadRelease = async () => {
  const cacheDir = path.join(os.tmpdir(), 'droidstream-ytdlp');
  const cached = path.join(cacheDir, `yt-dlp-${YTDLP_VERSION}`);
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === YTDLP_SHA256) {
    return fs.readFileSync(cached);
  }
  const response = await fetch(YTDLP_URL, {redirect: 'follow'});
  if (!response.ok) {
    throw new Error(`with-ytdlp: downloading yt-dlp ${YTDLP_VERSION} failed (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = sha256(buffer);
  if (digest !== YTDLP_SHA256) {
    throw new Error(`with-ytdlp: yt-dlp ${YTDLP_VERSION} checksum mismatch (${digest})`);
  }
  fs.mkdirSync(cacheDir, {recursive: true});
  fs.writeFileSync(cached, buffer);
  return buffer;
};

const withFiles = config =>
  withDangerousMod(config, [
    'android',
    async cfg => {
      const root = cfg.modRequest.projectRoot;
      const main = path.join(root, 'android', 'app', 'src', 'main');
      const pythonSource = path.join(root, 'native-src', 'android', 'python');
      const pythonTarget = path.join(main, 'python');
      fs.mkdirSync(pythonTarget, {recursive: true});
      for (const file of fs.readdirSync(pythonSource)) {
        if (file.endsWith('.py')) {
          fs.copyFileSync(path.join(pythonSource, file), path.join(pythonTarget, file));
        }
      }
      const assets = path.join(main, 'assets', 'ytdlp');
      fs.mkdirSync(assets, {recursive: true});
      const zip = path.join(assets, 'yt-dlp.zip');
      if (!fs.existsSync(zip) || sha256(fs.readFileSync(zip)) !== YTDLP_SHA256) {
        fs.writeFileSync(zip, await downloadRelease());
      }
      fs.writeFileSync(
        path.join(assets, 'bundled.json'),
        JSON.stringify({version: YTDLP_VERSION, sha256: YTDLP_SHA256}),
      );
      return cfg;
    },
  ]);

module.exports = function withYtdlp(config) {
  config = withProjectBuildGradle(config, cfg => {
    cfg.modResults.contents = addClasspath(cfg.modResults.contents);
    return cfg;
  });
  config = withAppBuildGradle(config, cfg => {
    cfg.modResults.contents = addAppGradle(cfg.modResults.contents);
    return cfg;
  });
  return withFiles(config);
};

module.exports.addClasspath = addClasspath;
module.exports.addAppGradle = addAppGradle;
module.exports.YTDLP_VERSION = YTDLP_VERSION;
