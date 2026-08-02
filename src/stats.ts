import type { BroadcastEvent, StatsPayload, TopSender, TopLiker, RecentEvent } from "./types.js";

const RECENT_EVENT_LIMIT = 30;
const TOP_SENDER_LIMIT = 10;
const TOP_LIKER_LIMIT = 10;

export class StatsManager {
  private viewers = 0;
  private likes = 0;
  private comments = 0;
  private gifts = 0;
  private totalDiamonds = 0;
  private connected = false;
  private sessionStartedAt: number | null = null;
  private topSendersMap = new Map<string, TopSender>();
  private topLikersMap = new Map<string, TopLiker>();
  private recentEvents: RecentEvent[] = [];

  reset(): void {
    this.viewers = 0;
    this.likes = 0;
    this.comments = 0;
    this.gifts = 0;
    this.totalDiamonds = 0;
    this.connected = false;
    this.sessionStartedAt = null;
    this.topSendersMap.clear();
    this.topLikersMap.clear();
    this.recentEvents = [];
  }

  markConnected(connected: boolean): void {
    this.connected = connected;
    if (connected && !this.sessionStartedAt) {
      this.sessionStartedAt = Date.now();
    }
  }

  record(event: BroadcastEvent): void {
    switch (event.type) {
      case "comment": {
        this.comments++;
        this.pushRecent({
          type: "comment",
          user: event.data.user,
          content: event.data.content,
          timestamp: event.data.timestamp,
        });
        break;
      }
      case "gift": {
        this.gifts++;
        this.totalDiamonds += event.data.diamondCount;
        const d = event.data;
        const entry = this.topSendersMap.get(d.user.uniqueId) ?? {
          uniqueId: d.user.uniqueId,
          nickname: d.user.nickname,
          avatarUrl: d.user.avatarUrl,
          totalDiamonds: 0,
          giftCount: 0,
        };
        entry.totalDiamonds += d.diamondCount;
        entry.giftCount += d.repeatCount;
        entry.nickname = d.user.nickname;
        entry.avatarUrl = d.user.avatarUrl || entry.avatarUrl;
        this.topSendersMap.set(d.user.uniqueId, entry);

        this.pushRecent({
          type: "gift",
          user: d.user,
          giftId: d.giftId,
          giftName: d.giftName,
          diamondCount: d.diamondCount,
          repeatCount: d.repeatCount,
          timestamp: d.timestamp,
        });
        break;
      }
      case "like": {
        this.likes += event.data.count;
        const u = event.data.user;
        if (u) {
          const entry = this.topLikersMap.get(u.uniqueId) ?? {
            uniqueId: u.uniqueId,
            nickname: u.nickname,
            avatarUrl: u.avatarUrl,
            likeCount: 0,
          };
          entry.likeCount += event.data.count;
          entry.nickname = u.nickname;
          entry.avatarUrl = u.avatarUrl || entry.avatarUrl;
          this.topLikersMap.set(u.uniqueId, entry);
        }
        break;
      }
      case "viewer":
        this.viewers = event.data.viewerCount;
        break;
      case "status":
        this.markConnected(event.data.connected);
        break;
      default:
        break;
    }
  }

  private pushRecent(ev: RecentEvent): void {
    this.recentEvents.unshift(ev);
    if (this.recentEvents.length > RECENT_EVENT_LIMIT) {
      this.recentEvents.length = RECENT_EVENT_LIMIT;
    }
  }

  getSnapshot(): StatsPayload {
    const topSenders = [...this.topSendersMap.values()]
      .sort((a, b) => b.totalDiamonds - a.totalDiamonds)
      .slice(0, TOP_SENDER_LIMIT);

    const topLikers = [...this.topLikersMap.values()]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, TOP_LIKER_LIMIT);

    return {
      viewers: this.viewers,
      likes: this.likes,
      comments: this.comments,
      gifts: this.gifts,
      totalDiamonds: this.totalDiamonds,
      sessionSeconds: this.sessionStartedAt ? Math.floor((Date.now() - this.sessionStartedAt) / 1000) : 0,
      connected: this.connected,
      topSenders,
      topLikers,
      recentEvents: [...this.recentEvents],
    };
  }
}
