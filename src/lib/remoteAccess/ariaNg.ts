/* eslint-disable no-bitwise -- base64 of ASCII bytes. */
import {tokenFromBytes} from './secret';

/** The JSON-RPC address another device enters. */
export const rpcAddress = (address: string, port: number): string =>
  `http://${address.includes(':') ? `[${address}]` : address}:${port}/jsonrpc`;

/** URL-safe base64 with padding, as AriaNg's command API reads the secret. Tokens are ASCII. */
export const urlSafeBase64 = (text: string): string => {
  const bytes = Uint8Array.from(text, char => char.charCodeAt(0) & 0xff);
  const body = tokenFromBytes(bytes);
  return body + '='.repeat((4 - (body.length % 4)) % 4);
};

/**
 * Opens AriaNg (its hosted copy, over http so it can reach the phone) with
 * this server's address and token filled in, using AriaNg's command API.
 */
export const ariaNgUrl = (address: string, port: number, token: string): string =>
  `http://ariang.mayswind.net/latest/#!/settings/rpc/set/http/${address}/${port}/jsonrpc/${urlSafeBase64(token)}`;
