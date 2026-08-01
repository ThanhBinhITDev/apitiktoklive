import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

export interface AppConfig {
  username: string;
}

export function loadConfig(): AppConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (raw?.username) {
        return { username: String(raw.username).replace(/^@/, "").trim() };
      }
    } catch (err) {
      console.error(`[config] Không đọc được config.json (${err}), dùng giá trị từ env.`);
    }
  }
  return { username: (process.env.TIKTOK_USERNAME || "").replace(/^@/, "").trim() };
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = { ...current, ...partial };
  if (next.username) next.username = next.username.replace(/^@/, "").trim();
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}

export function validateUsername(username: string): boolean {
  return /^[A-Za-z0-9_.-]{2,30}$/.test(username);
}
