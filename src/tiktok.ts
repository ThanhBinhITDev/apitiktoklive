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
  CommandPayload,
} from "./types.js";
import { CommandMatcher, GIFT_KEY } from "./commands.js";
import { color, C, fmtTime, pad } from "./log.js";

type EventMap = { [key: string]: (...args: never[]) => void };
interface TypedEmitter<Events extends EventMap> {
  on<E extends keyof Events>(event: E, listener: Events[E]): this;
}

type TikTokConn = InstanceType<typeof TikTokLiveConnection> & TypedEmitter<ClientEventMap>;

export interface TikTokServiceOptions {
  username: string;
  commands?: string[];
  giftCommands?: string[];
  commandCooldownMs?: number;
  signApiKey?: string;
  enableExtendedGiftInfo?: boolean;
}

function avatarUrl(user: { avatarThumb?: { urlList?: string[] } } | undefined): string {
  return user?.avatarThumb?.urlList?.[0] ?? user?.avatarThumb?.urlList?.[1] ?? "";
}

function isRateLimitError(err: unknown): boolean {
  return /retry-after|rate\s*limit/i.test(String((err as Error)?.message ?? err));
}

export class TikTokService extends EventEmitter {
  private connection: TikTokConn | null = null;
  private options: TikTokServiceOptions;
  private matcher = new CommandMatcher();
  private giftIds = new Set<string>();
  private lastCommandAt = new Map<string, number>();
  private reconnectDelay = 1500;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private rateLimitDelay = 60000;
  private readonly MAX_RATE_LIMIT_DELAY = 5 * 60_000;
  private rateLimited = false;
  private manualDisconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;

  connected = false;
  roomId: string | null = null;

  constructor(options: TikTokServiceOptions) {
    super();
    this.options = options;
    this.setCommands(options.commands ?? []);
    this.setGiftCommands(options.giftCommands ?? []);
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

  reconfigure(opts: { username?: string; commands?: string[]; giftCommands?: string[]; commandCooldownMs?: number }): void {
    this.stop();
    if (opts.username) this.options.username = opts.username;
    if (opts.commands) this.setCommands(opts.commands);
    if (opts.giftCommands) this.setGiftCommands(opts.giftCommands);
    if (opts.commandCooldownMs !== undefined) this.setCommandCooldown(opts.commandCooldownMs);
    this.emitStatus();
    this.start();
  }

  setCommands(commands: string[]): void {
    this.options.commands = commands;
    this.matcher.setCommands(commands);
  }

  get commands(): string[] {
    return this.options.commands ?? [];
  }

  setGiftCommands(giftCommands: string[]): void {
    this.options.giftCommands = giftCommands;
    this.giftIds = new Set(giftCommands.map((g) => String(g).trim()).filter(Boolean));
  }

  get giftCommands(): string[] {
    return this.options.giftCommands ?? [];
  }

  setCommandCooldown(ms: number): void {
    this.options.commandCooldownMs = ms;
    this.lastCommandAt.clear();
  }

  get commandCooldownMs(): number {
    return this.options.commandCooldownMs ?? 0;
  }

  canEmitCommand(uniqueId: string, key: string, now = Date.now()): boolean {
    const cooldownMs = this.commandCooldownMs;
    if (cooldownMs <= 0) return true;
    const cmdKey = `${uniqueId}:${key}`;
    const lastAt = this.lastCommandAt.get(cmdKey);
    if (lastAt === undefined) {
      this.lastCommandAt.set(cmdKey, now);
      return true;
    }
    if (now - lastAt >= cooldownMs) {
      this.lastCommandAt.set(cmdKey, now);
      return true;
    }
    return false;
  }

  private async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.emitStatus();
    const rawConn = new TikTokLiveConnection(this.options.username, {
      enableExtendedGiftInfo: this.options.enableExtendedGiftInfo ?? false,
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
        this.rateLimitDelay = 60000;
        this.rateLimited = false;
        this.roomId = state.roomId;
        console.log(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.green, pad("[tiktok]", 9))} ${color(C.dim, pad("-", 24))} Connected to room ${color(C.brightGreen, state.roomId)} (${this.options.username})`);
        this.emitStatus();
      })
      .catch((err) => {
        const rateLimited = isRateLimitError(err);
        this.rateLimited = rateLimited;
        if (rateLimited) {
          console.error(
            `${color(C.bold + C.yellow, "TIKTOK")}: ${color(C.red + C.bold, "dang gioi han ket noi (rate limit)")}. Ket noi qua nhieu lan lien tiep. Se thu lai sau ~${Math.round(this.rateLimitDelay / 1000)}s. Khoi dong lai server hoac doi vai phut de het gioi han.`
          );
        } else if (err instanceof PremiumFeatureError || err instanceof SignatureMissingTokensError) {
          console.error(
            `${color(C.red + C.bold, "LOI")}: can Euler Stream Business plan khi bat ENABLE_EXTENDED_GIFT_INFO=true. Hay dat ENABLE_EXTENDED_GIFT_INFO=false trong .env roi chay lai.`
          );
        } else {
          console.error(`${color(C.red + C.bold, "LOI")}: Connect failed: ${err?.message ?? err}`);
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
      console.warn(`${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.yellow, pad("[tiktok]", 9))} ${color(C.dim, pad("-", 24))} Disconnected (${code})${reason ? `: ${reason}` : ""}`);
      this.connected = false;
      this.roomId = null;
      this.emitStatus();
      this.scheduleReconnect();
    });

    conn.on(ControlEvent.ERROR, ({ info, exception }) => {
      console.error(`${color(C.red + C.bold, "LOI")}: ${info}`, exception);
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

      const matchedKey = this.matcher.match(data.content);
      if (matchedKey && this.canEmitCommand(payload.user.uniqueId, matchedKey)) {
        const commandPayload: CommandPayload = {
          key: matchedKey,
          user: payload.user,
          content: data.content,
          timestamp: payload.timestamp,
        };
        this.emit("event", { type: "command", data: commandPayload } satisfies BroadcastEvent);
      }
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

      if (this.giftIds.has(payload.giftId)) {
        const commandPayload: CommandPayload = {
          key: GIFT_KEY,
          user: payload.user,
          content: giftName,
          timestamp: payload.timestamp,
          giftId: payload.giftId,
          giftName,
          diamondCount,
          repeatCount: payload.repeatCount,
        };
        this.emit("event", { type: "command", data: commandPayload } satisfies BroadcastEvent);
      }
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

    const isRateLimited = this.rateLimited;
    const baseDelay = isRateLimited ? this.rateLimitDelay : this.reconnectDelay;
    const jitter = Math.floor(Math.random() * 3000);
    const delay = baseDelay + jitter;

    console.log(
      `${color(C.dim, `[${fmtTime()}]`)} ${color(C.bold + C.yellow, pad("[tiktok]", 9))} ${color(C.dim, pad("-", 24))} Reconnecting in ${(delay / 1000).toFixed(1)}s...${isRateLimited ? color(C.yellow, " (rate limit - doi lau hon)") : ""}`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect) void this.connect();
    }, delay);

    if (isRateLimited) {
      this.rateLimitDelay = Math.min(this.rateLimitDelay * 2, this.MAX_RATE_LIMIT_DELAY);
    } else {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY);
    }
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
