# Pinmark

A Safari Web Extension for saving the current page to [Pinboard](https://pinboard.in),
with **live tag autocomplete against your full tag history** — the one feature a
Shortcut can't replace.

It's a modern, fully-owned replacement for Kristof Adriaenssens' *bookmarker for
pinboard* (Apache 2.0, pulled from the App Store in early 2026). That was a Swift
Safari *App* Extension on the deprecated architecture; Pinmark is a plain
HTML/CSS/JS **Web Extension** (Manifest V3), packaged in a thin Xcode container app
for local use on this Mac.

---

## Features

- **Toolbar button → popover** pre-filled with the current tab's URL and title.
- **Editable fields:** title, URL, description (pre-filled from the page's text
  selection if one exists).
- **Tag autocomplete against your history**, sorted **most-used first**:
  - Type to filter; prefix matches rank above substring matches, then by usage
    frequency, then alphabetically.
  - **↑/↓** to move, **Tab** (or **→** at the end of a token) to accept, **Enter**
    to accept the highlighted suggestion (a second Enter saves), **Esc** to dismiss.
  - Multiple space-separated tags; only the token under the caret autocompletes.
- **Toggles:** Read later (unread) and Private/Public.
- **Save** posts to Pinboard via `posts/add`.
- **Already-bookmarked indicator:** on open, if the URL is already saved, Pinmark
  shows a badge and loads the existing tags/description/flags so you edit instead
  of duplicate.

---

## Architecture

```
src/                      ← the web extension (source of truth)
  manifest.json           Manifest V3
  popup/                  popover UI (popup.html / .css / .js)
  background/             service worker: daily tag-cache refresh (self-contained)
  lib/
    browser.js            cross-browser API handle (browser ?? chrome)
    storage.js            token + tag cache + prefs (browser.storage.local)
    pinboard-api.js       Pinboard client — the ONLY module that knows the transport
    tag-autocomplete.js   ranking/tokenizing logic (pure, DOM-free, unit-tested)
tests/
  tag-autocomplete.test.mjs
scripts/
  convert.sh              regenerate the Xcode project from src/
  generate_icons.py       regenerate the icon set (no dependencies)
xcode/                    generated Xcode container app + extension target
```

**Transport-swappable API layer.** The UI only ever calls the small surface from
`createPinboardClient()` in [`src/lib/pinboard-api.js`](src/lib/pinboard-api.js)
(`getTags` / `addPost` / `getPost` / `suggestTags`). Today that's backed by direct
HTTPS to `https://api.pinboard.in/v1/`. To route through the `pinboard-mcp` server
later, implement a transport with the same `request(path, params)` method and swap
it in the `createPinboardClient` factory — no UI changes needed.

**Rate limiting.** Requests are serialised through a limiter that spaces calls
≥3s apart, per Pinboard's guidance, so a burst on popup open (e.g. `posts/get`
then `tags/get`) never trips the limiter.

**Source of truth.** The Xcode project *references* `src/` (relative paths, no
`--copy-resources`), so editing files in `src/` and rebuilding picks up the changes
— no copy step. Re-run `./scripts/convert.sh` only to regenerate the project.

---

## Build & install

> Requires Xcode (built with **Xcode 26.5** / macOS 26.5, Safari 26.5).

1. **Open the project**

   ```sh
   open xcode/Pinmark/Pinmark.xcodeproj
   ```

   (If `xcode/` is missing or you changed the manifest structure, regenerate it
   first: `./scripts/convert.sh`.)

2. **Set the signing team (automatic signing)** — see *Signing* below.

3. **Build & run** the `Pinmark` scheme (⌘R). The container app launches; it does
   nothing itself except host the extension and point you at Safari settings.

4. **Enable in Safari:**
   - Safari → Settings → **Extensions** → tick **Pinmark**.
   - First time only: Safari → Settings → **Advanced** → tick **Show features for
     web developers**, then Safari → Settings → **Developer** → tick **Allow
     unsigned extensions** (this resets each time Safari quits when the extension
     is signed only with a free Apple ID — see below).
   - Pin the toolbar button: View → Customize Toolbar, or right-click the toolbar.

