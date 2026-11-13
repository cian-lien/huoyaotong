import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import {
  type Ack,
  type Action,
  type Card,
  type ClientToServerEvents,
  type GameEvent,
  type JoinResult,
  type Me,
  type PlayerView,
  type RoomState,
  type ServerToClientEvents,
  CARD_META,
} from '@hyt/shared';
import { api } from './api.ts';
import { play } from './sound.ts';

export interface LogLine {
  id: number;
  text: string;
  tone: 'plain' | 'danger' | 'good' | 'mine';
}

export interface Banner {
  id: number;
  icon: string;
  text: string;
}

interface State {
  /** undefined = 还在查登录状态 */
  me: Me | null | undefined;
  connected: boolean;
  room: RoomState | null;
  view: PlayerView | null;
  /** 服务器时间 − 本地时间，用来把服务器的 deadline 换算成本地倒计时 */
  clockOffset: number;
  /** 当前计时器的总时长（毫秒），画引线用 */
  timerTotal: number;
  log: LogLine[];
  /** 望远镜看到的牌 */
  peek: Card[] | null;
  banner: Banner | null;
  /** 火药桶特写：谁摸到了，有没有拆掉 */
  blast: { id: number; nickname: string; mine: boolean; defused: boolean | null } | null;
  toast: string | null;
  /** 被请出房间的原因 */
  closed: string | null;
}

export const useGame = create<State>(() => ({
  me: undefined,
  connected: false,
  room: null,
  view: null,
  clockOffset: 0,
  timerTotal: 0,
  log: [],
  peek: null,
  banner: null,
  blast: null,
  toast: null,
  closed: null,
}));

const set = useGame.setState;
const get = useGame.getState;
let nextId = 1;

// ───────────── 本地存储（拿不到就算了） ─────────────

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 存不下：这次访问里断线后就得重新加入
  }
}

export const savedNickname = () => load('hyt:nickname') ?? '';
const seatKey = (code: string) => `hyt:seat:${code}`;

// ───────────── 提示 ─────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  clearTimeout(toastTimer);
  set({ toast: text });
  toastTimer = setTimeout(() => set({ toast: null }), 3200);
}

let bannerTimer: ReturnType<typeof setTimeout> | undefined;
function banner(icon: string, text: string) {
  clearTimeout(bannerTimer);
  set({ banner: { id: nextId++, icon, text } });
  bannerTimer = setTimeout(() => set({ banner: null }), 1800);
}

function log(text: string, tone: LogLine['tone'] = 'plain') {
  set((s) => ({ log: [...s.log.slice(-199), { id: nextId++, text, tone }] }));
}

// ───────────── 事件 → 日志、提示、音效 ─────────────

function nameOf(seat: number): string {
  const { view, room } = get();
  const mySeat = view?.mySeat ?? room?.mySeat;
  if (seat === mySeat) return '你';
  return view?.players[seat]?.nickname ?? room?.players.find((p) => p.seat === seat)?.nickname ?? `${seat + 1} 号位`;
}

const EFFECT_NAME: Record<string, string> = {
  skip: '溜号',
  attack: '甩锅',
  peek: '望远镜',
  shuffle: '翻货舱',
  favor: '讨要',
  reverse: '倒转航向',
};

function handleEvent(e: GameEvent) {
  const mySeat = get().view?.mySeat ?? get().room?.mySeat;
  switch (e.type) {
    case 'played': {
      const first = e.cards[0];
      const meta = first ? CARD_META[first] : null;
      const what =
        e.effect === 'pair' || e.effect === 'triple' ? `${e.cards.length} 张${meta?.name ?? '船员牌'}` : (EFFECT_NAME[e.effect] ?? '');
      const target = e.targetSeat === null ? '' : `，目标是${nameOf(e.targetSeat)}`;
      const named = e.namedCard ? `，点名要「${CARD_META[e.namedCard].name}」` : '';
      log(`${nameOf(e.seat)}打出${what}${target}${named}`, e.seat === mySeat ? 'mine' : 'plain');
      banner(meta?.icon ?? '🃏', `${nameOf(e.seat)}打出${what}`);
      play('card');
      break;
    }
    case 'noped':
      log(`${nameOf(e.seat)}驳回！`, 'danger');
      banner('✋', `${nameOf(e.seat)}驳回！`);
      play('nope');
      break;
    case 'cancelled':
      log(`${nameOf(e.seat)}的牌被驳回，作废了`);
      break;
    case 'resolved':
      if (e.effect === 'shuffle') log('货舱被打乱了');
      if (e.effect === 'reverse') log('出牌顺序反过来了');
      if (e.effect === 'peek' && e.seat !== mySeat) log(`${nameOf(e.seat)}偷看了货舱顶上的牌`);
      break;
    case 'drew':
      log(`${nameOf(e.seat)}摸了一张牌`);
      play('draw');
      break;
    case 'gotCard':
      if (e.from === 'deck') log(`你摸到了「${CARD_META[e.card.kind].name}」`, 'mine');
      else log(`你从${nameOf(e.from)}那里拿到了「${CARD_META[e.card.kind].name}」`, 'mine');
      break;
    case 'lostCard':
      log(`${nameOf(e.taker)}拿走了你的「${CARD_META[e.card.kind].name}」`, 'mine');
      break;
    case 'peeked':
      set({ peek: e.cards });
      break;
    case 'stole':
      if (!e.success) log(`${nameOf(e.seat)}什么也没拿到`);
      else if (e.seat !== mySeat && e.targetSeat !== mySeat) log(`${nameOf(e.seat)}从${nameOf(e.targetSeat)}那里拿走一张牌`);
      break;
    case 'favorGiven':
      if (e.seat !== mySeat && e.targetSeat !== mySeat) log(`${nameOf(e.targetSeat)}给了${nameOf(e.seat)}一张牌`);
      break;
    case 'exploded':
      log(`${nameOf(e.seat)}摸到了火药桶！`, 'danger');
      set({ blast: { id: nextId++, nickname: nameOf(e.seat), mine: e.seat === mySeat, defused: null } });
      play('boom');
      break;
    case 'defused':
      log(`${nameOf(e.seat)}用灭火桶拆掉了`, 'good');
      set((s) => ({ blast: s.blast ? { ...s.blast, defused: true } : null }));
      setTimeout(() => play('defuse'), 500);
      setTimeout(() => set({ blast: null }), 1700);
      break;
    case 'kegPlaced':
      log(`${nameOf(e.seat)}把火药桶塞回了货舱`);
      break;
    case 'eliminated':
      log(`${nameOf(e.seat)}出局，第 ${e.rank} 名`, 'danger');
      set((s) => ({ blast: s.blast ? { ...s.blast, defused: false } : null }));
      setTimeout(() => set({ blast: null }), 2000);
      if (e.seat === mySeat) play('out');
      break;
    case 'turnStart':
      if (get().log.length === 0) log(`对局开始，${nameOf(e.seat)}先出牌`, 'good');
      if (e.seat === mySeat) {
        log(e.turnsLeft > 1 ? `轮到你了，要连续进行 ${e.turnsLeft} 个回合` : '轮到你了', 'mine');
        play('myTurn');
      }
      break;
    case 'timeout':
      log(`${nameOf(e.seat)}超时了，系统替${e.seat === mySeat ? '你' : '他'}行动`);
      break;
    case 'gameOver': {
      const winner = e.ranking[0];
      if (winner) log(`对局结束，${nameOf(winner.seat)}活到了最后`, 'good');
      if (winner?.seat === mySeat) play('win');
      break;
    }
  }
}

