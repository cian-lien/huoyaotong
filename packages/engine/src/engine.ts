import {
  type Action,
  type Card,
  type CardKind,
  type EffectKind,
  type GameEvent,
  type Phase,
  type PlayerView,
  type PublicPlayer,
  type RankEntry,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PEEK_COUNT,
  STARTING_HAND,
  buildBaseDeck,
  isActionKind,
  isCrew,
} from '@hyt/shared';

/**
 * 规则引擎：纯函数，不碰网络、数据库和时钟。
 * 输入「当前状态 + 操作」，输出「新状态 + 事件」。随机数由调用方传入，
 * 服务器用 crypto.randomInt，测试用固定种子。
 */

/** 返回 [0, n) 的整数 */
export type Rng = (n: number) => number;

export interface PlayerState {
  seat: number;
  nickname: string;
  hand: Card[];
  alive: boolean;
  /** 撑过（完整结束）的回合数 */
  turnsSurvived: number;
  rank: number | null;
}

export interface Pending {
  bySeat: number;
  effect: EffectKind;
  cards: Card[];
  targetSeat: number | null;
  namedCard: CardKind | null;
  nopes: { seat: number; card: Card }[];
}

export interface GameState {
  phase: Phase;
  players: PlayerState[];
  /** deck[0] 是货舱顶 */
  deck: Card[];
  discard: Card[];
  currentSeat: number;
  direction: 1 | -1;
  /** 当前玩家还要进行几个回合 */
  turnsLeft: number;
  /** 当前的回合数是不是被甩锅甩来的（决定再甩锅时要不要叠加） */
  underAttack: boolean;
  pending: Pending | null;
  favor: { fromSeat: number; targetSeat: number } | null;
  keg: { seat: number; card: Card } | null;
}

export interface Step {
  state: GameState;
  events: GameEvent[];
}

export type Result = ({ ok: true } & Step) | { ok: false; error: string };

/** 引擎能给出的视图；头像、在线状态、计时由服务器补上 */
export type EngineView = Omit<PlayerView, 'players' | 'deadline' | 'serverNow'> & {
  players: Omit<PublicPlayer, 'avatar' | 'connected'>[];
};

// ───────────── 小工具 ─────────────

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function fail(error: string): Result {
  return { ok: false, error };
}

function player(state: GameState, seat: number): PlayerState {
  const p = state.players[seat];
  if (!p) throw new Error(`座位 ${seat} 不存在`);
  return p;
}

function aliveCount(state: GameState): number {
  return state.players.filter((p) => p.alive).length;
}

function nextAliveSeat(state: GameState, from: number): number {
  const n = state.players.length;
  let seat = from;
  for (let i = 0; i < n; i++) {
    seat = (seat + state.direction + n) % n;
    if (player(state, seat).alive) return seat;
  }
  throw new Error('没有存活的玩家');
}

function takeFromHand(p: PlayerState, cardId: number): Card | null {
  const i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return null;
  return p.hand.splice(i, 1)[0] ?? null;
}

/** 轮到下一个人，重新从 1 个回合算起 */
function advance(state: GameState, events: GameEvent[]): void {
  state.currentSeat = nextAliveSeat(state, state.currentSeat);
  state.turnsLeft = 1;
  state.underAttack = false;
  events.push({ type: 'turnStart', seat: state.currentSeat, turnsLeft: 1 });
}

/** 当前玩家正常结束一个回合 */
function endTurn(state: GameState, events: GameEvent[]): void {
  player(state, state.currentSeat).turnsSurvived++;
  state.turnsLeft--;
  if (state.turnsLeft > 0) {
    events.push({ type: 'turnStart', seat: state.currentSeat, turnsLeft: state.turnsLeft });
  } else {
    advance(state, events);
  }
}

