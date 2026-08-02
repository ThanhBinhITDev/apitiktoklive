import { normalizeText } from "./normalize.js";

export const GIFT_KEY = "gift";

export class CommandMatcher {
  private normalized = new Map<string, string>();

  setCommands(commands: string[]): void {
    this.normalized.clear();
    for (const cmd of commands) {
      const key = cmd.trim();
      if (key) this.normalized.set(normalizeText(key), key);
    }
  }

  match(content: string): string | null {
    if (this.normalized.size === 0) return null;
    return this.normalized.get(normalizeText(content)) ?? null;
  }
}
