import {toByteArray} from 'base64-js';
import {utf8Bytes, verifyEd25519} from './ed25519';
import {SOCIAL_RULES_PUBLIC_KEY} from './publicKey';

/**
 * The bytes that are signed: the file as UTF-8 without a byte order mark and
 * with LF line ends, so a Windows checkout (CRLF) signs the same bytes that
 * GitHub serves. A CR outside a JSON string is only white space.
 */
export const canonicalRulesText = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

const decodeBase64 = (value: string): Uint8Array | undefined => {
  const clean = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) return undefined;
  try {
    return toByteArray(clean);
  } catch {
    return undefined;
  }
};

/** True when [signature] (base64 text of the .sig file) signs [text] with [publicKey] (base64, 32 bytes). */
export const verifyRulesSignature = (text: string, signature: string, publicKey: string = SOCIAL_RULES_PUBLIC_KEY): boolean => {
  const sig = decodeBase64(signature);
  const key = decodeBase64(publicKey);
  if (!sig || sig.length !== 64 || !key || key.length !== 32) return false;
  try {
    return verifyEd25519(sig, utf8Bytes(canonicalRulesText(text)), key);
  } catch {
    return false;
  }
};
