import { describe, expect, it } from 'vitest';
import { applyAction, applyTimeout, resolvePending } from '../src/index.ts';
import { act, handOf, idOf, makeState, playAndResolve, reject, types, zero } from './helpers.ts';

describe('摸牌', () => {
  it('摸到普通牌：进手牌，轮到下家', () => {
    const s0 = makeState({ hands: [['skip'], ['skip']], deck: ['peek', 'keg'] });
    const { state, events } = act(s0, 0, { type: 'draw' });
    expect(handOf(state, 0)).toEqual(['skip', 'peek']);
    expect(state.currentSeat).toBe(1);
    expect(state.players[0]?.turnsSurvived).toBe(1);
    expect(types(events)).toEqual(['drew', 'gotCard', 'turnStart']);
  });

  it('没轮到的人不能摸牌', () => {
    const s0 = makeState({ hands: [[], []], deck: ['peek', 'keg'] });
    expect(reject(s0, 1, { type: 'draw' })).toBe('还没轮到你');
  });

  it('操作被拒绝时原状态不变', () => {
    const s0 = makeState({ hands: [['skip'], ['skip']], deck: ['peek', 'keg'] });
    const snapshot = structuredClone(s0);
    applyAction(s0, 1, { type: 'draw' }, zero);
    applyAction(s0, 0, { type: 'draw' }, zero);
    expect(s0).toEqual(snapshot);
  });
});

describe('火药桶与灭火桶', () => {
  it('摸到火药桶且没有灭火桶：出局', () => {
    const s0 = makeState({ hands: [['skip'], ['skip'], ['skip']], deck: ['keg', 'keg', 'peek'] });
    const { state, events } = act(s0, 0, { type: 'draw' });
    expect(state.players[0]).toMatchObject({ alive: false, rank: 3, hand: [] });
    expect(state.currentSeat).toBe(1);
    expect(state.phase).toBe('turn');
    expect(types(events)).toEqual(['drew', 'exploded', 'eliminated', 'turnStart']);
  });

  it('摸到火药桶且有灭火桶：自动拆掉，进入放回阶段', () => {
    const s0 = makeState({ hands: [['defuse', 'skip'], ['skip']], deck: ['keg', 'peek', 'peek'] });
    const { state, events } = act(s0, 0, { type: 'draw' });
    expect(state.phase).toBe('placeKeg');
    expect(state.keg?.seat).toBe(0);
    expect(handOf(state, 0)).toEqual(['skip']);
    expect(types(events)).toEqual(['drew', 'exploded', 'defused']);
    expect(reject(state, 1, { type: 'placeKeg', position: 0 })).toBe('不是你在放火药桶');
    expect(reject(state, 0, { type: 'placeKeg', position: 3 })).toBe('位置超出了货舱范围');
  });

  it('火药桶可以放回货舱任意位置，然后轮到下家', () => {
    const s0 = makeState({ hands: [['defuse'], ['skip']], deck: ['keg', 'peek', 'shuffle'] });
    const drawn = act(s0, 0, { type: 'draw' }).state;

    const top = act(drawn, 0, { type: 'placeKeg', position: 0 }).state;
    expect(top.deck.map((c) => c.kind)).toEqual(['keg', 'peek', 'shuffle']);
    expect(top.currentSeat).toBe(1);
    expect(top.phase).toBe('turn');

    const bottom = act(drawn, 0, { type: 'placeKeg', position: 2 }).state;
    expect(bottom.deck.map((c) => c.kind)).toEqual(['peek', 'shuffle', 'keg']);
  });

  it('只剩一个人时对局结束，按出局顺序排名', () => {
    const s0 = makeState({ hands: [[], [], []], deck: ['keg', 'keg'] });
    const s1 = act(s0, 0, { type: 'draw' }).state;
    const { state, events } = act(s1, 1, { type: 'draw' });
    expect(state.phase).toBe('over');
    expect(state.players.map((p) => p.rank)).toEqual([3, 2, 1]);
    const over = events.at(-1);
    expect(over).toMatchObject({ type: 'gameOver', ranking: [{ seat: 2, rank: 1 }, { seat: 1, rank: 2 }, { seat: 0, rank: 3 }] });
    expect(reject(state, 2, { type: 'draw' })).toBe('对局已经结束');
  });
});

