import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { AVATARS, type Stats } from '@hyt/shared';
import { api } from '../api.ts';
import { setMe, toast, useGame } from '../store.ts';

export function Profile() {
  const me = useGame((s) => s.me);
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState('');
  const [nickname, setNickname] = useState('');

  useEffect(() => {
    if (!me) return;
    setNickname(me.nickname);
    api.stats().then(setStats, (err: unknown) => setFailed(err instanceof Error ? err.message : '战绩加载失败'));
  }, [me]);

  if (me === undefined) return <main className="notice">正在加载……</main>;
  if (me === null) return <Navigate to="/login" replace />;

  const save = async (patch: { nickname?: string; avatar?: string }) => {
    try {
      setMe(await api.updateProfile(patch));
      toast('已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败，请再试一次');
    }
  };

  const onNickname = (e: FormEvent) => {
    e.preventDefault();
    if (nickname.trim() && nickname.trim() !== me.nickname) void save({ nickname: nickname.trim() });
  };

  const onLogout = async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
    navigate('/');
  };

  return (
    <main className="profile">
      <p>
        <Link to="/">← 回首页</Link>
      </p>
      <h1>
        <span aria-hidden="true">{me.avatar ?? '🏴‍☠️'}</span> {me.nickname}
      </h1>

      <section>
        <h2>战绩</h2>
        {failed && (
          <p className="error" role="alert">
            {failed}
          </p>
        )}
        {stats && stats.games === 0 && (
          <p>
            还没有记录。<Link to="/">开一个房间</Link>，打完一局这里就有了。
          </p>
        )}
        {stats && stats.games > 0 && (
          <>
            <dl className="stats">
              <div>
                <dt>打了</dt>
                <dd>{stats.games} 局</dd>
              </div>
              <div>
                <dt>活到最后</dt>
                <dd>{stats.wins} 局</dd>
              </div>
              <div>
                <dt>平均名次</dt>
                <dd>第 {stats.avgRank?.toFixed(1)} 名</dd>
              </div>
            </dl>
            <table className="recent">
              <caption>最近 {stats.recent.length} 局</caption>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">人数</th>
                  <th scope="col">名次</th>
                  <th scope="col">撑过回合</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r) => (
                  <tr key={r.matchId}>
                    <td>{new Date(r.endedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{r.playerCount} 人</td>
                    <td>第 {r.rank} 名</td>
                    <td>{r.turnsSurvived}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>资料</h2>
        <form className="field" onSubmit={onNickname}>
          <label htmlFor="profile-nickname">昵称</label>
          <div className="home-join-row">
            <input id="profile-nickname" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} />
            <button type="submit" className="btn" disabled={!nickname.trim() || nickname.trim() === me.nickname}>
              保存昵称
            </button>
          </div>
        </form>
        <fieldset className="avatars">
          <legend>头像</legend>
          {AVATARS.map((a) => (
            <button key={a} type="button" className="avatar-pick" aria-pressed={me.avatar === a} onClick={() => void save({ avatar: a })}>
              {a}
            </button>
          ))}
        </fieldset>
        <p className="field-note">昵称和头像从下一个房间开始生效。登录邮箱：{me.email}</p>
        <button type="button" className="btn" onClick={() => void onLogout()}>
          退出登录
        </button>
      </section>
    </main>
  );
}
