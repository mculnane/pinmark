// Tag autocomplete engine — pure logic, no DOM.
//
// The tags field holds space-separated tags. As the user types, we autocomplete
// the single token under the caret while leaving the others untouched. Kept DOM-
// free so it can be unit-tested in isolation; the popup wires it to an <input>.

// Find the token currently being edited, given the field value and caret index.
// Returns { token, start, end } where [start, end) bounds the token in `value`.
// On a space (between tokens) the token is empty and no suggestions show.
export function tokenAtCaret(value, caret) {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  let start = safeCaret;
  while (start > 0 && !isSep(value[start - 1])) start--;
  let end = safeCaret;
  while (end < value.length && !isSep(value[end])) end++;
  return { token: value.slice(start, end), start, end };
}

function isSep(ch) {
  return ch === " " || ch === "\t" || ch === "\n";
}

// Tags already present in the field (so we don't suggest duplicates).
export function existingTags(value) {
  return value.split(/\s+/).filter(Boolean);
}

// Rank tag suggestions for a query.
//
// `tags` is { tagName: usageCount }. Matching is case-insensitive. Results are
// ordered to mirror the original bookmarker extension: prefix matches first,
// then by usage frequency (most-used first), then alphabetically as a stable
// tie-breaker. Substring (non-prefix) matches are included but rank below all
// prefix matches. Tags already in the field are excluded.
export function rankSuggestions(tags, query, { exclude = [], limit = 8 } = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const excludeSet = new Set(exclude.map((t) => t.toLowerCase()));
  const matches = [];

  for (const [tag, count] of Object.entries(tags)) {
    const lower = tag.toLowerCase();
    if (excludeSet.has(lower)) continue;
    const idx = lower.indexOf(q);
    if (idx === -1) continue;
    matches.push({ tag, count, isPrefix: idx === 0 });
  }

  matches.sort((a, b) => {
    if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return a.tag.localeCompare(b.tag);
  });

  return matches.slice(0, limit);
}

// Replace the token under the caret with `tag`, returning the new field value
// and the caret position to set afterwards. Ensures exactly one trailing space
// so the user can immediately type the next tag.
export function applySuggestion(value, caret, tag) {
  const { start, end } = tokenAtCaret(value, caret);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needsSpace = after.length === 0 || !isSep(after[0]);
  const insertion = tag + (needsSpace ? " " : "");
  const newValue = before + insertion + after;
  const newCaret = before.length + insertion.length;
  return { value: newValue, caret: newCaret };
}
