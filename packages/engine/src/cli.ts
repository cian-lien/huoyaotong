/**
 * 命令行对局：几个随机出牌的电脑玩家自动打完一局，把过程打印出来。
 *
 *   pnpm play            # 4 人，随机种子
 *   pnpm play 3 42       # 3 人，种子 42（同一个种子每次结果一样）
 */
import { CARD_META, type GameEvent } from '@hyt/shared';
import { applyAction, applyTimeout, createGame, type GameState } from './engine.ts';
import { botAction } from './bot.ts';
import { seededRng } from './rng.ts';

const NAMES = ['红胡子', '独眼龙', '铁钩', '老船长', '小水手'];
const playerCount = Number(process.argv[2] ?? 4);
const seed = Number(process.argv[3] ?? Date.now() % 100000);
const rng = seededRng(seed);

let state: GameState;
const name = (seat: number) => state.players[seat]?.nickname ?? `座位${seat}`;
const cardNames = (kinds: string[]) => kinds.map((k) => CARD_META[k as keyof typeof CARD_META].name).join(' + ');

function describe(e: GameEvent): string | null {
  switch (e.type) {
    case 'turnStart':
      return `\n— 轮到 ${name(e.seat)}${e.turnsLeft > 1 ? `（还要进行 ${e.turnsLeft} 个回合）` : ''}，货舱剩 ${state.deck.length} 张`;
    case 'played': {
      const target = e.targetSeat === null ? '' : ` → ${name(e.targetSeat)}`;
      const named = e.namedCard ? `，点名要「${CARD_META[e.namedCard].name}」` : '';
      return `  ${name(e.seat)} 打出 ${cardNames(e.cards)}${target}${named}`;
    }
    case 'noped':
      return `  ${name(e.seat)} 驳回！（第 ${e.nopeCount} 张驳回）`;
    case 'cancelled':
      return `  ✗ ${name(e.seat)} 的牌被取消了`;
    case 'resolved':
      return `  ✓ 生效`;
    case 'drew':
      return `  ${name(e.seat)} 摸了一张牌`;
    case 'stole':
      return e.success ? `  ${name(e.seat)} 从 ${name(e.targetSeat)} 那里拿到一张牌` : `  ${name(e.seat)} 什么也没拿到`;
    case 'favorGiven':
      return `  ${name(e.targetSeat)} 给了 ${name(e.seat)} 一张牌`;
    case 'exploded':
      return `  💣 ${name(e.seat)} 摸到了火药桶！`;
    case 'defused':
      return `  🪣 ${name(e.seat)} 用灭火桶拆掉了`;
    case 'kegPlaced':
      return `  ${name(e.seat)} 把火药桶塞回了货舱`;
    case 'eliminated':
      return `  ☠ ${name(e.seat)} 出局，第 ${e.rank} 名`;
    case 'timeout':
      return null;
    case 'gameOver':
      return `\n=== 对局结束 ===\n${e.ranking.map((r) => `  第 ${r.rank} 名  ${r.nickname}（撑过 ${r.turnsSurvived} 个回合）`).join('\n')}`;
    case 'gotCard':
    case 'lostCard':
    case 'peeked':
      return null; // 私密信息，不进公开日志
  }
}

function print(events: GameEvent[]) {
  for (const e of events) {
    const line = describe(e);
    if (line) console.log(line);
  }
}

console.log(`《火药桶》命令行对局：${playerCount} 人，种子 ${seed}`);
const start = createGame(NAMES.slice(0, playerCount), rng);
state = start.state;
print(start.events);

for (let step = 0; state.phase !== 'over'; step++) {
  if (step > 5000) throw new Error('对局没有结束，规则引擎可能有死循环');

  // 所有人依次看看要不要行动；没人行动就相当于计时器到期
  let acted = false;
  for (const p of state.players) {
    const action = botAction(state, p.seat, rng);
    if (!action) continue;
    const res = applyAction(state, p.seat, action, rng);
    if (!res.ok) throw new Error(`电脑玩家做了不合法的操作：${res.error}`);
    state = res.state;
    print(res.events);
    acted = true;
    break;
  }
  if (!acted) {
    const res = applyTimeout(state, rng);
    state = res.state;
    print(res.events);
  }
}
