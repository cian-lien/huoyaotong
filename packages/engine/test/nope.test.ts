import { describe, expect, it } from 'vitest';
import { resolvePending } from '../src/index.ts';
import { act, handOf, idOf, makeState, reject, types, zero } from './helpers.ts';

function setup() {
  const s0 = makeState({ hands: [['skip', 'nope'], ['nope', 'nope'], ['nope']], deck: ['peek', 'keg', 'keg'] });
  return act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'skip')] }).state;
}

describe('驳回', () => {
  it('出牌后先不生效，进入驳回窗口', () => {
    const s = setup();
    expect(s.phase).toBe('nope');
    expect(s.pending).toMatchObject({ bySeat: 0, effect: 'skip' });
    expect(s.currentSeat).toBe(0);
    expect(reject(s, 0, { type: 'draw' })).toBe('现在不能摸牌');
  });

  it('没人驳回：生效', () => {
    const { state, events } = resolvePending(setup(), zero);
    expect(state.currentSeat).toBe(1);
    expect(types(events)).toContain('resolved');
  });

  it('1 张驳回：取消，出牌的人继续自己的回合', () => {
    let s = setup();
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    const { state, events } = resolvePending(s, zero);
    expect(state.currentSeat).toBe(0);
    expect(state.phase).toBe('turn');
    expect(handOf(state, 0)).toEqual(['nope']); // 溜号已经用掉了
    expect(types(events)).toEqual(['cancelled']);
  });

  it('2 张驳回：驳回被驳回，原来的牌生效', () => {
    let s = setup();
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    s = act(s, 0, { type: 'nope', cardId: idOf(s, 0, 'nope') }).state;
    expect(s.pending?.nopes).toHaveLength(2);
    expect(resolvePending(s, zero).state.currentSeat).toBe(1);
  });

  it('3 张驳回：又被取消', () => {
    let s = setup();
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    s = act(s, 2, { type: 'nope', cardId: idOf(s, 2, 'nope') }).state;
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    expect(resolvePending(s, zero).state.currentSeat).toBe(0);
  });

  it('不能驳回自己刚出的牌，也不能连着驳回自己的驳回', () => {
    let s = setup();
    expect(reject(s, 0, { type: 'nope', cardId: idOf(s, 0, 'nope') })).toBe('不能驳回自己刚出的牌');
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    expect(reject(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') })).toBe('不能驳回自己刚出的牌');
  });

  it('必须真的有驳回牌', () => {
    const s = setup();
    expect(reject(s, 1, { type: 'nope', cardId: idOf(s, 0, 'nope') })).toBe('你没有这张驳回');
  });

  it('不在驳回窗口时不能驳回', () => {
    const s0 = makeState({ hands: [['skip'], ['nope']], deck: ['keg'] });
    expect(reject(s0, 1, { type: 'nope', cardId: idOf(s0, 1, 'nope') })).toBe('现在没有可以驳回的牌');
  });

  it('出局的人不能驳回', () => {
    const s = setup();
    (s.players[2] as { alive: boolean }).alive = false;
    expect(reject(s, 2, { type: 'nope', cardId: idOf(s, 2, 'nope') })).toBe('你已经出局了');
  });

  it('被驳回的讨要不会进入给牌阶段', () => {
    const s0 = makeState({ hands: [['favor'], ['nope', 'skip']], deck: ['keg'] });
    let s = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'favor')], targetSeat: 1 }).state;
    s = act(s, 1, { type: 'nope', cardId: idOf(s, 1, 'nope') }).state;
    const { state } = resolvePending(s, zero);
    expect(state.phase).toBe('turn');
    expect(state.favor).toBeNull();
    expect(handOf(state, 1)).toEqual(['skip']);
  });

  it('不在驳回窗口时结算会报错', () => {
    const s0 = makeState({ hands: [[], []], deck: ['keg'] });
    expect(() => resolvePending(s0, zero)).toThrow();
  });
});
