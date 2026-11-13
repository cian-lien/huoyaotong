import type { Me, Stats } from '@hyt/shared';

export interface UserRecord extends Me {
  passwordHash: string;
}

export interface MatchRecord {
  startedAt: Date;
  endedAt: Date;
  players: { seat: number; userId: string | null; nickname: string; rank: number; turnsSurvived: number }[];
}

/**
 * 所有数据库访问都走这个接口。
 * 线上用 PostgreSQL（store-pg.ts），测试用内存版（store-memory.ts）。
 */
export interface Store {
  /** 邮箱已被注册时返回 null */
  createUser(input: { email: string; passwordHash: string; nickname: string }): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  updateProfile(userId: string, patch: { nickname?: string; avatar?: string }): Promise<Me | null>;

  createSession(sessionId: string, userId: string, expiresAt: Date): Promise<void>;
  /** 会话不存在或已过期时返回 null */
  getSessionUser(sessionId: string): Promise<Me | null>;
  deleteSession(sessionId: string): Promise<void>;

  saveMatch(match: MatchRecord): Promise<string>;
  getStats(userId: string): Promise<Stats>;

  close(): Promise<void>;
}

export function toMe(u: Me): Me {
  return { id: u.id, email: u.email, nickname: u.nickname, avatar: u.avatar };
}
