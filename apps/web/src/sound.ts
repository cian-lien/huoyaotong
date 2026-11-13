/**
 * 音效全部用 Web Audio 现场合成，不需要音频文件。
 * 以后想换成真实音效，只要改这个文件里的 play()。
 */
export type Sound = 'card' | 'draw' | 'nope' | 'boom' | 'defuse' | 'myTurn' | 'win' | 'out';

const KEY = 'hyt:muted';
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem(KEY) === '1';
} catch {
  // 无痕模式等拿不到 localStorage：就当没静音
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // 存不下就只在这次访问里生效
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain = 0.12, slideTo?: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur);
}

function noise(ac: AudioContext, start: number, dur: number, gain: number) {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ac.createBufferSource();
  const g = ac.createGain();
  const lowpass = ac.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 900;
  g.gain.value = gain;
  src.buffer = buffer;
  src.connect(lowpass).connect(g).connect(ac.destination);
  src.start(start);
}

export function play(sound: Sound) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    switch (sound) {
      case 'card':
        tone(ctx, 520, t, 0.07, 'triangle', 0.1, 380);
        break;
      case 'draw':
        tone(ctx, 300, t, 0.09, 'triangle', 0.08, 460);
        break;
      case 'nope':
        tone(ctx, 220, t, 0.18, 'square', 0.07, 140);
        break;
      case 'boom':
        noise(ctx, t, 0.9, 0.5);
        tone(ctx, 90, t, 0.6, 'sine', 0.3, 35);
        break;
      case 'defuse':
        tone(ctx, 500, t, 0.1, 'sine', 0.1);
        tone(ctx, 750, t + 0.1, 0.18, 'sine', 0.1);
        break;
      case 'myTurn':
        tone(ctx, 660, t, 0.12, 'sine', 0.09);
        tone(ctx, 880, t + 0.12, 0.2, 'sine', 0.09);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => tone(ctx as AudioContext, f, t + i * 0.13, 0.25, 'triangle', 0.1));
        break;
      case 'out':
        tone(ctx, 330, t, 0.5, 'sawtooth', 0.06, 110);
        break;
    }
  } catch {
    // 浏览器不让出声（比如还没有过用户操作）：安静地跳过
  }
}
