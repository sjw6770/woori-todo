import { CONFIG } from './config.js';
import { createStore } from './store.js';
import {
  nowKST, addDays, dow, occursOn, isDone, overdue, toMin, repeatLabel,
} from './schedule.js';
import {
  DIFF, DIFF_KEYS, xpOf, questType, QUEST_LABEL, earnerOf, levelInfo, xpToReach, LEVEL_BASE, LEVEL_STEP,
} from './quest.js';
import { PROFILES, profileOf, MOOD_EMOJIS, emojiLabel, series, average, chartSVG } from './mood.js';

const store = createStore();
const $app = document.getElementById('app');
const W = ['일', '월', '화', '수', '목', '금', '토'];
const SHARED = '#2f9e7a';

const state = {
  view: 'today',          // today | upcoming | level | settings
  date: nowKST().date,     // 오늘 화면에서 보고 있는 날짜
  filter: 'all',           // all | <memberId> | shared
  lvWho: null,             // 레벨 화면에서 보고 있는 사람 (null = 나)
  calmHidden: null,        // "잠깐 닫기"한 진정하기 세션 id
  moodWho: null,           // 감정 화면에서 보고 있는 사람 (null = 나)
  moodRange: 7,            // 그래프 기간 7 | 30
  moodKeys: {},            // 그래프에 보이는 항목 (기록 방식별, 없으면 기본값)
  upTab: 'list',           // 일정 탭: list | places
  placeQuery: '', placeResults: null, placeSearching: false, placeFilter: 'want', placeTag: null,
};

// ------------------------------------------------------------------ 유틸
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => nowKST().date;
const md = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const longDate = (d) => `${md(d)} ${W[dow(d)]}요일`;
const hm = (t) => (t ? t.slice(0, 5) : '');
const member = (id) => store.members.find((m) => m.id === id);
const partner = () => store.members.find((m) => m.id !== store.me.id);
const colorsOf = (item) => (item.owner ? [member(item.owner)?.color, member(item.owner)?.color] : store.members.map((m) => m.color));
// 이름 + 으로/로 (받침이 없거나 ㄹ 받침이면 "로")
const ro = (name = '') => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  const jong = c >= 0 && c < 11172 ? c % 28 : 0;
  return name + (jong === 0 || jong === 8 ? '로' : '으로');
};
// 이름 + 이/가
const ga = (name = '') => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  return name + (c >= 0 && c < 11172 && c % 28 ? '이' : '가');
};

// ---- 경험치 · 레벨
const totalOf = (mid) => store.xpTotals[mid] ?? 0;
const levelOf = (mid) => levelInfo(totalOf(mid));
const todayXp = (mid) => store.xpLog
  .filter((x) => x.member_id === mid && nowKST(Date.parse(x.created_at)).date === today())
  .reduce((s, x) => s + x.xp, 0);
const rewardsOf = (mid) => store.rewards.filter((r) => r.member_id === mid).sort((a, b) => a.level - b.level);
const levelsNow = () => Object.fromEntries(store.members.map((m) => [m.id, levelOf(m.id).level]));
const isStandalone =() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function relDay(d) {
  const diff = Math.round((Date.parse(d) - Date.parse(today())) / 86400000);
  return { 0: '오늘', 1: '내일', 2: '모레', [-1]: '어제' }[diff] ?? null;
}

function passFilter(item) {
  if (state.filter === 'all') return true;
  if (state.filter === 'shared') return item.owner === null;
  return item.owner === state.filter;
}

const sortByTime = (a, b) => (toMin(a.time) ?? 2000) - (toMin(b.time) ?? 2000) || a.title.localeCompare(b.title, 'ko');

// ------------------------------------------------------------------ 행 렌더링
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 1113 0c0 4.8-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  breath: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".55"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V9a3 3 0 013-3h11l-3-3M20 13v2a3 3 0 01-3 3H6l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function row(item, date, { showDate = false } = {}) {
  const done = isDone(store.completions, item.id, date);
  const [c1, c2] = colorsOf(item);
  const meta = [];
  if (showDate) meta.push(`<span>${md(date)}</span>`);
  if (item.owner === null) meta.push('<span class="who shared">공통</span>');
  else if (item.owner !== store.me.id) meta.push(`<span class="who" style="color:${c1}">${esc(member(item.owner)?.name)}</span>`);
  const rl = repeatLabel(item);
  if (rl) meta.push(`<span class="ico">${ICON.repeat}${rl}</span>`);
  if (item.remind_before != null && item.time) meta.push(`<span class="ico">${ICON.bell}${remindText(item)}</span>`);
  const place = item.place_id ? store.places.find((p) => p.id === item.place_id) : null;
  if (place) meta.push(`<span class="ico place">${ICON.pin}${esc(placeLabel(place))}</span>`);
  if (item.note) meta.push(`<span class="note">${esc(item.note)}</span>`);
  const diff = DIFF[item.difficulty] ? item.difficulty : 'normal';
  const xp = item.kind === 'task'
    ? `<span class="xp" data-d="${diff}" aria-label="${DIFF[diff].label}, 경험치 ${xpOf(item)}"><b>+${xpOf(item)}</b><small>${DIFF[diff].label}</small></span>`
    : '';
  return `
  <li class="row ${item.kind} ${done ? 'done' : ''}" style="--c1:${c1};--c2:${c2}">
    <span class="stripe" aria-hidden="true"></span>
    <button class="check" data-act="toggle" data-id="${item.id}" data-date="${date}" aria-pressed="${done}" aria-label="${esc(item.title)} ${done ? '완료 취소' : '완료'}">${ICON.check}</button>
    <button class="body" data-act="edit" data-id="${item.id}">
      <span class="line1">${item.time ? `<span class="time">${hm(item.time)}</span>` : ''}${item.kind === 'event' ? '<span class="kind">약속</span>' : ''}<span class="title">${esc(item.title)}</span></span>
      ${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}
    </button>
    ${xp}
  </li>`;
}

function remindText(item) {
  const b = item.remind_before;
  let s = b === 0 ? '정시' : b % 1440 === 0 ? `${b / 1440}일 전` : b % 60 === 0 ? `${b / 60}시간 전` : `${b}분 전`;
  if (item.kind === 'task' && item.nag_every) s += `, ${item.nag_every >= 60 ? item.nag_every / 60 + '시간' : item.nag_every + '분'}마다`;
  return s;
}

// ------------------------------------------------------------------ 오늘 화면
function progressBar(list, date) {
  const groups = [
    ...store.members.map((m) => ({ label: m.name, color: m.color, items: list.filter((i) => i.owner === m.id) })),
    { label: '공통', color: SHARED, items: list.filter((i) => i.owner === null) },
  ];
  // 순서: 나 · 공통 · 상대 (가운데가 공통)
  const order = [groups.find((g) => g.label === store.me.name), groups[2], groups.find((g) => g.label === partner()?.name)].filter(Boolean);
  const total = list.length || 1;
  const segs = order.map((g) => {
    const n = g.items.length;
    const d = g.items.filter((i) => isDone(store.completions, i.id, date)).length;
    return { ...g, n, d, w: (n / total) * 100 };
  });
  return `
  <div class="progress" role="img" aria-label="${segs.map((s) => `${s.label} ${s.d}/${s.n}`).join(', ')}">
    <div class="bar">${segs.filter((s) => s.n).map((s) => `<span class="seg" style="flex:${s.w};--c:${s.color}"><i style="width:${(s.d / s.n) * 100}%"></i></span>`).join('') || '<span class="seg empty"></span>'}</div>
    <div class="legend">${segs.map((s) => `<span><b style="background:${s.color}"></b>${esc(s.label)} <em>${s.d}/${s.n}</em></span>`).join('')}</div>
  </div>`;
}

function filterChips() {
  const opts = [['all', '모두'], [store.me.id, '나'], ...(partner() ? [[partner().id, partner().name]] : []), ['shared', '공통']];
  return `<div class="chips" role="tablist">${opts.map(([v, l]) =>
    `<button role="tab" data-act="filter" data-v="${v}" aria-selected="${state.filter === v}">${esc(l)}</button>`).join('')}</div>`;
}

// 오늘 화면 위쪽: 내 레벨 카드 (누르면 레벨 탭)
function levelCard() {
  const me = store.me;
  const info = levelOf(me.id);
  const p = partner();
  const mine = rewardsOf(me.id);
  const pending = mine.filter((r) => r.level <= info.level && !r.claimed_at).length;
  const next = mine.find((r) => r.level > info.level);
  const foot = pending ? `<b class="pending">받을 보상 ${pending}개</b>`
    : next ? `<span class="lv-next">Lv.${next.level} 보상 · ${esc(next.title)}</span>`
    : '<span class="lv-next">레벨 보상을 정해 보세요</span>';
  return `
  <button class="lvcard" data-act="view" data-v="level" style="--c:${me.color}" aria-label="내 레벨 ${info.level}, ${info.into}/${info.need} 경험치. 레벨 화면 열기">
    <span class="lv-top">
      <span class="lv-num"><small>Lv.</small>${info.level}</span>
      <span class="lv-name">${esc(me.name)}<small>${info.into} / ${info.need} XP</small></span>
      ${p ? `<span class="lv-partner"><b style="background:${p.color}"></b>${esc(p.name)} Lv.${levelOf(p.id).level}</span>` : ''}
    </span>
    <span class="lv-bar"><i style="width:${Math.max(2, info.pct * 100)}%"></i></span>
    <span class="lv-foot">${foot}<span class="lv-today">오늘 +${todayXp(me.id)} XP</span></span>
  </button>`;
}

// 퀘스트 묶음 (남은 것 먼저, 끝낸 것은 아래에 흐리게)
function questSection(type, list, d) {
  if (!list.length) return '';
  const open = list.filter((i) => !isDone(store.completions, i.id, d));
  const closed = list.filter((i) => isDone(store.completions, i.id, d));
  const left = open.reduce((s, i) => s + xpOf(i), 0);
  return `
  <section><h2>${QUEST_LABEL[type]} <span>${closed.length}/${list.length}${left ? ` · +${left} XP 남음` : ' · 모두 클리어'}</span></h2>
    ${open.length ? `<ul>${open.map((i) => row(i, d)).join('')}</ul>` : ''}
    ${closed.length ? `<ul class="closed">${closed.map((i) => row(i, d)).join('')}</ul>` : ''}
  </section>`;
}

