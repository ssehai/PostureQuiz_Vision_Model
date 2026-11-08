// 댄스 얼음땡 모드: 춤 동작(키프레임)과 시간에 따른 춤 애니메이션
import { makePose, lerpPose } from './poses.js';

// 팔다리 방향(도): 0 = 아래, 90 = 몸 바깥쪽 수평, 180 = 위, 180 초과/음수 = 몸 안쪽
// a = [윗팔, 아래팔], g = [허벅지, 정강이]. L = 화면 왼쪽, R = 화면 오른쪽
// freeze: true 인 동작에서만 갑자기 멈춘다 (멈췄을 때 알아보기 쉬운 자세)
const LEGS = { g: [3, 2] };
const side = (a, g = LEGS.g) => ({ a, g });
const M = {
  rest:    { L: side([10, 5]),    R: side([10, 5]) },
  tee:     { L: side([90, 90]),   R: side([90, 90]),   freeze: true },
  up:      { L: side([165, 172]), R: side([165, 172]), freeze: true },
  cactus:  { L: side([90, 180]),  R: side([90, 180]),  freeze: true },
  robot:   { L: side([90, 0]),    R: side([90, 0]) },
  hips:    { L: side([40, -60]),  R: side([40, -60]) },
  star:    { L: side([130, 130], [30, 30]), R: side([130, 130], [30, 30]), freeze: true },
  lUp:     { L: side([165, 172]), R: side([40, -60]),  freeze: true },
  rUp:     { L: side([40, -60]),  R: side([165, 172]), freeze: true },
  discoL:  { L: side([140, 140]), R: side([35, 35]),   freeze: true },
  discoR:  { L: side([35, 35]),   R: side([140, 140]), freeze: true },
  squat:   { L: side([90, 90], [50, -5]), R: side([90, 90], [50, -5]), freeze: true },
  kneeL:   { L: side([90, 180], [85, 0]), R: side([90, 180]), freeze: true },
  kneeR:   { L: side([90, 180]), R: side([90, 180], [85, 0]), freeze: true },
  stepL:   { L: side([60, 60], [30, 30]), R: side([20, 20]) },
  stepR:   { L: side([20, 20]), R: side([60, 60], [30, 30]) },
  bow:     { L: side([125, 210]), R: side([125, 210]), freeze: true },
};
for (const k in M) makePose(M[k]);

export const DANCES = [
  {
    id: 'gym', name: '신나는 체조', beat: 1.3,
    moves: ['rest', 'tee', 'up', 'tee', 'cactus', 'robot', 'cactus', 'robot',
      'star', 'rest', 'lUp', 'rUp', 'lUp', 'rUp', 'hips', 'up'],
  },
  {
    id: 'disco', name: '디스코 파티', beat: 1.2,
    moves: ['discoL', 'discoR', 'discoL', 'discoR', 'squat', 'star', 'squat', 'star',
      'stepL', 'stepR', 'stepL', 'stepR', 'kneeL', 'tee', 'kneeR', 'tee'],
  },
  {
    id: 'hero', name: '슈퍼 히어로', beat: 1.4,
    moves: ['hips', 'up', 'hips', 'bow', 'tee', 'squat', 'tee', 'squat',
      'kneeL', 'cactus', 'kneeR', 'cactus', 'discoL', 'discoR', 'star', 'rest'],
  },
];

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const MOVE_PART = 0.4; // 한 박자 중 앞 40%는 다음 동작으로 움직이고, 나머지는 그 동작에서 머문다

// clock(초) 시점의 춤 상태
export function danceAt(dance, clock) {
  const n = dance.moves.length;
  const step = Math.floor(clock / dance.beat);
  const idx = ((step % n) + n) % n;
  const cur = M[dance.moves[idx]];
  const prev = M[dance.moves[(idx - 1 + n) % n]];
  const k = (clock - step * dance.beat) / (dance.beat * MOVE_PART);
  const holding = k >= 1;
  return {
    step,
    move: cur,
    holding,
    pose: holding ? cur : lerpPose(prev, cur, ease(Math.max(0, k))),
  };
}
