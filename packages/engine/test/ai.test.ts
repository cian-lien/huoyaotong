import { describe, expect, it } from 'vitest';
import type { CardKind, GameEvent } from '@hyt/shared';
import { applyAction, applyTimeout, botDecide, createGame, drawRisk, seededRng, type GameState } from '../src/index.ts';
import { act, idOf, makeState, playAndResolve, zero } from './helpers.ts';

/** rng 恒为 0：所有“有概率”的决定都会发生（概率为 0 的除外） */
const always = zero;
/** rng 恒为 99：所有“有概率”的决定都不发生 */
const never = (n: number) => Math.min(99, n - 1);

describe('电脑玩家：自己的回合', () => {
  it('风险低、手里有灭火桶：直接摸牌', () => {
    const s = makeState({ hands: [['defuse', 'skip'], ['skip']], deck: ['peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'keg'] });
    expect(drawRisk(s)).toBeCloseTo(1 / 7);
    expect(botDecide(s, 0, never)).toEqual({ type: 'draw' });
  });

  it('风险高、没有灭火桶：用溜号躲掉', () => {
    const s = makeState({ hands: [['skip', 'shuffle'], []], deck: ['peek', 'keg'] });
    expect(botDecide(s, 0, never)).toEqual({ type: 'play', cardIds: [idOf(s, 0, 'skip')], targetSeat: undefined });
  });

  it('被甩锅要连摸几张时：优先甩回去', () => {
    const s = makeState({ hands: [['skip', 'attack', 'defuse'], []], deck: ['peek', 'keg'] });
    s.turnsLeft = 2;
    s.underAttack = true;
    expect(botDecide(s, 0, never)).toMatchObject({ type: 'play', cardIds: [idOf(s, 0, 'attack')] });
  });

  it('风险高且有办法应对时：先用望远镜看一眼', () => {
    const s = makeState({ hands: [['peek', 'skip'], []], deck: ['peek', 'keg'] });
    expect(botDecide(s, 0, never)).toMatchObject({ type: 'play', cardIds: [idOf(s, 0, 'peek')] });
  });

  it('看到货舱顶是火药桶：躲；没牌可躲就翻货舱；都没有只能摸', () => {
    const top = { knownTop: 'keg' as CardKind };
    const a = makeState({ hands: [['reverse', 'shuffle'], []], deck: ['keg', 'peek'] });
    expect(botDecide(a, 0, never, top)).toMatchObject({ cardIds: [idOf(a, 0, 'reverse')] });
    const b = makeState({ hands: [['shuffle', 'defuse'], []], deck: ['keg', 'peek'] });
    expect(botDecide(b, 0, never, top)).toMatchObject({ cardIds: [idOf(b, 0, 'shuffle')] });
    const c = makeState({ hands: [['favor'], []], deck: ['keg', 'peek'] });
    expect(botDecide(c, 0, never, top)).toEqual({ type: 'draw' });
  });

  it('看到货舱顶是安全牌：放心摸，不浪费躲避牌', () => {
    const s = makeState({ hands: [['skip'], []], deck: ['peek', 'keg'] });
    expect(botDecide(s, 0, never, { knownTop: 'peek' })).toEqual({ type: 'draw' });
  });

  it('没有灭火桶：用对子去抽手牌最多的人', () => {
    const s = makeState({
      hands: [['crew_cook', 'crew_cook'], ['skip'], ['skip', 'skip', 'defuse']],
      deck: ['peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'peek', 'keg', 'keg'],
    });
    expect(botDecide(s, 0, never)).toMatchObject({ type: 'play', targetSeat: 2 });
    expect(botDecide(s, 0, never)).not.toHaveProperty('namedCard', 'defuse');
  });

  it('没有灭火桶且有三张相同：点名要灭火桶', () => {
    const s = makeState({ hands: [['crew_cook', 'crew_cook', 'crew_cook'], ['skip']], deck: ['peek', 'keg'] });
    expect(botDecide(s, 0, never)).toMatchObject({ type: 'play', targetSeat: 1, namedCard: 'defuse' });
  });

  it('没轮到它时不行动', () => {
    const s = makeState({ hands: [['skip'], ['skip']], deck: ['peek', 'keg'] });
    expect(botDecide(s, 1, always)).toBeNull();
  });

  it('出局后不行动', () => {
    const s = makeState({ hands: [[], [], []], deck: ['keg', 'keg', 'peek'] });
    const out = act(s, 0, { type: 'draw' }).state;
    expect(botDecide(out, 0, always)).toBeNull();
  });
});

describe('电脑玩家：驳回', () => {
  it('被讨要时大概率驳回；不关它事时基本不管', () => {
    const s0 = makeState({ hands: [['favor'], ['nope', 'skip'], ['nope']], deck: ['peek', 'keg', 'keg'] });
    const s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'favor')], targetSeat: 1 }).state;
    expect(botDecide(s, 1, always)).toEqual({ type: 'nope', cardId: idOf(s, 1, 'nope') });
    expect(botDecide(s, 1, never)).toBeNull();
    expect(botDecide(s, 2, (n) => (n === 100 ? 50 : 0))).toBeNull();
  });

  it('甩锅甩到它头上时会驳回', () => {
    const s0 = makeState({ hands: [['attack'], ['nope'], ['nope']], deck: ['peek', 'keg', 'keg'] });
    const s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'attack')] }).state;
    expect(botDecide(s, 1, (n) => (n === 100 ? 60 : 0))).toMatchObject({ type: 'nope' });
    expect(botDecide(s, 2, (n) => (n === 100 ? 60 : 0))).toBeNull();
  });

  it('别人已经替它挡掉了，就不再浪费驳回', () => {
    const s0 = makeState({ hands: [['favor'], ['nope'], ['nope']], deck: ['peek', 'keg', 'keg'] });
    let s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'favor')], targetSeat: 1 }).state;
    s = act(s, 2, { type: 'nope', cardId: idOf(s, 2, 'nope') }).state;
    expect(botDecide(s, 1, always)).toBeNull();
  });

  it('自己的牌被驳回：可能驳回去', () => {
    const s0 = makeState({ hands: [['skip', 'nope'], ['nope']], deck: ['peek', 'keg'] });
    let s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'skip')] }).state;
    expect(botDecide(s, 0, always)).toBeNull(); // 不能驳回自己刚出的牌
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    expect(botDecide(s, 0, always)).toEqual({ type: 'nope', cardId: idOf(s, 0, 'nope') });
  });

  it('没有驳回牌就不驳回', () => {
    const s0 = makeState({ hands: [['favor'], ['skip']], deck: ['peek', 'keg'] });
    const s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'favor')], targetSeat: 1 }).state;
    expect(botDecide(s, 1, always)).toBeNull();
  });
});

