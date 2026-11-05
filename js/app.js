import { CONFIG } from './config.js';
import { createStore } from './store.js';
import {
  nowKST, addDays, dow, occursOn, isDone, overdue, toMin, repeatLabel,
} from './schedule.js';

const store = createStore();
const $app = document.getElementById('app');
const W = ['일', '월', '화', '수', '목', '금', '토'];
const SHARED = '#2f9e7a';

const state = {
  view: 'today',          // today | upcoming | settings
  date: nowKST().date,     // 오늘 화면에서 보고 있는 날짜
  filter: 'all',           // all | <memberId> | shared
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
  if (item.note) meta.push(`<span class="note">${esc(item.note)}</span>`);
  return `
  <li class="row ${item.kind} ${done ? 'done' : ''}" style="--c1:${c1};--c2:${c2}">
    <span class="stripe" aria-hidden="true"></span>
    <button class="check" data-act="toggle" data-id="${item.id}" data-date="${date}" aria-pressed="${done}" aria-label="${esc(item.title)} ${done ? '완료 취소' : '완료'}">${ICON.check}</button>
    <button class="body" data-act="edit" data-id="${item.id}">
      <span class="line1">${item.time ? `<span class="time">${hm(item.time)}</span>` : ''}${item.kind === 'event' ? '<span class="kind">약속</span>' : ''}<span class="title">${esc(item.title)}</span></span>
      ${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}
    </button>
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

function todayView() {
  const d = state.date;
  const all = store.items.filter((i) => occursOn(i, d));
  const list = all.filter(passFilter).sort(sortByTime);
  const late = d === today() ? overdue(store.items, store.completions, d).filter(passFilter).sort((a, b) => a.start_date.localeCompare(b.start_date)) : [];
  const events = list.filter((i) => i.kind === 'event');
  const tasks = list.filter((i) => i.kind === 'task');
  const open = tasks.filter((i) => !isDone(store.completions, i.id, d));
  const closed = tasks.filter((i) => isDone(store.completions, i.id, d));
  const rd = relDay(d);

  return `
  <header class="top">
    <div class="datenav">
      <button class="iconbtn" data-act="day" data-n="-1" aria-label="이전 날">${ICON.left}</button>
      <h1>${rd && rd !== '오늘' ? `<small>${rd}</small>` : ''}${longDate(d)}</h1>
      <button class="iconbtn" data-act="day" data-n="1" aria-label="다음 날">${ICON.right}</button>
    </div>
    ${d !== today() ? '<button class="linkbtn" data-act="day" data-n="0">오늘로 돌아가기</button>' : ''}
    ${progressBar(all.filter((i) => i.kind === 'task'), d)}
  </header>
  ${filterChips()}
  <main class="lists">
    ${late.length ? `<section><h2 class="warn">밀린 할일 <span>${late.length}</span></h2><ul>${late.map((i) => row(i, i.start_date, { showDate: true })).join('')}</ul></section>` : ''}
    ${events.length ? `<section><h2>약속</h2><ul>${events.map((i) => row(i, d)).join('')}</ul></section>` : ''}
    <section><h2>할일 ${tasks.length ? `<span>${open.length}개 남음</span>` : ''}</h2>
      ${open.length ? `<ul>${open.map((i) => row(i, d)).join('')}</ul>` : tasks.length ? '<p class="empty">다 끝냈어요. 수고했어요!</p>' : `<p class="empty">이 날은 할일이 없어요.<br><button class="linkbtn" data-act="add">할일 추가하기</button></p>`}
      ${closed.length ? `<ul class="closed">${closed.map((i) => row(i, d)).join('')}</ul>` : ''}
    </section>
  </main>`;
}

// ------------------------------------------------------------------ 다가오는 일정
function upcomingView() {
  const start = today();
  const days = [];
  for (let k = 0; k < 30; k++) {
    const d = addDays(start, k);
    const list = store.items.filter((i) => i.repeat !== 'daily' && occursOn(i, d) && passFilter(i)).sort(sortByTime);
    if (list.length) days.push({ d, list });
  }
  return `
  <header class="top"><h1 class="plain">다가오는 일정</h1><p class="sub">앞으로 30일 · 매일 반복은 오늘 화면에서 보여요</p></header>
  ${filterChips()}
  <main class="lists">
    ${days.length ? days.map(({ d, list }) => `
      <section><h2>${relDay(d) ? `${relDay(d)} ` : ''}<span>${longDate(d)}</span></h2><ul>${list.map((i) => row(i, d)).join('')}</ul></section>`).join('')
      : '<p class="empty">앞으로 30일 동안 잡힌 일정이 없어요.</p>'}
  </main>`;
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
  const view = { today: todayView, upcoming: upcomingView, settings: settingsView }[state.view]();
  const tabs = [['today', '오늘'], ['upcoming', '일정'], ['settings', '설정']];
  $app.innerHTML = `
    ${store.demo ? '<div class="demo-banner">데모 모드 · 이 기기에만 저장돼요</div>' : ''}
    <div class="screen">${view}</div>
    ${state.view !== 'settings' ? `<button class="fab" data-act="add" aria-label="추가">${ICON.plus}</button>` : ''}
    <nav class="tabbar">${tabs.map(([v, l]) => `<button data-act="view" data-v="${v}" aria-current="${state.view === v ? 'page' : 'false'}">${l}</button>`).join('')}</nav>`;
  updateBadge();
}

function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const d = today();
  const n = store.items.filter((i) => i.kind === 'task' && (i.owner === null || i.owner === store.me.id) && occursOn(i, d) && !isDone(store.completions, i.id, d)).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ------------------------------------------------------------------ 추가/수정 시트
function openSheet(item) {
  const isNew = !item;
  const it = item ?? {
    kind: 'task', title: '', note: '', owner: store.me.id, start_date: state.view === 'today' ? state.date : today(),
    time: null, end_date: null, repeat: 'none', weekdays: [], remind_before: null, nag_every: 0,
  };
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

    <div class="field"><span>누구</span>
      <div class="seg3">${ownerOpts.map(([v, l]) => `<label><input type="radio" name="owner" value="${v}" ${(it.owner ?? '') === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
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
      await store.toggle(id, date, done);
      setTimeout(render, done ? 320 : 0);
      const item = store.items.find((i) => i.id === id);
      if (done && item && item.owner !== store.me.id) store.callFn({ action: 'notify', verb: 'done', item_id: id }).catch(() => {});
    }
    else if (act === 'push') await enablePush();
    else if (act === 'testpush') { const r = await store.callFn({ action: 'test' }); toast(r?.sent ? '테스트 알림을 보냈어요' : '등록된 기기가 없어요. 알림을 다시 켜 보세요'); }
    else if (act === 'switch') { store.switchUser(); state.filter = 'all'; render(); toast(`${ro(store.me.name)} 보는 중`); }
    else if (act === 'reset') { store.reset(); render(); toast('예시 데이터로 초기화했어요'); }
    else if (act === 'logout') { await store.signOut(); location.reload(); }
  } catch (err) { toast(err.message || '문제가 생겼어요'); }
});

$app.addEventListener('change', async (e) => {
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