// ───────────── 连接 ─────────────

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: GameSocket | null = null;
/** 当前所在的房间号：断线重连后要自动回去 */
let currentCode: string | null = null;

function getSocket(): GameSocket {
  if (socket) return socket;
  const s: GameSocket = io({ transports: ['websocket', 'polling'] });
  socket = s;

  s.on('connect', () => {
    set({ connected: true });
    // 网络断了又连上：凭座位凭证回到原来的房间
    if (currentCode && get().room) void joinRoom(currentCode);
  });
  s.on('disconnect', () => set({ connected: false }));
  s.on('room:state', (room) => {
    const before = get().room;
    if (before?.status !== 'lobby' && room.status === 'lobby') set({ view: null, log: [], peek: null, blast: null });
    set({ room });
  });
  s.on('game:view', (view) => {
    const prev = get().view;
    const patch: Partial<State> = { view, clockOffset: view.serverNow - Date.now() };
    if (view.deadline !== null && view.deadline !== prev?.deadline) patch.timerTotal = view.deadline - view.serverNow;
    set(patch);
  });
  s.on('game:events', (events) => events.forEach(handleEvent));
  s.on('room:closed', (reason) => {
    currentCode = null;
    set({ room: null, view: null, closed: reason });
  });
  return s;
}

function emitWithAck<T>(send: (s: GameSocket, ack: (res: Ack<T>) => void) => void): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const s = getSocket();
    const timer = setTimeout(() => resolve({ ok: false, error: '服务器没有回应，检查一下网络' }), 8000);
    send(s, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function entered(res: Ack<JoinResult>) {
  if (!res.ok) return;
  currentCode = res.code;
  save(seatKey(res.code), res.seatToken);
  set({ closed: null });
}

/** bots > 0 时是单人模式：带上电脑玩家，开好房间后直接开局 */
export async function createRoom(nickname: string, bots = 0): Promise<Ack<JoinResult>> {
  if (nickname) save('hyt:nickname', nickname);
  set({ room: null, view: null, log: [], peek: null, blast: null });
  const res = await emitWithAck<JoinResult>((s, ack) => s.emit('room:create', { nickname: nickname || undefined, bots }, ack));
  entered(res);
  if (res.ok && bots > 0) {
    const started = await startGame();
    if (!started.ok) toast(started.error);
  }
  return res;
}

export async function joinRoom(code: string, nickname?: string): Promise<Ack<JoinResult>> {
  if (nickname) save('hyt:nickname', nickname);
  const name = nickname || savedNickname() || undefined;
  const seatToken = load(seatKey(code)) ?? undefined;
  const res = await emitWithAck<JoinResult>((s, ack) => s.emit('room:join', { code, nickname: name, seatToken }, ack));
  entered(res);
  return res;
}

export function leaveRoom() {
  if (currentCode) save(seatKey(currentCode), null);
  currentCode = null;
  socket?.emit('room:leave');
  set({ room: null, view: null, log: [], peek: null, blast: null, banner: null });
}

export const startGame = () => emitWithAck((s, ack) => s.emit('room:start', ack));
export const addBot = () => emitWithAck((s, ack) => s.emit('room:addBot', ack));
export const removeBot = (seat: number) => emitWithAck((s, ack) => s.emit('room:removeBot', { seat }, ack));
export const playAgain = () => emitWithAck((s, ack) => s.emit('room:again', ack));

/** 发一个对局操作；被服务器拒绝时弹出原因 */
export async function act(action: Action): Promise<boolean> {
  const res = await emitWithAck((s, ack) => s.emit('game:action', action, ack));
  if (!res.ok) toast(res.error);
  return res.ok;
}

// ───────────── 账号 ─────────────

export async function loadMe() {
  try {
    set({ me: await api.me() });
  } catch {
    set({ me: null });
  }
}

/** 登录状态变了：换一条连接，让服务器重新认人 */
export function setMe(me: Me | null) {
  set({ me });
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}
