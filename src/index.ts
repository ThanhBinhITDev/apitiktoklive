import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TikTokService } from "./tiktok.js";
import { StatsManager } from "./stats.js";
import { loadConfig, saveConfig, validateUsername, validateCommands, validateGiftCommands } from "./config.js";
import { color, C, fmtTime, pad, cell } from "./log.js";
import type { BroadcastEvent, StatsPayload, UserPayload } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const SIGN_API_KEY = process.env.SIGN_API_KEY || "";
const ENABLE_EXTENDED_GIFT_INFO = process.env.ENABLE_EXTENDED_GIFT_INFO === "true";
const DEMO_MODE = process.env.DEMO_MODE === "true";

const config = loadConfig();
if (!config.username && !DEMO_MODE) {
  console.error("Thiếu TIKTOK_USERNAME hoặc config.json chưa có username. Hãy tạo file .env hoặc config.json, hoặc bật DEMO_MODE=true để test giao diện.");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

const stats = new StatsManager();
const tiktok = new TikTokService({
  username: config.username,
  commands: config.commands,
  giftCommands: config.giftCommands,
  commandCooldownMs: config.commandCooldownMs,
  signApiKey: SIGN_API_KEY,
  enableExtendedGiftInfo: ENABLE_EXTENDED_GIFT_INFO,
});

function broadcast(message: unknown): void {
  const raw = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

function fmtUser(user: UserPayload | null | undefined): string {
  return user ? `${user.nickname} (@${user.uniqueId})` : "(ẩn danh)";
}

const USER_W = 24;
const TAG_W = 9;

function line(tagText: string, tagColor: string, user: UserPayload | null | undefined, userColor: string, rest: string): string {
  const time = color(C.dim, `[${fmtTime()}]`);
  const tag = color(C.bold, color(tagColor, pad(`[${tagText}]`, TAG_W)));
  const userCell = cell(fmtUser(user), USER_W);
  return `${time} ${tag} ${color(userColor, userCell)} ${rest}`;
}

let lastViewerCount: number | null = null;

function logEvent(event: BroadcastEvent): void {
  switch (event.type) {
    case "comment":
      console.log(line("comment", C.cyan, event.data.user, C.cyan, event.data.content));
      break;
    case "gift": {
      const d = event.data;
      const recognized = tiktok.giftCommands.includes(d.giftId);
      const name = color(C.bold + C.yellow, d.giftName);
      const suffix = recognized
        ? color(C.brightGreen + C.bold, "=> NHAN DIEN LENH")
        : color(C.dim, "=> overlay");
      const rest = `${name} x${d.repeatCount} (${color(C.yellow, `${d.diamondCount} diam`)}, id=${color(C.dim, d.giftId)}) ${suffix}`;
      console.log(line("gift", C.yellow, d.user, C.yellow, rest));
      break;
    }
    case "like":
      console.log(line("like", C.red, event.data.user, C.red, `+${color(C.bold + C.red, String(event.data.count))} likes`));
      break;
    case "follow":
      console.log(line("follow", C.green, event.data.user, C.green, color(C.green, "da follow")));
      break;
    case "share":
      console.log(line("share", C.blue, event.data.user, C.blue, color(C.blue, "da chia se")));
      break;
    case "member": {
      const viewers = lastViewerCount ?? event.data.memberCount;
      console.log(line("member", C.magenta, event.data.user, C.magenta, `vao live + ${color(C.bold, String(viewers))} nguoi xem`));
      break;
    }
    case "viewer":
      lastViewerCount = event.data.viewerCount;
      break;
    case "command": {
      const d = event.data;
      const extra = d.giftId ? color(C.yellow, ` (gift id=${d.giftId})`) : "";
      const rest = `key=${color(C.bold + C.green, `"${d.key}"`)}${extra}`;
      console.log(line("command", C.bold + C.green, d.user, C.green, rest));
      break;
    }
    case "status":
      console.log(
        `${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.blue, pad("[status]", TAG_W))} ${color(C.dim, pad("-", USER_W))} ${event.data.connected ? color(C.brightGreen + C.bold, "Ket noi") : color(C.red + C.bold, "Mat ket noi")} ${event.data.username}${event.data.roomId ? color(C.dim, ` (room ${event.data.roomId})`) : ""}`
      );
      break;
  }
}

function emitEvent(event: BroadcastEvent): void {
  logEvent(event);
  stats.record(event);
  if (event.type === "command") {
    broadcast({ type: "command", payload: event.data });
  } else {
    broadcast({ type: "tiktok", payload: event });
  }
}

tiktok.on("event", emitEvent);

function sendStatsTo(client: WebSocket): void {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: "stats", payload: stats.getSnapshot() }));
  }
}

