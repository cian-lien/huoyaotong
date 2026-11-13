import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { Me, Stats } from '@hyt/shared';
import * as schema from './db/schema.ts';
import { toMe, type MatchRecord, type Store, type UserRecord } from './store.ts';

const { users, sessions, matches, matchPlayers } = schema;

/** PostgreSQL 版 Store（Drizzle） */
export class PgStore implements Store {
  private pool: pg.Pool;
  private db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.db = drizzle(this.pool, { schema });
  }

  /** 启动时执行还没跑过的迁移（drizzle/ 目录里的 SQL） */
  async migrate(migrationsFolder: string) {
    await migrate(this.db, { migrationsFolder });
  }

  async createUser(input: { email: string; passwordHash: string; nickname: string }): Promise<UserRecord | null> {
    const rows = await this.db
      .insert(users)
      .values({ id: randomUUID(), ...input })
      .onConflictDoNothing({ target: users.email })
      .returning();
    return rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async updateProfile(userId: string, patch: { nickname?: string; avatar?: string }): Promise<Me | null> {
    if (patch.nickname === undefined && patch.avatar === undefined) {
      const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ? toMe(rows[0]) : null;
    }
    const rows = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return rows[0] ? toMe(rows[0]) : null;
  }

  async createSession(sessionId: string, userId: string, expiresAt: Date) {
    await this.db.insert(sessions).values({ id: sessionId, userId, expiresAt });
  }

  async getSessionUser(sessionId: string): Promise<Me | null> {
    const rows = await this.db
      .select({ id: users.id, email: users.email, nickname: users.nickname, avatar: users.avatar })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteSession(sessionId: string) {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  async saveMatch(match: MatchRecord): Promise<string> {
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(matches).values({
        id,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        playerCount: match.players.length,
      });
      await tx.insert(matchPlayers).values(match.players.map((p) => ({ matchId: id, ...p })));
    });
    return id;
  }

  async getStats(userId: string): Promise<Stats> {
    const [totals] = await this.db
      .select({
        games: sql<number>`count(*)::int`,
        wins: sql<number>`(count(*) filter (where ${matchPlayers.rank} = 1))::int`,
        avgRank: sql<number | null>`avg(${matchPlayers.rank})::float8`,
      })
      .from(matchPlayers)
      .where(eq(matchPlayers.userId, userId));

    const recent = await this.db
      .select({
        matchId: matches.id,
        endedAt: matches.endedAt,
        playerCount: matches.playerCount,
        rank: matchPlayers.rank,
        turnsSurvived: matchPlayers.turnsSurvived,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(eq(matchPlayers.userId, userId))
      .orderBy(desc(matches.endedAt))
      .limit(10);

    return {
      games: totals?.games ?? 0,
      wins: totals?.wins ?? 0,
      avgRank: totals?.avgRank ?? null,
      recent: recent.map((r) => ({ ...r, endedAt: r.endedAt.toISOString() })),
    };
  }

  async close() {
    await this.pool.end();
  }
}
