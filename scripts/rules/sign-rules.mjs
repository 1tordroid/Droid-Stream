#!/usr/bin/env node
// Checks and signs rules/social-rules.json for the photo downloader.
//
//   node scripts/rules/sign-rules.mjs               check, then sign with SOCIAL_RULES_PRIVATE_KEY
//   node scripts/rules/sign-rules.mjs --check       only check the file (no key needed)
//   node scripts/rules/sign-rules.mjs --verify      check, and check that the .sig matches the app's key
//   --previous <file>   also require a higher "version" than this older copy of the file
//
// SOCIAL_RULES_PRIVATE_KEY holds the Ed25519 private key as PEM
// ("-----BEGIN PRIVATE KEY-----...") or as base64 PKCS#8 DER. The signature
// is over the file as UTF-8 with LF line ends (see signature.ts in the app).
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTs} from './load-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = join(root, 'rules', 'social-rules.json');
const SIG = `${RULES}.sig`;
const APP_KEY_FILE = join(root, 'src', 'lib', 'social', 'rules', 'publicKey.ts');

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const die = message => {
  console.error(`social rules: ${message}`);
  process.exit(1);
};

const canonical = text => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

/** The app's public key as a Node key object. */
const appPublicKey = () => {
  const source = readFileSync(APP_KEY_FILE, 'utf8');
  const raw = source.match(/SOCIAL_RULES_PUBLIC_KEY\s*=\s*'([A-Za-z0-9+/]{43}=)'/)?.[1];
  if (!raw) die(`no public key found in ${APP_KEY_FILE}`);
  // SPKI DER for Ed25519 is a fixed 12-byte prefix and the 32-byte key.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw, 'base64')]);
  return createPublicKey({key: der, format: 'der', type: 'spki'});
};

const privateKey = () => {
  // The key comes from SOCIAL_RULES_PRIVATE_KEY (CI) or from a PEM file: --key-file <path>,
  // or SOCIAL_RULES_PRIVATE_KEY_FILE, or the owner's default location outside any repo.
  const keyFile = option('--key-file') || process.env.SOCIAL_RULES_PRIVATE_KEY_FILE ||
    'C:/Users/Tordroid/Documents/claude/droid-stream-secrets/social-rules-private.pem';
  let value = (process.env.SOCIAL_RULES_PRIVATE_KEY || '').trim();
  if (!value && existsSync(keyFile)) value = readFileSync(keyFile, 'utf8').trim();
  if (!value) die('no signing key: set SOCIAL_RULES_PRIVATE_KEY or pass --key-file <path>');
  let key;
  try {
    key = value.includes('-----BEGIN')
      ? createPrivateKey(value)
      : createPrivateKey({key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8'});
  } catch (error) {
    die(`SOCIAL_RULES_PRIVATE_KEY could not be read (${error.message})`);
  }
  if (key.asymmetricKeyType !== 'ed25519') die('SOCIAL_RULES_PRIVATE_KEY is not an Ed25519 key');
  return key;
};

const main = async () => {
  const text = readFileSync(RULES, 'utf8');
  const {parseRules} = await loadTs(join(root, 'src', 'lib', 'social', 'rules', 'validate.ts'));
  let rules;
  try {
    rules = parseRules(text);
  } catch (error) {
    die(`rules/social-rules.json is not valid: ${error.message}`);
  }
  console.log(`social rules: version ${rules.version} (${rules.updated}) is valid`);

  const previousFile = option('--previous');
  if (previousFile && existsSync(previousFile)) {
    let previous;
    try {
      previous = JSON.parse(readFileSync(previousFile, 'utf8'));
    } catch {
      previous = undefined;
    }
    const before = Number(previous?.version) || 0;
    const changed = canonical(readFileSync(previousFile, 'utf8')) !== canonical(text);
    if (changed && rules.version <= before) die(`"version" must go up when the file changes (it was ${before}, it is ${rules.version})`);
  }

  if (flag('--check')) return;
  const message = Buffer.from(canonical(text), 'utf8');
  const publicKey = appPublicKey();

  if (flag('--verify')) {
    if (!existsSync(SIG)) die('rules/social-rules.json.sig is missing');
    const signature = Buffer.from(readFileSync(SIG, 'utf8').trim(), 'base64');
    if (signature.length !== 64 || !verify(null, message, publicKey, signature)) die('the signature does not match the file and the app key');
    console.log('social rules: the signature matches the app key');
    return;
  }

  const key = privateKey();
  const derived = createPublicKey(key).export({format: 'der', type: 'spki'});
  if (!derived.equals(publicKey.export({format: 'der', type: 'spki'}))) {
    die('SOCIAL_RULES_PRIVATE_KEY does not belong to the public key in src/lib/social/rules/publicKey.ts');
  }
  const signature = sign(null, message, key);
  if (!verify(null, message, publicKey, signature)) die('the new signature does not verify');
  writeFileSync(SIG, `${signature.toString('base64')}\n`);
  console.log('social rules: wrote rules/social-rules.json.sig');
};

main().catch(error => die(error.stack || String(error)));
