import { type Action, type Card, CARD_KINDS, isActionKind, isCrew } from '@hyt/shared';
import type { GameState, Rng } from './engine.ts';

/** 列出某个座位在出牌阶段所有合法的出牌方式 */
export function legalPlays(state: GameState, seat: number): Extract<Action, { type: 'play' }>[] {
  if (state.phase !== 'turn' || state.currentSeat !== seat) return [];
  const me = state.players[seat];
  if (!me) return [];
  const targets = state.players.filter((p) => p.alive && p.seat !== seat && p.hand.length > 0).map((p) => p.seat);
  const plays: Extract<Action, { type: 'play' }>[] = [];

  const byKind = new Map<string, Card[]>();
  for (const c of me.hand) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);

  for (const [kind, cards] of byKind) {
    const first = cards[0] as Card;
    if (isActionKind(first.kind)) {
      if (kind === 'favor') {
        for (const t of targets) plays.push({ type: 'play', cardIds: [first.id], targetSeat: t });
      } else {
        plays.push({ type: 'play', cardIds: [first.id] });
      }
    } else if (isCrew(first.kind)) {
      for (const t of targets) {
        if (cards.length >= 2) {
          plays.push({ type: 'play', cardIds: cards.slice(0, 2).map((c) => c.id), targetSeat: t });
        }
        if (cards.length >= 3) {
          for (const named of CARD_KINDS) {
            if (named === 'keg') continue;
            plays.push({ type: 'play', cardIds: cards.slice(0, 3).map((c) => c.id), targetSeat: t, namedCard: named });
          }
        }
      }
    }
  }
  return plays;
}

/**
 * 一个随机出牌的电脑玩家：给命令行对局和随机测试用。
 * 返回 null 表示这个座位现在什么都不做。
 */
export function botAction(state: GameState, seat: number, rng: Rng): Action | null {
  const me = state.players[seat];
  if (!me || !me.alive) return null;

  switch (state.phase) {
    case 'turn': {
      if (state.currentSeat !== seat) return null;
      const plays = legalPlays(state, seat);
      if (plays.length > 0 && rng(100) < 45) return plays[rng(plays.length)] as Action;
      return { type: 'draw' };
    }
    case 'nope': {
      const pending = state.pending;
      if (!pending) return null;
      const lastSeat = pending.nopes.at(-1)?.seat ?? pending.bySeat;
      const card = me.hand.find((c) => c.kind === 'nope');
      if (!card || lastSeat === seat || rng(100) >= 30) return null;
      return { type: 'nope', cardId: card.id };
    }
    case 'favor': {
      if (state.favor?.targetSeat !== seat) return null;
      return { type: 'giveCard', cardId: (me.hand[rng(me.hand.length)] as Card).id };
    }
    case 'placeKeg': {
      if (state.keg?.seat !== seat) return null;
      return { type: 'placeKeg', position: rng(state.deck.length + 1) };
    }
    case 'over':
      return null;
  }
}