function todayView() {
  const d = state.date;
  const all = store.items.filter((i) => occursOn(i, d));
  const list = all.filter(passFilter).sort(sortByTime);
  // 완료 기록은 최근 120일치만 불러오므로 그보다 오래된 할일은 밀린 목록에서 제외
  const late = d === today() ? overdue(store.items, store.completions, d).filter((i) => i.start_date >= addDays(d, -120)).filter(passFilter).sort((a, b) => a.start_date.localeCompare(b.start_date)) : [];
  const events = list.filter((i) => i.kind === 'event');
  const tasks = list.filter((i) => i.kind === 'task');
  const daily = tasks.filter((i) => questType(i) === 'daily');
  const sub = tasks.filter((i) => questType(i) === 'sub');
  const rd = relDay(d);

  return `
  <header class="top">
    <div class="toprow">${calmButton()}</div>
    <div class="datenav">
      <button class="iconbtn" data-act="day" data-n="-1" aria-label="이전 날">${ICON.left}</button>
      <h1>${rd && rd !== '오늘' ? `<small>${rd}</small>` : ''}${longDate(d)}</h1>
      <button class="iconbtn" data-act="day" data-n="1" aria-label="다음 날">${ICON.right}</button>
    </div>
    ${d !== today() ? '<button class="linkbtn" data-act="day" data-n="0">오늘로 돌아가기</button>' : ''}
    ${levelCard()}
    ${progressBar(all.filter((i) => i.kind === 'task'), d)}
  </header>
  ${filterChips()}
  <main class="lists">
    ${late.length ? `<section><h2 class="warn">밀린 퀘스트 <span>${late.length}</span></h2><ul>${late.map((i) => row(i, i.start_date, { showDate: true })).join('')}</ul></section>` : ''}
    ${events.length ? `<section><h2>약속</h2><ul>${events.map((i) => row(i, d)).join('')}</ul></section>` : ''}
    ${questSection('daily', daily, d)}
    ${questSection('sub', sub, d)}
    ${tasks.length ? '' : `<section><p class="empty">이 날은 퀘스트가 없어요.<br><button class="linkbtn" data-act="add">퀘스트 추가하기</button></p></section>`}
    ${d === today() ? `<section>${moodShortcut()}</section>` : ''}
  </main>`;
}

// ------------------------------------------------------------------ 하루 감정
const myMood = (day) => store.moods.find((m) => m.member_id === store.me.id && m.day === day);
// 기록한 사람의 방식(감정 6가지 / 집중도 등, 모두 0~10)에 맞춰 점수 글자로
const scoreText = (e, limit = 6) => {
  const items = profileOf(member(e.member_id)).items;
  return items
    .filter((x) => typeof e.scores?.[x.key] === 'number')
    .sort((a, b) => (limit < items.length ? e.scores[b.key] - e.scores[a.key] : 0))
    .slice(0, limit)
    .map((x) => `${x.label} ${e.scores[x.key]}`).join(' · ');
};
const shareLabel = (e) => (e.shared === false ? ' · 나만 보기' : '');
const myPrivate = (day) => store.moodPrivate?.find((x) => x.day === day)?.note ?? '';
const privNote = (e, cls) => (e.member_id === store.me.id && myPrivate(e.day) ? `<${cls === 'mt-note' ? 'p' : 'span'} class="${cls} private"><b>🔒</b>${esc(myPrivate(e.day))}</${cls === 'mt-note' ? 'p' : 'span'}>` : '');

// 오늘 화면 맨 아래: 감정 기록 바로가기
function moodShortcut() {
  const e = myMood(today());
  return e
    ? `<button class="moodrow" data-act="view" data-v="mood"><span class="mr-emoji">${esc(e.emoji || '📝')}</span><span class="mr-text">오늘 감정을 기록했어요<small>${scoreText(e, 2) || esc(e.note || '')}</small></span><span class="mr-go">${ICON.right}</span></button>`
    : `<button class="moodrow" data-act="mood-add" data-day="${today()}"><span class="mr-emoji">📝</span><span class="mr-text">오늘 하루 어땠어요?<small>감정을 기록하고 하루를 정리해요</small></span><span class="mr-go">${ICON.right}</span></button>`;
}

function moodView() {
  const who = member(state.moodWho) ?? store.me;
  const isMe = who.id === store.me.id;
  const t = today();
  const n = state.moodRange;
  const days = series(store.moods, who.id, t, n);
  const prev = series(store.moods, who.id, addDays(t, -n), n);
  const recorded = days.filter((x) => x.entry).length;
  const te = store.moods.find((m) => m.member_id === who.id && m.day === t);
  const allHistory = store.moods.filter((m) => m.member_id === who.id).sort((a, b) => b.day.localeCompare(a.day));
  const history = allHistory.slice(0, state.moodHistAll ? 60 : 7);
  const tabs = store.members.map((m) =>
    `<button role="tab" data-act="moodwho" data-v="${m.id}" aria-selected="${m.id === who.id}">${m.id === store.me.id ? '나' : esc(m.name)}</button>`).join('');
  const prof = profileOf(who);
  const keysOn = state.moodKeys[prof.key] ?? prof.defaultKeys;

  const todayCard = te
    ? `<section class="mtoday">
        ${te.emoji ? `<span class="mt-emoji" aria-hidden="true">${esc(te.emoji)}</span>` : ''}
        <div class="mt-body">
          <p class="mt-label">${te.emoji ? `오늘 기분 · ${emojiLabel(te.emoji)}` : '오늘 기록'}${shareLabel(te)}</p>
          ${scoreText(te) ? `<p class="mt-scores">${scoreText(te)}</p>` : ''}
          ${te.note ? `<p class="mt-note">${esc(te.note)}</p>` : ''}
          ${privNote(te, 'mt-note')}
        </div>
        ${isMe ? `<button class="linkbtn mt-edit" data-act="mood-add" data-day="${t}">수정</button>` : ''}
      </section>`
    : isMe
      ? prof.emoji
        ? `<section class="mtoday cta">
            <p class="mt-q">오늘 하루 어땠어요?</p>
            <div class="emoji-quick">${MOOD_EMOJIS.map(([e, l]) => `<button data-act="mood-add" data-day="${t}" data-emoji="${e}" aria-label="${l}">${e}</button>`).join('')}</div>
          </section>`
        : `<section class="mtoday cta">
            <p class="mt-q">오늘 하루 어땠어요?</p>
            <p class="mt-note">${prof.items.map((x) => x.label).join(' · ')}을 0~${prof.max}점으로 남겨요</p>
            <button class="btn primary wide" data-act="mood-add" data-day="${t}">오늘 기록하기</button>
          </section>`
      : `<p class="empty">아직 오늘 기록이 없어요.</p>`;

  const fmt = (v) => (v == null ? '–' : v.toFixed(1));
  const avgs = prof.items.map((x) => {
    const a = average(days, x.key), b = average(prev, x.key);
    const delta = a != null && b != null ? a - b : null;
    const dTxt = delta == null ? '' : Math.abs(delta) < 0.05 ? '지난 기간과 같음' : `지난 ${n}일보다 ${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(1)}`;
    return `<li><span class="ma-name"><i style="background:var(--emo-${x.key})"></i>${x.label}</span><b>${fmt(a)}</b><small>${dTxt}</small></li>`;
  }).join('');

  return `
  <header class="top"><h1 class="plain">감정</h1><p class="sub">하루 감정을 기록하고 어떻게 변하는지 살펴봐요</p></header>
  <div class="chips" role="tablist">${tabs}</div>
  <main class="lists mood">
    ${todayCard}

    <section>
      <h2>변화 <span>${n}일 중 ${recorded}일 · 0~${prof.max}점</span>
        <span class="range" role="group" aria-label="기간">${[7, 30].map((r) => `<button data-act="mood-range" data-v="${r}" aria-pressed="${n === r}">${r}일</button>`).join('')}</span>
      </h2>
      ${recorded ? `<ul class="mavg ${prof.items.length === 4 ? 'four' : ''}">${avgs}</ul>` : ''}
      <div class="mc-keys" role="group" aria-label="그래프에 보일 항목">
        ${prof.items.map((x) => `<button data-act="mood-key" data-p="${prof.key}" data-v="${x.key}" aria-pressed="${keysOn.includes(x.key)}"><i style="background:var(--emo-${x.key})"></i>${x.label}</button>`).join('')}
      </div>
      <div class="mchart" tabindex="0" aria-label="감정 점수 그래프. 좌우 화살표로 날짜별 점수를 볼 수 있어요">
        <div class="mc-host"></div>
        <div class="mc-tip" hidden></div>
      </div>
    </section>

    <section>
      <h2>기록 <span>${allHistory.length}일 기록함</span></h2>
      ${history.length ? `<ul class="mhist">${history.map((e) => `
        <li><button class="mh-row" ${isMe ? `data-act="mood-add" data-day="${e.day}"` : 'disabled'}>
          ${prof.emoji ? `<span class="mh-emoji" aria-hidden="true">${esc(e.emoji || '·')}</span>` : ''}
          <span class="mh-body"><span class="mh-date">${md(e.day)} ${W[dow(e.day)]}${e.emoji ? ` · ${emojiLabel(e.emoji)}` : ''}${shareLabel(e)}</span>
            ${scoreText(e) ? `<span class="mh-scores">${scoreText(e)}</span>` : ''}
            ${e.note ? `<span class="mh-note">${esc(e.note)}</span>` : ''}${privNote(e, 'mh-note')}</span>
        </button></li>`).join('')}</ul>
        ${allHistory.length > history.length ? `<button class="linkbtn more" data-act="mood-more">기록 더 보기</button>` : ''}`
      : `<p class="empty">${isMe ? '첫 감정을 기록해 보세요.' : '공개된 기록이 아직 없어요.'}</p>`}
    </section>
  </main>`;
}

