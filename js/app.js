// 얼음! 자세 버티기 - 메인 게임 흐름
import { BONES, JOINTS, LM } from './poses.js';
import { DIFFICULTY, seenLm } from './judge.js';
import { CameraTracker, listCameras } from './tracker.js';
import { SimTracker } from './sim.js';
import { sfx } from './sound.js';
import { ARCADE_INFO, createArcade } from './arcade.js';

const $ = (id) => document.getElementById(id);
const TEAM_PRESETS = [
  { name: '호랑이팀', color: '#ff6b4a' },
  { name: '독수리팀', color: '#3d8bff' },
  { name: '돌고래팀', color: '#18a874' },
  { name: '판다팀', color: '#9b59ff' },
];
const SIDE_COLORS = ['#ffd84d', '#4de1ff'];
const COUNTDOWN = 3;   // 시작 카운트다운(초)
const STORE_KEY = 'posequiz-v1';

// ---------------- 상태 ----------------
const state = {
  settings: { teamCount: 2, lives: 3, roundSec: 45, rounds: 1, difficulty: 'normal', model: 'lite', cameraId: '', mode: 'random', v: 2 },
  teams: TEAM_PRESETS.map((t) => ({ ...t, membersText: '', score: 0, played: 0, games: 0, done: [] })),
  history: [],
  // 대회: 라운드마다 모든 학생이 정확히 한 번씩 대결 (스위스 방식)
  round: 1,
  recs: {},   // '팀번호|이름' → { wins, games, points }
  screen: 'setup',
  tracker: null,
  next: null,    // 다음 대결 {sides:[{team, member}]}
  match: null,
  people: [null, null],
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state.settings, d.settings || {});
    if (!(state.settings.mode in ARCADE_INFO)) state.settings.mode = 'random'; // 없어진 게임(자세 버티기 등)
    if (!d.settings || d.settings.v !== 2) { state.settings.mode = 'random'; state.settings.v = 2; } // 돌림판이 생기면서 기본값을 바꿈
    (d.teams || []).forEach((t, i) => { if (state.teams[i]) Object.assign(state.teams[i], t); });
    state.history = d.history || [];
    if (d.recs && typeof d.recs === 'object') state.recs = d.recs;
    if (d.round >= 1) state.round = d.round;
  } catch { /* 저장소를 못 쓰는 환경이면 무시 */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: state.settings,
      teams: state.teams.map(({ name, color, membersText, score, played, games }) => ({ name, color, membersText, score, played, games })),
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

// ---------------- 화면 전환 ----------------
function show(screen) {
  state.screen = screen;
  for (const s of ['setup', 'lobby', 'result']) $(s).classList.toggle('hidden', s !== screen);
  $('hud').classList.toggle('hidden', screen !== 'play');
  document.body.classList.toggle('playing', screen === 'play');
  if (screen !== 'play') hideBig();
}

// ---------------- 설정 화면 ----------------
function renderSetup() {
  const s = state.settings;
  for (const k of ['mode', 'teamCount', 'lives', 'roundSec', 'rounds', 'difficulty', 'model']) $(k).value = String(s[k]);
  const box = $('teams');
  box.innerHTML = '';
  activeTeams().forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'team-edit';
    div.style.borderColor = t.color;
    div.innerHTML = `<input data-i="${i}" class="tname" style="color:${t.color}" />
      <textarea data-i="${i}" class="tmembers" placeholder="민수&#10;지우&#10;서연"></textarea>`;
    div.querySelector('.tname').value = t.name;
    div.querySelector('.tmembers').value = t.membersText;
    box.appendChild(div);
  });
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
  document.querySelectorAll('.tmembers').forEach((el) => {
    const t = state.teams[+el.dataset.i];
    t.membersText = el.value;
  });
  save();
}

