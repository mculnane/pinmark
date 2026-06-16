// Persistence layer for Pinmark.
//
// All extension state lives in `browser.storage.local`:
//   - the Pinboard auth token (username:HEXTOKEN)
//   - the cached tag list with usage counts + a fetch timestamp
//   - user defaults (private / read-later toggles)
//
// Storage is deliberately the only module that touches `browser.storage`, so
// callers never reason about raw keys. The token is never read from any file
// on disk at runtime — it is entered once via the popup's settings panel.

import { browser } from "./browser.js";

const KEYS = {
  token: "pinboard_token",
  tagCache: "tag_cache",
  defaults: "defaults",
};

// Refresh the tag cache at most once a day; the popup also offers a manual
// refresh and the background alarm refreshes daily.
export const TAG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getToken() {
  const out = await browser.storage.local.get(KEYS.token);
  return out[KEYS.token] ?? null;
}

export async function setToken(token) {
  await browser.storage.local.set({ [KEYS.token]: token });
}

export async function clearToken() {
  await browser.storage.local.remove(KEYS.token);
}

// Tag cache shape: { tags: { [tag]: count }, fetchedAt: epochMs }
export async function getTagCache() {
  const out = await browser.storage.local.get(KEYS.tagCache);
  return out[KEYS.tagCache] ?? null;
}

export async function setTagCache(tags) {
  const cache = { tags, fetchedAt: Date.now() };
  await browser.storage.local.set({ [KEYS.tagCache]: cache });
  return cache;
}

export function isTagCacheStale(cache, ttl = TAG_CACHE_TTL_MS) {
  if (!cache || !cache.fetchedAt) return true;
  return Date.now() - cache.fetchedAt > ttl;
}

const DEFAULT_PREFS = { private: true, readLater: false };

export async function getDefaults() {
  const out = await browser.storage.local.get(KEYS.defaults);
  return { ...DEFAULT_PREFS, ...(out[KEYS.defaults] ?? {}) };
}

export async function setDefaults(defaults) {
  const merged = { ...(await getDefaults()), ...defaults };
  await browser.storage.local.set({ [KEYS.defaults]: merged });
  return merged;
}
