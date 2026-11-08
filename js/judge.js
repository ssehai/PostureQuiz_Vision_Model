// 한 선수의 판정 상태: 좌표 스무딩, 흔들림 측정, 자세 일치도, 위험 게이지, 생명
import { LM, JOINTS, computeAngles, poseDetail } from './poses.js';

// 난이도별 기준값
export const DIFFICULTY = {
// tol: 관절 각도가 이만큼(도) 틀려도 만점, falloff: 거기서 이만큼 더 틀리면 0점
// (실제 카메라는 각도가 흔들리고 아이들 동작도 크게 달라서 넉넉하게 잡음)
  easy:   { label: '쉬움',   wobble: 0.13,  match: 0.6,  tol: 32, falloff: 50 },
  normal: { label: '보통',   wobble: 0.09,  match: 0.65, tol: 27, falloff: 45 },
  hard:   { label: '어려움', wobble: 0.065, match: 0.75, tol: 20, falloff: 40 },
};

const SMOOTH = 0.45;        // 좌표 EMA 계수 (작을수록 부드럽게)
const WINDOW = 0.8;         // 흔들림을 재는 시간 창(초)
const MISSING_LIMIT = 0.35; // 이 시간(초) 이상 안 보이면 '안 보임' 처리
const INVINCIBLE = 1.6;     // 생명 잃은 뒤 무적 시간(초)

// 관절 하나가 화면 안에 또렷이 보이는지
export function seenLm(p) {
  return !!p && (p.visibility == null || p.visibility >= 0.3) &&
    p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05;
}

// 몸통(어깨·엉덩이)이 보이는지. 이것만 안 보일 때 '화면 밖'으로 벌점을 준다.
// 다리가 화면 아래로 잘리거나 손이 위로 잘려도 벌점은 없고, 안 보이는 다리는 판정에서 뺀다.
const TORSO = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];
export function isFullBody(lms) {
  return TORSO.every((i) => seenLm(lms[i]));
}
const LEGS = [LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];

export class PlayerJudge {
  constructor(lives) {
    this.maxLives = lives;
    this.reset(lives);
  }

  reset(lives = this.maxLives) {
    this.lives = lives;
    this.smooth = null;     // 스무딩된 좌표 (index → {x,y})
    this.hist = [];         // 최근 WINDOW초 동안의 정규화 좌표
    this.clock = 0;
    this.wobble = 0;        // 최근 0.8초 동안 관절이 평균 위치에서 벗어난 정도 (몸통 길이 단위)
    this.match = 0;         // 0~1 자세 일치도
    this.danger = 0;        // 0~1, 가득 차면 생명 -1
    this.invincible = 0;
    this.missingFor = 0;
    this.visible = false;
    this.fullBody = false;
    this.status = 'wait';   // ok | wobble | pose | missing | wait
    this.matchSum = 0; this.matchN = 0; this.okTime = 0;
    this.lastHit = -1;
    this.everSeen = false;  // 대결 중 한 번이라도 화면에 나왔는지 (안 나왔으면 '빈 자리')
    this.score = 0;         // 댄스 모드 점수
    this.freezeOK = 0;      // 댄스 모드: 생명을 잃지 않고 버틴 '얼음' 횟수
  }

  // 댄스 모드의 춤추는 구간. poses = 최근 0.7초 동안 화면에 나온 춤 자세들.
  // 사람은 화면을 보고 따라 하느라 조금 늦으므로, 그중 가장 비슷한 자세로 채점한다.
  // 반환값: 이번 프레임 춤 품질 0~1
  danceStep(dt, poses, diff) {
    if (!this.everSeen) { this.status = 'empty'; this.match = 0; this.parts = null; this.danger = 0; return 0; }
    this.invincible = Math.max(0, this.invincible - dt);
    this.danger = Math.max(0, this.danger - dt * 0.8);
    let best = 0, parts = null;
    if (this.visible && this.angles) {
      for (const p of poses) {
        const d = poseDetail(this.angles, p, diff.tol, diff.falloff);
        if (d.score >= best) { best = d.score; parts = d.parts; }
      }
    }
    this.match = best;
    this.parts = parts;
    const seen = this.visible && this.fullBody;
    this.status = !seen ? 'missing' : best >= Math.max(0.85, diff.match + 0.15) ? 'great' : best >= diff.match ? 'good' : 'follow';
    const q = seen ? Math.max(0, Math.min(1, (best - 0.4) / 0.45)) : 0;
    this.score += dt * 10 * q;
    this.matchSum += best; this.matchN++;
    return q;
  }