// 그래프 그리기 + 날짜 누르면 점수 보기 (화면 폭에 맞춰 렌더 후 그림)
function drawMoodChart() {
  const host = $app.querySelector('.mc-host');
  if (!host) return;
  const who = member(state.moodWho) ?? store.me;
  const days = series(store.moods, who.id, today(), state.moodRange);
  if (!days.some((d) => d.entry)) {
    host.innerHTML = `<p class="mc-empty">기록이 쌓이면 여기에 그래프가 그려져요.</p>`;
    return;
  }
  const prof = profileOf(who);
  const on = state.moodKeys[prof.key] ?? prof.defaultKeys;
  const keys = prof.items.map((x) => x.key).filter((k) => on.includes(k));
  const label = Object.fromEntries(prof.items.map((x) => [x.key, x.label]));
  const { svg, xs, plot } = chartSVG(days, keys, host.clientWidth, { max: prof.max, emoji: prof.emoji });
  host.innerHTML = svg;
  const box = host.parentElement;
  const tip = box.querySelector('.mc-tip');
  const cross = host.querySelector('.mc-cross');
  let cur = -1;
  const show = (i) => {
    cur = Math.max(0, Math.min(days.length - 1, i));
    const d = days[cur];
    cross.setAttribute('x1', xs[cur]); cross.setAttribute('x2', xs[cur]); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const head = document.createElement('p');
    head.className = 'mt-head';
    head.textContent = `${md(d.day)} ${W[dow(d.day)]}${d.entry?.emoji ? ` ${d.entry.emoji}` : ''}`;
    tip.append(head);
    const vals = keys.filter((k) => typeof d.entry?.scores?.[k] === 'number');
    if (!vals.length) {
      const p = document.createElement('p'); p.className = 'mt-none'; p.textContent = d.entry ? '고른 항목의 점수 없음' : '기록 없음'; tip.append(p);
    }
    for (const k of vals) {
      const r = document.createElement('p'); r.className = 'mt-row';
      const key = document.createElement('i'); key.style.background = `var(--emo-${k})`;
      const v = document.createElement('b'); v.textContent = d.entry.scores[k];
      const l = document.createElement('span'); l.textContent = label[k];
      r.append(key, v, l); tip.append(r);
    }
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(box.clientWidth - w, xs[cur] - w / 2))}px`;
    tip.style.top = `${plot.t}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); cur = -1; };
  const nearest = (ev) => {
    const px = ev.clientX - host.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    return best;
  };
  host.onpointerdown = host.onpointermove = (ev) => show(nearest(ev));
  host.onpointerleave = (ev) => { if (ev.pointerType === 'mouse') hide(); };
  box.onkeydown = (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); show(cur < 0 ? days.length - 1 : cur + (ev.key === 'ArrowRight' ? 1 : -1)); }
    else if (ev.key === 'Escape') hide();
  };
  box.onblur = hide;
}
let moodResizeT;
window.addEventListener('resize', () => { clearTimeout(moodResizeT); moodResizeT = setTimeout(() => { if (state.view === 'mood') drawMoodChart(); }, 150); });

// 감정 기록 시트
function openMoodSheet(day = today(), presetEmoji = null) {
  const p = partner();
  const prof = profileOf(store.me);
  const mid = Math.round(prof.max / 2);
  // 새 기록의 공개 여부는 내가 마지막에 고른 값을 따라감
  const lastShared = store.moods.filter((m) => m.member_id === store.me.id).sort((a, b) => b.day.localeCompare(a.day))[0]?.shared ?? true;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet mood-sheet" role="dialog" aria-modal="true" aria-label="감정 기록">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <h2 class="sheet-title" data-mtitle></h2>
      <button type="submit" class="linkbtn strong">저장</button>
    </div>
    <label class="field"><span>날짜</span><input type="date" name="day" id="mood-day" max="${today()}" value="${day}" required></label>
    ${prof.emoji ? `<div class="field"><span>오늘의 기분</span>
      <div class="emoji-grid" role="radiogroup" aria-label="기분 이모지">${MOOD_EMOJIS.map(([e, l]) =>
        `<label><input type="radio" name="emoji" value="${e}"><span><b aria-hidden="true">${e}</b><small>${l}</small></span></label>`).join('')}</div>
    </div>` : ''}
    <div class="field"><span>${prof.emoji ? '감정 점수' : '오늘 점수'} <small>0~${prof.max} · ${prof.emoji ? '느낀 것만' : '매길 것만'}</small></span>
      <div class="sliders">${prof.items.map((x) => `
        <div class="sl-row" data-k="${x.key}" data-set="0">
          <span class="sl-name"><i style="background:var(--emo-${x.key})"></i>${x.label}</span>
          <input type="range" min="0" max="${prof.max}" step="1" value="${mid}" name="s-${x.key}" id="s-${x.key}" aria-label="${x.label} 점수 0~${prof.max}" style="--c:var(--emo-${x.key})">
          <button type="button" class="sl-val" data-clear="${x.key}" aria-label="${x.label} 점수 지우기">–</button>
        </div>`).join('')}
      </div>
      <p class="hint">점수 숫자를 누르면 지워져요.</p>
    </div>
    <div class="field"><span>이유 <small>간단히</small></span>
      <div class="notes2">
        <label class="note-box"><span class="nb-head">공개<small>${p ? `${esc(p.name)}도 볼 수 있어요` : '함께 보는 메모'}</small></span>
          <textarea name="note" id="mood-note" rows="3" maxlength="300" placeholder="예: 프로젝트 마감해서 홀가분"></textarea></label>
        <label class="note-box private"><span class="nb-head">🔒 비공개<small>나만 봐요</small></span>
          <textarea name="pnote" id="mood-pnote" rows="3" maxlength="300" placeholder="나만 알고 싶은 이야기"></textarea></label>
      </div>
    </div>
    ${p ? `<label class="switch stack"><input type="checkbox" name="hideall" id="mood-hideall"><span>이 날 기록 전체를 나만 보기<small>켜면 점수와 공개 메모도 ${esc(p.name)}에게 안 보여요</small></span></label>` : ''}
    <button type="button" class="btn danger" data-del hidden>이 날 기록 삭제</button>
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));

  const setRow = (row, v) => {
    const set = v != null;
    row.dataset.set = set ? '1' : '0';
    if (set) row.querySelector('input').value = v;
    row.querySelector('.sl-val').textContent = set ? v : '–';
  };
  const fill = (d) => {
    const e = myMood(d);
    form.querySelector('[data-mtitle]').textContent = d === today() ? '오늘 기록' : `${md(d)} 기록`;
    form.querySelectorAll('[name=emoji]').forEach((r) => { r.checked = r.value === (e?.emoji ?? (d === day ? presetEmoji : null)); });
    form.querySelectorAll('.sl-row').forEach((row) => setRow(row, e?.scores?.[row.dataset.k] ?? null));
    form.elements.note.value = e?.note ?? '';
    form.elements.pnote.value = myPrivate(d);
    const shared = e ? e.shared !== false : lastShared !== false;
    if (form.elements.hideall) form.elements.hideall.checked = !shared;
    const del = form.querySelector('[data-del]');
    del.hidden = !e; delete del.dataset.armed; del.textContent = '이 날 기록 삭제';
  };
  fill(day);
  form.elements.day.addEventListener('change', () => { if (form.elements.day.value) fill(form.elements.day.value); });
  form.querySelectorAll('.sl-row input').forEach((inp) => inp.addEventListener('input', () => setRow(inp.closest('.sl-row'), Number(inp.value))));
  form.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => setRow(b.closest('.sl-row'), null)));

  const del = form.querySelector('[data-del]');
  del.addEventListener('click', async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제돼요'; return; }
    try { await store.deleteMood(form.elements.day.value); close(); render(); toast('감정 기록을 삭제했어요'); } catch (e) { toast(e.message); }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const d = f.day.value;
    if (!d || d > today()) { toast('오늘이나 지난 날짜만 기록할 수 있어요'); return; }
    const scores = {};
    form.querySelectorAll('.sl-row[data-set="1"]').forEach((row) => { scores[row.dataset.k] = Number(row.querySelector('input').value); });
    const emoji = prof.emoji ? form.querySelector('[name=emoji]:checked')?.value ?? null : null;
    if (!emoji && !Object.keys(scores).length) { toast(prof.emoji ? '기분 이모지나 감정 점수를 하나 이상 남겨 주세요' : '점수를 하나 이상 매겨 주세요'); return; }
    const shared = !form.elements.hideall?.checked;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await store.saveMood({ day: d, emoji, scores, note: f.note.value.trim() || null, shared, privateNote: f.pnote.value.trim() || null });
      state.moodWho = store.me.id;
      close(); render();
      toast(shared ? '기록했어요' : '나만 보기로 기록했어요');
    } catch (e) { toast(e.message); btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ 레벨 · 보상
function rewardRow(r, info) {
  const got = r.level <= info.level;
  const by = r.created_by && r.created_by !== r.member_id && member(r.created_by) ? `${ga(member(r.created_by).name)} 걸어둔 보상` : '';
  const state_ = !got
    ? `<span class="rw-state">${xpToReach(r.level) - info.total} XP 남음</span>`
    : r.claimed_at
      ? `<button class="rw-claim claimed" data-act="claim" data-id="${r.id}" aria-label="${esc(r.title)} 받음 취소">${ICON.check}받음</button>`
      : `<button class="rw-claim" data-act="claim" data-id="${r.id}">받기</button>`;
  return `
  <li class="rw ${got ? 'got' : ''} ${r.claimed_at ? 'claimed' : ''}">
    <span class="rw-lv">Lv.${r.level}</span>
    <button class="rw-body" data-act="reward-edit" data-id="${r.id}">
      <span class="rw-title">${esc(r.title)}</span>
      ${by || r.note ? `<span class="rw-by">${[by, r.note ? esc(r.note) : ''].filter(Boolean).join(' · ')}</span>` : ''}
    </button>
    ${state_}
  </li>`;
}

function levelView() {
  const who = member(state.lvWho) ?? store.me;
  const info = levelOf(who.id);
  const rws = rewardsOf(who.id);
  const reached = rws.filter((r) => r.level <= info.level);
  const ahead = rws.filter((r) => r.level > info.level);
  const log = store.xpLog.filter((x) => x.member_id === who.id).slice(0, 15);
  const isMe = who.id === store.me.id;
  const tabs = store.members.map((m) =>
    `<button role="tab" data-act="lvwho" data-v="${m.id}" aria-selected="${m.id === who.id}">${m.id === store.me.id ? '나' : esc(m.name)}</button>`).join('');

  return `
  <header class="top"><h1 class="plain">레벨</h1><p class="sub">퀘스트를 깨서 경험치를 모으고, 레벨마다 정한 보상을 받아요</p></header>
  <div class="chips" role="tablist">${tabs}</div>
  <main class="lists level">
    <section class="lvhero" style="--c:${who.color}">
      <p class="lvhero-who">${esc(who.name)}</p>
      <p class="lvhero-num"><small>Lv.</small>${info.level}</p>
      <span class="lv-bar big"><i style="width:${Math.max(2, info.pct * 100)}%"></i></span>
      <p class="lvhero-meta"><span><b>${info.into}</b> / ${info.need} XP</span><span>Lv.${info.level + 1}까지 ${info.toNext} XP</span></p>
      <p class="lvhero-total">누적 ${info.total.toLocaleString()} XP · 오늘 +${todayXp(who.id)} XP</p>
    </section>

    <section>
      <h2>레벨 보상 <button class="linkbtn h2btn" data-act="reward-add">${isMe ? '보상 추가' : `${esc(who.name)}에게 보상 걸기`}</button></h2>
      ${rws.length ? `
      <ul class="road">
        ${reached.map((r) => rewardRow(r, info)).join('')}
        <li class="road-now" style="--c:${who.color}"><span>지금 Lv.${info.level}</span><em>다음 레벨까지 ${info.toNext} XP</em></li>
        ${ahead.map((r) => rewardRow(r, info)).join('')}
      </ul>`
      : `<p class="empty">아직 정한 보상이 없어요.<br>레벨마다 받을 보상을 적어 두고 그 레벨을 향해 가 보세요.<br><button class="linkbtn" data-act="reward-add">보상 추가하기</button></p>`}
    </section>

    <section>
      <h2>최근 경험치</h2>
      ${log.length ? `<ul class="xplog">${log.map((x) => `
        <li><span class="xl-title">${esc(x.title)}<small>${QUEST_LABEL[x.quest_type]} · ${md(x.occur_date)}</small></span><b>+${x.xp}</b></li>`).join('')}</ul>`
      : '<p class="empty">퀘스트를 완료하면 여기에 쌓여요.</p>'}
    </section>

    <p class="rules">경험치: ${DIFF_KEYS.map((k) => `${DIFF[k].label} ${DIFF[k].xp}`).join(' · ')}<br>
      다음 레벨까지 필요한 경험치는 ${LEVEL_BASE}에서 시작해 레벨마다 ${LEVEL_STEP}씩 늘어나요.<br>
      개인 퀘스트는 담당자가, 공통 퀘스트는 체크한 사람이 경험치를 받아요.</p>
  </main>`;
}

// 보상 추가/수정 시트
function openRewardSheet(rw, whoId) {
  const isNew = !rw;
  const forId = rw?.member_id ?? whoId;
  const suggest = () => {
    const cur = levelOf(forId).level;
    const used = new Set(rewardsOf(forId).map((r) => r.level));
    let L = cur + 1;
    while (used.has(L)) L++;
    return L;
  };
  const r = rw ?? { member_id: forId, level: suggest(), title: '', note: '' };
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet" role="dialog" aria-modal="true" aria-label="${isNew ? '새 보상' : '보상 수정'}">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <h2 class="sheet-title">${isNew ? '새 보상' : '보상 수정'}</h2>
      <button type="submit" class="linkbtn strong">${isNew ? '추가' : '저장'}</button>
    </div>
    <input class="title-in" name="title" id="rw-title" placeholder="어떤 보상을 받을까요?" value="${esc(r.title)}" maxlength="200" required autocomplete="off">
    <div class="field"><span>누가 받나요</span>
      <div class="seg3">${store.members.map((m) => `<label><input type="radio" name="member" value="${m.id}" ${r.member_id === m.id ? 'checked' : ''}><span>${m.id === store.me.id ? '나' : esc(m.name)}</span></label>`).join('')}</div>
    </div>
    <label class="field"><span>레벨</span><input type="number" name="level" id="rw-level" inputmode="numeric" min="2" max="999" value="${r.level}" required></label>
    <p class="hint" data-lvhint></p>
    <label class="field"><span>메모</span><textarea name="note" id="rw-note" rows="2" placeholder="언제까지, 어떻게 받을지 등">${esc(r.note ?? '')}</textarea></label>
    ${isNew ? '' : '<button type="button" class="btn danger" data-del>삭제</button>'}
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));
  if (isNew) setTimeout(() => form.elements.title.focus(), 250);

  const hint = form.querySelector('[data-lvhint]');
  const updateHint = () => {
    const mid = form.elements.member.value;
    const info = levelOf(mid);
    const L = Number(form.elements.level.value);
    hint.textContent = !L || L < 2 ? '레벨은 2 이상이에요.'
      : L <= info.level ? `이미 도달한 레벨이에요. (지금 Lv.${info.level})`
      : `지금 Lv.${info.level} · Lv.${L}까지 ${xpToReach(L) - info.total} XP 남음`;
  };
  form.addEventListener('input', updateHint);
  form.addEventListener('change', updateHint);
  updateHint();

  // 삭제는 두 번 눌러서 확인
  const del = form.querySelector('[data-del]');
  del?.addEventListener('click', async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제돼요'; return; }
    try { await store.deleteReward(r.id); close(); render(); toast('보상을 삭제했어요'); } catch (e) { toast(e.message); }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const level = Math.round(Number(f.level.value));
    if (!(level >= 2 && level <= 999)) { toast('레벨은 2부터 999까지 적을 수 있어요'); return; }
    const data = { ...(isNew ? {} : { id: r.id }), member_id: f.member.value, level, title: f.title.value.trim(), note: f.note.value.trim() || null };
    if (!data.title) return;
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await store.saveReward(data);
      state.lvWho = data.member_id;
      close(); render();
      toast(isNew ? '보상을 추가했어요' : '보상을 저장했어요');
    } catch (e) { toast(e.message); btn.disabled = false; }
  });
}