wss.on("connection", (socket) => {
  clients.add(socket);
  sendStatsTo(socket);

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

app.get("/api/config", (_req, res) => {
  res.json({
    username: tiktok.username,
    commands: tiktok.commands,
    giftCommands: tiktok.giftCommands,
    commandCooldownMs: tiktok.commandCooldownMs,
    connected: tiktok.connected,
    roomId: tiktok.roomId,
  });
});

app.post("/api/config", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  if (!validateUsername(username)) {
    res.status(400).json({ ok: false, error: "Username không hợp lệ. Chỉ dùng chữ/số, dấu chấm, gạch dưới, gạch ngang (2-30 ký tự)." });
    return;
  }
  const partial: { username: string; commands?: string[]; giftCommands?: string[]; commandCooldownMs?: number } = { username };
  if (req.body?.commands !== undefined) {
    const commands = Array.isArray(req.body.commands) ? req.body.commands.map(String).map((s: string) => s.trim()) : [];
    if (!validateCommands(commands)) {
      res.status(400).json({ ok: false, error: "Danh sách lệnh không hợp lệ. Mỗi lệnh 1-30 ký tự (chữ/số, khoảng trắng, gạch dưới, gạch ngang)." });
      return;
    }
    partial.commands = commands;
  }
  if (req.body?.giftCommands !== undefined) {
    const giftCommands = Array.isArray(req.body.giftCommands) ? req.body.giftCommands.map(String).map((s: string) => s.trim()) : [];
    if (!validateGiftCommands(giftCommands)) {
      res.status(400).json({ ok: false, error: "Danh sách quà nhận diện không hợp lệ. Mỗi mã 1-30 ký tự (chữ/số, khoảng trắng, gạch dưới, gạch ngang)." });
      return;
    }
    partial.giftCommands = giftCommands;
  }
  if (req.body?.commandCooldownMs !== undefined) {
    const ms = Number(req.body.commandCooldownMs);
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) {
      res.status(400).json({ ok: false, error: "Cooldown phải là số mili-giây từ 0 đến 60000 (0 = tắt)." });
      return;
    }
    partial.commandCooldownMs = Math.round(ms);
  }
  const next = saveConfig(partial);
  if (!DEMO_MODE) tiktok.reconfigure({ username: next.username, commands: next.commands, giftCommands: next.giftCommands, commandCooldownMs: next.commandCooldownMs });
  else {
    tiktok.setCommands(next.commands);
    tiktok.setGiftCommands(next.giftCommands);
    tiktok.setCommandCooldown(next.commandCooldownMs);
  }
  res.json({ ok: true, username: next.username, commands: next.commands, giftCommands: next.giftCommands, commandCooldownMs: next.commandCooldownMs });
  console.log(
    `${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.magenta, pad("[config]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Da luu: username=${next.username}, commands=[${next.commands.join(", ")}], giftCommands=[${next.giftCommands.join(", ")}], cooldown=${next.commandCooldownMs}ms`
  );
});

app.get("/api/stats", (_req, res) => {
  res.json(stats.getSnapshot());
});