// 설정 화면의 카메라 선택 목록 채우기
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
    msg.style.color = 'var(--bad)';
    const n = e && e.name;
    msg.textContent =
      n === 'NotAllowedError' ? '카메라 권한이 거부됐어요. 주소창 왼쪽의 아이콘을 눌러 카메라를 "허용"으로 바꾼 뒤 다시 눌러 주세요. (Mac은 시스템 설정 → 개인정보 보호 → 카메라에서 Chrome도 켜져 있어야 해요)'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? '선택한 카메라를 찾지 못했어요. 케이블을 확인하고 카메라 목록에서 다시 골라 주세요.'
      : n === 'NotReadableError' ? '다른 프로그램(줌, 팀즈, 다른 탭 등)이 카메라를 쓰고 있어요. 그 프로그램을 끄고 다시 눌러 주세요.'
      : `카메라/모델을 시작하지 못했어요: ${(e && e.message) || e}`;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------------- 대기실 ----------------
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
  const top = players.slice().sort((a, b) => b.r.points - a.r.points).slice(0, 3);
  const perfect = players.filter((p) => p.r.games > 0 && p.r.wins === p.r.games);
  const teams = activeTeams().slice().sort(byAvg);
  return { top, perfect, teams };
}

function renderLobby(roll = false) {
  const sb = $('scoreboard');
  sb.innerHTML = activeTeams()
    .slice().sort(byAvg)
    .map((t) => {
      const sub = `합계 ${t.score}점 · ${t.games}판 · 남은 ${waiting(t).length}명`;
      return `<div class="team-score" style="background:${t.color}"><span>${esc(t.name)}<small>${sub}</small></span><b>평균 ${teamAvg(t)}점</b></div>`;
    }).join('');
  const R = state.settings.rounds;
  const finished = tourneyDone();
  $('stageInfo').innerHTML = finished
    ? '<b>🏁 대회 끝!</b>'
    : `<b>${state.round}라운드</b> / ${R} · ${state.round === 1 ? '무작위로, 다른 팀끼리' : '승수가 같은 친구끼리'} (남은 ${waitingCount()}명)`;
  $('stageInfo').className = `stage-info ${finished ? 'done' : ''}`;
  $('history').innerHTML = state.history.slice(0, 8).map((h) => `<li>${esc(h)}</li>`).join('') || '<li>아직 대결이 없어요</li>';
  const tr = state.tracker;
  $('modeInfo').textContent = !tr ? '' : tr.kind === 'sim'
    ? '🧪 시뮬레이션 모드 (가상 선수) · 웹캠을 쓰려면 ⚙️ 설정 → 카메라 켜고 시작'
    : `📷 ${tr.label}`;
  $('modeInfo').className = `mode-info ${tr && tr.kind === 'sim' ? 'sim' : ''}`;
  const n = state.next;
  const v = $('versus');
  $('fightBtn').disabled = !n;
  $('fightBtn').innerHTML = state.settings.mode === 'random' ? '🎰 돌림판 돌리고 시작! <kbd>Space</kbd>' : '대결 시작! <kbd>Space</kbd>';
  $('drawBtn').disabled = !n;
  if (!n) {
    if (!finished) {
      v.innerHTML = `<div class="stage-msg">🎉 ${state.round}라운드 끝! 모두 한 번씩 대결했어요<br>
        <small>${state.round + 1}라운드는 승수가 같은 친구끼리 만나요 (이긴 친구는 이긴 친구끼리)</small>
        <button id="roundBtn" class="primary">▶ ${state.round + 1}라운드 시작</button></div>`;
      $('roundBtn').addEventListener('click', nextRound);
    } else {
      const st = standings();
      const best = st.teams[0];
      const tie = st.teams[1] && teamAvg(st.teams[1]) === teamAvg(best);
      v.innerHTML = `<div class="stage-msg">
        ${tie ? '🤝 공동 우승!' : `🏆 우승 팀<div class="champ" style="background:${best.color}">${esc(best.name)}<small>평균 ${teamAvg(best)}점 · 합계 ${best.score}점</small></div>`}
        <div class="awards${state.settings.rounds > 1 ? '' : ' one'}">
          <div><b>🏅 점수왕 (${state.settings.rounds > 1 ? '점수 합계' : '점수 순위'})</b>${st.top.map((p, i) => `<span>${['🥇', '🥈', '🥉'][i]} ${esc(p.member)} <em>${esc(p.team.name)} · ${p.r.points}점</em></span>`).join('')}</div>
          ${state.settings.rounds > 1 ? `<div><b>⭐ 전승</b>${st.perfect.length ? st.perfect.map((p) => `<span>${esc(p.member)} <em>${esc(p.team.name)}</em></span>`).join('') : '<span>없음</span>'}</div>` : ''}
        </div>
        <small>점수 초기화를 누르면 처음부터 다시 시작해요</small></div>`;
    }
    return;
  }
  v.innerHTML = n.sides.map((s, i) => `<div class="who" style="background:${s.team.color};box-shadow:0 0 0 4px ${SIDE_COLORS[i]}">
      <div class="team">${i === 0 ? '⬅ 왼쪽' : '오른쪽 ➡'} · ${esc(s.team.name)}</div>
      <div class="name">${esc(s.member)}</div></div>`).join('<div class="vs">VS</div>');
  if (roll) { v.classList.add('rolling'); setTimeout(() => v.classList.remove('rolling'), 500); sfx.tick(); }
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------- 대결 ----------------
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
    elapsed: 0,
  };
  $('hud').classList.add('arcade');
  $('hud').classList.toggle('race', mode === 'race');
  $('hud').classList.remove('frozen');
  const gc = $('ghost');
  if (gc.width !== 720 || gc.height !== 200) { gc.width = 720; gc.height = 200; }
  buildPanels();
  setArcadeCard();
  show('play');
}

