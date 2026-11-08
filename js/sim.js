// 시뮬레이션 모드: 카메라 없이 가상의 두 선수로 게임 흐름을 확인 (?sim=1)
import { LM, buildSkeleton } from './poses.js';

const NEUTRAL = { L: { a: [8, 5], g: [3, 2] }, R: { a: [8, 5], g: [3, 2] } };

export class SimTracker {
  constructor() {
    this.kind = 'sim';
    this.label = '시뮬레이션';
    this.t0 = performance.now();
    this.getPose = () => null; // 앱이 현재 목표 자세를 알려줌
    this.players = [
      { cx: 0.27, wobbly: false, pose: NEUTRAL, hist: [] },
      { cx: 0.73, wobbly: true, pose: NEUTRAL, hist: [] },
    ];
  }
  async start() {}
  stop() {}
  get width() { return 1280; }
  get height() { return 720; }

  detect(nowMs) {
    const t = (nowMs - this.t0) / 1000;
    const target = this.getPose() || NEUTRAL;
    const aspect = this.width / this.height;
    return this.players.map((pl, idx) => {
      // 화면의 목표 자세를 조금 늦게(사람처럼) 따라 함
      const lag = 0.35 + idx * 0.25;
      pl.hist.push({ t, pose: target });
      while (pl.hist.length > 1 && pl.hist[1].t <= t - lag) pl.hist.shift();
      if (pl.hist[0].t <= t - lag) pl.pose = pl.hist[0].pose;
      const sk = buildSkeleton(pl.pose);
      // 오른쪽 선수는 주기적으로 크게 흔들림
      const burst = pl.wobbly && Math.sin(t * 0.55) > 0.55;
      const sway = burst ? Math.sin(t * 9) * 0.1 : 0;
      const scale = 0.19;
      const out = [];
      for (let i = 0; i < 33; i++) out.push({ x: 0.5, y: 0.5, visibility: 0 });
      for (const k in sk) {
        const p = sk[k];
        const n = () => (Math.random() - 0.5) * 0.004;
        out[k] = {
          x: pl.cx + (p.x * scale) / aspect + sway * (1 + p.y * -0.5) / aspect + n(),
          y: 0.56 + p.y * scale + n(),
          visibility: 0.99,
        };
      }
      return out;
    });
  }

  drawFrame(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b3a55'); g.addColorStop(1, '#1b2232');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.font = `${h * 0.05}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('시뮬레이션 모드 (카메라 없음)', w / 2, h * 0.96);
  }
}

export { LM };
