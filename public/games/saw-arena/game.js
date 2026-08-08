"use strict";

const GAME_ID = "saw-arena";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const el = {
  pill: document.getElementById("pill"),
  pillText: document.getElementById("pill-text"),
  count: document.getElementById("count"),
  hint: document.getElementById("hint"),
  round: document.getElementById("round"),
  banner: document.getElementById("banner"),
  feed: document.getElementById("feed"),
};

/* ---------- utils ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
};
const now = () => performance.now();

/* ---------- state ---------- */
let cfg = null;
const players = new Map();
let bullets = [];
let bolts = [];
let floaters = [];
let sparks = [];
let round = { phase: "waiting", number: 0, start: 0, end: 0, countdown: 0, joined: 0 };
let announce = null;
let lastT = now();
let lastLabelTick = 0;

const TIER_ORDER = [
  { key: "white", color: "#e2e8f0" },
  { key: "green", color: "#22c55e" },
  { key: "yellow", color: "#f59e0b" },
  { key: "red", color: "#ef4444" },
];
const TIER_INDEX = { white: 1, green: 2, yellow: 3, red: 4 };
const TIER_CFG = ["", "sawWhite", "sawGreen", "sawYellow", "sawRed"];
const STORM_RANGE = 180;
const BULLET_LIFE_MS = 1800;

let view = { scale: 1, cssW: 0, cssH: 0, w: 1920, h: 1080, baseW: 1920, baseH: 1080, ox: 0, oy: 0, fieldW: 0, fieldH: 0 };

function bounds() {
  return { hw: view.w / 2, hh: view.h / 2 };
}

/* ---------- layout / resize ---------- */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.floor(innerWidth));
  const H = Math.max(1, Math.floor(innerHeight));
  view.cssW = W;
  view.cssH = H;
  if (cfg && cfg.viewport.adaptive) {
    const aspect = clamp(W / H, 0.4, 3.0);
    const area = view.baseW * view.baseH;
    view.h = Math.sqrt(area / aspect);
    view.w = view.h * aspect;
  } else {
    view.w = view.baseW;
    view.h = view.baseH;
  }
  view.scale = Math.min(W / view.w, H / view.h);
  view.fieldW = view.w * view.scale;
  view.fieldH = view.h * view.scale;
  view.ox = (W - view.fieldW) / 2;
  view.oy = (H - view.fieldH) / 2;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  positionHud();
  for (const p of players.values()) keepInside(p);
}
window.addEventListener("resize", resize);

const sx = (x) => view.ox + (x + view.w / 2) * view.scale;
const sy = (y) => view.oy + (y + view.h / 2) * view.scale;
const ssz = (v) => v * view.scale;

function positionHud() {
  const { cssW, cssH, ox, oy, fieldW, fieldH } = view;
  const right = cssW - ox - fieldW;
  const bottom = cssH - oy - fieldH;
  el.pill.style.left = ox + 14 + "px";
  el.pill.style.top = oy + 14 + "px";
  el.count.style.right = right + 14 + "px";
  el.count.style.top = oy + 14 + "px";
  el.round.style.left = ox + fieldW / 2 + "px";
  el.round.style.transform = "translateX(-50%)";
  el.round.style.top = oy + 14 + "px";
  el.hint.style.left = ox + fieldW / 2 + "px";
  el.hint.style.transform = "translateX(-50%)";
  el.hint.style.bottom = bottom + 26 + "px";
  el.feed.style.right = right + 14 + "px";
  el.feed.style.bottom = bottom + 14 + "px";
  el.banner.style.left = ox + fieldW / 2 + "px";
  el.banner.style.top = oy + fieldH * 0.32 + "px";
  el.banner.style.transform = "translate(-50%, -50%)";
}

