// 얼음! 자세 버티기 - 메인 게임 흐름
import { POSES, BONES, JOINTS, LM } from './poses.js';
import { PlayerJudge, DIFFICULTY } from './judge.js';
import { CameraTracker, listCameras } from './tracker.js';
import { SimTracker } from './sim.js';
import { sfx } from './sound.js';
import { DANCES, danceAt } from './dances.js';

const $ = (id) => document.getElementById(id);
const TEAM_PRESETS = [
  { name: '호랑이팀', color: '#ff6b4a' },
  { name: '독수리팀', color: '#3d8bff' },
  { name: '돌고래팀', color: '#18a874' },
  { name: '판다팀', color: '#9b59ff' },
];
const SIDE_COLORS = ['#ffd84d', '#4de1ff'];
const COUNTDOWN = 3;   // 시작 카운트다운(초)
const PREP = 3.5;      // 새 자세로 바꾸는 준비 시간(초), 이 동안은 판정 안 함
const STORE_KEY = 'posequiz-v1';
// 댄스 얼음땡 모드
const DANCE_MIN = 6, DANCE_MAX = 10; // 몇 초 춤춘 뒤 멈출지 (그 사이 무작위)
const FREEZE_GRACE = 1.5;            // 멈춘 직후 자세를 잡는 시간 (판정 안 함)
const FREEZE_HOLD = 4;               // 얼음 버티기 판정 시간
const FREEZE_BONUS = 30;             // 생명을 잃지 않고 버티면 받는 점수
const FOLLOW_WINDOW = 1.2;           // 춤 채점 시 허용하는 따라 하기 지연(초)
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------- 상태 ----------------
const state = {
  settings: { teamCount: 2, lives: 3, roundSec: 45, rounds: 1, poseSec: 15, difficulty: 'normal', model: 'lite', cameraId: '', mode: 'dance' },
  teams: TEAM_PRESETS.map((t) => ({ ...t, membersText: '', score: 0, played: 0, done: [] })),
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
      teams: state.teams.map(({ name, color, membersText, score, played }) => ({ name, color, membersText, score, played })),
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
  for (const k of ['mode', 'teamCount', 'lives', 'roundSec', 'rounds', 'poseSec', 'difficulty', 'model']) $(k).value = String(s[k]);
  $('poseSecLabel').classList.toggle('hidden', s.mode === 'dance');
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
  s.poseSec = +$('poseSec').value;
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
      t.getPose = () => (state.match && state.match.phase !== 'done' ? state.match.pose : null);
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

// 대회 결과: 팀 순위, 점수 합계 상위(댄스왕), 전승 학생
function standings() {
  const players = allPlayers().map((p) => ({ ...p, r: rec(p.team, p.member) }));
  const top = players.slice().sort((a, b) => b.r.points - a.r.points).slice(0, 3);
  const perfect = players.filter((p) => p.r.games > 0 && p.r.wins === p.r.games);
  const teams = activeTeams().slice().sort((a, b) => b.score - a.score);
  return { top, perfect, teams };
}

function renderLobby(roll = false) {
  const sb = $('scoreboard');
  sb.innerHTML = activeTeams()
    .slice().sort((a, b) => b.score - a.score)
    .map((t) => {
      const sub = `이번 라운드 남은 ${waiting(t).length}명`;
      return `<div class="team-score" style="background:${t.color}"><span>${esc(t.name)}<small>${sub}</small></span><b>${t.score}점</b></div>`;
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
      const tie = st.teams[1] && st.teams[1].score === best.score;
      v.innerHTML = `<div class="stage-msg">
        ${tie ? '🤝 공동 우승!' : `🏆 우승 팀<div class="champ" style="background:${best.color}">${esc(best.name)}<small>${best.score}승</small></div>`}
        <div class="awards${state.settings.rounds > 1 ? '' : ' one'}">
          <div><b>🕺 댄스왕 (${state.settings.rounds > 1 ? '점수 합계' : '점수 순위'})</b>${st.top.map((p, i) => `<span>${['🥇', '🥈', '🥉'][i]} ${esc(p.member)} <em>${esc(p.team.name)} · ${p.r.points}점</em></span>`).join('')}</div>
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
function makePoseOrder(n) {
  const easy = shuffle(POSES.filter((p) => p.level === 1));
  const rest = shuffle(POSES.filter((p) => p !== easy[0]));
  const order = [easy[0], ...rest];
  while (order.length < n) order.push(...shuffle(POSES));
  return order.slice(0, n);
}

function startMatch() {
  if (!state.next) return;
  sfx.unlock();
  const s = state.settings;
  const segs = Math.ceil(s.roundSec / s.poseSec);
  const dance = s.mode === 'dance' ? DANCES[Math.floor(Math.random() * DANCES.length)] : null;
  state.match = {
    mode: s.mode,
    dance,
    clock: 0,          // 춤 시계 (얼음 동안은 멈춤)
    sub: 'dance',      // dance | freeze
    nextFreezeAt: rand(DANCE_MIN, DANCE_MAX),
    freezeT: 0,
    freezeHit: [false, false],
    hist: [],          // 최근 춤 자세 {t, pose}
    lastStep: -1,
    sides: state.next.sides,
    round: state.next.round,
    judges: [new PlayerJudge(s.lives), new PlayerJudge(s.lives)],
    poses: makePoseOrder(segs),
    poseIdx: 0,
    pose: null,
    t0: performance.now(),
    phase: 'countdown',
    lastCount: null,
    elapsed: 0,
  };
  state.match.pose = dance ? danceAt(dance, 0).pose : state.match.poses[0];
  $('hud').classList.toggle('dance', !!dance);
  $('hud').classList.remove('frozen');
  buildPanels();
  if (dance) setDanceCard(); else setPoseCard(state.match.pose);
  show('play');
}

function buildPanels() {
  state.match.sides.forEach((side, i) => {
    const el = $(`panel${i}`);
    el.style.borderColor = SIDE_COLORS[i];
    el.classList.remove('out');
    el.innerHTML = `<div class="pcol">
        <div class="who"><span class="pname">${esc(side.member)}</span><span class="pteam" style="color:${side.team.color}">● ${esc(side.team.name)}</span><span class="pscore"></span></div>
        <div class="hearts"></div>
        <div class="status"></div>
      </div>
      <div class="pcol">
        <div class="meter"><span>자세</span><div class="track"><div class="fill match"></div></div><span class="mval"></span></div>
        <div class="meter"><span>흔들림</span><div class="track"><div class="fill wob"></div></div><span class="wval"></span></div>
        <div class="meter"><span>위험</span><div class="track"><div class="fill danger" style="background:var(--bad)"></div></div><span></span></div>
      </div>`;
  });
}

const STATUS_TEXT = {
  ok: '좋아요! 그대로! 🧊', wobble: '흔들려요! 😵', pose: '자세를 맞춰요! 👀', missing: '다리까지 보이게! 🙈', wait: '',
  great: '완벽해요! 🔥', good: '좋아요! 👍', follow: '춤을 따라 춰요! 💃',
};

function updatePanels(judging) {
  const m = state.match, diff = DIFFICULTY[state.settings.difficulty];
  m.judges.forEach((j, i) => {
    const el = $(`panel${i}`);
    el.querySelector('.hearts').innerHTML = Array.from({ length: j.maxLives }, (_, k) => `<span class="${k < j.lives ? '' : 'lost'}">❤️</span>`).join('');
    const mf = el.querySelector('.match');
    mf.style.width = `${Math.round(j.match * 100)}%`;
    mf.style.background = j.match >= diff.match ? 'var(--good)' : 'var(--warn)';
    el.querySelector('.mval').textContent = `${Math.round(j.match * 100)}%`;
    const wr = Math.min(1, j.wobble / (diff.wobble * 2));
    const wf = el.querySelector('.wob');
    wf.style.width = `${Math.round(wr * 100)}%`;
    wf.style.background = j.wobble > diff.wobble ? 'var(--bad)' : 'var(--good)';
    el.querySelector('.wval').textContent = j.wobble > diff.wobble ? '!!' : 'OK';
    el.querySelector('.danger').style.width = `${Math.round(j.danger * 100)}%`;
    el.querySelector('.pscore').textContent = m.mode === 'dance' ? `${Math.floor(j.score)}점` : '';
    const st = el.querySelector('.status');
    const dancing = m.mode === 'dance' && m.sub === 'dance';
    const status = j.lives <= 0 ? 'out' : dancing ? j.status : !judging && j.status !== 'missing' ? 'wait' : j.status;
    st.className = `status ${status}`;
    st.textContent = status === 'out' ? '탈락 💧'
      : status === 'wait' ? (m.mode === 'dance' ? '얼음! 그대로 멈춰요! 🧊' : j.match >= diff.match ? '준비 완료! 👍' : '자세를 바꿔요!')
      : STATUS_TEXT[status];
  });
}

function setPoseCard(pose) {
  $('poseEmoji').textContent = pose.emoji;
  $('poseName').textContent = pose.name;
  $('poseHint').textContent = pose.hint;
  drawGhostCard(pose);
}

function tickMatch(now, dt, people) {
  const m = state.match, s = state.settings, diff = DIFFICULTY[s.difficulty];
  const since = (now - m.t0) / 1000;

  // 카운트다운
  if (m.phase === 'countdown') {
    const left = Math.ceil(COUNTDOWN - since);
    if (left !== m.lastCount) {
      m.lastCount = left;
      if (left > 0) { big(String(left)); sfx.tick(); } else { big('시작!'); sfx.go(); }
    }
    m.judges.forEach((j, i) => { j.observe(people[i], dt, aspect()); j.step(dt, m.pose, diff, false, since); });
    $('roundTime').textContent = s.roundSec;
    $('poseBar').style.width = '0%';
    $('posePhase').textContent = m.mode === 'dance' ? '곧 춤이 시작돼요! 🎵' : '곧 시작해요! 자세를 잡아요';
    updatePanels(false);
    if (since >= COUNTDOWN) { m.phase = 'play'; m.tPlay = now; setTimeout(hideBig, 700); }
    return;
  }

  if (m.phase !== 'play') return;
  const t = (now - m.tPlay) / 1000;
  m.elapsed = t;
  if (m.mode === 'dance') { tickDance(t, dt, people); return; }
  const seg = Math.min(m.poses.length - 1, Math.floor(t / s.poseSec));
  if (seg !== m.poseIdx) {
    m.poseIdx = seg;
    m.pose = m.poses[seg];
    setPoseCard(m.pose);
    big(`${m.pose.emoji} ${m.pose.name}!`, 1200, '12vh');
    sfx.change();
  }
  const segT = t - seg * s.poseSec;
  const judging = segT >= (seg === 0 ? 0.5 : PREP);

  m.judges.forEach((j, i) => {
    if (j.lives <= 0) return;
    j.observe(people[i], dt, aspect());
    if (j.step(dt, m.pose, diff, judging, t)) hitFx(i);
  });

  $('roundTime').textContent = Math.max(0, Math.ceil(s.roundSec - t));
  $('poseBar').style.width = `${Math.min(100, (segT / s.poseSec) * 100)}%`;
  $('posePhase').textContent = judging ? '버텨요! 흔들리면 생명이 줄어요' : '새 자세로 바꿔요! (아직 판정 안 해요)';
  updatePanels(judging);

  const outs = m.judges.map((j) => j.lives <= 0);
  outs.forEach((o, i) => $(`panel${i}`).classList.toggle('out', o));
  if (outs[0] || outs[1] || t >= s.roundSec) finishMatch(outs, t >= s.roundSec);
}

function setDanceCard() {
  const m = state.match;
  $('poseEmoji').textContent = m.sub === 'freeze' ? '🧊' : '💃';
  $('poseName').textContent = m.sub === 'freeze' ? '얼음!' : m.dance.name;
  $('poseHint').textContent = m.sub === 'freeze' ? '그 자세 그대로 멈춰요!' : '스켈레톤을 따라 춤춰요!';
  $('hud').classList.toggle('frozen', m.sub === 'freeze');
  drawGhostCard(m.pose, true);
}

function hitFx(i) {
  sfx.hit();
  const el = $(`panel${i}`);
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  const j = state.match && state.match.judges[i];
  const why = j && HIT_TEXT[j.hitReason];
  if (why) big(`💔 ${state.match.sides[i].member}: ${why}`, 1200, '6vh');
}

function tickDance(t, dt, people) {
  const m = state.match, s = state.settings, diff = DIFFICULTY[s.difficulty];
  m.judges.forEach((j, i) => { if (j.lives > 0) j.observe(people[i], dt, aspect()); });

  if (m.sub === 'dance') {
    m.clock += dt;
    const st = danceAt(m.dance, m.clock);
    m.pose = st.pose;
    if (st.step !== m.lastStep) { m.lastStep = st.step; sfx.beat(); }
    m.hist.push({ t, pose: st.pose });
    while (m.hist.length && t - m.hist[0].t > FOLLOW_WINDOW) m.hist.shift();
    const poses = m.hist.map((h) => h.pose);
    m.judges.forEach((j) => { if (j.lives > 0) j.danceStep(dt, poses, diff); });

    // 예고 없이 멈추기: 정해 둔 시간이 지난 뒤, 알아보기 쉬운 동작에 도착한 순간
    if (m.clock >= m.nextFreezeAt && st.holding && st.move.freeze && s.roundSec - t > FREEZE_GRACE + 1) {
      m.sub = 'freeze';
      m.freezeT = 0;
      m.freezeHit = [false, false];
      m.pose = st.move;
      sfx.freeze();
      big('얼음! 🧊', 900, '16vh');
    }
    $('poseBar').style.width = `${Math.min(100, (t / s.roundSec) * 100)}%`;
    $('posePhase').textContent = '🎵 따라 출수록 점수가 올라가요';
    updatePanels(false);
  } else {
    m.freezeT += dt;
    const judging = m.freezeT >= FREEZE_GRACE;
    m.judges.forEach((j, i) => {
      if (j.lives <= 0) return;
      if (j.step(dt, m.pose, diff, judging, t)) { m.freezeHit[i] = true; hitFx(i); }
    });
    const left = FREEZE_GRACE + FREEZE_HOLD - m.freezeT;
    $('poseBar').style.width = `${Math.min(100, (m.freezeT / (FREEZE_GRACE + FREEZE_HOLD)) * 100)}%`;
    $('posePhase').textContent = judging ? `버텨요! ${Math.ceil(left)}초` : '멈춰요! 그 자세 그대로!';
    updatePanels(judging);
    if (left <= 0) {
      let anyBonus = false;
      m.judges.forEach((j, i) => {
        if (j.lives > 0 && !m.freezeHit[i]) { j.score += FREEZE_BONUS; j.freezeOK++; anyBonus = true; }
      });
      if (anyBonus) sfx.bonus();
      m.sub = 'dance';
      m.hist = [];
      m.nextFreezeAt = m.clock + rand(DANCE_MIN, DANCE_MAX);
      big(anyBonus ? `땡! 🎵 +${FREEZE_BONUS}` : '땡! 🎵', 900, '14vh');
    }
  }
  setDanceCard();
  $('roundTime').textContent = Math.max(0, Math.ceil(s.roundSec - t));

  const outs = m.judges.map((j) => j.lives <= 0);
  outs.forEach((o, i) => $(`panel${i}`).classList.toggle('out', o));
  if (outs[0] || outs[1] || t >= s.roundSec) finishMatch(outs, t >= s.roundSec);
}

function finishMatch(outs, timeUp) {
  const m = state.match;
  m.phase = 'done';
  const [a, b] = m.judges;
  let winner = -1, reason = '';
  if (outs[0] && outs[1]) { winner = -1; reason = '둘 다 동시에 생명을 모두 잃었어요'; }
  else if (outs[0] || outs[1]) { winner = outs[0] ? 1 : 0; reason = '상대가 생명을 모두 잃었어요'; }
  else if (m.mode === 'dance') {
    const sa = Math.floor(a.score), sb = Math.floor(b.score);
    if (sa !== sb) { winner = sa > sb ? 0 : 1; reason = '시간 종료! 점수가 더 높아요'; }
    else { winner = -1; reason = '시간 종료! 점수가 똑같아요'; }
  }
  else if (a.lives !== b.lives) { winner = a.lives > b.lives ? 0 : 1; reason = '시간 종료! 남은 생명이 더 많아요'; }
  else if (Math.abs(a.okTime - b.okTime) >= 0.5) { winner = a.okTime > b.okTime ? 0 : 1; reason = '시간 종료! 생명이 같아서 바른 자세로 버틴 시간으로 판정'; }
  else { winner = -1; reason = '시간 종료! 완전 막상막하예요'; }
  if (m.mode !== 'dance' && timeUp && winner === -1 && !outs[0] && !outs[1]) reason = '시간 종료! 완전 막상막하예요';

  const sides = m.sides;
  const helperIdx = sides.findIndex((sd) => sd.helper);
  // 기록: 도우미는 제외. 점수 합계(댄스왕)는 댄스 점수, 버티기 모드는 바른 자세 시간×10
  sides.forEach((sd, i) => {
    sd.team.played++;
    if (sd.helper) return;
    const r = rec(sd.team, sd.member);
    const j = m.judges[i];
    r.games++;
    r.points += Math.floor(m.mode === 'dance' ? j.score : j.okTime * 10);
    if (winner === i) r.wins++;
  });
  // 팀 점수: 다른 팀끼리 대결에서 이긴 경우만 (도우미가 이기면 점수 없음)
  const teamPoint = winner >= 0 && winner !== helperIdx && sides[0].team !== sides[1].team;
  if (teamPoint) sides[winner].team.score++;
  const label = (i) => `${sides[i].member}(${sides[i].team.name})${i === helperIdx ? '[도우미]' : ''}`;
  const tag = `[${m.round}R] `;
  state.history.unshift(winner >= 0 ? `${tag}🏆 ${label(winner)} 승 vs ${label(1 - winner)}` : `${tag}🤝 ${label(0)} vs ${label(1)} 무승부`);
  const finishedNow = tourneyDone();
  if (finishedNow) state.history.unshift('🏁 대회 끝!');
  state.next = null;
  save();

  setTimeout(() => {
    $('resultTitle').textContent = winner >= 0 ? `🏆 ${sides[winner].member} 승리!` : '🤝 무승부!';
    $('resultBody').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--muted);margin:0">${esc(reason)}</p>` +
      sides.map((sd, i) => {
        const j = m.judges[i];
        return `<div class="rcol" style="background:${sd.team.color};${i === winner ? 'box-shadow:0 0 0 5px #ffd84d' : ''}">
          <div class="big">${esc(sd.member)}</div><div>${esc(sd.team.name)}</div>
          <div>남은 생명 ${'❤️'.repeat(j.lives) || '없음'}</div>
          ${m.mode === 'dance'
            ? `<div class="big">${Math.floor(j.score)}점</div><div>얼음 성공 ${j.freezeOK}번 · 평균 일치 ${Math.round(j.avgMatch * 100)}%</div>`
            : `<div>바른 자세 ${j.okTime.toFixed(1)}초 · 평균 일치 ${Math.round(j.avgMatch * 100)}%</div>`}
          ${i === winner ? `<div class="big">${teamPoint ? '팀 +1점' : '승리!'}</div>` : ''}
          ${i === helperIdx ? '<div>🤝 도우미 (기록 안 함)</div>' : ''}</div>`;
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
const aspect = () => (state.tracker ? state.tracker.width / state.tracker.height : 16 / 9);

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

// 팔다리 뼈 → 그 뼈의 방향을 결정하는 관절 각도
const BONE_ANGLE = {
  [`${LM.lShoulder}-${LM.lElbow}`]: 'lShoulder', [`${LM.lElbow}-${LM.lWrist}`]: 'lElbow',
  [`${LM.rShoulder}-${LM.rElbow}`]: 'rShoulder', [`${LM.rElbow}-${LM.rWrist}`]: 'rElbow',
  [`${LM.lHip}-${LM.lKnee}`]: 'lHip', [`${LM.lKnee}-${LM.lAnkle}`]: 'lKnee',
  [`${LM.rHip}-${LM.rKnee}`]: 'rHip', [`${LM.rKnee}-${LM.rAnkle}`]: 'rKnee',
};
const GOOD = '#2fdc7a', BAD = '#ff4d5e';
// 생명이 깎이거나 점수가 안 오르는 상태 → 빨간 테두리 + 머리 위 이유 표시
const BAD_REASON = {
  missing: '다리까지 화면에 보이게!',
  wobble: '흔들려요!',
  pose: '자세가 달라요',
  follow: '자세가 달라요',
};
const HIT_TEXT = { missing: '다리가 화면 밖으로 나갔어요', wobble: '흔들렸어요', pose: '자세가 달랐어요' };

// judge가 있으면(대결 중) 몸 주변에 초록(자세 맞음)/빨강(틀림) 테두리를 두르고,
// 팔다리 마디도 하나씩 초록/빨강으로 칠해 어느 부위가 틀렸는지 보여준다
function drawSkeleton(lms, color, W, H, judge, okThr, alert) {
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = { x: (lms[LM.lShoulder].x + lms[LM.rShoulder].x) / 2 * W, y: (lms[LM.lShoulder].y + lms[LM.rShoulder].y) / 2 * H };
  const hp = { x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2 * W, y: (lms[LM.lHip].y + lms[LM.rHip].y) / 2 * H };
  const torso = Math.max(20, Math.hypot(sh.x - hp.x, sh.y - hp.y));
  const lw = Math.max(5, torso * 0.07);
  const n = P(LM.nose);
  const headR = torso * 0.24;
  const line = (a, b) => { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
  ctx.lineCap = 'round';

  const showFit = judge && judge.visible;
  const reason = showFit ? (BAD_REASON[judge.status] || (judge.match < okThr ? '자세가 달라요' : null)) : null;
  const ok = showFit && !alert && !reason;
  if (showFit) {
    // 몸 둘레 테두리 (두꺼운 반투명 선 + 빛 번짐)
    ctx.save();
    ctx.strokeStyle = ok ? GOOD : BAD;
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = ok ? GOOD : BAD;
    ctx.shadowBlur = lw * 3;
    ctx.lineWidth = lw * 4.2;
    for (const [a, b] of BONES) line(a, b);
    ctx.beginPath(); ctx.arc(n.x, n.y, headR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = lw + 6;
    for (const [a, b] of BONES) line(a, b);
  }

  ctx.lineWidth = lw;
  for (const [a, b] of BONES) {
    const key = BONE_ANGLE[`${a}-${b}`];
    const part = showFit && judge.parts && key ? judge.parts[key] : null;
    ctx.strokeStyle = part == null ? color : part >= 0.5 ? GOOD : BAD;
    line(a, b);
  }
  for (const i of JOINTS) {
    const p = P(i);
    ctx.beginPath(); ctx.arc(p.x, p.y, lw * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(n.x, n.y, headR, 0, Math.PI * 2);
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = color; ctx.stroke();

  // 빨간 상태면 머리 위에 이유를 띄운다
  if (showFit && !ok) {
    const text = alert ? BAD_REASON.wobble : reason;
    const fs = Math.max(18, Math.min(40, torso * 0.2));
    ctx.save();
    ctx.font = `${fs}px Jua, sans-serif`;
    const tw = ctx.measureText(text).width;
    const bx = n.x - tw / 2 - fs * 0.5, by = Math.max(4, n.y - headR - fs * 2.1);
    ctx.fillStyle = 'rgba(255,77,94,0.92)';
    ctx.beginPath(); ctx.roundRect(bx, by, tw + fs, fs * 1.5, fs * 0.4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, n.x, by + fs * 0.78);
    ctx.restore();
  }
  return { hp, torso };
}

// 선수 몸 위에 목표 자세를 반투명하게 겹쳐 그림
function drawGhostOverlay(pose, anchor) {
  const sk = pose.skeleton;
  const P = (i) => ({ x: anchor.hp.x + sk[i].x * anchor.torso, y: anchor.hp.y + sk[i].y * anchor.torso });
  ctx.save();
  ctx.setLineDash([anchor.torso * 0.08, anchor.torso * 0.08]);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(3, anchor.torso * 0.05);
  for (const [a, b] of BONES) { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  const n = P(LM.nose);
  ctx.beginPath(); ctx.arc(n.x, n.y, anchor.torso * 0.24, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawGhostCard(pose, fixed = false) {
  const c = $('ghost'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const sk = pose.skeleton;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k in sk) { minX = Math.min(minX, sk[k].x); maxX = Math.max(maxX, sk[k].x); minY = Math.min(minY, sk[k].y); maxY = Math.max(maxY, sk[k].y); }
  minY -= 0.3; // 머리 여유
  if (fixed) { minX = -2.0; maxX = 2.0; minY = -2.75; maxY = 1.75; } // 춤출 때 크기가 출렁이지 않게 고정
  const pad = c.width * 0.08;
  const sc = Math.min((c.width - pad * 2) / (maxX - minX), (c.height - pad * 2) / (maxY - minY));
  const ox = c.width / 2 - ((minX + maxX) / 2) * sc, oy = c.height / 2 - ((minY + maxY) / 2) * sc;
  const P = (i) => ({ x: ox + sk[i].x * sc, y: oy + sk[i].y * sc });
  const frozen = fixed && state.match && state.match.sub === 'freeze';
  g.lineCap = 'round'; g.strokeStyle = frozen ? '#2a9df4' : '#ff7a3d'; g.lineWidth = c.width * 0.05;
  for (const [a, b] of BONES) { const p = P(a), q = P(b); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
  for (const i of JOINTS) { const p = P(i); g.beginPath(); g.arc(p.x, p.y, c.width * 0.032, 0, Math.PI * 2); g.fillStyle = '#1d2433'; g.fill(); }
  const n = P(LM.nose);
  g.beginPath(); g.arc(n.x, n.y, 0.24 * sc, 0, Math.PI * 2); g.lineWidth = c.width * 0.04; g.stroke();
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

  people.forEach((lms, i) => {
    if (!lms) return;
    const j = m && state.screen === 'play' ? m.judges[i] : null;
    const alert = j && j.status === 'wobble' && m.phase === 'play';
    const okThr = DIFFICULTY[state.settings.difficulty].match;
    const anchor = drawSkeleton(lms, SIDE_COLORS[i], W, H, j && j.lives > 0 ? j : null, okThr, alert);
    if (j && m.pose && j.lives > 0) drawGhostOverlay(m.pose, anchor);
  });

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
  $('mode').addEventListener('change', () => $('poseSecLabel').classList.toggle('hidden', $('mode').value === 'dance'));
  $('startBtn').addEventListener('click', () => startApp(false));
  $('simBtn').addEventListener('click', () => startApp(true));
  $('drawBtn').addEventListener('click', drawNext);
  $('fightBtn').addEventListener('click', startMatch);
  $('nextBtn').addEventListener('click', () => { state.match = null; drawNext(); show('lobby'); });
  $('settingsBtn').addEventListener('click', () => { renderSetup(); show('setup'); });
  $('resetScoreBtn').addEventListener('click', () => {
    if (!confirm('모든 팀 점수와 기록을 지우고, 모든 선수를 다시 뽑을 수 있게 할까요?')) return;
    state.teams.forEach((t) => { t.score = 0; t.played = 0; });
    state.round = 1;
    state.recs = {};
    state.history = [];
    save(); drawNext();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.screen === 'lobby') { if (state.next) startMatch(); else $('roundBtn')?.click(); }
      else if (state.screen === 'result') $('nextBtn').click();
    } else if (e.code === 'KeyR' && state.screen === 'lobby') drawNext();
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