export function ranking(state: GameState): RankEntry[] {
  return state.players
    .filter((p) => p.rank !== null)
    .map((p) => ({ seat: p.seat, nickname: p.nickname, rank: p.rank as number, turnsSurvived: p.turnsSurvived }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * 让一个玩家出局。名次 = 出局时还活着的人数 + 1：第一个出局的是最后一名。
 * 返回对局是否就此结束。
 */
function eliminate(state: GameState, seat: number, events: GameEvent[]): boolean {
  const p = player(state, seat);
  p.alive = false;
  state.discard.push(...p.hand);
  p.hand = [];
  p.rank = aliveCount(state) + 1;
  events.push({ type: 'eliminated', seat, rank: p.rank });

  if (aliveCount(state) === 1) {
    const winner = state.players.find((x) => x.alive) as PlayerState;
    winner.rank = 1;
    state.phase = 'over';
    state.pending = null;
    state.favor = null;
    state.keg = null;
    events.push({ type: 'gameOver', ranking: ranking(state) });
    return true;
  }
  return false;
}

// ───────────── 开局 ─────────────

export function createGame(nicknames: string[], rng: Rng): Step {
  const n = nicknames.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`玩家人数必须在 ${MIN_PLAYERS}–${MAX_PLAYERS} 之间`);
  }

  const base = buildBaseDeck();
  const defuses = base.filter((c) => c.kind === 'defuse');
  const others = shuffle(
    base.filter((c) => c.kind !== 'defuse'),
    rng,
  );

  const players: PlayerState[] = nicknames.map((nickname, seat) => ({
    seat,
    nickname,
    hand: [defuses.pop() as Card, ...others.splice(0, STARTING_HAND)],
    alive: true,
    turnsSurvived: 0,
    rank: null,
  }));

  // 火药桶比人数少一张，所以一定会炸到只剩一个人
  let nextId = base.length + 1;
  const kegs: Card[] = Array.from({ length: n - 1 }, () => ({ id: nextId++, kind: 'keg' as const }));
  const deck = shuffle([...others, ...defuses, ...kegs], rng);

  const state: GameState = {
    phase: 'turn',
    players,
    deck,
    discard: [],
    currentSeat: rng(n),
    direction: 1,
    turnsLeft: 1,
    underAttack: false,
    pending: null,
    favor: null,
    keg: null,
  };
  return { state, events: [{ type: 'turnStart', seat: state.currentSeat, turnsLeft: 1 }] };
}

// ───────────── 操作 ─────────────

function validTarget(state: GameState, bySeat: number, targetSeat: number | undefined): string | null {
  if (targetSeat === undefined) return '需要指定一个目标玩家';
  const t = state.players[targetSeat];
  if (!t || !t.alive) return '目标玩家不存在或已出局';
  if (targetSeat === bySeat) return '不能指定自己';
  if (t.hand.length === 0) return '对方没有手牌';
  return null;
}

function play(state: GameState, seat: number, action: Extract<Action, { type: 'play' }>): Result {
  if (state.phase !== 'turn') return fail('现在不能出牌');
  if (seat !== state.currentSeat) return fail('还没轮到你');

  const p = player(state, seat);
  const ids = action.cardIds;
  if (new Set(ids).size !== ids.length) return fail('不能重复选同一张牌');
  const cards = ids.map((id) => p.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return fail('这张牌不在你手里');
  const picked = cards as Card[];
  const first = picked[0] as Card;

  let effect: EffectKind;
  let targetSeat: number | null = null;
  let namedCard: CardKind | null = null;

  if (picked.length === 1) {
    if (!isActionKind(first.kind)) {
      if (isCrew(first.kind)) return fail('船员牌要 2 张或 3 张相同的一起出');
      if (first.kind === 'nope') return fail('驳回只能在别人出牌后使用');
      return fail('这张牌不能主动打出');
    }
    effect = first.kind;
    if (effect === 'favor') {
      const err = validTarget(state, seat, action.targetSeat);
      if (err) return fail(err);
      targetSeat = action.targetSeat as number;
    }
  } else {
    if (!isCrew(first.kind) || picked.some((c) => c.kind !== first.kind)) {
      return fail('只有相同的船员牌才能一起出');
    }
    const err = validTarget(state, seat, action.targetSeat);
    if (err) return fail(err);
    targetSeat = action.targetSeat as number;
    if (picked.length === 2) {
      effect = 'pair';
    } else {
      effect = 'triple';
      if (!action.namedCard) return fail('需要点名一种牌');
      if (action.namedCard === 'keg') return fail('不能点名火药桶');
      namedCard = action.namedCard;
    }
  }

  for (const c of picked) takeFromHand(p, c.id);
  state.discard.push(...picked);
  state.pending = { bySeat: seat, effect, cards: picked, targetSeat, namedCard, nopes: [] };
  state.phase = 'nope';

  return {
    ok: true,
    state,
    events: [{ type: 'played', seat, effect, cards: picked.map((c) => c.kind), targetSeat, namedCard }],
  };
}

function nope(state: GameState, seat: number, action: Extract<Action, { type: 'nope' }>): Result {
  const pending = state.pending;
  if (state.phase !== 'nope' || !pending) return fail('现在没有可以驳回的牌');
  const p = state.players[seat];
  if (!p || !p.alive) return fail('你已经出局了');
  const lastSeat = pending.nopes.at(-1)?.seat ?? pending.bySeat;
  if (lastSeat === seat) return fail('不能驳回自己刚出的牌');
  const card = p.hand.find((c) => c.id === action.cardId);
  if (!card || card.kind !== 'nope') return fail('你没有这张驳回');

  takeFromHand(p, card.id);
  state.discard.push(card);
  pending.nopes.push({ seat, card });
  return { ok: true, state, events: [{ type: 'noped', seat, nopeCount: pending.nopes.length }] };
}

function draw(state: GameState, seat: number, events: GameEvent[] = []): Result {
  if (state.phase !== 'turn') return fail('现在不能摸牌');
  if (seat !== state.currentSeat) return fail('还没轮到你');

  const p = player(state, seat);
  const card = state.deck.shift();
  if (!card) throw new Error('货舱空了：火药桶数量不对');
  events.push({ type: 'drew', seat });

  if (card.kind !== 'keg') {
    p.hand.push(card);
    events.push({ type: 'gotCard', to: seat, card, from: 'deck' });
    endTurn(state, events);
    return { ok: true, state, events };
  }

  events.push({ type: 'exploded', seat });
  const defuse = p.hand.find((c) => c.kind === 'defuse');
  if (defuse) {
    takeFromHand(p, defuse.id);
    state.discard.push(defuse);
    state.keg = { seat, card };
    state.phase = 'placeKeg';
    events.push({ type: 'defused', seat });
    return { ok: true, state, events };
  }

  state.discard.push(card);
  const over = eliminate(state, seat, events);
  if (!over) advance(state, events);
  return { ok: true, state, events };
}

function placeKeg(state: GameState, seat: number, position: number): Result {
  const keg = state.keg;
  if (state.phase !== 'placeKeg' || !keg) return fail('现在不需要放火药桶');
  if (seat !== keg.seat) return fail('不是你在放火药桶');
  if (position < 0 || position > state.deck.length) return fail('位置超出了货舱范围');

  state.deck.splice(position, 0, keg.card);
  state.keg = null;
  state.phase = 'turn';
  const events: GameEvent[] = [{ type: 'kegPlaced', seat }];
  endTurn(state, events);
  return { ok: true, state, events };
}

function giveCard(state: GameState, seat: number, cardId: number): Result {
  const favor = state.favor;
  if (state.phase !== 'favor' || !favor) return fail('现在没有人向你讨要');
  if (seat !== favor.targetSeat) return fail('被讨要的不是你');
  const card = takeFromHand(player(state, seat), cardId);
  if (!card) return fail('这张牌不在你手里');

  player(state, favor.fromSeat).hand.push(card);
  state.favor = null;
  state.phase = 'turn';
  return {
    ok: true,
    state,
    events: [
      { type: 'favorGiven', seat: favor.fromSeat, targetSeat: seat },
      { type: 'gotCard', to: favor.fromSeat, card, from: seat },
      { type: 'lostCard', to: seat, card, taker: favor.fromSeat },
    ],
  };
}

/** 处理一个玩家操作。操作不合法时原状态不变。 */
export function applyAction(prev: GameState, seat: number, action: Action, rng: Rng): Result {
  void rng; // 目前玩家操作本身都不需要随机数，保留参数以便以后扩展
  if (prev.phase === 'over') return fail('对局已经结束');
  const state = structuredClone(prev);
  switch (action.type) {
    case 'play':
      return play(state, seat, action);
    case 'nope':
      return nope(state, seat, action);
    case 'draw':
      return draw(state, seat);
    case 'placeKeg':
      return placeKeg(state, seat, action.position);
    case 'giveCard':
      return giveCard(state, seat, action.cardId);
  }
}

// ───────────── 驳回窗口结算 ─────────────

function moveCard(state: GameState, fromSeat: number, toSeat: number, card: Card, events: GameEvent[]): void {
  takeFromHand(player(state, fromSeat), card.id);
  player(state, toSeat).hand.push(card);
  events.push({ type: 'gotCard', to: toSeat, card, from: fromSeat });
  events.push({ type: 'lostCard', to: fromSeat, card, taker: toSeat });
}

/** 驳回窗口到时后调用：驳回张数为奇数则取消，偶数则生效 */
export function resolvePending(prev: GameState, rng: Rng): Step {
  if (prev.phase !== 'nope' || !prev.pending) throw new Error('当前不在驳回窗口');
  const state = structuredClone(prev);
  const pending = state.pending as Pending;
  const { bySeat, effect, targetSeat } = pending;
  const events: GameEvent[] = [];
  state.pending = null;
  state.phase = 'turn';

  if (pending.nopes.length % 2 === 1) {
    events.push({ type: 'cancelled', seat: bySeat, effect });
    return { state, events };
  }

  events.push({ type: 'resolved', seat: bySeat, effect, targetSeat });
  const target = targetSeat === null ? null : player(state, targetSeat);

  switch (effect) {
    case 'skip':
      endTurn(state, events);
      break;

    case 'reverse':
      state.direction = state.direction === 1 ? -1 : 1;
      endTurn(state, events);
      break;

    case 'attack': {
      // 自己剩下的回合（如果是被甩来的）一起甩给下家
      const carried = state.underAttack ? state.turnsLeft : 0;
      player(state, bySeat).turnsSurvived++;
      state.currentSeat = nextAliveSeat(state, bySeat);
      state.turnsLeft = carried + 2;
      state.underAttack = true;
      events.push({ type: 'turnStart', seat: state.currentSeat, turnsLeft: state.turnsLeft });
      break;
    }

    case 'peek':
      events.push({ type: 'peeked', to: bySeat, cards: state.deck.slice(0, PEEK_COUNT) });
      break;

    case 'shuffle':
      state.deck = shuffle(state.deck, rng);
      break;

    case 'favor':
      if (target && target.alive && target.hand.length > 0) {
        state.favor = { fromSeat: bySeat, targetSeat: target.seat };
        state.phase = 'favor';
      }
      break;

    case 'pair': {
      const card = target && target.hand.length > 0 ? target.hand[rng(target.hand.length)] : undefined;
      events.push({ type: 'stole', seat: bySeat, targetSeat: targetSeat as number, success: !!card });
      if (card && target) moveCard(state, target.seat, bySeat, card, events);
      break;
    }

    case 'triple': {
      const card = target?.hand.find((c) => c.kind === pending.namedCard);
      events.push({ type: 'stole', seat: bySeat, targetSeat: targetSeat as number, success: !!card });
      if (card && target) moveCard(state, target.seat, bySeat, card, events);
      break;
    }
  }
  return { state, events };
}

// ───────────── 超时与退出 ─────────────

/** 计时器到期时调用：按当前阶段替玩家做一个默认动作 */
export function applyTimeout(prev: GameState, rng: Rng): Step {
  switch (prev.phase) {
    case 'nope':
      return resolvePending(prev, rng);

    case 'turn': {
      const seat = prev.currentSeat;
      const res = draw(structuredClone(prev), seat, [{ type: 'timeout', seat }]);
      if (!res.ok) throw new Error(res.error);
      return res;
    }

    case 'favor': {
      const seat = (prev.favor as { targetSeat: number }).targetSeat;
      const hand = player(prev, seat).hand;
      const card = hand[rng(hand.length)] as Card;
      const res = giveCard(structuredClone(prev), seat, card.id);
      if (!res.ok) throw new Error(res.error);
      return { state: res.state, events: [{ type: 'timeout', seat }, ...res.events] };
    }

    case 'placeKeg': {
      const seat = (prev.keg as { seat: number }).seat;
      const res = placeKeg(structuredClone(prev), seat, rng(prev.deck.length + 1));
      if (!res.ok) throw new Error(res.error);
      return { state: res.state, events: [{ type: 'timeout', seat }, ...res.events] };
    }

    case 'over':
      return { state: prev, events: [] };
  }
}

/**
 * 玩家中途退出：按出局处理，并拿走一个火药桶，
 * 保持「火药桶 = 存活人数 − 1」。
 */
export function forfeit(prev: GameState, seat: number, rng: Rng): Step {
  const p = prev.players[seat];
  if (prev.phase === 'over' || !p || !p.alive) return { state: prev, events: [] };
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const wasCurrent = state.currentSeat === seat;

  if (state.keg?.seat === seat) {
    // 正拿着火药桶：直接带着它出局
    state.discard.push(state.keg.card);
    state.keg = null;
    state.phase = 'turn';
  } else {
    // 随机拿走货舱里的一个火药桶，其余牌的顺序不动
    const kegIndexes = state.deck.flatMap((c, i) => (c.kind === 'keg' ? [i] : []));
    const i = kegIndexes[rng(Math.max(kegIndexes.length, 1))];
    if (i !== undefined) {
      state.discard.push(...state.deck.splice(i, 1));
    } else if (state.keg) {
      // 唯一的火药桶在别人手上等待放回（只会出现在只剩两人时，对局随即结束）
      state.discard.push(state.keg.card);
      state.keg = null;
      state.phase = 'turn';
    }
  }

  if (state.pending && (state.pending.bySeat === seat || state.pending.targetSeat === seat)) {
    state.pending = null;
    state.phase = 'turn';
  }
  if (state.favor && (state.favor.fromSeat === seat || state.favor.targetSeat === seat)) {
    state.favor = null;
    state.phase = 'turn';
  }

  const over = eliminate(state, seat, events);
  if (!over && wasCurrent) {
    state.pending = null;
    state.favor = null;
    state.phase = 'turn';
    advance(state, events);
  }
  return { state, events };
}

// ───────────── 视图 ─────────────

/** 生成某个座位能看到的内容：别人的手牌和货舱顺序永远不在里面 */
export function viewFor(state: GameState, seat: number): EngineView {
  const me = state.players[seat];
  const pending = state.pending;
  return {
    phase: state.phase,
    mySeat: seat,
    myHand: me ? [...me.hand] : [],
    deckCount: state.deck.length,
    discardTop: state.discard.at(-1)?.kind ?? null,
    players: state.players.map((p) => ({
      seat: p.seat,
      nickname: p.nickname,
      handCount: p.hand.length,
      alive: p.alive,
      rank: p.rank,
    })),
    currentSeat: state.currentSeat,
    direction: state.direction,
    turnsLeft: state.turnsLeft,
    pending: pending
      ? {
          bySeat: pending.bySeat,
          effect: pending.effect,
          cards: pending.cards.map((c) => c.kind),
          targetSeat: pending.targetSeat,
          nopeCount: pending.nopes.length,
          lastNopeSeat: pending.nopes.at(-1)?.seat ?? null,
        }
      : null,
    favor: state.favor ? { ...state.favor } : null,
    kegSeat: state.keg?.seat ?? null,
  };
}

/** 一个事件该不该发给某个座位 */
export function eventVisibleTo(event: GameEvent, seat: number): boolean {
  return !('to' in event) || event.to === seat;
}
