import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { createRoom, savedNickname, useGame } from '../store.ts';
import { CardView } from '../components/CardView.tsx';

export function Home({ onRules }: { onRules: () => void }) {
  const me = useGame((s) => s.me);
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(savedNickname);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bots, setBots] = useState(2);

  const needName = !me && !nickname.trim();

  const onCreate = async (withBots = 0) => {
    if (needName) return setError(withBots > 0 ? '先起一个昵称' : '先起一个昵称，其他人靠它认出你');
    setBusy(true);
    const res = await createRoom(nickname.trim(), withBots);
    setBusy(false);
    if (res.ok) navigate(`/room/${res.code}`);
    else setError(res.error);
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('房间号是 6 位数字');
    if (needName) return setError('先起一个昵称，其他人靠它认出你');
    try {
      localStorage.setItem('hyt:nickname', nickname.trim());
    } catch {
      // 存不下也能进房间
    }
    navigate(`/room/${code}`);
  };

  return (
    <main className="home">
      <header className="home-hero">
        <div className="home-fan" aria-hidden="true">
          <CardView kind="skip" size="small" />
          <CardView kind="keg" size="small" />
          <CardView kind="defuse" size="small" />
        </div>
        <h1>火药桶</h1>
        <p className="home-lede">
          2–5 个海盗轮流从货舱摸牌。
          <br />
          摸到火药桶又没有灭火桶的人出局，活到最后的人赢。
        </p>
      </header>

      <section className="home-panel">
        {me ? (
          <p className="home-who">
            <span aria-hidden="true">{me.avatar ?? '🏴‍☠️'}</span> {me.nickname}，这一局会记进你的战绩。
            <Link to="/me">看战绩</Link>
          </p>
        ) : (
          <div className="field">
            <label htmlFor="nickname">你的昵称</label>
            <input
              id="nickname"
              value={nickname}
              maxLength={12}
              placeholder="比如：红胡子"
              autoComplete="nickname"
              onChange={(e) => {
                setNickname(e.target.value);
                setError('');
              }}
            />
            <p className="field-note">
              游客可以直接玩，但不记战绩。<Link to="/login">登录或注册</Link>
            </p>
          </div>
        )}

        <button type="button" className="btn btn-primary btn-big" disabled={busy} onClick={() => void onCreate()}>
          开一个房间
        </button>

        <div className="home-join">
          <label htmlFor="bots">一个人也能玩</label>
          <div className="home-join-row">
            <select id="bots" value={bots} onChange={(e) => setBots(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  对 {n} 个电脑
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void onCreate(bots)}>
              和电脑玩一局
            </button>
          </div>
          <p className="field-note">人机局不记战绩。</p>
        </div>

        <form className="home-join" onSubmit={onJoin}>
          <label htmlFor="code">朋友给了你房间号？</label>
          <div className="home-join-row">
            <input
              id="code"
              value={code}
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位数字"
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
            />
            <button type="submit" className="btn">
              进房间
            </button>
          </div>
        </form>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <button type="button" className="btn btn-quiet" onClick={onRules}>
        第一次玩？2 分钟看懂玩法
      </button>
    </main>
  );
}
