import { EventEmitter } from "node:events";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent,
  PremiumFeatureError,
  SignatureMissingTokensError,
  type ClientEventMap,
} from "tiktok-live-connector";
import type {
  WebcastChatMessage,
  WebcastGiftMessage,
  WebcastLikeMessage,
  WebcastSocialMessage,
  WebcastMemberMessage,
  WebcastRoomUserSeqMessage,
} from "tiktok-live-proto/v3";
import type {
  BroadcastEvent,
  CommentPayload,
  GiftPayload,
  LikePayload,
  FollowPayload,
  SharePayload,
  MemberPayload,
  ViewerPayload,
} from "./types.js";

type EventMap = { [key: string]: (...args: never[]) => void };
interface TypedEmitter<Events extends EventMap> {
  on<E extends keyof Events>(event: E, listener: Events[E]): this;
}

type TikTokConn = InstanceType<typeof TikTokLiveConnection> & TypedEmitter<ClientEventMap>;

export interface TikTokServiceOptions {
  username: string;
  signApiKey?: string;
  enableExtendedGiftInfo?: boolean;
}

function avatarUrl(user: { avatarThumb?: { urlList?: string[] } } | undefined): string {
  return user?.avatarThumb?.urlList?.[0] ?? user?.avatarThumb?.urlList?.[1] ?? "";
}

export class TikTokService extends EventEmitter {
  private connection: TikTokConn | null = null;
  private options: TikTokServiceOptions;
  private reconnectDelay = 1500;
  private manualDisconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;

  connected = false;
  roomId: string | null = null;

  constructor(options: TikTokServiceOptions) {
    super();
    this.options = options;
  }

  get username(): string {
    return this.options.username;
  }

  start(): void {
    this.manualDisconnect = false;
    void this.connect();
  }

  stop(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connection?.disconnect();
    this.connection = null;
    this.connected = false;
  }

  reconfigure(username: string): void {
    this.stop();
    this.options.username = username;
    this.emitStatus();
    this.start();
  }

  private async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.emitStatus();
    const rawConn = new TikTokLiveConnection(this.options.username, {
      enableExtendedGiftInfo: this.options.enableExtendedGiftInfo ?? true,
      processInitialData: false,
      ...(this.options.signApiKey ? { signApiKey: this.options.signApiKey } : {}),
    });
    this.connection = rawConn as TikTokConn;

    this.setupHandlers(this.connection);

