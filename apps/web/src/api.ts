import type { Me, Stats } from '@hyt/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('连不上服务器，检查一下网络', 0);
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    const fallback = res.status === 429 ? '操作太频繁了，一分钟后再试' : '服务器开小差了，请稍后再试';
    throw new ApiError(data?.error ?? fallback, res.status);
  }
  return data as T;
}

export const api = {
  /** 没登录时返回 null */
  me: () => request<{ user: Me | null }>('GET', '/api/me').then((res) => res.user),
  register: (input: { email: string; password: string; nickname: string }) => request<Me>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) => request<Me>('POST', '/api/auth/login', input),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout', {}),
  updateProfile: (patch: { nickname?: string; avatar?: string }) => request<Me>('PATCH', '/api/me', patch),
  stats: () => request<Stats>('GET', '/api/me/stats'),
};
