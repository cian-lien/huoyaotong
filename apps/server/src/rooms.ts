import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  type Ack,
  type Action,
  type CardKind,
  type ClientToServerEvents,
  type GameEvent,
  type JoinResult,
  type Me,
  type PlayerView,
  type RankEntry,
  type RoomState,
  type ServerToClientEvents,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
  TIMERS,
  actionSchema,
  createRoomSchema,
  joinSchema,
  removeBotSchema,
} from '@hyt/shared';
import {
  type GameState,
  type Rng,
  type Step,
  applyAction,
  applyTimeout,
  botDecide,
  createGame,
  eventVisibleTo,
  forfeit,
  ranking,
  viewFor,
} from '@hyt/engine';
import type { Store } from './store.ts';

export interface SocketData {
  user: Me | null;
  roomCode: string | null;
  seatToken: string | null;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export type Timers = { [K in keyof typeof TIMERS]: number };

interface Seat {
  /** 对局中等于规则引擎里的座位号；大厅里有人离开会重新编号 */
  seat: number;
  /** 座位凭证：断线重连靠它认人 */
  token: string;
  userId: string | null;
  nickname: string;
  avatar: string | null;
  socketId: string | null;
  /** 掉线后的座位保留计时 */
  holdTimer: NodeJS.Timeout | null;
  /** 对局中途离开的人：座位号要留着，但人已经不在了 */
  left: boolean;
  /** 电脑玩家：没有连接，由服务器替它出牌 */
  bot: boolean;
}

interface Room {
  code: string;
  status: RoomState['status'];
  hostToken: string;
  seats: Seat[];
  game: GameState | null;
  ranking: RankEntry[] | null;
  startedAt: Date | null;
  timer: NodeJS.Timeout | null;
  deadline: number | null;
  /** 电脑玩家“想好了”之后要执行的动作 */
  botTimers: NodeJS.Timeout[];
  /** 每个电脑用望远镜看到的货舱顶；牌堆一动就作废 */
  botKnown: (CardKind | null)[];
}

const MAX_ROOMS = 500;
const BOT_NAMES = ['铁钩', '老船长', '独眼龙', '小水手'];
const rng: Rng = (n) => randomInt(n);

/**
 * 房间服务：每个房间一份内存状态。
 * 所有处理函数都是同步的（中间没有 await），所以同一房间的操作天然按到达顺序一个个处理。
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private io: IO,
    private store: Store,
    private timers: Timers = TIMERS,
    private log: { error: (obj: unknown, msg?: string) => void } = console,
  ) {}

  get roomCount() {
    return this.rooms.size;
  }

  attach(socket: GameSocket) {
    socket.data.roomCode = null;
    socket.data.seatToken = null;

    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      ack(this.create(socket, payload));
    });
    socket.on('room:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      ack(this.join(socket, payload));
    });
    socket.on('room:leave', () => this.leave(socket));
    socket.on('room:addBot', (ack) => {
      if (typeof ack !== 'function') return;
      ack(this.addBot(socket));
    });
    socket.on('room:removeBot', (payload, ack) => {
      if (typeof ack !== 'function') return;
      ack(this.removeBot(socket, payload));
    });
    socket.on('room:start', (ack) => {
      if (typeof ack !== 'function') return;
      ack(this.start(socket));
    });
    socket.on('room:again', (ack) => {
      if (typeof ack !== 'function') return;
      ack(this.again(socket));
    });
    socket.on('game:action', (action, ack) => {
      if (typeof ack !== 'function') return;
      ack(this.action(socket, action));
    });
    socket.on('disconnect', () => this.detach(socket));
  }

  /** 关服时调用：清掉所有计时器 */
  shutdown() {
    for (const room of this.rooms.values()) this.destroy(room);
  }

  // ───────────── 进出房间 ─────────────

  private create(socket: GameSocket, payload: unknown): Ack<JoinResult> {
    const parsed = createRoomSchema.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, error: '昵称要在 1–12 个字之间' };
    const nickname = socket.data.user?.nickname ?? parsed.data.nickname;
    if (!nickname) return { ok: false, error: '请先起一个昵称' };
    if (this.rooms.size >= MAX_ROOMS) return { ok: false, error: '房间太多了，过一会儿再试' };

