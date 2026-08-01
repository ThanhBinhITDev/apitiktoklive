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
  | { type: "status"; data: { connected: boolean; username: string; roomId?: string } };

export interface ServerEvent {
  type: "tiktok" | "stats";
  payload: BroadcastEvent | StatsPayload;
}

export interface StatsPayload {
  viewers: number;
  likes: number;
  comments: number;
  gifts: number;
}
