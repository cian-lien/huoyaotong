import { describe, expect, it } from 'vitest';
import { forfeit } from '../src/index.ts';
import { act, idOf, makeState, zero } from './helpers.ts';

const kegs = (s: { deck: { kind: string }[] }) => s.deck.filter((c) => c.kind === 'keg').length;

describe('中途退出', () => {
  it('按出局处理，并拿走一个火药桶', () => {
    const s0 = makeState({ hands: [['skip'], ['skip'], ['skip']], deck: ['peek', 'keg', 'peek', 'keg'] });
    const { state } = forfeit(s0, 2, zero);
    expect(state.players[2]).toMatchObject({ alive: false, rank: 3 });
    expect(kegs(state)).toBe(1);
    expect(state.deck.map((c) => c.kind)).toEqual(['peek', 'peek', 'keg']);
    expect(state.currentSeat).toBe(0);
  });

  it('当前玩家退出：轮到下家', () => {
    const s0 = makeState({ hands: [['skip'], ['skip'], ['skip']], deck: ['peek', 'keg', 'keg'] });
    const { state } = forfeit(s0, 0, zero);
    expect(state.currentSeat).toBe(1);
    expect(state.phase).toBe('turn');
  });

  it('出了牌还在驳回窗口时退出：那张牌作废', () => {
    const s0 = makeState({ hands: [['skip'], ['skip'], ['skip']], deck: ['peek', 'keg', 'keg'] });
    const played = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'skip')] }).state;
    const { state } = forfeit(played, 0, zero);
    expect(state.pending).toBeNull();
    expect(state.phase).toBe('turn');
    expect(state.currentSeat).toBe(1);
  });

  it('被讨要的人退出：回到出牌阶段', () => {
    const s0 = makeState({ hands: [['favor'], ['skip'], ['skip']], deck: ['peek', 'keg', 'keg'] });
    let s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'favor')], targetSeat: 1 }).state;
    s = { ...s, phase: 'favor', pending: null, favor: { fromSeat: 0, targetSeat: 1 } };
    const { state } = forfeit(s, 1, zero);
    expect(state.phase).toBe('turn');
    expect(state.favor).toBeNull();
    expect(state.currentSeat).toBe(0);
  });

  it('拿着火药桶的人退出：带着火药桶出局', () => {
    const s0 = makeState({ hands: [['defuse'], ['skip'], ['skip']], deck: ['keg', 'peek', 'keg'] });
    const drawn = act(s0, 0, { type: 'draw' }).state;
    const { state } = forfeit(drawn, 0, zero);
    expect(state.keg).toBeNull();
    expect(kegs(state)).toBe(1);
    expect(state.phase).toBe('turn');
    expect(state.currentSeat).toBe(1);
  });

  it('只剩两人时一人退出：对局结束', () => {
    const s0 = makeState({ hands: [['skip'], ['skip']], deck: ['peek', 'keg'] });
    const { state, events } = forfeit(s0, 1, zero);
    expect(state.phase).toBe('over');
    expect(state.players.map((p) => p.rank)).toEqual([1, 2]);
    expect(events.at(-1)?.type).toBe('gameOver');
  });

  it('已经出局的人退出：什么也不发生', () => {
    const s0 = makeState({ hands: [[], [], []], deck: ['keg', 'keg', 'peek'] });
    const out = act(s0, 0, { type: 'draw' }).state;
    expect(forfeit(out, 0, zero)).toEqual({ state: out, events: [] });
  });
});