/* ---------- sizing / boundaries ---------- */
function drawRadius(p) {
  const sizeMin = cfg.misc.sizeMin ?? 22;
  const sizeMax = cfg.misc.sizeMax ?? 34;
  const base = cfg.join.defaultHp;
  const full = cfg.misc.sizeFullScore ?? 800;
  const f = clamp((p.hp - base) / (full - base), 0, 1);
  return sizeMin + (sizeMax - sizeMin) * f;
}
function margin(p) {
  return drawRadius(p) * 1.6 + 14;
}
function keepInside(p) {
  if (!cfg) return;
  const { hw, hh } = bounds();
  const m = margin(p);
  p.x = m >= hw ? 0 : clamp(p.x, -hw + m, hw - m);
  p.y = m >= hh ? 0 : clamp(p.y, -hh + m, hh - m);
}

/* ---------- DOM updates ---------- */
function setPill(state, text) {
  el.pill.className = "pill " + state;
  el.pillText.textContent = text;
}
function updateCount() {
  let alive = 0;
  for (const p of players.values()) if (p.alive) alive++;
  el.count.textContent = alive > 0 ? `👥 ${alive}` : "👥 0";
}
function updateRoundLabel() {
  const r = el.round;
  if (round.phase === "playing") {
    const left = Math.max(0, Math.ceil((round.end - now()) / 1000));
    r.textContent = `🕐 ${left}s · Vòng ${round.number}`;
    r.classList.remove("hidden");
  } else if (round.phase === "ending") {
    const left = Math.max(0, Math.ceil(round.countdown));
    r.textContent = `🔁 Vòng mới sau ${left}s`;
    r.classList.remove("hidden");
  } else {
    r.classList.add("hidden");
  }
}
function setBanner(title, sub, ms) {
  announce = { title, sub, until: now() + ms };
}
function pushFeed(user, text, color) {
  const feed = el.feed;
  while (feed.childElementCount >= 6) feed.lastElementChild?.remove();
  const div = document.createElement("div");
  div.className = "feed-item";
  if (user && user.avatarUrl) {
    const img = document.createElement("img");
    img.src = user.avatarUrl;
    img.onerror = () => img.remove();
    div.appendChild(img);
  }
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = user && user.nickname ? user.nickname : "?";
  if (color) n.style.color = color;
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = text;
  div.appendChild(n);
  div.appendChild(t);
  feed.prepend(div);
  setTimeout(() => div.remove(), 4200);
}

