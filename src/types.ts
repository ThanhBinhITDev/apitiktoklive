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

export type BroadcastEvent =
  | { type: "comment"; data: CommentPayload }
  | { type: "gift"; data: GiftPayload }
  | { type: "like"; data: LikePayload }
  | { type: "follow"; data: FollowPayload }
  | { type: "share"; data: SharePayload }
  | { type: "member"; data: MemberPayload }
  | { type: "viewer"; data: ViewerPayload }
  | { type: "command"; data: CommandPayload }
  | { type: "status"; data: { connected: boolean; username: string; roomId?: string } };

export interface ViewerPayload {
  viewerCount: number;
  timestamp: number;
}

export interface CommandPayload {
  key: string;
  user: UserPayload;
  content: string;
  timestamp: number;
  giftId?: string;
  giftName?: string;
  diamondCount?: number;
  repeatCount?: number;
}

export interface ServerEvent {
  type: "tiktok" | "stats" | "command";
  payload: BroadcastEvent | StatsPayload | CommandPayload;
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

export interface RecentEvent {
  type: "comment" | "gift";
  user: UserPayload;
  content?: string;
  giftId?: string;
  giftName?: string;
  diamondCount?: number;
  repeatCount?: number;
  timestamp: number;
}

export interface StatsPayload {
  viewers: number;
  likes: number;
  comments: number;
  gifts: number;
  totalDiamonds: number;
  sessionSeconds: number;
  connected: boolean;
  topSenders: TopSender[];
  topLikers: TopLiker[];
  recentEvents: RecentEvent[];
}
