#!/usr/bin/env python3
"""Make the 64-bit-only APK from the signed universal release APK.

    python3 scripts/release/arm64_apk.py <universal.apk> <arm64.apk>

The universal APK holds lib/armeabi-v7a and lib/arm64-v8a. On a 64-bit phone
Android installs only the arm64-v8a libraries from it, so the same APK without
lib/armeabi-v7a installs and runs exactly the same there: same code, same
versionCode, same signing key, so either one updates the other. That is done
here in about a minute instead of a second Gradle build:

1. copy every entry except other ABIs' lib/ folders and the old signature,
2. zipalign (16 KB pages for native libraries),
3. sign with the release key from the MYAPP_UPLOAD_* variables (the ones
   Gradle uses), passing the passwords to apksigner by variable name,
4. check the signing certificate, versionCode and versionName match the
   universal APK and that only arm64-v8a libraries are left.

ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an SDK with build-tools 35 or
newer (Gradle installs them during the build).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

KEEP_ABI = 'arm64-v8a'
SIGNATURE_FILE = re.compile(r'^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$', re.IGNORECASE)


def fail(message):
    print(f'arm64_apk: {message}', file=sys.stderr)
    sys.exit(1)


def build_tools():
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        fail('ANDROID_HOME is not set')
    root = os.path.join(sdk, 'build-tools')
    versions = []
    for name in os.listdir(root) if os.path.isdir(root) else []:
        match = re.match(r'^(\d+)\.(\d+)\.(\d+)$', name)
        if match:
            versions.append((tuple(int(part) for part in match.groups()), name))
    for version, name in sorted(versions, reverse=True):
        if version[0] < 35:
            break
        folder = os.path.join(root, name)
        tools = {}
        for tool in ('zipalign', 'apksigner', 'aapt2'):
            for candidate in (tool, tool + '.exe', tool + '.bat'):
                if os.path.isfile(os.path.join(folder, candidate)):
                    tools[tool] = os.path.join(folder, candidate)
                    break
        if len(tools) == 3:
            return tools
    fail(f'no build-tools 35 or newer with zipalign, apksigner and aapt2 in {root}')


def run(args, capture=False):
    result = subprocess.run(args, capture_output=capture, text=True)
    if result.returncode != 0:
        if capture:
            sys.stderr.write(result.stdout + result.stderr)
        fail(f'{os.path.basename(args[0])} failed with exit code {result.returncode}')
    return result.stdout if capture else ''


def abi_of(name):
    parts = name.split('/')
    return parts[1] if len(parts) > 2 and parts[0] == 'lib' else None


def strip(source, target):
    kept_abis = set()
    dropped = 0
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(target, 'w') as zout:
        for info in zin.infolist():
            abi = abi_of(info.filename)
            if (abi and abi != KEEP_ABI) or SIGNATURE_FILE.match(info.filename):
                dropped += 1
                continue
            if abi:
                kept_abis.add(abi)
            copy = zipfile.ZipInfo(info.filename, info.date_time)
            copy.compress_type = info.compress_type
            copy.external_attr = info.external_attr
            copy.create_system = info.create_system
            zout.writestr(copy, zin.read(info))
    if kept_abis != {KEEP_ABI}:
        fail(f'the universal APK has no lib/{KEEP_ABI} libraries')
    return dropped


def certificate(tools, apk):
    out = run([tools['apksigner'], 'verify', '--print-certs', apk], capture=True)
    digests = sorted(set(re.findall(r'certificate SHA-256 digest: ([0-9a-f]+)', out)))
    if not digests:
        fail(f'no signing certificate found in {apk}')
    return digests


def badging(tools, apk):
    out = run([tools['aapt2'], 'dump', 'badging', apk], capture=True)
    match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", out)
    if not match:
        fail(f'could not read the package line of {apk}')
    return match.groups()


def main():
    if len(sys.argv) != 3:
        fail('usage: arm64_apk.py <universal.apk> <arm64.apk>')
    universal, target = sys.argv[1], sys.argv[2]
    for name in ('MYAPP_UPLOAD_STORE_FILE', 'MYAPP_UPLOAD_STORE_PASSWORD', 'MYAPP_UPLOAD_KEY_ALIAS', 'MYAPP_UPLOAD_KEY_PASSWORD'):
        if not os.environ.get(name):
            fail(f'{name} is not set')
    tools = build_tools()
    work = tempfile.mkdtemp(prefix='arm64-apk-')
    try:
        stripped = os.path.join(work, 'stripped.apk')
        aligned = os.path.join(work, 'aligned.apk')
        dropped = strip(universal, stripped)
        run([tools['zipalign'], '-f', '-P', '16', '4', stripped, aligned])
        run([
            tools['apksigner'], 'sign',
            '--ks', os.environ['MYAPP_UPLOAD_STORE_FILE'],
            '--ks-pass', 'env:MYAPP_UPLOAD_STORE_PASSWORD',
            '--ks-key-alias', os.environ['MYAPP_UPLOAD_KEY_ALIAS'],
            '--key-pass', 'env:MYAPP_UPLOAD_KEY_PASSWORD',
            # Like Gradle for minSdk 28: no JAR signature; v2, plus v3.
            '--v1-signing-enabled', 'false',
            '--v2-signing-enabled', 'true',
            '--v3-signing-enabled', 'true',
            '--out', target,
            aligned,
        ])
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if certificate(tools, target) != certificate(tools, universal):
        fail('the arm64 APK is not signed with the same key as the universal APK')
    package, code, version = badging(tools, target)
    if (package, code, version) != badging(tools, universal):
        fail('the arm64 APK has a different package, versionCode or versionName')
    with zipfile.ZipFile(target) as apk:
        abis = {abi_of(name) for name in apk.namelist()} - {None}
    if abis != {KEEP_ABI}:
        fail(f'unexpected ABIs left: {sorted(abis)}')
    mb = lambda path: os.path.getsize(path) / 1024 / 1024
    print(f'{package} {version} ({code}): {os.path.basename(target)} {mb(target):.1f} MB, '
          f'universal {mb(universal):.1f} MB, {dropped} entries removed, same signing certificate')


if __name__ == '__main__':
    main()