/* ---------- players ---------- */
function spawnPlayer(user) {
  const { hw, hh } = bounds();
  const p = {
    id: user.uniqueId,
    nickname: user.nickname || user.uniqueId || "?",
    avatarUrl: user.avatarUrl || "",
    img: null,
    x: rand(-hw, hw),
    y: rand(-hh, hh),
    vx: 0,
    vy: 0,
    heading: rand(0, Math.PI * 2),
    headingUntil: 0,
    hp: cfg.join.defaultHp,
    maxHp: cfg.join.defaultHp,
    alive: true,
    taps: 0,
    saws: {},
    gunUntil: 0,
    lightningUntil: 0,
    stormUntil: 0,
    lastSawTick: 0,
    lastLightning: 0,
    lastStormTick: 0,
    lastShot: 0,
    hunting: false,
    modeUntil: 0,
    huntAimUntil: 0,
    phase: rand(0, Math.PI * 2),
    aim: rand(0, Math.PI * 2),
    kills: 0,
    dmg: 0,
    flashUntil: 0,
    sawFlash: 0,
  };
  if (user.avatarUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => (p.img = img);
    img.src = user.avatarUrl;
  }
  players.set(p.id, p);
  keepInside(p);
  round.joined++;
  updateCount();
  if (round.phase === "waiting") startRound();
}
function aliveCount() {
  let n = 0;
  for (const p of players.values()) if (p.alive) n++;
  return n;
}
function effectiveTier(p, t) {
  let tier = 0;
  for (const s of TIER_ORDER) if ((p.saws[s.key] || 0) > t) tier = TIER_INDEX[s.key];
  return tier;
}
function activateSaw(p, key) {
  const short = key.replace("saw", "").toLowerCase();
  p.saws[short] = now() + cfg[key].durationSec * 1000;
  p.sawFlash = now();
}
function fmtHeal(n) {
  return n >= 1 ? String(Math.round(n)) : n.toFixed(1);
}
function spawnFloater(x, y, text, color) {
  floaters.push({ x, y, vy: -46, text, color, born: now(), life: 800 });
  if (floaters.length > 80) floaters.splice(0, floaters.length - 80);
}
function spawnSpark(x, y, color) {
  sparks.push({ x, y, vx: rand(-70, 70), vy: rand(-70, 70), color, born: now(), life: 300 });
  if (sparks.length > 120) sparks.splice(0, sparks.length - 120);
}
function damagePlayer(p, amount, src) {
  if (!p.alive) return;
  p.hp -= amount;
  p.flashUntil = now() + 150;
  if (src && src !== p) {
    src.dmg += amount;
    spawnFloater(p.x, p.y - drawRadius(p) - 8, "-" + Math.round(amount), "#ff5d73");
  }
  if (p.hp <= 0) killPlayer(p, src);
}
function stealHp(src, dmg, bonusPct) {
  if (!src.alive) return;
  const gain = dmg * ((cfg.misc.stealPct ?? 100) + (bonusPct || 0)) / 100;
  if (gain <= 0) return;
  src.hp += gain;
  spawnFloater(src.x, src.y - drawRadius(src) - 8, "+" + fmtHeal(gain), "#3ddc84");
}
function killPlayer(p, src) {
  p.alive = false;
  p.hp = 0;
  players.delete(p.id);
  if (src) {
    src.kills++;
    pushFeed({ nickname: p.nickname, avatarUrl: p.avatarUrl }, `💀 bị ${src.nickname} tiêu diệt`, "#ff5d73");
  } else {
    pushFeed({ nickname: p.nickname, avatarUrl: p.avatarUrl }, "💀 bị loại", "#ff5d73");
  }
  updateCount();
  checkEndRound();
}
function nearestEnemy(p) {
  let best = null, bd = Infinity;
  for (const e of players.values()) {
    if (!e.alive || e === p) continue;
    const d = dist2(p, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/* ---------- events ---------- */
function handleComment(d) {
  const kw = (cfg.join.keyword || "").trim().toLowerCase();
  const content = (d.content || "").trim().toLowerCase();
  const isJoin = kw ? content === kw : true;
  pushFeed(d.user, isJoin ? "⚔️ vào trận" : d.content, isJoin ? "#4cc9f0" : "#8b97ab");
  if (!isJoin) return;
  if (aliveCount() >= cfg.join.maxPlayers) return;
  if (round.phase === "ending") return;
  spawnPlayer(d.user);
}
function handleLike(d) {
  if (!d.user) return;
  const p = players.get(d.user.uniqueId);
  if (!p || !p.alive) return;
  p.taps += d.count || 1;
  if (p.taps >= cfg.sawWhite.requireTaps) {
    p.taps = 0;
    activateSaw(p, "sawWhite");
    pushFeed(p, "🪚 Răng cưa trắng!", "#e2e8f0");
  }
}
function handleFollow(d) {
  const p = players.get(d.user.uniqueId);
  if (!p || !p.alive) return;
  activateSaw(p, "sawGreen");
  pushFeed(p, "🌿 Răng cưa xanh!", "#22c55e");
}
function handleShare(d) {
  handleFollow(d);
}
function handleGift(d) {
  const p = players.get(d.user.uniqueId);
  if (!p || !p.alive) return;
  const diam = (d.diamondCount || 0) * (d.repeatCount || 1);
  let msg = null, color = null;
  if (diam >= 1) { activateSaw(p, "sawYellow"); msg = "🟡 Răng cưa vàng!"; color = "#f59e0b"; }
  if (diam >= 5) { activateSaw(p, "sawRed"); msg = "🔴 Răng cưa đỏ!"; color = "#ef4444"; }
  if (diam >= 10) { p.gunUntil = now() + cfg.gun.durationSec * 1000; msg = "🔫 Súng!"; color = "#ffd166"; }
  if (diam >= 15) { p.lightningUntil = now() + cfg.lightning.durationSec * 1000; msg = "⚡ Sấm sét!"; color = "#e0aaff"; }
  if (diam >= 20) { p.stormUntil = now() + cfg.storm.durationSec * 1000; msg = "🌪️ Bão đạn + hút máu!"; color = "#8b9cf6"; }
  if (msg) pushFeed(p, msg, color);
}
function onEvent(ev) {
  switch (ev.type) {
    case "comment": handleComment(ev.data); break;
    case "like": handleLike(ev.data); break;
    case "follow": handleFollow(ev.data); break;
    case "share": handleShare(ev.data); break;
    case "gift": handleGift(ev.data); break;
    case "status":
      if (ev.data.connected) setPill("connected", ev.data.username || "Đang live");
      else setPill("offline", ev.data.connected === false ? "Chưa kết nối live" : "Sẵn sàng");
      break;
  }
}

/* ---------- round flow ---------- */
function startRound() {
  round.phase = "playing";
  round.number++;
  round.start = now();
  round.end = cfg.arena.roundDurationSec > 0 ? round.start + cfg.arena.roundDurationSec * 1000 : Infinity;
  round.joined = aliveCount();
  setBanner(`VÒNG ${round.number}`, "💬 Comment để vào trận!", 2200);
  updateRoundLabel();
}
function checkEndRound() {
  if (round.phase !== "playing" || round.joined < 2) return;
  const alive = [...players.values()].filter((p) => p.alive);
  if (alive.length <= 1) endRound(alive[0] || null);
}
function endRound(winner) {
  round.phase = "ending";
  round.countdown = cfg.arena.resetCountdownSec;
  bullets = [];
  bolts = [];
  if (winner) {
    setBanner(`🏆 ${winner.nickname} THẮNG!`, `${winner.kills} hạ gục · ${Math.round(winner.dmg)} sát thương`, 2400);
  } else {
    setBanner("HÒA VỐN 💤", "Không ai sống sót…", 2000);
  }
  updateRoundLabel();
}
function resetArena() {
  players.clear();
  bullets = [];
  bolts = [];
  floaters = [];
  sparks = [];
  round.phase = "waiting";
  round.countdown = 0;
  updateCount();
  updateRoundLabel();
}

/* ---------- simulation ---------- */
function movePlayer(p, dt) {
  if (!p.alive) return;
  const t = now();
  const scent = cfg.misc.scentRange ?? 340;
  let desired = p.heading;
  if (t >= p.modeUntil) {
    const target = nearestEnemy(p);
    const hunt = aliveCount() > 1 && target && dist2(p, target) <= scent * scent && Math.random() < 0.35;
    p.hunting = hunt;
    if (hunt) {
      p.modeUntil = t + rand(1000, 2200);
      p.huntAimUntil = 0;
    } else {
      p.headingUntil = 0;
      p.modeUntil = t + rand(3000, 5000);
    }
  }
  if (p.hunting) {
    if (t >= p.huntAimUntil) {
      const target = nearestEnemy(p);
      if (target) desired = Math.atan2(target.y - p.y, target.x - p.x);
      p.huntAimUntil = t + rand(280, 520);
    }
    desired += Math.sin(t / 220 + p.phase) * 0.7 + rand(-0.35, 0.35);
  } else if (t >= p.headingUntil) {
    desired = rand(0, Math.PI * 2);
    p.headingUntil = t + rand(500, 1600);
  }
  p.heading = desired;
  const sp = cfg.arena.movementSpeed;
  p.vx += (Math.cos(p.heading) * sp - p.vx) * 0.04;
  p.vy += (Math.sin(p.heading) * sp - p.vy) * 0.04;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const { hw, hh } = bounds();
  const mx = Math.min(margin(p), hw);
  const my = Math.min(margin(p), hh);
  if (p.x < -hw + mx) { p.x = -hw + mx; p.vx = Math.abs(p.vx); p.heading = Math.atan2(p.vy, p.vx); }
  else if (p.x > hw - mx) { p.x = hw - mx; p.vx = -Math.abs(p.vx); p.heading = Math.atan2(p.vy, p.vx); }
  if (p.y < -hh + my) { p.y = -hh + my; p.vy = Math.abs(p.vy); p.heading = Math.atan2(p.vy, p.vx); }
  else if (p.y > hh - my) { p.y = hh - my; p.vy = -Math.abs(p.vy); p.heading = Math.atan2(p.vy, p.vx); }
}

function separate() {
  const arr = [];
  for (const p of players.values()) if (p.alive) arr.push(p);
  const overlapPct = (cfg.misc.overlapPct ?? 30) / 100;
  const bounce = (cfg.misc.bounce ?? 25) / 100;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const rsum = drawRadius(a) + drawRadius(b);
      const minD = rsum * (1 - overlapPct);
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d, ny = dy / d;
      const push = (minD - d) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const jimp = -(1 + bounce) * vn * 0.5;
        a.vx += nx * jimp; a.vy += ny * jimp;
        b.vx -= nx * jimp; b.vy -= ny * jimp;
      }
    }
  }
  for (const p of arr) keepInside(p);
}

