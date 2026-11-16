// JOY — To Find Joy in Life
// Don't decide. Just do the next tiny thing.
import { CONFIG } from './config.js';
import { createStore } from './store.js';
import { DESIRES, DESIRE, TAG_DESIRES, ENERGY, SITUATIONS, TRANSITIONS, BRIDGE } from './data.js';
import { rank, personalNote, stepsFor, activityStats, startRate, avgJoy } from './engine.js';

const store = createStore();
const $app = document.getElementById('app');

const state = { tab: 'today', libEnergy: 'all', libQuery: '' };
let flow = null;   // 개입 흐름 (한 화면 = 한 질문 또는 한 행동)

// ------------------------------------------------------------------ 유틸
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString();
const dayOf = (iso) => kst(Date.parse(iso)).slice(0, 10);
const today = () => kst().slice(0, 10);
const hhmm = (iso) => kst(Date.parse(iso)).slice(11, 16);
const W = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (d) => {
  const diff = Math.round((Date.parse(today()) - Date.parse(d)) / 86400000);
  const base = `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 ${W[new Date(d + 'T00:00:00Z').getUTCDay()]}`;
  return diff === 0 ? `오늘 · ${base}` : diff === 1 ? `어제 · ${base}` : base;
};
const JOY_FACE = { '-2': '😫', '-1': '😕', 0: '😐', 1: '🙂', 2: '😍' };
const joyText = (j) => (j > 0 ? `+${j}` : String(j));
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} 복사했어`); }
  catch { toast('길게 눌러서 복사해 줘'); }
}

const SPROUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 13c0-4 2.6-6.5 7-6.5 0 4.2-2.7 6.5-7 6.5zM12 15.5C12 12.2 9.8 10 6 10c0 3.4 2.3 5.5 6 5.5z" fill="currentColor"/></svg>';
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const wordmark = (cls = '') => `<span class="wordmark ${cls}" aria-label="JOY">J<span class="o">O${SPROUT}</span>Y</span>`;

const settings = () => store.settings ?? { trigger_apps: [], trigger_minutes: 45, recheck_minutes: 30 };
const actById = (id) => store.activities.find((a) => a.id === id);

// ------------------------------------------------------------------ 흐름 (Transition → Activity → Joy)
function sessionPatch(p) {
  if (!flow?.session) return;
  Object.assign(flow.session, p);
  store.updateSession(flow.session.id, p).catch(() => {});
}
async function startFlow(trigger, extra = {}, first = 'energy') {
  flow = { screen: first, trigger, stoodUp: false, seed: Math.floor(Math.random() * 1e9), suggested: [], ...extra };
  render();
  try { flow.session = await store.createSession({ trigger, usage_minutes: extra.minutes ?? null }); }
  catch (e) { toast('기록은 저장되지 않았어. 그래도 계속 가자'); }
}
function go(screen, patch = {}) { Object.assign(flow, patch, { screen }); render(); window.scrollTo(0, 0); }
function closeFlow(msg) { flow = null; render(); if (msg) toast(msg); }

function suggest(a) {
  if (!flow.suggested.includes(a.id)) {
    flow.suggested.push(a.id);
    sessionPatch({ suggested: [...flow.suggested] });
  }
}
function computeRanking() {
  flow.ranked = rank(store.activities, store.sessions, { energy: flow.energy, desire: flow.desire, seed: flow.seed });
  flow.rIndex = 0;
}
function choose(a) {
  suggest(a);
  const steps = stepsFor(a, { stoodUp: flow.stoodUp });
  flow.act = a; flow.steps = steps; flow.sIndex = 0;
  sessionPatch({ activity_id: a.id, activity_name: a.name, activity_emoji: a.emoji, started: true, steps_total: steps.length, steps_done: 0 });
  go(steps.length ? 'astep' : 'doing');
}

// 화면 공통 틀: 위 닫기, 가운데 내용, 아래 버튼
const frame = (tone, body, actions = '', { close = true } = {}) => `
  <div class="flow" data-tone="${tone}">
    <header class="flow-top">${close ? `<button class="iconbtn" data-f="close" aria-label="그만두기">${X}</button>` : '<span></span>'}${wordmark('small')}<span class="pad"></span></header>
    <main class="flow-body">${body}</main>
    ${actions ? `<footer class="flow-actions">${actions}</footer>` : ''}
  </div>`;
const big = (t, s) => `<h1 class="say">${t}</h1>${s ? `<p class="say-sub">${s}</p>` : ''}`;
const btn = (label, f, cls = 'primary', data = '') => `<button class="btn ${cls}" data-f="${f}" ${data}>${label}</button>`;

function flowView() {
  const f = flow;
  switch (f.screen) {
    // --- Screen Time check
    case 'check':
      return frame('blue', `
        <p class="eyebrow">${f.minutes ? `${f.minutes}분째 보는 중` : '잠깐'}</p>
        ${big('Still having fun?')}
        <div class="options">
          <button class="opt" data-f="fun"><b>😍</b><span>Yeah, still enjoying it<small>아직 진짜 재미있음</small></span></button>
          <button class="opt" data-f="scrolling"><b>😐</b><span>Not really, just scrolling<small>그냥 자동으로 보는 중</small></span></button>
          <button class="opt" data-f="out"><b>😫</b><span>No. Get me out<small>그만하고 싶은데 못 끄겠음</small></span></button>
        </div>`);
    case 'check-fun':
      return frame('sage', big('좋아, 즐겨.', `${settings().recheck_minutes}분 뒤에 한 번만 다시 물어볼게.`), btn('계속 보기', 'close'), { close: false });
    case 'check-scroll':
      return frame('blue', big('다른 거 해볼래?'), `${btn('🌱 Yeah', 'to-energy')}${btn('📱 15 min more', 'snooze', 'soft')}`);
    case 'snoozed':
      return frame('blue', big('오케이.', '15분 동안은 안 건드릴게.'), btn('알겠어', 'close'), { close: false });

    // --- Exit Mode
    case 'exit-intro':
      return frame('blue', big('Got you.', 'Don’t think. I’ll get you out.'), btn('ㄱㄱ', 'to-situation'));
    case 'situation':
      return frame('blue', `${big('지금 어디야?')}
        <div class="options grid2">${SITUATIONS.map((s) => `<button class="opt tile" data-f="situation" data-v="${s.key}"><b>${s.emoji}</b><span>${s.label}</span></button>`).join('')}</div>`);
    case 'tstep': {
      const st = TRANSITIONS[f.situation][f.tIndex];
      return frame('blue', big(esc(st.t), st.s ? esc(st.s) : ''), `${btn(st.b, 'tdone')}<button class="skip" data-f="tskip">이건 패스</button>`);
    }
    case 'bridge':
      return frame('blue', big(BRIDGE.t, BRIDGE.s), btn(BRIDGE.b, 'to-energy'));

    // --- Activity Engine
    case 'energy':
      return frame('butter', `${big('지금 에너지 몇이야?')}
        <div class="energy">${ENERGY.map((e) => `<button class="erow" data-f="energy" data-v="${e.n}"><b>${e.n}${e.n === 0 ? ' 🪫' : e.n === 5 ? ' 🔋' : ''}</b><span>${e.label}</span></button>`).join('')}</div>`);
    case 'desire':
      return frame('butter', `${big('지금 뭐가 제일 당겨?')}
        <div class="options">${DESIRES.map((d) => `<button class="opt" data-f="desire" data-v="${d.key}"><b>${d.emoji}</b><span>${d.label}</span></button>`).join('')}
          <button class="opt none" data-f="nodesire"><b>🖤</b><span>아무것도 안 끌려</span></button></div>`);
    case 'rec': {
      if (!f.ranked.length) return frame('sage', big('지금 조건에 맞는 활동이 없어.', '에너지를 하나 올리거나 다른 느낌으로 골라 볼래?'), btn('다시 고르기', 'to-energy'));
      const r = f.ranked[f.rIndex % f.ranked.length];
      suggest(r.a);
      const note = personalNote(r.a, store.sessions, f.energy);
      return frame('sage', `
        <p class="eyebrow">${f.desire === 'random' ? '골라봤어' : `${DESIRE[f.desire]?.emoji ?? ''} 이거 어때?`}</p>
        <div class="act-card"><span class="act-emoji">${esc(r.a.emoji || '🌱')}</span><h1 class="say">${esc(r.a.name)}</h1>
          <p class="act-meta">${actMeta(r.a)}</p>
          ${note ? `<p class="note">이런 상태에서 지난 ${note.n}번 중 ${note.good}번 기분이 나아졌어.</p>` : ''}</div>`,
        `${btn('이거 할래', 'choose', 'primary', `data-v="${r.a.id}"`)}${f.ranked.length > 1 ? btn('다른 거', 'next', 'soft') : ''}<button class="skip" data-f="to-pick">목록에서 고를래</button>`);
    }
    case 'pick':
      return frame('sage', `${big('하나만 골라.')}
        <div class="picklist">${f.ranked.slice(0, 15).map((r) => `<button class="pick" data-f="choose" data-v="${r.a.id}"><b>${esc(r.a.emoji || '🌱')}</b><span>${esc(r.a.name)}<small>${actMeta(r.a)}</small></span></button>`).join('')}</div>`);

    // --- NO DESIRE MODE
    case 'nodesire':
      return frame('sage', big('Okay. 그럼 고르지 마.', '지금 뭘 하고 싶은지 알아낼 필요 없어.<br>내가 하나 정해줄게.'), btn('응', 'nd-pick'));
    case 'nd-pick': {
      if (!f.ranked.length) return frame('sage', big('일단 물 한 모금만 마시자.'), btn('했어', 'close'));
      const r = f.ranked[f.rIndex % f.ranked.length];
      suggest(r.a);
      const note = personalNote(r.a, store.sessions, f.energy);
      return frame('sage', `
        ${note ? `<p class="eyebrow">지난 ${note.n}번 중 ${note.good}번 이걸로 나아졌어</p>` : ''}
        <div class="act-card"><span class="act-emoji">${esc(r.a.emoji || '🌱')}</span>
          <h1 class="say">일단 ${esc(r.a.name)}${/[가-힣]$/.test(r.a.name) ? '만 하자.' : ''}</h1>
          ${note ? '<p class="note">오늘도 그걸로 갈까?</p>' : ''}</div>`,
        `${btn(note ? 'ㅇㅇ 시켜줘' : '시작 →', 'choose', 'primary', `data-v="${r.a.id}"`)}<button class="skip" data-f="next">이건 아니야</button>`);
    }

    // --- 실행
    case 'astep': {
      const s = f.steps[f.sIndex];
      const first = f.sIndex === 0 && !f.stoodUp;
      return frame('sage', `${first ? `<p class="eyebrow">${esc(f.act.emoji || '')} ${esc(f.act.name)}</p>` : ''}${big(esc(s.t) + (s.t.endsWith('.') ? '' : '.'), first ? '폰 계속 들고 있어도 돼.' : '')}`,
        `${btn(f.sIndex === f.steps.length - 1 ? 'ㄱㄱ' : '했어', 'adone')}<button class="skip" data-f="askip">이건 패스</button>`);
    }
    case 'doing':
      return frame('sage', `<div class="act-card"><span class="act-emoji">${esc(f.act.emoji || '🌱')}</span>${big(`이제 ${esc(f.act.name)}.`, '다 하면 눌러줘. 앱은 꺼도 돼.')}</div>`,
        `${btn('다 했어', 'finished')}<button class="skip" data-f="quit">오늘은 여기까지</button>`, { close: false });
    case 'rate':
      return frame('peach', `${big('생각보다 어땠어?')}
        <div class="rate">${[-2, -1, 0, 1, 2].map((j) => `<button class="rbtn" data-f="rate" data-v="${j}" aria-label="${joyText(j)}"><b>${JOY_FACE[j]}</b><small>${joyText(j)}</small></button>`).join('')}</div>`, '', { close: false });
    case 'done':
      return frame('peach', `<div class="done-mark">${SPROUT}</div>${big('좋아.', '현실로 한 번 돌아왔어.')}`, btn('홈으로', 'close'), { close: false });
  }
  return '';
}

function actMeta(a) {
  const parts = [a.place === 'out' ? '밖' : '집', a.minutes ? `약 ${a.minutes >= 60 ? `${Math.round(a.minutes / 6) / 10}시간` : `${a.minutes}분`}` : null, a.prep ? '준비 조금' : null, a.cost ? '돈 조금' : null];
  return parts.filter(Boolean).join(' · ');
}

async function onFlow(el) {
  const f = flow;
  const v = el.dataset.v;
  switch (el.dataset.f) {
    case 'close': return closeFlow();
    case 'fun':
      sessionPatch({ check_answer: 'fun', finished_at: new Date().toISOString() });
      store.setNextCheck(settings().recheck_minutes).catch(() => {});
      return go('check-fun');
    case 'scrolling': sessionPatch({ check_answer: 'scrolling' }); return go('check-scroll');
    case 'snooze':
      store.setNextCheck(15).catch(() => {});
      sessionPatch({ finished_at: new Date().toISOString() });
      return go('snoozed');
    case 'out':
      sessionPatch({ check_answer: 'out' });
      store.setNextCheck(settings().recheck_minutes).catch(() => {});
      return go('exit-intro');
    case 'to-situation': return go('situation');
    case 'situation': sessionPatch({ situation: v }); return go('tstep', { situation: v, tIndex: 0, tDone: 0 });
    case 'tdone': case 'tskip': {
      if (el.dataset.f === 'tdone') f.tDone++;
      if (f.tIndex + 1 < TRANSITIONS[f.situation].length) return go('tstep', { tIndex: f.tIndex + 1 });
      const ok = f.tDone >= TRANSITIONS[f.situation].length - 1;
      sessionPatch({ transition_done: ok });
      return go('bridge', { stoodUp: f.situation !== 'working' || ok });
    }
    case 'to-energy':
      if (f.screen === 'check-scroll') store.setNextCheck(settings().recheck_minutes).catch(() => {});
      return go('energy');
    case 'energy': sessionPatch({ energy: Number(v) }); return go('desire', { energy: Number(v) });
    case 'desire':
      sessionPatch({ desire: v });
      flow.desire = v; computeRanking(); return go('rec');
    case 'nodesire':
      sessionPatch({ desire: 'none' });
      if (flow.session && flow.trigger === 'manual') sessionPatch({ trigger: 'nodesire' });
      flow.desire = 'none'; computeRanking(); return go('nodesire');
    case 'nd-pick': return go('nd-pick');
    case 'next': flow.rIndex++; return render();
    case 'to-pick': return go('pick');
    case 'choose': return choose(actById(v));
    case 'adone': case 'askip': {
      if (el.dataset.f === 'adone') sessionPatch({ steps_done: (f.session?.steps_done ?? 0) + 1 });
      if (f.steps[f.sIndex]?.up) f.stoodUp = true;
      if (f.sIndex + 1 < f.steps.length) return go('astep', { sIndex: f.sIndex + 1 });
      return go('doing');
    }
    case 'finished':
      sessionPatch({ completed: true, finished_at: new Date().toISOString() });
      return go('rate');
    case 'quit':
      sessionPatch({ completed: false, finished_at: new Date().toISOString() });
      return closeFlow('오케이. 여기까지도 한 거야.');
    case 'rate':
      sessionPatch({ joy: Number(v) });
      return go('done');
  }
}

// ------------------------------------------------------------------ 탭 화면
const doneToday = () => store.sessions.filter((s) => s.completed && dayOf(s.finished_at ?? s.created_at) === today());
// 시작했는데 아직 평가 안 한 것 (12시간 안)
const pending = () => store.sessions.find((s) => s.started && !s.finished_at && s.joy == null && s.activity_name
  && Date.now() - Date.parse(s.created_at) < 12 * 3600000);

function todayView() {
  const list = doneToday();
  const p = pending();
  return `
  <header class="home-top">${wordmark()}<p class="tag">Don’t decide. Just do the next tiny thing.</p></header>
  ${p ? `<section class="pending">
      <p>아까 <b>${esc(p.activity_emoji || '')} ${esc(p.activity_name)}</b> 했어?</p>
      <div class="row2"><button class="btn small" data-a="pend-yes" data-v="${p.id}">했어</button><button class="btn small soft" data-a="pend-no" data-v="${p.id}">안 했어</button></div>
    </section>` : ''}
  <section class="regained">
    <p class="rg-label">${SPROUT}오늘 현실로 돌아온 횟수</p>
    <p class="rg-num">${list.length}<small>번</small></p>
    ${list.length ? `<ul class="rg-list">${list.map((s) => `<li><span>${esc(s.activity_emoji || '🌱')} ${esc(s.activity_name ?? '')}</span><b>${s.joy != null ? `${JOY_FACE[s.joy]} ${joyText(s.joy)}` : ''}</b></li>`).join('')}</ul>`
      : '<p class="rg-empty">아직 0번이어도 괜찮아. 지금 한 번 해 보자.</p>'}
  </section>
  <div class="home-actions">
    <button class="cta help" data-a="help"><b>🛟</b><span>HELP ME GET OUT<small>폰에서 못 빠져나오겠을 때</small></span></button>
    <button class="cta what" data-a="what"><b>🌱</b><span>지금 뭐 할까?<small>뭔가 하고 싶은데 모르겠을 때</small></span></button>
  </div>`;
}

function historyView() {
  const st = activityStats(store.sessions);
  const best = store.activities.map((a) => ({ a, x: st.get(a.id) })).filter(({ x }) => x && x.joyN >= 2)
    .sort((p, q) => avgJoy(q.x) - avgJoy(p.x) || startRate(q.x) - startRate(p.x)).slice(0, 5);
  const days = new Map();
  for (const s of store.sessions) {
    if (!s.activity_name && !s.check_answer) continue;
    const d = dayOf(s.created_at);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(s);
  }
  const TRIG = { screen: '📱', help: '🛟', manual: '🌱', nodesire: '🖤' };
  const total = store.sessions.filter((s) => s.completed).length;
  return `
  <header class="page-top"><h1>Joy History</h1><p>지금까지 현실로 돌아온 횟수 <b>${total}번</b></p></header>
  ${best.length ? `<section><h2>나한테 잘 맞았던 것</h2><ul class="cardlist">${best.map(({ a, x }) => `
    <li><span class="li-emoji">${esc(a.emoji || '🌱')}</span><span class="li-body"><b>${esc(a.name)}</b><small>평균 ${joyText(Math.round(avgJoy(x) * 10) / 10)} · 시작률 ${Math.round(startRate(x) * 100)}% · ${x.started}번</small></span></li>`).join('')}</ul></section>` : ''}
  ${days.size ? [...days].map(([d, list]) => `
    <section><h2>${dayLabel(d)}</h2><ul class="cardlist">${list.map((s) => `
      <li><span class="li-time">${hhmm(s.created_at)}</span><span class="li-emoji">${TRIG[s.trigger] ?? ''}</span>
        <span class="li-body"><b>${s.activity_name ? `${esc(s.activity_emoji || '')} ${esc(s.activity_name)}` : s.check_answer === 'fun' ? '재밌게 보는 중이었음' : '그냥 넘어감'}</b>
        <small>${[s.energy != null ? `에너지 ${s.energy}` : '', s.desire && DESIRE[s.desire] ? DESIRE[s.desire].emoji : s.desire === 'none' ? '🖤' : '', s.usage_minutes ? `${s.usage_minutes}분 보다가` : ''].filter(Boolean).join(' · ')}</small></span>
        <span class="li-joy">${s.joy != null ? `${JOY_FACE[s.joy]}<small>${joyText(s.joy)}</small>` : s.completed ? '' : s.started && s.finished_at ? '<small>못 함</small>' : ''}</span></li>`).join('')}</ul></section>`).join('')
    : '<p class="empty">아직 기록이 없어. 홈에서 한 번 시작해 보자.</p>'}`;
}

function activitiesView() {
  const st = activityStats(store.sessions);
  const q = state.libQuery.trim();
  const list = store.activities
    .filter((a) => state.libEnergy === 'all' || state.libEnergy === 'fav' ? true : a.energy_min <= Number(state.libEnergy) && Number(state.libEnergy) <= a.energy_max)
    .filter((a) => state.libEnergy !== 'fav' || a.favorite)
    .filter((a) => !q || a.name.includes(q))
    .sort((a, b) => (b.favorite - a.favorite) || (a.energy_min - b.energy_min) || (a.sort - b.sort));
  const chips = [['all', '전체'], ['fav', '★'], ...[0, 1, 2, 3, 4, 5].map((n) => [String(n), `${n}`])];
  return `
  <header class="page-top"><h1>Activities</h1><p>활동 ${store.activities.length}개 · 에너지에 맞는 걸 추천해</p></header>
  <div class="lib-tools">
    <input class="search" type="search" id="lib-q" placeholder="활동 찾기" value="${esc(state.libQuery)}" autocomplete="off">
    <button class="btn small" data-a="act-new">＋ 추가</button>
  </div>
  <div class="chips" role="tablist" aria-label="에너지">${chips.map(([v, l]) => `<button role="tab" data-a="lib-energy" data-v="${v}" aria-selected="${state.libEnergy === v}">${v !== 'all' && v !== 'fav' ? `<small>에너지</small>` : ''}${l}</button>`).join('')}</div>
  ${list.length ? `<ul class="cardlist acts">${list.map((a) => {
    const x = st.get(a.id);
    return `<li class="${a.active ? '' : 'off'}">
      <button class="act-row" data-a="act-edit" data-v="${a.id}">
        <span class="li-emoji">${esc(a.emoji || '🌱')}</span>
        <span class="li-body"><b>${esc(a.name)}</b><small>에너지 ${a.energy_min === a.energy_max ? a.energy_min : `${a.energy_min}~${a.energy_max}`} · ${a.desires.map((d) => DESIRE[d]?.emoji ?? '').join('')}${x?.started ? ` · ${x.started}번${avgJoy(x) != null ? ` · 평균 ${joyText(Math.round(avgJoy(x) * 10) / 10)}` : ''}` : ''}${a.active ? '' : ' · 쉬는 중'}</small></span>
      </button>
      <button class="star ${a.favorite ? 'on' : ''}" data-a="fav" data-v="${a.id}" aria-label="즐겨찾기" aria-pressed="${a.favorite}">★</button>
    </li>`;
  }).join('')}</ul>` : '<p class="empty">찾는 활동이 없어. 직접 추가해 볼래?</p>'}`;
}

function settingsView() {
  const s = settings();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const APPS = ['Instagram', 'YouTube', 'TikTok', '커뮤니티', '쇼핑 앱'];
  const custom = (s.trigger_apps ?? []).filter((a) => !APPS.includes(a));
  const url = store.hookUrl();
  const body = (ev) => JSON.stringify({ action: 'joy-event', token: s.hook_token, event: ev });
  let push;
  if (store.demo) push = '<p class="hint">데모에서는 알림이 오지 않아.</p>';
  else if (isIOS() && !isStandalone()) push = '<p class="hint">알림을 받으려면 Safari 공유 버튼 → <b>홈 화면에 추가</b> 후, 홈 화면의 JOY 로 다시 열어 줘.</p>';
  else if (!('PushManager' in window)) push = '<p class="hint">이 브라우저는 알림을 지원하지 않아. iOS 16.4 이상이 필요해.</p>';
  else push = `<p class="hint">${perm === 'granted' ? '알림 켜져 있어.' : perm === 'denied' ? '알림이 꺼져 있어. 아이폰 설정 › 알림 › JOY 에서 켜 줘.' : '아직 알림을 안 켰어.'}</p>
    <div class="row2">${perm !== 'denied' ? `<button class="btn small" data-a="push">${perm === 'granted' ? '이 기기 다시 등록' : '알림 켜기'}</button>` : ''}${perm === 'granted' ? '<button class="btn small soft" data-a="test-push">알림으로 받아보기</button>' : ''}</div>`;
  return `
  <header class="page-top"><h1>Settings</h1></header>
  <section class="card">
    <h2>Still having fun? 언제 물어볼까</h2>
    <p class="hint">자꾸 오래 보게 되는 앱</p>
    <div class="chips wrap">${APPS.map((a) => `<button data-a="app-toggle" data-v="${esc(a)}" aria-pressed="${(s.trigger_apps ?? []).includes(a)}">${a}</button>`).join('')}
      ${custom.map((a) => `<button data-a="app-toggle" data-v="${esc(a)}" aria-pressed="true">${esc(a)} ×</button>`).join('')}
      <button data-a="app-add" class="add">＋ 직접</button></div>
    <p class="hint">연속으로 이만큼 보면 물어볼게</p>
    <div class="seg">${[30, 45, 60, 90].map((m) => `<button data-a="minutes" data-v="${m}" aria-pressed="${s.trigger_minutes === m}">${m}분</button>`).join('')}</div>
    <p class="hint">"즐기는 중"이라고 하면 다시 물어보기까지</p>
    <div class="seg">${[15, 30, 60].map((m) => `<button data-a="recheck" data-v="${m}" aria-pressed="${s.recheck_minutes === m}">${m}분</button>`).join('')}</div>
    <button class="btn small soft wide" data-a="preview-check">화면 미리 보기</button>
  </section>
  <section class="card">
    <h2>알림</h2>
    ${push}
  </section>
  <section class="card">
    <h2>아이폰 단축어 연결</h2>
    <p class="hint">아이폰은 다른 앱 사용 시간을 웹앱에 주지 않아서, 단축어가 고른 앱이 <b>열릴 때·닫힐 때</b> JOY 에 알려 줘. 그러면 연속 ${s.trigger_minutes}분이 됐을 때 알림이 와. 앱을 막지는 않아.</p>
    <details class="guide">
      <summary>설정 방법 보기 (5분)</summary>
      <ol>
        <li><b>단축어</b> 앱 → 아래 <b>자동화</b> → <b>＋</b> (또는 새로운 자동화)</li>
        <li><b>앱</b> 선택 → <b>앱 선택</b>에서 ${(s.trigger_apps ?? []).length ? esc(s.trigger_apps.join(', ')) : '자꾸 오래 보는 앱'} 고르기</li>
        <li><b>열려 있음</b>만 체크, <b>즉시 실행</b> 선택 (실행 시 알림 끄기) → 다음</li>
        <li><b>새로운 빈 자동화</b> → 동작 추가에서 <b>URL 콘텐츠 가져오기</b></li>
        <li>URL 에 아래 주소 붙여넣기</li>
      </ol>
      <div class="copybox"><code>${esc(url)}</code><button class="btn small soft" data-a="copy" data-v="${esc(url)}" data-l="주소">복사</button></div>
      <ol start="6">
        <li>동작의 <b>›</b> 펼치기 → 방법 <b>POST</b>, 요청 본문 <b>JSON</b></li>
        <li><b>새로운 필드 추가 → 텍스트</b> 로 3개 넣기 (키 / 값)</li>
      </ol>
      <div class="kv"><span>action</span><code>joy-event</code><span>token</span><code>${esc(s.hook_token ?? '')}</code><span>event</span><code>open</code></div>
      <div class="row2"><button class="btn small soft" data-a="copy" data-v="${esc(s.hook_token ?? '')}" data-l="토큰">토큰 복사</button></div>
      <ol start="8">
        <li>완료. 같은 방법으로 자동화를 하나 더 만들고, 3번에서 <b>닫혀 있음</b>, 7번 event 값은 <b>close</b> 로</li>
      </ol>
      <p class="hint">토큰은 비밀번호 같은 거라 다른 사람한테 보내지 마.</p>
    </details>
  </section>
  ${store.demo ? `<section class="card"><h2>데모</h2><p class="hint">지금은 이 기기에만 저장돼.</p><button class="btn small soft" data-a="demo-reset">예시 데이터로 초기화</button></section>`
    : '<section class="card"><button class="btn small soft" data-a="logout">로그아웃</button></section>'}`;
}

// ------------------------------------------------------------------ 활동 추가/수정 시트
function openActivitySheet(a) {
  const isNew = !a;
  const it = a ?? { name: '', emoji: '🌱', energy_min: 1, energy_max: 2, desires: [], place: 'in', minutes: 10, prep: false, cost: false, custom: true, favorite: false, active: true, steps: [], sort: store.activities.length };
  const x = a ? activityStats(store.sessions).get(a.id) : null;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet" role="dialog" aria-modal="true" aria-label="${isNew ? '활동 추가' : '활동 수정'}">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head"><button type="button" class="link" data-close>취소</button><h2>${isNew ? '활동 추가' : '활동'}</h2><button type="submit" class="link strong">저장</button></div>
    <div class="name-row"><input class="emoji-in" name="emoji" id="act-emoji" value="${esc(it.emoji ?? '')}" maxlength="4" aria-label="이모지"><input class="name-in" name="name" id="act-name" value="${esc(it.name)}" placeholder="활동 이름" maxlength="60" required autocomplete="off"></div>
    ${x ? `<p class="stats">${x.started}번 함 · 시작률 ${startRate(x) != null ? Math.round(startRate(x) * 100) + '%' : '–'} · 평균 Joy ${avgJoy(x) != null ? joyText(Math.round(avgJoy(x) * 10) / 10) : '–'}</p>` : ''}
    <div class="field"><span>언제 할 수 있어? <small>에너지</small></span>
      <div class="echips">${[0, 1, 2, 3, 4, 5].map((n) => `<button type="button" data-e="${n}" aria-pressed="${n >= it.energy_min && n <= it.energy_max}">${n}</button>`).join('')}</div></div>
    <div class="field"><span>어떤 느낌일 때 잘 맞아?</span>
      <div class="dchips">${TAG_DESIRES.map((d) => `<button type="button" data-d="${d.key}" aria-pressed="${it.desires.includes(d.key)}" title="${d.label}">${d.emoji}<small>${d.label.replace(/ (싶어|하고 싶어)$/, '').replace('몸을 좀 ', '').replace('기분을 ', '').replace('뭔가 ', '')}</small></button>`).join('')}</div></div>
    <div class="field two">
      <div><span>어디서</span><div class="seg">${[['in', '집'], ['out', '밖']].map(([v, l]) => `<button type="button" data-place="${v}" aria-pressed="${it.place === v}">${l}</button>`).join('')}</div></div>
      <label><span>시간 <small>분</small></span><input type="number" name="minutes" id="act-min" min="1" max="1440" inputmode="numeric" value="${it.minutes ?? ''}"></label>
    </div>
    <div class="toggles">
      <label><input type="checkbox" name="prep" ${it.prep ? 'checked' : ''}><span>준비가 좀 필요해</span></label>
      <label><input type="checkbox" name="cost" ${it.cost ? 'checked' : ''}><span>돈이 들어</span></label>
      <label><input type="checkbox" name="favorite" ${it.favorite ? 'checked' : ''}><span>즐겨찾기</span></label>
      <label><input type="checkbox" name="active" ${it.active ? 'checked' : ''}><span>추천에 넣기</span></label>
    </div>
    <div class="field"><span>시작하기 어렵다면 작은 단계 <small>한 번에 하나씩 보여줘</small></span>
      <ol class="steps" data-steps></ol>
      <button type="button" class="link add-step" data-add-step>＋ 단계 추가</button></div>
    ${isNew ? '' : '<button type="button" class="btn danger wide" data-del>삭제</button>'}
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));

  let steps = (it.steps ?? []).map((s) => ({ ...s }));
  const ol = form.querySelector('[data-steps]');
  const drawSteps = () => {
    ol.innerHTML = steps.map((s, i) => `<li><input value="${esc(s.t)}" data-si="${i}" maxlength="60" placeholder="예: 현관까지만 가기" aria-label="${i + 1}단계">
      <button type="button" data-up="${i}" aria-label="위로" ${i ? '' : 'disabled'}>↑</button><button type="button" data-rm="${i}" aria-label="삭제">×</button></li>`).join('');
  };
  drawSteps();
  ol.addEventListener('input', (e) => { const i = e.target.dataset.si; if (i != null) steps[i].t = e.target.value; });
  ol.addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]'), rm = e.target.closest('[data-rm]');
    if (up) { const i = Number(up.dataset.up); [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); }
    if (rm) { steps.splice(Number(rm.dataset.rm), 1); drawSteps(); }
  });
  form.querySelector('[data-add-step]').addEventListener('click', () => { steps.push({ t: '' }); drawSteps(); ol.querySelector('li:last-child input').focus(); });

  form.addEventListener('click', (e) => {
    const eb = e.target.closest('[data-e]'), db = e.target.closest('[data-d]'), pb = e.target.closest('[data-place]');
    if (eb) {
      // 고른 숫자들 사이를 채워서 범위로
      eb.setAttribute('aria-pressed', eb.getAttribute('aria-pressed') !== 'true');
      const on = [...form.querySelectorAll('[data-e][aria-pressed="true"]')].map((b) => Number(b.dataset.e));
      if (on.length) { const lo = Math.min(...on), hi = Math.max(...on); form.querySelectorAll('[data-e]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.e) >= lo && Number(b.dataset.e) <= hi)); }
    }
    if (db) db.setAttribute('aria-pressed', db.getAttribute('aria-pressed') !== 'true');
    if (pb) form.querySelectorAll('[data-place]').forEach((b) => b.setAttribute('aria-pressed', b === pb));
  });

  const del = form.querySelector('[data-del]');
  del?.addEventListener('click', async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제돼'; return; }
    try { await store.deleteActivity(a.id); close(); render(); toast('삭제했어'); } catch (err) { toast(err.message); }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const es = [...form.querySelectorAll('[data-e][aria-pressed="true"]')].map((b) => Number(b.dataset.e));
    const desires = [...form.querySelectorAll('[data-d][aria-pressed="true"]')].map((b) => b.dataset.d);
    if (!f.name.value.trim()) return;
    if (!es.length) { toast('에너지를 하나 이상 골라 줘'); return; }
    if (!desires.length) { toast('느낌을 하나 이상 골라 줘'); return; }
    const data = {
      ...(isNew ? {} : { id: a.id }), name: f.name.value.trim(), emoji: f.emoji.value.trim() || '🌱',
      energy_min: Math.min(...es), energy_max: Math.max(...es), desires,
      place: form.querySelector('[data-place][aria-pressed="true"]')?.dataset.place ?? 'in',
      minutes: Number(f.minutes.value) || null, prep: f.prep.checked, cost: f.cost.checked, favorite: f.favorite.checked, active: f.active.checked,
      steps: steps.filter((s) => s.t.trim()).map((s) => ({ t: s.t.trim(), ...(s.up ? { up: true } : {}) })),
      custom: isNew ? true : it.custom, sort: it.sort,
    };
    try { await store.saveActivity(data); close(); render(); toast(isNew ? '추가했어' : '저장했어'); } catch (err) { toast(err.message); }
  });
}

// ------------------------------------------------------------------ 온보딩
function onboardingView(step) {
  const s = settings();
  const APPS = ['Instagram', 'YouTube', 'TikTok', '커뮤니티', '쇼핑 앱'];
  if (step === 0) return frame('sage', `<div class="hero-mark">${wordmark('hero')}</div>
    ${big('Don’t decide.<br>Just do the next tiny thing.', '폰에서 현실로 넘어가는 그 사이를 도와줄게.<br>혼내지도, 막지도 않아.')}`, btn('시작', 'ob-1'), { close: false });
  if (step === 1) return frame('butter', `${big('자꾸 오래 보게 되는 앱 있어?', '여러 개 골라도 돼. 나중에 바꿀 수 있어.')}
    <div class="chips wrap big">${APPS.map((a) => `<button data-f="ob-app" data-v="${a}" aria-pressed="${(s.trigger_apps ?? []).includes(a)}">${a}</button>`).join('')}</div>`, btn('다음', 'ob-2'), { close: false });
  if (step === 2) return frame('blue', `${big('연속으로 얼마나 보면<br>물어볼까?', '그때 "Still having fun?" 하고 한 번 물어볼게.')}
    <div class="seg big">${[30, 45, 60, 90].map((m) => `<button data-f="ob-min" data-v="${m}" aria-pressed="${(s.trigger_minutes ?? 45) === m}">${m}분</button>`).join('')}</div>`, btn('다음', 'ob-3'), { close: false });
  return frame('peach', `<div class="done-mark">${SPROUT}</div>${big('준비됐어.', '심심하거나, 못 빠져나오겠으면<br>홈에서 버튼 하나만 눌러.')}`, btn('홈으로', 'ob-done'), { close: false });
}
let ob = null;   // 온보딩 단계 (null = 안 함)

async function onOnboarding(el) {
  const v = el.dataset.v;
  const s = settings();
  switch (el.dataset.f) {
    case 'ob-1': ob = 1; break;
    case 'ob-app': {
      const apps = new Set(s.trigger_apps ?? []);
      apps.has(v) ? apps.delete(v) : apps.add(v);
      store.settings = { ...s, trigger_apps: [...apps] };
      break;
    }
    case 'ob-2': ob = 2; break;
    case 'ob-min': store.settings = { ...s, trigger_minutes: Number(v) }; break;
    case 'ob-3':
      ob = 3;
      try {
        await store.saveSettings({ trigger_apps: s.trigger_apps ?? [], trigger_minutes: s.trigger_minutes ?? 45 });
        await store.seedActivities();
      } catch (e) { toast(e.message); }
      break;
    case 'ob-done':
      ob = null;
      try { await store.saveSettings({ onboarded: true }); } catch (e) { toast(e.message); }
      break;
  }
  render();
}

// ------------------------------------------------------------------ 렌더
function render() {
  if (!store.me) return;
  document.documentElement.classList.toggle('in-flow', Boolean(flow || ob != null));
  if (ob != null) { $app.innerHTML = onboardingView(ob); return; }
  if (flow) { $app.innerHTML = flowView(); return; }
  const tabs = [['today', 'Today'], ['activities', 'Activities'], ['history', 'Joy History'], ['settings', 'Settings']];
  const view = { today: todayView, activities: activitiesView, history: historyView, settings: settingsView }[state.tab]();
  $app.innerHTML = `
    ${store.demo ? '<div class="demo-banner">데모 · 이 기기에만 저장돼</div>' : ''}
    <div class="screen">${view}</div>
    <nav class="tabbar">${tabs.map(([v, l]) => `<button data-a="tab" data-v="${v}" aria-current="${state.tab === v ? 'page' : 'false'}">${l}</button>`).join('')}</nav>`;
}

// ------------------------------------------------------------------ 이벤트
$app.addEventListener('click', async (e) => {
  const fe = e.target.closest('[data-f]');
  if (fe && ob != null) return onOnboarding(fe);
  if (fe && flow) return onFlow(fe);
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const v = el.dataset.v;
  const s = settings();
  try {
    switch (el.dataset.a) {
      case 'tab': state.tab = v; render(); window.scrollTo(0, 0); break;
      case 'help': await startFlow('help', {}, 'exit-intro'); break;
      case 'what': await startFlow('manual', {}, 'energy'); break;
      case 'pend-yes': {
        const p = store.sessions.find((x) => x.id === v);
        flow = { screen: 'rate', session: p, act: actById(p.activity_id) ?? { name: p.activity_name, emoji: p.activity_emoji }, suggested: p.suggested ?? [] };
        sessionPatch({ completed: true, finished_at: new Date().toISOString() });
        render(); break;
      }
      case 'pend-no': await store.updateSession(v, { completed: false, finished_at: new Date().toISOString() }); render(); break;
      case 'lib-energy': state.libEnergy = v; render(); break;
      case 'act-new': openActivitySheet(null); break;
      case 'act-edit': openActivitySheet(actById(v)); break;
      case 'fav': { const a = actById(v); await store.saveActivity({ ...a, favorite: !a.favorite }); render(); break; }
      case 'app-toggle': {
        const apps = new Set(s.trigger_apps ?? []);
        apps.has(v) ? apps.delete(v) : apps.add(v);
        await store.saveSettings({ trigger_apps: [...apps] }); render(); break;
      }
      case 'app-add': {
        const name = (window.prompt?.('앱 이름') ?? '').trim();
        if (name) { await store.saveSettings({ trigger_apps: [...new Set([...(s.trigger_apps ?? []), name.slice(0, 30)])] }); render(); }
        break;
      }
      case 'minutes': await store.saveSettings({ trigger_minutes: Number(v) }); render(); toast(`연속 ${v}분이면 물어볼게`); break;
      case 'recheck': await store.saveSettings({ recheck_minutes: Number(v) }); render(); break;
      case 'preview-check': await startFlow('screen', { minutes: s.trigger_minutes }, 'check'); break;
      case 'push': await enablePush(); break;
      case 'test-push': { const r = await store.callFn({ action: 'joy-test', minutes: s.trigger_minutes }); toast(r?.sent ? '알림 보냈어. 눌러 봐' : '등록된 기기가 없어. 알림을 다시 켜 줘'); break; }
      case 'copy': await copy(v, el.dataset.l); break;
      case 'demo-reset': store.reset(); render(); toast('초기화했어'); break;
      case 'logout': await store.signOut(); location.reload(); break;
    }
  } catch (err) { toast(err.message || '문제가 생겼어'); }
});
$app.addEventListener('input', (e) => {
  if (e.target.id === 'lib-q') {
    state.libQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = document.getElementById('lib-q'); q.focus(); q.setSelectionRange(pos, pos);
  }
});

// ------------------------------------------------------------------ 알림
function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { render(); toast('알림이 허용되지 않았어'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await store.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  render(); toast('알림 켰어');
}

// 알림을 눌러서 열렸을 때 (?check=45) → Still having fun?
function handleOpenUrl(href) {
  const u = new URL(href, location.href);
  const m = u.searchParams.get('check');
  if (m != null && store.me && ob == null) startFlow('screen', { minutes: Number(m) || null }, 'check');
  if (u.search) history.replaceState(null, '', location.pathname);
}

// ------------------------------------------------------------------ 로그인 · 시작
function loginView(msg = '') {
  document.documentElement.classList.add('in-flow');
  $app.innerHTML = `
  <div class="flow" data-tone="sage"><main class="flow-body login">
    <div class="hero-mark">${wordmark('hero')}</div>
    <p class="say-sub">To find joy in life</p>
    <form id="login">
      <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label>
      ${msg ? `<p class="error">${esc(msg)}</p>` : ''}
      <button class="btn primary" type="submit">로그인</button>
      <p class="hint">우리할일과 같은 계정이야.</p>
    </form>
  </main></div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    e.target.querySelector('button').disabled = true;
    try { await store.signIn(f.email.value.trim(), f.password.value); afterReady(); } catch (err) { loginView(err.message); }
  });
}

function afterReady() {
  if (!store.settings?.onboarded) ob = 0;
  render();
  handleOpenUrl(location.href);
}

(async function start() {
  if ('serviceWorker' in navigator && !store.demo) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') handleOpenUrl(e.data.url); });
  }
  store.onChange = () => { if (!flow && ob == null) render(); };
  try {
    const { needLogin } = await store.init();
    if (needLogin) loginView(); else afterReady();
  } catch (e) { loginView(e.message); }
})();
