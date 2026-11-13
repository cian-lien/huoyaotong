import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '@hyt/shared';
import { addBot, autoPlay, createRoom, harness, joinRoom, playAgain, removeBot, send, startGame, until, unwrap, type Harness } from './helpers.ts';

let h: Harness;
afterEach(() => h.close());

/** 电脑想得很快、驳回窗口很短，让测试几秒内打完 */
const FAST = { botThink: 6, nope: 30, turn: 4000, favor: 4000, placeKeg: 4000 };

describe('电脑玩家：大厅', () => {
  it('开房间时可以直接带上电脑，电脑有标记、算在线、不算游客', async () => {
    h = await harness();
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子', 2));
    const room = await until(() => me.lastRoom, '大厅状态');
    expect(room.players).toMatchObject([
      { seat: 0, nickname: '红胡子', isBot: false, isGuest: true },
      { seat: 1, nickname: '电脑·铁钩', isBot: true, isGuest: false, connected: true, avatar: '🤖' },
      { seat: 2, nickname: '电脑·老船长', isBot: true },
    ]);
    expect(room.hostSeat).toBe(0);
  });

  it('房主可以在大厅里加电脑、移除电脑，名字不重复', async () => {
    h = await harness();
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子'));
    for (let i = 0; i < 4; i++) expect(await addBot(me)).toEqual({ ok: true });
    await until(() => me.lastRoom?.players.length === 5, '加满 4 个电脑');
    expect(new Set(me.lastRoom?.players.map((p) => p.nickname)).size).toBe(5);
    expect(await addBot(me)).toEqual({ ok: false, error: '房间满了（最多 5 人）' });

    expect(await removeBot(me, 2)).toEqual({ ok: true });
    await until(() => me.lastRoom?.players.length === 4, '移除一个');
    expect(me.lastRoom?.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(await removeBot(me, 0)).toEqual({ ok: false, error: '这个座位不是电脑玩家' });
    expect(await removeBot(me, 9)).toEqual({ ok: false, error: '这个座位不是电脑玩家' });
  });

  it('不是房主不能加、不能移除电脑', async () => {
    h = await harness();
    const host = await h.client();
    const { code } = unwrap(await createRoom(host, '房主', 1));
    const guest = await h.client();
    unwrap(await joinRoom(guest, code, { nickname: '客人' }));
    expect(await addBot(guest)).toEqual({ ok: false, error: '只有房主能加电脑玩家' });
    expect(await removeBot(guest, 1)).toEqual({ ok: false, error: '只有房主能移除电脑玩家' });
  });

  it('开房间时电脑人数超出范围会被拒绝', async () => {
    h = await harness();
    const me = await h.client();
    expect(await createRoom(me, '红胡子', 5)).toMatchObject({ ok: false });
    expect(await createRoom(me, '红胡子', -1)).toMatchObject({ ok: false });
  });

  it('别人不能冒充电脑的座位进房间', async () => {
    h = await harness();
    const host = await h.client();
    const { code } = unwrap(await createRoom(host, '房主', 4));
    const late = await h.client();
    expect(await joinRoom(late, code, { nickname: '电脑·铁钩' })).toEqual({ ok: false, error: '房间满了（最多 5 人）' });
  });

  it('真人都走了，只剩电脑的房间会解散', async () => {
    h = await harness(FAST);
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子', 3));
    unwrap(await startGame(me));
    await until(() => me.lastView, '开局');
    me.emit('room:leave');
    await until(() => h.app.rooms.roomCount === 0, '房间解散');
  });
});

describe('电脑玩家：对局', () => {
  it('一个人对两个电脑能打完一整局，电脑会自己出牌', async () => {
    h = await harness(FAST);
    const me = await h.client();
    const log: GameEvent[] = [];
    me.on('game:events', (e) => log.push(...e));
    autoPlay(me);
    unwrap(await createRoom(me, '红胡子', 2));
    unwrap(await startGame(me));

    await until(() => me.lastRoom?.status === 'over', '对局结束', 20_000);
    expect(me.lastRoom?.ranking?.map((r) => r.rank)).toEqual([1, 2, 3]);
    // 电脑确实自己摸过牌，而不是全靠超时
    expect(log.some((e) => e.type === 'drew' && e.seat !== 0)).toBe(true);
    expect(log.some((e) => e.type === 'timeout' && e.seat !== 0)).toBe(false);
  }, 30_000);

  it('真人什么都不做、很快出局后，电脑之间会把这一局打完', async () => {
    h = await harness({ ...FAST, turn: 40 });
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子', 4));
    unwrap(await startGame(me));
    await until(() => me.lastRoom?.status === 'over', '对局结束', 25_000);
    expect(me.lastRoom?.ranking).toHaveLength(5);
  }, 30_000);

  it('人机局不记战绩', async () => {
    h = await harness(FAST);
    const cookie = await h.register('a@example.com', '红胡子');
    const me = await h.client(cookie);
    autoPlay(me);
    unwrap(await createRoom(me, undefined, 1));
    unwrap(await startGame(me));
    await until(() => me.lastRoom?.status === 'over', '对局结束', 20_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.store.matches).toHaveLength(0);
    const stats = await h.app.fastify.inject({ method: 'GET', url: '/api/me/stats', headers: { cookie } });
    expect(stats.json()).toMatchObject({ games: 0 });
  }, 30_000);

  it('电脑的手牌和别人一样对真人保密', async () => {
    h = await harness({ botThink: 5000 });
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子', 2));
    unwrap(await startGame(me));
    const view = await until(() => me.lastView, '开局');
    expect(view.myHand).toHaveLength(8);
    expect(view.players.map((p) => p.handCount)).toEqual([8, 8, 8]);
    expect(view.players.every((p) => p.connected)).toBe(true);
    expect(JSON.stringify(view).match(/"id":/g)).toHaveLength(8);
  });

  it('轮到电脑时真人不能替它出牌', async () => {
    h = await harness({ botThink: 5000, turn: 5000 });
    const me = await h.client();
    unwrap(await createRoom(me, '红胡子', 1));
    // 多开几局，直到碰上电脑先手
    for (let i = 0; i < 30; i++) {
      unwrap(await startGame(me));
      const view = await until(() => (me.lastRoom?.status === 'playing' ? me.lastView : null), '开局');
      if (view.currentSeat === 1) {
        expect(await send(me, { type: 'draw' })).toEqual({ ok: false, error: '还没轮到你' });
        return;
      }
      h.app.rooms.shutdown();
      me.lastView = null;
      me.lastRoom = null;
      unwrap(await createRoom(me, '红胡子', 1));
    }
    throw new Error('30 局都是真人先手，不太可能');
  });

  it('再来一局时电脑留在房间里', async () => {
    h = await harness(FAST);
    const me = await h.client();
    autoPlay(me);
    unwrap(await createRoom(me, '红胡子', 2));
    unwrap(await startGame(me));
    await until(() => me.lastRoom?.status === 'over', '对局结束', 20_000);
    expect(await playAgain(me)).toEqual({ ok: true });
    await until(() => me.lastRoom?.status === 'lobby', '回到大厅');
    expect(me.lastRoom?.players.map((p) => p.isBot)).toEqual([false, true, true]);
    expect(await startGame(me)).toEqual({ ok: true });
  }, 30_000);

  it('真人和电脑混着玩：两个真人加一个电脑', async () => {
    h = await harness(FAST);
    const a = await h.client();
    const { code } = unwrap(await createRoom(a, '红胡子', 1));
    const b = await h.client();
    unwrap(await joinRoom(b, code, { nickname: '独眼龙' }));
    autoPlay(a);
    autoPlay(b);
    unwrap(await startGame(a));
    await until(() => a.lastRoom?.status === 'over' && b.lastRoom?.status === 'over', '对局结束', 20_000);
    expect(b.lastRoom?.ranking?.map((r) => r.nickname).sort()).toEqual(['独眼龙', '电脑·铁钩', '红胡子'].sort());
    expect(h.store.matches).toHaveLength(0);
  }, 30_000);
});
