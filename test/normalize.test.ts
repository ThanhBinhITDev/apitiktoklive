import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeText } from "../src/normalize.js";

test("normalizeText bỏ dấu tiếng Việt", () => {
  assert.equal(normalizeText("Vôte"), "vote");
  assert.equal(normalizeText("Chạy Đẹp"), "chay dep");
  assert.equal(normalizeText("Bận"), "ban");
});

test("normalizeText lowercase + trim", () => {
  assert.equal(normalizeText("  START  "), "start");
  assert.equal(normalizeText("ViVa"), "viva");
});
