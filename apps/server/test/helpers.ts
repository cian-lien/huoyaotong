import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, PlayerView, RoomState, ServerToClientEvents } from '@hyt/shared';
import { buildApp, type App } from '../src/app.ts';
import type { Timers } from '../src/rooms.ts';
import { MemoryStore } from '../src/store-memory.ts';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  lastView: PlayerView | null;
  lastRoom: RoomState | null;
};

export interface Harness {
  app: App;
  store: MemoryStore;
  url: string;
  clients: Client[];
  client(cookie?: string): Promise<Client>;
  /** 注册一个账号，返回登录 cookie */
  register(email: string, nickname: string): Promise<string>;
  close(): Promise<void>;
}

export async function harness(timers: Partial<Timers> = {}): Promise<Harness> {
  const store = new MemoryStore();
  const app = await buildApp({ store, timers });
  await app.fastify.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.fastify.server.address() as AddressInfo).port}`;
  const clients: Client[] = [];

  return {
    app,
    store,
    url,
    clients,
    async client(cookie) {
      const socket = connect(url, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: cookie ? { cookie } : undefined,
      }) as Client;
      socket.lastView = null;
      socket.lastRoom = null;
      socket.on('game:view', (v) => (socket.lastView = v));
      socket.on('room:state', (r) => (socket.lastRoom = r));
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return socket;
    },
    async register(email, nickname) {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'password123', nickname },
      });
      if (res.statusCode !== 200) throw new Error(`注册失败：${res.body}`);
      const set = res.headers['set-cookie'];
      return String(Array.isArray(set) ? set[0] : set).split(';')[0] as string;
    },
    async close() {
      for (const c of clients) c.disconnect();
      await app.close();
    },
  };
}

export function createRoom(c: Client, nickname?: string, bots?: number): Promise<Ack<JoinResult>> {
  return new Promise((resolve) => c.emit('room:create', { nickname, bots }, resolve));
}

export function addBot(c: Client): Promise<Ack> {
  return new Promise((resolve) => c.emit('room:addBot', resolve));
}

export function removeBot(c: Client, seat: number): Promise<Ack> {
  return new Promise((resolve) => c.emit('room:removeBot', { seat }, resolve));
}

export function joinRoom(c: Client, code: string, extra: { nickname?: string; seatToken?: string } = {}): Promise<Ack<JoinResult>> {
  return new Promise((resolve) => c.emit('room:join', { code, ...extra }, resolve));
}

export function startGame(c: Client): Promise<Ack> {
  return new Promise((resolve) => c.emit('room:start', resolve));
}

export function playAgain(c: Client): Promise<Ack> {
  return new Promise((resolve) => c.emit('room:again', resolve));
}

export function send(c: Client, action: Parameters<ClientToServerEvents['game:action']>[0]): Promise<Ack> {
  return new Promise((resolve) => c.emit('game:action', action, resolve));
}

/** 等到某个条件成立（轮询，超时报错） */
export async function until<T>(check: () => T | null | undefined | false, what: string, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`等了 ${ms}ms 还没等到：${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function unwrap<T>(ack: Ack<T>): T {
  if (!ack.ok) throw new Error(ack.error);
  return ack;
}

/** 让一个客户端自动打牌：轮到自己就行动，摸到火药桶就放回货舱顶 */
export function autoPlay(c: Client) {
  c.on('game:view', (v) => {
    if (v.phase === 'turn' && v.currentSeat === v.mySeat) {
      const easy = v.myHand.find((x) => x.kind === 'skip' || x.kind === 'shuffle' || x.kind === 'peek');
      if (easy && Math.random() < 0.3) c.emit('game:action', { type: 'play', cardIds: [easy.id] }, () => {});
      else c.emit('game:action', { type: 'draw' }, () => {});
    } else if (v.phase === 'favor' && v.favor?.targetSeat === v.mySeat && v.myHand[0]) {
      c.emit('game:action', { type: 'giveCard', cardId: v.myHand[0].id }, () => {});
    } else if (v.phase === 'placeKeg' && v.kegSeat === v.mySeat) {
      c.emit('game:action', { type: 'placeKeg', position: 0 }, () => {});
    }
  });
}