// 레벨 업 축하 화면
function levelUpOverlay(level) {
  const rws = rewardsOf(store.me.id).filter((r) => r.level === level);
  const wrap = document.createElement('div');
  wrap.className = 'lvup';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'lvup-num');
  wrap.style.setProperty('--c', store.me.color);
  wrap.innerHTML = `
    <div class="lvup-card">
      <p class="lvup-kicker">레벨 업</p>
      <p class="lvup-num" id="lvup-num"><small>Lv.</small>${level}</p>
      ${rws.length
        ? `<div class="lvup-rw"><p>이번 레벨 보상</p><ul>${rws.map((r) => `<li>${esc(r.title)}${r.created_by && r.created_by !== r.member_id && member(r.created_by) ? `<small>${ga(member(r.created_by).name)} 걸어둔 보상</small>` : ''}</li>`).join('')}</ul></div>`
        : '<p class="lvup-none">이 레벨엔 정한 보상이 없어요.<br>다음 목표 보상을 정해 보세요.</p>'}
      <div class="btnrow">
        <button class="btn primary wide" data-ok>${rws.length ? '보상 확인하러 가기' : '보상 정하러 가기'}</button>
        <button class="btn wide" data-close>닫기</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.querySelector('[data-ok]').addEventListener('click', () => { close(); state.view = 'level'; state.lvWho = store.me.id; render(); window.scrollTo(0, 0); });
  wrap.querySelector('[data-ok]').focus();
}

// 체크 전후 레벨을 비교해서 레벨 업 처리
function handleLevelUps(before) {
  for (const m of store.members) {
    const after = levelOf(m.id).level;
    if (after <= (before[m.id] ?? after)) continue;
    if (m.id === store.me.id) setTimeout(() => levelUpOverlay(after), 380);
    else toast(`${m.name} Lv.${after} 달성!`);
    store.callFn({ action: 'notify', verb: 'levelup', member_id: m.id, level: after }).catch(() => {});
  }
}

// ------------------------------------------------------------------ 다가오는 일정
// 일정 탭 위쪽: 다가오는 일정 | 갈 곳
const upTabs = () => `
  <div class="uptabs" role="tablist">
    <button role="tab" data-act="uptab" data-v="list" aria-selected="${state.upTab !== 'places'}">다가오는 일정</button>
    <button role="tab" data-act="uptab" data-v="places" aria-selected="${state.upTab === 'places'}">갈 곳${store.places.filter((p) => !p.visited_at).length ? ` <b>${store.places.filter((p) => !p.visited_at).length}</b>` : ''}</button>
  </div>`;

function upcomingView() {
  if (state.upTab === 'places') return placesView();
  const start = today();
  const days = [];
  for (let k = 0; k < 30; k++) {
    const d = addDays(start, k);
    const list = store.items.filter((i) => i.repeat !== 'daily' && occursOn(i, d) && passFilter(i)).sort(sortByTime);
    if (list.length) days.push({ d, list });
  }
  return `
  ${upTabs()}
  <header class="top"><h1 class="plain">다가오는 일정</h1><p class="sub">앞으로 30일 · 매일 반복은 오늘 화면에서 보여요</p></header>
  ${filterChips()}
  <main class="lists">
    ${days.length ? days.map(({ d, list }) => `
      <section><h2>${relDay(d) ? `${relDay(d)} ` : ''}<span>${longDate(d)}</span></h2><ul>${list.map((i) => row(i, d)).join('')}</ul></section>`).join('')
      : '<p class="empty">앞으로 30일 동안 잡힌 일정이 없어요.</p>'}
  </main>`;
}

// ------------------------------------------------------------------ 갈 곳
// 카카오 장소는 정책상 ID + 검색어만 저장하므로, 이름·주소는 앱이 열려 있는 동안 실시간 조회해서 메모리에만 둠
const placeInfo = new Map();   // place.id → 조회 결과 | null
const placePending = new Set();
const PROVIDER_NOTE = { kakao: '검색: 카카오맵', osm: '검색 결과 © OpenStreetMap 기여자', demo: '데모 예시 장소' };

const kinfo = (p) => (p.source === 'kakao' ? placeInfo.get(p.id) : null);
function placeLabel(p) { return p.source === 'kakao' ? kinfo(p)?.name ?? p.query : p.name; }
function placeSub(p) {
  const i = p.source === 'kakao' ? kinfo(p) : p;
  if (!i) return p.source === 'kakao' && placeInfo.has(p.id) ? '정보를 불러오지 못했어요' : '';
  return [i.category, i.address].filter(Boolean).join(' · ');
}
function placeUrl(p) {
  if (p.source === 'kakao') return kinfo(p)?.url ?? `https://map.kakao.com/?q=${encodeURIComponent(p.query)}`;
  return p.url ?? `https://map.kakao.com/?q=${encodeURIComponent(`${p.name} ${p.address ?? ''}`.trim())}`;
}

