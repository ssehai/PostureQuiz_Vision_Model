// 간단한 효과음 (WebAudio, 외부 파일 없음)
let ctx = null;
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.18, delay = 0) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  unlock: () => ac(),
  tick: () => tone(660, 0.12, 'square', 0.1),
  go: () => { tone(880, 0.12, 'square', 0.12); tone(1320, 0.25, 'square', 0.12, 0.12); },
  hit: () => { tone(220, 0.25, 'sawtooth', 0.16); tone(150, 0.3, 'sawtooth', 0.12, 0.1); },
  change: () => { tone(523, 0.1, 'triangle'); tone(784, 0.18, 'triangle', 0.18, 0.1); },
  beat: () => tone(110, 0.12, 'sine', 0.28),
  freeze: () => { tone(1568, 0.12, 'square', 0.12); tone(1175, 0.12, 'square', 0.12, 0.1); tone(784, 0.3, 'square', 0.12, 0.2); },
  bonus: () => { tone(988, 0.1, 'triangle', 0.16); tone(1319, 0.2, 'triangle', 0.16, 0.08); },
  pop: () => { tone(880, 0.07, 'triangle', 0.2); tone(1480, 0.08, 'sine', 0.12, 0.03); },
  boom: () => { tone(90, 0.4, 'sawtooth', 0.2); tone(60, 0.5, 'square', 0.1, 0.05); },
  save: () => { tone(660, 0.08, 'triangle', 0.18); tone(990, 0.16, 'triangle', 0.18, 0.07); },
  kick: () => tone(180, 0.08, 'square', 0.1),
  step: () => tone(320, 0.05, 'square', 0.06),
  pass: () => { tone(784, 0.1, 'triangle', 0.16); tone(1046, 0.16, 'triangle', 0.16, 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, i * 0.14)),
  click: () => { tone(600, 0.05, 'sine', 0.18); tone(900, 0.07, 'sine', 0.12, 0.04); },     // 버튼 '뿅'
  whoosh: () => { tone(300, 0.15, 'sawtooth', 0.06); tone(600, 0.12, 'sawtooth', 0.05, 0.05); },
  slam: () => { tone(70, 0.35, 'square', 0.22); tone(140, 0.2, 'sawtooth', 0.12); },          // VS·결과 '쾅'
  count: () => tone(1200, 0.03, 'square', 0.05),                                              // 점수 촤라락
  levelup: () => [659, 880, 1175].forEach((f, i) => tone(f, 0.16, 'triangle', 0.18, i * 0.09)),
  crack: () => { tone(1800, 0.05, 'square', 0.1); tone(1300, 0.06, 'triangle', 0.12, 0.03); },  // 별에 금이 감
  shatter: () => { [2093, 1568, 2637, 1760].forEach((f, i) => tone(f, 0.12, 'triangle', 0.14, i * 0.05)); },
  fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.6 : 0.18, 'triangle', 0.2, i * 0.15)),
};
