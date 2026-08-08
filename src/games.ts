import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- types ----------

export interface GameConfig {
  join: {
    keyword: string;
    maxPlayers: number;
    defaultHp: number;
  };
  arena: {
    roundDurationSec: number;
    resetCountdownSec: number;
    movementSpeed: number;
  };
  viewport: { width: number; height: number; adaptive: boolean };
  sawWhite: { requireTaps: number; durationSec: number; dps: number };
  sawGreen: { durationSec: number; dps: number };
  sawYellow: { minDiamonds: number; durationSec: number; dps: number };
  sawRed: { minDiamonds: number; durationSec: number; dps: number };
  gun: { minDiamonds: number; durationSec: number; damagePerShot: number; fireRateMs: number; bulletSpeed: number };
  lightning: { minDiamonds: number; durationSec: number; damage: number; radius: number; cooldownMs: number };
  storm: { minDiamonds: number; durationSec: number; damagePerShot: number; fireRateMs: number; lifestealPct: number };
  misc: {
    damageTickMs: number;
    playerRadius: number;
    sawRadius: number;
    sawLifestealPct: number;
    stealPct: number;
    scentRange: number;
    overlapPct: number;
    bounce: number;
    displayMode: string;
    sizeMin: number;
    sizeMax: number;
    sizeFullScore: number;
  };
}

export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  url: string;
  defaultConfig: GameConfig;
}

// ---------- defaults ----------

const DEFAULT_CONFIG: GameConfig = {
  join: { keyword: "", maxPlayers: 30, defaultHp: 400 },
  arena: { roundDurationSec: 180, resetCountdownSec: 10, movementSpeed: 120 },
  viewport: { width: 1920, height: 1080, adaptive: true },
  sawWhite: { requireTaps: 20, durationSec: 30, dps: 4 },
  sawGreen: { durationSec: 60, dps: 8 },
  sawYellow: { minDiamonds: 1, durationSec: 300, dps: 12 },
  sawRed: { minDiamonds: 5, durationSec: 300, dps: 16 },
  gun: { minDiamonds: 10, durationSec: 120, damagePerShot: 150, fireRateMs: 900, bulletSpeed: 520 },
  lightning: { minDiamonds: 15, durationSec: 120, damage: 600, radius: 140, cooldownMs: 4000 },
  storm: { minDiamonds: 20, durationSec: 180, damagePerShot: 80, fireRateMs: 300, lifestealPct: 0 },
  misc: {
    damageTickMs: 250,
    playerRadius: 22,
    sawRadius: 40,
    sawLifestealPct: 0,
    stealPct: 100,
    scentRange: 340,
    overlapPct: 30,
    bounce: 25,
    displayMode: "names",
    sizeMin: 22,
    sizeMax: 34,
    sizeFullScore: 800,
  },
};

const GAMES: GameDefinition[] = [
  {
    id: "saw-arena",
    name: "Đấu trường lưỡi cưa",
    description: "FFA sân đấu hình vuông — comment vào phòng, tap tim / follow / share / tặng quà để lên cấp lưỡi cưa và chiêu thức.",
    url: "/games/saw-arena/",
    defaultConfig: DEFAULT_CONFIG,
  },
];

// ---------- helpers ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function clampNum(value: unknown, fallback: number, min = 0, max = 1_000_000): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

