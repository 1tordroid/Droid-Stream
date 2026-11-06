import fs from 'fs';
import os from 'os';
import path from 'path';

type Mod = (config: any) => any;
const mockMods: {manifest?: Mod; dangerous?: Mod} = {};

jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: any, mod: Mod) => {
    mockMods.manifest = mod;
    return config;
  },
  withDangerousMod: (config: any, [, mod]: [string, Mod]) => {
    mockMods.dangerous = mod;
    return config;
  },
}));

const withBackupRules = require('../plugins/with-backup-rules');
const {
  ENCRYPTED_INSTANCE_IDS,
  buildBackupRulesXml,
  buildDataExtractionRulesXml,
  excludedPaths,
  keyAlias,
  setBackupRuleAttributes,
} = withBackupRules;
const {parseStringPromise} = require('xml2js');
const {stringToHex} = jest.requireActual('react-native-mmkv-storage/dist/src/utils');

const excludes = (section: any): string[] =>
  (section.exclude || []).map((item: any) => {
    expect(item.$.domain).toBe('file');
    return item.$.path;
  });

const expectedPathsFor = (id: string): string[] => {
  const alias = stringToHex(`com.MMKV.${id}`);
  return [`mmkv/${id}`, `mmkv/${id}.crc`, `SKS_KEY_FILE${alias}`, `SKS_DATA_FILE${alias}`];
};

describe('key alias', () => {
  it('matches the library alias for each encrypted instance', () => {
    expect(keyAlias('droid-stream-sources')).toBe(stringToHex('com.MMKV.droid-stream-sources'));
    // The library writes one hex pair per ASCII character.
    expect(keyAlias('droid-stream-sources')).toBe(
      Buffer.from('com.MMKV.droid-stream-sources').toString('hex'),
    );
    for (const id of ENCRYPTED_INSTANCE_IDS) {
      expect(keyAlias(id)).toBe(stringToHex(`com.MMKV.${id}`));
    }
  });
});

describe('rule files', () => {
  it('exclude the data and key files of every encrypted store, and the instance index', () => {
    const paths = excludedPaths();
    for (const id of ENCRYPTED_INSTANCE_IDS) {
      expect(paths).toEqual(expect.arrayContaining(expectedPathsFor(id)));
    }
    expect(paths).toEqual(expect.arrayContaining(['mmkv/mmkvIDStore', 'mmkv/mmkvIDStore.crc']));
    expect(paths).toHaveLength(ENCRYPTED_INSTANCE_IDS.length * 4 + 2);
  });

  it('keep unencrypted settings in the backup', () => {
    const paths: string[] = excludedPaths();
    for (const kept of ['mmkv/default', 'mmkv/cache', 'mmkv/provider_kv', 'mmkv/watch-progress']) {
      expect(paths).not.toContain(kept);
    }
  });

  it('write a full-backup-content file for Android 11 and lower', async () => {
    const xml = await parseStringPromise(buildBackupRulesXml());
    expect(Object.keys(xml)).toEqual(['full-backup-content']);
    expect(xml['full-backup-content'].include).toBeUndefined();
    expect(excludes(xml['full-backup-content'])).toEqual(excludedPaths());
  });

  it('write cloud-backup and device-transfer rules for Android 12 and higher', async () => {
    const xml = await parseStringPromise(buildDataExtractionRulesXml());
    const root = xml['data-extraction-rules'];
    expect(root).toBeDefined();
    for (const section of ['cloud-backup', 'device-transfer']) {
      expect(root[section]).toHaveLength(1);
      expect(root[section][0].include).toBeUndefined();
      expect(excludes(root[section][0])).toEqual(excludedPaths());
    }
  });
});

describe('config plugin', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rules-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, {recursive: true, force: true});
  });

  it('points the application at both rule files and writes them', async () => {
    const config = {name: 'app'};
    expect(withBackupRules(config)).toBe(config);

    const manifest = {
      manifest: {application: [{$: {'android:name': '.MainApplication', 'android:allowBackup': 'true'}}]},
    };
    const result = mockMods.manifest!({modResults: manifest});
    expect(result.modResults.manifest.application[0].$).toEqual({
      'android:name': '.MainApplication',
      'android:allowBackup': 'true',
      'android:fullBackupContent': '@xml/droid_stream_backup_rules',
      'android:dataExtractionRules': '@xml/droid_stream_data_extraction_rules',
    });

    await mockMods.dangerous!({modRequest: {projectRoot}});
    const xmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
    expect(fs.readFileSync(path.join(xmlDir, 'droid_stream_backup_rules.xml'), 'utf8')).toBe(
      buildBackupRulesXml(),
    );
    expect(fs.readFileSync(path.join(xmlDir, 'droid_stream_data_extraction_rules.xml'), 'utf8')).toBe(
      buildDataExtractionRulesXml(),
    );
  });

  it('fails clearly when the manifest has no application', () => {
    expect(() => setBackupRuleAttributes({manifest: {}})).toThrow('no <application>');
  });

  it('is listed in app.config.js', () => {
    const appConfig = require('../app.config.js')();
    expect(appConfig.expo.plugins).toContain('./plugins/with-backup-rules.js');
    expect(appConfig.expo.android.allowBackup).toBe(true);
  });
});
