// Background service worker (classic, no ES modules).
//
// Single responsibility: keep the tag cache warm by refreshing it once a day so
// the popup opens with up-to-date autocomplete without waiting on a network
// call. The popup also refreshes on open when the cache is stale, so this is a
// convenience, not a dependency.
//
// This file is intentionally self-contained: Safari's support for *module*
// service workers is inconsistent, so we avoid `import` here and duplicate the
// few storage keys it shares with lib/storage.js. Keep the key strings below in
// sync with that module.

const browser = globalThis.browser ?? globalThis.chrome;

const KEYS = { token: "pinboard_token", tagCache: "tag_cache" };
const TAG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ALARM = "refresh-tags";
const PERIOD_MINUTES = 24 * 60;
const API_BASE = "https://api.pinboard.in/v1/";

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
});

// Re-arm on browser start (alarms can be cleared between sessions).
browser.runtime.onStartup?.addListener(() => {
  browser.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refreshTags();
});

// Network proxy for the popup.
//
// On Safari, the privileged context for a CORS-exempt fetch to a host in
// host_permissions is the background worker — a fetch issued from the popover
// page is still subject to CORS and fails (Pinboard sends no CORS headers). So
// the popup hands us the fully-built request URL and we perform the fetch here,
// returning a serialised response (or a flagged error) for it to interpret.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "pinboard-fetch") {
    return handlePinboardFetch(message.url);
  }
  return undefined;
});

async function handlePinboardFetch(url) {
  try {
    const res = await fetch(url);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      body: await res.text(),
    };
  } catch (err) {
    // fetch rejected (offline, blocked, DNS). Flag it so the popup can map it
    // to a "network" error rather than treating it as an HTTP response.
    return { networkError: String(err?.message ?? err) };
  }
}

async function refreshTags() {
  const stored = await browser.storage.local.get([KEYS.token, KEYS.tagCache]);
  const token = stored[KEYS.token];
  if (!token) return; // not configured yet

  const cache = stored[KEYS.tagCache];
  if (cache?.fetchedAt && Date.now() - cache.fetchedAt <= TAG_CACHE_TTL_MS) {
    return; // popup already refreshed it recently
  }

  try {
    const url = new URL("tags/get", API_BASE);
    url.searchParams.set("auth_token", token);
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = await res.json();
    const tags = {};
    for (const [tag, count] of Object.entries(raw)) {
      tags[tag] = Number(count) || 0;
    }
    await browser.storage.local.set({
      [KEYS.tagCache]: { tags, fetchedAt: Date.now() },
    });
  } catch (err) {
    // Transient; the next alarm or the next popup open will retry.
    console.warn("Background tag refresh failed:", err);
  }
}
