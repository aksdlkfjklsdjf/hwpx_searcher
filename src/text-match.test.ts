import assert from "node:assert/strict";
import test from "node:test";
import { findTextMatches } from "./text-match.js";

test("finds case-insensitive matches with snippets", () => {
  const matches = findTextMatches("Alpha beta ALPHA", "alpha", false, 6);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.index, 0);
  assert.equal(matches[1]?.index, 11);
  assert.match(matches[1]?.snippet ?? "", /ALPHA/);
});

test("honors case-sensitive mode", () => {
  const matches = findTextMatches("Alpha alpha", "Alpha", true);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.index, 0);
});

test("returns no matches for empty query", () => {
  assert.deepEqual(findTextMatches("text", "", false), []);
});
