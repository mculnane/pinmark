// Cross-browser WebExtension API handle.
//
// Safari and Firefox expose the promise-based `browser` namespace; Chrome
// exposes `chrome`. The promise-based MV3 surface we use (storage, tabs,
// scripting, alarms, runtime) is compatible across all three, so a single
// handle keeps the rest of the codebase engine-agnostic and portable if we
// later ship to Chrome/Firefox.
export const browser = globalThis.browser ?? globalThis.chrome;
