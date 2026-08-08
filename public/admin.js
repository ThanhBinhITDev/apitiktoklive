"use strict";

const $ = (sel) => document.querySelector(sel);

const state = {
  ws: null,
  authed: false,
  filter: "all",
  paused: false,
  stats: null,
};

const TAG_LABEL = { comment: "Cmt", gift: "Quà", like: "Tim", follow: "Follow", share: "Share", member: "Vào live", status: "Trạng thái" };

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("vi-VN", { hour12: false });
}

function fmtAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}ph`;
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h > 0 ? h + "g" : ""}${String(m).padStart(2, "0")}ph${String(s).padStart(2, "0")}s`;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/login") {
      showLogin();
    }
    throw new Error(data.error || `Lỗi ${res.status}`);
  }
  return data;
}

// ---------- auth ----------

function showLogin() {
  state.authed = false;
  state.ws?.close();
  state.ws = null;
  $("#app").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
}

function showApp() {
  state.authed = true;
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  loadConfigForm();
  refreshClients();
  connectAdminWs();
  renderDocsUrls();
  loadGameSettings();
}

// ---------- docs ----------

function renderDocsUrls() {
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const httpProto = location.protocol;
  const wsUrl = `${wsProto}://${location.host}`;
  $("#docs-ws-url").textContent = wsUrl;
  $("#docs-health-url").textContent = `${httpProto}://${location.host}/api/health`;
  updateWsTokenNote(null);
}

function updateWsTokenNote(wsTokenEnabled) {
  const note = $("#docs-ws-token-note");
  if (!note) return;
  if (wsTokenEnabled === true) {
    note.textContent = "WS_TOKEN đang bật — game phải kết nối kèm ?token=<WS_TOKEN> (vào tab Cấu hình để xem). Nếu sai token server đóng kết nối mã 1008.";
  } else if (wsTokenEnabled === false) {
    note.textContent = "WS_TOKEN đang tắt — game kết nối trực tiếp, không cần token.";
  } else {
    note.textContent = "Nếu WS_TOKEN được bật ở tab Cấu hình, game phải kết nối kèm ?token=<WS_TOKEN>.";
  }
}

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      toast("Đã copy: " + text);
    } catch {
      toast("Không copy được.");
    }
  });
});

document.querySelectorAll("[data-copy-input]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = document.getElementById(btn.dataset.copyInput)?.value ?? "";
    if (!text) {
      toast("Trống, không có gì để copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Đã copy WS_TOKEN.");
    } catch {
      toast("Không copy được.");
    }
  });
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error");
  err.classList.add("hidden");
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#login-password").value.trim() }),
    });
    $("#login-password").value = "";
    showApp();
  } catch (ex) {
    err.textContent = ex.message || "Đăng nhập thất bại.";
    err.classList.remove("hidden");
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  state.ws?.close();
  showLogin();
});

// ---------- tabs ----------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab.dataset.tab}`));
  });
});

// ---------- admin websocket ----------

function connectAdminWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/admin`);
  state.ws = ws;

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "tiktok") feedAdd(msg.payload);
    else if (msg.type === "stats") updateStats(msg.payload);
    else if (msg.type === "status") updateStatus(msg.payload);
  };

  ws.onclose = () => {
    if (state.authed) setTimeout(connectAdminWs, 3000);
  };
}

// ---------- status header ----------

function updateStatus(s) {
  $("#chip-user").textContent = `@${s.username || "—"}`;
  $("#chip-room").textContent = s.roomId ? `room: ${s.roomId}` : "room: —";
  $("#chip-viewers").textContent = `👁 ${s.viewers ?? 0}`;
  $("#chip-uptime").textContent = `⏱ ${fmtDur(s.uptime)}`;
  const mode = $("#chip-mode");
  mode.textContent = s.demoMode ? "Demo" : "Live";
  mode.style.color = s.demoMode ? "var(--yellow)" : "var(--green)";
  const conn = $("#chip-conn");
  conn.textContent = s.demoMode ? "Đang phát demo" : s.connected ? "Đã kết nối TikTok" : "Chưa kết nối TikTok";
  conn.classList.toggle("chip-ok", s.demoMode || s.connected);
  conn.classList.toggle("chip-bad", !s.demoMode && !s.connected);
}

// ---------- feed ----------

function feedAdd(ev) {
  if (state.paused) return;
  if (ev.type === "viewer") return;

  const feed = $("#feed");
  const empty = feed.querySelector(".feed-empty");
  if (empty) empty.remove();

  const row = document.createElement("div");
  row.className = "feed-item";
  row.dataset.type = ev.type;
  if (state.filter !== "all" && ev.type !== state.filter) row.style.display = "none";

  const tag = document.createElement("span");
  tag.className = `feed-tag ${ev.type}`;
  tag.textContent = TAG_LABEL[ev.type] || ev.type;
  row.appendChild(tag);

  const time = document.createElement("span");
  time.className = "feed-time";
  time.textContent = fmtTime(ev.data.timestamp || Date.now());
  row.appendChild(time);

  const body = document.createElement("span");
  body.className = "feed-body";

  if (ev.type === "comment") {
    const user = document.createElement("span");
    user.className = "feed-user";
    user.textContent = ev.data.user.nickname;
    body.append(user, `: ${ev.data.content}`);
  } else if (ev.type === "gift") {
    const user = document.createElement("span");
    user.className = "feed-user";
    user.textContent = ev.data.user.nickname;
    body.append(user, ` tặng ${ev.data.giftName} x${ev.data.repeatCount} (${ev.data.diamondCount}💎)`);
  } else if (ev.type === "like") {
    const user = document.createElement("span");
    user.className = ev.data.user ? "feed-user" : "feed-user anon";
    user.textContent = ev.data.user ? ev.data.user.nickname : "(ẩn danh)";
    body.append(user, ` +${ev.data.count} tim`);
  } else if (ev.type === "follow") {
    const user = document.createElement("span");
    user.className = "feed-user";
    user.textContent = ev.data.user.nickname;
    body.append(user, " vừa follow");
  } else if (ev.type === "share") {
    const user = document.createElement("span");
    user.className = "feed-user";
    user.textContent = ev.data.user.nickname;
    body.append(user, " vừa chia sẻ");
  } else if (ev.type === "member") {
    const user = document.createElement("span");
    user.className = "feed-user";
    user.textContent = ev.data.user.nickname;
    body.append(user, ` vào live (${ev.data.memberCount} người xem)`);
  } else if (ev.type === "viewer") {
    body.textContent = `Người xem: ${ev.data.viewerCount}`;
  } else if (ev.type === "status") {
    body.textContent = ev.data.demoMode ? "Đang chạy demo mode" : ev.data.connected ? "Đã kết nối TikTok" : "Mất kết nối";
  } else {
    body.textContent = JSON.stringify(ev.data);
  }

  row.appendChild(body);
  feed.prepend(row);
  const items = feed.querySelectorAll(".feed-item");
  if (items.length > 300) items[items.length - 1].remove();
}

function applyFeedFilter() {
  const feed = $("#feed");
  let visible = 0;
  feed.querySelectorAll(".feed-item").forEach((item) => {
    const show = state.filter === "all" || item.dataset.type === state.filter;
    item.style.display = show ? "" : "none";
    if (show) visible++;
  });
  feed.querySelector(".feed-empty")?.remove();
  if (!visible) feed.insertAdjacentHTML("beforeend", '<div class="feed-empty">Chưa có sự kiện</div>');
}

document.querySelectorAll(".filter").forEach((f) => {
  f.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((x) => x.classList.toggle("active", x === f));
    state.filter = f.dataset.filter;
    applyFeedFilter();
  });
});

$("#feed-pause").addEventListener("click", (e) => {
  state.paused = !state.paused;
  e.currentTarget.textContent = state.paused ? "Tiếp tục" : "Tạm dừng";
});

$("#feed-clear").addEventListener("click", () => {
  $("#feed").innerHTML = '<div class="feed-empty">Chưa có sự kiện</div>';
});

// ---------- stats ----------

function updateStats(s) {
  state.stats = s;
  const chip = $("#chip-viewers");
  if (chip) chip.textContent = `👁 ${s.viewers ?? 0}`;
  document.querySelectorAll(".stat-num").forEach((el) => {
    const k = el.dataset.k;
    if (k === "sessionSeconds") el.textContent = fmtDur(s[k] || 0);
    else el.textContent = (s[k] ?? 0).toLocaleString("vi-VN");
  });

  const senderBody = $("#top-senders");
  senderBody.innerHTML = s.topSenders.length
    ? s.topSenders.map((u, i) => row(u, i, [u.giftCount, u.totalDiamonds])).join("")
    : '<tr><td colspan="4" class="hint">Chưa có dữ liệu</td></tr>';
  const likerBody = $("#top-likers");
  likerBody.innerHTML = s.topLikers.length
    ? s.topLikers.map((u, i) => `<tr><td>${i + 1}</td><td>${userCell(u)}</td><td>${u.likeCount.toLocaleString("vi-VN")}</td></tr>`).join("")
    : '<tr><td colspan="3" class="hint">Chưa có dữ liệu</td></tr>';

  const followBody = $("#recent-followers");
  followBody.innerHTML = (s.followers || []).length
    ? s.followers.map((f, i) => `<tr><td>${i + 1}</td><td>${userCell(f)}</td><td>${fmtTime(f.timestamp)}</td></tr>`).join("")
    : '<tr><td colspan="3" class="hint">Chưa có ai follow.</td></tr>';
}

function row(u, i, cells) {
  return `<tr><td>${i + 1}</td><td>${userCell(u)}</td>${cells.map((c) => `<td>${c.toLocaleString("vi-VN")}</td>`).join("")}</tr>`;
}

function userCell(u) {
  const avatar = u.avatarUrl ? `<img class="avatar" src="${u.avatarUrl}" alt="" />` : "";
  return `${avatar}${u.nickname} <span class="hint">@${u.uniqueId}</span>`;
}

$("#stats-reset").addEventListener("click", async () => {
  try {
    await api("/api/admin/stats/reset", { method: "POST" });
    toast("Đã reset thống kê.");
  } catch (ex) {
    toast(ex.message);
  }
});

// ---------- clients ----------

async function refreshClients() {
  try {
    const data = await api("/api/admin/clients");
    const body = $("#clients-body");
    $("#clients-count").textContent = data.clients.length;
    body.innerHTML = data.clients.length
      ? data.clients
          .map(
            (c) => `<tr>
              <td>#${c.id}</td>
              <td>${c.kind === "admin" ? "Quản trị" : "Game"}</td>
              <td>${c.ip}</td>
              <td>${fmtAgo(c.connectedAt)} trước</td>
              <td>${c.kind === "game" ? `<button class="btn btn-danger btn-sm" data-kick="${c.id}">Ngắt</button>` : ""}</td>
            </tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="hint">Chưa có client nào kết nối.</td></tr>';
    body.querySelectorAll("[data-kick]").forEach((btn) => {
      btn.addEventListener("click", () => kickClient(Number(btn.dataset.kick)));
    });
  } catch {
    /* mất quyền đã được xử lý trong api() */
  }
}

