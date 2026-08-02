import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandMatcher } from "../src/commands.js";

test("match chính xác cả câu (không chứa tham số)", () => {
  const m = new CommandMatcher();
  m.setCommands(["start", "vote", "help"]);
  assert.equal(m.match("vote"), "vote");
  assert.equal(m.match("Vôte"), "vote");
  assert.equal(m.match("  start "), "start");
  assert.equal(m.match("vote now"), null);
  assert.equal(m.match("play"), null);
  assert.equal(m.match(""), null);
});

test("match khi danh sách rỗng trả null", () => {
  const m = new CommandMatcher();
  assert.equal(m.match("vote"), null);
});

test("setCommands ghi đè danh sách cũ", () => {
  const m = new CommandMatcher();
  m.setCommands(["a"]);
  assert.equal(m.match("a"), "a");
  m.setCommands(["b"]);
  assert.equal(m.match("a"), null);
  assert.equal(m.match("b"), "b");
});
