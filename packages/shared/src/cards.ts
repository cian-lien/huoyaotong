/** 牌的种类。船员牌单张没有效果，凑 2 张或 3 张相同的才能出。 */
export const CREW_KINDS = [
  'crew_cook',
  'crew_navigator',
  'crew_gunner',
  'crew_parrot',
  'crew_lookout',
] as const;

export const ACTION_KINDS = ['skip', 'attack', 'peek', 'shuffle', 'favor', 'reverse'] as const;

export const CARD_KINDS = ['keg', 'defuse', 'nope', ...ACTION_KINDS, ...CREW_KINDS] as const;

export type CardKind = (typeof CARD_KINDS)[number];
export type CrewKind = (typeof CREW_KINDS)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface Card {
  /** 一局内唯一 */
  id: number;
  kind: CardKind;
}

export interface CardMeta {
  name: string;
  /** 牌面上的一句话说明 */
  text: string;
  /** 占位牌面用的图标，换成正式美术后可以删掉 */
  icon: string;
  /** 底牌中的张数；火药桶按人数另算 */
  count: number;
}

export const CARD_META: Record<CardKind, CardMeta> = {
  keg: { name: '火药桶', text: '摸到必须立刻用灭火桶，否则出局', icon: '💣', count: 0 },
  defuse: { name: '灭火桶', text: '拆掉火药桶，并把它秘密放回货舱任意位置', icon: '🪣', count: 6 },
  nope: { name: '驳回', text: '抵消别人刚出的牌，驳回也能被驳回', icon: '✋', count: 5 },
  skip: { name: '溜号', text: '结束本回合，不摸牌', icon: '💨', count: 4 },
  attack: { name: '甩锅', text: '结束本回合不摸牌，下家连续进行 2 个回合', icon: '🍳', count: 4 },
  peek: { name: '望远镜', text: '偷看货舱顶上 3 张', icon: '🔭', count: 5 },
  shuffle: { name: '翻货舱', text: '打乱货舱', icon: '🌀', count: 4 },
  favor: { name: '讨要', text: '指定一人，对方自己挑一张牌给你', icon: '🤲', count: 4 },
  reverse: { name: '倒转航向', text: '出牌顺序反过来，并结束本回合不摸牌', icon: '🧭', count: 3 },
  crew_cook: { name: '独眼厨师', text: '船员牌：2 张相同抽 1 张，3 张相同点名要牌', icon: '👨‍🍳', count: 4 },
  crew_navigator: { name: '晕船的航海士', text: '船员牌：2 张相同抽 1 张，3 张相同点名要牌', icon: '🤢', count: 4 },
  crew_gunner: { name: '耳背的炮手', text: '船员牌：2 张相同抽 1 张，3 张相同点名要牌', icon: '🙉', count: 4 },
  crew_parrot: { name: '话痨鹦鹉', text: '船员牌：2 张相同抽 1 张，3 张相同点名要牌', icon: '🦜', count: 4 },
  crew_lookout: { name: '打瞌睡的瞭望手', text: '船员牌：2 张相同抽 1 张，3 张相同点名要牌', icon: '😴', count: 4 },
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
/** 开局每人：1 张灭火桶 + 7 张其他牌 */
export const STARTING_HAND = 7;
export const PEEK_COUNT = 3;

export function isCrew(kind: CardKind): kind is CrewKind {
  return (CREW_KINDS as readonly string[]).includes(kind);
}

export function isActionKind(kind: CardKind): kind is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(kind);
}

/** 不含火药桶的 55 张底牌，id 从 1 开始 */
export function buildBaseDeck(): Card[] {
  const cards: Card[] = [];
  let id = 1;
  for (const kind of CARD_KINDS) {
    for (let i = 0; i < CARD_META[kind].count; i++) cards.push({ id: id++, kind });
  }
  return cards;
}
