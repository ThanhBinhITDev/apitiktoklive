(() => {
  const chatLayer = document.getElementById("chat-layer");
  const giftLayer = document.getElementById("gift-layer");
  const likeLayer = document.getElementById("like-layer");
  const tapperLabel = document.getElementById("tapper-label");
  const notificationLayer = document.getElementById("notification-layer");
  const statusBar = document.getElementById("status-bar");
  const statusText = document.getElementById("status-text");

  const CHAT_VISIBLE_MS = 8000;
  const GIFT_VISIBLE_MS = 4000;
  const NOTIFY_VISIBLE_MS = 3500;
  const MAX_CHAT_ITEMS = 12;
  const MAX_GIFT_ITEMS = 3;
  const MAX_HEARTS = 30;

  if (new URLSearchParams(location.search).get("bg") === "dark") {
    document.body.classList.add("bg-dark");
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      setStatus("connecting", "Đang kết nối TikTok...");
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = () => {
      setStatus("disconnected", "Mất kết nối - đang thử lại...");
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }

  function handleMessage(msg) {
    if (msg.type === "tiktok") {
      handleEvent(msg.payload);
    }
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "comment":
        addChat(ev.data);
        break;
      case "gift":
        addGift(ev.data);
        break;
      case "like":
        spawnHearts(ev.data);
        break;
      case "follow":
        addNotification(ev.data.user, "Đã theo dõi", "💙");
        break;
      case "share":
        addNotification(ev.data.user, "Đã chia sẻ", "🔄");
        break;
      case "member":
        addNotification(ev.data.user, "Đã tham gia live", "👋");
        break;
      case "status":
        handleStatus(ev.data);
        break;
    }
  }

  function handleStatus(data) {
    if (data.connected) {
      setStatus("connected", `Đang xem live @${data.username}`);
    } else {
      setStatus("connecting", "Đang kết nối TikTok...");
    }
  }

  function setStatus(state, text) {
    statusBar.hidden = false;
    statusBar.classList.remove("connected", "disconnected", "connecting");
    statusBar.classList.add(state);
    statusText.textContent = text;
  }

  // ---------- Chat ----------
  function addChat({ user, content }) {
    const item = document.createElement("div");
    item.className = "chat-item";

    const avatar = document.createElement("img");
    avatar.className = "chat-avatar";
    avatar.src = user.avatarUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23333'/%3E%3C/svg%3E";

    const body = document.createElement("div");
    body.className = "chat-body";

    const name = document.createElement("div");
    name.className = "chat-user";
    name.textContent = user.nickname || user.uniqueId;

    const text = document.createElement("div");
    text.className = "chat-text";
    text.textContent = content;

    body.append(name, text);
    item.append(avatar, body);
    chatLayer.appendChild(item);

    while (chatLayer.children.length > MAX_CHAT_ITEMS) {
      chatLayer.firstChild.remove();
    }

    setTimeout(() => {
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 600);
    }, CHAT_VISIBLE_MS);
  }

  // ---------- Gift ----------
  function addGift({ user, giftName, repeatCount, diamondCount, imageUrl }) {
    while (giftLayer.children.length >= MAX_GIFT_ITEMS) {
      giftLayer.firstChild.remove();
    }

    const item = document.createElement("div");
    item.className = "gift-item";

    const iconWrap = document.createElement("div");
    iconWrap.className = "gift-icon-wrap";
    const icon = document.createElement("img");
    icon.className = "gift-icon";
    icon.src =
      imageUrl ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 24 24'%3E%3Ctext y='20' font-size='20'%3E%F0%9F%8E%81%3C/text%3E%3C/svg%3E";
    iconWrap.appendChild(icon);

    const info = document.createElement("div");
    const nameLine = document.createElement("div");
    nameLine.className = "gift-name";
    nameLine.textContent = giftName;

    const userLine = document.createElement("div");
    userLine.className = "gift-user";
    userLine.textContent = user.nickname || user.uniqueId;

    const diamonds = document.createElement("div");
    diamonds.className = "gift-diamonds";
    diamonds.textContent = diamondCount > 0 ? `◆ ${diamondCount.toLocaleString()} diamonds` : "";

    info.append(nameLine, userLine, diamonds);

    const count = document.createElement("div");
    count.className = "gift-count";
    count.textContent = `x${repeatCount}`;

    item.append(iconWrap, info, count);
    giftLayer.appendChild(item);

    setTimeout(() => {
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 500);
    }, GIFT_VISIBLE_MS);
  }

  // ---------- Likes / hearts ----------
  let lastTapperShown = 0;
  let tapperTimer = null;

  function showTapper(user) {
    if (!user) return;
    const now = Date.now();
    if (now - lastTapperShown < 1500) return;
    lastTapperShown = now;

    tapperLabel.textContent = `${user.nickname || user.uniqueId} ❤️`;
    tapperLabel.hidden = false;
    clearTimeout(tapperTimer);
    tapperTimer = setTimeout(() => {
      tapperLabel.hidden = true;
    }, 1600);
  }

  function spawnHearts(ev) {
    showTapper(ev.user);
    const count = ev.count ?? 1;
    const n = Math.min(count, 8);
    for (let i = 0; i < n; i++) {
      const heart = document.createElement("div");
      heart.className = "heart";
      heart.textContent = ["❤️", "💖", "💕", "💗", "💓"][Math.floor(Math.random() * 5)];
      heart.style.left = `${10 + Math.random() * 80}%`;
      heart.style.fontSize = `${22 + Math.random() * 24}px`;
      heart.style.animationDuration = `${1400 + Math.random() * 800}ms`;
      heart.style.animationDelay = `${Math.random() * 300}ms`;
      likeLayer.appendChild(heart);

      while (likeLayer.children.length > MAX_HEARTS) {
        likeLayer.firstChild.remove();
      }

      setTimeout(() => heart.remove(), 2600);
    }
  }

  // ---------- Notifications ----------
  function addNotification(user, action, emoji) {
    while (notificationLayer.children.length > 5) {
      notificationLayer.firstChild.remove();
    }

    const item = document.createElement("div");
    item.className = "notification-item";

    const avatar = document.createElement("img");
    avatar.className = "notification-avatar";
    avatar.src = user.avatarUrl || "";

    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = ` ${user.nickname || user.uniqueId} `;
    text.append(` ${emoji} `, strong, action);

    item.append(avatar, text);
    notificationLayer.appendChild(item);

    setTimeout(() => {
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 450);
    }, NOTIFY_VISIBLE_MS);
  }

  connect();
})();
