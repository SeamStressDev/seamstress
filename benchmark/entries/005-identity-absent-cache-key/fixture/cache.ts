const cache = new Map<string, unknown>();

// Cache key is derived from path + query only — NOT the authenticated user.
// Personalized responses cached here are served to whoever requests the same
// path next.
export function cacheKey(path: string, query: string): string {
  return `${path}?${query}`;
}

export function getCached(key: string) { return cache.get(key); }
export function setCached(key: string, value: unknown) { cache.set(key, value); }
