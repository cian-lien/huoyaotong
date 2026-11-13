import { useState } from 'react';
import { CARD_KINDS, isCrew } from '@hyt/shared';
import { CardView } from './CardView.tsx';

const SEEN_KEY = 'hyt:tutorial-seen';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 存不下：下次还会再弹一次，问题不大
  }
}

const STEPS: { title: string; body: string; cards: (typeof CARD_KINDS)[number][] }[] = [
  {
    title: '活到最后就赢',
    body: '大家轮流从货舱摸牌。货舱里藏着火药桶，比人数少一张——谁摸到又没有灭火桶，谁就出局。',
    cards: ['keg'],
  },
  {
    title: '每回合：先出牌，再摸牌',
    body: '轮到你时可以出任意张牌，也可以一张不出。回合最后必须摸一张牌，除非你用牌躲掉了。',
    cards: ['skip', 'attack', 'reverse'],
  },
  {
    title: '灭火桶能救你一命',
    body: '开局每人一张。摸到火药桶时会自动用掉，然后由你把火药桶偷偷塞回货舱的任意位置——比如下家马上要摸的那张。',
    cards: ['defuse'],
  },
  {
    title: '别人出牌，你可以驳回',
    body: '每张牌打出后有 3 秒，任何人都能用「驳回」让它作废。驳回也能被驳回，来回几次都行。',
    cards: ['nope', 'peek', 'shuffle', 'favor'],
  },
  {
    title: '船员牌要凑着出',
    body: '单张没用。2 张相同：随机抽别人一张牌。3 张相同：点名要一张牌，对方有就得给。',
    cards: CARD_KINDS.filter(isCrew).slice(0, 3),
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i] ?? STEPS[0]!;
  const last = i === STEPS.length - 1;
  const close = () => {
    markSeen();
    onClose();
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="玩法说明">
      <div className="modal tutorial">
        <p className="tutorial-progress">
          第 {i + 1} 步，共 {STEPS.length} 步
        </p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tutorial-cards">
          {step.cards.map((kind) => (
            <CardView key={kind} kind={kind} />
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={close}>
            跳过说明
          </button>
          {i > 0 && (
            <button type="button" className="btn" onClick={() => setI(i - 1)}>
              上一步
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={last ? close : () => setI(i + 1)} autoFocus>
            {last ? '开始玩' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
