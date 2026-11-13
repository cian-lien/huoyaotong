import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_KINDS, CARD_META, type Card, type CardKind, type PlayerView, isActionKind, isCrew } from '@hyt/shared';
import { act, useGame } from '../store.ts';
import { CardBack, CardView } from './CardView.tsx';
import { Fuse } from './Fuse.tsx';

const ORDER = new Map(CARD_KINDS.map((k, i) => [k, i]));

/** 看看选中的牌能不能一起出，还缺什么 */
function analyze(cards: Card[]): { ok: boolean; needsTarget: boolean; needsNamed: boolean; hint: string } {
  const no = (hint: string) => ({ ok: false, needsTarget: false, needsNamed: false, hint });
  const first = cards[0];
  if (!first) return no('点手牌选牌，或者点货舱摸牌结束回合');
  if (cards.length === 1) {
    if (isActionKind(first.kind)) {
      return { ok: true, needsTarget: first.kind === 'favor', needsNamed: false, hint: CARD_META[first.kind].text };
    }
    if (isCrew(first.kind)) return no('船员牌要再选 1–2 张相同的一起出');
    if (first.kind === 'nope') return no('驳回只能在别人出牌后的 3 秒内用');
    return no('灭火桶会在你摸到火药桶时自动使用');
  }
  if (cards.length > 3 || !isCrew(first.kind) || cards.some((c) => c.kind !== first.kind)) {
    return no('只有 2 张或 3 张相同的船员牌才能一起出');
  }
  return cards.length === 2
    ? { ok: true, needsTarget: true, needsNamed: false, hint: '2 张相同：随机抽一个人的一张牌' }
    : { ok: true, needsTarget: true, needsNamed: true, hint: '3 张相同：向一个人点名要一张牌' };
}

function describePending(view: PlayerView, name: (seat: number) => string): string {
  const p = view.pending;
  if (!p) return '';
  const first = p.cards[0];
  const what = p.effect === 'pair' || p.effect === 'triple' ? `${p.cards.length} 张船员牌` : first ? CARD_META[first].name : '';
  const target = p.targetSeat === null ? '' : `，目标是${name(p.targetSeat)}`;
  const state = p.nopeCount === 0 ? '' : p.nopeCount % 2 === 1 ? '——目前被驳回' : '——驳回被驳回，目前有效';
  return `${name(p.bySeat)}打出了${what}${target}${state}`;
}