// ---------------- 🎰 게임 돌림판 ----------------
const WHEEL = ['dance', 'balloon', 'wall', 'race', 'goalie'];
const WHEEL_COLORS = ['#ff6b4a', '#ffb020', '#3d8bff', '#18a874', '#9b59ff'];
const SPIN_SEC = 3.4;

function drawWheel(rot, hi = -1) {
  const c = $('wheel'), g = c.getContext('2d'), R = c.width / 2 - 10, cx = c.width / 2, cy = c.height / 2;
  const n = WHEEL.length, seg = (Math.PI * 2) / n;
  g.clearRect(0, 0, c.width, c.height);
  WHEEL.forEach((mode, k) => {
    const a0 = rot + k * seg - Math.PI / 2 - seg / 2; // rot=0일 때 k번 칸 가운데가 맨 위 (rot ≡ -k·seg)
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a0 + seg); g.closePath();
    g.fillStyle = WHEEL_COLORS[k]; g.globalAlpha = hi < 0 || hi === k ? 1 : 0.35; g.fill();
    g.globalAlpha = 1; g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    g.save();
    g.translate(cx, cy); g.rotate(a0 + seg / 2);
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.font = `${Math.round(R * 0.2)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    g.fillText(MODE_INFO[mode].emoji, R * 0.93, 0);
    g.font = `${Math.round(R * 0.1)}px Jua, sans-serif`;
    g.fillText(MODE_INFO[mode].name, R * 0.7, 0);
    g.restore();
  });
  g.beginPath(); g.arc(cx, cy, R * 0.13, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.font = `${Math.round(R * 0.13)}px "Apple Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('🎰', cx, cy + 2);
  // 맨 위 바늘
  g.beginPath(); g.moveTo(cx - 22, 2); g.lineTo(cx + 22, 2); g.lineTo(cx, 46); g.closePath();
  g.fillStyle = '#1d2433'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
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
  $('rouletteTitle').textContent = '어떤 게임이 나올까요? 🎰';
  $('roulette').classList.remove('hidden');
  const t0 = performance.now();
  let lastSeg = null, finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    state.wheelRot = total % TAU;
    drawWheel(state.wheelRot, pick);
    const mode = WHEEL[pick];
    $('rouletteTitle').textContent = `${MODE_INFO[mode].emoji} ${MODE_INFO[mode].name}!`;
    sfx.go();
    setTimeout(() => {
      $('roulette').classList.add('hidden');
      state.spinning = false;
      if (state.screen === 'lobby') startMatch(mode);
    }, 1600);
  };
  const step = (now) => {
    if (finished) return;
    const k = Math.min(1, (now - t0) / 1000 / SPIN_SEC);
    const rot = start + (total - start) * (1 - (1 - k) ** 4); // 처음엔 빠르게, 끝에서 천천히
    drawWheel(rot);
    const sNow = Math.floor((rot + seg / 2) / seg);
    if (sNow !== lastSeg) { lastSeg = sNow; sfx.tick(); }
    if (k >= 1) finish(); else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(finish, SPIN_SEC * 1000 + 600); // 탭이 가려져 애니메이션이 멈춰도 진행
}

function buildPanels() {
  const A = state.match.arcade;
  state.match.sides.forEach((side, i) => {
    const el = $(`panel${i}`);
    el.style.borderColor = SIDE_COLORS[i];
    el.classList.remove('out');
    el.classList.add('simple');
    el.innerHTML = `<div class="pcol">
        <div class="who"><span class="pname">${esc(side.member)}</span><span class="pteam" style="color:${side.team.color}">● ${esc(side.team.name)}</span><span class="pscore"></span></div>
        <div class="hearts${A.usesLives ? '' : ' hidden'}"></div>
        <div class="status"></div>
      </div>`;
  });
}

// ---------------- 미니게임 진행 ----------------
function setArcadeCard() {
  const info = ARCADE_INFO[state.match.mode];
  $('poseEmoji').textContent = info.emoji;
  $('poseName').textContent = info.name;
  $('poseHint').textContent = info.hint;
}

function updateArcadePanels() {
  const A = state.match.arcade;
  A.players.forEach((p, i) => {
    const el = $(`panel${i}`);
    el.querySelector('.hearts').innerHTML = Array.from({ length: p.lives > 0 || A.usesLives ? state.settings.lives : 0 }, (_, k) => `<span class="${k < p.lives ? '' : 'lost'}">❤️</span>`).join('');
    el.querySelector('.pscore').textContent = A.scoreText(i);
    const st = A.status(i) || ['ok', '좋아요! 계속! 💪'];
    const s = el.querySelector('.status');
    s.className = `status ${st[0]}`;
    s.textContent = st[1];
  });
}

function arcadeHit(i, text) {
  sfx.hit();
  const el = $(`panel${i}`);
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  big(`💔 ${state.match.sides[i].member}: ${text}`, 1200, '6vh');
}

function tickMatch(now, dt, people) {
  const m = state.match, s = state.settings, A = m.arcade;
  const W = state.tracker.width, H = state.tracker.height;
  const since = (now - m.t0) / 1000;
  if (m.phase === 'countdown') {
    const left = Math.ceil(COUNTDOWN - since);
    if (left !== m.lastCount) {
      m.lastCount = left;
      if (left > 0) { big(String(left)); sfx.tick(); } else { big('시작!'); sfx.go(); }
    }
    A.tick(0, dt, people, W, H, false, s.roundSec);
    $('roundTime').textContent = s.roundSec;
    $('poseBar').style.width = '0%';
    $('posePhase').textContent = '곧 시작해요! 화면에 몸이 다 보이게 서요';
    if (m.mode === 'race') A.drawCard($('ghost'), m.sides);
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
    else if (e.kind === 'freeze') big('얼음! 🧊', 900, '16vh');
    else if (e.kind === 'unfreeze') big('땡! 💃', 800, '14vh');
  }
  $('hud').classList.toggle('frozen', !!A.frozen);
  $('roundTime').textContent = Math.max(0, Math.ceil(s.roundSec - t));
  $('poseBar').style.width = `${Math.min(100, (t / s.roundSec) * 100)}%`;
  $('posePhase').textContent = A.phaseText();
  if (m.mode === 'race') A.drawCard($('ghost'), m.sides);
  updateArcadePanels();
  const outs = A.outs();
  outs.forEach((o, i) => $(`panel${i}`).classList.toggle('out', o));
  const ended = A.endsOnOut ? outs[0] || outs[1] : outs[0] && outs[1];
  if (ended || A.winnerEarly() >= 0 || t >= s.roundSec) finishMatch(outs, t >= s.roundSec);
}

// 게임마다 점수 크기가 달라서, 팀 점수에 더할 때는 한 판을 0~100점으로 맞춘다
const WIN_BONUS = 20;
const MODE_INFO = ARCADE_INFO;
function gamePoints(m, i) {
  const raw = { dance: 0.3, balloon: 0.25, wall: 6, race: 1, goalie: 4 }[m.mode] * m.arcade.players[i].score;
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
  const arcadeCol = (i) => `<div class="big">${A.scoreText(i)}</div>${A.usesLives ? `<div>남은 생명 ${'❤️'.repeat(A.players[i].lives) || '없음'}</div>` : ''}<div>${A.detail(i)}</div>`;
  if (empty[0] || empty[1]) {
    state.next = { sides, round: m.round };
    setTimeout(() => {
      $('resultTitle').textContent = '🧪 연습 경기 끝!';
      $('resultBody').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--muted);margin:0">한 명만 있어서 기록하지 않았어요. 두 명이 서면 정식 대결이 돼요</p>` +
        sides.map((sd, i) => `<div class="rcol" style="background:${sd.team.color};${empty[i] ? 'opacity:.5' : ''}">
            <div class="big">${esc(sd.member)}</div><div>${esc(sd.team.name)}</div>
            ${empty[i] ? '<div>빈 자리</div>' : arcadeCol(i)}</div>`).join('');
      show('result');
    }, 900);
    big('끝!', 900);
    return;
  }
  const helperIdx = sides.findIndex((sd) => sd.helper);
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
  const label = (i) => `${sides[i].member}(${sides[i].team.name})${i === helperIdx ? '[도우미]' : ` +${earned[i]}`}`;
  const tag = `[${m.round}R ${MODE_INFO[m.mode].emoji}] `;
  state.history.unshift(winner >= 0 ? `${tag}🏆 ${label(winner)} 승 vs ${label(1 - winner)}` : `${tag}🤝 ${label(0)} vs ${label(1)} 무승부`);
  const finishedNow = tourneyDone();
  if (finishedNow) state.history.unshift('🏁 대회 끝!');
  state.next = null;
  save();

  setTimeout(() => {
    $('resultTitle').textContent = winner >= 0 ? `🏆 ${sides[winner].member} 승리!` : '🤝 무승부!';
    $('resultBody').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--muted);margin:0">${esc(reason)}</p>` +
      sides.map((sd, i) => {
        return `<div class="rcol" style="background:${sd.team.color};${i === winner ? 'box-shadow:0 0 0 5px #ffd84d' : ''}">
          <div class="big">${esc(sd.member)}</div><div>${esc(sd.team.name)}</div>
          ${arcadeCol(i)}
          ${i === helperIdx ? '<div>🤝 도우미 (기록 안 함)</div>'
            : `<div class="big">팀 +${earned[i]}점</div><div class="pts">게임 ${gp[i]}점${winner === i ? ` + 승리 보너스 ${WIN_BONUS}점` : ''}</div>`}</div>`;
      }).join('');
    show('result');
    if (winner >= 0) sfx.win();
  }, 900);
  big(winner >= 0 ? '끝!' : '끝!', 900);
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

