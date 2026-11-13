import { useEffect, useState } from 'react';
import { useGame } from '../store.ts';

/** 每 100ms 刷新一次的剩余时间（毫秒）；没有计时器时为 null */
export function useRemaining(): number | null {
  const deadline = useGame((s) => s.view?.deadline ?? null);
  const offset = useGame((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - (now + offset));
}

/** 倒计时画成一根烧着的引线：越短越急 */
export function Fuse() {
  const remaining = useRemaining();
  const total = useGame((s) => s.timerTotal);
  if (remaining === null || total <= 0) return <div className="fuse is-idle" />;
  const ratio = Math.min(1, remaining / total);
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className={`fuse${remaining < 5000 ? ' is-urgent' : ''}`} role="timer" aria-label={`还剩 ${seconds} 秒`}>
      <div className="fuse-rope" style={{ width: `${ratio * 100}%` }}>
        <span className="fuse-spark" />
      </div>
      <span className="fuse-seconds">{seconds}</span>
    </div>
  );
}