function combatTick(p, t) {
  const tier = effectiveTier(p, t);
  if (tier === 0) return;
  const tick = cfg.misc.damageTickMs;
  if (t < p.lastSawTick) return;
  p.lastSawTick = t + tick;
  const dps = cfg[TIER_CFG[tier]].dps;
  const reach = cfg.misc.sawRadius * 2;
  for (const b of players.values()) {
    if (!b.alive || b === p) continue;
    if (dist2(p, b) > reach * reach) continue;
    const dmg = dps * (tick / 1000);
    damagePlayer(b, dmg, p);
    spawnSpark(b.x, b.y, TIER_ORDER[tier - 1].color);
    stealHp(p, dmg, cfg.misc.sawLifestealPct ?? 0);
  }
}

function shoot(p, t) {
  if (!p.alive || p.gunUntil <= t) return;
  if (t < p.lastShot + cfg.gun.fireRateMs) return;
  const target = nearestEnemy(p);
  if (!target) return;
  p.aim = Math.atan2(target.y - p.y, target.x - p.x);
  p.lastShot = t;
  bullets.push({
    x: p.x, y: p.y,
    vx: Math.cos(p.aim) * cfg.gun.bulletSpeed,
    vy: Math.sin(p.aim) * cfg.gun.bulletSpeed,
    owner: p,
    r: 5,
  });
}

