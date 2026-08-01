import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TikTokService } from "./tiktok.js";
import type { BroadcastEvent, StatsPayload } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const USERNAME = process.env.TIKTOK_USERNAME || "";
const SIGN_API_KEY = process.env.SIGN_API_KEY || "";
const ENABLE_EXTENDED_GIFT_INFO = process.env.ENABLE_EXTENDED_GIFT_INFO === "true";
const DEMO_MODE = process.env.DEMO_MODE === "true";

if (!USERNAME && !DEMO_MODE) {
  console.error("Thiếu TIKTOK_USERNAME. Hãy tạo file .env và đặt username TikTok đang live, hoặc bật DEMO_MODE=true để test giao diện.");
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

const stats: StatsPayload = { viewers: 0, likes: 0, comments: 0, gifts: 0 };

const emitEvent = (event: BroadcastEvent): void => {
  switch (event.type) {
    case "comment":
      stats.comments++;
      break;
    case "gift":
      stats.gifts++;
      break;
    case "like":
      stats.likes += event.data.count;
      break;
    case "status":
      if (!event.data.connected) stats.viewers = 0;
      break;
    default:
      break;
  }
  broadcast({ type: "tiktok", payload: event });
};

const tiktok = new TikTokService({ username: USERNAME, signApiKey: SIGN_API_KEY, enableExtendedGiftInfo: ENABLE_EXTENDED_GIFT_INFO });

tiktok.on("event", emitEvent);

function broadcast(message: unknown): void {
  const raw = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

wss.on("connection", (socket) => {
  clients.add(socket);

  socket.send(
    JSON.stringify({ type: "tiktok", payload: { type: "status", data: { connected: tiktok.connected, username: USERNAME, roomId: tiktok.roomId ?? undefined } } })
  );
  socket.send(JSON.stringify({ type: "stats", payload: stats }));

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

setInterval(() => broadcast({ type: "stats", payload: stats }), 2000);

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

  setInterval(demoChat, 3000);
  setInterval(demoGift, 7000);
  setInterval(demoFollow, 9000);
  setInterval(demoLike, 800);
}

server.listen(PORT, () => {
  console.log(`[server] Overlay:  http://localhost:${PORT}`);
  if (DEMO_MODE) {
    console.log("[server] Chế độ DEMO - đang phát dữ liệu giả để test giao diện");
    startDemo();
  } else {
    console.log(`[server] Kết nối TikTok live của @${USERNAME}...`);
    tiktok.start();
  }
});

process.on("SIGINT", () => {
  tiktok.stop();
  server.close(() => process.exit(0));
});
