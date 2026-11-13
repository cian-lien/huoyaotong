import { CARD_META, type CardKind, isCrew } from '@hyt/shared';

/** 牌按用途分四类，决定牌面顶部色带的颜色 */
export function family(kind: CardKind): 'danger' | 'rescue' | 'crew' | 'action' {
  if (kind === 'keg') return 'danger';
  if (kind === 'defuse' || kind === 'nope') return 'rescue';
  return isCrew(kind) ? 'crew' : 'action';
}

interface Props {
  kind: CardKind;
  size?: 'hand' | 'small';
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}

/**
 * 占位牌面：图标 + 牌名 + 一句说明。
 * 正式美术做好后，把 .card-art 里的图标换成图片即可，其余不用动。
 */
export function CardView({ kind, size = 'hand', selected, dimmed, onClick }: Props) {
  const meta = CARD_META[kind];
  const className = ['card', `card-${family(kind)}`, `card-${size}`, selected && 'is-selected', dimmed && 'is-dimmed']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className="card-band" />
      <span className="card-art" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="card-name">{meta.name}</span>
      {size === 'hand' && <span className="card-text">{meta.text}</span>}
    </>
  );
  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={className} onClick={onClick} aria-pressed={selected} title={meta.text}>
      {body}
    </button>
  );
}

export function CardBack({ label }: { label?: string }) {
  return (
    <div className="card card-back">
      <span className="card-back-mark" aria-hidden="true">
        ⚓
      </span>
      {label && <span className="card-back-label">{label}</span>}
    </div>
  );
}
