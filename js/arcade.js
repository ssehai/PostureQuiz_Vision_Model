// 활동형 미니게임 4종: 풍선/폭탄, 다가오는 벽, 제자리 달리기, 골키퍼
// 모든 좌표는 캔버스 픽셀(카메라 해상도). 선수 왼쪽 = 화면 왼쪽 절반, 오른쪽 = 오른쪽 절반.
// 공정성: 두 선수에게 같은 씨앗(seed)의 난수를 써서 같은 순서·같은 종류의 물체가 나오고,
// 위치는 각자 몸 크기(몸통 길이) 기준으로 정해서 키가 커도 유리하지 않다.
import { LM, BONES, POSES, makePose } from './poses.js';
import { seenLm } from './judge.js';
import { sfx } from './sound.js';

const INV = 1.6;          // 생명을 잃은 뒤 무적 시간(초)
const GOOD = '#2fdc7a';
const SIDE_COLORS = ['#ffd84d', '#4de1ff'];

export const ARCADE_INFO = {
  dance:   { emoji: '💃', name: '막춤 얼음땡', hint: '크게 움직일수록 점수 UP! "얼음!" 하면 멈춰요' },
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
  const ok = (i) => seenLm(lms[i]) && !lms[i].est; // 실제로 보이는 관절 (판정용)
  const est = (i) => !!lms[i].est;                 // 허벅지 방향으로 이어 추정한 발목 (그림·발차기용)
  if (![LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].every(ok)) return null;
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = mid(P(LM.lShoulder), P(LM.rShoulder)), hp = mid(P(LM.lHip), P(LM.rHip));
  return { lms, P, ok, est, sh, hp, torso: Math.max(20, dist(sh, hp)) };
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
    this.endsOnOut = true;  // 한 명이 생명을 다 잃으면 바로 끝 (막춤은 둘 다 잃을 때만)
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
    this.fx = this.fx.filter((f) => f.age < f.life);
    this.flash = this.flash.map((v) => Math.max(0, v - dt * 2));
  }
  // 생명 -1 (무적이거나 빈 자리면 무시). 깎였으면 true
  hurt(i, text, x, y, force = false) {
    const p = this.players[i];
    if ((p.inv > 0 && !force) || !p.everSeen || p.lives <= 0) return false;
    p.lives--;
    p.inv = INV;
    this.flash[i] = 1;
    this.events.push({ i, kind: 'hit', text });
    if (x != null) this.pop(x, y, '💥', '#ff4d5e');
    return true;
  }
  pop(x, y, text, color = '#fff', life = 1) { this.fx.push({ x, y, text, color, age: 0, life }); }
  drawFx(ctx, W, H) {
    for (const f of this.fx) {
      ctx.save();
      const k = f.age / f.life;
      ctx.globalAlpha = 1 - k;
      ctx.font = `${Math.round(H * 0.06)}px Jua, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const y = f.y - k * H * 0.08;
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
    this.fb = [0, 1].map(() => ({ samples: [], cal: null, calAt: 0, n: null, arms: [], shw: [], reach: { arm: 1.05, shw: 0.35 } }));
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
        n[k] = { x: (q.x - b.hp.x) / f.cal.torso, y: (q.y - f.cal.hip) / f.cal.torso, ok: b.ok(k), show: b.ok(k) || b.est(k) };
      }
      f.n = n;
      // 이 선수의 팔 길이·어깨 폭 (몸통 길이 단위). 팔을 굽히면 짧게 재지므로 많이 편 쪽(상위 20%)을 쓴다
      for (const [s, e, w] of [[LM.lShoulder, LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow, LM.rWrist]]) {
        if (!n[s].ok || !n[e].ok || !n[w].ok) continue;
        f.arms.push(Math.hypot(n[e].x - n[s].x, n[e].y - n[s].y) + Math.hypot(n[w].x - n[e].x, n[w].y - n[e].y));
      }
      f.shw.push(Math.abs(n[LM.lShoulder].x - n[LM.rShoulder].x) / 2);
      if (f.arms.length > 120) f.arms.splice(0, f.arms.length - 120);
      if (f.shw.length > 60) f.shw.splice(0, f.shw.length - 60);
      if (f.arms.length >= 10) {
        const a = f.arms.slice().sort((x, y) => x - y);
        f.reach = { arm: clamp(a[Math.floor(a.length * 0.8)], 0.7, 1.4), shw: clamp(median(f.shw), 0.2, 0.5) };
      }
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
    const blink = p.inv > 0 && Math.sin(this.now * 25) > 0 ? 0.4 : 1; // 무적 중엔 깜빡임
    ctx.strokeStyle = glow ? GOOD : SIDE_COLORS[i]; ctx.lineWidth = S * 0.12;
    for (const [a, b] of BONES) {
      if (!n[a].show || !n[b].show) continue;
      const pa = at(a), pb = at(b);
      ctx.globalAlpha = blink * (n[b].ok ? 1 : 0.6); // 허벅지 방향으로 이어 그린 정강이는 조금 흐리게
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.globalAlpha = blink;
    const h = at(LM.nose);
    ctx.lineWidth = S * 0.09;
    ctx.beginPath(); ctx.arc(h.x, h.y, 0.24 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ---------------- 🎈 풍선 / 💣 폭탄 ----------------
// 풍선 위치는 고정 좌표(몸통 길이 단위)로 정해서 두 선수에게 완전히 같은 자리에 나온다.
// 풍선은 작은 점에서 부풀어 오르다가 수명이 다하면 '펑' 터지며 사라진다. 부푸는 속도(=수명)는 풍선마다 무작위
const B_LIFE_MIN = 1.6, B_LIFE_MAX = 3.0;
const BOMB_LIFE = (B_LIFE_MIN + B_LIFE_MAX) / 2; // 폭탄은 풍선 수명의 평균으로 고정, 다 되면 터지며 사라짐
const B_ARM = 0.3;    // 폭탄이 나타난 직후 이 시간 동안은 닿아도 안전 (피할 틈)
const B_GROW0 = 0.12, B_GROW1 = 1.12; // 풍선 크기: 처음(점) → 터지기 직전 (B_R 배)
const POP_FX = 0.3, BOOM_FX = 0.4;    // 터지는 효과가 보이는 시간 (짧게)
const B_R = 0.22;     // 풍선 반지름 (몸통 길이 단위)
const B_GAP = 1.05;   // 폭탄과 풍선 중심 사이 최소 거리 (풍선을 치다가 폭탄을 같이 건드리지 않게)
const B_GAP_MIN = 0.75; // 팔이 짧으면 풍선 나올 자리가 좁아서 간격을 줄인다 (손 판정 반경 둘을 합친 0.72보다는 크게)
const B_X = 1.85, B_TOP = -2.7, B_BOT = 1.7; // 풍선이 나올 수 있는 범위

class Balloon extends FixedBase {
  constructor(o) {
    super(o);
    this.sides = [0, 1].map(() => ({ r: rng(this.seed), items: [], bursts: [], nextAt: 0.6, pops: 0, bombs: 0 }));
  }
  interval(t) { return Math.max(0.45, 0.95 - t * 0.011); } // 점점 자주 나온다
  // 풍선 크기 배율 (점 → 부풂). 폭탄은 처음부터 제 크기
  scaleOf(it) {
    if (it.type === 'bomb') return 1;
    const k = clamp(it.age / it.life, 0, 1);
    return B_GROW0 + (B_GROW1 - B_GROW0) * Math.pow(k, 0.6);
  }
  burst(sd, it, kind) { sd.bursts.push({ x: it.x, y: it.y, kind, age: 0, size: this.scaleOf(it) }); }
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
    for (const a of [LM.lAnkle, LM.rAnkle]) if (n[a].show) pts.push({ x: n[a].x, y: n[a].y, head: false }); // 추정한 발로도 찰 수 있음
    if (n[LM.nose].ok) pts.push({ x: n[LM.nose].x, y: n[LM.nose].y, head: true });
    return pts;
  }
  spawn(sd, i) {
    const u = [sd.r(), sd.r(), sd.r(), sd.r(), sd.r(), sd.r()]; // 몸이 안 보여도 같은 개수를 뽑아 두 선수 순서를 맞춘다
    if (!this.fb[i].n) return;
    const type = u[0] < 0.22 ? 'bomb' : u[0] < 0.28 ? 'gold' : 'balloon';
    const low = u[1] < 0.2; // 발로 찰 수 있는 낮은 곳
    const hands = type === 'bomb' ? this.hitPoints(i) : [];
    // 폭탄과 풍선이 겹치지 않게, 폭탄이 손·머리 위에 바로 생기지 않게: 안 겹치는 자리를 차례로 찾아본다
    const gap = clamp(this.fb[i].reach.arm * 0.85, B_GAP_MIN, B_GAP);
    let best = null, bestRoom = -Infinity;
    for (let a = 0; a < 24; a++) {
      let x, y;
      const turn = (a % 2 ? -1 : 1) * Math.ceil(a / 2) * 0.55;
      if (low) {
        x = (u[2] < 0.5 ? -1 : 1) * (0.45 + u[3] * 0.5) + turn * 0.6;
        y = 1.25 + u[4] * 0.35;
      } else { // 그쪽 어깨에서 이 선수의 팔 길이 50~90% 거리 (팔 길이는 직접 잰 값 → 팔이 짧아도 닿는다)
        const { arm, shw } = this.fb[i].reach;
        const phi = (u[2] * 2 - 1) * 1.95 + turn;
        const d = arm * (0.5 + ((u[3] + a * 0.37) % 1) * 0.4); // 다시 찾을 때는 거리도 바꿔 본다
        x = Math.sign(Math.sin(phi)) * shw + Math.sin(phi) * d;
        y = -1 - Math.cos(phi) * d;
      }
      x = clamp(x, -B_X, B_X); y = clamp(y, B_TOP, B_BOT);
      // 여유 = 피해야 할 것(다른 종류 물체, 폭탄이면 손·머리)과의 거리가 기준보다 얼마나 넉넉한지
      let room = Infinity;
      for (const it of sd.items) if ((it.type === 'bomb') !== (type === 'bomb')) room = Math.min(room, Math.hypot(it.x - x, it.y - y) - gap);
      for (const h of hands) room = Math.min(room, Math.hypot(h.x - x, h.y - y) - B_R * 2.4);
      if (room >= 0) { best = { x, y }; break; }
      if (!best || room > bestRoom) { best = { x, y }; bestRoom = room; }
    }
    // 빈자리를 못 찾아도 건너뛰지 않고 가장 넉넉한 자리에 낸다 → 팔이 짧아도 나오는 개수가 같다
    const life = type === 'bomb' ? BOMB_LIFE : B_LIFE_MIN + u[5] * (B_LIFE_MAX - B_LIFE_MIN);
    sd.items.push({ type, x: best.x, y: best.y, age: 0, life, bob: u[4] * 6 });
  }
  tick(t, dt, people, W, H, playing) {
    this.observe(people, W, H, dt);
    this.observeFixed(dt);
    if (!playing) return;
    this.sides.forEach((sd, i) => {
      const p = this.players[i];
      if (p.lives <= 0) { sd.items = []; return; }
      while (t >= sd.nextAt) { this.spawn(sd, i); sd.nextAt += this.interval(sd.nextAt); }
      for (const bs of sd.bursts) bs.age += dt;
      sd.bursts = sd.bursts.filter((bs) => bs.age < (bs.kind === 'boom' ? BOOM_FX : POP_FX));
      const pts = this.hitPoints(i);
      for (const it of sd.items) {
        it.age += dt;
        if (it.age >= it.life) { // 수명 끝: 풍선은 다 부풀어 펑, 폭탄은 쾅 (점수·벌점 없음)
          it.dead = true;
          this.burst(sd, it, it.type === 'bomb' ? 'boom' : 'pop');
          continue;
        }
        if (!pts.length) continue;
        const reach = B_R * this.scaleOf(it) + 0.14; // 풍선이 작을 때는 맞히기 조금 더 어렵다
        const near = (h) => Math.hypot(h.x - it.x, h.y - it.y) < reach;
        const sc = this.toScreen(i, W, H, it.x, it.y);
        if (it.type === 'bomb') {
          if (it.age > B_ARM && pts.some(near) && this.hurt(i, '폭탄에 닿았어요')) {
            it.dead = true; sd.bombs++; sfx.boom();
            this.burst(sd, it, 'boom');
          }
        } else if (pts.some((h) => !h.head && near(h))) {
          it.dead = true;
          const got = it.type === 'gold' ? 30 : 10;
          p.score += got; sd.pops++;
          this.burst(sd, it, 'pop');
          this.pop(sc.x, sc.y - H * 0.03, `+${got}`, it.type === 'gold' ? '#ffd84d' : '#fff', 0.6);
          sfx.pop();
        }
      }
      sd.items = sd.items.filter((it) => !it.dead);
    });
  }
  draw(ctx, W, H) {
    const S = H * FIX_S, r = B_R * S;
    this.sides.forEach((sd, i) => {
      this.drawBackdrop(ctx, W, H, i);
      for (const it of sd.items) {
        const left = it.life - it.age;
        if (it.type === 'bomb') { // 폭탄: 바로 제 크기로 '뿅'. 터지기 직전에 살짝 떨린다
          const shake = left < 0.35 ? Math.sin(it.age * 60) * r * 0.08 : 0;
          const c = this.toScreen(i, W, H, it.x, it.y);
          emoji(ctx, '💣', c.x + shake, c.y, r * 2.2);
          continue;
        }
        // 풍선: 점에서 부풀어 오름. 다 부풀 즈음 부르르 떨다가 터진다
        const sc = this.scaleOf(it);
        const wob = left < 0.3 ? 1 + Math.sin(it.age * 70) * 0.06 : 1;
        const c = this.toScreen(i, W, H, it.x, it.y + Math.sin(it.age * 3 + it.bob) * B_R * 0.08);
        emoji(ctx, it.type === 'gold' ? '🌟' : '🎈', c.x, c.y, r * 2.3 * sc * wob);
      }
      // 터지는 효과: 풍선 → 별이 반짝 튀었다가 빠르게 사라짐 / 폭탄 → 쾅
      for (const bs of sd.bursts) {
        const c = this.toScreen(i, W, H, bs.x, bs.y);
        if (bs.kind === 'pop') {
          const k = bs.age / POP_FX;
          emoji(ctx, '⭐', c.x, c.y, r * 2 * bs.size * (0.6 + 0.9 * k), 1 - k);
          ctx.save();
          ctx.fillStyle = `rgba(255,216,77,${1 - k})`;
          for (let a = 0; a < 8; a++) { // 사방으로 튀는 반짝이
            const ang = (a / 8) * Math.PI * 2, d = r * (0.6 + 1.6 * k) * Math.max(0.6, bs.size);
            ctx.beginPath(); ctx.arc(c.x + Math.cos(ang) * d, c.y + Math.sin(ang) * d, r * 0.12 * (1 - k), 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        } else {
          const k = bs.age / BOOM_FX;
          emoji(ctx, '💥', c.x, c.y, r * 2.4 * (0.8 + 0.9 * k), 1 - k * k);
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
// 자세 판정: 팔다리 마디마다 '어느 방향을 가리키는지'를 자세 정의(0=아래, 90=바깥, 180=위, 180 넘으면 안쪽)와 비교한다.
// 관절이 굽은 정도만 보면 '팔 ㄴ자(선인장)'와 '팔 ㄱ자(로봇)'가 똑같이 90도라 구분이 안 되기 때문.
// 몸이 기울어도 되도록 몸통 축 기준으로 재고, 좌우를 바꾼(거울) 자세도 정답으로 인정한다.
const LIMB_TOL = { easy: [25, 35], normal: [20, 30], hard: [15, 25] }; // [이만큼 틀려도 만점, 여기서 더 틀리면 0점] (도)
const LIMBS = [
  ['L', 'a', 0, LM.lShoulder, LM.lElbow], ['L', 'a', 1, LM.lElbow, LM.lWrist],
  ['R', 'a', 0, LM.rShoulder, LM.rElbow], ['R', 'a', 1, LM.rElbow, LM.rWrist],
  ['L', 'g', 0, LM.lHip, LM.lKnee], ['L', 'g', 1, LM.lKnee, LM.lAnkle],
  ['R', 'g', 0, LM.rHip, LM.rKnee], ['R', 'g', 1, LM.rKnee, LM.rAnkle],
];
export function limbScore(pts, pose, diffKey = 'normal') {
  const [tol, fall] = LIMB_TOL[diffKey] || LIMB_TOL.normal;
  const sh = mid(pts[LM.lShoulder], pts[LM.rShoulder]), hp = mid(pts[LM.lHip], pts[LM.rHip]);
  const tilt = Math.atan2(sh.x - hp.x, hp.y - sh.y); // 몸통이 기운 만큼 되돌린다
  const c = Math.cos(-tilt), s = Math.sin(-tilt);
  const wrap = (d) => ((d % 360) + 540) % 360 - 180;
  const dirOf = (a, b, side) => { // side: L = 화면 왼쪽(-1), R = 오른쪽(+1)
    const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return (Math.atan2(side * rx, ry) * 180) / Math.PI; // 0=아래, +90=바깥, ±180=위
  };
  const score = (spec) => {
    const vals = [];
    for (const [sd, part, k, a, b] of LIMBS) {
      if (!pts[a].ok || !pts[b].ok) continue; // 화면 밖 다리는 빼고 판정
      const d = Math.abs(wrap(dirOf(a, b, sd === 'L' ? -1 : 1) - spec[sd][part][k]));
      vals.push(clamp(1 - (d - tol) / fall, 0, 1));
    }
    if (!vals.length) return 0;
    vals.sort((x, y) => x - y);
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    return 0.5 * mean + 0.5 * vals[0]; // 가장 많이 틀린 마디를 크게 반영 → 팔 하나만 틀려도 통과 못 함
  };
  return Math.max(score(pose), score({ L: pose.R, R: pose.L }));
}

const WALL_TRAVEL = 4.0;  // 기본 속도에서 벽이 멀리서 몸까지 오는 시간(초)
const WALL_GAP = 0.6;     // 벽과 벽 사이 쉬는 시간(초)
const HIT_FROM = 0.9, HIT_TO = 1.04; // 벽이 몸에 닿는 구간 (이 사이에 한 번이라도 맞으면 통과)
const WALL_X = [-1.9, 1.9], WALL_Y = [-2.6, 1.9]; // 벽 크기 (몸통 길이 단위, 엉덩이 = 0)
const DUCK_LINE = -1.05, JUMP_LINE = 1.3;
export const WALL_POSES = [
  ...POSES.filter((p) => p.level === 1),
  makePose({ id: 'oneUp', name: '한 팔 번쩍', emoji: '🙋', L: { a: [165, 172], g: [3, 2] }, R: { a: [10, 5], g: [3, 2] } }),
  makePose({ id: 'robot', name: '로봇', emoji: '🤖', L: { a: [90, 0], g: [3, 2] }, R: { a: [90, 0], g: [3, 2] } }),
  // 이집트 벽화: 한 팔은 ㄴ자로 위, 한 팔은 ㄱ자로 아래 (지그재그)
  makePose({ id: 'egypt', name: '이집트 벽화', emoji: '🏺', L: { a: [90, 180], g: [3, 2] }, R: { a: [90, 0], g: [3, 2] } }),
  makePose({ id: 'egyptWalk', name: '걷는 이집트인', emoji: '🐫', L: { a: [90, 0], g: [28, 28] }, R: { a: [90, 180], g: [3, 2] } }),
  makePose({ id: 'bolt', name: '번개', emoji: '⚡', L: { a: [135, 135], g: [3, 2] }, R: { a: [45, 45], g: [25, 25] } }),
  makePose({ id: 'heart', name: '머리 위 하트', emoji: '🫶', L: { a: [150, 230], g: [3, 2] }, R: { a: [150, 230], g: [3, 2] } }),
  POSES.find((p) => p.id === 'flamingo'),
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
    for (const k of Object.values(LM)) pts[k] = { ...b.P(k), ok: b.ok(k) };
    return limbScore(pts, w.pose, this.o.diffKey) >= this.o.diff.match;
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
        label(ctx, txt, x0 + cx + (i ? 1 : -1) * W * 0.045, H * 0.08 + S * 0.45, S * 0.42, WALL_COLORS[w.kind]); // 가운데 위 카드에 가리지 않게 바깥쪽으로
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
    // 각자 절반 맨 위에 달리기 트랙 (크게)
    this.players.forEach((p, i) => {
      const x0 = i * W / 2 + W * 0.03, x1 = (i + 1) * W / 2 - W * 0.06, y = H * 0.07, h = H * 0.09;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.roundRect(x0 - W * 0.01, y - h / 2, x1 - x0 + W * 0.06, h, h / 2); ctx.fill();
      ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.restore();
      emoji(ctx, '🏁', x1 + W * 0.02, y, h * 0.7);
      const k = Math.min(1, p.score / RACE_GOAL), rx = x0 + (x1 - x0) * k;
      ctx.save(); ctx.translate(rx, y); ctx.scale(-1, 1); emoji(ctx, '🏃', 0, 0, h * 0.8); ctx.restore();
      label(ctx, `${p.score}`, rx, y + h * 0.75, h * 0.32, 'rgba(0,0,0,.6)', SIDE_COLORS[i]);
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
          if (p.everSeen) { sd.goals++; this.hurt(i, '골을 먹었어요', ball.tx, ball.ty, true); sfx.boom(); } // 무적 중이어도 골은 무조건 -1
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

// ---------------- 💃 막춤 얼음땡 ----------------
// 따라 할 스켈레톤 없이, 내 몸이 얼마나 크게·빠르게 움직이는지(역동성)로 점수를 쌓는다.
// 정해진 시간 안에 '얼음!'이 무작위로 3번 나온다 (두 선수 같은 순간). 그때는 멈춰서 버텨야 하고,
// 움직이면 생명이 줄어든다. 생명을 다 잃으면 그 선수의 점수는 그대로 멈춘다 (대결은 시간 끝까지).
const DANCE_JOINTS = [LM.lWrist, LM.rWrist, LM.lElbow, LM.rElbow, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
const FREEZES = 3;
const FREEZE_GRACE = 0.8;   // "얼음!" 직후 멈출 시간 (판정 안 함)
const FREEZE_HOLD = 3;      // 멈춰서 버티는 시간
const ENERGY_LOW = 0.5;     // 이보다 느린 움직임은 점수 없음 (몸통 길이/초)
const ENERGY_FULL = 3.0;    // 이만큼 움직이면 최고 점수 (초당 10점)
const STILL = { easy: 0.9, normal: 0.7, hard: 0.5 }; // 얼음 중 허용되는 움직임 (몸통 길이/초)
// 콤보: 신나게(게이지 25% 넘게) 0.5초 움직일 때마다 +1, 멈칫하면(0.6초) 끊긴다. 콤보만큼 점수 배율이 오른다
const COMBO_STEP = 0.5, COMBO_BREAK = 0.6, COMBO_MAX_MULT = 2; // 배율은 콤보 1개당 +0.05, 최대 ×2
const FREEZE_BONUS = 20;   // 얼음을 생명 안 잃고 버티면 보너스

class FreeDance extends Base {
  constructor(o) {
    super(o);
    this.endsOnOut = false;
    this.still = STILL[o.diffKey] ?? STILL.normal;
    this.motion = [0, 1].map(() => ({ prev: null, energy: 0, danger: 0, freezeOK: 0, fails: 0, hitThis: false, combo: 0, best: 0, comboT: 0, idle: 0, acc: 0, popT: 0, pulse: 0 }));
    this.freezeAt = null; // 대결 시간이 정해지면 만든다
    this.phase = 'dance'; // dance | freeze
    this.fT = 0;
    this.fIdx = 0;
    this.beatT = 0;
  }
  // 대결 시간 안에 '얼음' 3번을 서로 떨어지게 무작위 배치
  plan(total) {
    const r = rng(this.seed), len = FREEZE_GRACE + FREEZE_HOLD;
    const start = 5, end = total - len - 2;
    const slot = (end - start) / FREEZES;
    this.freezeAt = Array.from({ length: FREEZES }, (_, k) => start + slot * k + r() * Math.max(0, slot - len - 2));
  }
  // 이번 프레임 움직임의 세기 (몸통 길이/초). 좌표를 먼저 살짝 스무딩해서 카메라 떨림은 움직임으로 치지 않고,
  // 가장 빠른 절반의 관절 평균을 써서 팔만 흔들어도, 온몸으로 춤춰도 잘 잡히게 한다.
  measure(i, dt) {
    const p = this.players[i], M = this.motion[i];
    if (!p.b || dt <= 0) { M.prev = null; M.sm = null; M.energy *= 0.8; return; }
    const b = p.b, a = 1 - Math.exp(-dt * 12);
    M.sm = M.sm || {};
    const cur = {};
    for (const k of [...DANCE_JOINTS, 'hip']) {
      const raw = k === 'hip' ? b.hp : b.ok(k) ? b.P(k) : null;
      if (!raw) { delete M.sm[k]; continue; }
      const sm = M.sm[k] ? { x: M.sm[k].x + (raw.x - M.sm[k].x) * a, y: M.sm[k].y + (raw.y - M.sm[k].y) * a } : { ...raw };
      M.sm[k] = sm; cur[k] = sm;
    }
    if (M.prev) {
      const v = [];
      for (const k in cur) if (M.prev[k]) v.push(Math.min(8, dist(cur[k], M.prev[k]) / b.torso / dt)); // 인식이 튀는 순간 이동은 잘라냄
      v.sort((x, y) => y - x);
      const top = v.slice(0, Math.max(1, Math.ceil(v.length / 2)));
      const e = top.length ? top.reduce((x, y) => x + y, 0) / top.length : 0;
      M.energy += (e - M.energy) * Math.min(1, dt * 6);
    }
    M.prev = cur;
  }
  tick(t, dt, people, W, H, playing, total) {
    this.observe(people, W, H, dt);
    this.players.forEach((_, i) => this.measure(i, dt));
    if (!playing) return;
    if (!this.freezeAt) this.plan(total);
    this.t = t;
    if (this.phase === 'dance') {
      this.beatT += dt;
      if (this.beatT >= 0.5) { this.beatT = 0; sfx.beat(); }
      this.players.forEach((p, i) => {
        const M = this.motion[i];
        M.pulse = Math.max(0, M.pulse - dt * 3);
        if (!p.b || p.lives <= 0) return;
        const q = clamp((M.energy - ENERGY_LOW) / (ENERGY_FULL - ENERGY_LOW), 0, 1);
        // 콤보
        if (q > 0.25) {
          M.idle = 0; M.comboT += dt;
          while (M.comboT >= COMBO_STEP) {
            M.comboT -= COMBO_STEP; M.combo++; M.best = Math.max(M.best, M.combo);
            if (M.combo % 10 === 0) { this.pop(this.hudX(i, W), H * 0.36, `🔥 ${M.combo} 콤보!`, '#ff6b4a'); sfx.bonus(); }
          }
        } else if (q < 0.1) {
          M.idle += dt;
          if (M.idle > COMBO_BREAK && M.combo > 0) { M.combo = 0; M.comboT = 0; }
        }
        // 점수 (콤보 배율) + 0.5초마다 얻은 점수를 머리 위에 띄운다
        const gain = dt * 10 * q * this.mult(i);
        p.score += gain; M.acc += gain; M.popT += dt;
        if (M.popT >= 0.5) {
          if (M.acc >= 1) {
            const big = M.acc >= 5;
            M.side = -(M.side || 1); // 머리 왼쪽·오른쪽 번갈아
            this.pop(p.b.sh.x + M.side * p.b.torso * (0.85 + Math.random() * 0.2), Math.max(H * 0.3, p.b.sh.y - p.b.torso * 0.4),
              `+${Math.round(M.acc)}`, big ? '#ff6b4a' : M.acc >= 2.5 ? '#ffd84d' : '#fff');
            M.pulse = 1;
          }
          M.acc = 0; M.popT = 0;
        }
      });
      if (this.fIdx < FREEZES && t >= this.freezeAt[this.fIdx]) {
        this.phase = 'freeze'; this.fT = 0;
        this.motion.forEach((M) => { M.danger = 0; M.hitThis = false; });
        this.events.push({ kind: 'freeze' });
        sfx.freeze();
      }
    } else {
      this.fT += dt;
      const judging = this.fT >= FREEZE_GRACE;
      this.players.forEach((p, i) => {
        const M = this.motion[i];
        if (!p.everSeen || p.lives <= 0) return;
        if (!judging || p.inv > 0) { M.danger = Math.max(0, M.danger - dt); return; }
        const moving = !p.b ? 0.8 : M.energy > this.still ? 1.3 + 2 * (M.energy - this.still) / this.still : 0;
        if (moving) M.danger += dt * moving; else M.danger = Math.max(0, M.danger - dt * 0.4);
        if (M.danger >= 1) {
          M.danger = 0;
          if (this.hurt(i, p.b ? '얼음인데 움직였어요' : '몸이 화면 밖으로 나갔어요')) { M.hitThis = true; M.fails++; M.combo = 0; M.comboT = 0; }
        }
      });
      if (this.fT >= FREEZE_GRACE + FREEZE_HOLD) {
        this.phase = 'dance'; this.fIdx++;
        let ok = false;
        this.players.forEach((p, i) => {
          if (!p.everSeen || p.lives <= 0 || this.motion[i].hitThis) return;
          this.motion[i].freezeOK++; ok = true;
          p.score += FREEZE_BONUS; this.motion[i].pulse = 1;
          this.pop(this.hudX(i, W), H * 0.36, `🧊 얼음 성공 +${FREEZE_BONUS}`, '#7cc8ff');
        });
        this.events.push({ kind: 'unfreeze' });
        if (ok) sfx.bonus();
      }
    }
  }
  get frozen() { return this.phase === 'freeze'; }
  // 점수·게이지·콤보를 그릴 가로 위치: 선수를 따라가되 자기 절반 안에서
  hudX(i, W) {
    const b = this.players[i].b, x0 = i * W / 2;
    return clamp(b ? b.sh.x : x0 + W / 4, x0 + W * 0.12, x0 + W / 2 - W * 0.12);
  }
  mult(i) { return Math.min(COMBO_MAX_MULT, 1 + this.motion[i].combo * 0.05); }
  status(i) {
    const p = this.players[i], M = this.motion[i];
    if (p.everSeen && p.lives <= 0) return ['out', '탈락 💧 점수가 멈췄어요'];
    const s = super.status(i);
    if (s && s[0] !== 'wait') return s;
    if (this.frozen) return this.fT < FREEZE_GRACE ? ['wait', '얼음! 멈춰요! 🧊'] : M.energy > this.still ? ['wobble', '움직이면 안 돼요! 😵'] : ['ok', '잘 버티고 있어요! 🧊'];
    const e = M.energy;
    return e > 2.2 ? ['great', '불타는 춤! 🔥'] : e > 1 ? ['good', '좋아요! 더 크게! 👍'] : ['follow', '더 신나게 움직여요! 💃'];
  }
  scoreText(i) { return `${Math.floor(this.players[i].score)}점`; }
  detail(i) { return `얼음 성공 ${this.motion[i].freezeOK} / ${FREEZES}번 · 최고 ${this.motion[i].best} 콤보`; }
  phaseText() {
    if (this.frozen) {
      const left = FREEZE_GRACE + FREEZE_HOLD - this.fT;
      return this.fT < FREEZE_GRACE ? '얼음! 그 자세 그대로 멈춰요!' : `버텨요! ${Math.ceil(left)}초`;
    }
    return `크게 움직일수록 점수 UP! (얼음 ${this.fIdx}/${FREEZES})`;
  }
  draw(ctx, W, H) {
    // 각 선수 절반의 맨 위 줄: 큰 점수 → 불꽃 게이지(지금 움직임의 세기) → 콤보. 머리 위가 아니라 고정 줄이라 서로 겹치지 않는다
    this.players.forEach((p, i) => {
      if (!p.everSeen) return;
      const M = this.motion[i], X = this.hudX(i, W);
      const out = p.lives <= 0;
      const fs = H * 0.085 * (1 + 0.3 * M.pulse);
      const sy = H * 0.07;
      ctx.save();
      ctx.font = `${Math.round(fs)}px Jua, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
      const txt = `${Math.floor(p.score)}점${out ? ' 🔒' : ''}`;
      ctx.strokeText(txt, X, sy);
      ctx.fillStyle = out ? '#9aa3b5' : SIDE_COLORS[i]; ctx.fillText(txt, X, sy);
      ctx.restore();
      if (out) return;
      const q = this.frozen ? 0 : clamp((M.energy - ENERGY_LOW) / (ENERGY_FULL - ENERGY_LOW), 0, 1);
      const w = W * 0.16, h = H * 0.018, bx = X - w / 2, by = H * 0.125;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, h / 2); ctx.fill();
      ctx.fillStyle = q > 0.6 ? '#ff6b4a' : q > 0.25 ? '#ffb020' : '#7a8499';
      ctx.beginPath(); ctx.roundRect(bx, by, Math.max(h, w * q), h, h / 2); ctx.fill();
      ctx.restore();
      if (M.combo >= 2 && !this.frozen) {
        const c = M.combo, cs = H * 0.032 * (1 + Math.min(c, 30) / 30);
        const col = c >= 20 ? '#ff4d5e' : c >= 10 ? '#ff7a3d' : '#ffd84d';
        label(ctx, `🔥 ${c} 콤보 ×${this.mult(i).toFixed(2).replace(/0$/, '')}`, X, by + h + cs * 1.1, cs, 'rgba(0,0,0,.65)', col);
      }
      // 얼음 중 움직이면 몸 주변에 빨간 경고 원
      if (p.b && this.frozen && this.fT >= FREEZE_GRACE && M.danger > 0) {
        const T = p.b.torso;
        ctx.save();
        ctx.strokeStyle = `rgba(255,77,94,${0.4 + 0.6 * M.danger})`; ctx.lineWidth = T * 0.06;
        ctx.beginPath(); ctx.arc(p.b.sh.x, p.b.sh.y + T * 0.3, T * 1.3, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    });
    if (this.frozen) { // 얼음 동안 화면을 파랗게
      ctx.fillStyle = 'rgba(80,170,255,0.18)';
      ctx.fillRect(0, 0, W, H);
    }
    this.drawFx(ctx, W, H);
  }
  simPose(t) {
    if (this.frozen) return this.lastSim || { L: { a: [90, 90], g: [3, 2] }, R: { a: [90, 90], g: [3, 2] } };
    const seq = [
      { L: { a: [150, 170], g: [10, 5] }, R: { a: [40, 10], g: [3, 2] } },
      { L: { a: [40, 10], g: [3, 2] }, R: { a: [150, 170], g: [10, 5] } },
      { L: { a: [90, 180], g: [30, 20] }, R: { a: [90, 0], g: [3, 2] } },
      { L: { a: [130, 130], g: [3, 2] }, R: { a: [130, 130], g: [30, 30] } },
    ];
    this.lastSim = seq[Math.floor(t / 0.35) % seq.length];
    return this.lastSim;
  }
}

export function createArcade(mode, opts) {
  const C = { dance: FreeDance, balloon: Balloon, wall: Wall, race: Race, goalie: Goalie }[mode];
  return new C(opts);
}
