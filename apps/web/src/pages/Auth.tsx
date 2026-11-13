import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api.ts';
import { savedNickname, setMe } from '../store.ts';

export function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(savedNickname);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password.length < 8) return setError('密码至少 8 位');
    setBusy(true);
    try {
      const me = mode === 'login' ? await api.login({ email, password }) : await api.register({ email, password, nickname: nickname.trim() });
      setMe(me);
      // 从房间页点过来的回到房间；直接打开登录页的回首页
      if (window.history.length > 1) navigate(-1);
      else navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '出了点问题，请再试一次');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="notice">
      <h1>{mode === 'login' ? '登录' : '注册账号'}</h1>
      <p>登录后，每一局的名次都会记进你的战绩。</p>
      <form className="field" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="email">邮箱</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">密码{mode === 'register' && '（至少 8 位）'}</label>
        <input
          id="password"
          type="password"
          required
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {mode === 'register' && (
          <>
            <label htmlFor="reg-nickname">昵称（对局里别人看到的名字）</label>
            <input id="reg-nickname" required maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>
      <p className="field-note">
        {mode === 'login' ? '还没有账号？' : '已经有账号了？'}
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? '注册一个' : '直接登录'}
        </button>
        <Link to="/">先不登录，回首页</Link>
      </p>
    </main>
  );
}
