import fs from 'fs';
import os from 'os';
import path from 'path';

type Mod = (config: any) => Promise<any>;
let mockMod: Mod | undefined;

jest.mock('expo/config-plugins', () => ({
  withDangerousMod: (config: any, [, mod]: [string, Mod]) => {
    mockMod = mod;
    return config;
  },
}));

const withAndroidSigning = require('../plugins/with-android-signing');
const {assertDistributionSigning, isDistributionBuild, missingSigningVariables, SIGNING_VARIABLES} =
  withAndroidSigning;

const SIGNED_ENV = {
  MYAPP_UPLOAD_STORE_FILE: '/tmp/release.keystore',
  MYAPP_UPLOAD_STORE_PASSWORD: 'store-secret',
  MYAPP_UPLOAD_KEY_ALIAS: 'upload',
  MYAPP_UPLOAD_KEY_PASSWORD: 'key-secret',
};

const BUILD_GRADLE = `apply plugin: "com.android.application"
apply plugin: "com.facebook.react"
android {
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('distribution signing check', () => {
  it('only applies when RELEASE=1', () => {
    expect(isDistributionBuild({})).toBe(false);
    expect(isDistributionBuild({RELEASE: '0'})).toBe(false);
    expect(isDistributionBuild({RELEASE: '1'})).toBe(true);
    expect(() => assertDistributionSigning({})).not.toThrow();
  });

  it('lists the missing variables by name', () => {
    expect(missingSigningVariables({})).toEqual(SIGNING_VARIABLES);
    expect(
      missingSigningVariables({...SIGNED_ENV, MYAPP_UPLOAD_KEY_PASSWORD: ''}),
    ).toEqual(['MYAPP_UPLOAD_KEY_PASSWORD']);
    expect(missingSigningVariables(SIGNED_ENV)).toEqual([]);
  });

  it('stops a distribution build without the upload key, never printing secrets', () => {
    const env = {RELEASE: '1', MYAPP_UPLOAD_STORE_PASSWORD: 'store-secret'};
    let message = '';
    try {
      assertDistributionSigning(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('MYAPP_UPLOAD_STORE_FILE');
    expect(message).toContain('MYAPP_UPLOAD_KEY_ALIAS');
    expect(message).toContain('MYAPP_UPLOAD_KEY_PASSWORD');
    expect(message).not.toContain('MYAPP_UPLOAD_STORE_PASSWORD');
    expect(message).not.toContain('store-secret');
    expect(() => assertDistributionSigning({RELEASE: '1', ...SIGNED_ENV})).not.toThrow();
  });
});

describe('signing config plugin', () => {
  const savedEnv = {...process.env};
  let projectRoot: string;
  let appDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'android-signing-'));
    appDir = path.join(projectRoot, 'android', 'app');
    fs.mkdirSync(appDir, {recursive: true});
    fs.writeFileSync(path.join(appDir, 'build.gradle'), BUILD_GRADLE);
    for (const name of ['RELEASE', ...SIGNING_VARIABLES]) delete process.env[name];
    withAndroidSigning({});
  });

  afterEach(() => {
    process.env = {...savedEnv};
    fs.rmSync(projectRoot, {recursive: true, force: true});
  });

  const signingGradle = () => fs.readFileSync(path.join(appDir, 'with-signing.gradle'), 'utf8');

  it('keeps the debug-key fallback for local builds and adds the release guard to Gradle', async () => {
    await mockMod!({modRequest: {projectRoot}});

    const gradle = signingGradle();
    expect(gradle).toContain("if (System.getenv('RELEASE') == '1') {");
    expect(gradle).toContain('throw new GradleException("RELEASE=1 but ${reason}.');
    // Both fallbacks stop a distribution build before the debug key is used.
    const fallbacks = gradle.split('useDebugKeyFor(delegate)');
    expect(fallbacks).toHaveLength(3);
    expect(fallbacks[0]).toMatch(/failIfDistribution\("the keystore file \$\{envStoreFile\} does not exist"\)\s*$/);
    expect(fallbacks[1]).toMatch(/failIfDistribution\("these signing variables are missing: \$\{missing\.join\(', '\)\}"\)\s*$/);
    // Passwords are masked in the build log.
    expect(gradle).not.toMatch(/println .*\$\{env(Store|Key)Password\}/);

    const build = fs.readFileSync(path.join(appDir, 'build.gradle'), 'utf8');
    expect(build).toContain("apply from: 'with-signing.gradle'");
    expect(build).toContain('signingConfig signingConfigs.release');
  });

  it('fails at prebuild when RELEASE=1 and the upload key is missing', async () => {
    process.env.RELEASE = '1';
    await expect(mockMod!({modRequest: {projectRoot}})).rejects.toThrow(
      'RELEASE=1 but these signing variables are missing',
    );
    expect(fs.existsSync(path.join(appDir, 'with-signing.gradle'))).toBe(false);
  });

  it('runs when RELEASE=1 and every variable is set', async () => {
    Object.assign(process.env, {RELEASE: '1', ...SIGNED_ENV});
    await mockMod!({modRequest: {projectRoot}});
    expect(signingGradle()).toContain('failIfDistribution');
  });
});

describe('release workflows', () => {
  it('set RELEASE=1 for distribution builds', () => {
    for (const workflow of ['release.yml', 'action-build.yml']) {
      const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', workflow), 'utf8');
      expect(text).toMatch(/^ {6}RELEASE: '1'\r?$/m);
    }
  });
});
