import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const script = read('scripts/build-libtorrent4j.sh');
const pin = (name: string) => script.match(new RegExp(`^${name}=(\\S+)$`, 'm'))?.[1];

describe('libtorrent4j rebuild', () => {
  it('builds the libtorrent4j release the app ships', () => {
    const version = pin('LIBTORRENT4J_VERSION');
    expect(version).toBe('2.1.0-39');
    const natives = read('plugins/with-custom-native-modules.js');
    for (const name of ['libtorrent4j', 'libtorrent4j-android-arm64', 'libtorrent4j-android-arm']) {
      expect(natives).toContain(`'${name}',`);
    }
    expect(natives).toContain(`org.libtorrent4j:\${name}:${version}`);
    expect(read('plugins/with-android-release-gradle.js')).toContain(`org.libtorrent4j:libtorrent4j-android-x86_64:${version}'`);
  });

  it('pins every download by commit or SHA-256', () => {
    expect(pin('LIBTORRENT4J_COMMIT')).toMatch(/^[0-9a-f]{40}$/);
    expect(pin('LIBTORRENT_COMMIT')).toMatch(/^[0-9a-f]{40}$/);
    for (const name of ['OPENSSL_SHA256', 'BOOST_SHA256', 'NDK_SHA256', 'REF_ARM_SHA256', 'REF_ARM64_SHA256', 'REF_X86_64_SHA256']) {
      expect(`${name} ${pin(name)}`).toMatch(new RegExp(`^${name} [0-9a-f]{64}$`));
    }
    expect(pin('OPENSSL_VERSION')).toMatch(/^3\.5\.\d+$/);
  });

  it('builds each ABI the app ships in CI', () => {
    const workflow = read('.github/workflows/libtorrent4j.yml');
    expect(workflow).toContain('abi: [armeabi-v7a, arm64-v8a, x86_64]');
    expect(workflow).toContain('bash scripts/build-libtorrent4j.sh manifest');
  });
});
