// Popup controller. Wires the tab context, tag cache, autocomplete engine and
// Pinboard client into the form. Kept thin: business logic lives in lib/.

import { browser } from "../lib/browser.js";
import {
  getToken,
  setToken,
  getTagCache,
  setTagCache,
  isTagCacheStale,
  getDefaults,
  setDefaults,
} from "../lib/storage.js";
import { createPinboardClient, PinboardError } from "../lib/pinboard-api.js";
import {
  tokenAtCaret,
  existingTags,
  rankSuggestions,
  applySuggestion,
} from "../lib/tag-autocomplete.js";

const $ = (id) => document.getElementById(id);

const views = {
  loading: $("loading-view"),
  form: $("form-view"),
  settings: $("settings-view"),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

// Mutable popup state.
const state = {
  token: null,
  client: null,
  tags: {}, // { tag: count }
  suggestions: [],
  activeIndex: -1,
};

// --- Bootstrap -------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init() {
  wireSettings();
  wireForm();

  state.token = await getToken();
  if (!state.token) {
    showSettings({ firstRun: true });
    return;
  }

  state.client = createPinboardClient(state.token);
  showView("form");
  await Promise.all([prefillFromTab(), loadTags()]);
}

// --- Tab prefill + already-bookmarked detection ----------------------------

async function prefillFromTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  $("url").value = tab.url ?? "";
  $("title").value = tab.title ?? "";

  const defaults = await getDefaults();
  $("private").checked = defaults.private;
  $("read-later").checked = defaults.readLater;

  // Pull any current page text selection for the description field.
  const selection = await readSelection(tab.id);
  if (selection) $("description").value = selection;

  // Nice-to-have: if this URL is already saved, surface it and load the
  // existing values so a save edits rather than duplicates.
  if (tab.url) checkExisting(tab.url).catch(() => {});
}

async function readSelection(tabId) {
  if (tabId == null) return "";
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection?.() ?? "").trim(),
    });
    return results?.[0]?.result ?? "";
  } catch {
    // about:blank, PDF viewer, extension pages, etc. — selection not available.
    return "";
  }
}

async function checkExisting(url) {
  const existing = await state.client.getPost(url);
  if (!existing) return;

  const badge = $("status-badge");
  badge.textContent = "Already saved — editing";
  badge.classList.add("saved");
  badge.hidden = false;

  // Only overwrite fields the user is unlikely to have changed yet (the popup
  // just opened). Title/url already come from the tab; prefer the saved title
  // if the page title is empty.
  if (!$("title").value) $("title").value = existing.title;
  if (existing.description) $("description").value = existing.description;
  $("tags").value = existing.tags.join(" ") + (existing.tags.length ? " " : "");
  $("private").checked = !existing.shared;
  $("read-later").checked = existing.toread;
}

// --- Tag cache -------------------------------------------------------------

async function loadTags() {
  const cache = await getTagCache();
  if (cache?.tags) state.tags = cache.tags;

  if (isTagCacheStale(cache)) {
    try {
      const tags = await state.client.getTags();
      await setTagCache(tags);
      state.tags = tags;
    } catch (err) {
      // Stale-but-usable cache beats no autocomplete; only surface if we have
      // nothing at all.
      if (!cache?.tags) console.warn("Tag fetch failed:", err);
    }
  }
}

// --- Autocomplete ----------------------------------------------------------

function wireForm() {
  const tagsInput = $("tags");
  const list = $("suggestions");

  const update = () => renderSuggestions(tagsInput, list);
  tagsInput.addEventListener("input", update);
  tagsInput.addEventListener("click", update);
  tagsInput.addEventListener("keyup", (e) => {
    // Arrow left/right move the caret; refresh which token we're completing.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") update();
  });

  tagsInput.addEventListener("keydown", (e) => onTagsKeydown(e, tagsInput, list));
  tagsInput.addEventListener("blur", () => {
    // Delay so a mousedown on a suggestion still registers.
    setTimeout(() => hideSuggestions(list), 120);
  });

  $("bookmark-form").addEventListener("submit", onSave);
}