function strike(p, t) {
  if (!p.alive || p.lightningUntil <= t) return;
  if (t < p.lastLightning + cfg.lightning.cooldownMs) return;
  const target = nearestEnemy(p);
  if (!target) return;
  const r = cfg.lightning.radius;
  if (dist2(p, target) > r * r) return;
  p.lastLightning = t;
  damagePlayer(target, cfg.lightning.damage, p);
  stealHp(p, cfg.lightning.damage, 0);
  bolts.push({ ax: p.x, ay: p.y, bx: target.x, by: target.y, at: t });
}

function storm(p, t) {
  if (!p.alive || p.stormUntil <= t) return;
  if (t < p.lastStormTick + cfg.storm.fireRateMs) return;
  p.lastStormTick = t;
  const reach = STORM_RANGE + cfg.misc.playerRadius;
  for (const e of players.values()) {
    if (!e.alive || e === p) continue;
    if (dist2(p, e) > reach * reach) continue;
    const dmg = cfg.storm.damagePerShot;
    damagePlayer(e, dmg, p);
    stealHp(p, dmg, cfg.storm.lifestealPct ?? 0);
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life = (b.life || 0) + dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const { hw, hh } = bounds();
    if (b.life > BULLET_LIFE_MS / 1000 || Math.abs(b.x) > hw || Math.abs(b.y) > hh) {
      bullets.splice(i, 1);
      continue;
    }
    let hit = false;
    const rr = cfg.misc.playerRadius + b.r;
    for (const p of players.values()) {
      if (!p.alive || p === b.owner) continue;
      if (dist2(b, p) <= rr * rr) {
        damagePlayer(p, cfg.gun.damagePerShot, b.owner);
        stealHp(b.owner, cfg.gun.damagePerShot, 0);
        hit = true;
        break;
      }
    }
    if (hit) bullets.splice(i, 1);
  }
}

