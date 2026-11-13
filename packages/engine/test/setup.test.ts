import { describe, expect, it } from 'vitest';
import { buildBaseDeck, CARD_META } from '@hyt/shared';
import { createGame, seededRng, viewFor } from '../src/index.ts';

describe('开局', () => {
  it('底牌一共 55 张', () => {
    expect(buildBaseDeck()).toHaveLength(55);
    expect(new Set(buildBaseDeck().map((c) => c.id)).size).toBe(55);
  });

  it.each([2, 3, 4, 5])('%i 人局：每人 1 张灭火桶 + 7 张其他牌，火药桶比人数少一张', (n) => {
    const { state } = createGame(
      Array.from({ length: n }, (_, i) => `P${i}`),
      seededRng(n),
    );
    for (const p of state.players) {
      expect(p.hand).toHaveLength(8);
      expect(p.hand.filter((c) => c.kind === 'defuse')).toHaveLength(1);
      expect(p.hand.some((c) => c.kind === 'keg')).toBe(false);
    }
    expect(state.deck.filter((c) => c.kind === 'keg')).toHaveLength(n - 1);
    expect(state.deck.filter((c) => c.kind === 'defuse')).toHaveLength(CARD_META.defuse.count - n);
    expect(state.deck).toHaveLength(55 - 8 * n + (n - 1));

    const all = [...state.deck, ...state.players.flatMap((p) => p.hand)];
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('人数不对时拒绝开局', () => {
    expect(() => createGame(['只有我'], seededRng(1))).toThrow();
    expect(() => createGame(['1', '2', '3', '4', '5', '6'], seededRng(1))).toThrow();
  });

  it('同一个种子开出同一局', () => {
    const names = ['a', 'b', 'c'];
    expect(createGame(names, seededRng(7)).state).toEqual(createGame(names, seededRng(7)).state);
  });

  it('视图里看不到别人的手牌和货舱顺序', () => {
    const { state } = createGame(['a', 'b', 'c'], seededRng(3));
    const view = viewFor(state, 1);
    expect(view.myHand).toEqual(state.players[1]?.hand);
    expect(view.deckCount).toBe(state.deck.length);
    const json = JSON.stringify(view);
    for (const c of state.players[0]?.hand ?? []) expect(json).not.toContain(`"id":${c.id},`);
    expect(json).not.toContain('"deck"');
  });
});
