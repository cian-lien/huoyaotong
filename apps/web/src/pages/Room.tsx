import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MAX_PLAYERS, MIN_PLAYERS } from '@hyt/shared';
import { addBot, joinRoom, leaveRoom, playAgain, removeBot, savedNickname, startGame, toast, useGame } from '../store.ts';
import { Table } from '../components/Table.tsx';
import { isMuted, setMuted } from '../sound.ts';

export function Room({ onRules }: { onRules: () => void }) {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const me = useGame((s) => s.me);
  const room = useGame((s) => s.room);
  const view = useGame((s) => s.view);
  const connected = useGame((s) => s.connected);
  const closed = useGame((s) => s.closed);

  const [problem, setProblem] = useState('');
  const [askName, setAskName] = useState(false);
  const [nickname, setNickname] = useState(savedNickname);
  const [muted, setMutedState] = useState(isMuted);

  const inThisRoom = room?.code === code;

  // 换房间或离开页面时，清掉“被请出房间”的提示
  useEffect(() => () => useGame.setState({ closed: null }), [code]);

  // 进页面时加入房间：刷新、点邀请链接、断线回来都走这里
  useEffect(() => {
    if (me === undefined || inThisRoom || closed) return;
    let cancelled = false;
    void joinRoom(code).then((res) => {
      if (cancelled || res.ok) return;
      if (res.error === '请先起一个昵称') setAskName(true);
      else setProblem(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [code, me, inThisRoom, closed]);

  const onName = async (e: FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    const res = await joinRoom(code, nickname.trim());
    if (res.ok) setAskName(false);
    else setProblem(res.error);
  };

  const onLeave = () => {
    if (room?.status === 'playing' && view?.players[view.mySeat]?.alive && !window.confirm('现在离开会直接算你出局，确定吗？')) {
      return;
    }
    leaveRoom();
    navigate('/');
  };

  if (closed) {
    return (
      <main className="notice">
        <h1>你离开了这个房间</h1>
        <p>{closed}。</p>
        <Link className="btn btn-primary" to="/">
          回首页
        </Link>
      </main>
    );
  }

  if (problem) {
    return (
      <main className="notice">
        <h1>进不去房间 {code}</h1>
        <p>{problem}。</p>
        <Link className="btn btn-primary" to="/">
          回首页开一个新房间
        </Link>
      </main>
    );
  }

  if (askName && !inThisRoom) {
    return (
      <main className="notice">
        <h1>加入房间 {code}</h1>
        <form className="field" onSubmit={(e) => void onName(e)}>
          <label htmlFor="join-nickname">你的昵称</label>
          <input
            id="join-nickname"
            value={nickname}
            maxLength={12}
            autoFocus
            placeholder="比如：独眼龙"
            onChange={(e) => setNickname(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!nickname.trim()}>
            进房间
          </button>
          <p className="field-note">
            游客不记战绩。<Link to="/login">登录或注册</Link>
          </p>
        </form>
      </main>
    );
  }

  if (!room || !inThisRoom) {
    return (
      <main className="notice">
        <p>正在进入房间 {code}……</p>
      </main>
    );
  }

  const isHost = room.hostSeat === room.mySeat;
  const hostName = room.players.find((p) => p.seat === room.hostSeat)?.nickname ?? '房主';

  return (
    <div className="room">
      <header className="room-bar">
        <span className="room-code">房间 {room.code}</span>
        {!connected && <span className="room-offline">网络断了，正在重连……</span>}
        <span className="room-bar-space" />
        <button
          type="button"
          className="btn btn-quiet"
          aria-pressed={!muted}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          {muted ? '🔇 开声音' : '🔊 关声音'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onRules}>
          玩法
        </button>
        <button type="button" className="btn btn-quiet" onClick={onLeave}>
          离开房间
        </button>
      </header>

      {room.status === 'lobby' && (
        <main className="lobby">
          <h1>等人到齐</h1>
          <p className="lobby-invite">
            把房间号 <strong>{room.code}</strong> 告诉朋友，或者
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href).then(
                  () => toast('邀请链接已复制'),
                  () => toast('复制不了，手动复制地址栏里的链接吧'),
                );
              }}
            >
              复制邀请链接
            </button>
          </p>

          <ol className="lobby-seats">
            {Array.from({ length: MAX_PLAYERS }, (_, i) => {
              const p = room.players[i];
              return (
                <li key={i} className={p ? (p.connected ? '' : 'is-offline') : 'is-empty'}>
                  {p ? (
                    <>
                      <span className="lobby-avatar" aria-hidden="true">
                        {p.avatar ?? '🏴‍☠️'}
                      </span>
                      <span className="lobby-name">
                        {p.nickname}
                        {p.seat === room.mySeat && '（你）'}
                      </span>
                      <span className="lobby-tags">
                        {[p.seat === room.hostSeat && '房主', p.isBot && '电脑', p.isGuest && '游客', !p.connected && '掉线了']
                          .filter(Boolean)
                          .join('，')}
                      </span>
                      {p.isBot && isHost && (
                        <button
                          type="button"
                          className="btn btn-quiet lobby-remove"
                          aria-label={`移除${p.nickname}`}
                          onClick={() => void removeBot(p.seat).then((res) => !res.ok && toast(res.error))}
                        >
                          移除
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="lobby-name">空位</span>
                  )}
                </li>
              );
            })}
          </ol>

          {isHost && room.players.length < MAX_PLAYERS && (
            <button type="button" className="btn" onClick={() => void addBot().then((res) => !res.ok && toast(res.error))}>
              加一个电脑玩家
            </button>
          )}

          {isHost ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={room.players.length < MIN_PLAYERS}
                onClick={() => void startGame().then((res) => !res.ok && toast(res.error))}
              >
                开始这一局
              </button>
              {room.players.length < MIN_PLAYERS && <p className="field-note">至少要 {MIN_PLAYERS} 个人才能开始。</p>}
            </>
          ) : (
            <p className="field-note">等{hostName}点开始。</p>
          )}
        </main>
      )}

      {room.status !== 'lobby' && view && <Table />}

      {room.status === 'over' && room.ranking && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="结算">
          <div className="modal result">
            <h2>{room.ranking[0]?.seat === room.mySeat ? '你活到了最后！' : `${room.ranking[0]?.nickname}活到了最后`}</h2>
            <ol className="result-list">
              {room.ranking.map((r) => (
                <li key={r.seat} className={r.seat === room.mySeat ? 'is-me' : ''}>
                  <span className="result-rank">第 {r.rank} 名</span>
                  <span className="result-name">
                    {r.nickname}
                    {r.seat === room.mySeat && '（你）'}
                  </span>
                  <span className="result-turns">撑过 {r.turnsSurvived} 个回合</span>
                </li>
              ))}
            </ol>
            {room.players.some((p) => p.isBot) ? (
              <p className="field-note">有电脑参与的对局不记战绩。</p>
            ) : (
              !me && <p className="field-note">游客的成绩不会保存。登录后再玩，战绩就会记下来。</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onLeave}>
                离开房间
              </button>
              {isHost ? (
                <button type="button" className="btn btn-primary" autoFocus onClick={() => void playAgain().then((res) => !res.ok && toast(res.error))}>
                  再来一局
                </button>
              ) : (
                <span className="field-note">等{hostName}开下一局</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
