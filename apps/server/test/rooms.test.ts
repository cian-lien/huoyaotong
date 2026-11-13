import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '@hyt/shared';
import { autoPlay, createRoom, harness, joinRoom, playAgain, send, startGame, until, unwrap, type Client, type Harness } from './helpers.ts';

let h: Harness;
afterEach(() => h.close());

/** 开一个 n 人房间并让所有人进来 */
async function lobby(n: number, cookies: (string | undefined)[] = []) {
  const clients: Client[] = [];
  const host = await h.client(cookies[0]);
  clients.push(host);
  const created = unwrap(await createRoom(host, '玩家0'));
  const tokens = [created.seatToken];
  for (let i = 1; i < n; i++) {
    const c = await h.client(cookies[i]);
    clients.push(c);
    tokens.push(unwrap(await joinRoom(c, created.code, { nickname: `玩家${i}` })).seatToken);
  }
  await until(() => clients.every((c) => c.lastRoom?.players.length === n), '所有人都看到满员的大厅');
  return { code: created.code, clients, tokens };
}

describe('房间', () => {
  it('创建房间得到 6 位房间号，其他人凭房间号加入', async () => {
    h = await harness();
    const { code, clients } = await lobby(3);
    expect(code).toMatch(/^\d{6}$/);
    expect(clients[2]?.lastRoom).toMatchObject({ status: 'lobby', hostSeat: 0, mySeat: 2 });
    expect(clients[0]?.lastRoom?.players.map((p) => p.nickname)).toEqual(['玩家0', '玩家1', '玩家2']);
  });

  it('游客必须有昵称；重名的自动加序号', async () => {
    h = await harness();
    const a = await h.client();
    expect(await createRoom(a)).toEqual({ ok: false, error: '请先起一个昵称' });
    const { code } = unwrap(await createRoom(a, '船长'));
    const b = await h.client();
    unwrap(await joinRoom(b, code, { nickname: '船长' }));
    await until(() => a.lastRoom?.players.length === 2, '第二个人进来');
    expect(a.lastRoom?.players.map((p) => p.nickname)).toEqual(['船长', '船长2']);
  });

  it('登录用户用账号昵称，游客标记为游客', async () => {
    h = await harness();
    const cookie = await h.register('a@example.com', '红胡子');
    const { clients } = await lobby(2, [cookie]);
    expect(clients[1]?.lastRoom?.players).toMatchObject([
      { nickname: '红胡子', isGuest: false },
      { nickname: '玩家1', isGuest: true },
    ]);
  });

  it('房间不存在、房间号格式不对、满员都会被拒绝', async () => {
    h = await harness();
    const { code } = await lobby(5);
    const late = await h.client();
    expect(await joinRoom(late, '000000', { nickname: 'x' })).toMatchObject({ ok: false, error: '房间不存在，可能已经解散了' });
    expect(await joinRoom(late, 'abc', { nickname: 'x' })).toMatchObject({ ok: false });
    expect(await joinRoom(late, code, { nickname: 'x' })).toMatchObject({ ok: false, error: '房间满了（最多 5 人）' });
  });

  it('只有房主能开始，且至少要 2 个人', async () => {
    h = await harness();
    const solo = await h.client();
    unwrap(await createRoom(solo, '独行侠'));
    expect(await startGame(solo)).toEqual({ ok: false, error: '至少要 2 个人才能开始' });

    const { clients } = await lobby(2);
    expect(await startGame(clients[1] as Client)).toEqual({ ok: false, error: '只有房主能开始' });
    expect(await startGame(clients[0] as Client)).toEqual({ ok: true });
  });

  it('大厅里有人离开：座位重新编号；房主离开：房主换人', async () => {
    h = await harness();
    const { clients } = await lobby(3);
    clients[0]?.emit('room:leave');
    await until(() => clients[2]?.lastRoom?.players.length === 2, '房主离开后剩两人');
    expect(clients[2]?.lastRoom).toMatchObject({ hostSeat: 0, mySeat: 1 });
    expect(clients[1]?.lastRoom).toMatchObject({ hostSeat: 0, mySeat: 0 });
    expect(await startGame(clients[1] as Client)).toEqual({ ok: true });
  });

  it('所有人都走了，房间解散', async () => {
    h = await harness();
    const { clients } = await lobby(2);
    for (const c of clients) c.emit('room:leave');
    await until(() => h.app.rooms.roomCount === 0, '房间解散');
  });

  it('对局开始后不能中途加入', async () => {
    h = await harness();
    const { code, clients } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    const late = await h.client();
    expect(await joinRoom(late, code, { nickname: '迟到的人' })).toEqual({ ok: false, error: '对局已经开始，不能中途加入' });
  });
});