async function kickClient(id) {
  try {
    await api(`/api/admin/clients/${id}/kick`, { method: "POST" });
    toast(`Đã ngắt client #${id}.`);
    refreshClients();
  } catch (ex) {
    toast(ex.message);
  }
}

$("#clients-refresh").addEventListener("click", refreshClients);
setInterval(refreshClients, 5000);

// ---------- config ----------

async function loadConfigForm() {
  try {
    const c = await api("/api/admin/config");
    $("#cfg-username").value = c.username;
    $("#cfg-wstoken").value = c.wsToken;
    $("#cfg-demo").checked = c.demoMode;
    updateWsTokenNote(c.wsTokenEnabled);
    const pill = $("#cfg-wstoken-status");
    pill.textContent = c.wsTokenEnabled ? "đang bật" : "đang tắt";
    pill.classList.toggle("pill-on", Boolean(c.wsTokenEnabled));
    pill.classList.toggle("pill-off", !c.wsTokenEnabled);
  } catch {
    /* ignore */
  }
}

$("#config-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#config-msg");
  msg.classList.add("hidden");
  try {
    await api("/api/admin/config", {
      method: "POST",
      body: JSON.stringify({
        username: $("#cfg-username").value.trim(),
        wsToken: $("#cfg-wstoken").value.trim(),
        demoMode: $("#cfg-demo").checked,
      }),
    });
    msg.className = "config-msg ok";
    msg.textContent = "Đã lưu và áp dụng.";
    loadConfigForm();
  } catch (ex) {
    msg.className = "config-msg err";
    msg.textContent = ex.message;
  }
});

$("#cfg-reconnect").addEventListener("click", async () => {
  const msg = $("#config-msg");
  msg.classList.add("hidden");
  try {
    await api("/api/admin/reconnect", { method: "POST" });
    toast("Đang kết nối lại TikTok.");
  } catch (ex) {
    msg.className = "config-msg err";
    msg.textContent = ex.message;
  }
});

// ---------- game settings ----------

const GAME_ID = "saw-arena";

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o[keys[i]] = o[keys[i]] || {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function fillGameForm(config) {
  document.querySelectorAll("#game-config [data-path]").forEach((el) => {
    const val = getPath(config, el.dataset.path);
    if (val === undefined) return;
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val;
  });
}

function collectGameConfig() {
  const config = {};
  document.querySelectorAll("#game-config [data-path]").forEach((el) => {
    let val = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number") val = val === "" ? 0 : Number(val);
    setPath(config, el.dataset.path, val);
  });
  return config;
}

async function loadGameSettings() {
  try {
    const data = await api("/api/admin/games");
    const game = data.games.find((g) => g.id === GAME_ID);
    if (!game) return;
    $("#game-url").textContent = `${location.origin}${game.url}`;
    fillGameForm(game.config);
  } catch {
    /* ignore */
  }
}

$("#game-save").addEventListener("click", async () => {
  try {
    await api(`/api/admin/games/${GAME_ID}/config`, {
      method: "PUT",
      body: JSON.stringify(collectGameConfig()),
    });
    toast("Đã lưu cài đặt game.");
  } catch (ex) {
    toast(ex.message);
  }
});

$("#game-reset").addEventListener("click", async () => {
  if (!confirm("Khôi phục toàn bộ cài đặt game về mặc định?")) return;
  try {
    const res = await api(`/api/admin/games/${GAME_ID}/reset`, { method: "POST" });
    fillGameForm(res.config);
    toast("Đã khôi phục mặc định.");
  } catch (ex) {
    toast(ex.message);
  }
});

// ---------- boot ----------

(async function init() {
  try {
    await api("/api/admin/config");
    showApp();
  } catch {
    showLogin();
  }
})();
