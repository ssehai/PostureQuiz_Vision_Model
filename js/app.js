// 얼음! 자세 버티기 - 메인 게임 흐름
import { POSES, BONES, JOINTS, LM } from './poses.js';
import { PlayerJudge, DIFFICULTY } from './judge.js';
import { CameraTracker } from './tracker.js';
import { SimTracker } from './sim.js';
import { sfx } from './sound.js';

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

// ---------------- 상태 ----------------
const state = {
  settings: { teamCount: 2, lives: 3, roundSec: 60, poseSec: 15, difficulty: 'normal', model: 'lite' },
  teams: TEAM_PRESETS.map((t) => ({ ...t, membersText: '', score: 0, played: 0, queue: [] })),
  history: [],
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
    (d.teams || []).forEach((t, i) => { if (state.teams[i]) Object.assign(state.teams[i], t, { queue: [] }); });
    state.history = d.history || [];
  } catch { /* 저장소를 못 쓰는 환경이면 무시 */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: state.settings,
      teams: state.teams.map(({ name, color, membersText, score, played }) => ({ name, color, membersText, score, played })),
      history: state.history.slice(0, 30),
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
  for (const k of ['teamCount', 'lives', 'roundSec', 'poseSec', 'difficulty', 'model']) $(k).value = String(s[k]);
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
  s.teamCount = +$('teamCount').value;
  s.lives = +$('lives').value;
  s.roundSec = +$('roundSec').value;
  s.poseSec = +$('poseSec').value;
  s.difficulty = $('difficulty').value;
  s.model = $('model').value;
  document.querySelectorAll('.tname').forEach((el) => { state.teams[+el.dataset.i].name = el.value.trim() || TEAM_PRESETS[+el.dataset.i].name; });
  document.querySelectorAll('.tmembers').forEach((el) => {
    const t = state.teams[+el.dataset.i];
    if (t.membersText !== el.value) { t.membersText = el.value; t.queue = []; }
  });
  save();
}