describe('对局', () => {
  it('每个人只看得到自己的手牌，货舱只有张数', async () => {
    h = await harness();
    const { clients } = await lobby(3);
    unwrap(await startGame(clients[0] as Client));
    const views = await until(
      () => (clients.every((c) => c.lastView) ? clients.map((c) => c.lastView!) : null),
      '所有人收到牌局视图',
    );
    for (const v of views) {
      expect(v.myHand).toHaveLength(8);
      expect(v.deckCount).toBe(55 - 24 + 2);
      expect(v.players.map((p) => p.handCount)).toEqual([8, 8, 8]);
      expect(v.deadline).toBeGreaterThan(Date.now());
    }
    const ids = views.map((v) => new Set(v.myHand.map((c) => c.id)));
    for (const id of ids[0] ?? []) expect(ids[1]?.has(id) || ids[2]?.has(id)).toBe(false);
    expect(JSON.stringify(views[0])).not.toContain('"deck":');
  });

  it('服务器拒绝不合法的操作：没轮到、乱编的牌、看不懂的消息', async () => {
    h = await harness();
    const { clients } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    const view = await until(() => clients[0]?.lastView, '收到视图');
    const other = clients[view.currentSeat === 0 ? 1 : 0] as Client;
    const current = clients[view.currentSeat] as Client;

    expect(await send(other, { type: 'draw' })).toEqual({ ok: false, error: '还没轮到你' });
    expect(await send(current, { type: 'play', cardIds: [99999] })).toEqual({ ok: false, error: '这张牌不在你手里' });
    // @ts-expect-error 故意发一个不存在的操作
    expect(await send(current, { type: 'cheat', showDeck: true })).toEqual({ ok: false, error: '看不懂这个操作' });
    // @ts-expect-error 故意发错类型
    expect(await send(current, { type: 'play', cardIds: 'all' })).toEqual({ ok: false, error: '看不懂这个操作' });
  });

  it('三个人打完一整局：结算排名正确，战绩写进数据库', async () => {
    h = await harness({ nope: 10, turn: 3000, favor: 3000, placeKeg: 3000 });
    const cookie = await h.register('a@example.com', '红胡子');
    const { clients } = await lobby(3, [cookie]);
    const log: GameEvent[] = [];
    clients[0]?.on('game:events', (events) => log.push(...events));
    for (const c of clients) autoPlay(c);
    unwrap(await startGame(clients[0] as Client));

    await until(() => clients.every((c) => c.lastRoom?.status === 'over'), '对局结束', 20_000);
    const rankingSeen = clients[1]?.lastRoom?.ranking ?? [];
    expect(rankingSeen.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(log.at(-1)?.type).toBe('gameOver');
    expect(log.filter((e) => e.type === 'eliminated')).toHaveLength(2);

    const match = await until(() => h.store.matches[0], '战绩入库');
    expect(match.players.map((p) => p.rank).sort()).toEqual([1, 2, 3]);
    const userId = [...h.store.users.values()][0]?.id;
    expect(match.players.find((p) => p.seat === 0)).toMatchObject({ userId, nickname: '红胡子' });
    expect(match.players.filter((p) => p.userId === null)).toHaveLength(2);

    const stats = await h.app.fastify.inject({ method: 'GET', url: '/api/me/stats', headers: { cookie } });
    expect(stats.json()).toMatchObject({ games: 1, recent: [{ playerCount: 3 }] });
  }, 30_000);

  it('出牌后进入驳回窗口，到时自动结算', async () => {
    h = await harness({ nope: 80 });
    const { clients } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    // 找一个手里有“不需要目标的牌”的当前玩家；没有就让他摸牌换人
    for (let i = 0; i < 40; i++) {
      const view = await until(() => clients[0]?.lastView, '视图');
      const me = clients[view.currentSeat] as Client;
      const mine = await until(() => (me.lastView?.currentSeat === me.lastView?.mySeat ? me.lastView : null), '轮到我');
      if (mine.phase === 'placeKeg') {
        unwrap(await send(me, { type: 'placeKeg', position: mine.deckCount }));
        continue;
      }
      const card = mine.myHand.find((c) => c.kind === 'skip' || c.kind === 'peek' || c.kind === 'shuffle');
      if (!card) {
        unwrap(await send(me, { type: 'draw' }));
        await until(() => me.lastView !== mine, '摸牌后视图更新');
        continue;
      }
      unwrap(await send(me, { type: 'play', cardIds: [card.id] }));
      const pending = await until(() => (me.lastView?.phase === 'nope' ? me.lastView : null), '进入驳回窗口');
      expect(pending.pending).toMatchObject({ bySeat: mine.mySeat, nopeCount: 0 });
      expect(pending.deadline! - pending.serverNow).toBeLessThanOrEqual(80);
      await until(() => me.lastView?.phase !== 'nope', '驳回窗口到时');
      return;
    }
    throw new Error('40 个回合都没摸到能出的牌，不太可能');
  });

  it('轮到的人一直不动：超时自动摸牌', async () => {
    h = await harness({ turn: 60 });
    const { clients } = await lobby(2);
    const events: GameEvent[] = [];
    clients[0]?.on('game:events', (e) => events.push(...e));
    unwrap(await startGame(clients[0] as Client));
    await until(() => events.some((e) => e.type === 'timeout'), '超时事件');
    expect(events.some((e) => e.type === 'drew')).toBe(true);
  });
});

describe('断线重连', () => {
  it('凭座位凭证回来：座位和手牌都还在', async () => {
    h = await harness({ turn: 5000, disconnectedTurn: 5000 });
    const { code, clients, tokens } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    const before = await until(() => clients[1]?.lastView, '开局视图');

    clients[1]?.disconnect();
    await until(() => clients[0]?.lastView?.players[1]?.connected === false, '其他人看到他掉线');

    const back = await h.client();
    const res = unwrap(await joinRoom(back, code, { seatToken: tokens[1] }));
    expect(res.seat).toBe(1);
    const after = await until(() => back.lastView, '重连后收到视图');
    expect(after.myHand).toEqual(before.myHand);
    await until(() => clients[0]?.lastView?.players[1]?.connected === true, '其他人看到他回来');
  });

  it('凭证不对就进不来', async () => {
    h = await harness();
    const { code, clients } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    const thief = await h.client();
    expect(await joinRoom(thief, code, { seatToken: 'f'.repeat(48) })).toMatchObject({ ok: false });
  });

  it('登录用户换设备：同一个账号直接接管原来的座位', async () => {
    h = await harness({ turn: 5000 });
    const cookie = await h.register('a@example.com', '红胡子');
    const { code, clients } = await lobby(2, [cookie]);
    unwrap(await startGame(clients[0] as Client));
    const before = await until(() => clients[0]?.lastView, '开局视图');

    let closed = '';
    clients[0]?.on('room:closed', (reason) => (closed = reason));
    const phone = await h.client(cookie);
    expect(unwrap(await joinRoom(phone, code)).seat).toBe(0);
    expect((await until(() => phone.lastView, '新设备收到视图')).myHand).toEqual(before.myHand);
    await until(() => closed !== '', '旧窗口收到通知');
    expect(await send(clients[0] as Client, { type: 'draw' })).toEqual({ ok: false, error: '你不在房间里' });
  });

  it('掉线超过保留时间：按出局处理，剩下的人获胜', async () => {
    h = await harness({ seatHold: 80, turn: 5000, disconnectedTurn: 5000 });
    const { clients } = await lobby(2);
    unwrap(await startGame(clients[0] as Client));
    await until(() => clients[1]?.lastView, '开局视图');
    clients[1]?.disconnect();
    await until(() => clients[0]?.lastRoom?.status === 'over', '对局结束');
    expect(clients[0]?.lastRoom?.ranking).toMatchObject([
      { seat: 0, rank: 1 },
      { seat: 1, rank: 2 },
    ]);
  });

  it('轮到掉线的人时用更短的计时', async () => {
    h = await harness({ turn: 5000, disconnectedTurn: 40, seatHold: 5000 });
    const { clients } = await lobby(2);
    const events: GameEvent[] = [];
    clients[0]?.on('game:events', (e) => events.push(...e));
    unwrap(await startGame(clients[0] as Client));
    await until(() => clients[1]?.lastView, '开局视图');
    clients[1]?.disconnect();
    // 让在线的人一直摸牌，轮到掉线的人时应该很快超时
    autoPlay(clients[0] as Client);
    if (clients[0]?.lastView?.currentSeat === 0) await send(clients[0] as Client, { type: 'draw' });
    await until(() => events.some((e) => e.type === 'timeout' && e.seat === 1), '掉线的人被自动摸牌', 3000);
  });
});

describe('再来一局', () => {
  it('结算后房主可以把大家带回大厅重新开始', async () => {
    h = await harness({ seatHold: 30 });
    const { clients } = await lobby(3);
    unwrap(await startGame(clients[0] as Client));
    await until(() => clients[2]?.lastView, '开局视图');
    expect(await playAgain(clients[0] as Client)).toEqual({ ok: false, error: '这一局还没结束' });

    // 两个人主动离开，直接结束这一局
    clients[1]?.emit('room:leave');
    clients[2]?.emit('room:leave');
    await until(() => clients[0]?.lastRoom?.status === 'over', '对局结束');

    expect(await playAgain(clients[0] as Client)).toEqual({ ok: true });
    await until(() => clients[0]?.lastRoom?.status === 'lobby', '回到大厅');
    expect(clients[0]?.lastRoom?.players).toHaveLength(1);
    expect(clients[0]?.lastRoom?.ranking).toBeNull();
  });
});