describe('电脑玩家：给牌和放回火药桶', () => {
  it('被讨要时给最没用的牌，灭火桶留到最后', () => {
    const s0 = makeState({ hands: [['favor'], ['defuse', 'nope', 'crew_parrot', 'skip']], deck: ['peek', 'keg'] });
    const { state } = playAndResolve(s0, 0, ['favor'], { targetSeat: 1 });
    expect(botDecide(state, 1, always)).toEqual({ type: 'giveCard', cardId: idOf(state, 1, 'crew_parrot') });

    const s1 = makeState({ hands: [['favor'], ['defuse']], deck: ['peek', 'keg'] });
    const only = playAndResolve(s1, 0, ['favor'], { targetSeat: 1 }).state;
    expect(botDecide(only, 1, always)).toEqual({ type: 'giveCard', cardId: idOf(only, 1, 'defuse') });
  });

  it('拆掉火药桶后把它放回货舱范围内的位置', () => {
    const s0 = makeState({ hands: [['defuse'], []], deck: ['keg', 'peek', 'peek', 'peek', 'peek', 'peek'] });
    const s = act(s0, 0, { type: 'draw' }).state;
    for (let seed = 1; seed <= 50; seed++) {
      const action = botDecide(s, 0, seededRng(seed));
      expect(action?.type).toBe('placeKeg');
      expect(applyAction(s, 0, action!, zero).ok).toBe(true);
    }
    expect(botDecide(s, 1, always)).toBeNull();
  });
});

describe('电脑互打', () => {
  /** 和房间服务一样：只记电脑自己用望远镜看到的货舱顶，牌堆一动就作废 */
  function remember(known: (CardKind | null)[], events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'peeked') known[e.to] = e.cards[0]?.kind ?? null;
      else if (e.type === 'drew' || e.type === 'kegPlaced' || (e.type === 'resolved' && e.effect === 'shuffle')) known.fill(null);
    }
  }

  it.each([2, 3, 4, 5])('%i 个电脑打 100 局：每一步都合法，每局都能打完', (n) => {
    let totalSteps = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const rng = seededRng(seed * 13 + n);
      let state: GameState = createGame(
        Array.from({ length: n }, (_, i) => `电脑${i}`),
        rng,
      ).state;
      const known: (CardKind | null)[] = Array(n).fill(null);

      for (let step = 0; state.phase !== 'over'; step++) {
        if (step > 2000) throw new Error(`种子 ${seed}：对局没有结束`);
        totalSteps++;
        let acted = false;
        for (const p of state.players) {
          const action = botDecide(state, p.seat, rng, { knownTop: known[p.seat] ?? null });
          if (!action) continue;
          const res = applyAction(state, p.seat, action, rng);
          if (!res.ok) throw new Error(`种子 ${seed}：电脑的操作被拒绝：${res.error}（${JSON.stringify(action)}）`);
          state = res.state;
          remember(known, res.events);
          acted = true;
          break;
        }
        if (!acted) {
          // 只有驳回窗口会没人行动；其他阶段电脑必须自己做决定，不能靠超时
          expect(state.phase).toBe('nope');
          const res = applyTimeout(state, rng);
          state = res.state;
          remember(known, res.events);
        }
      }
      expect(state.players.map((p) => p.rank).sort()).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
    expect(totalSteps).toBeGreaterThan(100 * n * 5);
  });
});
