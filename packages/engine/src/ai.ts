import { type Action, type Card, type CardKind, isCrew } from '@hyt/shared';
import type { GameState, Rng } from './engine.ts';
import { legalPlays } from './bot.ts';

/**
 * 电脑玩家的出牌策略。
 *
 * 不作弊：只用这个座位本来就能看到的信息——自己的手牌、货舱张数、
 * 场上还剩几个火药桶、每个人的手牌数。货舱顺序和别人的手牌一概不看。
 * 唯一的“记忆”是 knownTop：它自己用望远镜看到的货舱顶，由调用方（房间服务）记着。
 */
export interface BotMemory {
  /** 用望远镜看到的货舱顶那张牌；不知道就是 null */
  knownTop: CardKind | null;
}

/** 被讨要时先给哪种牌：越靠前越舍得给 */
const GIVE_ORDER: CardKind[] = [
  'crew_cook',
  'crew_navigator',
  'crew_gunner',
  'crew_parrot',
  'crew_lookout',
  'shuffle',
  'peek',
  'favor',
  'reverse',
  'skip',
  'attack',
  'nope',
  'defuse',
];

function count(hand: Card[], kind: CardKind): number {
  return hand.filter((c) => c.kind === kind).length;
}

function pct(rng: Rng, chance: number): boolean {
  return rng(100) < chance;
}

/** 下一张摸到火药桶的概率（公开信息就能算出来） */
export function drawRisk(state: GameState): number {
  const alive = state.players.filter((p) => p.alive).length;
  const kegsInDeck = alive - 1 - (state.keg ? 1 : 0);
  return state.deck.length === 0 ? 1 : kegsInDeck / state.deck.length;
}

/** 手牌最多的对手：牌多的人更可能有灭火桶 */
function richestOpponent(state: GameState, seat: number): number | null {
  const others = state.players.filter((p) => p.alive && p.seat !== seat && p.hand.length > 0);
  if (others.length === 0) return null;
  return others.reduce((a, b) => (b.hand.length > a.hand.length ? b : a)).seat;
}

function playSingle(hand: Card[], kind: CardKind, targetSeat?: number): Action | null {
  const card = hand.find((c) => c.kind === kind);
  return card ? { type: 'play', cardIds: [card.id], targetSeat } : null;
}

/** 躲掉这次摸牌：被甩锅时优先再甩出去，否则溜号、倒转 */
function evade(state: GameState, hand: Card[]): Action | null {
  const order: CardKind[] = state.turnsLeft > 1 ? ['attack', 'skip', 'reverse'] : ['skip', 'reverse', 'attack'];
  for (const kind of order) {
    const action = playSingle(hand, kind);
    if (action) return action;
  }
  return null;
}

function takeTurn(state: GameState, seat: number, rng: Rng, memory: BotMemory): Action {
  const hand = state.players[seat]?.hand ?? [];
  const hasDefuse = count(hand, 'defuse') > 0;
  const risk = drawRisk(state);
  const target = richestOpponent(state, seat);

  // 用望远镜看过：知道顶上是不是火药桶
  if (memory.knownTop === 'keg') {
    return evade(state, hand) ?? playSingle(hand, 'shuffle') ?? { type: 'draw' };
  }
  if (memory.knownTop !== null) return { type: 'draw' };

  // 没有灭火桶：先想办法从别人那里弄一张
  if (!hasDefuse && target !== null) {
    for (const kind of new Set(hand.map((c) => c.kind))) {
      if (!isCrew(kind)) continue;
      const same = hand.filter((c) => c.kind === kind);
      if (same.length >= 3) {
        return { type: 'play', cardIds: same.slice(0, 3).map((c) => c.id), targetSeat: target, namedCard: 'defuse' };
      }
      if (same.length === 2) return { type: 'play', cardIds: same.map((c) => c.id), targetSeat: target };
    }
    const favor = playSingle(hand, 'favor', target);
    if (favor) return favor;
  }

  // 风险越高越想躲；手里有灭火桶就敢多摸几张
  const threshold = hasDefuse ? 0.34 : 0.12;
  if (risk >= threshold) {
    const canReact = hand.some((c) => c.kind === 'skip' || c.kind === 'attack' || c.kind === 'reverse' || c.kind === 'shuffle');
    if (canReact) {
      const peek = playSingle(hand, 'peek');
      if (peek) return peek;
    }
    const dodge = evade(state, hand);
    if (dodge) return dodge;
  }

  // 被甩锅要连摸好几张：能甩回去就甩
  if (state.turnsLeft > 1) {
    const attack = playSingle(hand, 'attack');
    if (attack) return attack;
  }

  // 偶尔出点闲牌，不然手里的讨要和对子永远打不出去
  if (target !== null && pct(rng, 15)) {
    const idle = legalPlays(state, seat).filter((p) => {
      const kind = hand.find((c) => c.id === p.cardIds[0])?.kind;
      return p.targetSeat === target && p.cardIds.length <= 2 && kind !== undefined && (kind === 'favor' || isCrew(kind));
    });
    if (idle.length > 0) return idle[rng(idle.length)] as Action;
  }

  return { type: 'draw' };
}

function considerNope(state: GameState, seat: number, rng: Rng): Action | null {
  const pending = state.pending;
  const me = state.players[seat];
  if (!pending || !me) return null;
  const card = me.hand.find((c) => c.kind === 'nope');
  const lastSeat = pending.nopes.at(-1)?.seat ?? pending.bySeat;
  if (!card || lastSeat === seat) return null;

  // 这张牌现在算不算生效（被驳回奇数次 = 不生效）
  const live = pending.nopes.length % 2 === 0;
  const mine = pending.bySeat === seat;
  const aimedAtMe = pending.targetSeat === seat;
  const n = state.players.length;
  let next = pending.bySeat;
  do next = (next + state.direction + n) % n;
  while (!state.players[next]?.alive);
  const hitsMe = aimedAtMe || (pending.effect === 'attack' && next === seat);

  let chance = 3;
  if (mine && !live) chance = 55; // 自己的牌被驳回了：驳回去
  else if (!mine && live && hitsMe) chance = pending.effect === 'attack' ? 70 : 80; // 冲着我来的：挡掉
  else if (!mine && !live && hitsMe) chance = 0; // 别人已经替我挡了

  return pct(rng, chance) ? { type: 'nope', cardId: card.id } : null;
}

/**
 * 电脑玩家现在要做什么。返回 null 表示它不行动（没轮到它，或者不打算驳回）。
 */
export function botDecide(state: GameState, seat: number, rng: Rng, memory: BotMemory = { knownTop: null }): Action | null {
  const me = state.players[seat];
  if (!me || !me.alive) return null;

  switch (state.phase) {
    case 'turn':
      return state.currentSeat === seat ? takeTurn(state, seat, rng, memory) : null;

    case 'nope':
      return considerNope(state, seat, rng);

    case 'favor': {
      if (state.favor?.targetSeat !== seat) return null;
      // 给最舍得的那张，灭火桶留到最后
      const card = [...me.hand].sort((a, b) => GIVE_ORDER.indexOf(a.kind) - GIVE_ORDER.indexOf(b.kind))[0];
      return card ? { type: 'giveCard', cardId: card.id } : null;
    }

    case 'placeKeg': {
      if (state.keg?.seat !== seat) return null;
      // 多数时候塞在顶上几张里坑下家，偶尔随便塞，让人猜不准
      const top = Math.min(3, state.deck.length);
      const position = pct(rng, 70) ? rng(top + 1) : rng(state.deck.length + 1);
      return { type: 'placeKeg', position };
    }

    case 'over':
      return null;
  }
}
