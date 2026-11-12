// 내 몸이 컨트롤러! AI 바디 배틀 - 메인 게임 흐름
import { BONES, JOINTS, LM } from './poses.js';
import { DIFFICULTY, seenLm, extendLegs } from './judge.js';
import { CameraTracker, listCameras } from './tracker.js';
import { SimTracker } from './sim.js';
import { sfx } from './sound.js';
import { ARCADE_INFO, createArcade } from './arcade.js';

const $ = (id) => document.getElementById(id);
// 팀: 이름은 바꿀 수 있고, 아이콘·색은 자리마다 고정
const TEAM_PRESETS = [
  { name: '호랑이팀', icon: '🐯', color: '#ff9a1f', grad: ['#ffe27a', '#ff8a00'], ink: '#3b1a00' },
  { name: '독수리팀', icon: '🦅', color: '#2a8bff', grad: ['#7fe3ff', '#2a6bff'], ink: '#00264d' },
  { name: '돌고래팀', icon: '🐬', color: '#22c25a', grad: ['#a8ff96', '#1fae50'], ink: '#0b3a16' },
  { name: '판다팀', icon: '🐼', color: '#9b59ff', grad: ['#dccbff', '#8a4dff'], ink: '#2a0f5c' },
];
const SIDE_COLORS = ['#ffcf3a', '#3ee6ff'];
const COUNTDOWN = 3;   // 시작 카운트다운(초)
const STORE_KEY = 'posequiz-v1';

// ---------------- 상태 ----------------
const state = {
  settings: { teamCount: 2, lives: 3, roundSec: 45, rounds: 1, difficulty: 'normal', model: 'lite', cameraId: '', mode: 'random', v: 2 },
  teams: TEAM_PRESETS.map((t) => ({ ...t, membersText: '', score: 0, played: 0, games: 0 })),
  history: [],
  // 대회: 라운드마다 모든 학생이 정확히 한 번씩 대결 (스위스 방식)
  round: 1,
  recs: {},   // '팀번호|이름' → { wins, games, points }
  screen: 'setup',
  tracker: null,
  next: null,    // 다음 대결 {sides:[{team, member}]}
  match: null,
  board: null,   // 방금 대결로 바뀐 팀 점수 (점수판 애니메이션용)
  people: [null, null],
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state.settings, d.settings || {});
    if (!(state.settings.mode in ARCADE_INFO) && state.settings.mode !== 'random') state.settings.mode = 'random'; // 없어진 게임
    if (!d.settings || d.settings.v !== 2) { state.settings.mode = 'random'; state.settings.v = 2; } // 돌림판이 생기면서 기본값을 바꿈
    (d.teams || []).forEach((t, i) => {
      const T = state.teams[i];
      if (!T) return;
      for (const k of ['name', 'membersText', 'score', 'played', 'games']) if (t[k] != null) T[k] = t[k];
    });
    state.history = d.history || [];
    if (d.recs && typeof d.recs === 'object') state.recs = d.recs;
    if (d.round >= 1) state.round = d.round;
  } catch { /* 저장소를 못 쓰는 환경이면 무시 */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: state.settings,
      teams: state.teams.map(({ name, membersText, score, played, games }) => ({ name, membersText, score, played, games })),
      history: state.history.slice(0, 30),
      round: state.round,
      recs: state.recs,
    }));
  } catch { /* 무시 */ }
}

const activeTeams = () => state.teams.slice(0, state.settings.teamCount);
function members(team) {
  const list = team.membersText.split('\n').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['선수 1', '선수 2', '선수 3', '선수 4', '선수 5'];
}
function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const shield = (team, size = '') => `<div class="shield" style="background:linear-gradient(${team.grad[0]},${team.grad[1]});${size}">${team.icon}</div>`;

// ---------------- 화면 전환 ----------------
const SCREENS = ['setup', 'lobby', 'result', 'rankboard', 'awards'];
function show(screen) {
  state.screen = screen;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== screen);
  $('hud').classList.toggle('hidden', screen !== 'play');
  document.body.classList.toggle('playing', screen === 'play');
  document.body.classList.toggle('on-setup', screen === 'setup');
  if (screen !== 'play') hideBig();
}
function shake() {
  document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 450);
}
function flash() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

// ---------------- ① 설정 화면 ----------------
const CHIPS = {
  mode: [['random', '🎰 돌림판'], ['dance', '💃 막춤'], ['balloon', '🎈 풍선'], ['wall', '🧱 벽'], ['race', '🏃 달리기'], ['goalie', '🧤 골키퍼']],
  teamCount: [['2', '🐯🦅 2팀'], ['3', '🐯🦅🐬 3팀'], ['4', '🐯🦅🐬🐼 4팀']],
  difficulty: [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']],
};
function renderChips() {
  document.querySelectorAll('.chips[data-for]').forEach((box) => {
    const key = box.dataset.for, cur = String(state.settings[key]);
    box.innerHTML = CHIPS[key].map(([v, label]) => `<button class="chip${v === cur ? ' on' : ''}" data-v="${v}">${label}</button>`).join('');
  });
}
function renderTeams() {
  const box = $('teams');
  box.innerHTML = '';
  activeTeams().forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'team-edit';
    div.style.borderColor = t.color;
    div.innerHTML = `<div class="thead">${shield(t)}<input data-i="${i}" class="tname" /></div>
      <textarea data-i="${i}" class="tmembers" placeholder="민수&#10;지우&#10;서연"></textarea>`;
    div.querySelector('.tname').value = t.name;
    div.querySelector('.tmembers').value = t.membersText;
    box.appendChild(div);
  });
}
function renderSetup() {
  const s = state.settings;
  for (const k of ['mode', 'teamCount', 'lives', 'roundSec', 'rounds', 'difficulty', 'model']) $(k).value = String(s[k]);
  renderChips();
  renderTeams();
}
function readSetup() {
  const s = state.settings;
  s.mode = $('mode').value;
  s.teamCount = +$('teamCount').value;
  s.lives = +$('lives').value;
  s.roundSec = +$('roundSec').value;
  s.rounds = +$('rounds').value;
  s.difficulty = $('difficulty').value;
  s.model = $('model').value;
  s.cameraId = $('camera').value;
  document.querySelectorAll('.tname').forEach((el) => { state.teams[+el.dataset.i].name = el.value.trim() || TEAM_PRESETS[+el.dataset.i].name; });
  document.querySelectorAll('.tmembers').forEach((el) => { state.teams[+el.dataset.i].membersText = el.value; });
  save();
}

