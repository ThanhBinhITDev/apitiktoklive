import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, "..", "config.json");

export interface AppConfig {
  username: string;
  wsToken: string;
  demoMode: boolean;
}

export function validateUsername(username: string): boolean {
  return /^[A-Za-z0-9_.-]{2,30}$/.test(username);
}

export function loadConfig(): AppConfig {
  let file: Partial<AppConfig> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (raw && typeof raw === "object") file = raw;
    } catch {
      // bỏ qua, dùng env
    }
  }
  const username = String(file.username ?? process.env.TIKTOK_USERNAME ?? "").replace(/^@/, "").trim();
  const wsToken = String(file.wsToken ?? process.env.WS_TOKEN ?? "").trim();
  const demoMode = file.demoMode === undefined ? process.env.DEMO_MODE === "true" : Boolean(file.demoMode);
  return { username, wsToken, demoMode };
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    username: partial.username !== undefined ? partial.username.replace(/^@/, "").trim() : current.username,
    wsToken: partial.wsToken !== undefined ? partial.wsToken.trim() : current.wsToken,
    demoMode: partial.demoMode !== undefined ? Boolean(partial.demoMode) : current.demoMode,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}