async function ensurePlaceInfo() {
  if (store.demo) return;
  const need = store.places.filter((p) => p.source === 'kakao' && !placeInfo.has(p.id) && !placePending.has(p.id));
  if (!need.length) return;
  need.forEach((p) => placePending.add(p.id));
  try {
    const info = await store.lookupPlaces(need.map((p) => ({ id: p.id, source_id: p.source_id, query: p.query })));
    need.forEach((p) => placeInfo.set(p.id, info[p.id] ?? null));
  } catch { need.forEach((p) => placeInfo.set(p.id, null)); }
  need.forEach((p) => placePending.delete(p.id));
  render();
}

// 태그: 지금까지 쓴 태그 + 처음 쓸 때 고를 만한 예시
const TAG_PRESETS = ['맛집', '카페', '데이트', '산책', '전시', '여행', '술집', '야경'];
const allTags = () => [...new Set(store.places.flatMap((p) => p.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ko'));
const normTag = (t) => t.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const tagsLine = (p) => (p.tags?.length ? `<span class="pl-tags">${p.tags.map((t) => `#${esc(t)}`).join(' ')}</span>` : '');

// 태그 고르기 (칩 눌러서 켜고 끄기 + 새 태그 입력). 반환: 지금 고른 태그를 돌려주는 함수
function tagField(form, initial = []) {
  const sel = new Set(initial);
  const box = form.querySelector('[data-tagbox]');
  const draw = () => {
    const opts = [...new Set([...allTags(), ...sel, ...(allTags().length < 4 ? TAG_PRESETS : [])])];
    box.querySelector('[data-tagchips]').innerHTML = opts.map((t) =>
      `<button type="button" class="tag-chip" data-tag="${esc(t)}" aria-pressed="${sel.has(t)}">#${esc(t)}</button>`).join('');
  };
  const input = box.querySelector('[data-tagnew]');
  const add = () => {
    const t = normTag(input.value);
    input.value = '';
    if (!t) return;
    if (sel.size >= 10 && !sel.has(t)) { toast('태그는 10개까지 달 수 있어요'); return; }
    sel.add(t); draw();
  };
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-tag]');
    if (c) {
      const t = c.dataset.tag;
      if (sel.has(t)) sel.delete(t);
      else if (sel.size >= 10) { toast('태그는 10개까지 달 수 있어요'); return; }
      else sel.add(t);
      draw();
    }
    if (e.target.closest('[data-tagadd]')) add();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
  draw();
  return () => { add(); return [...sel]; };
}
const tagFieldHTML = `<div class="field" data-tagbox><span>태그 <small>여러 개 골라도 돼요</small></span>
  <div class="tagchips" data-tagchips></div>
  <div class="tagnew"><input data-tagnew maxlength="20" placeholder="새 태그 (예: 비 오는 날)" autocomplete="off" enterkeyhint="done" aria-label="새 태그"><button type="button" class="btn" data-tagadd>추가</button></div>
</div>`;

function placesView() {
  const want = store.places.filter((p) => !p.visited_at);
  const been = store.places.filter((p) => p.visited_at);
  const tags = allTags();
  if (state.placeTag && !tags.includes(state.placeTag)) state.placeTag = null;
  const list = (state.placeFilter === 'visited' ? been : want).filter((p) => !state.placeTag || (p.tags ?? []).includes(state.placeTag));
  const r = state.placeResults;
  const added = (x) => store.places.some((p) => p.source === x.source && p.source_id && p.source_id === x.source_id);
  const results = state.placeSearching
    ? '<p class="empty">찾는 중…</p>'
    : r == null ? ''
    : r.error ? `<p class="empty">${esc(r.error)}</p>`
    : r.results.length ? `
      <ul class="presults">${r.results.map((x, i) => `
        <li>
          <span class="pr-body"><b>${esc(x.name)}</b><small>${esc([x.category, x.address].filter(Boolean).join(' · '))}</small></span>
          <a class="pr-map" href="${esc(x.url)}" target="_blank" rel="noopener">지도</a>
          ${added(x) ? '<span class="pr-added">추가됨</span>' : `<button class="pr-add" data-act="place-add" data-i="${i}">추가</button>`}
        </li>`).join('')}</ul>
      <p class="attrib">${PROVIDER_NOTE[r.provider] ?? ''}</p>`
    : `<p class="empty">찾는 곳이 없어요. 다른 검색어로 찾아보거나 직접 추가해 보세요.</p>`;

  return `
  ${upTabs()}
  <header class="top"><h1 class="plain">갈 곳</h1><p class="sub">가고 싶은 가게·장소를 모아 두고, 일정을 잡을 때 골라요</p></header>
  <form class="psearch" data-psearch role="search">
    <label class="psearch-in">${ICON.search}<input type="search" name="q" id="place-q" enterkeyhint="search" autocomplete="off" maxlength="100"
      placeholder="가게 이름, 동네+업종, 주소" value="${esc(state.placeQuery ?? '')}" aria-label="장소 검색"></label>
    <button class="btn primary" type="submit">검색</button>
  </form>
  ${r == null && !state.placeSearching ? '<p class="hint psearch-hint">예: 성수 카페, 해방촌 맛집, 남산서울타워, 용산구 신흥로 95</p>' : ''}
  <main class="lists places">
    ${results ? `<section>${r && !state.placeSearching && !r.error ? `<h2>검색 결과 <span>${r.results.length}곳</span><button class="linkbtn h2btn" data-act="place-clear">닫기</button></h2>` : ''}${results}</section>` : ''}
    <button class="linkbtn manual" data-act="place-manual">찾는 곳이 없나요? 직접 추가</button>

    <section>
      <div class="chips" role="tablist">
        <button role="tab" data-act="place-filter" data-v="want" aria-selected="${state.placeFilter !== 'visited'}">가고 싶은 곳 ${want.length}</button>
        <button role="tab" data-act="place-filter" data-v="visited" aria-selected="${state.placeFilter === 'visited'}">다녀온 곳 ${been.length}</button>
      </div>
      ${tags.length ? `<div class="tagfilter" role="group" aria-label="태그로 보기">
        <button data-act="place-tag" data-v="" aria-pressed="${!state.placeTag}">전체</button>
        ${tags.map((t) => `<button data-act="place-tag" data-v="${esc(t)}" aria-pressed="${state.placeTag === t}">#${esc(t)}</button>`).join('')}
      </div>` : ''}
      ${list.length ? `<ul class="plist">${list.map((p) => {
        const plans = store.items.filter((i) => i.place_id === p.id && i.start_date >= today()).length;
        const by = member(p.added_by);
        return `
        <li>
          <button class="pl-body" data-act="place-open" data-id="${p.id}">
            <b>${esc(placeLabel(p))}</b>
            ${placeSub(p) ? `<small>${esc(placeSub(p))}</small>` : ''}
            ${p.memo ? `<span class="pl-memo">${esc(p.memo)}</span>` : ''}
            ${tagsLine(p)}
            <span class="pl-meta">${by ? `${esc(ga(by.name))} 추가` : ''}${plans ? ` · 잡힌 일정 ${plans}개` : ''}${p.visited_at ? ` · ${md(nowKST(Date.parse(p.visited_at)).date)} 다녀옴` : ''}</span>
          </button>
          ${p.visited_at ? '' : `<button class="pl-plan" data-act="place-plan" data-id="${p.id}">일정 잡기</button>`}
        </li>`;
      }).join('')}</ul>`
      : `<p class="empty">${state.placeTag ? `#${esc(state.placeTag)} 태그가 붙은 곳이 없어요.` : state.placeFilter === 'visited' ? '다녀온 곳이 아직 없어요.' : '검색해서 가고 싶은 곳을 추가해 보세요.'}</p>`}
    </section>
  </main>`;
}

// 장소 시트: 메모, 다녀옴, 일정 잡기, 지도, 삭제
function openPlaceSheet(p, { justAdded = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet" role="dialog" aria-modal="true" aria-label="장소">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <h2 class="sheet-title">${justAdded ? '추가했어요' : '갈 곳'}</h2>
      <button type="submit" class="linkbtn strong">저장</button>
    </div>
    <div class="place-head">
      <p class="ph-name">${esc(placeLabel(p))}</p>
      ${placeSub(p) ? `<p class="ph-sub">${esc(placeSub(p))}</p>` : ''}
      ${kinfo(p)?.phone ? `<p class="ph-sub">${esc(kinfo(p).phone)}</p>` : ''}
      <a class="ph-map" href="${esc(placeUrl(p))}" target="_blank" rel="noopener">${ICON.pin}지도에서 보기</a>
    </div>
    ${tagFieldHTML}
    <label class="field"><span>메모</span><textarea name="memo" id="place-memo" rows="2" maxlength="300" placeholder="예: 웨이팅 길다고 함, 평일 오전 추천">${esc(p.memo ?? '')}</textarea></label>
    <label class="switch"><input type="checkbox" name="visited" id="place-visited" ${p.visited_at ? 'checked' : ''}><span>다녀왔어요</span></label>
    <button type="button" class="btn primary wide" data-plan>이 장소로 일정 잡기</button>
    <button type="button" class="btn danger" data-del>갈 곳에서 삭제</button>
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));
  const getTags = tagField(form, p.tags ?? []);
  form.querySelector('[data-plan]').addEventListener('click', () => { close(); openSheet(null, { kind: 'event', place_id: p.id, title: placeLabel(p), start_date: today() }); });
  const del = form.querySelector('[data-del]');
  del.addEventListener('click', async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = '한 번 더 누르면 삭제돼요'; return; }
    try { await store.deletePlace(p.id); close(); render(); toast('갈 곳에서 삭제했어요'); } catch (e) { toast(e.message); }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const visited = form.elements.visited.checked;
    try {
      await store.updatePlace(p.id, { memo: form.elements.memo.value.trim() || null, tags: getTags(), visited_at: visited ? p.visited_at ?? new Date().toISOString() : null });
      close(); render(); toast('저장했어요');
    } catch (e) { toast(e.message); }
  });
}