// 스켈레톤 그리기 (화면 밖이라 안 보이는 부위는 회색 점선)
function drawSkeleton(lms, color, W, H) {
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = { x: (lms[LM.lShoulder].x + lms[LM.rShoulder].x) / 2 * W, y: (lms[LM.lShoulder].y + lms[LM.rShoulder].y) / 2 * H };
  const hp = { x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2 * W, y: (lms[LM.lHip].y + lms[LM.rHip].y) / 2 * H };
  const torso = Math.max(20, Math.hypot(sh.x - hp.x, sh.y - hp.y));
  const lw = Math.max(5, torso * 0.07);
  const n = P(LM.nose);
  const headR = torso * 0.24;
  const line = (a, b) => { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = lw + 6;
  for (const [a, b] of BONES) line(a, b);
  ctx.lineWidth = lw;
  for (const [a, b] of BONES) {
    if (!seenLm(lms[a]) || !seenLm(lms[b])) {
      ctx.save();
      ctx.setLineDash([lw * 1.2, lw * 1.2]);
      ctx.strokeStyle = 'rgba(200,200,200,0.6)';
      line(a, b);
      ctx.restore();
      continue;
    }
    ctx.strokeStyle = color;
    line(a, b);
  }
  for (const i of JOINTS) {
    const p = P(i);
    ctx.beginPath(); ctx.arc(p.x, p.y, lw * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(n.x, n.y, headR, 0, Math.PI * 2);
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = color; ctx.stroke();
}

let lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  const tr = state.tracker;
  if (!tr) { ctx.fillStyle = '#11151f'; ctx.fillRect(0, 0, stage.width, stage.height); return; }

  const W = tr.width, H = tr.height;
  if (stage.width !== W || stage.height !== H) { stage.width = W; stage.height = H; }
  tr.drawFrame(ctx, W, H);

  let people = [null, null];
  try { people = assignSides(tr.detect(now)); } catch (e) { console.error(e); }
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
      el.textContent = `${i ? '오른쪽' : '왼쪽'} 선수 ${p ? '✅ 보여요' : '⏳ 안 보여요'}`;
      el.className = p ? 'on' : '';
    });
  }
}

