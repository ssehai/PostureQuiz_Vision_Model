// 활동형 미니게임 4종: 풍선/폭탄, 다가오는 벽, 제자리 달리기, 골키퍼
// 모든 좌표는 캔버스 픽셀(카메라 해상도). 선수 왼쪽 = 화면 왼쪽 절반, 오른쪽 = 오른쪽 절반.
// 공정성: 두 선수에게 같은 씨앗(seed)의 난수를 써서 같은 순서·같은 종류의 물체가 나오고,
// 위치는 각자 몸 크기(몸통 길이) 기준으로 정해서 키가 커도 유리하지 않다.
import { LM, BONES, POSES, makePose, poseDetail, computeAngles } from './poses.js';
import { seenLm } from './judge.js';
import { sfx } from './sound.js';

const INV = 1.6;          // 생명을 잃은 뒤 무적 시간(초)
const GOOD = '#2fdc7a';
const SIDE_COLORS = ['#ffd84d', '#4de1ff'];

export const ARCADE_INFO = {
  balloon: { emoji: '🎈', name: '풍선 터뜨리기', hint: '풍선은 손발로 펑! 폭탄 💣은 피해요!' },
  wall:    { emoji: '🧱', name: '벽 통과하기',   hint: '벽 구멍 모양대로 몸을 만들어요!' },
  race:    { emoji: '🏃', name: '제자리 달리기', hint: '무릎을 높이 들며 제자리에서 달려요!' },
  goalie:  { emoji: '🧤', name: '골키퍼',       hint: '휘어서 날아오는 공을 손·팔로만 막아요!' },
};
export const isArcade = (mode) => mode in ARCADE_INFO;

// ---------------- 공통 유틸 ----------------
function rng(seed) { // 씨앗이 같으면 같은 난수열 (mulberry32)
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const k = l ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
function emoji(ctx, ch, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000'; // 앞서 쓴 반투명 색이 컬러 이모지에도 적용되므로 불투명으로
  ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
  ctx.restore();
}
function label(ctx, text, x, y, size, bg = 'rgba(0,0,0,.6)', fg = '#fff') {
  ctx.save();
  ctx.font = `${Math.round(size)}px Jua, sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(x - w / 2 - size * 0.5, y - size * 0.75, w + size, size * 1.5, size * 0.4); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.03);
  ctx.restore();
}

// 화면 속 몸 정보 (몸통이 안 보이면 null)
function readBody(lms, W, H) {
  if (!lms) return null;
  const ok = (i) => seenLm(lms[i]);
  if (![LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].every(ok)) return null;
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = mid(P(LM.lShoulder), P(LM.rShoulder)), hp = mid(P(LM.lHip), P(LM.rHip));
  return { lms, P, ok, sh, hp, torso: Math.max(20, dist(sh, hp)) };
}
// 팔 마디들: [어깨-팔꿈치], [팔꿈치-손목], [손목-손끝(추정)]
function armSegments(b) {
  const segs = [];
  for (const [s, e, w] of [[LM.lShoulder, LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow, LM.rWrist]]) {
    if (!b.ok(s) || !b.ok(e)) continue;
    const S = b.P(s), E = b.P(e);
    segs.push([S, E]);
    if (!b.ok(w)) continue;
    const Wr = b.P(w);
    segs.push([E, Wr]);
    segs.push([Wr, { x: Wr.x + (Wr.x - E.x) * 0.35, y: Wr.y + (Wr.y - E.y) * 0.35 }]);
  }
  return segs;
}
function handTips(b) {
  const out = [];
  for (const [e, w] of [[LM.lElbow, LM.lWrist], [LM.rElbow, LM.rWrist]]) {
    if (!b.ok(w)) continue;
    const Wr = b.P(w);
    out.push(Wr);
    if (b.ok(e)) { const E = b.P(e); out.push({ x: Wr.x + (Wr.x - E.x) * 0.3, y: Wr.y + (Wr.y - E.y) * 0.3 }); }
  }
  return out;
}

class Base {
  constructor(o) {
    this.o = o;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.players = [0, 1].map(() => ({ lives: o.lives, score: 0, inv: 0, everSeen: false, b: null, lost: 0 }));
    this.fx = [];
    this.events = [];
    this.flash = [0, 0];
    this.usesLives = true;
    this.ownSkeleton = false;
  }
  observe(people, W, H, dt) {
    this.players.forEach((p, i) => {
      const b = readBody(people[i], W, H);
      if (b) { p.b = b; p.lost = 0; p.everSeen = true; }
      else { p.lost += dt; if (p.lost > 0.4) p.b = null; }
      p.inv = Math.max(0, p.inv - dt);
    });
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < 1);
    this.flash = this.flash.map((v) => Math.max(0, v - dt * 2));
  }
  // 생명 -1 (무적이거나 빈 자리면 무시). 깎였으면 true
  hurt(i, text, x, y) {
    const p = this.players[i];
    if (p.inv > 0 || !p.everSeen || p.lives <= 0) return false;
    p.lives--;
    p.inv = INV;
    this.flash[i] = 1;
    this.events.push({ i, kind: 'hit', text });
    if (x != null) this.pop(x, y, '💥', '#ff4d5e');
    return true;
  }
  pop(x, y, text, color = '#fff') { this.fx.push({ x, y, text, color, age: 0 }); }
  drawFx(ctx, W, H) {
    for (const f of this.fx) {
      ctx.save();
      ctx.globalAlpha = 1 - f.age;
      ctx.font = `${Math.round(H * 0.06)}px Jua, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const y = f.y - f.age * H * 0.08;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
      ctx.restore();
    }
    // 생명을 잃으면 그쪽 절반이 잠깐 빨갛게
    this.flash.forEach((v, i) => {
      if (!v) return;
      ctx.fillStyle = `rgba(255,60,80,${v * 0.35})`;
      ctx.fillRect(i * W / 2, 0, W / 2, H);
    });
  }
  outs() { return this.players.map((p) => this.usesLives && p.lives <= 0); }
  winnerEarly() { return -1; }
  status(i) {
    const p = this.players[i];
    if (!p.everSeen) return ['empty', '빈 자리 (혼자 연습 중)'];
    if (this.usesLives && p.lives <= 0) return ['out', '탈락 💧'];
    if (!p.b) return ['missing', '몸이 화면에 보이게! 🙈'];
    if (p.inv > 0) return ['wait', '무적! 🛡️'];
    return null;
  }
  scoreText(i) { return `${Math.floor(this.players[i].score)}점`; }
  detail() { return ''; }
  phaseText() { return ''; }
}

