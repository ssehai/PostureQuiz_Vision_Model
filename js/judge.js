// 판정 공통: 난이도 기준값, 관절이 보이는지 확인

// 난이도별 기준값 (벽 통과하기의 자세 구멍 판정에 쓴다)
// tol: 관절 각도가 이만큼(도) 틀려도 만점, falloff: 거기서 이만큼 더 틀리면 0점, match: 통과 기준
// (실제 카메라는 각도가 흔들리고 아이들 동작도 크게 달라서 넉넉하게 잡음)
export const DIFFICULTY = {
  easy:   { label: '쉬움',   match: 0.6,  tol: 32, falloff: 50 },
  normal: { label: '보통',   match: 0.65, tol: 27, falloff: 45 },
  hard:   { label: '어려움', match: 0.75, tol: 20, falloff: 40 },
};

// 관절 하나가 화면 안에 또렷이 보이는지
export function seenLm(p) {
  return !!p && (p.visibility == null || p.visibility >= 0.3) &&
    p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05;
}