describe('溜号', () => {
  it('结束回合不摸牌', () => {
    const s0 = makeState({ hands: [['skip'], []], deck: ['keg'] });
    const { state } = playAndResolve(s0, 0, ['skip']);
    expect(state.currentSeat).toBe(1);
    expect(state.deck).toHaveLength(1);
    expect(state.players[0]?.turnsSurvived).toBe(1);
  });
});

describe('甩锅', () => {
  it('下家连续进行 2 个回合', () => {
    const s0 = makeState({ hands: [['attack'], [], []], deck: ['peek', 'peek', 'peek', 'keg', 'keg'] });
    let { state } = playAndResolve(s0, 0, ['attack']);
    expect(state).toMatchObject({ currentSeat: 1, turnsLeft: 2, underAttack: true });
    state = act(state, 1, { type: 'draw' }).state;
    expect(state).toMatchObject({ currentSeat: 1, turnsLeft: 1 });
    state = act(state, 1, { type: 'draw' }).state;
    expect(state).toMatchObject({ currentSeat: 2, turnsLeft: 1, underAttack: false });
  });

  it('被甩锅的人再甩锅：剩下的回合叠加给下家', () => {
    const s0 = makeState({ hands: [['attack'], ['attack'], []], deck: ['peek', 'keg', 'keg'] });
    let { state } = playAndResolve(s0, 0, ['attack']);
    ({ state } = playAndResolve(state, 1, ['attack']));
    expect(state).toMatchObject({ currentSeat: 2, turnsLeft: 4, underAttack: true });
  });

  it('被甩锅后用溜号只能躲掉一个回合', () => {
    const s0 = makeState({ hands: [['attack'], ['skip'], []], deck: ['peek', 'keg', 'keg'] });
    let { state } = playAndResolve(s0, 0, ['attack']);
    ({ state } = playAndResolve(state, 1, ['skip']));
    expect(state).toMatchObject({ currentSeat: 1, turnsLeft: 1 });
  });

  it('被甩锅的人炸出局后，下家只进行 1 个回合', () => {
    const s0 = makeState({ hands: [['attack'], [], []], deck: ['keg', 'peek', 'keg'] });
    let { state } = playAndResolve(s0, 0, ['attack']);
    state = act(state, 1, { type: 'draw' }).state;
    expect(state).toMatchObject({ currentSeat: 2, turnsLeft: 1, underAttack: false });
  });
});

describe('望远镜', () => {
  it('只有自己能看到顶上 3 张，货舱不变', () => {
    const s0 = makeState({ hands: [['peek'], []], deck: ['shuffle', 'keg', 'skip', 'favor'] });
    const { state, events } = playAndResolve(s0, 0, ['peek']);
    const peeked = events.find((e) => e.type === 'peeked');
    expect(peeked).toMatchObject({ to: 0 });
    expect(peeked?.type === 'peeked' && peeked.cards.map((c) => c.kind)).toEqual(['shuffle', 'keg', 'skip']);
    expect(state.deck).toEqual(s0.deck);
    expect(state.currentSeat).toBe(0);
    expect(state.phase).toBe('turn');
  });

  it('货舱不足 3 张时有几张看几张', () => {
    const s0 = makeState({ hands: [['peek'], []], deck: ['keg'] });
    const { events } = playAndResolve(s0, 0, ['peek']);
    const peeked = events.find((e) => e.type === 'peeked');
    expect(peeked?.type === 'peeked' && peeked.cards).toHaveLength(1);
  });
});

describe('翻货舱', () => {
  it('打乱货舱但不增减牌，回合继续', () => {
    const s0 = makeState({ hands: [['shuffle'], []], deck: ['peek', 'keg', 'skip', 'favor', 'attack'] });
    let calls = 0;
    const { state } = playAndResolve(s0, 0, ['shuffle'], {}, (n) => (calls++, n - 1));
    expect(calls).toBeGreaterThan(0);
    expect(state.deck.map((c) => c.id).sort()).toEqual(s0.deck.map((c) => c.id).sort());
    expect(state.currentSeat).toBe(0);
  });
});