function update(dt, t) {
  if (round.phase === "playing") {
    if (t >= round.end) {
      const alive = [...players.values()].filter((p) => p.alive);
      const winner = alive.length ? alive.reduce((a, b) => (b.hp > a.hp ? b : a)) : null;
      endRound(winner);
    } else {
      for (const p of players.values()) {
        combatTick(p, t);
        shoot(p, t);
        strike(p, t);
        storm(p, t);
      }
      updateBullets(dt);
    }
  } else if (round.phase === "ending") {
    round.countdown -= dt;
    updateRoundLabel();
    if (round.countdown <= 0) resetArena();
  }
  for (const p of players.values()) movePlayer(p, dt);
  separate();
  for (let i = bolts.length - 1; i >= 0; i--) {
    if (t - bolts[i].at > 160) bolts.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y += f.vy * dt;
    if (t - f.born > f.life) floaters.splice(i, 1);
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (t - s.born > s.life) sparks.splice(i, 1);
  }
  if (t - lastLabelTick > 500) {
    lastLabelTick = t;
    updateRoundLabel();
    updateCount();
  }
  if (announce && t >= announce.until) {
    announce = null;
    el.banner.classList.add("hidden");
  }
}

/* ---------- rendering ---------- */
function drawArena() {
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(0, 0, view.cssW, view.cssH);

  const cx = view.ox + view.fieldW / 2;
  const cy = view.oy + view.fieldH / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(view.fieldW, view.fieldH) * 0.55);
  g.addColorStop(0, "rgba(76, 201, 240, 0.05)");
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(view.ox, view.oy, view.fieldW, view.fieldH);
}

