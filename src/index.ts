import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TikTokService } from "./tiktok.js";
import { StatsManager } from "./stats.js";
import { loadConfig, saveConfig, validateUsername, type AppConfig } from "./config.js";
import {
  getAdminToken,
  adminTokenFromEnv,
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
  requireAdmin,
  isAuthed,
  pruneSessions,
} from "./auth.js";
import { color, C, fmtTime, pad, cell } from "./log.js";
import type { AdminWsMessage, BroadcastEvent, ClientInfo, StatusSnapshot, UserPayload } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const SIGN_API_KEY = process.env.SIGN_API_KEY || "";
const ENABLE_EXTENDED_GIFT_INFO = process.env.ENABLE_EXTENDED_GIFT_INFO === "true";

let cfg: AppConfig = loadConfig();

const app = express();
app.use(express.json());
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);

const server = createServer(app);

type AliveSocket = WebSocket & { isAlive?: boolean };

const tiktok = new TikTokService({
  username: cfg.username,
  signApiKey: SIGN_API_KEY,
  enableExtendedGiftInfo: ENABLE_EXTENDED_GIFT_INFO,
  demoMode: cfg.demoMode,
});
const stats = new StatsManager();

let nextClientId = 1;
interface TrackedClient extends ClientInfo {
  socket: AliveSocket;
}
const gameClients = new Map<number, TrackedClient>();
const adminClients = new Map<number, TrackedClient>();

// ---------- broadcast ----------

function send(socket: AliveSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcastGame(message: unknown): void {
  const raw = JSON.stringify(message);
  for (const c of gameClients.values()) {
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(raw);
  }
}

function broadcastAdmin(message: AdminWsMessage): void {
  const raw = JSON.stringify(message);
  for (const c of adminClients.values()) {
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(raw);
  }
}

// ---------- log ----------

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
      const rest = `${color(C.bold + C.yellow, d.giftName)} x${d.repeatCount} (${color(C.yellow, `${d.diamondCount} diam`)}, id=${color(C.dim, d.giftId)})`;
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
  broadcastGame({ type: "tiktok", payload: event });
  broadcastAdmin({ type: "tiktok", payload: event });
}

tiktok.on("event", emitEvent);

function statusSnapshot(): StatusSnapshot {
  return {
    connected: tiktok.connected,
    username: tiktok.username,
    roomId: tiktok.roomId,
    viewers: lastViewerCount,
    demoMode: cfg.demoMode,
    uptime: Math.round(process.uptime()),
  };
}

function sendStatusTo(socket: AliveSocket): void {
  send(socket, { type: "status", payload: statusSnapshot() });
}

function statusChanged(): void {
  broadcastAdmin({ type: "status", payload: statusSnapshot() });
}

// ---------- demo mode ----------

let demoTimers: NodeJS.Timeout[] = [];

function stopDemo(): void {
  for (const t of demoTimers) clearInterval(t);
  demoTimers = [];
}

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

  const push = (event: BroadcastEvent): void => emitEvent(event);
  const schedule = (fn: () => void, ms: number): void => {
    demoTimers.push(setInterval(fn, ms));
  };

  schedule(() => push({ type: "like", data: { user: randomItem(users).user, count: 1 + Math.floor(Math.random() * 5), total: 0, timestamp: Date.now() } }), 800);
  schedule(() => push({ type: "comment", data: { ...randomItem(users), content: randomItem(comments), timestamp: Date.now() } }), 3000);
  schedule(() => {
    const g = randomItem(gifts);
    push({
      type: "gift",
      data: {
        user: randomItem(users).user,
        giftId: g.giftId,
        giftName: g.name,
        diamondCount: g.diamondCount,
        repeatCount: 1 + Math.floor(Math.random() * 20),
        imageUrl: "",
        timestamp: Date.now(),
      },
    });
  }, 7000);
  schedule(() => push({ type: "follow", data: { ...randomItem(users), timestamp: Date.now() } }), 9000);
  schedule(() => push({ type: "viewer", data: { viewerCount: 100 + Math.floor(Math.random() * 400), timestamp: Date.now() } }), 4000);
  schedule(() => push({ type: "member", data: { ...randomItem(users), memberCount: 1 + Math.floor(Math.random() * 30), timestamp: Date.now() } }), 11000);
}

function applyDemoMode(on: boolean): void {
  if (cfg.demoMode === on) return;
  cfg.demoMode = on;
  if (on) {
    tiktok.stop();
    startDemo();
  } else {
    stopDemo();
    tiktok.reconfigure({ demoMode: false });
  }
  statusChanged();
}

