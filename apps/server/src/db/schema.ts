import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nickname: text('nickname').notNull(),
  avatar: text('avatar'),
  createdAt: time('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** 存的是 token 的 SHA-256，数据库泄露也拿不到能用的登录凭证 */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: time('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const matches = pgTable('matches', {
  id: text('id').primaryKey(),
  startedAt: time('started_at').notNull(),
  endedAt: time('ended_at').notNull(),
  playerCount: integer('player_count').notNull(),
});

export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    /** 座位号，一局内唯一 */
    seat: integer('seat').notNull(),
    /** 游客为空，不计战绩 */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 当时的昵称，游客也有 */
    nickname: text('nickname').notNull(),
    /** 1 = 最后活着的人 */
    rank: integer('rank').notNull(),
    turnsSurvived: integer('turns_survived').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.seat] }), index('match_players_user_idx').on(t.userId)],
);