    this.detach(socket);
    const room: Room = {
      code: this.newCode(),
      status: 'lobby',
      hostToken: '',
      seats: [],
      game: null,
      ranking: null,
      startedAt: null,
      timer: null,
      deadline: null,
      botTimers: [],
      botKnown: [],
    };
    this.rooms.set(room.code, room);
    const seat = this.addSeat(room, socket, nickname);
    room.hostToken = seat.token;
    for (let i = 0; i < (parsed.data.bots ?? 0); i++) this.addBotSeat(room);
    this.emitRoom(room);
    return { ok: true, code: room.code, seat: seat.seat, seatToken: seat.token };
  }

  private join(socket: GameSocket, payload: unknown): Ack<JoinResult> {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '房间号是 6 位数字' };
    const { code, seatToken } = parsed.data;
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: '房间不存在，可能已经解散了' };
    const user = socket.data.user;

    // 先看是不是回来的老玩家：凭座位凭证，或同一个登录账号
    let seat =
      room.seats.find((s) => !s.left && !s.bot && seatToken !== undefined && s.token === seatToken) ??
      room.seats.find((s) => !s.left && !s.bot && user !== null && s.userId === user.id);

    if (seat) {
      if (socket.data.roomCode !== room.code || socket.data.seatToken !== seat.token) this.detach(socket);
      this.bind(room, seat, socket);
    } else {
      if (room.status !== 'lobby') return { ok: false, error: '对局已经开始，不能中途加入' };
      if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: `房间满了（最多 ${MAX_PLAYERS} 人）` };
      const nickname = user?.nickname ?? parsed.data.nickname;
      if (!nickname) return { ok: false, error: '请先起一个昵称' };
      this.detach(socket);
      seat = this.addSeat(room, socket, nickname);
    }

    this.emitRoom(room);
    if (room.game) {
      // 轮到回来的人做决定时，重新给足时间
      if (this.decidingSeat(room.game) === seat.seat) this.schedule(room);
      this.emitGame(room, []);
    }
    return { ok: true, code: room.code, seat: seat.seat, seatToken: seat.token };
  }

  private addSeat(room: Room, socket: GameSocket, nickname: string): Seat {
    const taken = new Set(room.seats.map((s) => s.nickname));
    let name = nickname;
    for (let i = 2; taken.has(name); i++) name = `${nickname}${i}`;

    const seat: Seat = {
      seat: room.seats.length,
      token: randomBytes(24).toString('hex'),
      userId: socket.data.user?.id ?? null,
      nickname: name,
      avatar: socket.data.user?.avatar ?? null,
      socketId: null,
      holdTimer: null,
      left: false,
      bot: false,
    };
    room.seats.push(seat);
    this.bind(room, seat, socket);
    return seat;
  }

  // ───────────── 电脑玩家 ─────────────

  private addBotSeat(room: Room): Seat {
    const taken = new Set(room.seats.map((s) => s.nickname));
    const name = BOT_NAMES.map((n) => `电脑·${n}`).find((n) => !taken.has(n)) ?? `电脑·${room.seats.length + 1}号`;
    const seat: Seat = {
      seat: room.seats.length,
      token: randomBytes(24).toString('hex'),
      userId: null,
      nickname: name,
      avatar: '🤖',
      socketId: null,
      holdTimer: null,
      left: false,
      bot: true,
    };
    room.seats.push(seat);
    return seat;
  }

  private addBot(socket: GameSocket): Ack {
    const at = this.locate(socket);
    if (!at) return { ok: false, error: '你不在房间里' };
    const { room, seat } = at;
    if (room.hostToken !== seat.token) return { ok: false, error: '只有房主能加电脑玩家' };
    if (room.status !== 'lobby') return { ok: false, error: '对局已经开始了' };
    if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: `房间满了（最多 ${MAX_PLAYERS} 人）` };
    this.addBotSeat(room);
    this.emitRoom(room);
    return { ok: true };
  }

  private removeBot(socket: GameSocket, payload: unknown): Ack {
    const at = this.locate(socket);
    if (!at) return { ok: false, error: '你不在房间里' };
    const { room, seat } = at;
    if (room.hostToken !== seat.token) return { ok: false, error: '只有房主能移除电脑玩家' };
    if (room.status !== 'lobby') return { ok: false, error: '对局已经开始了' };
    const parsed = removeBotSchema.safeParse(payload);
    const target = parsed.success ? room.seats[parsed.data.seat] : undefined;
    if (!target?.bot) return { ok: false, error: '这个座位不是电脑玩家' };
    room.seats = room.seats.filter((s) => s !== target);
    room.seats.forEach((s, i) => (s.seat = i));
    this.emitRoom(room);
    return { ok: true };
  }

  /** 让该行动的电脑“想一会儿”再出牌；驳回窗口里每个电脑各自决定要不要驳回 */
  private scheduleBots(room: Room) {
    for (const t of room.botTimers) clearTimeout(t);
    room.botTimers = [];
    const game = room.game;
    if (!game || game.phase === 'over' || room.status !== 'playing') return;

    // 活着的只剩电脑时加快节奏，别让出局的人干等
    const humanAlive = room.seats.some((s) => !s.bot && !s.left && game.players[s.seat]?.alive);
    const base = humanAlive ? this.timers.botThink : this.timers.botThink / 4;

    for (const bot of room.seats) {
      if (!bot.bot) continue;
      const action = botDecide(game, bot.seat, rng, { knownTop: room.botKnown[bot.seat] ?? null });
      if (!action) continue;
      let delay = base * (0.6 + Math.random() * 0.8);
      // 驳回必须赶在窗口关闭之前
      if (game.phase === 'nope') delay = Math.min(delay, this.timers.nope * 0.7);

      room.botTimers.push(
        setTimeout(() => {
          // 这段时间里牌局已经变了（比如别人先驳回了）：这次决定作废，新状态会重新安排
          if (room.game !== game || room.status !== 'playing') return;
          const res = applyAction(game, bot.seat, action, rng);
          if (res.ok) this.commit(room, res);
          else this.log.error({ action, error: res.error }, `房间 ${room.code} 的电脑玩家做了不合法的操作`);
        }, delay),
      );
    }
  }

  /** 记下电脑用望远镜看到的牌；货舱一有变动就全部忘掉 */
  private rememberForBots(room: Room, events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'peeked') {
        if (room.seats[e.to]?.bot) room.botKnown[e.to] = e.cards[0]?.kind ?? null;
      } else if (
        e.type === 'drew' ||
        e.type === 'kegPlaced' ||
        e.type === 'eliminated' ||
        (e.type === 'resolved' && e.effect === 'shuffle')
      ) {
        room.botKnown = [];
      }
    }
  }

  /** 把一条连接绑到座位上；同一个座位之前的连接会被顶掉 */
  private bind(room: Room, seat: Seat, socket: GameSocket) {
    if (seat.socketId && seat.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(seat.socketId);
      if (old) {
        old.data.roomCode = null;
        old.data.seatToken = null;
        old.emit('room:closed', '你在别的窗口打开了这个房间');
      }
    }
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    seat.holdTimer = null;
    seat.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.seatToken = seat.token;
  }

  private locate(socket: GameSocket): { room: Room; seat: Seat } | null {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    const seat = room?.seats.find((s) => s.token === socket.data.seatToken && s.socketId === socket.id);
    return room && seat ? { room, seat } : null;
  }

  /** 连接断了（或换房间）：座位先留着，过了保留时间还没回来再处理 */
  private detach(socket: GameSocket) {
    const at = this.locate(socket);
    socket.data.roomCode = null;
    socket.data.seatToken = null;
    if (!at) return;
    const { room, seat } = at;

    seat.socketId = null;
    seat.holdTimer = setTimeout(() => {
      seat.holdTimer = null;
      this.remove(room, seat);
    }, this.timers.seatHold);

    this.emitRoom(room);
    if (room.game && room.status === 'playing') {
      // 正等着这个人做决定：换成更短的计时，别让其他人干等
      if (this.decidingSeat(room.game) === seat.seat) this.schedule(room);
      this.emitGame(room, []);
    }
  }

  /** 主动离开：不保留座位 */
  private leave(socket: GameSocket) {
    const at = this.locate(socket);
    socket.data.roomCode = null;
    socket.data.seatToken = null;
    if (!at) return;
    at.seat.socketId = null;
    this.remove(at.room, at.seat);
  }

  /** 把一个人彻底请出房间 */
  private remove(room: Room, seat: Seat) {
    if (!this.rooms.has(room.code) || seat.left || !room.seats.includes(seat)) return;
    if (seat.holdTimer) clearTimeout(seat.holdTimer);
    seat.holdTimer = null;
    seat.socketId = null;

    if (room.status === 'lobby') {
      room.seats = room.seats.filter((s) => s !== seat);
      room.seats.forEach((s, i) => (s.seat = i));
    } else {
      // 对局中座位号不能变，只做标记
      seat.left = true;
    }

    // 真人都走了就解散，电脑不算
    const present = room.seats.filter((s) => !s.left && !s.bot);
    if (present.length === 0) {
      this.destroy(room);
      return;
    }
    if (room.hostToken === seat.token) {
      room.hostToken = (present.find((s) => s.socketId) ?? present[0] as Seat).token;
    }

    this.emitRoom(room);
    if (room.status === 'playing' && room.game) {
      this.commit(room, forfeit(room.game, seat.seat, rng));
    }
  }

  private destroy(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    for (const t of room.botTimers) clearTimeout(t);
    room.botTimers = [];
    for (const s of room.seats) {
      if (s.holdTimer) clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }
    this.rooms.delete(room.code);
  }

  private newCode(): string {
    for (;;) {
      const code = String(randomInt(10 ** ROOM_CODE_LENGTH)).padStart(ROOM_CODE_LENGTH, '0');
      if (!this.rooms.has(code)) return code;
    }
  }

  // ───────────── 对局 ─────────────

  private start(socket: GameSocket): Ack {
    const at = this.locate(socket);
    if (!at) return { ok: false, error: '你不在房间里' };
    const { room, seat } = at;
    if (room.hostToken !== seat.token) return { ok: false, error: '只有房主能开始' };
    if (room.status !== 'lobby') return { ok: false, error: '对局已经开始了' };
    if (room.seats.length < MIN_PLAYERS) return { ok: false, error: `至少要 ${MIN_PLAYERS} 个人才能开始` };

    room.status = 'playing';
    room.ranking = null;
    room.startedAt = new Date();
    room.botKnown = [];
    this.emitRoom(room);
    this.commit(
      room,
      createGame(
        room.seats.map((s) => s.nickname),
        rng,
      ),
    );
    return { ok: true };
  }

  /** 结算后再来一局：回到大厅，只留下还在线的人 */
  private again(socket: GameSocket): Ack {
    const at = this.locate(socket);
    if (!at) return { ok: false, error: '你不在房间里' };
    const { room, seat } = at;
    if (room.hostToken !== seat.token) return { ok: false, error: '只有房主能开下一局' };
    if (room.status !== 'over') return { ok: false, error: '这一局还没结束' };

    for (const s of room.seats) {
      if (s.holdTimer) clearTimeout(s.holdTimer);
      s.holdTimer = null;
    }
    // 留下还在线的真人和所有电脑
    room.seats = room.seats.filter((s) => s.bot || (!s.left && s.socketId));
    room.seats.forEach((s, i) => (s.seat = i));
    room.status = 'lobby';
    room.game = null;
    room.ranking = null;
    room.startedAt = null;
    this.emitRoom(room);
    return { ok: true };
  }

  private action(socket: GameSocket, payload: unknown): Ack {
    const at = this.locate(socket);
    if (!at) return { ok: false, error: '你不在房间里' };
    const { room, seat } = at;
    if (room.status !== 'playing' || !room.game) return { ok: false, error: '对局还没开始' };

    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '看不懂这个操作' };
    const action: Action = parsed.data;

    const res = applyAction(room.game, seat.seat, action, rng);
    if (!res.ok) return res;
    this.commit(room, res);
    return { ok: true };
  }

  /** 现在在等哪个座位做决定；驳回窗口是等所有人，返回 null */
  private decidingSeat(game: GameState): number | null {
    switch (game.phase) {
      case 'turn':
        return game.currentSeat;
      case 'favor':
        return game.favor?.targetSeat ?? null;
      case 'placeKeg':
        return game.keg?.seat ?? null;
      default:
        return null;
    }
  }

  /** 采纳规则引擎算出的新状态：存下来、广播、重新计时 */
  private commit(room: Room, step: Step) {
    room.game = step.state;
    this.rememberForBots(room, step.events);
    if (step.state.phase === 'over') {
      this.finish(room, step.state);
    } else {
      this.schedule(room);
    }
    this.scheduleBots(room);
    this.emitGame(room, step.events);
    if (room.status === 'over') this.emitRoom(room);
  }

  private schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = null;
    const game = room.game;
    if (!game || game.phase === 'over') return;

    let ms = this.timers[game.phase];
    const deciding = this.decidingSeat(game);
    const decider = deciding === null ? undefined : room.seats[deciding];
    if (decider && !decider.bot && !decider.socketId) ms = Math.min(ms, this.timers.disconnectedTurn);

    room.deadline = Date.now() + ms;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (!room.game || room.status !== 'playing') return;
      try {
        this.commit(room, applyTimeout(room.game, rng));
      } catch (err) {
        this.log.error(err, `房间 ${room.code} 处理超时出错`);
      }
    }, ms);
  }

  private finish(room: Room, game: GameState) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = null;
    room.status = 'over';
    room.ranking = ranking(game);
    for (const t of room.botTimers) clearTimeout(t);
    room.botTimers = [];

    // 有电脑参与的对局不记战绩，免得靠打电脑刷胜场
    if (room.seats.some((s) => s.bot)) return;

    this.store
      .saveMatch({
        startedAt: room.startedAt ?? new Date(),
        endedAt: new Date(),
        players: game.players.map((p) => ({
          seat: p.seat,
          userId: room.seats[p.seat]?.userId ?? null,
          nickname: p.nickname,
          rank: p.rank ?? game.players.length,
          turnsSurvived: p.turnsSurvived,
        })),
      })
      .catch((err: unknown) => this.log.error(err, `房间 ${room.code} 保存战绩失败`));
  }

  // ───────────── 广播 ─────────────

  private roomState(room: Room, mySeat: number): RoomState {
    return {
      code: room.code,
      status: room.status,
      hostSeat: room.seats.find((s) => s.token === room.hostToken)?.seat ?? 0,
      mySeat,
      players: room.seats
        .filter((s) => !s.left)
        .map((s) => ({
          seat: s.seat,
          nickname: s.nickname,
          avatar: s.avatar,
          connected: s.bot || s.socketId !== null,
          isGuest: s.userId === null && !s.bot,
          isBot: s.bot,
        })),
      ranking: room.ranking,
    };
  }

  private emitRoom(room: Room) {
    for (const s of room.seats) {
      if (s.socketId) this.io.to(s.socketId).emit('room:state', this.roomState(room, s.seat));
    }
  }

  private view(room: Room, game: GameState, seat: number): PlayerView {
    const base = viewFor(game, seat);
    return {
      ...base,
      players: base.players.map((p) => ({
        ...p,
        avatar: room.seats[p.seat]?.avatar ?? null,
        connected: room.seats[p.seat]?.bot === true || room.seats[p.seat]?.socketId != null,
      })),
      deadline: room.deadline,
      serverNow: Date.now(),
    };
  }

  /** 每个人只收到自己能看的事件和视图 */
  private emitGame(room: Room, events: GameEvent[]) {
    const game = room.game;
    if (!game) return;
    for (const s of room.seats) {
      if (!s.socketId) continue;
      const mine = events.filter((e) => eventVisibleTo(e, s.seat));
      if (mine.length > 0) this.io.to(s.socketId).emit('game:events', mine);
      this.io.to(s.socketId).emit('game:view', this.view(room, game, s.seat));
    }
  }
}