  // 새 프레임의 랜드마크 반영 (lms: 화면 기준 0~1 좌표, 이미 거울 반전된 값)
  // aspect = 화면 가로/세로. 각도가 찌그러지지 않도록 x에 곱해 정사각 좌표로 바꾼다.
  observe(lms, dt, aspect = 16 / 9) {
    if (!lms) {
      this.missingFor += dt;
      if (this.missingFor > MISSING_LIMIT) { this.visible = false; this.smooth = null; this.hist = []; }
      return;
    }
    this.missingFor = 0;
    this.visible = true;
    this.fullBody = isFullBody(lms);
    if (this.fullBody) this.everSeen = true;
    this.seen = {};
    for (const i of JOINTS) this.seen[i] = seenLm(lms[i]);
    this.legsSeen = LEGS.every((i) => this.seen[i]);

    if (!this.smooth) {
      this.smooth = {};
      for (const i of [LM.nose, ...JOINTS]) this.smooth[i] = { x: lms[i].x * aspect, y: lms[i].y };
    } else {
      for (const i of [LM.nose, ...JOINTS]) {
        const s = this.smooth[i];
        s.x += (lms[i].x * aspect - s.x) * SMOOTH;
        s.y += (lms[i].y - s.y) * SMOOTH;
      }
    }

    // 몸통 길이로 정규화 → 카메라 거리/키와 무관하게 공정한 흔들림 측정
    const s = this.smooth;
    const hip = mid(s[LM.lHip], s[LM.rHip]);
    const sh = mid(s[LM.lShoulder], s[LM.rShoulder]);
    const torso = Math.max(0.02, Math.hypot(sh.x - hip.x, sh.y - hip.y));
    const norm = { hip: { x: hip.x / torso, y: hip.y / torso } };
    for (const i of JOINTS) norm[i] = { x: (s[i].x - hip.x) / torso, y: (s[i].y - hip.y) / torso };

    // 흔들림 = 최근 WINDOW초 동안 각 관절 위치의 표준편차 평균.
    // 프레임마다 속도를 더하는 방식은 카메라 fps와 좌표 떨림에 민감해서, 위치 분산을 쓴다.
    this.clock += dt;
    this.hist.push({ t: this.clock, norm });
    while (this.hist.length && this.clock - this.hist[0].t > WINDOW) this.hist.shift();
    if (this.hist.length >= 4) {
      // 화면 밖이라 추정만 된 관절은 위치가 크게 튀므로 흔들림 계산에서 뺀다
      const keys = ['hip', ...JOINTS.filter((i) => this.seen[i])];
      let total = 0;
      for (const k of keys) {
        let mx = 0, my = 0;
        for (const h of this.hist) { mx += h.norm[k].x; my += h.norm[k].y; }
        mx /= this.hist.length; my /= this.hist.length;
        let v = 0;
        for (const h of this.hist) v += (h.norm[k].x - mx) ** 2 + (h.norm[k].y - my) ** 2;
        total += Math.sqrt(v / this.hist.length) * (k === 'hip' ? 3 : 1); // 몸 전체가 휘청이는 건 가중
      }
      this.wobble = total / (keys.length + 2);
    }
    this.angles = computeAngles(s);
    // 안 보이는 다리는 각도를 빼서 팔(과 보이는 다리)만으로 판정
    const a = this.angles;
    if (!this.seen[LM.lKnee]) { a.lHip = null; a.lKnee = null; } else if (!this.seen[LM.lAnkle]) a.lKnee = null;
    if (!this.seen[LM.rKnee]) { a.rHip = null; a.rKnee = null; } else if (!this.seen[LM.rAnkle]) a.rKnee = null;
  }

  // 판정 한 스텝. judging=false면 게이지만 서서히 줄어든다(자세 바꾸는 준비 시간).
  // 반환값: 이번 스텝에 생명을 잃었으면 true
  step(dt, pose, diff, judging, now) {
    // 한 번도 나오지 않은 빈 자리에는 벌점을 주지 않는다 (혼자 연습할 때)
    if (!this.everSeen) { this.status = 'empty'; this.match = 0; this.parts = null; this.danger = 0; return false; }
    const d = this.visible && this.angles && pose ? poseDetail(this.angles, pose, diff.tol, diff.falloff) : null;
    this.match = d ? d.score : 0;
    this.parts = d ? d.parts : null;
    this.invincible = Math.max(0, this.invincible - dt);

    let rate = 0;
    if (!this.visible || !this.fullBody) {
      this.status = 'missing'; rate = 0.8;
    } else if (this.wobble > diff.wobble) {
      this.status = 'wobble'; rate = 1.0 + 2.5 * (this.wobble - diff.wobble) / diff.wobble;
    } else if (this.match < diff.match) {
      this.status = 'pose'; rate = 0.75;
    } else {
      this.status = 'ok';
    }

    if (!judging) {
      this.danger = Math.max(0, this.danger - dt * 0.8);
      return false;
    }

    this.matchSum += this.match; this.matchN++;
    if (this.status === 'ok') this.okTime += dt;

    if (this.invincible > 0) { this.danger = Math.max(0, this.danger - dt * 0.5); return false; }
    if (rate > 0) this.danger += dt * rate;
    else this.danger = Math.max(0, this.danger - dt * 0.35);

    if (this.danger >= 1) {
      this.danger = 0;
      this.lives = Math.max(0, this.lives - 1);
      this.hitReason = this.status; // 무엇 때문에 생명을 잃었는지 (화면에 표시)
      this.invincible = INVINCIBLE;
      this.lastHit = now;
      return true;
    }
    return false;
  }

  get avgMatch() { return this.matchN ? this.matchSum / this.matchN : 0; }
}

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
