export interface UserPayload {
  uniqueId: string;
  nickname: string;
  avatarUrl: string;
}

export interface CommentPayload {
  user: UserPayload;
  content: string;
  timestamp: number;
}

export interface GiftPayload {
  user: UserPayload;
  giftId: string;
  giftName: string;
  diamondCount: number;
  repeatCount: number;
  imageUrl: string;
  timestamp: number;
}

export interface LikePayload {
  user: UserPayload | null;
  count: number;
  total: number;
  timestamp: number;
}

export interface FollowPayload {
  user: UserPayload;
  timestamp: number;
}

export interface SharePayload {
  user: UserPayload;
  timestamp: number;
}

export interface MemberPayload {
  user: UserPayload;
  memberCount: number;
  timestamp: number;
}

export interface ViewerPayload {
  viewerCount: number;
  timestamp: number;
}

export interface StatusPayload {
  connected: boolean;
  username: string;
  roomId?: string;
  demoMode?: boolean;
}

export type BroadcastEvent =
  | { type: "comment"; data: CommentPayload }
  | { type: "gift"; data: GiftPayload }
  | { type: "like"; data: LikePayload }
  | { type: "follow"; data: FollowPayload }
  | { type: "share"; data: SharePayload }
  | { type: "member"; data: MemberPayload }
  | { type: "viewer"; data: ViewerPayload }
  | { type: "status"; data: StatusPayload };

export interface ServerEvent {
  type: "tiktok";
  payload: BroadcastEvent;
}

export interface TopSender {
  uniqueId: string;
  nickname: string;
  avatarUrl: string;
  totalDiamonds: number;
  giftCount: number;
}

export interface TopLiker {
  uniqueId: string;
  nickname: string;
  avatarUrl: string;
  likeCount: number;
}

export interface RecentFollower {
  uniqueId: string;
  nickname: string;
  avatarUrl: string;
  timestamp: number;
}

export interface RecentEvent {
  type: "comment" | "gift";
  user: UserPayload;
  content?: string;
  giftName?: string;
  diamondCount?: number;
  repeatCount?: number;
  timestamp: number;
}

export interface StatsSnapshot {
  viewers: number;
  likes: number;
  comments: number;
  gifts: number;
  follows: number;
  shares: number;
  members: number;
  totalDiamonds: number;
  sessionSeconds: number;
  topSenders: TopSender[];
  topLikers: TopLiker[];
  followers: RecentFollower[];
  recentEvents: RecentEvent[];
}

export interface StatusSnapshot {
  connected: boolean;
  username: string;
  roomId: string | null;
  viewers: number | null;
  demoMode: boolean;
  uptime: number;
}

export type AdminWsMessage =
  | { type: "tiktok"; payload: BroadcastEvent }
  | { type: "stats"; payload: StatsSnapshot }
  | { type: "status"; payload: StatusSnapshot };

export interface ClientInfo {
  id: number;
  ip: string;
  connectedAt: number;
  kind: "game" | "admin";
}
