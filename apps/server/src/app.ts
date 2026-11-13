import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { TIMERS } from '@hyt/shared';
import { registerAuthRoutes, userFromCookieHeader } from './auth.ts';
import { RoomManager, type IO, type Timers } from './rooms.ts';
import type { Store } from './store.ts';

export interface AppOptions {
  store: Store;
  /** 测试里会把计时调得很短 */
  timers?: Partial<Timers>;
  logger?: boolean;
  /** 线上走 HTTPS 时为 true：cookie 只在 HTTPS 下发送 */
  secureCookie?: boolean;
}

export interface App {
  fastify: FastifyInstance;
  io: IO;
  rooms: RoomManager;
  close(): Promise<void>;
}

/** 组装整个服务：HTTP 接口和 Socket.IO 共用一个端口 */
export async function buildApp(opts: AppOptions): Promise<App> {
  const fastify = Fastify({ logger: opts.logger ?? false, trustProxy: true });

  await fastify.register(cookie);
  await fastify.register(rateLimit, { global: false });

  fastify.get('/api/health', async () => ({ ok: true, rooms: rooms.roomCount }));
  registerAuthRoutes(fastify, opts.store, { secureCookie: opts.secureCookie ?? false });

  const io: IO = new Server(fastify.server, {
    // 前后端同源，不需要跨域
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
  });

  // 握手时用 cookie 认人；没登录就是游客
  io.use(async (socket, next) => {
    try {
      socket.data.user = await userFromCookieHeader(opts.store, socket.request.headers.cookie);
      next();
    } catch (err) {
      fastify.log.error(err, 'WebSocket 握手时查登录状态失败');
      next(new Error('服务器开小差了，请稍后再试'));
    }
  });

  const rooms = new RoomManager(io, opts.store, { ...TIMERS, ...opts.timers }, fastify.log);
  io.on('connection', (socket) => rooms.attach(socket));

  return {
    fastify,
    io,
    rooms,
    async close() {
      rooms.shutdown();
      await io.close();
      await fastify.close();
    },
  };
}
