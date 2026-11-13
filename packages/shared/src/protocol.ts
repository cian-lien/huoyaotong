import { z } from 'zod';
import { CARD_KINDS, MAX_PLAYERS, type Card, type CardKind } from './cards.ts';

// ───────────── 客户端 → 服务器：只有“操作” ─────────────

const cardId = z.number().int().positive();
const seat = z.number().int().min(0).max(4);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play'),
    cardIds: z.array(cardId).min(1).max(3),
    targetSeat: seat.optional(),
    namedCard: z.enum(CARD_KINDS).optional(),
  }),
  z.object({ type: z.literal('nope'), cardId }),
  z.object({ type: z.literal('draw') }),
  z.object({ type: z.literal('giveCard'), cardId }),
  z.object({ type: z.literal('placeKeg'), position: z.number().int().min(0) }),
]);

export type Action = z.infer<typeof actionSchema>;

// ───────────── 对局阶段 ─────────────

export type Phase =
  | 'turn' // 当前玩家出牌或摸牌
  | 'nope' // 驳回窗口
  | 'favor' // 等被讨要的人给牌
  | 'placeKeg' // 等拆弹的人把火药桶放回货舱
  | 'over'; // 结算

/** 出牌产生的效果种类 */
export type EffectKind = 'skip' | 'attack' | 'peek' | 'shuffle' | 'favor' | 'reverse' | 'pair' | 'triple';

// ───────────── 服务器 → 客户端 ─────────────

export interface PublicPlayer {
  seat: number;
  nickname: string;
  avatar: string | null;
  handCount: number;
  alive: boolean;
  connected: boolean;
  /** 出局后才有；1 = 最后活着的人 */
  rank: number | null;
}

export interface PendingView {
  bySeat: number;
  effect: EffectKind;
  cards: CardKind[];
  targetSeat: number | null;
  /** 已经打出的驳回张数：奇数 = 目前会被取消 */
  nopeCount: number;
  lastNopeSeat: number | null;
}

export interface PlayerView {
  phase: Phase;
  mySeat: number;
  myHand: Card[];
  /** 只给张数，不给顺序 */
  deckCount: number;
  discardTop: CardKind | null;
  players: PublicPlayer[];
  currentSeat: number;
  direction: 1 | -1;
  /** 当前玩家还要进行几个回合（被甩锅时大于 1） */
  turnsLeft: number;
  pending: PendingView | null;
  /** favor 阶段：谁在等谁给牌 */
  favor: { fromSeat: number; targetSeat: number } | null;
  /** placeKeg 阶段：谁在放火药桶 */
  kegSeat: number | null;
  /** 当前计时器到期的时间戳（毫秒），由服务器填写 */
  deadline: number | null;
  /** 服务器当前时间，客户端用来校正本地时钟 */
  serverNow: number;
}

/** 对局事件：公开的进对局日志；带 to 的只发给那一个座位 */
export type GameEvent =
  | { type: 'played'; seat: number; effect: EffectKind; cards: CardKind[]; targetSeat: number | null; namedCard: CardKind | null }
  | { type: 'noped'; seat: number; nopeCount: number }
  | { type: 'cancelled'; seat: number; effect: EffectKind }
  | { type: 'resolved'; seat: number; effect: EffectKind; targetSeat: number | null }
  | { type: 'drew'; seat: number }
  | { type: 'gotCard'; to: number; card: Card; from: 'deck' | number }
  | { type: 'lostCard'; to: number; card: Card; taker: number }
  | { type: 'peeked'; to: number; cards: Card[] }
  | { type: 'stole'; seat: number; targetSeat: number; success: boolean }
  | { type: 'favorGiven'; seat: number; targetSeat: number }
  | { type: 'exploded'; seat: number }
  | { type: 'defused'; seat: number }
  | { type: 'kegPlaced'; seat: number }
  | { type: 'eliminated'; seat: number; rank: number }
  | { type: 'turnStart'; seat: number; turnsLeft: number }
  | { type: 'timeout'; seat: number }
  | { type: 'gameOver'; ranking: RankEntry[] };

export interface RankEntry {
  seat: number;
  nickname: string;
  rank: number;
  turnsSurvived: number;
}

// ───────────── 房间 ─────────────

export interface RoomPlayer {
  seat: number;
  nickname: string;
  avatar: string | null;
  connected: boolean;
  isGuest: boolean;
  /** 电脑玩家：由服务器替它出牌 */
  isBot: boolean;
}

export interface RoomState {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  hostSeat: number;
  /** 收到这条消息的人自己的座位号（每个人收到的不一样） */
  mySeat: number;
  players: RoomPlayer[];
  ranking: RankEntry[] | null;
}

export const ROOM_CODE_LENGTH = 6;

export const nicknameSchema = z.string().trim().min(1).max(12);

export const joinSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  nickname: nicknameSchema.optional(),
  /** 断线重连用：之前拿到的座位凭证 */
  seatToken: z.string().max(64).optional(),
});

export const createRoomSchema = z.object({
  nickname: nicknameSchema.optional(),
  /** 开房间时顺便拉几个电脑玩家（单人模式用） */
  bots: z.number().int().min(0).max(MAX_PLAYERS - 1).optional(),
});

export const removeBotSchema = z.object({ seat: z.number().int().min(0).max(MAX_PLAYERS - 1) });

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface JoinResult {
  code: string;
  seat: number;
  seatToken: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: z.input<typeof createRoomSchema>, ack: (res: Ack<JoinResult>) => void) => void;
  'room:join': (payload: z.input<typeof joinSchema>, ack: (res: Ack<JoinResult>) => void) => void;
  'room:leave': () => void;
  'room:addBot': (ack: (res: Ack) => void) => void;
  'room:removeBot': (payload: z.input<typeof removeBotSchema>, ack: (res: Ack) => void) => void;
  'room:start': (ack: (res: Ack) => void) => void;
  'room:again': (ack: (res: Ack) => void) => void;
  'game:action': (action: Action, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'game:view': (view: PlayerView) => void;
  'game:events': (events: GameEvent[]) => void;
  'room:closed': (reason: string) => void;
}

// ───────────── HTTP 接口 ─────────────

export const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(72),
  nickname: nicknameSchema,
});

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(72),
});

export const AVATARS = ['🏴‍☠️', '🦜', '⚓', '🐙', '🦈', '🗺️', '🧭', '🐒'] as const;

export const profileSchema = z.object({
  nickname: nicknameSchema.optional(),
  avatar: z.enum(AVATARS).optional(),
});

export interface Me {
  id: string;
  email: string;
  nickname: string;
  avatar: string | null;
}

export interface Stats {
  games: number;
  wins: number;
  /** 没打过为 null */
  avgRank: number | null;
  recent: { matchId: string; endedAt: string; playerCount: number; rank: number; turnsSurvived: number }[];
}

// ───────────── 计时（毫秒） ─────────────

export const TIMERS = {
  nope: 3_000,
  turn: 30_000,
  favor: 15_000,
  placeKeg: 15_000,
  /** 轮到掉线的玩家时用更短的时间 */
  disconnectedTurn: 8_000,
  /** 掉线后座位保留多久 */
  seatHold: 60_000,
  /** 电脑玩家每次行动前“想”多久（实际会在这个值上下浮动） */
  botThink: 1_100,
} as const;
