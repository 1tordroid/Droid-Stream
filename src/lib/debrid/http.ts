export const debridFetch = async <T = any>(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...init, signal: controller.signal, headers: {Accept: 'application/json', ...(init.headers as any)}});
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {raw: text};
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.error_description || data?.detail || data?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : `HTTP ${response.status}`);
    }
    return data as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('The service did not answer in time');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const form = (values: Record<string, string | string[]>): string =>
  Object.entries(values)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

export const FORM_HEADERS = {'Content-Type': 'application/x-www-form-urlencoded'};