// 직접 추가
function openManualPlaceSheet() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet" role="dialog" aria-modal="true" aria-label="장소 직접 추가">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <h2 class="sheet-title">직접 추가</h2>
      <button type="submit" class="linkbtn strong">추가</button>
    </div>
    <input class="title-in" name="name" id="mp-name" placeholder="장소 이름" maxlength="120" required autocomplete="off" value="${esc(state.placeQuery ?? '')}">
    <label class="field"><span>주소 <small>선택</small></span><input name="address" id="mp-address" maxlength="200" autocomplete="off" placeholder="예: 서울 용산구 신흥로 95"></label>
    ${tagFieldHTML}
    <label class="field"><span>메모 <small>선택</small></span><textarea name="memo" id="mp-memo" rows="2" maxlength="300"></textarea></label>
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));
  const getTags = tagField(form, state.placeTag ? [state.placeTag] : []);
  setTimeout(() => form.elements.name.focus(), 250);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    if (!f.name.value.trim()) return;
    try {
      await store.addManualPlace({ name: f.name.value.trim(), address: f.address.value.trim() || null, memo: f.memo.value.trim() || null, tags: getTags() });
      state.placeFilter = 'want';
      close(); render(); toast('갈 곳에 추가했어요');
    } catch (e) { toast(e.message); }
  });
}

async function runPlaceSearch(q) {
  state.placeQuery = q;
  state.placeSearching = true; state.placeResults = null; render();
  try {
    const r = await store.searchPlaces(q);
    state.placeResults = { provider: r.provider, results: r.results ?? [], query: q };
  } catch (e) {
    state.placeResults = { error: `검색하지 못했어요. 잠시 뒤 다시 해 보세요. (${e.message})`, results: [] };
  }
  state.placeSearching = false;
  render();
}

// ------------------------------------------------------------------ 설정
function settingsView() {
  const me = store.me;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let pushBlock;
  if (store.demo) {
    pushBlock = '<p class="hint">데모 모드에서는 알림이 오지 않아요. 설치 가이드대로 서버를 연결하면 켤 수 있어요.</p>';
  } else if (isIOS() && !isStandalone()) {
    pushBlock = `<div class="howto"><p><b>아이폰에서 알림을 받으려면 홈 화면에 추가해야 해요.</b></p>
      <p>Safari 아래쪽 공유 버튼 → <b>홈 화면에 추가</b> → 홈 화면의 <b>우리할일</b> 아이콘으로 다시 열고, 여기서 알림을 켜세요.</p></div>`;
  } else if (!('PushManager' in window)) {
    pushBlock = '<p class="hint">이 브라우저는 푸시 알림을 지원하지 않아요. iOS 16.4 이상이 필요해요.</p>';
  } else {
    pushBlock = `
      <p class="status">${perm === 'granted' ? '알림이 켜져 있어요.' : perm === 'denied' ? '알림이 차단돼 있어요. 아이폰 설정 > 알림 > 우리할일에서 허용해 주세요.' : '아직 알림을 켜지 않았어요.'}</p>
      <div class="btnrow">
        ${perm !== 'denied' ? `<button class="btn primary" data-act="push">${perm === 'granted' ? '이 기기 다시 등록' : '알림 켜기'}</button>` : ''}
        ${perm === 'granted' ? '<button class="btn" data-act="testpush">테스트 알림 보내기</button>' : ''}
      </div>`;
  }
  return `
  <header class="top"><h1 class="plain">설정</h1><p class="sub"><b class="dot" style="background:${me.color}"></b>${esc(ro(me.name))} 사용 중</p></header>
  <main class="settings">
    <section class="card">
      <h2>알림</h2>
      ${pushBlock}
    </section>
    <section class="card">
      <h2>매일 알림 시간</h2>
      <label class="field inline"><span>아침 브리핑<small>오늘 할일과 약속을 정리해서 알려줘요</small></span><input type="time" value="${hm(me.brief_time)}" data-pref="brief_time"></label>
      <label class="field inline"><span>저녁 리마인드<small>못 끝낸 할일이 있으면 알려줘요</small></span><input type="time" value="${hm(me.nag_time)}" data-pref="nag_time"></label>
    </section>
    <section class="card">
      <h2>내 감정 기록 방식</h2>
      <div class="profopts" role="radiogroup" aria-label="감정 기록 방식">${Object.values(PROFILES).map((pr) => `
        <label><input type="radio" name="mood_profile" value="${pr.key}" data-moodprof ${profileOf(me).key === pr.key ? 'checked' : ''}><span>${pr.name}</span></label>`).join('')}
      </div>
      <p class="hint">바꿔도 지난 기록은 그대로 남아요. 그래프는 지금 방식의 항목만 보여줘요.</p>
    </section>
    ${store.demo ? `
    <section class="card">
      <h2>데모 모드</h2>
      <p class="hint">지금은 이 기기에만 저장돼요. 두 사람 화면을 미리 보려면 사용자를 바꿔 보세요.</p>
      <div class="btnrow"><button class="btn" data-act="switch">${esc(ro(partner()?.name))} 보기</button><button class="btn" data-act="reset">예시 데이터로 초기화</button></div>
    </section>` : `
    <section class="card"><button class="btn" data-act="logout">로그아웃</button></section>`}
  </main>`;
}

// ------------------------------------------------------------------ 전체 화면
function render() {
  if (!store.me) return;
  const view = { today: todayView, upcoming: upcomingView, mood: moodView, level: levelView, settings: settingsView }[state.view]();
  const tabs = [['today', '오늘'], ['upcoming', '일정'], ['mood', '감정'], ['level', '레벨'], ['settings', '설정']];
  const calm = activeCalm();
  $app.innerHTML = `
    ${store.demo ? '<div class="demo-banner">데모 모드 · 이 기기에만 저장돼요</div>' : ''}
    ${calm && state.calmHidden === calm.id ? `<button class="calm-banner" data-act="calm-show"><span>진정 시간</span><b data-calm-left>${calmLeft(calm)}</b><em>다시 열기</em></button>` : ''}
    <div class="screen">${view}</div>
    ${state.view === 'today' || state.view === 'upcoming' ? `<button class="fab" data-act="add" aria-label="추가">${ICON.plus}</button>` : ''}
    <nav class="tabbar">${tabs.map(([v, l]) => `<button data-act="view" data-v="${v}" aria-current="${state.view === v ? 'page' : 'false'}">${l}</button>`).join('')}</nav>`;
  updateBadge();
  if (state.view === 'mood') drawMoodChart();
  renderCalm();
  ensurePlaceInfo();
}

// 장소 검색 (폼 제출)
$app.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-psearch]')) return;
  e.preventDefault();
  const q = e.target.elements.q.value.trim();
  if (q) { e.target.elements.q.blur(); runPlaceSearch(q); }
});

// ------------------------------------------------------------------ 진정하기
// 한 사람이 요청하면 두 사람 화면 모두에 진정 시간이 크게 뜸.
// 근거: Gottman 연구소는 다툼 중 흥분(심박 100 이상)하면 최소 20분 쉬기를 권하고,
//       분당 6회 정도의 느린 호흡은 각성을 낮춘다는 연구가 있어 4초 들이쉬고 6초 내쉬기로 안내.
const CALM_MINUTES = [[10, '10분'], [20, '20분'], [30, '30분'], [60, '1시간']];
let calmTimer = null;
let lastCalmId = null;
let calmEndedByMe = false;

function activeCalm() {
  const s = store.calm;
  if (!s || s.ended_at || Date.now() - Date.parse(s.ends_at) > 12 * 3600000) return null;
  return s;
}
const calmDone = (s) => Date.now() >= Date.parse(s.ends_at);
function calmLeft(s) {
  const sec = Math.max(0, Math.ceil((Date.parse(s.ends_at) - Date.now()) / 1000));
  if (!sec) return '끝';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  const mmss = `${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

function calmButton() {
  const s = activeCalm();
  return s
    ? `<button class="calm-btn on" data-act="calm-show">${ICON.breath}진정 시간 <b data-calm-left>${calmLeft(s)}</b></button>`
    : `<button class="calm-btn" data-act="calm-open">${ICON.breath}진정하기</button>`;
}

function openCalmSheet() {
  const p = partner();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet calm-sheet" role="dialog" aria-modal="true" aria-label="진정하기">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <h2 class="sheet-title">진정하기</h2>
      <span class="sheet-head-pad" aria-hidden="true"></span>
    </div>
    <p class="calm-lead">${p ? `${esc(p.name)}의 화면에도` : '두 사람 화면에'} 진정 시간이 크게 떠요. 둘 다 잠시 쉬고, 정한 시간 뒤에 다시 이야기해요.</p>
    <div class="field"><span>얼마나 쉴까요</span>
      <div class="seg4">${CALM_MINUTES.map(([v, l]) => `<label><input type="radio" name="minutes" value="${v}" ${v === 20 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </div>
    <label class="field"><span>한마디 <small>선택</small></span><textarea name="message" id="calm-msg" rows="2" maxlength="200" placeholder="예: 잠깐 쉬고 이따 꼭 다시 얘기하자"></textarea></label>
    <button type="submit" class="btn calm-send wide">진정 요청 보내기</button>
    <p class="hint">다툴 때 심장이 빨리 뛰면 최소 20분은 쉬고 다시 이야기하는 게 좋다고 해요.</p>
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');
  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const s = await store.startCalm({ minutes: Number(form.elements.minutes.value), message: form.elements.message.value.trim() || null });
      store.callFn({ action: 'calm', event: 'start', session_id: s.id }).catch(() => {});
      state.calmHidden = null;
      close(); render();
    } catch (e) { toast(e.message); btn.disabled = false; }
  });
}

