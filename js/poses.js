// 자세 라이브러리 + 각도 계산
// 자세는 "팔다리 방향"으로 정의하고, 순운동학(FK)으로 관절 좌표를 만들어
// 화면의 가이드(고스트) 그리기와 판정용 목표 각도를 같은 데이터에서 얻는다.

// MediaPipe Pose 랜드마크 번호 (큰 관절만 사용)
export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
};

// 화면에 그릴 뼈대 연결선
export const BONES = [
  [LM.lShoulder, LM.rShoulder],
  [LM.lShoulder, LM.lElbow], [LM.lElbow, LM.lWrist],
  [LM.rShoulder, LM.rElbow], [LM.rElbow, LM.rWrist],
  [LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip],
  [LM.lHip, LM.rHip],
  [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle],
  [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle],
];

export const JOINTS = [
  LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist,
  LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle,
];

// 판정에 쓰는 8개 관절 각도: [이름, 꼭짓점, 끝점A, 끝점B]
export const ANGLES = [
  ['lShoulder', LM.lShoulder, LM.lHip, LM.lElbow],
  ['rShoulder', LM.rShoulder, LM.rHip, LM.rElbow],
  ['lElbow', LM.lElbow, LM.lShoulder, LM.lWrist],
  ['rElbow', LM.rElbow, LM.rShoulder, LM.rWrist],
  ['lHip', LM.lHip, LM.lShoulder, LM.lKnee],
  ['rHip', LM.rHip, LM.rShoulder, LM.rKnee],
  ['lKnee', LM.lKnee, LM.lHip, LM.lAnkle],
  ['rKnee', LM.rKnee, LM.rHip, LM.rAnkle],
];

const MIRROR_KEY = {
  lShoulder: 'rShoulder', rShoulder: 'lShoulder',
  lElbow: 'rElbow', rElbow: 'lElbow',
  lHip: 'rHip', rHip: 'lHip',
  lKnee: 'rKnee', rKnee: 'lKnee',
};

// 팔다리 방향(도): 0 = 아래, 90 = 몸 바깥쪽 수평, 180 = 위, 180 초과/음수 = 몸 안쪽
// a = [윗팔, 아래팔], g = [허벅지, 정강이]. L = 화면 왼쪽, R = 화면 오른쪽 팔다리
export const POSES = [
  { id: 'hooray', name: '만세', emoji: '🙌', level: 1, hint: '두 팔을 쭉 위로!',
    L: { a: [165, 172], g: [4, 2] }, R: { a: [165, 172], g: [4, 2] } },
  { id: 'scarecrow', name: '허수아비', emoji: '🧍', level: 1, hint: '두 팔을 옆으로 쭉!',
    L: { a: [90, 90], g: [3, 2] }, R: { a: [90, 90], g: [3, 2] } },
  { id: 'star', name: '별', emoji: '⭐', level: 1, hint: '팔다리를 X자로 쫙!',
    L: { a: [130, 130], g: [30, 30] }, R: { a: [130, 130], g: [30, 30] } },
  { id: 'cactus', name: '선인장', emoji: '🌵', level: 1, hint: '팔꿈치를 ㄴ자로 세워요',
    L: { a: [90, 180], g: [3, 2] }, R: { a: [90, 180], g: [3, 2] } },
  { id: 'tree', name: '나무', emoji: '🌳', level: 2, hint: '손은 머리 위로, 한 발은 무릎에!',
    L: { a: [150, 205], g: [60, -100] }, R: { a: [150, 205], g: [0, 0] } },
  { id: 'ballerina', name: '발레리나', emoji: '🩰', level: 2, hint: '한 팔은 둥글게 위로, 한 다리는 옆으로!',
    L: { a: [160, 220], g: [2, 0] }, R: { a: [80, 95], g: [38, 38] } },
  { id: 'horse', name: '말 타기', emoji: '🐴', level: 2, hint: '다리 벌리고 앉듯이, 손은 허리에!',
    L: { a: [40, -60], g: [55, -5] }, R: { a: [40, -60], g: [55, -5] } },
  { id: 'flamingo', name: '플라밍고', emoji: '🦩', level: 2, hint: '팔은 옆으로, 한쪽 무릎을 옆으로 들어요!',
    L: { a: [95, 95], g: [3, 0] }, R: { a: [95, 95], g: [85, 0] } },
];

// ---- 기하 유틸 ----
function dirVec(deg, side) { // side: -1 화면 왼쪽, +1 화면 오른쪽
  const r = (deg * Math.PI) / 180;
  return { x: side * Math.sin(r), y: Math.cos(r) };
}

