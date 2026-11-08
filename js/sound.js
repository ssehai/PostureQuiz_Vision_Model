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
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, i * 0.14)),
};
