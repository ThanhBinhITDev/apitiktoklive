# TikTok Live Overlay

Ứng dụng nhận diện và hiển thị **realtime** bình luận (cmt), quà tặng (gift), lượt tim (like), follow, chia sẻ trong một phiên live TikTok, hiển thị dưới dạng overlay cho OBS.

## Kiến trúc

```
┌─────────────┐     WebSocket      ┌──────────────────────┐
│ TikTok Live │ ─────────────────► │ Backend (Node/TS)     │
│ Webcast     │  tiktok-live-connector │  Express + ws      │
└─────────────┘                    │  /public/ overlay     │
                                   └──────────┬───────────┘
                                              │ WebSocket
                                              ▼
                                   ┌──────────────────────┐
                                   │ Browser overlay (OBS) │
                                   └──────────────────────┘
```

## Cài đặt

```bash
npm install
cp .env.example .env
# Sửa .env: đặt TIKTOK_USERNAME = username tài khoản TikTok đang live
```

## Chạy

```bash
npm run dev        # dev mode (tự reload)
npm run build      # build TypeScript
npm start          # chạy bản build
npm test           # chạy unit test (matcher, normalize, cooldown)
npm run typecheck  # kiểm tra type
```

## Cấu hình (.env)

| Biến | Mô tả |
|---|---|
| `TIKTOK_USERNAME` | Username TikTok đang live (không cần `@`) |
| `PORT` | Port server (mặc định `3000`) |
| `DEMO_MODE` | `true` = phát dữ liệu giả để test giao diện, không cần TikTok |
| `ENABLE_EXTENDED_GIFT_INFO` | `true` để lấy thêm thông tin quà. **Mặc định `false`** — bật `true` cần Euler Stream Business plan (trả phí) |
| `SIGN_API_KEY` | (Tùy chọn) API key Euler Stream nếu gặp lỗi ký kết nối |

## Cấu hình lệnh (config.json)

`config.json` (sinh ra khi khởi động đầu tiên) chứa username, danh sách lệnh, quà nhận diện và cooldown:

```json
{
  "username": "nhn.3021",
  "commands": ["start", "vote", "help"],
  "giftCommands": ["1005", "1006"],
  "commandCooldownMs": 3000
}
```

- Người xem comment **đúng** một trong các key (vd `vote`, `VOTE`, `Vôte` — bỏ dấu, hoa/thường) → hệ thống nhận diện là **lệnh** và gửi qua WebSocket dạng `{ "type": "command", "payload": { "key": "vote", "user": {...}, "content": "vote", "timestamp": ... } }`.
- **`giftCommands`** là danh sách **giftId** quà được nhận diện thành lệnh. Quà có giftId nằm trong danh sách → gửi lệnh `{ "key": "gift", "giftId": "...", "giftName": "...", "diamondCount": ..., "repeatCount": ... }`. Quà khác **vẫn hiện overlay** nhưng **không** gửi lệnh cho game.
- **`commandCooldownMs`** chống spam lệnh: mỗi user + mỗi key chỉ tính lệnh mới sau đúng khoảng thời gian này (ms). `0` = tắt. Comment vẫn hiện trên overlay dù có bị cooldown hay không.
- **Cách tìm giftId**: mở Dashboard (`/dashboard`), xem feed sự kiện gần đây — mỗi quà hiển thị mã `#giftId` (mã ổn định của TikTok, không đổi theo ngôn ngữ).
- Sửa danh sách lệnh/quà/cooldown trực tiếp trong file `config.json` hoặc qua Dashboard (`/dashboard`).

## Sử dụng với OBS

1. Chạy server (hoặc `DEMO_MODE=true` để xem trước giao diện).
2. Mở **OBS → Sources → Add → Browser**.
3. Đặt URL: `http://localhost:3000` (thêm `?bg=dark` nếu muốn nền tối để test, bản overlay thật có nền trong suốt).
4. Điều chỉnh width/height cho phù hợp scene của bạn.

## Dashboard

Mở `http://localhost:3000/dashboard` để:
- Xem trạng thái kết nối, room ID.
- Đổi username TikTok, danh sách lệnh, quà nhận diện (giftId) và cooldown lệnh — lưu vào `config.json`, tự reconnect.
- Theo dõi thống kê phiên (viewers, cmt, like, quà, kim cương, thời lượng), top người tặng quà, sự kiện và lệnh gần đây.
- Nút **Reset thống kê** để bắt đầu phiên mới.

## Sự kiện hỗ trợ

- **comment** — bình luận, hiển thị dưới góc trái (avatar + tên + nội dung)
- **gift** — quà tặng, hiển thị to ở giữa với ảnh quà, số lượng, giá diamonds
- **like** — tim bay lên từ dưới màn hình
- **follow** / **share** / **member** — thông báo trên đầu màn hình

## Dùng cho game (WebSocket)

Game kết nối tới `ws://localhost:3000` và đọc message:

```js
const ws = new WebSocket("ws://localhost:3000");
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "command") {
    const cmd = msg.payload; // { key, user, content, timestamp, ... }
    if (cmd.key === "vote") { /* làm gì đó với cmd.user */ }
    if (cmd.key === "gift") { /* cmd.giftName, cmd.diamondCount, cmd.repeatCount */ }
  }
};
```

Ngoài ra server còn gửi `{ type: "stats" }` (thống kê 2s/lần) và `{ type: "tiktok" }` (mọi event thô: comment/gift/like/follow/...) để game dùng khi cần.

## Ghi chú

- Thư viện `tiktok-live-connector` v2.4.3 (ESM-only) được dùng để kết nối Webcast của TikTok.
- Cần username **đang live** thì mới kết nối được. Nếu account offline, app tự retry với backoff tối đa 30s.
- **Nếu gặp lỗi `SignatureMissingTokensError` / "This endpoint requires a Business plan"**: hãy đặt `ENABLE_EXTENDED_GIFT_INFO=false` trong `.env` (mặc định đã là `false`).
- Có thể dùng `SIGN_API_KEY` từ [eulerstream.com](https://www.eulerstream.com) để ký kết nối ổn định hơn.