// ---------- WebSocket ----------

function closeWithCode(socket: AliveSocket, code: number, reason: string): void {
  socket.close(code, reason);
}

const wssGame = new WebSocketServer({ noServer: true });
const wssAdmin = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  if (url.pathname === "/admin") {
    if (!isAuthed(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wssAdmin.handleUpgrade(req, socket, head, (ws) => wssAdmin.emit("connection", ws, req));
    return;
  }
  if (cfg.wsToken) {
    const token = url.searchParams.get("token") ?? "";
    if (token !== cfg.wsToken) {
      wssGame.handleUpgrade(req, socket, head, (ws) => {
        const alive = ws as AliveSocket;
        alive.isAlive = true;
        closeWithCode(alive, 1008, "unauthorized");
      });
      return;
    }
  }
  wssGame.handleUpgrade(req, socket, head, (ws) => wssGame.emit("connection", ws, req));
});

function track(clientMap: Map<number, TrackedClient>, socket: AliveSocket, ip: string, kind: "game" | "admin"): number {
  const id = nextClientId++;
  const tracked: TrackedClient = { id, socket, ip, connectedAt: Date.now(), kind };
  clientMap.set(id, tracked);
  socket.on("close", () => clientMap.delete(id));
  socket.on("error", () => clientMap.delete(id));
  return id;
}

function clientIp(req: { socket?: { remoteAddress?: string } }): string {
  return req.socket?.remoteAddress?.replace(/^::ffff:/, "") ?? "?";
}

wssGame.on("connection", (socket, req) => {
  const alive = socket as AliveSocket;
  alive.isAlive = true;
  alive.on("pong", () => {
    alive.isAlive = true;
  });
  track(gameClients, alive, clientIp(req), "game");
  sendStatusTo(alive);
  console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.magenta, pad("[client]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Game client ket noi tu ${color(C.cyan, clientIp(req))}`);
});

wssAdmin.on("connection", (socket, req) => {
  const alive = socket as AliveSocket;
  alive.isAlive = true;
  alive.on("pong", () => {
    alive.isAlive = true;
  });
  track(adminClients, alive, clientIp(req), "admin");
  sendStatusTo(alive);
  send(alive, { type: "stats", payload: stats.getSnapshot(true) });
});

setInterval(() => {
  pruneSessions();
  for (const map of [gameClients, adminClients]) {
    for (const [id, c] of map) {
      if (!c.socket.isAlive) {
        c.socket.terminate();
        map.delete(id);
        continue;
      }
      c.socket.isAlive = false;
      c.socket.ping();
    }
  }
}, 30000);

setInterval(() => {
  broadcastAdmin({ type: "stats", payload: stats.getSnapshot(true) });
}, 2000);

// ---------- auth routes ----------

app.post("/api/login", (req, res) => {
  const password = String(req.body?.password ?? "").trim();
  if (!password || password !== getAdminToken()) {
    res.status(401).json({ ok: false, error: "Sai mật khẩu." });
    return;
  }
  res.setHeader("Set-Cookie", sessionCookie(createSession()));
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  destroySession(req);
  res.setHeader("Set-Cookie", clearCookie());
  res.json({ ok: true });
});

// ---------- admin api ----------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: statusSnapshot().uptime,
    connected: tiktok.connected,
    username: tiktok.username,
    roomId: tiktok.roomId,
    viewers: lastViewerCount,
    demoMode: cfg.demoMode,
  });
});

app.get("/api/admin/status", requireAdmin, (_req, res) => {
  res.json(statusSnapshot());
});

app.get("/api/admin/config", requireAdmin, (_req, res) => {
  res.json({ username: cfg.username, wsToken: cfg.wsToken, demoMode: cfg.demoMode, wsTokenEnabled: Boolean(cfg.wsToken) });
});

