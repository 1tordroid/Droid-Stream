import {isPrivateHostname, validateProviderUrl} from '../../sandbox/urlGuard';

/**
 * GM_xmlhttpRequest for userscripts, made by the app (so it can reach other
 * sites) behind the same guard as provider requests: http(s) only, no
 * credentials in the URL, and nothing on the phone or the home network.
 */

export interface GmRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
}

export interface GmResponse {
  status: number;
  statusText: string;
  responseText: string;
  responseHeaders: string;
  finalUrl: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
// Headers a page may not set on its own requests either.
const FORBIDDEN = /^(host|content-length|connection|keep-alive|transfer-encoding|upgrade|proxy-.*|sec-.*)$/i;

export const gmRequest = async (request: GmRequest): Promise<GmResponse> => {
  const url = validateProviderUrl(request.url);
  const method = (request.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new Error('This request method is not allowed');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (typeof value === 'string' && !FORBIDDEN.test(name)) headers[name] = value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(request.timeout || 30000, 1000), 120000));
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : request.data,
      signal: controller.signal,
    });
    const finalUrl = response.url || url.toString();
    try {
      if (isPrivateHostname(new URL(finalUrl).hostname)) throw new Error('The request was sent to a blocked address');
    } catch (error) {
      if (error instanceof Error && error.message.includes('blocked address')) throw error;
    }
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('The response is too large');
    const responseHeaders: string[] = [];
    response.headers.forEach((value, name) => responseHeaders.push(`${name}: ${value}`));
    return {status: response.status, statusText: response.statusText || '', responseText: text, responseHeaders: responseHeaders.join('\r\n'), finalUrl};
  } finally {
    clearTimeout(timer);
  }
};
