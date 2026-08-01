import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TikTokService } from "./tiktok.js";
import { StatsManager } from "./stats.js";
import { loadConfig, saveConfig, validateUsername } from "./config.js";
import type { BroadcastEvent, StatsPayload } from "./types.js";

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

function emitEvent(event: BroadcastEvent): void {
  stats.record(event);
  broadcast({ type: "tiktok", payload: event });
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
  res.json({ username: tiktok.username, connected: tiktok.connected, roomId: tiktok.roomId });
});

app.post("/api/config", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  if (!validateUsername(username)) {
    res.status(400).json({ ok: false, error: "Username không hợp lệ. Chỉ dùng chữ/số, dấu chấm, gạch dưới, gạch ngang (2-30 ký tự)." });
    return;
  }
  const next = saveConfig({ username });
  if (!DEMO_MODE) tiktok.reconfigure(next.username);
  res.json({ ok: true, username: next.username });
});

app.get("/api/stats", (_req, res) => {
  res.json(stats.getSnapshot());
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
    { name: "Hoa Hồng", diamondCount: 1 },
    { name: "Vòng Tay", diamondCount: 5 },
    { name: "Trà Sữa", diamondCount: 30 },
    { name: "Thỏi Son", diamondCount: 100 },
    { name: "Siêu Xe", diamondCount: 500 },
    { name: "Thuyền Rồng", diamondCount: 1000 },
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
    const gift = randomItem(gifts);
    emitEvent({
      type: "gift",
      data: {
        ...randomItem(users),
        giftId: String(gift.diamondCount),
        giftName: gift.name,
        diamondCount: gift.diamondCount,
        repeatCount: 1 + Math.floor(Math.random() * 20),
        imageUrl: "",
        timestamp: Date.now(),
      },
    });
  };
  const demoFollow = (): void => {
    emitEvent({ type: "follow", data: { ...randomItem(users), timestamp: Date.now() } });
  };
  const demoViewer = (): void => {
    emitEvent({ type: "viewer", data: { viewerCount: 100 + Math.floor(Math.random() * 400), timestamp: Date.now() } });
  };

  setInterval(demoChat, 3000);
  setInterval(demoGift, 7000);
  setInterval(demoFollow, 9000);
  setInterval(demoLike, 800);
  setInterval(demoViewer, 4000);
}

server.listen(PORT, () => {
  console.log(`[server] Overlay:    http://localhost:${PORT}`);
  console.log(`[server] Dashboard: http://localhost:${PORT}/dashboard`);
  if (DEMO_MODE) {
    console.log("[server] Chế độ DEMO - đang phát dữ liệu giả để test giao diện");
    startDemo();
  } else {
    console.log(`[server] Kết nối TikTok live của @${tiktok.username}...`);
    tiktok.start();
  }
});

process.on("SIGINT", () => {
  tiktok.stop();
  server.close(() => process.exit(0));
});