function renderSuggestions(input, list) {
  const { token } = tokenAtCaret(input.value, input.selectionStart ?? input.value.length);
  const ranked = rankSuggestions(state.tags, token, {
    exclude: existingTags(input.value),
  });

  state.suggestions = ranked;
  state.activeIndex = ranked.length ? 0 : -1;

  if (!ranked.length) {
    hideSuggestions(list);
    return;
  }

  list.innerHTML = "";
  ranked.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "suggestion" + (i === state.activeIndex ? " active" : "");
    li.setAttribute("role", "option");
    li.dataset.index = String(i);

    const name = document.createElement("span");
    name.className = "name";
    name.append(highlightMatch(item.tag, token));

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(item.count);

    li.append(name, count);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      accept(input, list, i);
    });
    list.append(li);
  });

  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function highlightMatch(tag, token) {
  const frag = document.createDocumentFragment();
  const idx = tag.toLowerCase().indexOf(token.toLowerCase());
  if (idx === -1 || !token) {
    frag.append(tag);
    return frag;
  }
  frag.append(tag.slice(0, idx));
  const strong = document.createElement("span");
  strong.className = "match";
  strong.textContent = tag.slice(idx, idx + token.length);
  frag.append(strong, tag.slice(idx + token.length));
  return frag;
}

function hideSuggestions(list) {
  list.hidden = true;
  list.innerHTML = "";
  state.suggestions = [];
  state.activeIndex = -1;
  $("tags").setAttribute("aria-expanded", "false");
}

function onTagsKeydown(e, input, list) {
  const open = !list.hidden && state.suggestions.length > 0;

  switch (e.key) {
    case "ArrowDown":
      if (!open) return;
      e.preventDefault();
      moveActive(list, 1);
      break;
    case "ArrowUp":
      if (!open) return;
      e.preventDefault();
      moveActive(list, -1);
      break;
    case "Tab":
      // Accept the highlighted suggestion; only hijack Tab when the list is open.
      if (open && state.activeIndex >= 0) {
        e.preventDefault();
        accept(input, list, state.activeIndex);
      }
      break;
    case "ArrowRight":
      // Accept only when the caret is at the end of the current token.
      if (open && state.activeIndex >= 0 && atTokenEnd(input)) {
        e.preventDefault();
        accept(input, list, state.activeIndex);
      }
      break;
    case "Enter":
      if (open && state.activeIndex >= 0) {
        // First Enter accepts the suggestion; it does not submit.
        e.preventDefault();
        accept(input, list, state.activeIndex);
      }
      // Otherwise fall through to normal form submit.
      break;
    case "Escape":
      if (open) {
        e.preventDefault();
        hideSuggestions(list);
      }
      break;
  }
}

function atTokenEnd(input) {
  const caret = input.selectionStart ?? input.value.length;
  const { end } = tokenAtCaret(input.value, caret);
  return caret === end;
}

function moveActive(list, delta) {
  const n = state.suggestions.length;
  state.activeIndex = (state.activeIndex + delta + n) % n;
  [...list.children].forEach((li, i) =>
    li.classList.toggle("active", i === state.activeIndex)
  );
  list.children[state.activeIndex]?.scrollIntoView({ block: "nearest" });
}

function accept(input, list, index) {
  const item = state.suggestions[index];
  if (!item) return;
  const caret = input.selectionStart ?? input.value.length;
  const { value, caret: newCaret } = applySuggestion(input.value, caret, item.tag);
  input.value = value;
  input.setSelectionRange(newCaret, newCaret);
  input.focus();
  renderSuggestions(input, list); // re-evaluate for the next (now empty) token
}

// --- Save ------------------------------------------------------------------