app.post("/api/admin/config", requireAdmin, (req, res) => {
  const partial: Partial<AppConfig> = {};
  if (req.body?.username !== undefined) {
    const username = String(req.body.username).trim();
    if (!validateUsername(username)) {
      res.status(400).json({ ok: false, error: "Username không hợp lệ. Chỉ dùng chữ/số, dấu chấm, gạch dưới, gạch ngang (2-30 ký tự)." });
      return;
    }
    partial.username = username;
  }
  if (req.body?.wsToken !== undefined) {
    const token = String(req.body.wsToken).trim();
    if (token.length > 128) {
      res.status(400).json({ ok: false, error: "WS_TOKEN quá dài (tối đa 128 ký tự)." });
      return;
    }
    partial.wsToken = token;
  }
  if (req.body?.demoMode !== undefined) {
    partial.demoMode = Boolean(req.body.demoMode);
    if (partial.demoMode === false && !(partial.username ?? cfg.username)) {
      res.status(400).json({ ok: false, error: "Cần username TikTok để bật live mode." });
      return;
    }
  }

  cfg = saveConfig(partial);

  if (partial.username !== undefined && !cfg.demoMode) {
    tiktok.reconfigure({ username: partial.username });
  }
  if (partial.wsToken !== undefined) {
    statusChanged();
  }
  if (partial.demoMode !== undefined) {
    applyDemoMode(partial.demoMode);
  }

  console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.magenta, pad("[config]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Da luu: username=${cfg.username}, wsToken=${cfg.wsToken ? "***" : "(rong)"}, demoMode=${cfg.demoMode}`);
  res.json({ ok: true, ...cfg, wsTokenEnabled: Boolean(cfg.wsToken) });
});

app.post("/api/admin/reconnect", requireAdmin, (_req, res) => {
  if (cfg.demoMode) {
    res.status(400).json({ ok: false, error: "Đang ở demo mode, không cần reconnect." });
    return;
  }
  tiktok.reconfigure({ username: tiktok.username });
  res.json({ ok: true });
});

app.get("/api/admin/clients", requireAdmin, (_req, res) => {
  const list: ClientInfo[] = [
    ...[...gameClients.values()].map((c) => ({ id: c.id, ip: c.ip, connectedAt: c.connectedAt, kind: c.kind })),
    ...[...adminClients.values()].map((c) => ({ id: c.id, ip: c.ip, connectedAt: c.connectedAt, kind: c.kind })),
  ].sort((a, b) => a.connectedAt - b.connectedAt);
  res.json({ clients: list });
});

app.post("/api/admin/clients/:id/kick", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const found = gameClients.get(id) ?? adminClients.get(id);
  if (!found) {
    res.status(404).json({ ok: false, error: "Không tìm thấy client." });
    return;
  }
  closeWithCode(found.socket, 1008, "kicked by admin");
  res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  res.json(stats.getSnapshot());
});

app.post("/api/admin/stats/reset", requireAdmin, (_req, res) => {
  stats.reset();
  broadcastAdmin({ type: "stats", payload: stats.getSnapshot(true) });
  console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.yellow, pad("[stats]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Reset thong ke`);
  res.json({ ok: true });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// ---------- boot ----------

const L = (text: string, colorCode = ""): void => console.log(color(colorCode, text));

function printBanner(): void {
  const bar = color(C.dim, "─".repeat(66));
  L(bar);
  L(color(C.bold + C.cyan, "  TikTok Live Data Bridge") + color(C.dim, "   - WebSocket realtime & admin & by Thanh Binh IT"));
  L(bar);
  L(`  WebSocket:  ${color(C.brightGreen, `ws://localhost:${PORT}`)}` + (cfg.wsToken ? color(C.dim, "  (yeu cau ?token=WS_TOKEN)") : ""));
  L(`  Admin:      ${color(C.brightGreen, `http://localhost:${PORT}/admin`)}`);
  if (!adminTokenFromEnv()) {
    L(color(C.bold + C.yellow, `  ADMIN_TOKEN: ${getAdminToken()}`));
    L(color(C.dim, "  (mat khau dang nhap /admin - sao chep nguyen vang, khong kem khoang trang)"));
  }
  L(`  Health:     ${color(C.brightGreen, `http://localhost:${PORT}/api/health`)}`);
  L(`  Username:   ${color(C.cyan, "@" + tiktok.username)}`);
  L(`  Mode:       ${cfg.demoMode ? color(C.bold + C.magenta, "DEMO - phat du lieu gia") : color(C.bold + C.green, "LIVE")}`);
  L(bar);
}

server.listen(PORT, () => {
  printBanner();
  if (cfg.demoMode) {
    startDemo();
  } else {
    tiktok.start();
  }
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal: string): void {
  console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.yellow, pad("[server]", TAG_W))} ${color(C.dim, pad("-", USER_W))} Nhan ${signal}, dang dung...`);
  stopDemo();
  tiktok.stop();
  for (const c of [...gameClients.values(), ...adminClients.values()]) {
    c.socket.terminate();
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