async function startApp(sim) {
  readSetup();
  sfx.unlock();
  $('setupMsg').textContent = '';
  if (state.tracker) { drawNext(); show('lobby'); return; }
  const btns = [$('startBtn'), $('simBtn')];
  btns.forEach((b) => (b.disabled = true));
  try {
    if (sim) {
      state.tracker = new SimTracker();
      state.tracker.getPose = () => (state.match && state.match.phase !== 'done' ? state.match.pose : null);
    } else {
      $('setupMsg').style.color = 'var(--muted)';
      $('setupMsg').textContent = '카메라와 AI 모델을 불러오는 중... (처음엔 10초쯤 걸려요)';
      const t = new CameraTracker($('video'));
      await t.start(state.settings.model);
      state.tracker = t;
    }
    $('setupMsg').textContent = '';
    drawNext();
    show('lobby');
  } catch (e) {
    console.error(e);
    $('setupMsg').style.color = 'var(--bad)';
    $('setupMsg').textContent = e && e.name === 'NotAllowedError'
      ? '카메라 권한이 거부됐어요. 주소창의 카메라 아이콘에서 허용해 주세요.'
      : `카메라/모델을 시작하지 못했어요: ${e.message || e}`;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---------------- 대기실 ----------------
function pickMember(team) {
  if (!team.queue.length) team.queue = shuffle(members(team));
  return team.queue.pop();
}
function drawNext() {
  const teams = activeTeams();
  const pool = shuffle(teams).sort((a, b) => a.played - b.played);
  const pair = shuffle([pool[0], pool[1]]);
  // 다시 뽑기 시 이전 사람은 대기열에 되돌린다
  if (state.next) state.next.sides.forEach((s) => s.team.queue.unshift(s.member));
  state.next = { sides: pair.map((team) => ({ team, member: pickMember(team) })) };
  renderLobby(true);
}
function renderLobby(roll = false) {
  const sb = $('scoreboard');
  sb.innerHTML = activeTeams()
    .slice().sort((a, b) => b.score - a.score)
    .map((t) => `<div class="team-score" style="background:${t.color}"><span>${esc(t.name)}</span><b>${t.score}점</b></div>`).join('');
  $('history').innerHTML = state.history.slice(0, 8).map((h) => `<li>${esc(h)}</li>`).join('') || '<li>아직 대결이 없어요</li>';
  const n = state.next;
  if (!n) return;
  const v = $('versus');
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
  state.match = {
    sides: state.next.sides,
    judges: [new PlayerJudge(s.lives), new PlayerJudge(s.lives)],
    poses: makePoseOrder(segs),
    poseIdx: 0,
    pose: null,
    t0: performance.now(),
    phase: 'countdown',
    lastCount: null,
    elapsed: 0,
  };
  state.match.pose = state.match.poses[0];
  buildPanels();
  setPoseCard(state.match.pose);
  show('play');
}

function buildPanels() {
  state.match.sides.forEach((side, i) => {
    const el = $(`panel${i}`);
    el.style.borderColor = SIDE_COLORS[i];
    el.classList.remove('out');
    el.innerHTML = `<div class="pcol">
        <div class="who"><span class="pname">${esc(side.member)}</span><span class="pteam" style="color:${side.team.color}">● ${esc(side.team.name)}</span></div>
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

const STATUS_TEXT = { ok: '좋아요! 그대로! 🧊', wobble: '흔들려요! 😵', pose: '자세를 맞춰요! 👀', missing: '온몸이 보이게! 🙈', wait: '' };

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
    const st = el.querySelector('.status');
    const status = j.lives <= 0 ? 'out' : !judging && j.status !== 'missing' ? 'wait' : j.status;
    st.className = `status ${status}`;
    st.textContent = status === 'out' ? '탈락 💧' : status === 'wait' ? (j.match >= diff.match ? '준비 완료! 👍' : '자세를 바꿔요!') : STATUS_TEXT[status];
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
    $('posePhase').textContent = '곧 시작해요! 자세를 잡아요';
    updatePanels(false);
    if (since >= COUNTDOWN) { m.phase = 'play'; m.tPlay = now; setTimeout(hideBig, 700); }
    return;
  }

  if (m.phase !== 'play') return;
  const t = (now - m.tPlay) / 1000;
  m.elapsed = t;
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
    if (j.step(dt, m.pose, diff, judging, t)) {
      sfx.hit();
      const el = $(`panel${i}`);
      el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
    }
  });

  $('roundTime').textContent = Math.max(0, Math.ceil(s.roundSec - t));
  $('poseBar').style.width = `${Math.min(100, (segT / s.poseSec) * 100)}%`;
  $('posePhase').textContent = judging ? '버텨요! 흔들리면 생명이 줄어요' : '새 자세로 바꿔요! (아직 판정 안 해요)';
  updatePanels(judging);

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
  else if (a.lives !== b.lives) { winner = a.lives > b.lives ? 0 : 1; reason = '시간 종료! 남은 생명이 더 많아요'; }
  else if (Math.abs(a.okTime - b.okTime) >= 0.5) { winner = a.okTime > b.okTime ? 0 : 1; reason = '시간 종료! 생명이 같아서 바른 자세로 버틴 시간으로 판정'; }
  else { winner = -1; reason = '시간 종료! 완전 막상막하예요'; }
  if (timeUp && winner === -1 && !outs[0] && !outs[1]) reason = '시간 종료! 완전 막상막하예요';

  const sides = m.sides;
  sides.forEach((sd) => sd.team.played++);
  if (winner >= 0) sides[winner].team.score++;
  const label = (i) => `${sides[i].member}(${sides[i].team.name})`;
  state.history.unshift(winner >= 0 ? `🏆 ${label(winner)} 승 vs ${label(1 - winner)}` : `🤝 ${label(0)} vs ${label(1)} 무승부`);
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
          <div>바른 자세 ${j.okTime.toFixed(1)}초 · 평균 일치 ${Math.round(j.avgMatch * 100)}%</div>
          ${i === winner ? '<div class="big">+1점</div>' : ''}</div>`;
      }).join('');
    show('result');
    if (winner >= 0) sfx.win();
  }, 900);
  big(winner >= 0 ? '끝!' : '끝!', 900);
}

