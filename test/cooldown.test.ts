import { test } from "node:test";
import assert from "node:assert/strict";
import { TikTokService } from "../src/tiktok.js";

function makeService(cooldownMs: number): TikTokService {
  return new TikTokService({ username: "test_user", commandCooldownMs: cooldownMs });
}

test("cooldown = 0: luôn cho phép", () => {
  const s = makeService(0);
  assert.equal(s.canEmitCommand("u1", "vote", 1000), true);
  assert.equal(s.canEmitCommand("u1", "vote", 1001), true);
});

test("chặn spam cùng user + cùng key trong khoảng cooldown", () => {
  const s = makeService(3000);
  assert.equal(s.canEmitCommand("u1", "vote", 1000), true);
  assert.equal(s.canEmitCommand("u1", "vote", 2500), false);
  assert.equal(s.canEmitCommand("u1", "vote", 4001), true);
});

test("cooldown riêng theo từng user và từng key", () => {
  const s = makeService(3000);
  assert.equal(s.canEmitCommand("u1", "vote", 1000), true);
  assert.equal(s.canEmitCommand("u2", "vote", 1500), true);
  assert.equal(s.canEmitCommand("u1", "start", 2000), true);
  assert.equal(s.canEmitCommand("u1", "vote", 2500), false);
});

test("setCommandCooldown reset lịch sử", () => {
  const s = makeService(3000);
  assert.equal(s.canEmitCommand("u1", "vote", 1000), true);
  assert.equal(s.canEmitCommand("u1", "vote", 1500), false);
  s.setCommandCooldown(5000);
  assert.equal(s.canEmitCommand("u1", "vote", 2000), true);
});
