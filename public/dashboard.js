(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot: $("dash-status-dot"),
    statusText: $("dash-status-text"),
    username: $("username-input"),
    commands: $("commands-input"),
    giftCommands: $("giftcommands-input"),
    cooldown: $("cooldown-input"),
    roomId: $("room-id"),
    configMsg: $("config-msg"),
    statViewers: $("stat-viewers"),
    statComments: $("stat-comments"),
    statLikes: $("stat-likes"),
    statGifts: $("stat-gifts"),
    statDiamonds: $("stat-diamonds"),
    statDuration: $("stat-duration"),
    topSenders: $("top-senders-body"),
    topLikers: $("top-likers-body"),
    recentFeed: $("recent-feed"),
    commandFeed: $("command-feed"),
  };

  let statsTimer = null;

  function setStatus(state, text) {
    els.statusDot.className = "dash-dot " + state;
    els.statusText.textContent = text;
  }

  function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }

  function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function renderStats(payload) {
    els.statViewers.textContent = formatNumber(payload.viewers ?? 0);
    els.statComments.textContent = formatNumber(payload.comments ?? 0);
    els.statLikes.textContent = formatNumber(payload.likes ?? 0);
    els.statGifts.textContent = formatNumber(payload.gifts ?? 0);
    els.statDiamonds.textContent = formatNumber(payload.totalDiamonds ?? 0);
    els.statDuration.textContent = formatDuration(payload.sessionSeconds ?? 0);

    const senders = payload.topSenders ?? [];
    els.topSenders.innerHTML = "";
    if (senders.length === 0) {
      els.topSenders.innerHTML = '<tr><td colspan="4" class="dash-empty">Chưa có dữ liệu</td></tr>';
    } else {
      senders.forEach((s, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td class="dash-user-cell">
            <img class="dash-avatar" src="${s.avatarUrl || ""}" alt="" />
            <span>${escapeHtml(s.nickname || s.uniqueId)}</span>
          </td>
          <td>${formatNumber(s.totalDiamonds)} 💎</td>
          <td>${s.giftCount}</td>`;
        els.topSenders.appendChild(tr);
      });
    }

    const likers = payload.topLikers ?? [];
    els.topLikers.innerHTML = "";
    if (likers.length === 0) {
      els.topLikers.innerHTML = '<tr><td colspan="3" class="dash-empty">Chưa có dữ liệu</td></tr>';
    } else {
      likers.forEach((s, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td class="dash-user-cell">
            <img class="dash-avatar" src="${s.avatarUrl || ""}" alt="" />
            <span>${escapeHtml(s.nickname || s.uniqueId)}</span>
          </td>
          <td>${formatNumber(s.likeCount)} ❤️</td>`;
        els.topLikers.appendChild(tr);
      });
    }

    const events = payload.recentEvents ?? [];
    els.recentFeed.innerHTML = "";
    if (events.length === 0) {
      els.recentFeed.innerHTML = '<li class="dash-empty">Chưa có sự kiện</li>';
    } else {
      events.forEach((e) => {
        const li = document.createElement("li");
        if (e.type === "comment") {
          li.innerHTML = `<span class="feed-tag feed-cmt">💬</span> <strong>${escapeHtml(e.user.nickname || e.user.uniqueId)}</strong>: ${escapeHtml(e.content ?? "")}`;
        } else {
          li.innerHTML = `<span class="feed-tag feed-gift">🎁</span> <strong>${escapeHtml(e.user.nickname || e.user.uniqueId)}</strong> tặng <strong>${escapeHtml(e.giftName ?? "")}</strong> x${e.repeatCount ?? 1} (${e.diamondCount ?? 0}💎) <span class="dash-giftid">#${escapeHtml(e.giftId ?? "")}</span>`;
        }
        els.recentFeed.appendChild(li);
      });
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function handleTiktok(payload) {
    if (payload.type === "status") {
      if (payload.data.connected) {
        setStatus("connected", `Đang kết nối @${payload.data.username}`);
        els.roomId.textContent = payload.data.roomId ?? "-";
      } else {
        setStatus("connecting", "Đang kết nối TikTok...");
        els.roomId.textContent = "-";
      }
    }
  }

  const MAX_COMMAND_ITEMS = 20;
  function addCommand(payload) {
    if (els.commandFeed.querySelector(".dash-empty")) els.commandFeed.innerHTML = "";
    const li = document.createElement("li");
    li.innerHTML = `<span class="feed-tag">⚡</span> <strong>${escapeHtml(payload.key)}</strong> - <strong>${escapeHtml(payload.user.nickname || payload.user.uniqueId)}</strong>` +
      (payload.giftName ? ` - 🎁 ${escapeHtml(payload.giftName)} x${payload.repeatCount ?? 1} (${payload.diamondCount ?? 0}💎) <span class="dash-giftid">#${escapeHtml(payload.giftId ?? "")}</span>` : "");
    els.commandFeed.prepend(li);
    while (els.commandFeed.children.length > MAX_COMMAND_ITEMS) {
      els.commandFeed.removeChild(els.commandFeed.lastChild);
    }
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "tiktok") handleTiktok(msg.payload);
      if (msg.type === "stats") renderStats(msg.payload);
      if (msg.type === "command") addCommand(msg.payload);
    };

    ws.onclose = () => {
      setStatus("disconnected", "Mất kết nối - đang thử lại...");
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    const data = await res.json();
    els.username.value = data.username ?? "";
    els.commands.value = Array.isArray(data.commands) ? data.commands.join(", ") : "";
    els.giftCommands.value = Array.isArray(data.giftCommands) ? data.giftCommands.join(", ") : "";
    els.cooldown.value = data.commandCooldownMs ?? 3000;
    els.roomId.textContent = data.roomId ?? "-";
    if (data.connected) setStatus("connected", `Đang kết nối @${data.username}`);
    else setStatus("connecting", "Đang kết nối TikTok...");
  }

  document.getElementById("config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-btn");
    btn.disabled = true;
    btn.textContent = "Đang lưu...";
    els.configMsg.className = "dash-msg";
    els.configMsg.textContent = "";
    try {
      const commands = els.commands.value.split(",").map((s) => s.trim()).filter(Boolean);
      const giftCommands = els.giftCommands.value.split(",").map((s) => s.trim()).filter(Boolean);
      const commandCooldownMs = Math.max(0, Number(els.cooldown.value) || 0);
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: els.username.value.trim(), commands, giftCommands, commandCooldownMs }),
      });
      const data = await res.json();
      if (res.ok) {
        els.configMsg.className = "dash-msg ok";
        els.configMsg.textContent = `Đã lưu @${data.username} (${data.commands.length} lệnh, ${data.giftCommands.length} quà, cooldown ${data.commandCooldownMs}ms). Đang kết nối lại...`;
        setStatus("connecting", "Đang kết nối lại...");
      } else {
        els.configMsg.className = "dash-msg error";
        els.configMsg.textContent = data.error || "Đã xảy ra lỗi.";
      }
    } catch {
      els.configMsg.className = "dash-msg error";
      els.configMsg.textContent = "Không kết nối được server.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Lưu";
    }
  });

  loadConfig();
  connect();

  document.getElementById("reset-stats-btn").addEventListener("click", async () => {
    try {
      await fetch("/api/stats/reset", { method: "POST" });
    } catch {
      /* stats sẽ tự cập nhật qua WS */
    }
  });
})();
