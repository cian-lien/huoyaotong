import { randomUUID } from 'node:crypto';
import type { Me, Stats } from '@hyt/shared';
import { toMe, type MatchRecord, type Store, type UserRecord } from './store.ts';

/** 内存版 Store：只给测试用，进程一退出数据就没了 */
export class MemoryStore implements Store {
  users = new Map<string, UserRecord>();
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  matches: (MatchRecord & { id: string })[] = [];

  async createUser(input: { email: string; passwordHash: string; nickname: string }) {
    if (await this.findUserByEmail(input.email)) return null;
    const user: UserRecord = { id: randomUUID(), avatar: null, ...input };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async updateProfile(userId: string, patch: { nickname?: string; avatar?: string }): Promise<Me | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    if (patch.nickname !== undefined) user.nickname = patch.nickname;
    if (patch.avatar !== undefined) user.avatar = patch.avatar;
    return toMe(user);
  }

  async createSession(sessionId: string, userId: string, expiresAt: Date) {
    this.sessions.set(sessionId, { userId, expiresAt });
  }

  async getSessionUser(sessionId: string): Promise<Me | null> {
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt.getTime() < Date.now()) return null;
    const user = this.users.get(s.userId);
    return user ? toMe(user) : null;
  }

  async deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  async saveMatch(match: MatchRecord) {
    const id = randomUUID();
    this.matches.push({ id, ...match });
    return id;
  }

  async getStats(userId: string): Promise<Stats> {
    const mine = this.matches
      .flatMap((m) => m.players.filter((p) => p.userId === userId).map((p) => ({ m, p })))
      .sort((a, b) => b.m.endedAt.getTime() - a.m.endedAt.getTime());
    const games = mine.length;
    return {
      games,
      wins: mine.filter((x) => x.p.rank === 1).length,
      avgRank: games ? mine.reduce((n, x) => n + x.p.rank, 0) / games : null,
      recent: mine.slice(0, 10).map(({ m, p }) => ({
        matchId: m.id,
        endedAt: m.endedAt.toISOString(),
        playerCount: m.players.length,
        rank: p.rank,
        turnsSurvived: p.turnsSurvived,
      })),
    };
  }

  async close() {}
}
