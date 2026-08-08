/* TikTokGame — thư viện dùng chung cho các game trong /games
 * Kết nối WebSocket của server, nhận sự kiện TikTok + cấu hình game.
 * Dùng: TikTokGame.on("tiktok", (ev) => ...), TikTokGame.requestConfig("saw-arena")
 */
(function () {
  "use strict";

  const listeners = { tiktok: [], status: [], gameConfig: [], ws: [] };
  const lastConfig = {};
  let ws = null;
  let reconnectDelay = 1000;
  let closed = false;

  function on(type, fn) {
    (listeners[type] || (listeners[type] = [])).push(fn);
    return () => {
      listeners[type] = listeners[type].filter((f) => f !== fn);
    };
  }

  function emit(type, ...args) {
    const arr = listeners[type] || [];
    for (const fn of arr) {
      try {
        fn(...args);
      } catch (e) {
        console.error("[game] handler error:", e);
      }
    }
  }

  function buildUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams();
    const token =
      new URLSearchParams(location.search).get("token") ||
      localStorage.getItem("tiktokGameToken") ||
      "";
    if (token) params.set("token", token);
    const qs = params.toString();
    return `${proto}://${location.host}/${qs ? "?" + qs : ""}`;
  }

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(buildUrl());
    } catch {
      return;
    }
    ws.onopen = () => {
      reconnectDelay = 1000;
      emit("ws", { state: "open" });
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "tiktok") emit("tiktok", msg.payload);
      else if (msg.type === "status") emit("status", msg.payload);
      else if (msg.type === "gameConfig") {
        lastConfig[msg.game] = msg.payload;
        emit("gameConfig", msg.payload, msg.game);
      }
    };
    ws.onclose = () => {
      emit("ws", { state: "closed" });
      if (!closed) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      }
    };
    ws.onerror = () => {};
  }

  function close() {
    closed = true;
    if (ws) ws.close();
  }

  function requestConfig(gameId) {
    if (lastConfig[gameId]) return Promise.resolve(lastConfig[gameId]);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        fn(val);
      };
      const timer = setTimeout(() => finish(reject, new Error("timeout config")), 8000);
      const off = on("gameConfig", (cfg, gid) => {
        if (gid === gameId) finish(resolve, cfg);
      });
      const sendReq = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "getConfig", game: gameId }));
        }
      };
      if (ws && ws.readyState === WebSocket.OPEN) sendReq();
      else {
        const offOpen = on("ws", (s) => {
          if (s.state === "open") {
            offOpen();
            sendReq();
          }
        });
      }
    });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  window.TikTokGame = { on, connect, close, requestConfig, send };
})();