5. **Grant host access.** On first use Safari will ask to allow Pinmark on
   `api.pinboard.in` (and the current page, for reading your text selection).
   Allow it.

---

## Signing (and the 7-day caveat)

This is **local-use only** — no App Store distribution (that App Store fee is
exactly what killed the original extension).

- Use **automatic signing** in Xcode: select both the `Pinmark` and `Pinmark
  Extension` targets → *Signing & Capabilities* → tick *Automatically manage
  signing* → choose your Team.
- **A free personal Apple ID is enough.** In Xcode → Settings → Accounts, add your
  Apple ID; it provides a "Personal Team" sufficient for local builds. (If your Mac
  is MDM-managed and signing is blocked, see the MDM notes below.)
- **⚠️ The 7-day refresh cadence.** A certificate from a *free* Apple ID expires
  after **7 days**. When it lapses the extension stops loading in Safari. To
  refresh: reopen the project and **⌘R** to rebuild and re-sign. (A paid Apple
  Developer account would extend this to a year, but that's the fee we're avoiding.)
- The bundle identifier is `com.mculnane.Pinmark` (extension:
  `com.mculnane.Pinmark.Extension`). Change it in `scripts/convert.sh` and
  regenerate if you sign under a different team that needs a matching prefix.

---

## MDM / Gatekeeper notes

If your Mac is managed (MDM) or you're on a standard, non-admin account, a few
things are worth knowing.

- **Building and running locally does *not* need admin or `sudo`** — Xcode signs
  with your own (free) Apple ID into your user keychain, so a standard account is
  fine.
- **"Allow unsigned extensions"** lives in Safari's Developer menu and is a
  per-user setting — no admin needed. But MDM can hide the Developer menu or
  disable this toggle. If you can't find it or it won't stick, that's a policy
  restriction to take up with your IT admin rather than fight.
- **Gatekeeper:** running a locally-built app from Xcode is allowed without a
  Gatekeeper exception. You shouldn't need to `spctl`/right-click-open anything.
- **If extension loading is blocked outright** (some MDM profiles restrict Safari
  extensions to an allowlist), that's the wall to flag to IT — quote the extension
  bundle id `com.mculnane.Pinmark.Extension` when you do.

---

## First-run: configure your Pinboard token

On first open the popover shows a **Settings** panel asking for your Pinboard API
token.

- Get it from **[pinboard.in/settings/password](https://pinboard.in/settings/password)**
  — it looks like `username:XXXXXXXXXXXXXXXX`.
- Pinmark verifies the token (by fetching your tags, which also warms the cache)
  and stores it **only in the extension's local storage** (`browser.storage.local`).
- The token is **never** read from any file on disk at runtime — only from
  extension storage, where you entered it.

---

## Tag cache

Autocomplete is powered by a local cache of `tags/get` (tag → usage count).

- Refreshed automatically **once a day** (background alarm), and on popover open if
  the cache is older than 24h.
- **Manual refresh:** open Settings (⚙) → **Refresh tag cache**. The panel shows
  how many tags are cached and when they were last refreshed.

---

## Development

```sh
# Run the unit tests (no Node required — uses JavaScriptCore):
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
"$JSC" -m tests/tag-autocomplete.test.mjs   # autocomplete ranking/tokenizing
"$JSC" -m tests/pinboard-api.test.mjs       # API error classification
# …or, with Node installed: node tests/<file>.test.mjs

# Regenerate icons after editing the mark:
python3 scripts/generate_icons.py

# Regenerate the Xcode project after a manifest structure change:
./scripts/convert.sh
```

Debug the running extension via Safari → Develop → Web Extension Background
Content / the popover's Web Inspector.

---

## Out of scope (for now)

Browsing/searching existing bookmarks (Pins handles that on iOS), bulk
edit/delete, cross-browser builds (the code is largely portable to Chrome/Firefox
later), App Store submission, and any server component.

## Credit

Inspired by [bookmarker for pinboard](https://github.com/kristofa/bookmarker_for_pinboard)
by Kristof Adriaenssens (Apache 2.0). Pinmark is an independent rewrite as a Safari
Web Extension; no original source is reused.