export function Table() {
  const view = useGame((s) => s.view) as PlayerView;
  const peek = useGame((s) => s.peek);
  const banner = useGame((s) => s.banner);
  const blast = useGame((s) => s.blast);

  const [selected, setSelected] = useState<number[]>([]);
  const [targeting, setTargeting] = useState(false);
  const [namingFor, setNamingFor] = useState<number | null>(null);
  const [kegPosition, setKegPosition] = useState(0);
  const [logOpen, setLogOpen] = useState(false);

  const me = view.players[view.mySeat];
  const alive = me?.alive ?? false;
  const name = (seat: number) => (seat === view.mySeat ? '你' : (view.players[seat]?.nickname ?? ''));

  const hand = useMemo(
    () => [...view.myHand].sort((a, b) => (ORDER.get(a.kind) ?? 0) - (ORDER.get(b.kind) ?? 0) || a.id - b.id),
    [view.myHand],
  );
  const picked = hand.filter((c) => selected.includes(c.id));
  const combo = analyze(picked);

  const myTurn = alive && view.phase === 'turn' && view.currentSeat === view.mySeat;
  const mustGive = view.phase === 'favor' && view.favor?.targetSeat === view.mySeat;
  const mustPlace = view.phase === 'placeKeg' && view.kegSeat === view.mySeat;
  const nopeCard = hand.find((c) => c.kind === 'nope');
  const canNope =
    alive &&
    view.phase === 'nope' &&
    view.pending !== null &&
    (view.pending.lastNopeSeat ?? view.pending.bySeat) !== view.mySeat &&
    nopeCard !== undefined;

  // 手牌变了（出掉了、被拿走了）：把已经不在手里的牌从选中里去掉
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => view.myHand.some((c) => c.id === id)));
  }, [view.myHand]);
  // 不再是自己的出牌阶段：退出选目标
  useEffect(() => {
    if (!myTurn) {
      setTargeting(false);
      setNamingFor(null);
    }
  }, [myTurn]);
  useEffect(() => {
    if (mustPlace) setKegPosition(0);
  }, [mustPlace]);

  const toggle = (id: number) => {
    setTargeting(false);
    if (mustGive) return setSelected([id]);
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const sendPlay = async (targetSeat?: number, namedCard?: CardKind) => {
    const ok = await act({ type: 'play', cardIds: picked.map((c) => c.id), targetSeat, namedCard });
    if (ok) setSelected([]);
    setTargeting(false);
    setNamingFor(null);
  };

  const onPlay = () => {
    if (!combo.ok) return;
    if (combo.needsTarget) setTargeting(true);
    else void sendPlay();
  };

  const onTarget = (seat: number) => {
    if (combo.needsNamed) setNamingFor(seat);
    else void sendPlay(seat);
  };

  // 其他人按出牌顺序从自己的下家开始排
  const n = view.players.length;
  const others = Array.from({ length: n - 1 }, (_, i) => view.players[(view.mySeat + i + 1) % n]).filter((p) => p !== undefined);

  let status: string;
  if (!alive) status = '你已经出局了，可以继续看完这一局';
  else if (targeting) status = '选一个目标：点上面一位还有手牌的玩家';
  else if (myTurn) status = view.turnsLeft > 1 ? `轮到你，还要连续进行 ${view.turnsLeft} 个回合` : '轮到你：先出牌，或者直接摸牌结束回合';
  else if (view.phase === 'turn') status = `等${name(view.currentSeat)}出牌`;
  else if (view.phase === 'nope') status = describePending(view, name);
  else if (view.phase === 'favor' && view.favor) {
    status = mustGive ? `${name(view.favor.fromSeat)}向你讨要：选一张牌给他` : `等${name(view.favor.targetSeat)}给${name(view.favor.fromSeat)}一张牌`;
  } else if (view.phase === 'placeKeg' && view.kegSeat !== null) {
    status = mustPlace ? '你拆掉了火药桶：把它塞回货舱的哪个位置？' : `${name(view.kegSeat)}正在把火药桶塞回货舱`;
  } else status = '';

  const kegLabel =
    kegPosition === 0 ? '最上面，下一个摸牌的人就会摸到' : kegPosition >= view.deckCount ? '最下面' : `从上往下第 ${kegPosition + 1} 张`;

  return (
    <div className="table">
      <div className="table-main">
        <ul className="berths">
          {others.map((p) => {
            const targetable = targeting && p.alive && p.handCount > 0;
            const cls = [
              'berth',
              view.currentSeat === p.seat && view.phase !== 'over' && 'is-current',
              !p.alive && 'is-out',
              !p.connected && 'is-offline',
              targetable && 'is-targetable',
            ]
              .filter(Boolean)
              .join(' ');
            const inner = (
              <>
                <span className="berth-avatar" aria-hidden="true">
                  {p.alive ? (p.avatar ?? '🏴‍☠️') : '☠️'}
                </span>
                <span className="berth-name">{p.nickname}</span>
                <span className="berth-meta">
                  {!p.alive ? `出局，第 ${p.rank} 名` : !p.connected ? '掉线了' : `${p.handCount} 张手牌`}
                </span>
              </>
            );
            return (
              <li key={p.seat}>
                {targetable ? (
                  <button type="button" className={cls} onClick={() => onTarget(p.seat)}>
                    {inner}
                  </button>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="hold">
          <div className="hold-piles">
            <button
              type="button"
              className="pile pile-deck"
              disabled={!myTurn}
              onClick={() => {
                setSelected([]);
                void act({ type: 'draw' });
              }}
            >
              <CardBack label={`货舱 ${view.deckCount} 张`} />
              {myTurn && <span className="pile-action">摸牌</span>}
            </button>

            <div className="pile pile-discard" aria-label="刚打出的牌">
              {view.pending ? (
                <div className="pending-cards">
                  {view.pending.cards.map((kind, i) => (
                    <CardView key={i} kind={kind} size="small" dimmed={view.pending!.nopeCount % 2 === 1} />
                  ))}
                </div>
              ) : view.discardTop ? (
                <CardView kind={view.discardTop} size="small" />
              ) : (
                <div className="card card-small card-empty">弃牌堆</div>
              )}
            </div>

            <AnimatePresence>
              {banner && (
                <motion.div
                  key={banner.id}
                  className="banner"
                  initial={{ opacity: 0, y: 12, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <span aria-hidden="true">{banner.icon}</span> {banner.text}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Fuse />
          <p className="status" aria-live="polite">
            {status}
          </p>
        </div>

        <div className="actions">
          {canNope && nopeCard && (
            <button type="button" className="btn btn-danger btn-big" onClick={() => void act({ type: 'nope', cardId: nopeCard.id })}>
              ✋ 驳回！
            </button>
          )}

          {myTurn && !targeting && (
            <>
              <button type="button" className="btn btn-primary" disabled={!combo.ok} onClick={onPlay}>
                {picked.length > 1 ? `打出这 ${picked.length} 张` : '打出这张牌'}
              </button>
              <span className="actions-hint">{combo.hint}</span>
            </>
          )}
          {targeting && (
            <button type="button" className="btn" onClick={() => setTargeting(false)}>
              不出了
            </button>
          )}

          {mustGive && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={picked.length !== 1}
              onClick={() => picked[0] && void act({ type: 'giveCard', cardId: picked[0].id })}
            >
              {picked[0] ? `把「${CARD_META[picked[0].kind].name}」给他` : '先选一张牌'}
            </button>
          )}

          {mustPlace && (
            <div className="keg-placer">
              <label htmlFor="keg-position">{kegLabel}</label>
              <input
                id="keg-position"
                type="range"
                min={0}
                max={view.deckCount}
                value={Math.min(kegPosition, view.deckCount)}
                onChange={(e) => setKegPosition(Number(e.target.value))}
              />
              <button type="button" className="btn btn-primary" onClick={() => void act({ type: 'placeKeg', position: kegPosition })}>
                塞回货舱
              </button>
            </div>
          )}
        </div>

        <div className={`hand${alive ? '' : ' is-out'}`} aria-label="你的手牌">
          <AnimatePresence initial={false}>
            {hand.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -60, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              >
                <CardView
                  kind={c.kind}
                  selected={selected.includes(c.id)}
                  onClick={myTurn || mustGive ? () => toggle(c.id) : undefined}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {hand.length === 0 && alive && <p className="hand-empty">手牌打光了，只能摸牌</p>}
        </div>
      </div>

      <LogPanel open={logOpen} onToggle={() => setLogOpen(!logOpen)} direction={view.direction} />

      {namingFor !== null && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="点名要一张牌">
          <div className="modal">
            <h2>向{name(namingFor)}点名要哪种牌？</h2>
            <p>对方有就必须给你一张，没有就白出了。</p>
            <div className="named-grid">
              {CARD_KINDS.filter((k) => k !== 'keg').map((kind) => (
                <CardView key={kind} kind={kind} size="small" onClick={() => void sendPlay(namingFor, kind)} />
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNamingFor(null)}>
                不出了
              </button>
            </div>
          </div>
        </div>
      )}

      {peek && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="货舱顶上的牌">
          <div className="modal">
            <h2>货舱顶上的牌</h2>
            <p>只有你看得到。左边是下一张要被摸走的。</p>
            <div className="peek-row">
              {peek.map((c, i) => (
                <figure key={c.id}>
                  <CardView kind={c.kind} />
                  <figcaption>{i === 0 ? '下一张' : `第 ${i + 1} 张`}</figcaption>
                </figure>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" autoFocus onClick={() => useGame.setState({ peek: null })}>
                记住了
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {blast && (
          <motion.div
            key={blast.id}
            className={`blast${blast.defused === true ? ' is-defused' : blast.defused === false ? ' is-dead' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-live="assertive"
          >
            <div className="blast-keg" aria-hidden="true">
              💣
            </div>
            <p className="blast-title">{blast.nickname}摸到了火药桶！</p>
            <p className="blast-outcome">
              {blast.defused === true ? '🪣 用灭火桶拆掉了' : blast.defused === false ? '☠️ 没有灭火桶，出局' : ''}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LogPanel(props: { open: boolean; onToggle: () => void; direction: 1 | -1 }) {
  const log = useGame((s) => s.log);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [log.length, props.open]);

  return (
    <aside className={`log${props.open ? ' is-open' : ''}`}>
      <div className="log-head">
        <button type="button" className="log-toggle" onClick={props.onToggle} aria-expanded={props.open}>
          航海日志
        </button>
        <span className="log-direction">出牌顺序：{props.direction === 1 ? '顺着座位' : '倒着座位'}</span>
      </div>
      <ol className="log-lines">
        {log.map((line) => (
          <li key={line.id} className={`log-${line.tone}`}>
            {line.text}
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
    </aside>
  );
}
