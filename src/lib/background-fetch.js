// A `fetch`-shaped function that performs the actual network request in the
// background worker instead of the calling page.
//
// Why: on Safari, a cross-origin `fetch` from the popover page is subject to
// CORS even when the host is granted in host_permissions, so requests to
// api.pinboard.in (which sends no CORS headers) fail. The background worker is
// the privileged context where host_permissions exempts the request. We send
// the URL there, then reconstruct a minimal Response so callers that expect a
// `fetch` result (e.g. DirectTransport in pinboard-api.js) work unchanged.
//
// Only the subset DirectTransport uses is reconstructed: `ok`, `status`,
// `statusText`, and `json()`/`text()`. A rejected fetch in the background is
// re-thrown here as a TypeError so the transport classifies it as "network".

import { browser } from "./browser.js";

export async function backgroundFetch(url) {
  const resp = await browser.runtime.sendMessage({ type: "pinboard-fetch", url });

  if (!resp || resp.networkError) {
    throw new TypeError(resp?.networkError ?? "No response from background worker.");
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    json: async () => JSON.parse(resp.body),
    text: async () => resp.body,
  };
}