// 설정 창의 카메라 선택 목록 채우기
async function refreshCameras() {
  const sel = $('camera');
  let cams = [];
  try { cams = await listCameras(); } catch { /* 무시 */ }
  const want = state.settings.cameraId;
  sel.innerHTML = '<option value="">기본 카메라</option>' +
    cams.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || `카메라 ${i + 1}`)}</option>`).join('');
  sel.value = cams.some((c) => c.deviceId === want) ? want : '';
  $('cameraNote').textContent = cams.length
    ? `카메라 ${cams.length}개 찾음${cams.some((c) => !c.label) ? ' · 이름은 권한을 허용하면 보여요' : ''}`
    : '연결된 카메라를 찾지 못했어요';
}

async function startApp(sim) {
  readSetup();
  sfx.unlock();
  const msg = $('setupMsg');
  msg.textContent = '';
  const cur = state.tracker;
  const s = state.settings;
  // 같은 모드/같은 카메라/같은 모델이면 그대로 사용, 아니면 끄고 새로 시작
  const same = cur && (sim
    ? cur.kind === 'sim'
    : cur.kind === 'camera' && cur.model === s.model && (cur.deviceId || '') === s.cameraId);
  if (same) { drawNext(); show('lobby'); return; }
  if (cur) { cur.stop(); state.tracker = null; }

  const btns = [$('startBtn'), $('simBtn')];
  btns.forEach((b) => (b.disabled = true));
  try {
    if (sim) {
      const t = new SimTracker();
      t.getPose = () => {
        const m = state.match;
        if (!m || m.phase === 'done') return null;
        return m.arcade.simPose(m.elapsed || 0);
      };
      state.tracker = t;
    } else {
      msg.style.color = 'var(--muted)';
      msg.textContent = '카메라와 AI 모델을 불러오는 중... (처음엔 10초쯤 걸려요)';
      const t = new CameraTracker($('video'));
      await t.start(s.model, s.cameraId);
      state.tracker = t;
      refreshCameras(); // 권한을 받았으니 카메라 이름이 보이게 다시 채움
    }
    msg.textContent = '';
    drawNext();
    show('lobby');
  } catch (e) {
    console.error(e);
    msg.style.color = '#ff8a95';
    const n = e && e.name;
    msg.textContent =
      n === 'NotAllowedError' ? '카메라 권한이 거부됐어요. 주소창 왼쪽의 아이콘을 눌러 카메라를 "허용"으로 바꾼 뒤 다시 눌러 주세요. (Mac은 시스템 설정 → 개인정보 보호 → 카메라에서 Chrome도 켜져 있어야 해요)'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? '선택한 카메라를 찾지 못했어요. 케이블을 확인하고 ⚙️ 설정에서 카메라를 다시 골라 주세요.'
      : n === 'NotReadableError' ? '다른 프로그램(줌, 팀즈, 다른 탭 등)이 카메라를 쓰고 있어요. 그 프로그램을 끄고 다시 눌러 주세요.'
      : `카메라/모델을 시작하지 못했어요: ${(e && e.message) || e}`;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------------- 대회 (스위스 방식) ----------------
// 라운드마다 모든 학생이 정확히 한 번씩 대결한다. 2라운드부터는 승수가 같은 학생끼리
// (이긴 학생은 이긴 학생끼리, 진 학생은 진 학생끼리) 만나서 실력이 비슷한 상대와 겨룬다.
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pkey = (team, member) => `${state.teams.indexOf(team)}|${member}`;
function rec(team, member) {
  const k = pkey(team, member);
  if (!state.recs[k]) state.recs[k] = { wins: 0, games: 0, points: 0 };
  return state.recs[k];
}
const allPlayers = () => activeTeams().flatMap((team) => members(team).map((member) => ({ team, member })));
// 이번 라운드에 아직 대결하지 않은 학생
const waiting = (team) => members(team).filter((m) => rec(team, m).games < state.round);
const waitingCount = () => activeTeams().reduce((n, t) => n + waiting(t).length, 0);
const roundDone = () => waitingCount() === 0;
const tourneyDone = () => roundDone() && state.round >= state.settings.rounds;
const samePair = (a, b) => b && a.every((sd) => b.some((p) => p.team === sd.team && p.member === sd.member));

function drawRound(prev) {
  const left = activeTeams().flatMap((team) => waiting(team).map((member) => ({ team, member, r: rec(team, member) })));
  if (!left.length) return null;
  // 혼자 남으면(홀수) 이미 대결한 학생이 '도우미'로 상대. 도우미의 승패·점수는 기록하지 않는다
  if (left.length === 1) {
    const a = left[0];
    const cands = allPlayers().filter((p) => !(p.team === a.team && p.member === a.member));
    const others = cands.filter((p) => p.team !== a.team);
    const h = pickRandom(others.length ? others : cands);
    return shuffle([{ team: a.team, member: a.member }, { team: h.team, member: h.member, helper: true }]);
  }
  for (let k = 0; k < 10; k++) {
    // 승수가 많은 학생부터 (같은 승수 안에서는 무작위)
    const order = shuffle(left).sort((x, y) => y.r.wins - x.r.wins);
    const a = order[0];
    // 상대: 승수가 같을수록, 다른 팀일수록 우선
    const cost = (p) => Math.abs(p.r.wins - a.r.wins) * 2 + (p.team === a.team ? 1 : 0);
    const rest = order.slice(1);
    const best = Math.min(...rest.map(cost));
    const b = pickRandom(rest.filter((p) => cost(p) === best));
    const sides = shuffle([a, b]).map((p) => ({ team: p.team, member: p.member }));
    if (!samePair(sides, prev && prev.sides) || k === 9) return sides;
  }
  return null;
}

function drawNext() {
  const sides = drawRound(state.next);
  state.next = sides ? { sides, round: state.round } : null;
  renderLobby(!!sides);
}

function nextRound() {
  if (!roundDone() || state.round >= state.settings.rounds) return;
  state.round++;
  save();
  drawNext();
}

// 팀 순위는 팀원 한 판당 평균 점수 (팀 인원이 달라도 공정하게)
const teamAvg = (t) => (t.games ? Math.round(t.score / t.games) : 0);
const byAvg = (a, b) => teamAvg(b) - teamAvg(a) || b.score - a.score;

// 대회 결과: 팀 순위, 점수 합계 상위(점수왕), 전승 학생
function standings() {
  const players = allPlayers().map((p) => ({ ...p, r: rec(p.team, p.member) }));
  const top = players.filter((p) => p.r.games > 0).sort((a, b) => b.r.points - a.r.points).slice(0, 3);
  const perfect = players.filter((p) => p.r.games > 0 && p.r.wins === p.r.games);
  const teams = activeTeams().slice().sort(byAvg);
  return { top, perfect, teams };
}

// 순위표 한 줄
function rankRow(t, r, avg = teamAvg(t), total = t.score) {
  return `<span class="no">${r === 0 ? '👑' : r + 1}</span>${shield(t, 'width:40px;height:46px;font-size:22px')}
    <span class="nm">${esc(t.name)}<div class="bar"><i style="width:${Math.min(100, avg)}%;background:linear-gradient(90deg,${t.grad[0]},${t.grad[1]})"></i></div></span>
    <span class="sc">평균 <b style="font-weight:400">${avg}</b><small>합계 ${total.toLocaleString()}점</small></span>`;
}

// ---------------- ② 대기실 ----------------
function renderLobby(roll = false) {
  $('scoreboard').innerHTML = activeTeams().slice().sort(byAvg)
    .map((t, r) => `<div class="rank${r === 0 && t.games ? ' first' : ''}">${rankRow(t, r)}</div>`).join('');
  const R = state.settings.rounds;
  const finished = tourneyDone();
  $('stageInfo').innerHTML = finished
    ? '🏁 대회 끝!'
    : `${state.round}라운드 / ${R} · ${state.round === 1 ? '다른 팀끼리 무작위' : '승수가 같은 친구끼리'} · 남은 선수 ${waitingCount()}명`;
  $('history').innerHTML = state.history.slice(0, 6).map((h) => `<div>${esc(h)}</div>`).join('') || '<div>아직 대결이 없어요</div>';
  const tr = state.tracker;
  $('modeInfo').textContent = !tr ? '' : tr.kind === 'sim'
    ? '🧪 시뮬레이션 모드 (가상 선수) · 웹캠을 쓰려면 ⚙️ 처음 화면 → 게임 시작'
    : `📷 ${tr.label}`;
  $('modeInfo').className = `mode-info ${tr && tr.kind === 'sim' ? 'sim' : ''}`;
  const n = state.next;
  const v = $('versus');
  $('fightBtn').disabled = !n;
  $('fightBtn').innerHTML = state.settings.mode === 'random' ? '🎰 돌림판 돌리기! <span class="key">Space</span>' : '⚔️ 대결 시작! <span class="key">Space</span>';
  $('drawBtn').disabled = !n;
  document.querySelector('.lobby-actions').classList.toggle('hidden', !n); // 대결이 없을 땐 아래 버튼 숨김
  if (!n) {
    if (!finished) {
      v.innerHTML = `<div class="stage-msg">🎉 ${state.round}라운드 끝! 모두 한 번씩 대결했어요
        <small>${state.round + 1}라운드는 승수가 같은 친구끼리 만나요 (이긴 친구는 이긴 친구끼리)</small>
        <button id="roundBtn" class="btn btn-go">▶ ${state.round + 1}라운드 시작</button></div>`;
      $('roundBtn').addEventListener('click', () => { sfx.click(); nextRound(); });
    } else {
      const best = standings().teams[0];
      v.innerHTML = `<div class="stage-msg">🏁 모든 대결이 끝났어요!
        <small>1등은 ${esc(best.icon)} ${esc(best.name)}! 시상식으로 가 볼까요?</small>
        <button id="awardsBtn" class="btn btn-go big-btn">🏆 시상식 보기 <span class="key">Space</span></button>
        <small>점수 초기화를 누르면 처음부터 다시 시작해요</small></div>`;
      $('awardsBtn').addEventListener('click', () => { sfx.click(); showAwards(); });
    }
    return;
  }
  // 격투 게임식 VS 카드: 양쪽에서 날아와 쾅!
  v.innerHTML = n.sides.map((s, i) => `<div class="vs-card ${i ? 'r' : 'l'}" style="background:linear-gradient(${i ? 225 : 135}deg,${s.team.grad[0]},${s.team.grad[1]});border-color:${i ? '#c8f6ff' : '#fff3b0'};color:${s.team.ink}">
      <div class="side">${i === 0 ? '⬅ 왼쪽' : '오른쪽 ➡'} · ${esc(s.team.name)}</div>
      ${shield(s.team)}
      <div class="name">${esc(s.member)}</div>
      ${s.helper ? '<div class="helper">🤝 도우미 (기록 안 함)</div>' : ''}
    </div>`).join('') + '<div class="vs-bolt">⚡</div><div class="vs-badge">VS</div>';
  if (roll) {
    v.classList.add('rolling'); setTimeout(() => v.classList.remove('rolling'), 500);
    sfx.whoosh(); setTimeout(() => sfx.slam(), 380);
  }
}

// ---------------- ③ 돌림판 ----------------
const WHEEL = ['dance', 'balloon', 'wall', 'race', 'goalie'];
const WHEEL_COLORS = [['#ff8a6b', '#e8452a'], ['#ffd36b', '#f59f0a'], ['#6fb2ff', '#2a6bff'], ['#5ee8b0', '#13a874'], ['#c49bff', '#7a3dff']];
const SPIN_SEC = 3.4;

function drawWheel(rot, hi = -1, now = performance.now()) {
  const c = $('wheel'), g = c.getContext('2d'), cx = c.width / 2, cy = c.height / 2, R = c.width / 2 - 46;
  const n = WHEEL.length, seg = (Math.PI * 2) / n;
  g.clearRect(0, 0, c.width, c.height);
  // 바깥 테 (보라 + 금색)
  g.beginPath(); g.arc(cx, cy, R + 34, 0, Math.PI * 2); g.fillStyle = '#7a3dff'; g.fill();
  g.beginPath(); g.arc(cx, cy, R + 22, 0, Math.PI * 2); g.fillStyle = '#ffd84d'; g.fill();
  WHEEL.forEach((mode, k) => {
    const a0 = rot + k * seg - Math.PI / 2 - seg / 2; // rot=0일 때 k번 칸 가운데가 맨 위 (rot ≡ -k·seg)
    const grd = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    grd.addColorStop(0, WHEEL_COLORS[k][0]); grd.addColorStop(1, WHEEL_COLORS[k][1]);
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a0 + seg); g.closePath();
    g.fillStyle = grd; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
    if (hi >= 0 && hi !== k) { g.fillStyle = 'rgba(10,6,30,.6)'; g.fill(); }
    g.save();
    g.translate(cx, cy); g.rotate(a0 + seg / 2);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = `${Math.round(R * 0.2)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    g.fillStyle = '#000'; g.fillText(ARCADE_INFO[mode].emoji, R * 0.97, 0);
    g.textAlign = 'center';
    g.font = `${Math.round(R * 0.088)}px "Black Han Sans", Jua, sans-serif`;
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeText(ARCADE_INFO[mode].name, R * 0.5, 0);
    g.fillStyle = '#fff'; g.fillText(ARCADE_INFO[mode].name, R * 0.5, 0);
    g.restore();
  });
  // 깜빡이는 전구
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, on = (Math.floor(now / 160) + k) % 2 === 0;
    const x = cx + Math.cos(a) * (R + 22), y = cy + Math.sin(a) * (R + 22);
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2);
    g.fillStyle = on ? '#fffbe0' : '#b8860b';
    g.shadowColor = on ? '#ffe066' : 'transparent'; g.shadowBlur = on ? 16 : 0;
    g.fill(); g.shadowBlur = 0;
  }
  // 가운데 단추
  g.beginPath(); g.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
  const hub = g.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, R * 0.16); hub.addColorStop(0, '#fff'); hub.addColorStop(1, '#ffd84d');
  g.fillStyle = hub; g.fill(); g.lineWidth = 8; g.strokeStyle = '#7a3dff'; g.stroke();
  g.font = `${Math.round(R * 0.15)}px "Apple Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#000'; g.fillText('🎰', cx, cy + 3);
  // 맨 위 바늘
  g.beginPath(); g.moveTo(cx - 26, 6); g.lineTo(cx + 26, 6); g.lineTo(cx, 62); g.closePath();
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#7a3dff'; g.stroke();
}

// 돌림판으로 이번 판 게임을 정한 뒤 시작 (바로 전 판과 같은 게임은 피함)
function spinAndStart() {
  if (!state.next || state.spinning) return;
  if (state.settings.mode !== 'random') { startMatch(); return; }
  sfx.unlock();
  state.spinning = true;
  const choices = WHEEL.map((_, k) => k).filter((k) => WHEEL[k] !== state.lastMode);
  const pick = choices[Math.floor(Math.random() * choices.length)];
  const TAU = Math.PI * 2, seg = TAU / WHEEL.length;
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const start = state.wheelRot || 0;
  const target = -pick * seg + jitter;
  const total = start + TAU * 6 + ((((target - start) % TAU) + TAU) % TAU);
  const title = $('rouletteTitle');
  title.textContent = '어떤 게임이 나올까요?';
  title.classList.remove('drop');
  $('roulette').classList.remove('hidden');
  const t0 = performance.now();
  let lastSeg = null, finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    state.wheelRot = total % TAU;
    const mode = WHEEL[pick];
    title.textContent = `${ARCADE_INFO[mode].emoji} ${ARCADE_INFO[mode].name}!`;
    title.classList.remove('drop'); void title.offsetWidth; title.classList.add('drop');
    flash(); shake(); sfx.slam(); setTimeout(() => sfx.go(), 150);
    const blink = (now) => { if (!$('roulette').classList.contains('hidden')) { drawWheel(state.wheelRot, pick, now); requestAnimationFrame(blink); } };
    requestAnimationFrame(blink);
    setTimeout(() => {
      $('roulette').classList.add('hidden');
      state.spinning = false;
      if (state.screen === 'lobby') startMatch(mode);
    }, 1700);
  };
  const step = (now) => {
    if (finished) return;
    const k = Math.min(1, (now - t0) / 1000 / SPIN_SEC);
    const rot = start + (total - start) * (1 - (1 - k) ** 4); // 처음엔 빠르게, 끝에서 천천히
    drawWheel(rot, -1, now);
    const sNow = Math.floor((rot + seg / 2) / seg);
    if (sNow !== lastSeg) { lastSeg = sNow; sfx.tick(); }
    if (k >= 1) finish(); else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(finish, SPIN_SEC * 1000 + 600); // 탭이 가려져 애니메이션이 멈춰도 진행
}

// ---------------- ④ 대결 ----------------
function startMatch(mode) {
  if (!state.next) return;
  sfx.unlock();
  const s = state.settings;
  mode = mode || (s.mode in ARCADE_INFO ? s.mode : 'dance');
  state.lastMode = mode;
  state.match = {
    arcade: createArcade(mode, { lives: s.lives, diff: DIFFICULTY[s.difficulty], diffKey: s.difficulty }),
    mode,
    sides: state.next.sides,
    round: state.next.round,
    t0: performance.now(),
    phase: 'countdown',
    lastCount: null,
    lastSec: null,
    elapsed: 0,
    shown: [null, null], // 패널에 마지막으로 그린 생명·점수 (변화 효과용)
  };
  $('hud').classList.remove('frozen');
  $('fever').classList.add('hidden');
  $('timerBox').classList.remove('warn');
  $('gameLabel').textContent = `${ARCADE_INFO[mode].emoji} ${ARCADE_INFO[mode].name}`;
  buildPanels();
  show('play');
}

function buildPanels() {
  const A = state.match.arcade;
  state.match.sides.forEach((side, i) => {
    const el = $(`panel${i}`);
    el.style.borderColor = SIDE_COLORS[i];
    el.style.boxShadow = `0 0 18px ${SIDE_COLORS[i]}44`;
    el.classList.remove('out', 'hit');
    el.innerHTML = `<div class="top"><span class="name" style="color:${SIDE_COLORS[i]}">${esc(side.member)}</span>
        <span class="team" style="background:${side.team.color};color:#fff">${shield(side.team)}${esc(side.team.name)}</span>
        <span class="score" style="color:${SIDE_COLORS[i]}"></span></div>
      <div class="hearts${A.usesLives ? '' : ' hidden'}"></div>
      <div class="status"></div>`;
  });
}

function updateArcadePanels() {
  const m = state.match, A = m.arcade;
  A.players.forEach((p, i) => {
    const el = $(`panel${i}`);
    const prev = m.shown[i];
    // 하트: 잃은 순간 깨지는 애니메이션
    if (!prev || prev.lives !== p.lives) {
      const hearts = el.querySelector('.hearts');
      hearts.innerHTML = Array.from({ length: state.settings.lives }, (_, k) => {
        const lost = k >= p.lives, breaking = prev && lost && k < prev.lives;
        return `<span class="${lost ? 'lost' : ''}${breaking ? ' breaking' : ''}">${breaking ? '💔' : '❤️'}</span>`;
      }).join('');
    }
    const sc = el.querySelector('.score'), txt = A.scoreText(i);
    if (sc.textContent !== txt) {
      sc.textContent = txt;
      if (prev) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
    }
    const st = A.status(i) || ['ok', '좋아요! 계속! 💪'];
    const s = el.querySelector('.status');
    s.className = `status ${st[0]}`;
    s.textContent = st[1];
    m.shown[i] = { lives: p.lives };
  });
}

function arcadeHit(i, text) {
  sfx.hit();
  shake();
  const el = $(`panel${i}`);
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  big(`💔 ${state.match.sides[i].member}: ${text}`, 1100, '7vh');
}

function tickMatch(now, dt, people) {
  const m = state.match, s = state.settings, A = m.arcade;
  const W = state.tracker.width, H = state.tracker.height;
  const since = (now - m.t0) / 1000;
  if (m.phase === 'countdown') {
    const left = Math.ceil(COUNTDOWN - since);
    if (left !== m.lastCount) {
      m.lastCount = left;
      if (left > 0) { big(String(left), 0, '34vh'); sfx.tick(); } else { big('시작!', 0, '24vh'); sfx.go(); flash(); }
    }
    A.tick(0, dt, people, W, H, false, s.roundSec);
    $('roundTime').textContent = s.roundSec;
    $('poseBar').style.width = '100%';
    $('posePhase').textContent = '곧 시작해요! 몸이 화면에 보이게 서요';
    updateArcadePanels();
    if (since >= COUNTDOWN) { m.phase = 'play'; m.tPlay = now; setTimeout(hideBig, 700); }
    return;
  }
  if (m.phase !== 'play') return;
  const t = (now - m.tPlay) / 1000;
  m.elapsed = t;
  A.tick(t, dt, people, W, H, true, s.roundSec);
  for (const e of A.events.splice(0)) {
    if (e.kind === 'hit') arcadeHit(e.i, e.text);
    else if (e.kind === 'freeze') { big('얼음! 🧊', 900, '18vh'); flash(); }
    else if (e.kind === 'unfreeze') big('땡! 💃', 800, '16vh');
    else if (e.kind === 'fever') { big('🔥 피버 타임! 🔥', 1200, '13vh'); flash(); }
  }
  $('hud').classList.toggle('frozen', !!A.frozen);
  $('fever').classList.toggle('hidden', !A.fever);
  const left = Math.max(0, Math.ceil(s.roundSec - t));
  $('roundTime').textContent = left;
  // 10초 남으면 타이머가 빨갛게 두근두근 + 째깍
  $('timerBox').classList.toggle('warn', left <= 10);
  if (left !== m.lastSec) { if (left <= 10 && left > 0) sfx.tick(); m.lastSec = left; }
  $('poseBar').style.width = `${Math.max(0, 100 - (t / s.roundSec) * 100)}%`;
  $('posePhase').textContent = A.phaseText();
  updateArcadePanels();
  const outs = A.outs();
  outs.forEach((o, i) => $(`panel${i}`).classList.toggle('out', o));
  const ended = A.endsOnOut ? outs[0] || outs[1] : outs[0] && outs[1];
  if (ended || A.winnerEarly() >= 0 || t >= s.roundSec) finishMatch(outs, t >= s.roundSec);
}

// 게임마다 점수 크기가 달라서, 팀 점수에 더할 때는 한 판을 0~100점으로 맞춘다
const WIN_BONUS = 20;
function gamePoints(m, i) {
  const raw = { dance: 0.2, balloon: 0.13, wall: 6, race: 1, goalie: 4 }[m.mode] * m.arcade.players[i].score;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function finishMatch(outs, timeUp) {
  const m = state.match;
  m.phase = 'done';
  const A = m.arcade;
  if (!A.endsOnOut) outs = [false, false]; // 막춤: 생명을 다 잃어도 멈춘 점수로 겨룬다
  let winner = -1, reason = '';
  if (A.winnerEarly() >= 0) { winner = A.winnerEarly(); reason = '먼저 결승선에 들어왔어요! 🏁'; }
  else if (outs[0] && outs[1]) { winner = -1; reason = '둘 다 동시에 생명을 모두 잃었어요'; }
  else if (outs[0] || outs[1]) { winner = outs[0] ? 1 : 0; reason = '상대가 생명을 모두 잃었어요'; }
  else {
    const sa = Math.floor(A.players[0].score), sb = Math.floor(A.players[1].score);
    const more = { race: '더 많이 달렸어요', goalie: '더 많이 막았어요', wall: '벽을 더 많이 통과했어요' }[m.mode] || '점수가 더 높아요';
    if (sa !== sb) { winner = sa > sb ? 0 : 1; reason = `시간 종료! ${more}`; }
    else { winner = -1; reason = '시간 종료! 완전 막상막하예요'; }
  }

  const sides = m.sides;
  // 한쪽이 끝까지 한 번도 안 나왔으면 연습 경기: 기록·팀 점수 없이 같은 대결을 다시 대기
  const empty = A.players.map((p) => !p.everSeen);
  if (empty[0] || empty[1]) {
    state.next = { sides, round: m.round };
    state.board = null;
    big('끝!', 900, '26vh');
    setTimeout(() => showResult({
      sub: '🧪 연습 경기 끝!', title: '연습 끝!', reason: '한 명만 있어서 기록하지 않았어요. 두 명이 서면 정식 대결이 돼요',
      cards: sides.map((sd, i) => ({ sd, i, empty: empty[i] })), winner: -1, A,
    }), 900);
    return;
  }
  const helperIdx = sides.findIndex((sd) => sd.helper);
  // 점수판 애니메이션용: 반영 전 팀 점수
  const before = activeTeams().map((t) => ({ t, score: t.score, games: t.games }));
  // 게임 점수(0~100, 게임마다 크기를 맞춤) + 승리 보너스를 내 팀 점수에 더한다. 도우미는 기록·팀 점수 없음
  const gp = sides.map((sd, i) => gamePoints(m, i));
  const earned = sides.map((sd, i) => (sd.helper ? 0 : gp[i] + (winner === i ? WIN_BONUS : 0)));
  sides.forEach((sd, i) => {
    sd.team.played++;
    if (sd.helper) return;
    const r = rec(sd.team, sd.member);
    r.games++;
    r.points += earned[i];
    if (winner === i) r.wins++;
    sd.team.score += earned[i];
    sd.team.games = (sd.team.games || 0) + 1;
  });
  state.board = { before, gains: sides.map((sd, i) => ({ team: sd.team, gain: earned[i], helper: !!sd.helper })) };
  const label = (i) => `${sides[i].member}(${sides[i].team.name})${i === helperIdx ? '[도우미]' : ` +${earned[i]}`}`;
  const tag = `${ARCADE_INFO[m.mode].emoji} `;
  state.history.unshift(winner >= 0 ? `${tag}🏆 ${label(winner)} 승 · ${label(1 - winner)}` : `${tag}🤝 ${label(0)} · ${label(1)} 무승부`);
  if (tourneyDone()) state.history.unshift('🏁 대회 끝!');
  state.next = null;
  save();

  big('끝!', 900, '26vh');
  setTimeout(() => showResult({
    sub: winner >= 0 ? '🏆 승리!' : '🤝 무승부!',
    title: winner >= 0 ? `${sides[winner].member} WIN!` : 'DRAW!',
    reason, winner, A, helperIdx, gp, earned,
    cards: sides.map((sd, i) => ({ sd, i })),
  }), 900);
}

// ---------------- ⑤ 결과 화면 ----------------
function countUp(el, to, ms = 900, prefix = '', suffix = '') {
  const t0 = performance.now();
  const stepF = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = `${prefix}${Math.round(to * (1 - (1 - k) ** 3))}${suffix}`;
    if (k < 1) { if (Math.random() < 0.4) sfx.count(); requestAnimationFrame(stepF); }
  };
  requestAnimationFrame(stepF);
  setTimeout(() => { el.textContent = `${prefix}${to}${suffix}`; }, ms + 50); // 탭이 가려져도 최종값
}
function confetti(n = 90) {
  const box = $('confetti');
  box.innerHTML = '';
  const cols = ['#ffd84d', '#ff4fa3', '#3ee6ff', '#7dff6b', '#ff8a00', '#ffffff', '#b38bff'];
  for (let k = 0; k < n; k++) {
    const s = document.createElement('i');
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = cols[k % cols.length];
    s.style.animationDuration = `${2.2 + Math.random() * 2.2}s`;
    s.style.animationDelay = `${Math.random() * 0.8}s`;
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(s);
  }
}
function showResult({ sub, title, reason, cards, winner, A, helperIdx = -1, gp = [], earned = [] }) {
  $('resultSub').textContent = sub;
  $('resultTitle').textContent = title;
  $('resultReason').textContent = reason;
  const order = winner >= 0 ? [winner, 1 - winner] : [0, 1];
  $('resultBody').innerHTML = order.map((i) => {
    const { sd, empty } = cards[i];
    const cls = winner === i ? 'win' : winner >= 0 ? 'lose' : '';
    const lives = A.usesLives ? `<div class="line"><span>남은 생명</span><b>${'❤️'.repeat(A.players[i].lives) || '없음'}</b></div>` : '';
    let body;
    if (empty) body = '<div class="detail">빈 자리</div>';
    else if (i === helperIdx) body = `<div class="line"><span>게임 기록</span><b>${A.scoreText(i)}</b></div><div class="cheer">🤝 도우미 고마워요! (기록 안 함)</div>`;
    else if (!gp.length) body = `<div class="line"><span>게임 기록</span><b>${A.scoreText(i)}</b></div>${lives}<div class="detail">${A.detail(i)}</div>`;
    else body = `<div class="line"><span>게임 기록</span><b>${A.scoreText(i)}</b></div>${lives}
        <div class="line"><span>게임 점수</span><b>${gp[i]}</b></div>
        ${winner === i ? `<div class="line"><span>승리 보너스</span><b style="color:#7dff6b">+${WIN_BONUS}</b></div>` : ''}
        <div class="detail">${A.detail(i)}</div>
        <div class="gain" data-gain="${earned[i]}">팀 +0점</div>
        ${winner >= 0 && winner !== i ? '<div class="cheer">수고했어요! 다음엔 이길 수 있어요 💪</div>' : ''}`;
    return `<div class="rcard ${cls}"><div class="head">${shield(sd.team)}<div><div class="nm">${esc(sd.member)}</div><div class="tm">${esc(sd.team.name)}</div></div>${winner === i ? '<div class="crown">👑</div>' : ''}</div>${body}</div>`;
  }).join('');
  $('resultBody').style.gridTemplateColumns = winner >= 0 ? '1.15fr 1fr' : '1fr 1fr';
  show('result');
  if (winner >= 0) { confetti(); sfx.win(); } else $('confetti').innerHTML = '';
  // 팀에 더해지는 점수가 0부터 착착 올라간다
  setTimeout(() => document.querySelectorAll('#resultBody .gain').forEach((el) => countUp(el, +el.dataset.gain, 900, '팀 +', '점')), 500);
}

// ---------------- ⑤-2 팀 점수판: 점수 반영 · 순위 변동 ----------------
const ROW_H = 84;
function showRankboard() {
  const b = state.board;
  state.board = null;
  const teams = activeTeams();
  const gain = new Map(teams.map((t) => [t, 0]));
  const games = new Map(teams.map((t) => [t, 0]));
  for (const g of b.gains) if (!g.helper) { gain.set(g.team, gain.get(g.team) + g.gain); games.set(g.team, games.get(g.team) + 1); }
  const start = new Map(b.before.map((x) => [x.t, x]));
  const cur = (t, k) => { const s = start.get(t); const sc = Math.round(s.score + gain.get(t) * k); const gm = s.games + games.get(t); return { score: sc, avg: gm ? Math.round(sc / gm) : 0 }; };
  const box = $('rankAnim');
  box.innerHTML = '';
  box.style.height = `${teams.length * ROW_H}px`;
  const startOrder = teams.slice().sort((x, y) => { const a = start.get(x), c = start.get(y); return (c.games ? c.score / c.games : 0) - (a.games ? a.score / a.games : 0) || c.score - a.score; });
  const startRank = new Map(startOrder.map((t, r) => [t, r]));
  const rows = new Map(teams.map((t) => {
    const d = document.createElement('div');
    d.className = 'rank';
    box.appendChild(d);
    return [t, d];
  }));
  const render = (k) => {
    const vals = new Map(teams.map((t) => [t, k === 0 ? { score: start.get(t).score, avg: start.get(t).games ? Math.round(start.get(t).score / start.get(t).games) : 0 } : cur(t, k)]));
    const order = teams.slice().sort((x, y) => vals.get(y).avg - vals.get(x).avg || vals.get(y).score - vals.get(x).score);
    order.forEach((t, r) => {
      const d = rows.get(t);
      d.style.top = `${r * ROW_H}px`;
      d.classList.toggle('first', r === 0);
      const extras = [...d.querySelectorAll('.gainpop, .upmark')];
      d.innerHTML = rankRow(t, r, vals.get(t).avg, vals.get(t).score);
      extras.forEach((x) => d.appendChild(x));
    });
    return order;
  };
  let order = render(0);
  show('rankboard');
  const gainers = teams.filter((t) => gain.get(t) > 0);
  setTimeout(() => {
    gainers.forEach((t) => {
      const d = rows.get(t);
      d.classList.add('glow');
      const p = document.createElement('div'); p.className = 'gainpop'; p.textContent = `+${gain.get(t)}점`; d.appendChild(p);
    });
    const t0 = performance.now(), ms = 1400;
    const stepF = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const prevOrder = order;
      order = render(k);
      if (order.some((t, r) => prevOrder[r] !== t)) sfx.whoosh();
      if (k < 1) { if (Math.random() < 0.5) sfx.count(); requestAnimationFrame(stepF); } else done();
    };
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      order = render(1);
      teams.forEach((t) => rows.get(t).classList.remove('glow'));
      // 순위가 올라간 팀에 "순위 UP!"
      let up = false;
      order.forEach((t, r) => {
        if (r < startRank.get(t)) {
          up = true;
          const u = document.createElement('div'); u.className = 'upmark'; u.textContent = '▲ 순위 UP!'; rows.get(t).appendChild(u);
        }
      });
      if (up) sfx.levelup();
    };
    requestAnimationFrame(stepF);
    setTimeout(done, ms + 300); // 탭이 가려져도 끝까지
  }, 600);
}

function afterResult() {
  sfx.click();
  state.match = null;
  if (state.board) { showRankboard(); return; }
  toLobby();
}
function toLobby() {
  if (state.next) renderLobby(); else drawNext(); // 연습 경기였으면 같은 대결 그대로
  show('lobby');
}

// ---------------- ⑥ 시상식 ----------------
function showAwards() {
  const st = standings();
  const best = st.teams[0], second = st.teams[1];
  const tie = second && teamAvg(second) === teamAvg(best) && second.score === best.score;
  $('awardTeam').textContent = tie ? '🤝 공동 우승!' : `${best.icon} ${best.name}`;
  $('awardInfo').textContent = tie
    ? `${best.icon} ${best.name} · ${second.icon} ${second.name} (평균 ${teamAvg(best)}점)`
    : `팀원 평균 ${teamAvg(best)}점 · 합계 ${best.score.toLocaleString()}점`;
  const spots = [1, 0, 2].map((r) => {
    const p = st.top[r];
    if (!p) return '';
    return `<div class="spot p${r + 1}">
      ${r === 0 ? '<div style="font-size:46px">👑</div>' : ''}
      ${shield(p.team, r === 0 ? 'width:78px;height:88px;font-size:46px' : 'width:60px;height:68px;font-size:34px')}
      <div class="who" style="${r === 0 ? 'font-family:var(--title);font-size:30px;color:#ffd84d' : ''}">${esc(p.member)}${r === 0 ? ' · 점수왕' : ''}</div>
      <div class="pts">${esc(p.team.name)} · ${p.r.points}점</div>
      <div class="block">${r + 1}</div></div>`;
  }).join('');
  $('podium').innerHTML = spots;
  show('awards');
  sfx.fanfare();
}

function abortMatch() {
  if (!state.match) return;
  state.next = { sides: state.match.sides, round: state.match.round };
  state.match = null;
  renderLobby();
  show('lobby');
}

// ---------------- 큰 글씨 ----------------
let bigTimer = 0;
function big(text, ms = 0, size = '') {
  const el = $('bigText');
  el.textContent = text;
  el.style.fontSize = size;
  el.classList.remove('hidden', 'pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(bigTimer);
  if (ms) bigTimer = setTimeout(hideBig, ms);
}
function hideBig() { $('bigText').classList.add('hidden'); }

// ---------------- 그리기 ----------------
const stage = $('stage');
const ctx = stage.getContext('2d');

function assignSides(list) {
  const withX = list.map((lms) => ({ lms, x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2 }));
  const out = [null, null];
  if (withX.length >= 2) {
    withX.sort((a, b) => a.x - b.x);
    out[0] = withX[0].lms; out[1] = withX[1].lms;
  } else if (withX.length === 1) {
    out[withX[0].x < 0.5 ? 0 : 1] = withX[0].lms;
  }
  return out;
}

// 스켈레톤 그리기: 은은한 네온 빛 (화면 밖이라 안 보이는 부위는 회색 점선)
function drawSkeleton(lms, color, W, H) {
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = { x: (lms[LM.lShoulder].x + lms[LM.rShoulder].x) / 2 * W, y: (lms[LM.lShoulder].y + lms[LM.rShoulder].y) / 2 * H };
  const hp = { x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2 * W, y: (lms[LM.lHip].y + lms[LM.rHip].y) / 2 * H };
  const torso = Math.max(20, Math.hypot(sh.x - hp.x, sh.y - hp.y));
  const lw = Math.max(5, torso * 0.07);
  const n = P(LM.nose);
  const headR = torso * 0.24;
  const line = (a, b) => { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = lw + 6;
  for (const [a, b] of BONES) line(a, b);
  ctx.lineWidth = lw;
  ctx.shadowColor = color; ctx.shadowBlur = lw * 2.2;
  for (const [a, b] of BONES) {
    if (lms[b].est) { // 화면 밖이라 허벅지 방향으로 이어 그린 정강이
      ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = color; line(a, b); ctx.restore();
      continue;
    }
    if (!seenLm(lms[a]) || !seenLm(lms[b])) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.setLineDash([lw * 1.2, lw * 1.2]);
      ctx.strokeStyle = 'rgba(200,200,200,0.6)';
      line(a, b);
      ctx.restore();
      continue;
    }
    ctx.strokeStyle = color;
    line(a, b);
  }
  ctx.beginPath(); ctx.arc(n.x, n.y, headR, 0, Math.PI * 2);
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = color; ctx.stroke();
  ctx.shadowBlur = 0;
  for (const i of JOINTS) {
    const p = P(i);
    ctx.beginPath(); ctx.arc(p.x, p.y, lw * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
  }
  ctx.restore();
}

let lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  const tr = state.tracker;
  if (!tr) { ctx.fillStyle = '#0d0a24'; ctx.fillRect(0, 0, stage.width, stage.height); return; }

  const W = tr.width, H = tr.height;
  if (stage.width !== W || stage.height !== H) { stage.width = W; stage.height = H; }
  tr.drawFrame(ctx, W, H);

  let people = [null, null];
  try { people = assignSides(tr.detect(now)).map(extendLegs); } catch (e) { console.error(e); }
  state.people = people;

  // 가운데 구분선
  ctx.save();
  ctx.setLineDash([18, 14]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.restore();

  const m = state.match;
  if (state.screen === 'play' && m) tickMatch(now, dt, people);

  const A = state.screen === 'play' && m ? m.arcade : null;
  people.forEach((lms, i) => {
    if (!lms) return;
    if (!A || !A.ownSkeleton) drawSkeleton(lms, SIDE_COLORS[i], W, H);
  });
  if (A) A.draw(ctx, W, H);

  if (state.screen === 'lobby') {
    people.forEach((p, i) => {
      const el = $(`pres${i}`);
      el.textContent = `${i ? '오른쪽' : '왼쪽'} 선수 ${p ? '✅ 보여요' : '⏳ 찾는 중'}`;
      el.className = `chip ${p ? 'ok' : 'wait'}`;
    });
  }
}

// ---------------- 이벤트 ----------------
function openModal(id) { sfx.click(); renderSetup(); $(id).classList.remove('hidden'); }
function closeModals() { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); readSetup(); renderChips(); }
function bind() {
  // 칩 버튼: 숨은 선택 상자 값을 바꾼다
  document.querySelectorAll('.chips[data-for]').forEach((box) => box.addEventListener('click', (e) => {
    const b = e.target.closest('button.chip');
    if (!b) return;
    sfx.click();
    $(box.dataset.for).value = b.dataset.v;
    readSetup();
    renderChips();
    if (box.dataset.for === 'teamCount') renderTeams();
  }));
  $('teamsBtn').addEventListener('click', () => openModal('teamModal'));
  $('optsBtn').addEventListener('click', () => openModal('optModal'));
  document.querySelectorAll('.close-modal').forEach((b) => b.addEventListener('click', () => { sfx.click(); closeModals(); }));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
  $('startBtn').addEventListener('click', () => { sfx.click(); startApp(false); });
  $('simBtn').addEventListener('click', () => { sfx.click(); startApp(true); });
  $('drawBtn').addEventListener('click', () => { sfx.click(); drawNext(); });
  $('fightBtn').addEventListener('click', () => { sfx.click(); spinAndStart(); });
  $('nextBtn').addEventListener('click', afterResult);
  $('rankNextBtn').addEventListener('click', () => { sfx.click(); toLobby(); });
  $('awardsBackBtn').addEventListener('click', () => { sfx.click(); show('lobby'); });
  $('settingsBtn').addEventListener('click', () => { sfx.click(); renderSetup(); show('setup'); });
  $('resetScoreBtn').addEventListener('click', () => {
    if (!confirm('모든 팀 점수와 기록을 지우고, 모든 선수를 다시 뽑을 수 있게 할까요?')) return;
    state.teams.forEach((t) => { t.score = 0; t.played = 0; t.games = 0; });
    state.round = 1;
    state.recs = {};
    state.history = [];
    state.board = null;
    save(); drawNext();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.screen === 'lobby') {
        if (state.next) spinAndStart();
        else ($('roundBtn') || $('awardsBtn'))?.click();
      } else if (state.screen === 'result') $('nextBtn').click();
      else if (state.screen === 'rankboard') $('rankNextBtn').click();
      else if (state.screen === 'awards') $('awardsBackBtn').click();
    } else if (e.code === 'KeyR' && state.screen === 'lobby' && !state.spinning) drawNext();
    else if (e.code === 'Escape' && state.screen === 'play') abortMatch();
  });
}

load();
renderSetup();
bind();
show('setup');
requestAnimationFrame(frame);
refreshCameras();
navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);

// 디버그용
window.__game = state;
