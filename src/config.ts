import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

export interface AppConfig {
  username: string;
  commands: string[];
  giftCommands: string[];
  commandCooldownMs: number;
}

export const DEFAULT_COOLDOWN_MS = 3000;

export function validateCooldown(v: unknown): number {
  if (v === undefined || v === null) return DEFAULT_COOLDOWN_MS;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_COOLDOWN_MS;
  return Math.max(0, Math.min(60000, Math.round(n)));
}

export function validateUsername(username: string): boolean {
  return /^[A-Za-z0-9_.-]{2,30}$/.test(username);
}

export function validateCommands(commands: unknown): commands is string[] {
  if (!Array.isArray(commands)) return false;
  return commands.every(
    (cmd) =>
      typeof cmd === "string" &&
      cmd.trim().length >= 1 &&
      cmd.trim().length <= 30 &&
      /^[A-Za-z0-9 _-]+$/.test(cmd.trim())
  );
}

export function validateGiftCommands(commands: unknown): commands is string[] {
  if (!Array.isArray(commands)) return false;
  return commands.every(
    (cmd) =>
      typeof cmd === "string" &&
      cmd.trim().length >= 1 &&
      cmd.trim().length <= 30 &&
      /^[A-Za-z0-9 _-]+$/.test(cmd.trim())
  );
}

function sanitizeCommands(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cmd of raw) {
    if (typeof cmd !== "string") continue;
    const key = cmd.trim();
    if (!key || seen.has(key) || !validateCommands([key])) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function sanitizeGiftCommands(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const cmd of raw) {
    if (typeof cmd !== "string") continue;
    const key = cmd.trim();
    if (!key || seen.has(key) || !validateGiftCommands([key])) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function loadConfig(): AppConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (raw?.username) {
        return {
          username: String(raw.username).replace(/^@/, "").trim(),
          commands: sanitizeCommands(raw.commands),
          giftCommands: sanitizeGiftCommands(raw.giftCommands),
          commandCooldownMs: validateCooldown(raw.commandCooldownMs),
        };
      }
    } catch (err) {
      console.error(`[config] Không đọc được config.json (${err}), dùng giá trị từ env.`);
    }
  }
  return {
    username: (process.env.TIKTOK_USERNAME || "").replace(/^@/, "").trim(),
    commands: [],
    giftCommands: [],
    commandCooldownMs: DEFAULT_COOLDOWN_MS,
  };
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    ...current,
    ...partial,
  };
  if (next.username) next.username = next.username.replace(/^@/, "").trim();
  next.commands = sanitizeCommands(next.commands);
  next.giftCommands = sanitizeGiftCommands(next.giftCommands);
  next.commandCooldownMs = validateCooldown(next.commandCooldownMs);
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}
