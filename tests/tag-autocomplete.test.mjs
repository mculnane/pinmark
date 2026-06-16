// Unit tests for the tag autocomplete engine.
//
// Pure logic, no DOM, so it runs under any JS engine. On this Mac with no Node,
// run it with JavaScriptCore:
//   jsc -m tests/tag-autocomplete.test.mjs
// (jsc lives at /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc)
// With Node available it also runs as: node tests/tag-autocomplete.test.mjs

import {
  tokenAtCaret,
  existingTags,
  rankSuggestions,
  applySuggestion,
} from "../src/lib/tag-autocomplete.js";

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    print(`FAIL: ${msg}\n  expected ${e}\n  actual   ${a}`);
  }
}

// Sample tag history with usage counts.
const TAGS = {
  javascript: 120,
  java: 45,
  jazz: 3,
  webdev: 80,
  web: 200,
  design: 64,
};

// --- tokenAtCaret ---
eq(tokenAtCaret("web design", 3).token, "web", "token under caret in first word");
eq(tokenAtCaret("web design", 10).token, "design", "token at end");
eq(tokenAtCaret("web ", 4).token, "", "caret after trailing space -> empty token");
eq(tokenAtCaret("web design", 4).token, "design", "caret at start of second word");
const tac = tokenAtCaret("aa bb cc", 4);
eq([tac.start, tac.end, tac.token], [3, 5, "bb"], "bounds of middle token");

// --- existingTags ---
eq(existingTags("  web   design  "), ["web", "design"], "splits and trims tags");
eq(existingTags(""), [], "empty field -> no tags");

// --- rankSuggestions: prefix beats substring, then frequency ---
// javascript(120) > java(45) > jazz(3), so most-used comes first.
const ja = rankSuggestions(TAGS, "ja").map((s) => s.tag);
eq(ja, ["javascript", "java", "jazz"], "prefix matches ranked by frequency desc");

const we = rankSuggestions(TAGS, "we").map((s) => s.tag);
eq(we, ["web", "webdev"], "web(200) before webdev(80)");

// substring (non-prefix) ranks below prefix matches
const av = rankSuggestions(TAGS, "av").map((s) => s.tag);
eq(av, ["javascript", "java"], "substring 'av' matches java words, freq order");

// case-insensitive
eq(rankSuggestions(TAGS, "JAVA").map((s) => s.tag), ["javascript", "java"], "case-insensitive");

// excludes tags already present
const exWe = rankSuggestions(TAGS, "we", { exclude: ["web"] }).map((s) => s.tag);
eq(exWe, ["webdev"], "excludes already-entered tag");

// empty query -> nothing
eq(rankSuggestions(TAGS, "   "), [], "blank query -> no suggestions");

// limit honoured
eq(rankSuggestions(TAGS, "ja", { limit: 1 }).map((s) => s.tag), ["javascript"], "limit caps results");

// prefix outranks a higher-frequency substring match
const PREFIX_VS_FREQ = { "ab-low": 5, zzabzz: 999 };
eq(
  rankSuggestions(PREFIX_VS_FREQ, "ab").map((s) => s.tag),
  ["ab-low", "zzabzz"],
  "prefix(5) beats higher-frequency substring(999)"
);

// --- applySuggestion ---
let r = applySuggestion("ja", 2, "javascript");
eq([r.value, r.caret], ["javascript ", 11], "completes sole token with trailing space");

r = applySuggestion("web ja", 6, "javascript");
eq([r.value, r.caret], ["web javascript ", 15], "completes last token, keeps earlier tags");

r = applySuggestion("web ja design", 6, "javascript");
eq(r.value, "web javascript design", "completes middle token without adding extra space");

print(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
