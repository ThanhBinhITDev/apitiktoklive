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
```

## Cấu hình (.env)

| Biến | Mô tả |
|---|---|
| `TIKTOK_USERNAME` | Username TikTok đang live (không cần `@`) |
| `PORT` | Port server (mặc định `3000`) |
| `DEMO_MODE` | `true` = phát dữ liệu giả để test giao diện, không cần TikTok |
| `ENABLE_EXTENDED_GIFT_INFO` | `true` để lấy thêm thông tin quà. **Mặc định `false`** — bật `true` cần Euler Stream Business plan (trả phí) |
| `SIGN_API_KEY` | (Tùy chọn) API key Euler Stream nếu gặp lỗi ký kết nối |

## Sử dụng với OBS

1. Chạy server (hoặc `DEMO_MODE=true` để xem trước giao diện).
2. Mở **OBS → Sources → Add → Browser**.
3. Đặt URL: `http://localhost:3000` (thêm `?bg=dark` nếu muốn nền tối để test, bản overlay thật có nền trong suốt).
4. Điều chỉnh width/height cho phù hợp scene của bạn.

## Sự kiện hỗ trợ

- **comment** — bình luận, hiển thị dưới góc trái (avatar + tên + nội dung)
- **gift** — quà tặng, hiển thị to ở giữa với ảnh quà, số lượng, giá diamonds
- **like** — tim bay lên từ dưới màn hình
- **follow** / **share** / **member** — thông báo trên đầu màn hình

## Ghi chú

- Thư viện `tiktok-live-connector` v2.4.3 (ESM-only) được dùng để kết nối Webcast của TikTok.
- Cần username **đang live** thì mới kết nối được. Nếu account offline, app tự retry với backoff tối đa 30s.
- **Nếu gặp lỗi `SignatureMissingTokensError` / "This endpoint requires a Business plan"**: hãy đặt `ENABLE_EXTENDED_GIFT_INFO=false` trong `.env` (mặc định đã là `false`).
- Có thể dùng `SIGN_API_KEY` từ [eulerstream.com](https://www.eulerstream.com) để ký kết nối ổn định hơn.
