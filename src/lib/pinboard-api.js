// Pinboard API client — the only module that knows the transport.
//
// The UI never talks to Pinboard directly; it depends on the small surface
// exported by `createPinboardClient()`. Today that surface is backed by direct
// HTTPS calls to https://api.pinboard.in/v1/. To later route through the
// `pinboard-mcp` server instead, implement a transport with the same four
// methods (getTags / addPost / getPost / suggestTags) and swap it in
// `createClient()` below — no UI changes required.
//
// Auth token format is `username:HEXTOKEN`, exactly as Pinboard exposes it at
// Settings -> Password.

const API_BASE = "https://api.pinboard.in/v1/";

// Pinboard asks for >= 3s between most calls. We serialise requests through a
// single promise chain and space them out so a burst (e.g. posts/get followed
// by tags/get on popup open) never trips the limiter.
const MIN_INTERVAL_MS = 3000;

class RateLimiter {
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
    this.last = 0;
    this.tail = Promise.resolve();
  }

  // Queue `fn` so it runs no sooner than minIntervalMs after the previous call.
  schedule(fn) {
    const run = async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await delay(wait);
      this.last = Date.now();
      return fn();
    };
    // Chain onto the tail so calls run strictly in order; swallow the tail's
    // own rejection so one failed call doesn't poison the queue.
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PinboardError extends Error {
  // `code` is the stable, UI-facing discriminator: "unauthorized",
  // "rate_limited", "server_error", "network", "no_token", or undefined for an
  // unexpected HTTP status. Callers should switch on `code`, not the message.
  constructor(message, { status, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PinboardError";
    this.status = status;
    this.code = code;
  }
}

// --- Direct HTTPS transport ------------------------------------------------

class DirectTransport {
  constructor(token, { limiter, fetchImpl = fetch } = {}) {
    this.token = token;
    this.limiter = limiter ?? new RateLimiter(MIN_INTERVAL_MS);
    this.fetchImpl = fetchImpl;
  }

  async request(path, params = {}) {
    const url = new URL(path, API_BASE);
    url.searchParams.set("auth_token", this.token);
    url.searchParams.set("format", "json");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }

    let res;
    try {
      res = await this.limiter.schedule(() => this.fetchImpl(url.toString()));
    } catch (err) {
      // fetch() itself rejected: offline, DNS failure, TLS error, or Safari
      // blocking the request because the extension lacks access to
      // api.pinboard.in. This is distinct from receiving an HTTP error status.
      throw new PinboardError("Could not reach Pinboard.", {
        code: "network",
        cause: err,
      });
    }

    if (res.status === 401) {
      throw new PinboardError("Invalid Pinboard token. Check Settings.", {
        status: 401,
        code: "unauthorized",
      });
    }
    if (res.status === 429) {
      throw new PinboardError("Pinboard rate limit hit. Try again shortly.", {
        status: 429,
        code: "rate_limited",
      });
    }
    if (res.status >= 500) {
      // Pinboard's API is up enough to answer but erroring server-side (e.g. the
      // 500s seen during an outage while pinboard.in itself is reachable).
      throw new PinboardError(`Pinboard server error (HTTP ${res.status}).`, {
        status: res.status,
        code: "server_error",
      });
    }
    if (!res.ok) {
      throw new PinboardError(`Pinboard request failed (HTTP ${res.status}).`, {
        status: res.status,
      });
    }
    return res.json();
  }
}

// --- Public client ---------------------------------------------------------

// A transport implements `request(path, params)`. The client maps that to the
// domain methods the UI consumes.
function makeClient(transport) {
  return {
    // Full tag list with usage counts. Pinboard returns { tag: "count", ... }
    // with counts as strings; we coerce to numbers for ranking.
    async getTags() {
      const raw = await transport.request("tags/get");
      const tags = {};
      for (const [tag, count] of Object.entries(raw)) {
        tags[tag] = Number(count) || 0;
      }
      return tags;
    },

    // Save (or overwrite) a bookmark. Pinboard's field names are historical:
    //   description = the title, extended = the long note.
    async addPost({ url, title, description = "", tags = [], shared, toread, replace = true }) {
      const result = await transport.request("posts/add", {
        url,
        description: title,
        extended: description,
        tags: Array.isArray(tags) ? tags.join(" ") : tags,
        shared: shared ? "yes" : "no",
        toread: toread ? "yes" : "no",
        replace: replace ? "yes" : "no",
      });
      if (result?.result_code && result.result_code !== "done") {
        throw new PinboardError(result.result_code, { code: result.result_code });
      }
      return result;
    },

    // Existing bookmark for a URL, or null if not bookmarked.
    async getPost(url) {
      const data = await transport.request("posts/get", { url });
      const post = data?.posts?.[0];
      if (!post) return null;
      return {
        url: post.href,
        title: post.description,
        description: post.extended ?? "",
        tags: (post.tags ?? "").split(/\s+/).filter(Boolean),
        shared: post.shared === "yes",
        toread: post.toread === "yes",
        time: post.time,
      };
    },

    // Pinboard's own suggested tags for a URL (popular + recommended).
    // Not used in MVP autocomplete but exposed for later augmentation.
    async suggestTags(url) {
      const data = await transport.request("posts/suggest", { url });
      const popular = data?.find?.((d) => d.popular)?.popular ?? [];
      const recommended = data?.find?.((d) => d.recommended)?.recommended ?? [];
      return { popular, recommended };
    },
  };
}

// Factory: pick the transport here. Pass { transport: "mcp", ... } in future to
// route through pinboard-mcp instead of the direct API.
export function createPinboardClient(token, options = {}) {
  if (!token) throw new PinboardError("No Pinboard token configured.", { code: "no_token" });
  const transport = new DirectTransport(token, options);
  return makeClient(transport);
}

export { RateLimiter };