describe('讨要', () => {
  it('对方自己挑一张牌给你', () => {
    const s0 = makeState({ hands: [['favor'], ['skip', 'defuse']], deck: ['keg'] });
    const { state } = playAndResolve(s0, 0, ['favor'], { targetSeat: 1 });
    expect(state.phase).toBe('favor');
    expect(state.favor).toEqual({ fromSeat: 0, targetSeat: 1 });
    expect(reject(state, 0, { type: 'giveCard', cardId: 1 })).toBe('被讨要的不是你');
    expect(reject(state, 0, { type: 'draw' })).toBe('现在不能摸牌');

    const given = act(state, 1, { type: 'giveCard', cardId: idOf(state, 1, 'skip') });
    expect(handOf(given.state, 0)).toEqual(['skip']);
    expect(handOf(given.state, 1)).toEqual(['defuse']);
    expect(given.state.phase).toBe('turn');
    expect(given.state.currentSeat).toBe(0);
  });

  it('必须指定一个有手牌的其他玩家', () => {
    const s0 = makeState({ hands: [['favor'], [], ['skip']], deck: ['keg', 'keg'] });
    const id = idOf(s0, 0, 'favor');
    expect(reject(s0, 0, { type: 'play', cardIds: [id] })).toBe('需要指定一个目标玩家');
    expect(reject(s0, 0, { type: 'play', cardIds: [id], targetSeat: 0 })).toBe('不能指定自己');
    expect(reject(s0, 0, { type: 'play', cardIds: [id], targetSeat: 1 })).toBe('对方没有手牌');
  });

  it('超时不给：随机给一张', () => {
    const s0 = makeState({ hands: [['favor'], ['skip']], deck: ['keg'] });
    const { state } = playAndResolve(s0, 0, ['favor'], { targetSeat: 1 });
    const out = applyTimeout(state, zero);
    expect(handOf(out.state, 0)).toEqual(['skip']);
    expect(out.state.phase).toBe('turn');
  });
});

describe('倒转航向', () => {
  it('出牌顺序反过来，并结束回合不摸牌', () => {
    const s0 = makeState({ hands: [['reverse'], [], []], deck: ['peek', 'keg', 'keg'] });
    let { state } = playAndResolve(s0, 0, ['reverse']);
    expect(state.direction).toBe(-1);
    expect(state.currentSeat).toBe(2);
    expect(state.deck).toHaveLength(3);
    state = act(state, 2, { type: 'draw' }).state;
    expect(state.currentSeat).toBe(1);
  });

  it('会跳过已经出局的人', () => {
    const s0 = makeState({ hands: [['reverse'], [], []], deck: ['peek', 'keg', 'keg'] });
    (s0.players[2] as { alive: boolean }).alive = false;
    const { state } = playAndResolve(s0, 0, ['reverse']);
    expect(state.currentSeat).toBe(1);
  });
});