// ---------------- 고정 크기 몸 (풍선·벽 공통) ----------------
// 선수의 몸은 화면에서 '가로 위치'와 '크기'를 고정해서 그린다 (카메라에서 멀거나 가까워도, 옆으로 비켜 서도 똑같이).
// 세로 위치는 평소 서 있는 높이(최근 5초 중앙값) 기준이라 숙이거나 점프하면 그대로 보인다.
// 좌표 단위는 몸통 길이, 원점은 (엉덩이 중심 x, 평소 엉덩이 높이 y).
const FIX_S = 0.165;  // 화면 높이 대비 몸통 길이
const FIX_Y = 0.6;    // 평소 엉덩이 높이 (화면 높이 비율)

class FixedBase extends Base {
  constructor(o) {
    super(o);
    this.ownSkeleton = true;
    this.fb = [0, 1].map(() => ({ samples: [], cal: null, calAt: 0, n: null }));
    this.now = 0;
  }
  // 몸이 보일 때마다 기준(평소 높이·몸통 길이)을 갱신하고, 고정 좌표 n을 만든다
  observeFixed(dt) {
    this.now += dt;
    this.players.forEach((p, i) => {
      const f = this.fb[i], b = p.b;
      if (!b) { f.n = null; return; }
      const P = b.P;
      const ank = b.ok(LM.lAnkle) && b.ok(LM.rAnkle) ? (P(LM.lAnkle).y + P(LM.rAnkle).y) / 2 : null;
      f.samples.push({ t: this.now, hip: b.hp.y, sh: b.sh.y, torso: b.torso, ank });
      while (f.samples.length && this.now - f.samples[0].t > 5) f.samples.shift();
      if (f.samples.length >= 3 && (this.now - f.calAt > 0.25 || !f.cal)) {
        f.calAt = this.now;
        const anks = f.samples.map((s) => s.ank).filter((v) => v != null);
        f.cal = {
          hip: median(f.samples.map((s) => s.hip)),
          sh: median(f.samples.map((s) => s.sh)),
          torso: median(f.samples.map((s) => s.torso)),
          ank: anks.length >= 5 ? median(anks) : null,
        };
      }
      if (!f.cal) { f.n = null; return; }
      const n = {};
      for (const k of Object.values(LM)) {
        const q = P(k);
        n[k] = { x: (q.x - b.hp.x) / f.cal.torso, y: (q.y - f.cal.hip) / f.cal.torso, ok: b.ok(k) };
      }
      f.n = n;
    });
  }
  // 고정 좌표 → 화면 좌표
  toScreen(i, W, H, x, y) {
    const S = H * FIX_S;
    return { x: i * W / 2 + W / 4 + x * S, y: H * FIX_Y + y * S };
  }
  // 카메라 영상은 흐리게 (고정된 내 스켈레톤이 잘 보이게) + 바닥선
  drawBackdrop(ctx, W, H, i) {
    const x0 = i * W / 2, S = H * FIX_S;
    ctx.fillStyle = 'rgba(12,16,26,0.72)';
    ctx.fillRect(x0, 0, W / 2, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    const fy = H * FIX_Y + 1.75 * S;
    ctx.beginPath(); ctx.moveTo(x0 + 10, fy); ctx.lineTo(x0 + W / 2 - 10, fy); ctx.stroke();
    ctx.restore();
  }
  drawFixedSkeleton(ctx, W, H, i, glow) {
    const p = this.players[i], n = this.fb[i].n, S = H * FIX_S;
    if (!n) {
      if (p.everSeen && !p.b) { const c = this.toScreen(i, W, H, 0, -1); label(ctx, '몸이 화면에 보이게!', c.x, c.y, S * 0.3, 'rgba(255,77,94,.9)'); }
      return;
    }
    const at = (k) => this.toScreen(i, W, H, n[k].x, n[k].y);
    ctx.save();
    ctx.lineCap = 'round';
    if (glow) { ctx.shadowColor = GOOD; ctx.shadowBlur = S * 0.3; }
    ctx.globalAlpha = p.inv > 0 && Math.sin(this.now * 25) > 0 ? 0.4 : 1;
    ctx.strokeStyle = glow ? GOOD : SIDE_COLORS[i]; ctx.lineWidth = S * 0.12;
    for (const [a, b] of BONES) {
      if (!n[a].ok || !n[b].ok) continue;
      const pa = at(a), pb = at(b);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    const h = at(LM.nose);
    ctx.lineWidth = S * 0.09;
    ctx.beginPath(); ctx.arc(h.x, h.y, 0.24 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ---------------- 🎈 풍선 / 💣 폭탄 ----------------
// 풍선 위치는 고정 좌표(몸통 길이 단위)로 정해서 두 선수에게 완전히 같은 자리에 나온다.
const B_LIFE = 3.2;   // 풍선이 떠 있는 시간
const B_ARM = 0.5;    // 폭탄이 나타난 뒤 이 시간 동안은 닿아도 안전 (피할 시간)
const B_R = 0.22;     // 풍선 반지름 (몸통 길이 단위)
const B_X = 1.85, B_TOP = -2.7, B_BOT = 1.7; // 풍선이 나올 수 있는 범위

class Balloon extends FixedBase {
  constructor(o) {
    super(o);
    this.sides = [0, 1].map(() => ({ r: rng(this.seed), items: [], nextAt: 0.6, pops: 0, bombs: 0 }));
  }
  interval(t) { return Math.max(0.45, 0.95 - t * 0.011); } // 점점 자주 나온다
  // 손끝·발·머리 (고정 좌표)
  hitPoints(i) {
    const n = this.fb[i].n;
    if (!n) return [];
    const pts = [];
    for (const [e, w] of [[LM.lElbow, LM.lWrist], [LM.rElbow, LM.rWrist]]) {
      if (!n[w].ok) continue;
      pts.push({ x: n[w].x, y: n[w].y, head: false });
      if (n[e].ok) pts.push({ x: n[w].x + (n[w].x - n[e].x) * 0.3, y: n[w].y + (n[w].y - n[e].y) * 0.3, head: false });
    }
    for (const a of [LM.lAnkle, LM.rAnkle]) if (n[a].ok) pts.push({ x: n[a].x, y: n[a].y, head: false });
    if (n[LM.nose].ok) pts.push({ x: n[LM.nose].x, y: n[LM.nose].y, head: true });
    return pts;
  }
  spawn(sd, i) {
    const u = [sd.r(), sd.r(), sd.r(), sd.r(), sd.r()]; // 몸이 안 보여도 같은 개수를 뽑아 두 선수 순서를 맞춘다
    if (!this.fb[i].n) return;
    const type = u[0] < 0.22 ? 'bomb' : u[0] < 0.28 ? 'gold' : 'balloon';
    const low = u[1] < 0.2; // 발로 찰 수 있는 낮은 곳
    const hands = type === 'bomb' ? this.hitPoints(i) : [];
    // 폭탄과 풍선이 겹치지 않게, 폭탄이 손·머리 위에 바로 생기지 않게: 안 겹치는 자리를 차례로 찾아본다
    for (let a = 0; a < 10; a++) {
      let x, y;
      const turn = (a % 2 ? -1 : 1) * Math.ceil(a / 2) * 0.55;
      if (low) {
        x = (u[2] < 0.5 ? -1 : 1) * (0.45 + u[3] * 0.5) + turn * 0.6;
        y = 1.25 + u[4] * 0.35;
      } else { // 어깨를 중심으로 팔이 닿는 범위 (위·옆)
        const phi = (u[2] * 2 - 1) * 1.95 + turn;
        const d = 0.85 + u[3] * 0.65;
        x = Math.sin(phi) * d;
        y = -1 - Math.cos(phi) * d;
      }
      x = clamp(x, -B_X, B_X); y = clamp(y, B_TOP, B_BOT);
      const clash = sd.items.some((it) => (it.type === 'bomb') !== (type === 'bomb') && Math.hypot(it.x - x, it.y - y) < B_R * 2.6) ||
        hands.some((h) => Math.hypot(h.x - x, h.y - y) < B_R * 2.4);
      if (!clash) { sd.items.push({ type, x, y, age: 0, bob: u[4] * 6 }); return; }
    }
  }
  tick(t, dt, people, W, H, playing) {
    this.observe(people, W, H, dt);
    this.observeFixed(dt);
    if (!playing) return;
    this.sides.forEach((sd, i) => {
      const p = this.players[i];
      if (p.lives <= 0) { sd.items = []; return; }
      while (t >= sd.nextAt) { this.spawn(sd, i); sd.nextAt += this.interval(sd.nextAt); }
      const pts = this.hitPoints(i);
      for (const it of sd.items) {
        it.age += dt;
        if (!pts.length) continue;
        const near = (h) => Math.hypot(h.x - it.x, h.y - it.y) < B_R + 0.1;
        const sc = this.toScreen(i, W, H, it.x, it.y);
        if (it.type === 'bomb') {
          if (it.age > B_ARM && pts.some(near) && this.hurt(i, '폭탄에 닿았어요', sc.x, sc.y)) {
            it.dead = true; sd.bombs++; sfx.boom();
          }
        } else if (pts.some((h) => !h.head && near(h))) {
          it.dead = true;
          const got = it.type === 'gold' ? 30 : 10;
          p.score += got; sd.pops++;
          this.pop(sc.x, sc.y, `+${got}`, it.type === 'gold' ? '#ffd84d' : '#fff');
          sfx.pop();
        }
      }
      sd.items = sd.items.filter((it) => !it.dead && it.age < B_LIFE);
    });
  }
  draw(ctx, W, H) {
    const S = H * FIX_S, r = B_R * S;
    this.sides.forEach((sd, i) => {
      this.drawBackdrop(ctx, W, H, i);
      for (const it of sd.items) {
        const fadeIn = Math.min(1, it.age / 0.15);
        const fadeOut = it.age > B_LIFE - 0.6 ? (Math.sin(it.age * 30) > 0 ? 0.35 : 0.9) : 1;
        const c = this.toScreen(i, W, H, it.x, it.y + Math.sin(it.age * 3 + it.bob) * B_R * 0.1);
        if (it.type === 'bomb') {
          const armed = it.age > B_ARM;
          ctx.save();
          ctx.globalAlpha = fadeIn * (armed ? 0.5 : 0.25);
          ctx.fillStyle = '#ff4d5e';
          ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.25, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          emoji(ctx, '💣', c.x, c.y, r * 2.2, fadeIn * fadeOut * (armed ? 1 : 0.5));
        } else {
          emoji(ctx, it.type === 'gold' ? '🌟' : '🎈', c.x, c.y, r * 2.3, fadeIn * fadeOut);
        }
      }
      this.drawFixedSkeleton(ctx, W, H, i, false);
    });
    this.drawFx(ctx, W, H);
  }
  detail(i) { return `🎈 ${this.sides[i].pops}개 터뜨림 · 💣 ${this.sides[i].bombs}번 닿음`; }
  phaseText() { return '🎈 +10점 · 🌟 +30점 · 💣 닿으면 ❤️ -1'; }
  simPose(t) { // 시뮬레이션: 팔을 이리저리 휘두른다
    const seq = [
      { L: { a: [90, 90], g: [3, 2] }, R: { a: [90, 90], g: [3, 2] } },
      { L: { a: [165, 172], g: [3, 2] }, R: { a: [165, 172], g: [3, 2] } },
      { L: { a: [130, 130], g: [30, 30] }, R: { a: [20, 10], g: [3, 2] } },
      { L: { a: [20, 10], g: [3, 2] }, R: { a: [130, 130], g: [30, 30] } },
      { L: { a: [60, 60], g: [3, 2] }, R: { a: [60, 60], g: [3, 2] } },
    ];
    return seq[Math.floor(t / 0.7) % seq.length];
  }
}

// ---------------- 🧱 다가오는 벽 ----------------
const WALL_TRAVEL = 4.0;  // 기본 속도에서 벽이 멀리서 몸까지 오는 시간(초)
const WALL_GAP = 0.6;     // 벽과 벽 사이 쉬는 시간(초)
const HIT_FROM = 0.9, HIT_TO = 1.04; // 벽이 몸에 닿는 구간 (이 사이에 한 번이라도 맞으면 통과)
const WALL_X = [-1.9, 1.9], WALL_Y = [-2.6, 1.9]; // 벽 크기 (몸통 길이 단위, 엉덩이 = 0)
const DUCK_LINE = -1.05, JUMP_LINE = 1.3;
const WALL_POSES = [
  ...POSES.filter((p) => p.level === 1),
  makePose({ id: 'oneUp', name: '한 팔 번쩍', emoji: '🙋', L: { a: [165, 172], g: [3, 2] }, R: { a: [10, 5], g: [3, 2] } }),
  makePose({ id: 'robot', name: '로봇', emoji: '🤖', L: { a: [90, 0], g: [3, 2] }, R: { a: [90, 0], g: [3, 2] } }),
];
const WALL_COLORS = { pose: '#3d8bff', duck: '#ff9f1c', jump: '#9b59ff' };

class Wall extends FixedBase {
  constructor(o) {
    super(o);
    this.sides = [0, 1].map(() => ({
      r: rng(this.seed), w: null, nextAt: 1.2, slow: 1, passed: 0, crashed: 0, okNow: false, last: null,
    }));
    this.oc = [0, 1].map(() => document.createElement('canvas'));
  }
  baseSpeed(t) { return Math.min(2.6, 1 + t * 0.03); } // 시간이 갈수록 빨라짐 (두 선수 같음)
  fits(w, b, cal, W, H) {
    if (w.kind === 'duck') return (b.sh.y - cal.sh) / cal.torso >= 0.35;
    if (w.kind === 'jump') {
      if ((cal.hip - b.hp.y) / cal.torso >= 0.15) return true;
      if (cal.ank != null && b.ok(LM.lAnkle) && b.ok(LM.rAnkle)) {
        const ank = (b.P(LM.lAnkle).y + b.P(LM.rAnkle).y) / 2;
        return (cal.ank - ank) / cal.torso >= 0.25;
      }
      return false;
    }
    const pts = {};
    for (const k of Object.values(LM)) pts[k] = { x: b.lms[k].x * W, y: b.lms[k].y * H };
    const a = computeAngles(pts);
    if (!b.ok(LM.lKnee)) { a.lHip = null; a.lKnee = null; } else if (!b.ok(LM.lAnkle)) a.lKnee = null;
    if (!b.ok(LM.rKnee)) { a.rHip = null; a.rKnee = null; } else if (!b.ok(LM.rAnkle)) a.rKnee = null;
    const d = this.o.diff;
    return poseDetail(a, w.pose, d.tol, d.falloff).score >= d.match;
  }
  tick(t, dt, people, W, H, playing) {
    this.observe(people, W, H, dt);
    this.observeFixed(dt);
    if (playing) this.t = t;
    this.sides.forEach((sd, i) => {
      const p = this.players[i], cal = this.fb[i].cal;
      sd.okNow = !!(sd.w && p.b && cal && this.fits(sd.w, p.b, cal, W, H));
      if (!playing || p.lives <= 0) return;
      sd.slow = Math.min(1, sd.slow + dt * 0.15); // 부딪혀서 느려진 속도가 서서히 돌아온다
      if (!sd.w && t >= sd.nextAt) {
        const u0 = sd.r(), u1 = sd.r();
        let kind = u0 < 0.56 ? 'pose' : u0 < 0.8 ? 'duck' : 'jump';
        let pose = WALL_POSES[Math.floor(u1 * WALL_POSES.length)];
        if (sd.last && sd.last.kind === kind && kind !== 'pose') kind = 'pose'; // 숙이기·점프는 연속으로 안 나오게
        if (sd.last && sd.last.pose === pose) pose = WALL_POSES[(WALL_POSES.indexOf(pose) + 1) % WALL_POSES.length];
        sd.w = { kind, pose: kind === 'pose' ? pose : null, p: 0, ok: false };
        sd.last = sd.w;
        sfx.change();
      }
      const w = sd.w;
      if (!w) return;
      w.p += (dt * this.baseSpeed(t) * sd.slow) / WALL_TRAVEL;
      if (w.p >= HIT_FROM && w.p <= HIT_TO && sd.okNow) w.ok = true;
      if (w.p > HIT_TO) {
        const x = i * W / 2 + W / 4, y = H * 0.35;
        if (w.ok || !p.everSeen) {
          if (p.everSeen) { sd.passed++; p.score++; this.pop(x, y, '통과! 👍', GOOD); sfx.pass(); }
        } else if (this.hurt(i, '벽에 부딪혔어요', x, y)) {
          sd.crashed++;
          sd.slow = 0.45; // 부딪히면 잠깐 무적 + 느려짐
          sfx.boom();
        }
        sd.w = null;
        sd.nextAt = t + WALL_GAP;
      }
    });
  }
  draw(ctx, W, H) {
    const S = H * FIX_S;
    this.sides.forEach((sd, i) => {
      const x0 = i * W / 2, cx = W / 4, by = H * FIX_Y;
      this.drawBackdrop(ctx, W, H, i);
      const w = sd.w;
      const vx = cx, vy = by - 0.35 * S;
      if (w) {
        const k = 1 / (1 + 5 * (1 - Math.min(w.p, 1.04)));
        const map = (nx, ny) => ({ x: vx + (cx + nx * S - vx) * k, y: vy + (by + ny * S - vy) * k });
        const oc = this.oc[i];
        if (oc.width !== W / 2 || oc.height !== H) { oc.width = W / 2; oc.height = H; }
        const g = oc.getContext('2d');
        g.clearRect(0, 0, oc.width, oc.height);
        const rect = (y1, y2) => {
          const a = map(WALL_X[0], y1), b = map(WALL_X[1], y2);
          g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        };
        g.globalAlpha = 0.3 + 0.6 * Math.min(1, w.p);
        g.fillStyle = WALL_COLORS[w.kind];
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 4 * k;
        if (w.kind === 'duck') rect(WALL_Y[0], DUCK_LINE);
        else if (w.kind === 'jump') rect(JUMP_LINE, WALL_Y[1]);
        else {
          rect(WALL_Y[0], WALL_Y[1]);
          // 자세 모양 구멍 뚫기
          const sk = w.pose.skeleton;
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'destination-out';
          g.lineCap = 'round'; g.lineJoin = 'round';
          g.lineWidth = 0.5 * S * k;
          g.beginPath();
          for (const [a, b] of BONES) { const p = map(sk[a].x, sk[a].y), q = map(sk[b].x, sk[b].y); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); }
          g.stroke();
          const torso = [LM.lShoulder, LM.rShoulder, LM.rHip, LM.lHip].map((j) => map(sk[j].x, sk[j].y));
          g.beginPath(); torso.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
          const n = map(sk[LM.nose].x, sk[LM.nose].y);
          g.beginPath(); g.arc(n.x, n.y, 0.38 * S * k, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
        ctx.drawImage(oc, x0, 0);
        // 무엇을 해야 하는지 큰 글씨로
        const txt = w.kind === 'duck' ? '⬇ 숙여요!' : w.kind === 'jump' ? '⬆ 점프!' : `${w.pose.emoji} ${w.pose.name}!`;
        label(ctx, txt, x0 + cx, H * 0.08 + S * 0.45, S * 0.42, WALL_COLORS[w.kind]);
        // 자세 벽은 맞춰야 할 모양을 내 자리에 점선으로 미리 보여 준다
        if (w.kind === 'pose') {
          const sk = w.pose.skeleton;
          ctx.save();
          ctx.setLineDash([S * 0.1, S * 0.1]); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = S * 0.06;
          for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(x0 + cx + sk[a].x * S, by + sk[a].y * S); ctx.lineTo(x0 + cx + sk[b].x * S, by + sk[b].y * S); ctx.stroke(); }
          ctx.beginPath(); ctx.arc(x0 + cx + sk[LM.nose].x * S, by + sk[LM.nose].y * S, 0.24 * S, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }
      this.drawFixedSkeleton(ctx, W, H, i, sd.okNow);
      // 속도 표시
      const sp = this.baseSpeed(this.t || 0) * sd.slow;
      label(ctx, `속도 ×${sp.toFixed(1)}${sd.slow < 0.99 ? ' 🐢' : ''}`, x0 + cx, H - S * 0.3, S * 0.24);
    });
    this.drawFx(ctx, W, H);
  }
  detail(i) { return `통과 ${this.sides[i].passed}개 · 부딪힘 ${this.sides[i].crashed}번`; }
  scoreText(i) { return `${this.sides[i].passed}개 통과`; }
  phaseText() { return '벽이 점점 빨라져요! 부딪히면 잠깐 느려져요'; }
  simPose() {
    const w = this.sides[0].w;
    const stand = { L: { a: [10, 5], g: [3, 2] }, R: { a: [10, 5], g: [3, 2] } };
    if (!w) return stand;
    if (w.kind === 'pose') return w.pose;
    if (w.kind === 'duck') return { L: { a: [40, 10], g: [50, -5] }, R: { a: [40, 10], g: [50, -5] }, dy: 0.5 };
    return w.p > 0.7 ? { ...stand, dy: -0.35 } : stand;
  }
}

// ---------------- 🏃 제자리 달리기 (팔 흔들기) ----------------
// 발을 구르지 않고(아래층 소음 없이) 달리기 팔 동작으로 걸음을 센다.
// 손이 가슴 높이까지 올라왔다가(UP) 엉덩이 근처로 내려가면(DOWN) 한 번. 양팔을 번갈아 흔들어야 센다.
const RACE_GOAL = 100;    // 이만큼 먼저 채우면 결승선
const ARM_UP = 0.5;       // 손목이 엉덩이보다 (몸통 × 이 값)만큼 위로 오면 '올라감'
const ARM_DOWN = 0.2;     // 이보다 낮아져야 '내려감' → 다음 흔들기를 센다

class Race extends Base {
  constructor(o) {
    super(o);
    this.usesLives = false;
    this.arms = [0, 1].map(() => ({ up: [false, false], last: -1, lastT: -9, seen: true }));
    this.winner = -1;
    this.now = 0;
  }
  tick(t, dt, people, W, H, playing) {
    this.observe(people, W, H, dt);
    this.now += dt;
    this.players.forEach((p, i) => {
      const A = this.arms[i];
      const b = p.b;
      if (!b) return;
      A.seen = b.ok(LM.lWrist) && b.ok(LM.rWrist);
      const rels = [LM.lWrist, LM.rWrist].map((w) => (b.ok(w) ? (b.hp.y - b.P(w).y) / b.torso : null));
      rels.forEach((rel, arm) => {
        if (rel == null) return;
        if (!A.up[arm] && rel > ARM_UP) {
          A.up[arm] = true;
          // 반대쪽 팔은 내려가 있어야 센다 (양팔을 같이 들어 올리는 건 달리기가 아님)
          const otherDown = rels[1 - arm] == null || rels[1 - arm] < ARM_UP;
          // 같은 팔만 계속 흔들면 안 세고, 번갈아 흔들어야 센다 (0.6초 넘게 지나면 같은 팔도 인정)
          if (playing && this.winner < 0 && otherDown && (arm !== A.last || this.now - A.lastT > 0.6)) {
            p.score++;
            A.last = arm; A.lastT = this.now;
            sfx.step();
            if (p.score >= RACE_GOAL && this.winner < 0) this.winner = i;
          }
        } else if (A.up[arm] && rel < ARM_DOWN) A.up[arm] = false;
      });
    });
  }
  winnerEarly() { return this.winner; }
  status(i) {
    const s = super.status(i);
    if (s) return s;
    if (!this.arms[i].seen) return ['missing', '두 손이 화면에 보이게! 🙌'];
    return this.now - this.arms[i].lastT < 0.5 ? ['great', '달려요! 🔥'] : ['follow', '팔을 번갈아 힘차게! 🏃'];
  }
  scoreText(i) { return `${this.players[i].score}걸음`; }
  detail(i) { return this.players[i].score >= RACE_GOAL ? '🏁 결승선 통과!' : `결승선까지 ${RACE_GOAL - this.players[i].score}걸음 남음`; }
  phaseText() { return `팔을 번갈아 가슴까지 흔들면 한 걸음! 먼저 ${RACE_GOAL}걸음`; }
  draw(ctx, W, H) {
    // 손을 어디까지 올려야 하는지 몸 앞에 선으로 표시
    this.players.forEach((p) => {
      if (!p.b) return;
      const y = p.b.hp.y - p.b.torso * ARM_UP;
      const x1 = p.b.hp.x - p.b.torso * 0.9, x2 = p.b.hp.x + p.b.torso * 0.9;
      ctx.save();
      ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,216,77,.85)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.restore();
      label(ctx, '손 여기까지!', x2 + p.b.torso * 0.05, y, Math.max(14, p.b.torso * 0.13), 'rgba(0,0,0,.55)', '#ffd84d');
    });
    this.drawFx(ctx, W, H);
  }
  // 가운데 위 카드에 달리기 트랙을 그린다
  drawCard(c, sides) {
    const g = c.getContext('2d'), w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const x1 = w * 0.08, x2 = w * 0.9, laneH = h / 2;
    this.players.forEach((p, i) => {
      const y = laneH * i + laneH / 2;
      g.fillStyle = i ? '#dff6ff' : '#fff6d6';
      g.fillRect(0, laneH * i + 2, w, laneH - 4);
      g.strokeStyle = 'rgba(0,0,0,.15)'; g.setLineDash([10, 8]); g.lineWidth = 3;
      g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke(); g.setLineDash([]);
      const k = Math.min(1, p.score / RACE_GOAL);
      const x = x1 + (x2 - x1) * k;
      g.save(); g.translate(x, y); g.scale(-1, 1); // 오른쪽을 보고 달리게
      emoji(g, '🏃', 0, 0, laneH * 0.7);
      g.restore();
      g.fillStyle = '#1d2433'; g.font = `${Math.round(laneH * 0.3)}px Jua, sans-serif`; g.textBaseline = 'middle';
      g.textAlign = 'left'; g.fillText(sides ? sides[i].member : '', 8, laneH * i + laneH * 0.22);
    });
    emoji(g, '🏁', x2 + w * 0.045, h / 2, h * 0.4);
  }
  simPose(t) {
    const up = { a: [30, 150], g: [3, 2] }, down = { a: [10, 5], g: [3, 2] };
    return Math.floor(t / 0.33) % 2 ? { L: up, R: down } : { L: down, R: up };
  }
}

// ---------------- 🧤 골키퍼 ----------------
// 공이 멀리서 휘어지며 날아온다. 어디로 떨어질지는 미리 표시하지 않고, 지나온 궤적(꼬리)만 보여 준다.
// 공이 몸 가까이 왔을 때(비행 후반) 손·팔에 닿으면 막는다. 몸통·머리·다리로는 못 막는다.
const BLOCK_FROM = 0.82; // 비행의 이 지점부터 막을 수 있음 (몸 가까이 왔을 때만)
class Goalie extends Base {
  constructor(o) {
    super(o);
    this.sides = [0, 1].map(() => ({ r: rng(this.seed), ball: null, nextAt: 1.2, saves: 0, goals: 0 }));
  }
  dur(t) { return Math.max(0.6, 1.05 - t * 0.01); } // 시간이 갈수록 공이 빨라진다
  pos(ball, k) { // 2차 베지어 곡선 (휘어지는 슛)
    const a = (1 - k) ** 2, b = 2 * (1 - k) * k, c = k * k;
    return { x: a * ball.sx + b * ball.cx + c * ball.tx, y: a * ball.sy + b * ball.cy + c * ball.ty };
  }
  radius(ball, k) { return ball.R * (0.35 + 0.65 * k * k); }
  blocked(b, pt, r) {
    const reach = r + b.torso * 0.03;
    return armSegments(b).some(([a, c]) => segDist(pt, a, c) < reach);
  }
  tick(t, dt, people, W, H, playing) {
    this.observe(people, W, H, dt);
    if (!playing) return;
    this.sides.forEach((sd, i) => {
      const p = this.players[i];
      if (p.lives <= 0) { sd.ball = null; return; }
      if (!sd.ball && t >= sd.nextAt) {
        const u = [sd.r(), sd.r(), sd.r(), sd.r()];
        const b = p.b;
        if (!b) { sd.nextAt = t + 0.5; return; }
        const T = b.torso;
        const phi = (u[0] * 2 - 1) * 2.2;
        const d = T * (0.95 + u[1] * 0.6); // 팔을 쭉 뻗어야 닿는 거리
        const m = T * 0.3, x0 = i * W / 2;
        const tx = clamp(b.sh.x + Math.sin(phi) * d, x0 + m, x0 + W / 2 - m);
        const ty = clamp(b.sh.y - Math.cos(phi) * d, m, H - m);
        const sx = x0 + W / 4 + (u[2] - 0.5) * W * 0.3, sy = H * 0.04;
        // 휘는 방향과 정도 (가운데를 옆으로 밀어서 곡선을 만든다)
        const bend = (u[3] < 0.5 ? -1 : 1) * (0.12 + Math.abs(u[3] - 0.5) * 0.4) * W; // 항상 크게 휜다
        sd.ball = {
          sx, sy, tx, ty,
          cx: clamp((sx + tx) / 2 + bend, x0, x0 + W / 2), cy: Math.min(sy, ty) + (ty - sy) * 0.3 - H * 0.08,
          R: T * 0.22, p: 0, dur: this.dur(t), state: 'fly', after: 0, trail: [], ex: tx, ey: ty,
        };
        sfx.kick();
      }
      const ball = sd.ball;
      if (!ball) return;
      if (ball.state === 'fly') {
        ball.p = Math.min(1, ball.p + dt / ball.dur);
        const pt = this.pos(ball, ball.p);
        ball.trail.push(pt);
        if (ball.trail.length > 16) ball.trail.shift();
        if (ball.p >= BLOCK_FROM && p.b && this.blocked(p.b, pt, this.radius(ball, ball.p))) {
          ball.state = 'saved'; ball.ex = pt.x; ball.ey = pt.y;
          sd.saves++; p.score++;
          this.pop(pt.x, pt.y, '막았다! 🧤', GOOD);
          sfx.save();
        } else if (ball.p >= 1) {
          ball.state = 'goal';
          if (p.everSeen) { sd.goals++; this.hurt(i, '골을 먹었어요', ball.tx, ball.ty); sfx.boom(); }
        }
      } else {
        ball.after += dt;
        if (ball.trail.length) ball.trail.shift();
        if (ball.after > 0.5) { sd.ball = null; sd.nextAt = t + 0.4; }
      }
    });
  }
  draw(ctx, W, H) {
    this.sides.forEach((sd, i) => {
      const ball = sd.ball;
      if (!ball) return;
      // 지나온 궤적 (꼬리)
      ball.trail.forEach((pt, k) => {
        const f = (k + 1) / ball.trail.length;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, ball.R * 0.35 * f + 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.45 * f})`;
        ctx.fill();
      });
      let x, y, r, a = 1;
      if (ball.state === 'fly') {
        ({ x, y } = this.pos(ball, ball.p));
        r = this.radius(ball, ball.p);
      } else {
        const k = ball.after / 0.5;
        const dir = ball.state === 'saved' ? (ball.ex < i * W / 2 + W / 4 ? -1 : 1) : 0;
        x = ball.ex + dir * k * W * 0.12;
        y = ball.ey - (ball.state === 'saved' ? k * H * 0.15 : 0);
        r = ball.R * (ball.state === 'saved' ? 1 - k * 0.5 : 1 + k * 0.3);
        a = 1 - k;
      }
      emoji(ctx, '⚽', x, y, r * 2, a);
    });
    this.drawFx(ctx, W, H);
  }
  detail(i) { return `막음 ${this.sides[i].saves}번 · 골 먹음 ${this.sides[i].goals}번`; }
  scoreText(i) { return `${this.sides[i].saves}번 막음`; }
  phaseText() { return '휘어서 날아오는 공을 손·팔로 막아요! 몸으로는 못 막아요'; }
  simPose() {
    const ball = this.sides[0].ball, p = this.players[0];
    const rest = { a: [15, 10], g: [3, 2] };
    if (!ball || ball.state !== 'fly' || !p.b) return { L: rest, R: rest };
    const pt = this.pos(ball, Math.min(1, ball.p + 0.3));
    const dx = pt.x - p.b.sh.x, dy = pt.y - p.b.sh.y;
    const deg = 180 - Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI); // 0 = 아래, 180 = 위
    const arm = { a: [deg, deg], g: [3, 2] };
    return dx < 0 ? { L: arm, R: rest } : { L: rest, R: arm };
  }
}

export function createArcade(mode, opts) {
  const C = { balloon: Balloon, wall: Wall, race: Race, goalie: Goalie }[mode];
  return new C(opts);
}
