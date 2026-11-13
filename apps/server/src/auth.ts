import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, profileSchema, registerSchema, type Me } from '@hyt/shared';
import { toMe, type Store } from './store.ts';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 10;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

/** cookie 里放随机 token，数据库里只存它的哈希 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** 用 cookie 头找出登录的用户；WebSocket 握手时也用这个 */
export async function userFromCookieHeader(store: Store, header: string | undefined): Promise<Me | null> {
  const token = parseCookies(header)[SESSION_COOKIE];
  if (!token) return null;
  return store.getSessionUser(hashToken(token));
}

export function registerAuthRoutes(app: FastifyInstance, store: Store, opts: { secureCookie: boolean }) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  async function startSession(reply: FastifyReply, userId: string) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await store.createSession(hashToken(token), userId, expiresAt);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      path: '/',
      expires: expiresAt,
    });
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<Me | null> {
    const user = await userFromCookieHeader(store, req.headers.cookie);
    if (!user) reply.code(401).send({ error: '请先登录' });
    return user;
  }

  app.post('/api/auth/register', strict, async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '邮箱格式不对，或密码少于 8 位，或昵称超过 12 个字' });
    const email = body.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(body.data.password, BCRYPT_ROUNDS);
    const user = await store.createUser({ email, passwordHash, nickname: body.data.nickname });
    if (!user) return reply.code(409).send({ error: '这个邮箱已经注册过了' });
    await startSession(reply, user.id);
    return toMe(user);
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '请填写邮箱和密码' });
    const user = await store.findUserByEmail(body.data.email.toLowerCase());
    // 用户不存在时也算一次哈希，避免通过响应时间猜出邮箱有没有注册
    const ok = await bcrypt.compare(body.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return reply.code(401).send({ error: '邮箱或密码不对' });
    await startSession(reply, user.id);
    return toMe(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await store.deleteSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // 没登录不算错误：返回 user: null，前端用它判断是不是游客
  app.get('/api/me', async (req) => {
    return { user: await userFromCookieHeader(store, req.headers.cookie) };
  });

  app.patch('/api/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    const body = profileSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: '昵称要在 1–12 个字之间' });
    return store.updateProfile(user.id, body.data);
  });

  app.get('/api/me/stats', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return reply;
    return store.getStats(user.id);
  });
}