describe('船员牌', () => {
  it('单张不能出', () => {
    const s0 = makeState({ hands: [['crew_cook'], ['skip']], deck: ['keg'] });
    expect(reject(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'crew_cook')], targetSeat: 1 })).toBe(
      '船员牌要 2 张或 3 张相同的一起出',
    );
  });

  it('不同的船员牌不能凑对', () => {
    const s0 = makeState({ hands: [['crew_cook', 'crew_parrot'], ['skip']], deck: ['keg'] });
    const ids = [idOf(s0, 0, 'crew_cook'), idOf(s0, 0, 'crew_parrot')];
    expect(reject(s0, 0, { type: 'play', cardIds: ids, targetSeat: 1 })).toBe('只有相同的船员牌才能一起出');
  });

  it('2 张相同：随机抽对方一张', () => {
    const s0 = makeState({ hands: [['crew_cook', 'crew_cook'], ['skip', 'defuse']], deck: ['keg'] });
    const { state, events } = playAndResolve(s0, 0, ['crew_cook', 'crew_cook'], { targetSeat: 1 }, () => 1);
    expect(handOf(state, 0)).toEqual(['defuse']);
    expect(handOf(state, 1)).toEqual(['skip']);
    expect(events.find((e) => e.type === 'stole')).toMatchObject({ success: true });
    expect(state.currentSeat).toBe(0);
  });

  it('3 张相同：点名要一张，对方有就拿走', () => {
    const three = ['crew_parrot', 'crew_parrot', 'crew_parrot'] as const;
    const s0 = makeState({ hands: [[...three], ['skip', 'defuse']], deck: ['keg'] });
    const { state } = playAndResolve(s0, 0, [...three], { targetSeat: 1, namedCard: 'defuse' });
    expect(handOf(state, 0)).toEqual(['defuse']);
    expect(handOf(state, 1)).toEqual(['skip']);
  });

  it('3 张相同：对方没有点名的牌就白出', () => {
    const three = ['crew_parrot', 'crew_parrot', 'crew_parrot'] as const;
    const s0 = makeState({ hands: [[...three], ['skip']], deck: ['keg'] });
    const { state, events } = playAndResolve(s0, 0, [...three], { targetSeat: 1, namedCard: 'nope' });
    expect(handOf(state, 0)).toEqual([]);
    expect(handOf(state, 1)).toEqual(['skip']);
    expect(events.find((e) => e.type === 'stole')).toMatchObject({ success: false });
  });

  it('3 张相同必须点名，且不能点火药桶', () => {
    const s0 = makeState({ hands: [['crew_parrot', 'crew_parrot', 'crew_parrot'], ['skip']], deck: ['keg'] });
    const ids = s0.players[0]?.hand.map((c) => c.id) ?? [];
    expect(reject(s0, 0, { type: 'play', cardIds: ids, targetSeat: 1 })).toBe('需要点名一种牌');
    expect(reject(s0, 0, { type: 'play', cardIds: ids, targetSeat: 1, namedCard: 'keg' })).toBe('不能点名火药桶');
  });
});

describe('不能主动打出的牌', () => {
  it('灭火桶、驳回不能在自己回合当普通牌出；别人的牌更不行', () => {
    const s0 = makeState({ hands: [['defuse', 'nope'], ['skip']], deck: ['keg'] });
    expect(reject(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'defuse')] })).toBe('这张牌不能主动打出');
    expect(reject(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'nope')] })).toBe('驳回只能在别人出牌后使用');
    expect(reject(s0, 0, { type: 'play', cardIds: [idOf(s0, 1, 'skip')] })).toBe('这张牌不在你手里');
    expect(reject(s0, 1, { type: 'play', cardIds: [idOf(s0, 1, 'skip')] })).toBe('还没轮到你');
  });

  it('同一张牌不能选两次', () => {
    const s0 = makeState({ hands: [['crew_cook'], ['skip']], deck: ['keg'] });
    const id = idOf(s0, 0, 'crew_cook');
    expect(reject(s0, 0, { type: 'play', cardIds: [id, id], targetSeat: 1 })).toBe('不能重复选同一张牌');
  });
});

describe('超时', () => {
  it('出牌阶段超时：自动摸牌', () => {
    const s0 = makeState({ hands: [[], []], deck: ['peek', 'keg'] });
    const { state, events } = applyTimeout(s0, zero);
    expect(handOf(state, 0)).toEqual(['peek']);
    expect(types(events)[0]).toBe('timeout');
    expect(state.currentSeat).toBe(1);
  });

  it('放回火药桶超时：随机放一个位置', () => {
    const s0 = makeState({ hands: [['defuse'], []], deck: ['keg', 'peek'] });
    const drawn = act(s0, 0, { type: 'draw' }).state;
    const { state } = applyTimeout(drawn, zero);
    expect(state.deck.map((c) => c.kind)).toEqual(['keg', 'peek']);
    expect(state.phase).toBe('turn');
    expect(state.currentSeat).toBe(1);
  });

  it('驳回窗口超时：结算', () => {
    const s0 = makeState({ hands: [['skip'], []], deck: ['keg'] });
    const played = act(s0, 0, { type: 'play', cardIds: [idOf(s0, 0, 'skip')] }).state;
    expect(applyTimeout(played, zero).state).toEqual(resolvePending(played, zero).state);
  });
});
