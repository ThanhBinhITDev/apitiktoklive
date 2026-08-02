# TikTok Live Data Bridge

Server tối giản kết nối **TikTok Live** và phát **realtime** mọi event (cmt, quà, like, follow, share, member, viewer) qua **WebSocket** cho game của bạn. Game tự xử lý lệnh/cooldown/thống kê — ở đây chỉ có dòng data.

Mô hình cho thuê: **1 instance = 1 thuê bao = 1 phiên live**. Muốn nhiều thuê bao thì chạy nhiều container (Docker per tenant) và để một hệ thống quản lý riêng điều phối.

## Kiến trúc

```
┌─────────────┐      Webcast      ┌───────────────────────┐      WebSocket      ┌────────────┐
│ TikTok Live │ ────────────────► │ Data Bridge (Node/TS) │ ──────────────────► │ Game của   │
│ Webcast     │  tiktok-live-connector │ Express + ws   │   {type:"tiktok"}   │ bạn (1+ client)│
└─────────────┘                    └───────────────────────┘                     └────────────┘
```

## Cài đặt & chạy

```bash
npm install
cp .env.example .env      # đặt TIKTOK_USERNAME, WS_TOKEN nếu muốn
npm run dev               # dev mode
npm run build && npm start # bản production
```

| Biến | Mô tả |
|---|---|
| `TIKTOK_USERNAME` | Username TikTok đang live (không cần `@`). Ưu tiên hơn `config.json` |
| `PORT` | Port server (mặc định `3000`) |
| `ADMIN_TOKEN` | Mật khẩu trang quản trị `/admin`. Để trống = tự sinh ngẫu nhiên (xem log lúc khởi động) |
| `WS_TOKEN` | Token bảo vệ WebSocket (tùy chọn). Nếu đặt, client phải kết nối kèm `?token=` |
| `DEMO_MODE` | `true` = phát dữ liệu giả để test game, không cần TikTok |
| `ENABLE_EXTENDED_GIFT_INFO` | `true` để lấy thêm thông tin quà. **Mặc định `false`** — bật cần Euler Stream Business plan (trả phí) |
| `SIGN_API_KEY` | (Tùy chọn) API key Euler Stream nếu gặp lỗi ký kết nối |
| `CONFIG_PATH` | Đường dẫn file `config.json` (tùy chọn). Mặc định `./config.json` |

`config.json` chỉ chứa username (dùng khi không set env):

```json
{ "username": "bar.online5" }
```

Khi đổi cấu hình trên trang quản trị, giá trị được lưu vào `config.json` và áp dụng ngay. `env` được ưu tiên lúc khởi động — muốn dùng giá trị đã lưu, hãy bỏ biến tương ứng trong `.env`.

## Trang quản trị phiên (`/admin`)

Mỗi instance có **1 trang quản trị cục bộ** riêng: mở `http://localhost:3000/admin`, đăng nhập bằng `ADMIN_TOKEN` (nếu để trống, xem log để lấy token tự sinh). Giao diện tiếng Việt, 5 tab:

- **Feed** — dòng sự kiện realtime (cmt/quà/tim/follow/...), lọc theo loại, tạm dừng, xóa.
- **Thống kê** — người xem, cmt, lượt tim, quà, kim cương, follow, chia sẻ, vào live, thời lượng + top người tặng quà, top tap tim, nút reset.
- **Client** — danh sách game/client đang nối WebSocket (IP, thời điểm kết nối), nút **Ngắt** từng client.
- **Cấu hình** — đổi username, `WS_TOKEN`, bật/tắt demo mode, nút kết nối lại TikTok — lưu & áp dụng ngay không cần sửa file.
- **Hướng dẫn & API** — hướng dẫn sử dụng, link WebSocket theo domain hiện tại (nút copy), cấu trúc payload, API tham chiếu, ghi chú chung.

Các API quản trị (`/api/admin/*`) và WebSocket admin (`/admin`) đều yêu cầu phiên đăng nhập (cookie 12 giờ).

## Kết nối từ game (WebSocket)

```js
const ws = new WebSocket("ws://localhost:3000" + (WS_TOKEN ? `?token=${WS_TOKEN}` : ""));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data); // { type: "tiktok", payload: { type, data } }
  const ev = msg.payload;
  switch (ev.type) {
    case "comment": console.log(ev.data.user.nickname, ":", ev.data.content);
    case "gift":    console.log(ev.data.giftName, "x" + ev.data.repeatCount, ev.data.diamondCount + " diam");
    case "like":    console.log("+" + ev.data.count, "tim"); // user có thể là null
    case "follow": case "share": case "member": ...
    case "viewer":  console.log("viewers:", ev.data.viewerCount);
    case "status":  console.log("connected:", ev.data.connected, ev.data.roomId);
  }
};
```

- Khi client vừa kết nối, server gửi ngay 1 event `status` (connected, username, roomId) để game biết trạng thái.
- Nếu `WS_TOKEN` không khớp → server đóng kết nối mã `1008 unauthorized`.

### Cấu trúc payload

- `comment` → `{ user: {uniqueId, nickname, avatarUrl}, content, timestamp }`
- `gift` → `{ user, giftId, giftName, diamondCount, repeatCount, imageUrl, timestamp }`
- `like` → `{ user | null, count, total, timestamp }` — TikTok gộp like không có user nên `user` **có thể null**; tap 1 lần và double-tap đều cùng loại event, chỉ khác `count` (game không tách được kiểu tap)
- `follow` / `share` / `member` → `{ user, timestamp }` (+ `memberCount`)
- `viewer` → `{ viewerCount, timestamp }`
- `status` → `{ connected, username, roomId?, demoMode? }`

## Health check cho hệ thống quản lý

`GET /api/health` (không cần token):

```json
{ "ok": true, "uptime": 123, "connected": true, "username": "bar.online5", "roomId": "...", "viewers": 45, "demoMode": false }
```

## Docker (1 instance / 1 thuê bao)

```bash
cp .env.example .env    # đặt TIKTOK_USERNAME, ADMIN_TOKEN, WS_TOKEN, PORT
docker compose up -d --build
```

Chạy thủ công nhiều thuê bao (mỗi container một port + token riêng):

```bash
docker run -d -p 3001:3000 \
  -e TIKTOK_USERNAME=thuebao1 -e WS_TOKEN=token_1 \
  tiktoklive:latest
```

Reverse proxy (nginx/caddy) + HTTPS để client WebSocket kết nối qua `wss://`.

## Ghi chú

- Thư viện `tiktok-live-connector` v2.4.3 (ESM-only) dùng để kết nối Webcast của TikTok.
- Cần username **đang live** mới kết nối được. Offline → tự retry backoff tối đa 30s.
- **Nhiều kết nối đồng thời từ cùng 1 IP dễ bị TikTok rate limit** (backoff 60s→5ph). Chạy nhiều thuê bao nên phân tán nhiều server/IP và dùng `SIGN_API_KEY` Euler Stream cho ký kết nối.
- Nếu gặp `SignatureMissingTokensError` / "requires a Business plan": đặt `ENABLE_EXTENDED_GIFT_INFO=false` (mặc định đã là `false`).