function calmMarkup(s) {
  const me = store.me;
  const sender = member(s.from_member);
  const iSent = s.from_member === me.id;
  const other = iSent ? partner() : sender;
  const done = calmDone(s);
  const endAt = fromMinKst(s.ends_at);
  const title = iSent
    ? `${esc(other?.name ?? '상대')}에게 진정 요청을 보냈어요`
    : `${esc(ga(sender?.name ?? '상대'))} 잠시 진정하자고 해요`;
  const status = s.accepted_at
    ? (iSent ? `${esc(ga(other?.name ?? '상대'))} 진정하기로 했어요` : '진정하기로 했어요. 고마워요.')
    : (iSent ? `아직 ${esc(ga(other?.name ?? '상대'))} 확인하기 전이에요` : '');
  const actions = [];
  if (!iSent && !s.accepted_at && !done) actions.push('<button class="btn calm-primary wide" data-calm="accept">나도 진정할게</button>');
  if (done) actions.push('<button class="btn calm-primary wide" data-calm="end">다시 이야기할 준비됐어</button>');
  actions.push('<button class="btn calm-quiet wide" data-calm="hide">잠깐 닫기</button>');
  return `
  <div class="calm-inner">
    <p class="calm-kicker">진정 시간</p>
    <h2 id="calm-title">${title}</h2>
    ${s.message ? `<blockquote class="calm-msg">${esc(s.message)}</blockquote>` : ''}
    <div class="breath ${done ? 'rest' : ''}" aria-hidden="true">
      <span class="breath-glow"></span>
      <span class="breath-core"><span class="b-in">들이쉬고</span><span class="b-out">내쉬고</span><span class="b-done">충분히<br>쉬었어요</span></span>
    </div>
    <p class="breath-guide">${done ? '시간이 다 됐어요. 준비되면 차분하게 이야기해요.' : '4초 들이쉬고, 6초 천천히 내쉬어요'}</p>
    <p class="calm-left">${done ? `${endAt}에 끝났어요` : `<b data-calm-left>${calmLeft(s)}</b> 남음 · ${endAt}에 다시 이야기해요`}</p>
    ${status ? `<p class="calm-status">${status}</p>` : ''}
    <div class="calm-actions">${actions.join('')}</div>
    ${done ? '' : '<button class="calm-end-early" data-calm="end">지금 끝내기</button>'}
    <p class="calm-tip">지금은 누가 옳은지 따지기보다 몸을 가라앉힐 시간이에요. 걷기, 음악, 물 한 잔도 좋아요.</p>
  </div>`;
}

// ISO 시각 → 한국 시각 "HH:MM"
function fromMinKst(iso) {
  const k = nowKST(Date.parse(iso));
  return `${String(Math.floor(k.min / 60)).padStart(2, '0')}:${String(k.min % 60).padStart(2, '0')}`;
}

function renderCalm() {
  const s = activeCalm();
  let el = document.getElementById('calm');
  // 상대가 끝내서 사라진 경우 알려 주기
  if (!s && lastCalmId && !calmEndedByMe) toast('진정 시간이 끝났어요. 차분하게 이야기해요');
  lastCalmId = s?.id ?? null;
  calmEndedByMe = false;

  if (!s) { el?.remove(); clearInterval(calmTimer); calmTimer = null; document.documentElement.classList.remove('calm-lock'); return; }

  if (state.calmHidden === s.id) { el?.remove(); document.documentElement.classList.remove('calm-lock'); }
  else {
    const sig = `${s.id}|${s.accepted_at}|${calmDone(s)}|${store.me.id}`;
    if (!el || el.dataset.sig !== sig) {
      const fresh = !el;
      if (!el) {
        el = document.createElement('div');
        el.id = 'calm';
        el.className = 'calm';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'calm-title');
        el.addEventListener('click', onCalmClick);
        document.body.appendChild(el);
      }
      el.dataset.sig = sig;
      el.innerHTML = calmMarkup(s);
      if (fresh) el.querySelector('.calm-primary, .calm-quiet')?.focus();
    }
    document.documentElement.classList.add('calm-lock');
  }

  // 남은 시간 1초마다 갱신, 끝나는 순간 화면 전환
  if (!calmTimer) {
    let wasDone = calmDone(s);
    calmTimer = setInterval(() => {
      const cur = activeCalm();
      if (!cur) { renderCalm(); return; }
      document.querySelectorAll('[data-calm-left]').forEach((n) => { n.textContent = calmLeft(cur); });
      const d = calmDone(cur);
      if (d !== wasDone) { wasDone = d; render(); }
    }, 1000);
  }
}

async function onCalmClick(e) {
  const b = e.target.closest('[data-calm]');
  if (!b) return;
  const s = activeCalm();
  if (!s) return;
  try {
    if (b.dataset.calm === 'hide') { state.calmHidden = s.id; render(); }
    else if (b.dataset.calm === 'accept') {
      b.disabled = true;
      await store.acceptCalm(s.id);
      store.callFn({ action: 'calm', event: 'accept', session_id: s.id }).catch(() => {});
      render();
    } else if (b.dataset.calm === 'end') {
      b.disabled = true;
      calmEndedByMe = true;
      await store.endCalm(s.id);
      store.callFn({ action: 'calm', event: 'end', session_id: s.id }).catch(() => {});
      render();
      toast('진정 시간을 마쳤어요. 차분하게 이야기해요');
    }
  } catch (err) { calmEndedByMe = false; b.disabled = false; toast(err.message); }
}

function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const d = today();
  const n = store.items.filter((i) => i.kind === 'task' && (i.owner === null || i.owner === store.me.id) && occursOn(i, d) && !isDone(store.completions, i.id, d)).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ------------------------------------------------------------------ 추가/수정 시트
