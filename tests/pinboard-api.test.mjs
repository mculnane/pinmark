// Tests for the Pinboard client's error classification — the behaviour that
// makes a server outage read differently from a bad token.
//
// Run with JavaScriptCore:
//   jsc -m tests/pinboard-api.test.mjs
// or, with Node: node tests/pinboard-api.test.mjs

// The standalone `jsc` shell lacks URL/URLSearchParams (they're Web Platform
// APIs, present in Safari and Node but not the bare engine). Shim just enough
// for the client to build its request URL; the value is irrelevant here since
// fetch is faked. Native implementations are used when available (Node/Safari).
if (typeof URL === "undefined") {
  globalThis.URLSearchParams = class {
    constructor() {
      this._p = new Map();
    }
    set(k, v) {
      this._p.set(k, String(v));
    }
    toString() {
      return [...this._p].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    }
  };
  globalThis.URL = class {
    constructor(path, base) {
      this._base = (base || "") + path;
      this.searchParams = new URLSearchParams();
    }
    toString() {
      const q = this.searchParams.toString();
      return q ? `${this._base}?${q}` : this._base;
    }
  };
}

import { createPinboardClient, PinboardError, RateLimiter } from "../src/lib/pinboard-api.js";

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    print(`FAIL: ${msg}`);
  }
}

// A fake Response good enough for the client.
function resp(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

// Build a client whose fetch is scripted and whose limiter doesn't wait, so the
// suite runs instantly.
function clientReturning(fetchImpl) {
  return createPinboardClient("user:TOKEN", {
    fetchImpl,
    limiter: new RateLimiter(0),
  });
}

async function codeFor(fetchImpl) {
  try {
    await clientReturning(fetchImpl).getTags();
    return "(no error thrown)";
  } catch (err) {
    return err instanceof PinboardError ? err.code : `(${err.name})`;
  }
}

async function main() {
  ok((await codeFor(async () => resp(401, {}))) === "unauthorized", "401 -> unauthorized");
  ok((await codeFor(async () => resp(429, {}))) === "rate_limited", "429 -> rate_limited");
  ok((await codeFor(async () => resp(500, {}))) === "server_error", "500 -> server_error");
  ok((await codeFor(async () => resp(503, {}))) === "server_error", "503 -> server_error");
  ok((await codeFor(async () => resp(404, {}))) === undefined, "404 -> generic (no code)");

  // fetch rejecting (offline / blocked by Safari) classifies as network.
  ok(
    (await codeFor(async () => {
      throw new TypeError("Load failed");
    })) === "network",
    "fetch rejection -> network"
  );

  // server_error carries the HTTP status for the message.
  try {
    await clientReturning(async () => resp(503, {})).getTags();
  } catch (err) {
    ok(err.status === 503, "server_error preserves status 503");
  }

  // Happy path: counts coerced from strings to numbers.
  const tags = await clientReturning(async () =>
    resp(200, { javascript: "120", web: "200" })
  ).getTags();
  ok(tags.javascript === 120 && tags.web === 200, "getTags coerces counts to numbers");

  print(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
}

main();