/** Làm sạch dữ liệu từ client, ép về đúng shape + range của config mặc định. */
export function sanitizeConfig(input: unknown, base: GameConfig): GameConfig {
  const src: Record<string, any> = isPlainObject(input) ? input : {};
  const num = (key: string, fallback: number) => clampNum(src[key], fallback);

  return {
    join: {
      keyword: typeof src.join?.keyword === "string" ? src.join.keyword.trim() : base.join.keyword,
      maxPlayers: clampNum(src.join?.maxPlayers, base.join.maxPlayers, 1, 500),
      defaultHp: clampNum(src.join?.defaultHp, base.join.defaultHp, 1, 100_000),
    },
    arena: {
      roundDurationSec: clampNum(src.arena?.roundDurationSec, base.arena.roundDurationSec, 0, 3600),
      resetCountdownSec: clampNum(src.arena?.resetCountdownSec, base.arena.resetCountdownSec, 0, 300),
      movementSpeed: clampNum(src.arena?.movementSpeed, base.arena.movementSpeed, 0, 2000),
    },
    viewport: {
      width: clampNum(src.viewport?.width, base.viewport.width, 320, 7680),
      height: clampNum(src.viewport?.height, base.viewport.height, 240, 4320),
      adaptive: typeof src.viewport?.adaptive === "boolean" ? src.viewport.adaptive : base.viewport.adaptive,
    },
    sawWhite: {
      requireTaps: clampNum(src.sawWhite?.requireTaps, base.sawWhite.requireTaps, 1, 10_000),
      durationSec: clampNum(src.sawWhite?.durationSec, base.sawWhite.durationSec, 0, 3600),
      dps: clampNum(src.sawWhite?.dps, base.sawWhite.dps, 0, 100_000),
    },
    sawGreen: {
      durationSec: clampNum(src.sawGreen?.durationSec, base.sawGreen.durationSec, 0, 3600),
      dps: clampNum(src.sawGreen?.dps, base.sawGreen.dps, 0, 100_000),
    },
    sawYellow: {
      minDiamonds: clampNum(src.sawYellow?.minDiamonds, base.sawYellow.minDiamonds, 0, 100_000),
      durationSec: clampNum(src.sawYellow?.durationSec, base.sawYellow.durationSec, 0, 3600),
      dps: clampNum(src.sawYellow?.dps, base.sawYellow.dps, 0, 100_000),
    },
    sawRed: {
      minDiamonds: clampNum(src.sawRed?.minDiamonds, base.sawRed.minDiamonds, 0, 100_000),
      durationSec: clampNum(src.sawRed?.durationSec, base.sawRed.durationSec, 0, 3600),
      dps: clampNum(src.sawRed?.dps, base.sawRed.dps, 0, 100_000),
    },
    gun: {
      minDiamonds: clampNum(src.gun?.minDiamonds, base.gun.minDiamonds, 0, 100_000),
      durationSec: clampNum(src.gun?.durationSec, base.gun.durationSec, 0, 3600),
      damagePerShot: clampNum(src.gun?.damagePerShot, base.gun.damagePerShot, 0, 100_000),
      fireRateMs: clampNum(src.gun?.fireRateMs, base.gun.fireRateMs, 50, 60_000),
      bulletSpeed: clampNum(src.gun?.bulletSpeed, base.gun.bulletSpeed, 0, 3000),
    },
    lightning: {
      minDiamonds: clampNum(src.lightning?.minDiamonds, base.lightning.minDiamonds, 0, 100_000),
      durationSec: clampNum(src.lightning?.durationSec, base.lightning.durationSec, 0, 3600),
      damage: clampNum(src.lightning?.damage, base.lightning.damage, 0, 1_000_000),
      radius: clampNum(src.lightning?.radius, base.lightning.radius, 0, 3000),
      cooldownMs: clampNum(src.lightning?.cooldownMs, base.lightning.cooldownMs, 100, 300_000),
    },
    storm: {
      minDiamonds: clampNum(src.storm?.minDiamonds, base.storm.minDiamonds, 0, 100_000),
      durationSec: clampNum(src.storm?.durationSec, base.storm.durationSec, 0, 3600),
      damagePerShot: clampNum(src.storm?.damagePerShot, base.storm.damagePerShot, 0, 100_000),
      fireRateMs: clampNum(src.storm?.fireRateMs, base.storm.fireRateMs, 50, 60_000),
      lifestealPct: clampNum(src.storm?.lifestealPct, base.storm.lifestealPct, 0, 100),
    },
    misc: {
      damageTickMs: clampNum(src.misc?.damageTickMs, base.misc.damageTickMs, 50, 5000),
      playerRadius: clampNum(src.misc?.playerRadius, base.misc.playerRadius, 5, 300),
      sawRadius: clampNum(src.misc?.sawRadius, base.misc.sawRadius, 10, 500),
      sawLifestealPct: clampNum(src.misc?.sawLifestealPct, base.misc.sawLifestealPct, 0, 100),
      stealPct: clampNum(src.misc?.stealPct, base.misc.stealPct, 0, 200),
      scentRange: clampNum(src.misc?.scentRange, base.misc.scentRange, 0, 5000),
      overlapPct: clampNum(src.misc?.overlapPct, base.misc.overlapPct, 0, 100),
      bounce: clampNum(src.misc?.bounce, base.misc.bounce, 0, 100),
      displayMode: ["names", "number"].includes(src.misc?.displayMode) ? src.misc!.displayMode : base.misc.displayMode,
      sizeMin: clampNum(src.misc?.sizeMin, base.misc.sizeMin, 5, 500),
      sizeMax: clampNum(src.misc?.sizeMax, base.misc.sizeMax, 5, 500),
      sizeFullScore: clampNum(src.misc?.sizeFullScore, base.misc.sizeFullScore, 1, 1_000_000),
    },
  };
}

// ---------- store ----------

function configPath(id: string): string {
  return path.join(__dirname, "..", "public", "games", id, "config.json");
}

function loadFromDisk(id: string, base: GameConfig): GameConfig {
  const p = configPath(id);
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (isPlainObject(raw)) return sanitizeConfig(raw, base);
    } catch {
      // file lỗi -> dùng mặc định
    }
  }
  return base;
}

export function listGames(): GameDefinition[] {
  return GAMES;
}

export function isValidGame(id: string): boolean {
  return GAMES.some((g) => g.id === id);
}

export function getGameConfig(id: string): GameConfig | null {
  const def = GAMES.find((g) => g.id === id);
  if (!def) return null;
  return loadFromDisk(id, def.defaultConfig);
}

export function setGameConfig(id: string, input: unknown): GameConfig | null {
  const def = GAMES.find((g) => g.id === id);
  if (!def) return null;
  const base = loadFromDisk(id, def.defaultConfig);
  const merged = sanitizeConfig(input, base);
  const p = configPath(id);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return merged;
}

export function resetGameConfig(id: string): GameConfig | null {
  const def = GAMES.find((g) => g.id === id);
  if (!def) return null;
  const p = configPath(id);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(def.defaultConfig, null, 2) + "\n", "utf-8");
  return def.defaultConfig;
}