function openSheet(item, preset = {}) {
  const isNew = !item;
  const it = item ?? {
    kind: 'task', title: '', note: '', owner: store.me.id, start_date: state.view === 'today' ? state.date : today(),
    time: null, end_date: null, repeat: 'none', weekdays: [], remind_before: null, nag_every: 0, difficulty: 'normal',
    place_id: null, ...preset,
  };
  const curDiff = DIFF[it.difficulty] ? it.difficulty : 'normal';
  const ownerOpts = [[store.me.id, '나'], ...(partner() ? [[partner().id, partner().name]] : []), ['', '공통']];
  const wds = it.weekdays?.length ? it.weekdays : [dow(it.start_date)];

  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
  <div class="scrim" data-close></div>
  <form class="sheet" role="dialog" aria-modal="true" aria-label="${isNew ? '새 항목' : '항목 수정'}">
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="linkbtn" data-close>취소</button>
      <div class="seg2" role="radiogroup" aria-label="종류">
        <label><input type="radio" name="kind" value="task" ${it.kind === 'task' ? 'checked' : ''}><span>할일</span></label>
        <label><input type="radio" name="kind" value="event" ${it.kind === 'event' ? 'checked' : ''}><span>약속</span></label>
      </div>
      <button type="submit" class="linkbtn strong">${isNew ? '추가' : '저장'}</button>
    </div>
    <input class="title-in" name="title" placeholder="무엇을 할까요?" value="${esc(it.title)}" maxlength="200" required autocomplete="off">

    <div class="field"><span>장소 <small>갈 곳에서 추천</small></span>
      <input type="hidden" name="place_id" value="${it.place_id ?? ''}">
      <div class="place-pick" data-place-pick></div>
    </div>

    <div class="field"><span>누구</span>
      <div class="seg3">${ownerOpts.map(([v, l]) => `<label><input type="radio" name="owner" value="${v}" ${(it.owner ?? '') === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
    </div>

    <div class="field" data-show="task"><span>난이도 <small data-qtype></small></span>
      <div class="seg4">${DIFF_KEYS.map((k) => `<label><input type="radio" name="difficulty" value="${k}" ${curDiff === k ? 'checked' : ''}><span data-d="${k}">${DIFF[k].label}<b>+${DIFF[k].xp}</b></span></label>`).join('')}</div>
    </div>

    <div class="grid2">
      <label class="field"><span>날짜</span><input type="date" name="start_date" value="${it.start_date}" required></label>
      <label class="field"><span>시간</span><input type="time" name="time" value="${hm(it.time)}"></label>
    </div>

    <label class="field"><span>반복</span>
      <select name="repeat">
        ${[['none', '반복 안 함'], ['daily', '매일'], ['weekly', '매주'], ['monthly', '매월']].map(([v, l]) => `<option value="${v}" ${it.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </label>
    <div class="weekdays" data-show="weekly" role="group" aria-label="반복 요일">
      ${W.map((w, i) => `<label><input type="checkbox" name="wd" value="${i}" ${wds.includes(i) ? 'checked' : ''}><span>${w}</span></label>`).join('')}
    </div>
    <label class="field" data-show="repeating"><span>반복 종료일 <small>비워 두면 계속</small></span><input type="date" name="end_date" value="${it.end_date ?? ''}"></label>

    <div data-show="timed">
      <label class="field" data-show="task"><span>알림</span>
        <select name="remind_task">
          <option value="">알림 없음</option><option value="0" ${it.kind === 'task' && it.remind_before === 0 ? 'selected' : ''}>시간에 알림</option>
        </select>
      </label>
      <label class="field" data-show="task-remind"><span>완료할 때까지 다시 알림</span>
        <select name="nag_every">
          ${[[0, '안 함'], [30, '30분마다'], [60, '1시간마다'], [120, '2시간마다']].map(([v, l]) => `<option value="${v}" ${it.nag_every === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <label class="field" data-show="event"><span>미리 알림</span>
        <select name="remind_event">
          ${[['', '알림 없음'], [0, '정시'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [180, '3시간 전'], [1440, '하루 전']].map(([v, l]) => `<option value="${v}" ${it.kind === 'event' && String(it.remind_before ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="hint" data-show="untimed">시간을 정하면 그 시간에 알림을 받을 수 있어요. 시간이 없어도 아침 브리핑에는 포함돼요.</p>

    <label class="field"><span>메모</span><textarea name="note" rows="2" placeholder="장소, 준비물 등">${esc(it.note ?? '')}</textarea></label>
    ${isNew ? '' : '<button type="button" class="btn danger" data-del>삭제</button>'}
  </form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form');

  // 장소: 고른 장소 표시 + 갈 곳 목록 추천 (아직 안 가 본 곳 먼저)
  const pickBox = form.querySelector('[data-place-pick]');
  const drawPick = () => {
    const sel = store.places.find((p) => p.id === form.elements.place_id.value);
    const recs = [...store.places].sort((a, b) => Boolean(a.visited_at) - Boolean(b.visited_at)).filter((p) => p.id !== sel?.id).slice(0, 10);
    pickBox.innerHTML = `
      ${sel ? `<div class="pp-sel">${ICON.pin}<span><b>${esc(placeLabel(sel))}</b>${placeSub(sel) ? `<small>${esc(placeSub(sel))}</small>` : ''}</span><button type="button" class="pp-x" data-unpick aria-label="장소 빼기">×</button></div>` : ''}
      ${recs.length ? `<div class="pp-recs">${recs.map((p) => `<button type="button" class="pp-chip ${p.visited_at ? 'visited' : ''}" data-pick="${p.id}">${ICON.pin}${esc(placeLabel(p))}</button>`).join('')}</div>`
        : sel ? '' : '<p class="hint">일정 탭 › 갈 곳에서 장소를 저장하면 여기서 바로 고를 수 있어요.</p>'}`;
  };
  pickBox.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      form.elements.place_id.value = pick.dataset.pick;
      const p = store.places.find((x) => x.id === pick.dataset.pick);
      if (!form.elements.title.value.trim()) form.elements.title.value = placeLabel(p);
      drawPick();
    } else if (e.target.closest('[data-unpick]')) { form.elements.place_id.value = ''; drawPick(); }
  });
  drawPick();

  // 새 항목에 시간 입력 시 알림 기본값 켜기
  const timeIn = form.elements.time;
  timeIn.addEventListener('change', () => {
    if (!isNew || !timeIn.value) return;
    if (form.elements.remind_task.value === '') form.elements.remind_task.value = '0';
    if (form.elements.remind_event.value === '') form.elements.remind_event.value = '30';
    sync();
  });

  function sync() {
    const kind = form.elements.kind.value;
    const rep = form.elements.repeat.value;
    const timed = Boolean(timeIn.value);
    const show = {
      weekly: rep === 'weekly', repeating: rep !== 'none', timed, untimed: !timed,
      task: kind === 'task', event: kind === 'event',
      'task-remind': kind === 'task' && form.elements.remind_task.value !== '',
    };
    form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !show[el.dataset.show]; });
    form.elements.title.placeholder = kind === 'event' ? '어떤 약속인가요?' : '무엇을 할까요?';
    form.querySelector('[data-qtype]').textContent = `· ${rep === 'none' ? '서브 퀘스트' : '데일리 퀘스트'}`;
  }
  form.addEventListener('change', sync);
  sync();

  const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('open'));
  if (isNew) setTimeout(() => form.elements.title.focus(), 250);

  form.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`"${it.title}"을(를) 삭제할까요?${it.repeat !== 'none' ? '\n반복되는 모든 날짜에서 삭제돼요.' : ''}`)) return;
    try { await store.deleteItem(it.id); close(); render(); toast('삭제했어요'); } catch (e) { toast(e.message); }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const kind = f.kind.value;
    const time = f.time.value || null;
    const repeat = f.repeat.value;
    let remind = kind === 'task' ? f.remind_task.value : f.remind_event.value;
    remind = time && remind !== '' ? Number(remind) : null;
    const data = {
      ...(isNew ? {} : { id: it.id }),
      kind, title: f.title.value.trim(), note: f.note.value.trim() || null,
      owner: f.owner.value || null, start_date: f.start_date.value, time,
      repeat, weekdays: repeat === 'weekly' ? [...form.querySelectorAll('[name=wd]:checked')].map((x) => Number(x.value)) : [],
      end_date: repeat !== 'none' && f.end_date.value ? f.end_date.value : null,
      remind_before: remind, nag_every: kind === 'task' && remind != null ? Number(f.nag_every.value) : 0,
      difficulty: kind === 'task' ? f.difficulty.value : 'normal',
      place_id: f.place_id.value || null,
    };
    if (!data.title) return;
    if (repeat === 'weekly' && !data.weekdays.length) { toast('반복할 요일을 하나 이상 고르세요'); return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const saved = await store.saveItem(data);
      close(); render();
      toast(isNew ? '추가했어요' : '저장했어요');
      if (isNew && data.owner !== store.me.id) store.callFn({ action: 'notify', verb: 'added', item_id: saved.id }).catch(() => {});
    } catch (e) { toast(e.message); btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ 푸시 구독
function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!CONFIG.VAPID_PUBLIC_KEY) { toast('config.js 에 VAPID 공개 키가 없어요'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { render(); toast('알림이 허용되지 않았어요'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await store.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  render();
  toast('알림을 켰어요');
}

// ------------------------------------------------------------------ 이벤트
$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    if (act === 'view') { state.view = el.dataset.v; if (state.view === 'today') state.date = today(); render(); window.scrollTo(0, 0); }
    else if (act === 'filter') { state.filter = el.dataset.v; render(); }
    else if (act === 'day') { const n = Number(el.dataset.n); state.date = n === 0 ? today() : addDays(state.date, n); render(); }
    else if (act === 'add') openSheet(null);
    else if (act === 'edit') openSheet(store.items.find((i) => i.id === el.dataset.id));
    else if (act === 'toggle') {
      const { id, date } = el.dataset;
      const done = !isDone(store.completions, id, date);
      el.closest('.row').classList.toggle('done', done);
      if (done && navigator.vibrate) navigator.vibrate(10);
      const before = levelsNow();
      await store.toggle(id, date, done);
      setTimeout(render, done ? 320 : 0);
      const item = store.items.find((i) => i.id === id);
      if (item?.kind === 'task') {
        const earner = member(earnerOf(item, store.me.id));
        const who = earner && earner.id !== store.me.id ? `${earner.name} ` : '';
        toast(`${who}${done ? '+' : '−'}${xpOf(item)} XP · ${item.title}`);
      }
      if (done && item && item.owner !== store.me.id) store.callFn({ action: 'notify', verb: 'done', item_id: id }).catch(() => {});
      if (done) handleLevelUps(before);
      // 장소가 연결된 일정을 끝내면 그 장소는 '다녀온 곳'으로
      const pl = done && item?.place_id ? store.places.find((p) => p.id === item.place_id) : null;
      if (pl && !pl.visited_at) {
        await store.updatePlace(pl.id, { visited_at: new Date().toISOString() });
        setTimeout(() => toast(`다녀온 곳으로 옮겼어요 · ${placeLabel(pl)}`), 1400);
      }
    }
    else if (act === 'lvwho') { state.lvWho = el.dataset.v; render(); }
    else if (act === 'uptab') { state.upTab = el.dataset.v; render(); window.scrollTo(0, 0); }
    else if (act === 'place-filter') { state.placeFilter = el.dataset.v; render(); }
    else if (act === 'place-tag') { state.placeTag = el.dataset.v || null; render(); }
    else if (act === 'place-clear') { state.placeResults = null; state.placeQuery = ''; render(); }
    else if (act === 'place-manual') openManualPlaceSheet();
    else if (act === 'place-open') openPlaceSheet(store.places.find((p) => p.id === el.dataset.id));
    else if (act === 'place-plan') {
      const p = store.places.find((x) => x.id === el.dataset.id);
      openSheet(null, { kind: 'event', place_id: p.id, title: placeLabel(p), start_date: today() });
    }
    else if (act === 'place-add') {
      const r = state.placeResults?.results?.[Number(el.dataset.i)];
      if (!r) return;
      el.disabled = true;
      const p = await store.addPlace(r, state.placeResults.query);
      if (p.source === 'kakao') placeInfo.set(p.id, r);   // 방금 검색한 실시간 결과로 바로 표시
      state.placeFilter = 'want';
      render();
      // 저장하면서 바로 태그·메모를 달 수 있게 장소 시트를 열어 줌
      openPlaceSheet(store.places.find((x) => x.id === p.id) ?? p, { justAdded: true });
    }
    else if (act === 'mood-add') openMoodSheet(el.dataset.day, el.dataset.emoji || null);
    else if (act === 'moodwho') { state.moodWho = el.dataset.v; state.moodHistAll = false; render(); }
    else if (act === 'mood-more') { state.moodHistAll = true; render(); }
    else if (act === 'mood-range') { state.moodRange = Number(el.dataset.v); render(); }
    else if (act === 'mood-key') {
      const k = el.dataset.v, pk = el.dataset.p;
      const cur = state.moodKeys[pk] ?? PROFILES[pk].defaultKeys;
      state.moodKeys[pk] = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      render();
    }
    else if (act === 'calm-open') openCalmSheet();
    else if (act === 'calm-show') { state.calmHidden = null; render(); }
    else if (act === 'reward-add') openRewardSheet(null, state.lvWho ?? store.me.id);
    else if (act === 'reward-edit') openRewardSheet(store.rewards.find((r) => r.id === el.dataset.id));
    else if (act === 'claim') {
      const r = store.rewards.find((x) => x.id === el.dataset.id);
      const claim = !r.claimed_at;
      await store.claimReward(r.id, claim);
      render();
      toast(claim ? `보상을 받았어요 · ${r.title}` : '받음 표시를 취소했어요');
    }
    else if (act === 'push') await enablePush();
    else if (act === 'testpush') { const r = await store.callFn({ action: 'test' }); toast(r?.sent ? '테스트 알림을 보냈어요' : '등록된 기기가 없어요. 알림을 다시 켜 보세요'); }
    else if (act === 'switch') { store.switchUser(); state.filter = 'all'; render(); toast(`${ro(store.me.name)} 보는 중`); }
    else if (act === 'reset') { store.reset(); render(); toast('예시 데이터로 초기화했어요'); }
    else if (act === 'logout') { await store.signOut(); location.reload(); }
  } catch (err) { toast(err.message || '문제가 생겼어요'); }
});

$app.addEventListener('change', async (e) => {
  if (e.target.matches('[data-moodprof]')) {
    try { await store.updateMe({ mood_profile: e.target.value }); render(); toast('감정 기록 방식을 바꿨어요'); } catch (err) { toast(err.message); }
    return;
  }
  const el = e.target.closest('[data-pref]');
  if (!el || !el.value) return;
  try { await store.updateMe({ [el.dataset.pref]: el.value }); toast('시간을 바꿨어요'); } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------------ 로그인
function loginView(msg = '') {
  $app.innerHTML = `
  <main class="login">
    <div class="logo" aria-hidden="true"><span></span><span></span></div>
    <h1>우리할일</h1>
    <p class="sub">둘이 같이 쓰는 할일과 약속</p>
    <form id="login">
      <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label>
      ${msg ? `<p class="error">${esc(msg)}</p>` : ''}
      <button class="btn primary wide" type="submit">로그인</button>
    </form>
  </main>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    e.target.querySelector('button').disabled = true;
    try { await store.signIn(f.email.value.trim(), f.password.value); render(); } catch (err) { loginView(err.message); }
  });
}

// ------------------------------------------------------------------ 시작
(async function start() {
  if ('serviceWorker' in navigator && !store.demo) navigator.serviceWorker.register('sw.js').catch(() => {});
  store.onChange(render);
  try {
    const { needLogin } = await store.init();
    if (needLogin) loginView(); else render();
  } catch (e) {
    loginView(e.message);
  }
  // 자정이 지나면 날짜 갱신
  let last = today();
  setInterval(() => { if (today() !== last) { if (state.date === last) state.date = today(); last = today(); render(); } }, 60000);
})();
