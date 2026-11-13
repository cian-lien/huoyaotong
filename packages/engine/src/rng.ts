import type { Rng } from './engine.ts';

/** 固定种子的随机数（mulberry32）：只给测试和命令行对局用，线上用 crypto.randomInt */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(x * n);
  };
}