app.post("/api/stats/reset", (_req, res) => {
  stats.reset();
  broadcast({ type: "stats", payload: stats.getSnapshot() });
  console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.yellow, pad("[stats]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Reset thong ke`);
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});

setInterval(() => {
  const snapshot: StatsPayload = stats.getSnapshot();
  broadcast({ type: "stats", payload: snapshot });
}, 2000);

function startDemo(): void {
  const names = ["Minh Anh", "Bảo Trân", "Quốc Huy", "Lan Phương", "Đức Mạnh", "Hồng Nhung", "Tùng Lâm", "Ngọc Mai"];
  const comments = ["Chào anh ơi!", "Quà này đẹp quá 🎁", "Haha hay thật", "Em vừa follow xong ❤️", "Cho em xin 1 trái tim", "Stream vui ghê", "Ai cũng khen hay", "Lần đầu xem live ạ"];
  const gifts = [
    { giftId: "1001", name: "Hoa Hồng", diamondCount: 1 },
    { giftId: "1002", name: "Vòng Tay", diamondCount: 5 },
    { giftId: "1003", name: "Trà Sữa", diamondCount: 30 },
    { giftId: "1004", name: "Thỏi Son", diamondCount: 100 },
    { giftId: "1005", name: "Siêu Xe", diamondCount: 500 },
    { giftId: "1006", name: "Thuyền Rồng", diamondCount: 1000 },
  ];
  const users = names.map((nickname, i) => ({
    user: {
      uniqueId: `user_${i + 1}`,
      nickname,
      avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(nickname)}`,
    },
  }));

  const randomItem = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const demoLike = (): void => {
    emitEvent({ type: "like", data: { user: randomItem(users).user, count: 1 + Math.floor(Math.random() * 5), total: 0, timestamp: Date.now() } });
  };
  const demoChat = (): void => {
    emitEvent({ type: "comment", data: { ...randomItem(users), content: randomItem(comments), timestamp: Date.now() } });
  };
  const demoGift = (): void => {
    const recognizedIds = tiktok.giftCommands;
    const pickRecognized = recognizedIds.length > 0 && Math.random() < 0.5;
    const matched = pickRecognized
      ? gifts.find((g) => recognizedIds.includes(g.giftId)) ?? randomItem(gifts)
      : gifts.find((g) => !recognizedIds.includes(g.giftId)) ?? randomItem(gifts);
    const repeatCount = 1 + Math.floor(Math.random() * 20);
    const payload = {
      user: randomItem(users).user,
      giftId: matched.giftId,
      giftName: matched.name,
      diamondCount: matched.diamondCount,
      repeatCount,
      imageUrl: "",
      timestamp: Date.now(),
    };
    emitEvent({ type: "gift", data: payload });
    if (recognizedIds.includes(matched.giftId)) {
      emitEvent({
        type: "command",
        data: {
          key: "gift",
          user: payload.user,
          content: matched.name,
          timestamp: payload.timestamp,
          giftId: matched.giftId,
          giftName: matched.name,
          diamondCount: matched.diamondCount,
          repeatCount,
        },
      });
    }
  };
  const demoFollow = (): void => {
    emitEvent({ type: "follow", data: { ...randomItem(users), timestamp: Date.now() } });
  };
  const demoCommand = (): void => {
    const keys = tiktok.commands;
    if (keys.length === 0) return;
    const key = randomItem(keys);
    const user = randomItem(users).user;
    emitEvent({
      type: "command",
      data: { key, user, content: key, timestamp: Date.now() },
    });
  };
  const demoViewer = (): void => {
    emitEvent({ type: "viewer", data: { viewerCount: 100 + Math.floor(Math.random() * 400), timestamp: Date.now() } });
  };
  const demoMember = (): void => {
    emitEvent({ type: "member", data: { ...randomItem(users), memberCount: 1 + Math.floor(Math.random() * 30), timestamp: Date.now() } });
  };

  setInterval(demoChat, 3000);
  setInterval(demoGift, 7000);
  setInterval(demoFollow, 9000);
  setInterval(demoCommand, 5500);
  setInterval(demoLike, 800);
  setInterval(demoViewer, 4000);
  setInterval(demoMember, 11000);
}

const L = (text: string, colorCode = ""): void => console.log(color(colorCode, text));

function printBanner(): void {
  const bar = color(C.dim, "─".repeat(66));
  L(bar);
  L(color(C.bold + C.cyan, "  TikTok Live Bridge") + color(C.dim, "   - log realtime & by Thanh Binh IT"));
  L(bar);
  L(`  Overlay:    ${color(C.brightGreen, `http://localhost:${PORT}`)}`);
  L(`  Dashboard:  ${color(C.brightGreen, `http://localhost:${PORT}/dashboard`)}`);
  L(`  Username:   ${color(C.cyan, "@" + tiktok.username)}`);
  L(`  Commands:   ${color(C.green, tiktok.commands.length ? tiktok.commands.join(", ") : "(khong co)")}`);
  L(`  Gifts:      ${color(C.yellow, tiktok.giftCommands.length ? tiktok.giftCommands.join(", ") : "(khong co)")}`);
  L(`  Cooldown:   ${color(C.yellow, tiktok.commandCooldownMs + "ms")}`);
  if (DEMO_MODE) {
    L(`  Mode:       ${color(C.bold + C.magenta, "DEMO - phat du lieu gia")}`);
  } else {
    L(`  Mode:       ${color(C.bold + C.green, "LIVE")}`);
  }
  L(bar);
}

server.listen(PORT, () => {
  printBanner();
  if (DEMO_MODE) {
    startDemo();
  } else {
    tiktok.start();
  }
});

process.on("SIGINT", () => {
  tiktok.stop();
  server.close(() => process.exit(0));
});
