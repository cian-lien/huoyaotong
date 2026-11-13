import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStore } from '../src/store-pg.ts';

/**
 * 需要一个真实的 PostgreSQL：设置 TEST_DATABASE_URL 才会跑，否则跳过。
 *   TEST_DATABASE_URL=postgresql://hyt:hyt@localhost:5432/hyt_test pnpm test
 * 注意：会清空这个库里的四张表。
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgreSQL 存储', () => {
  let store: PgStore;

  beforeAll(async () => {
    store = new PgStore(url as string);
    await store.migrate(fileURLToPath(new URL('../drizzle', import.meta.url)));
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('TRUNCATE users, sessions, matches, match_players CASCADE');
    await client.end();
  });
  afterAll(() => store?.close());

  it('迁移可以重复执行', async () => {
    await store.migrate(fileURLToPath(new URL('../drizzle', import.meta.url)));
  });

  it('创建用户；邮箱重复返回 null', async () => {
    const user = await store.createUser({ email: 'a@example.com', passwordHash: 'hash', nickname: '红胡子' });
    expect(user).toMatchObject({ email: 'a@example.com', nickname: '红胡子', avatar: null });
    expect(await store.createUser({ email: 'a@example.com', passwordHash: 'x', nickname: '别人' })).toBeNull();
    expect(await store.findUserByEmail('a@example.com')).toMatchObject({ id: user?.id, passwordHash: 'hash' });
    expect(await store.findUserByEmail('nobody@example.com')).toBeNull();
  });

  it('改昵称和头像', async () => {
    const user = await store.findUserByEmail('a@example.com');
    expect(await store.updateProfile(user!.id, { avatar: '🦜' })).toMatchObject({ nickname: '红胡子', avatar: '🦜' });
    expect(await store.updateProfile(user!.id, {})).toMatchObject({ avatar: '🦜' });
    expect(await store.updateProfile('不存在', { nickname: 'x' })).toBeNull();
  });

  it('会话：有效期内能查到，过期或删除后查不到', async () => {
    const user = await store.findUserByEmail('a@example.com');
    await store.createSession('live', user!.id, new Date(Date.now() + 60_000));
    await store.createSession('expired', user!.id, new Date(Date.now() - 1000));
    const me = await store.getSessionUser('live');
    expect(me).toEqual({ id: user!.id, email: 'a@example.com', nickname: '红胡子', avatar: '🦜' });
    expect(await store.getSessionUser('expired')).toBeNull();
    expect(await store.getSessionUser('nope')).toBeNull();
    await store.deleteSession('live');
    expect(await store.getSessionUser('live')).toBeNull();
  });

  it('保存对局并统计战绩；游客不计入', async () => {
    const user = await store.findUserByEmail('a@example.com');
    const other = await store.createUser({ email: 'b@example.com', passwordHash: 'h', nickname: '独眼龙' });
    const at = (min: number) => new Date(Date.UTC(2026, 10, 13, 10, min));

    await store.saveMatch({
      startedAt: at(0),
      endedAt: at(8),
      players: [
        { seat: 0, userId: user!.id, nickname: '红胡子', rank: 1, turnsSurvived: 12 },
        { seat: 1, userId: other!.id, nickname: '独眼龙', rank: 3, turnsSurvived: 4 },
        { seat: 2, userId: null, nickname: '游客', rank: 2, turnsSurvived: 9 },
      ],
    });
    const second = await store.saveMatch({
      startedAt: at(10),
      endedAt: at(20),
      players: [
        { seat: 0, userId: other!.id, nickname: '独眼龙', rank: 1, turnsSurvived: 7 },
        { seat: 1, userId: user!.id, nickname: '红胡子', rank: 2, turnsSurvived: 6 },
      ],
    });

    const stats = await store.getStats(user!.id);
    expect(stats).toMatchObject({ games: 2, wins: 1, avgRank: 1.5 });
    expect(stats.recent).toEqual([
      { matchId: second, endedAt: at(20).toISOString(), playerCount: 2, rank: 2, turnsSurvived: 6 },
      { matchId: expect.any(String), endedAt: at(8).toISOString(), playerCount: 3, rank: 1, turnsSurvived: 12 },
    ]);
    expect(await store.getStats(other!.id)).toMatchObject({ games: 2, wins: 1, avgRank: 2 });
    expect(await store.getStats('没打过的人')).toEqual({ games: 0, wins: 0, avgRank: null, recent: [] });
  });
});