// ---------------- 이벤트 ----------------
function bind() {
  $('teamCount').addEventListener('change', () => { readSetup(); renderSetup(); });
  $('startBtn').addEventListener('click', () => startApp(false));
  $('simBtn').addEventListener('click', () => startApp(true));
  $('drawBtn').addEventListener('click', drawNext);
  $('fightBtn').addEventListener('click', spinAndStart);
  $('nextBtn').addEventListener('click', () => {
    state.match = null;
    if (state.next) renderLobby(); else drawNext(); // 연습 경기였으면 같은 대결 그대로
    show('lobby');
  });
  $('settingsBtn').addEventListener('click', () => { renderSetup(); show('setup'); });
  $('resetScoreBtn').addEventListener('click', () => {
    if (!confirm('모든 팀 점수와 기록을 지우고, 모든 선수를 다시 뽑을 수 있게 할까요?')) return;
    state.teams.forEach((t) => { t.score = 0; t.played = 0; t.games = 0; });
    state.round = 1;
    state.recs = {};
    state.history = [];
    save(); drawNext();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.screen === 'lobby') { if (state.next) spinAndStart(); else $('roundBtn')?.click(); }
      else if (state.screen === 'result') $('nextBtn').click();
    } else if (e.code === 'KeyR' && state.screen === 'lobby' && !state.spinning) drawNext();
    else if (e.code === 'Escape' && state.screen === 'play') abortMatch();
  });
}

load();
renderSetup();
bind();
requestAnimationFrame(frame);
refreshCameras();
navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);

// 디버그용
window.__game = state;