function abortMatch() {
  if (!state.match) return;
  state.next = { sides: state.match.sides };
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

function drawSkeleton(lms, color, W, H, alert) {
  const P = (i) => ({ x: lms[i].x * W, y: lms[i].y * H });
  const sh = { x: (lms[LM.lShoulder].x + lms[LM.rShoulder].x) / 2 * W, y: (lms[LM.lShoulder].y + lms[LM.rShoulder].y) / 2 * H };
  const hp = { x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2 * W, y: (lms[LM.lHip].y + lms[LM.rHip].y) / 2 * H };
  const torso = Math.max(20, Math.hypot(sh.x - hp.x, sh.y - hp.y));
  const lw = Math.max(5, torso * 0.07);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = lw + 6;
  for (const [a, b] of BONES) { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  ctx.strokeStyle = alert ? '#ff4d5e' : color; ctx.lineWidth = lw;
  for (const [a, b] of BONES) { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  for (const i of JOINTS) {
    const p = P(i);
    ctx.beginPath(); ctx.arc(p.x, p.y, lw * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = alert ? '#ff4d5e' : color; ctx.stroke();
  }
  const n = P(LM.nose);
  ctx.beginPath(); ctx.arc(n.x, n.y, torso * 0.24, 0, Math.PI * 2);
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = alert ? '#ff4d5e' : color; ctx.stroke();
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

function drawGhostCard(pose) {
  const c = $('ghost'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const sk = pose.skeleton;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k in sk) { minX = Math.min(minX, sk[k].x); maxX = Math.max(maxX, sk[k].x); minY = Math.min(minY, sk[k].y); maxY = Math.max(maxY, sk[k].y); }
  minY -= 0.3; // 머리 여유
  const pad = 16;
  const sc = Math.min((c.width - pad * 2) / (maxX - minX), (c.height - pad * 2) / (maxY - minY));
  const ox = c.width / 2 - ((minX + maxX) / 2) * sc, oy = c.height / 2 - ((minY + maxY) / 2) * sc;
  const P = (i) => ({ x: ox + sk[i].x * sc, y: oy + sk[i].y * sc });
  g.lineCap = 'round'; g.strokeStyle = '#ff7a3d'; g.lineWidth = 9;
  for (const [a, b] of BONES) { const p = P(a), q = P(b); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
  for (const i of JOINTS) { const p = P(i); g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fillStyle = '#1d2433'; g.fill(); }
  const n = P(LM.nose);
  g.beginPath(); g.arc(n.x, n.y, 0.24 * sc, 0, Math.PI * 2); g.lineWidth = 7; g.stroke();
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
    const alert = j && (j.status === 'wobble' || j.invincible > 0) && m.phase === 'play';
    const anchor = drawSkeleton(lms, SIDE_COLORS[i], W, H, alert);
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
  $('startBtn').addEventListener('click', () => startApp(false));
  $('simBtn').addEventListener('click', () => startApp(true));
  $('drawBtn').addEventListener('click', drawNext);
  $('fightBtn').addEventListener('click', startMatch);
  $('nextBtn').addEventListener('click', () => { state.match = null; drawNext(); show('lobby'); });
  $('settingsBtn').addEventListener('click', () => { renderSetup(); show('setup'); });
  $('resetScoreBtn').addEventListener('click', () => {
    if (!confirm('모든 팀 점수와 기록을 0으로 만들까요?')) return;
    state.teams.forEach((t) => { t.score = 0; t.played = 0; });
    state.history = [];
    save(); renderLobby();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.screen === 'lobby') startMatch();
      else if (state.screen === 'result') $('nextBtn').click();
    } else if (e.code === 'KeyR' && state.screen === 'lobby') drawNext();
    else if (e.code === 'Escape' && state.screen === 'play') abortMatch();
  });
}

load();
renderSetup();
bind();
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('sim')) startApp(true);

// 디버그용
window.__game = state;