async function onSave(e) {
  e.preventDefault();
  const errEl = $("form-error");
  errEl.hidden = true;

  const url = $("url").value.trim();
  const title = $("title").value.trim();
  if (!url) return showError(errEl, "A URL is required.");
  if (!title) return showError(errEl, "A title is required.");

  const saveBtn = $("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  const isPrivate = $("private").checked;
  const readLater = $("read-later").checked;

  try {
    await state.client.addPost({
      url,
      title,
      description: $("description").value.trim(),
      tags: existingTags($("tags").value),
      shared: !isPrivate,
      toread: readLater,
    });
    await setDefaults({ private: isPrivate, readLater });
    saveBtn.textContent = "Saved ✓";
    setTimeout(() => window.close(), 600);
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to Pinboard";
    showError(errEl, describeError(err, "Save failed. Try again."));
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

// Map a thrown error to a message that points at the actual culprit, so a
// Pinboard outage doesn't read as "check your token". Switches on the stable
// PinboardError.code rather than the message text.
function describeError(err, fallback = "Something went wrong. Try again.") {
  if (!(err instanceof PinboardError)) return fallback;
  switch (err.code) {
    case "unauthorized":
      return "Pinboard rejected that token. Check it's the full username:TOKEN from Settings → Password.";
    case "server_error":
      return `Pinboard's servers are having problems (HTTP ${err.status}) — that's on their end. Try again later.`;
    case "rate_limited":
      return "Pinboard is rate-limiting requests. Wait a few seconds and try again.";
    case "network":
      return "Couldn't reach Pinboard. Check your connection, and that Safari allows this extension to access api.pinboard.in.";
    default:
      return err.message || fallback;
  }
}

// --- Settings / token ------------------------------------------------------

function wireSettings() {
  $("settings-btn").addEventListener("click", () => showSettings({ firstRun: false }));
  $("settings-back").addEventListener("click", () => {
    if (state.token) showView("form");
  });
  $("settings-form").addEventListener("submit", onSaveToken);
  $("refresh-tags-btn").addEventListener("click", onRefreshTags);
}

async function showSettings({ firstRun }) {
  showView("settings");
  $("settings-back").hidden = firstRun; // no escape until a token exists
  $("token").value = "";
  const status = $("settings-status");
  status.hidden = true;
  $("settings-error").hidden = true;
  await renderCacheInfo();
}

async function renderCacheInfo() {
  const cache = await getTagCache();
  const info = $("cache-info");
  if (!cache?.tags) {
    info.textContent = "No tags cached yet.";
    return;
  }
  const count = Object.keys(cache.tags).length;
  const when = new Date(cache.fetchedAt).toLocaleString();
  info.textContent = `${count} tags cached · last refreshed ${when}`;
}

async function onSaveToken(e) {
  e.preventDefault();
  const errEl = $("settings-error");
  const statusEl = $("settings-status");
  errEl.hidden = true;
  statusEl.hidden = true;

  const token = $("token").value.trim();
  if (!token || !token.includes(":")) {
    return showError(errEl, "Token should look like username:XXXXXXXX.");
  }

  const btn = $("settings-save");
  btn.disabled = true;
  btn.textContent = "Verifying…";

  try {
    // Validate by fetching tags; doubles as the initial cache warm-up.
    const client = createPinboardClient(token);
    const tags = await client.getTags();
    await setToken(token);
    await setTagCache(tags);
    state.token = token;
    state.client = client;
    state.tags = tags;

    statusEl.textContent = "Token saved.";
    statusEl.hidden = false;
    await renderCacheInfo();

    // First run: drop straight into the form once configured.
    showView("form");
    await prefillFromTab();
  } catch (err) {
    showError(errEl, describeError(err, "Could not verify token. Try again."));
  } finally {
    btn.disabled = false;
    btn.textContent = "Save token";
  }
}

async function onRefreshTags() {
  const btn = $("refresh-tags-btn");
  const errEl = $("settings-error");
  errEl.hidden = true;
  if (!state.client) return showError(errEl, "Save a token first.");

  btn.disabled = true;
  btn.textContent = "Refreshing…";
  try {
    const tags = await state.client.getTags();
    await setTagCache(tags);
    state.tags = tags;
    await renderCacheInfo();
  } catch (err) {
    showError(errEl, describeError(err, "Refresh failed. Try again shortly."));
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh tag cache";
  }
}
