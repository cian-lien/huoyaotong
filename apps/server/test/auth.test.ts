import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => h.close());

const post = (url: string, payload: object, cookie?: string) =>
  h.app.fastify.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {} });
const get = (url: string, cookie?: string) =>
  h.app.fastify.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

describe('账号', () => {
  it('注册后直接是登录状态，cookie 是 httpOnly 的', async () => {
    const res = await post('/api/auth/register', { email: 'A@Example.com', password: 'password123', nickname: '红胡子' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'a@example.com', nickname: '红胡子', avatar: null });
    expect(res.json()).not.toHaveProperty('passwordHash');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^sid=[0-9a-f]{64};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const me = await get('/api/me', setCookie.split(';')[0]);
    expect(me.json()).toMatchObject({ user: { nickname: '红胡子' } });
  });

  it('密码不明文存，数据库里也不存 cookie 里的 token', async () => {
    const cookie = await h.register('a@example.com', '红胡子');
    const user = [...h.store.users.values()][0];
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect([...h.store.sessions.keys()]).not.toContain(cookie.replace('sid=', ''));
  });

  it('同一个邮箱不能注册两次', async () => {
    await h.register('a@example.com', '红胡子');
    const res = await post('/api/auth/register', { email: 'a@example.com', password: 'password123', nickname: '别人' });
    expect(res.statusCode).toBe(409);
  });

  it.each([
    { email: '不是邮箱', password: 'password123', nickname: '红胡子' },
    { email: 'a@example.com', password: '短', nickname: '红胡子' },
    { email: 'a@example.com', password: 'password123', nickname: '' },
    { email: 'a@example.com', password: 'password123', nickname: '一个超过十二个字的非常长的昵称' },
  ])('注册信息不合格时拒绝 %#', async (payload) => {
    expect((await post('/api/auth/register', payload)).statusCode).toBe(400);
  });

  it('登录：密码对才行，错了不说是邮箱错还是密码错', async () => {
    await h.register('a@example.com', '红胡子');
    const ok = await post('/api/auth/login', { email: 'a@example.com', password: 'password123' });
    expect(ok.statusCode).toBe(200);

    const wrongPassword = await post('/api/auth/login', { email: 'a@example.com', password: 'wrong-password' });
    const noSuchUser = await post('/api/auth/login', { email: 'nobody@example.com', password: 'password123' });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchUser.json());
  });

  it('退出登录后 cookie 失效', async () => {
    const cookie = await h.register('a@example.com', '红胡子');
    expect((await post('/api/auth/logout', {}, cookie)).statusCode).toBe(200);
    expect((await get('/api/me', cookie)).json()).toEqual({ user: null });
    expect((await get('/api/me/stats', cookie)).statusCode).toBe(401);
  });

  it('没登录：查自己是 null，战绩和改资料被拒绝', async () => {
    expect((await get('/api/me')).json()).toEqual({ user: null });
    expect((await get('/api/me', 'sid=随便编一个')).json()).toEqual({ user: null });
    expect((await get('/api/me/stats')).statusCode).toBe(401);
    const patch = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', payload: { nickname: 'x' } });
    expect(patch.statusCode).toBe(401);
  });

  it('可以改昵称和头像', async () => {
    const cookie = await h.register('a@example.com', '红胡子');
    const res = await h.app.fastify.inject({
      method: 'PATCH',
      url: '/api/me',
      payload: { nickname: '黑胡子', avatar: '🦜' },
      headers: { cookie },
    });
    expect(res.json()).toMatchObject({ nickname: '黑胡子', avatar: '🦜' });
    const bad = await h.app.fastify.inject({ method: 'PATCH', url: '/api/me', payload: { avatar: '<script>' }, headers: { cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('登录接口有限流：一分钟内第 11 次被拒绝', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await post('/api/auth/login', { email: 'a@example.com', password: 'x' })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('新账号的战绩是空的', async () => {
    const cookie = await h.register('a@example.com', '红胡子');
    expect((await get('/api/me/stats', cookie)).json()).toEqual({ games: 0, wins: 0, avgRank: null, recent: [] });
  });
});
