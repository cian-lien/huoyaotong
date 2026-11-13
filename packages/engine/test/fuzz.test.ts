import { describe, expect, it } from 'vitest';
import { applyAction, applyTimeout, botAction, createGame, forfeit, seededRng, type GameState } from '../src/index.ts';

/** 每一步之后都必须成立的事 */
function checkInvariants(state: GameState, totalCards: number) {
  const all = [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((p) => p.hand),
    ...(state.keg ? [state.keg.card] : []),
  ];
  // 牌不会凭空多出来或消失
  expect(all).toHaveLength(totalCards);
  expect(new Set(all.map((c) => c.id)).size).toBe(totalCards);
  // 火药桶永远不在手牌里
  expect(state.players.some((p) => p.hand.some((c) => c.kind === 'keg'))).toBe(false);

  const alive = state.players.filter((p) => p.alive);
  if (state.phase !== 'over') {
    // 货舱里的火药桶（加上正在放回的那个）= 存活人数 − 1
    const kegs = state.deck.filter((c) => c.kind === 'keg').length + (state.keg ? 1 : 0);
    expect(kegs).toBe(alive.length - 1);
    expect(state.players[state.currentSeat]?.alive).toBe(true);
    expect(state.turnsLeft).toBeGreaterThan(0);
  }
  for (const p of state.players) if (!p.alive) expect(p.hand).toHaveLength(0);
}

function playOut(playerCount: number, seed: number, quitChance = 0) {
  const rng = seededRng(seed);
  let { state } = createGame(
    Array.from({ length: playerCount }, (_, i) => `P${i}`),
    rng,
  );
  const total = state.deck.length + state.players.reduce((n, p) => n + p.hand.length, 0);

  for (let step = 0; state.phase !== 'over'; step++) {
    if (step > 3000) throw new Error(`种子 ${seed}：对局没有结束`);

    if (quitChance > 0 && rng(1000) < quitChance) {
      state = forfeit(state, rng(playerCount), rng).state;
      checkInvariants(state, total);
      continue;
    }

    let acted = false;
    for (const p of state.players) {
      const action = botAction(state, p.seat, rng);
      if (!action) continue;
      const res = applyAction(state, p.seat, action, rng);
      if (!res.ok) throw new Error(`种子 ${seed}：电脑玩家的操作被拒绝：${res.error}`);
      state = res.state;
      acted = true;
      break;
    }
    if (!acted) state = applyTimeout(state, rng).state;
    checkInvariants(state, total);
  }
  return state;
}

describe('随机对局', () => {
  it.each([2, 3, 4, 5])('%i 人随机打 150 局：每局都能正常结束，名次不重不漏', (n) => {
    for (let seed = 1; seed <= 150; seed++) {
      const state = playOut(n, seed * 31 + n);
      const ranks = state.players.map((p) => p.rank).sort();
      expect(ranks).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(state.players.filter((p) => p.alive)).toHaveLength(1);
    }
  });

  it('有人随时中途退出也不会打乱牌局', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = playOut(5, seed * 17, 15);
      const ranks = state.players.map((p) => p.rank).sort();
      expect(ranks).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