export function angleAt(p, a, b) {
  const v1x = a.x - p.x, v1y = a.y - p.y;
  const v2x = b.x - p.x, v2y = b.y - p.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n < 1e-9) return 0;
  const c = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(c) * 180) / Math.PI;
}

// 순운동학: 엉덩이 중심 (0,0), 몸통 길이 1 기준 좌표 (y 아래 방향, 거울 시점)
const BODY = { shoulderW: 0.36, hipW: 0.2, upperArm: 0.55, foreArm: 0.5, thigh: 0.85, shin: 0.8, head: 0.38 };

export function buildSkeleton(pose) {
  const pts = {};
  const put = (i, x, y) => { pts[i] = { x, y }; };
  // 거울 화면에서 화면 왼쪽 = 사람의 왼쪽. 판정은 좌우 반전도 허용하므로 일관성만 맞추면 된다.
  const sides = [
    { s: -1, def: pose.L, sh: LM.lShoulder, el: LM.lElbow, wr: LM.lWrist, hp: LM.lHip, kn: LM.lKnee, an: LM.lAnkle },
    { s: +1, def: pose.R, sh: LM.rShoulder, el: LM.rElbow, wr: LM.rWrist, hp: LM.rHip, kn: LM.rKnee, an: LM.rAnkle },
  ];
  put(LM.nose, 0, -1 - BODY.head);
  for (const d of sides) {
    const sh = { x: d.s * BODY.shoulderW, y: -1 };
    const ua = dirVec(d.def.a[0], d.s), fa = dirVec(d.def.a[1], d.s);
    const el = { x: sh.x + ua.x * BODY.upperArm, y: sh.y + ua.y * BODY.upperArm };
    const wr = { x: el.x + fa.x * BODY.foreArm, y: el.y + fa.y * BODY.foreArm };
    const hp = { x: d.s * BODY.hipW, y: 0 };
    const th = dirVec(d.def.g[0], d.s), sn = dirVec(d.def.g[1], d.s);
    const kn = { x: hp.x + th.x * BODY.thigh, y: hp.y + th.y * BODY.thigh };
    const an = { x: kn.x + sn.x * BODY.shin, y: kn.y + sn.y * BODY.shin };
    put(d.sh, sh.x, sh.y); put(d.el, el.x, el.y); put(d.wr, wr.x, wr.y);
    put(d.hp, hp.x, hp.y); put(d.kn, kn.x, kn.y); put(d.an, an.x, an.y);
  }
  return pts;
}

export function computeAngles(pts) {
  const out = {};
  for (const [name, p, a, b] of ANGLES) out[name] = angleAt(pts[p], pts[a], pts[b]);
  return out;
}

export function mirrorAngles(ang) {
  const out = {};
  for (const k in ang) out[MIRROR_KEY[k]] = ang[k];
  return out;
}

// 팔다리 방향 정의(spec)에 그림용 좌표와 목표 각도(원본/좌우반전)를 붙인다
export function makePose(spec) {
  spec.skeleton = buildSkeleton(spec);
  spec.target = computeAngles(spec.skeleton);
  spec.targetMirror = mirrorAngles(spec.target);
  return spec;
}

// 두 자세 사이를 k(0~1)만큼 보간한 새 자세 (춤 애니메이션용)
export function lerpPose(a, b, k) {
  const mix = (x, y) => x.map((v, i) => v + (y[i] - v) * k);
  return makePose({
    L: { a: mix(a.L.a, b.L.a), g: mix(a.L.g, b.L.g) },
    R: { a: mix(a.R.a, b.R.a), g: mix(a.R.g, b.R.g) },
  });
}

for (const p of POSES) makePose(p);

// 유사도 0~1. 관절별 오차가 tol 이내면 만점, tol+falloff에서 0점.
// 평균만 쓰면 한두 관절이 크게 틀려도 통과하므로, 가장 많이 틀린 2개 관절 점수를 섞는다.
// 좌우 반전(거울) 자세도 정답으로 인정하고 둘 중 높은 점수를 쓴다.
export function poseSimilarity(angles, pose, tol = 20, falloff = 40) {
  const score = (target) => {
    const parts = [];
    for (const k in target) {
      if (angles[k] == null) continue;
      const d = Math.abs(angles[k] - target[k]);
      parts.push(Math.max(0, Math.min(1, 1 - (d - tol) / falloff)));
    }
    if (!parts.length) return 0;
    parts.sort((a, b) => a - b);
    const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
    const worst = (parts[0] + (parts[1] ?? parts[0])) / 2;
    return 0.6 * mean + 0.4 * worst;
  };
  return Math.max(score(pose.target), score(pose.targetMirror));
}
