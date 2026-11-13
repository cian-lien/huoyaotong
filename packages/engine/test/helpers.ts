import type { Action, Card, CardKind, GameEvent } from '@hyt/shared';
import { applyAction, resolvePending, type GameState, type Rng } from '../src/index.ts';

let nextId = 1000;
export function card(kind: CardKind): Card {
  return { id: nextId++, kind };
}

/** 手工摆一个牌局：hands[i] 是座位 i 的手牌，deck[0] 是货舱顶 */
export function makeState(opts: { hands: CardKind[][]; deck: CardKind[]; currentSeat?: number }): GameState {
  return {
    phase: 'turn',
    players: opts.hands.map((kinds, seat) => ({
      seat,
      nickname: `P${seat}`,
      hand: kinds.map(card),
      alive: true,
      turnsSurvived: 0,
      rank: null,
    })),
    deck: opts.deck.map(card),
    discard: [],
    currentSeat: opts.currentSeat ?? 0,
    direction: 1,
    turnsLeft: 1,
    underAttack: false,
    pending: null,
    favor: null,
    keg: null,
  };
}

/** 总是返回 0 的“随机数”，让测试结果确定 */
export const zero: Rng = () => 0;

export function handOf(state: GameState, seat: number): CardKind[] {
  return (state.players[seat]?.hand ?? []).map((c) => c.kind);
}

export function idOf(state: GameState, seat: number, kind: CardKind, nth = 0): number {
  const c = (state.players[seat]?.hand ?? []).filter((x) => x.kind === kind)[nth];
  if (!c) throw new Error(`座位 ${seat} 没有第 ${nth + 1} 张 ${kind}`);
  return c.id;
}

/** 执行一个必须成功的操作 */
export function act(state: GameState, seat: number, action: Action, rng: Rng = zero): { state: GameState; events: GameEvent[] } {
  const res = applyAction(state, seat, action, rng);
  if (!res.ok) throw new Error(`操作失败：${res.error}`);
  return res;
}

/** 执行一个应当被拒绝的操作，返回错误信息 */
export function reject(state: GameState, seat: number, action: Action): string {
  const res = applyAction(state, seat, action, zero);
  if (res.ok) throw new Error('这个操作本应被拒绝');
  return res.error;
}

/** 出一张（组）牌并让驳回窗口直接到时 */
export function playAndResolve(
  state: GameState,
  seat: number,
  kinds: CardKind[],
  extra: { targetSeat?: number; namedCard?: CardKind } = {},
  rng: Rng = zero,
): { state: GameState; events: GameEvent[] } {
  const counts = new Map<CardKind, number>();
  const cardIds = kinds.map((k) => {
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    return idOf(state, seat, k, n);
  });
  const played = act(state, seat, { type: 'play', cardIds, ...extra }, rng);
  const resolved = resolvePending(played.state, rng);
  return { state: resolved.state, events: [...played.events, ...resolved.events] };
}

export function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}
