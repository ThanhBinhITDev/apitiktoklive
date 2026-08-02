import type { BroadcastEvent, RecentEvent, StatsSnapshot, TopLiker, TopSender, UserPayload } from "./types.js";

function userKey(user: UserPayload): string {
  return user.uniqueId || user.nickname;
}

export class StatsManager {
  private startedAt = Date.now();
  private lastViewerCount = 0;
  private counters = { likes: 0, comments: 0, gifts: 0, follows: 0, shares: 0, members: 0, totalDiamonds: 0 };
  private senders = new Map<string, TopSender>();
  private likers = new Map<string, TopLiker>();
  private recent: RecentEvent[] = [];
  private static readonly MAX_RECENT = 50;

  record(event: BroadcastEvent): void {
    switch (event.type) {
      case "comment":
        this.counters.comments++;
        this.pushRecent({ type: "comment", user: event.data.user, content: event.data.content, timestamp: event.data.timestamp });
        break;
      case "gift": {
        const d = event.data;
        const diamonds = d.diamondCount * d.repeatCount;
        this.counters.gifts++;
        this.counters.totalDiamonds += diamonds;
        const key = userKey(d.user);
        const cur = this.senders.get(key);
        if (cur) {
          cur.totalDiamonds += diamonds;
          cur.giftCount++;
        } else {
          this.senders.set(key, { uniqueId: d.user.uniqueId, nickname: d.user.nickname, avatarUrl: d.user.avatarUrl, totalDiamonds: diamonds, giftCount: 1 });
        }
        this.pushRecent({ type: "gift", user: d.user, giftName: d.giftName, diamondCount: d.diamondCount, repeatCount: d.repeatCount, timestamp: d.timestamp });
        break;
      }
      case "like": {
        this.counters.likes += event.data.count;
        if (event.data.user) {
          const u = event.data.user;
          const cur = this.likers.get(userKey(u));
          if (cur) {
            cur.likeCount += event.data.count;
          } else {
            this.likers.set(userKey(u), { uniqueId: u.uniqueId, nickname: u.nickname, avatarUrl: u.avatarUrl, likeCount: event.data.count });
          }
        }
        break;
      }
      case "follow":
        this.counters.follows++;
        break;
      case "share":
        this.counters.shares++;
        break;
      case "member":
        this.counters.members++;
        break;
      case "viewer":
        this.lastViewerCount = event.data.viewerCount;
        break;
      case "status":
        break;
    }
  }

  private pushRecent(ev: RecentEvent): void {
    this.recent.push(ev);
    if (this.recent.length > StatsManager.MAX_RECENT) {
      this.recent.splice(0, this.recent.length - StatsManager.MAX_RECENT);
    }
  }

  getSnapshot(): StatsSnapshot {
    return {
      viewers: this.lastViewerCount,
      likes: this.counters.likes,
      comments: this.counters.comments,
      gifts: this.counters.gifts,
      follows: this.counters.follows,
      shares: this.counters.shares,
      members: this.counters.members,
      totalDiamonds: this.counters.totalDiamonds,
      sessionSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      topSenders: [...this.senders.values()].sort((a, b) => b.totalDiamonds - a.totalDiamonds).slice(0, 5),
      topLikers: [...this.likers.values()].sort((a, b) => b.likeCount - a.likeCount).slice(0, 5),
      recentEvents: [...this.recent],
    };
  }

  reset(): void {
    this.startedAt = Date.now();
    this.lastViewerCount = 0;
    this.counters = { likes: 0, comments: 0, gifts: 0, follows: 0, shares: 0, members: 0, totalDiamonds: 0 };
    this.senders.clear();
    this.likers.clear();
    this.recent = [];
  }
}