function drawSawRing(cx, cy, R, inner, color, rot, glow) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();
  const depth = R * 0.28;
  const teeth = 18;
  const half = Math.PI / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - half) * R, Math.sin(a - half) * R);
    ctx.lineTo(Math.cos(a + half) * R, Math.sin(a + half) * R);
    ctx.lineTo(Math.cos(a) * (R + depth), Math.sin(a) * (R + depth));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(p, t) {
  const x = sx(p.x), y = sy(p.y);
  const r = drawRadius(p);
  const tier = effectiveTier(p, t);
  const tierColor = tier > 0 ? TIER_ORDER[tier - 1].color : null;

  if (tier > 0) {
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 2.4);
    g.addColorStop(0, tierColor + "33");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (p.gunUntil > t) {
    ctx.strokeStyle = "rgba(255, 209, 102, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(p.aim) * (r + 22), y + Math.sin(p.aim) * (r + 22));
    ctx.stroke();
  }
  if (p.stormUntil > t) {
    ctx.strokeStyle = "rgba(139, 156, 246, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r + 14 + Math.sin(t / 150) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const flash = t < p.flashUntil;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = flash ? "#ff5d73" : "#2a3345";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = tierColor || "#3b4559";
  ctx.stroke();

  if (p.img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(p.img, x - r + 2, y - r + 2, (r - 2) * 2, (r - 2) * 2);
    ctx.restore();
  }

  const mode = cfg.misc.displayMode || "names";
  const disp = Math.max(0, Math.round(p.hp));
  const fs = Math.max(11, r * 0.62);
  ctx.font = `800 ${fs}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(3, fs / 4);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(disp, x, y + 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(disp, x, y + 1);

  if (mode === "names") {
    const nameY = y - r - 28;
    ctx.font = `700 ${Math.max(10, ssz(12))}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(3, ssz(12) / 4);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(p.nickname, x, nameY);
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(p.nickname, x, nameY);

    const bw = Math.max(20, r * 2);
    const bh = Math.max(3, ssz(4));
    const bx = x - bw / 2;
    const by = nameY + ssz(4);
  const frac = clamp(p.hp / p.maxHp, 0, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(bx, by, bw * frac, bh);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  }

  if (p.gunUntil > t) {
    ctx.font = `${Math.max(9, r * 0.8)}px sans-serif`;
    ctx.fillText("🔫", x, y - r - 12);
  } else if (p.lightningUntil > t) {
    ctx.font = `${Math.max(9, r * 0.8)}px sans-serif`;
    ctx.fillText("⚡", x, y - r - 12);
  } else if (p.stormUntil > t) {
    ctx.font = `${Math.max(9, r * 0.8)}px sans-serif`;
    ctx.fillText("🌪️", x, y - r - 12);
  }

  if (tier > 0) {
    drawSawRing(x, y, r + 8, r + 2, tierColor, t / 40, t - p.sawFlash < 600);
  }

  if (round.phase === "ending" && round.winner === p) {
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(x, y, r + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawBullets() {
  for (const b of bullets) {
    const x = sx(b.x), y = sy(b.y);
    ctx.fillStyle = "#ffd166";
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, ssz(b.r), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawBolts() {
  for (const b of bolts) {
    const ax = sx(b.ax), ay = sy(b.ay), bx = sx(b.bx), by = sy(b.by);
    ctx.strokeStyle = "#e0aaff";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#e0aaff";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    const segs = 6;
    const dx = bx - ax, dy = by - ay;
    for (let i = 1; i < segs; i++) {
      const mx = ax + (dx * i) / segs, my = ay + (dy * i) / segs;
      ctx.lineTo(mx + rand(-14, 14), my + rand(-14, 14));
    }
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawFloaters(t) {
  for (const f of floaters) {
    const a = clamp(1 - (t - f.born) / f.life, 0, 1);
    const fs = Math.max(10, ssz(16));
    ctx.globalAlpha = a;
    ctx.font = `800 ${fs}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, fs / 4);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(f.text, sx(f.x), sy(f.y));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx(f.x), sy(f.y));
    ctx.globalAlpha = 1;
  }
}

function drawSparks(t) {
  for (const s of sparks) {
    const a = clamp(1 - (t - s.born) / s.life, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), ssz(2), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function draw() {
  drawArena();
  const list = [...players.values()].filter((p) => p.alive).sort((a, b) => a.y - b.y);
  for (const p of list) drawPlayer(p, now());
  drawBullets();
  drawBolts();
  drawSparks(now());
  drawFloaters(now());
  if (announce) {
    el.banner.classList.remove("hidden");
    el.banner.querySelector(".title").textContent = announce.title;
    el.banner.querySelector(".sub").textContent = announce.sub;
  }
}

/* ---------- main loop ---------- */
function frame(t) {
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  if (cfg) {
    update(dt, t);
    draw();
  }
  requestAnimationFrame(frame);
}

/* ---------- wiring ---------- */
function applyConfig(c) {
  cfg = c;
  view.baseW = c.viewport.width;
  view.baseH = c.viewport.height;
  view.w = view.baseW;
  view.h = view.baseH;
  resize();
}
TikTokGame.on("tiktok", onEvent);
TikTokGame.on("gameConfig", (c) => applyConfig(c));
TikTokGame.on("status", (s) => {
  if (s.connected) setPill("connected", s.username || "Đang live");
  else setPill("offline", s.connected === false ? "Chưa kết nối live" : "Sẵn sàng");
});
TikTokGame.on("ws", (s) => {
  if (s.state === "open") setPill("connecting", "Đang kết nối live…");
  else if (s.state === "closed") setPill("offline", "Mất kết nối…");
});

resize();
requestAnimationFrame(frame);

(async () => {
  TikTokGame.connect();
  try {
    const c = await TikTokGame.requestConfig(GAME_ID);
    applyConfig(c);
  } catch {
    setPill("offline", "Không tải được cấu hình");
  }
})();