    this.connectPromise = this.connection
      .connect()
      .then((state) => {
        this.connected = true;
        this.reconnectDelay = 1500;
        this.roomId = state.roomId;
        console.log(`[tiktok] Connected to room ${state.roomId} (${this.options.username})`);
        this.emitStatus();
      })
      .catch((err) => {
        if (err instanceof PremiumFeatureError || err instanceof SignatureMissingTokensError) {
          console.error(
            "[tiktok] Kết nối thất bại do cần Euler Stream Business plan khi bật ENABLE_EXTENDED_GIFT_INFO=true. Hãy đặt ENABLE_EXTENDED_GIFT_INFO=false trong .env rồi chạy lại."
          );
        } else {
          console.error(`[tiktok] Connect failed: ${err?.message ?? err}`);
        }
        this.connected = false;
        this.emitStatus();
        this.scheduleReconnect();
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  private setupHandlers(conn: TikTokConn): void {
    conn.on(ControlEvent.CONNECTED, () => {
      this.connected = true;
      this.emitStatus();
    });

    conn.on(ControlEvent.DISCONNECTED, ({ code, reason }) => {
      console.warn(`[tiktok] Disconnected (${code})${reason ? `: ${reason}` : ""}`);
      this.connected = false;
      this.roomId = null;
      this.emitStatus();
      this.scheduleReconnect();
    });

    conn.on(ControlEvent.ERROR, ({ info, exception }) => {
      console.error(`[tiktok] Error: ${info}`, exception);
      this.connected = false;
      this.emitStatus();
    });

    conn.on(WebcastEvent.CHAT, (data: WebcastChatMessage) => {
      if (!data.content || !data.user) return;
      const payload: CommentPayload = {
        user: {
          uniqueId: data.user.displayId || data.user.nickname,
          nickname: data.user.nickname,
          avatarUrl: avatarUrl(data.user),
        },
        content: data.content,
        timestamp: Date.now(),
      };
      this.emit("event", { type: "comment", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.GIFT, (data: WebcastGiftMessage) => {
      if (!data.user) return;
      if (data.repeatEnd !== 1) return;

      const gift = data.gift;
      const giftName = gift?.name ?? data.extendedGiftInfo?.name ?? `Gift ${data.giftId}`;
      const diamondCount = gift?.diamondCount ?? data.extendedGiftInfo?.diamondCount ?? 0;
      const imageUrl =
        gift?.image?.urlList?.[0] ??
        gift?.icon?.urlList?.[0] ??
        data.extendedGiftInfo?.image?.urlList?.[0] ??
        "";

      const payload: GiftPayload = {
        user: {
          uniqueId: data.user.displayId || data.user.nickname,
          nickname: data.user.nickname,
          avatarUrl: avatarUrl(data.user),
        },
        giftId: data.giftId,
        giftName,
        diamondCount,
        repeatCount: Math.max(data.repeatCount, 1),
        imageUrl,
        timestamp: Date.now(),
      };
      this.emit("event", { type: "gift", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.LIKE, (data: WebcastLikeMessage) => {
      const payload: LikePayload = {
        user: data.user
          ? {
              uniqueId: data.user.displayId || data.user.nickname,
              nickname: data.user.nickname,
              avatarUrl: avatarUrl(data.user),
            }
          : null,
        count: data.count ?? 1,
        total: Number(data.total ?? 0),
        timestamp: Date.now(),
      };
      this.emit("event", { type: "like", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.FOLLOW, (data: WebcastSocialMessage) => {
      if (!data.user) return;
      const payload: FollowPayload = {
        user: {
          uniqueId: data.user.displayId || data.user.nickname,
          nickname: data.user.nickname,
          avatarUrl: avatarUrl(data.user),
        },
        timestamp: Date.now(),
      };
      this.emit("event", { type: "follow", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.SHARE, (data: WebcastSocialMessage) => {
      if (!data.user) return;
      const payload: SharePayload = {
        user: {
          uniqueId: data.user.displayId || data.user.nickname,
          nickname: data.user.nickname,
          avatarUrl: avatarUrl(data.user),
        },
        timestamp: Date.now(),
      };
      this.emit("event", { type: "share", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.MEMBER, (data: WebcastMemberMessage) => {
      if (!data.user) return;
      const payload: MemberPayload = {
        user: {
          uniqueId: data.user.displayId || data.user.nickname,
          nickname: data.user.nickname,
          avatarUrl: avatarUrl(data.user),
        },
        memberCount: data.memberCount,
        timestamp: Date.now(),
      };
      this.emit("event", { type: "member", data: payload } satisfies BroadcastEvent);
    });

    conn.on(WebcastEvent.ROOM_USER, (data: WebcastRoomUserSeqMessage) => {
      const viewerCount = Number(data.totalUser ?? 0);
      if (!viewerCount) return;
      const payload: ViewerPayload = {
        viewerCount,
        timestamp: Date.now(),
      };
      this.emit("event", { type: "viewer", data: payload } satisfies BroadcastEvent);
    });
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect) return;
    if (this.reconnectTimer) return;

    console.log(`[tiktok] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect) void this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private emitStatus(): void {
    this.emit("event", {
      type: "status",
      data: {
        connected: this.connected,
        username: this.options.username,
        roomId: this.roomId ?? undefined,
      },
    } satisfies BroadcastEvent);
  }
}
