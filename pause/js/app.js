// PAUSE — 싸움이 위험해질 때 켜는 앱
// 🚨 PAUSE → 20초 상태 체크 → 15분 진정 → 재측정 → 중재 대화 → 행동 약속 → 종료 → 기록
import { CONFIG } from './config.js';
import { createStore } from './store.js';
import { STYLES, SIGNAL_EXAMPLES, CHECK_ITEMS, RED_ITEMS, NONE_ITEM, EMOTIONS, TRIGGERS, QUICK, HELP_LINES, CALM_MAX } from './data.js';
import { review, reflect, iMessage, batchim } from './filter.js';
import { speakers, talkState, evaluate, summarize } from './flow.js';

const store = createStore();
const $app = document.getElementById('app');
const state = { tab: 'home', drafts: {}, review: null, armed: null, activeId: null, summaryId: null, ob: null };

// ------------------------------------------------------------------ 유틸
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString();
const W = ['일', '월', '화', '수', '목', '금', '토'];
const dateLabel = (iso) => { const d = kst(Date.parse(iso)); return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 ${W[new Date(d.slice(0, 10) + 'T00:00:00Z').getUTCDay()]}`; };
const hhmm = (iso) => kst(Date.parse(iso)).slice(11, 16);
const nameOf = (id) => store.members.find((m) => m.id === id)?.name ?? '';
const nim = (id) => `${nameOf(id)}님`;
const eul = (w) => (batchim(w) ? '을' : '를');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const myProfile = () => store.profiles[store.me.id] ?? null;
const styleOf = (id) => store.profiles[id]?.style ?? 'heat';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
// 두 번 눌러야 실행 (실수 방지)
function armed(key, label, armedLabel) {
  return state.armed === key ? armedLabel : label;
}
function arm(key) {
  if (state.armed === key) { state.armed = null; return true; }
  state.armed = key; render();
  clearTimeout(arm.t); arm.t = setTimeout(() => { if (state.armed === key) { state.armed = null; render(); } }, 4000);
  return false;
}

// 세션별 내 진행 상태 (이 기기)
const uiKey = () => `pause-ui-${store.open?.id}-${store.me.id}`;
function ui() { try { return JSON.parse(localStorage.getItem(uiKey()) || '{}'); } catch { return {}; } }
function setUi(p) { try { localStorage.setItem(uiKey(), JSON.stringify({ ...ui(), ...p })); } catch {} }

const draft = (k) => esc(state.drafts[k] ?? '');
const ta = (k, ph, rows = 4, max = 1000) => `<textarea data-draft="${k}" id="d-${k}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${draft(k)}</textarea>`;

// ------------------------------------------------------------------ 세션 데이터
const S = () => store.open;
const checkOf = (mid, round) => store.checks.find((c) => c.session_id === S()?.id && c.member_id === mid && c.round === round);
const myPriv = (kind) => store.privates.filter((p) => p.kind === kind);
const lastPriv = (kind) => myPriv(kind).at(-1) ?? null;

async function act(fn) {
  try { await fn(); } catch (e) { toast(e.message || '문제가 생겼어요'); }
  render();
}

// ------------------------------------------------------------------ 화면 틀
const shell = (tone, body, foot = '', { top = '' } = {}) => `
  <div class="stage" data-tone="${tone}">
    ${store.demo ? demoBar() : ''}
    ${top ? `<header class="stage-top">${top}</header>` : ''}
    <main class="stage-body">${body}</main>
    ${foot ? `<footer class="stage-foot">${foot}</footer>` : ''}
  </div>`;
const demoBar = () => `<div class="demo-bar"><span>데모 · ${esc(store.me.name)}로 보는 중</span><button data-a="demo-switch">${esc(store.partner?.name)}로 바꾸기</button></div>`;
const say = (t, s) => `<h1 class="say">${t}</h1>${s ? `<p class="say-sub">${s}</p>` : ''}`;
const btn = (label, a, cls = 'primary', data = '') => `<button class="btn ${cls}" data-a="${a}" ${data}>${label}</button>`;
const redLink = () => `<button class="redlink" data-a="go-red">${state.armed === 'red' ? '한 번 더 누르면 안전 화면으로 가요' : '🔴 지금 위험해요 · 통제가 어려워요'}</button>`;

// ------------------------------------------------------------------ 1) PAUSE 시작 안내
function introView() {
  const s = S();
  const mine = s.started_by === store.me.id;
  return shell('alarm', `
    <p class="eyebrow">${mine ? `${nim(store.partner?.id)} 폰에도 떴어요` : 'PAUSE'}</p>
    ${say(mine ? 'PAUSE를 보냈어요.' : `${nim(s.started_by)}이 PAUSE를 요청했어요.`)}
    <ul class="vows">
      <li>지금 누가 옳은지는 판단하지 않습니다.</li>
      <li>관계를 끝내자는 의미도 아닙니다.</li>
      <li>15분 동안 싸움의 강도를 낮추는 것이 목표입니다.</li>
    </ul>`, btn('20초 상태 체크', 'intro-ok'));
}

// ------------------------------------------------------------------ 2) 20초 상태 체크
function checkView() {
  const p = myProfile();
  const st = styleOf(store.me.id);
  const own = [...new Set([...CHECK_ITEMS[st], ...(p?.signals ?? []).filter((x) => !CHECK_ITEMS[st].includes(x))])];
  const sel = new Set(state.drafts.items ?? []);
  const v = state.drafts.intensity ?? null;
  const row = (label, cls = '') => `<label class="ck ${cls}"><input type="checkbox" data-item="${esc(label)}" ${sel.has(label) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  return shell('alarm', `
    ${say('지금 해당되는 게 있어?', '누가 잘못했는지는 판정하지 않아요.')}
    <div class="cklist">
      ${own.map((x) => row(x)).join('')}
      ${RED_ITEMS.map((x) => row(x.label, 'danger')).join('')}
      ${row(NONE_ITEM, 'none')}
    </div>
    <div class="intensity">
      <p class="lab">지금 감정 강도 <b class="num">${v ?? '–'}</b><small>/ 10</small></p>
      <input type="range" min="0" max="10" step="1" value="${v ?? 5}" data-intensity aria-label="감정 강도 0~10" class="${v == null ? 'unset' : ''}">
      <div class="scale"><span>0 차분</span><span>10 폭발 직전</span></div>
    </div>`, btn('확인', 'check-done', 'primary', v == null ? 'disabled' : ''));
}

// ------------------------------------------------------------------ 3) 15분 진정
const HEAT_STEPS = ['water', 'thought', 'emotion', 'vent', 'reflect', 'rest'];
const CHASE_STEPS = ['explain', 'emotion', 'save', 'reflect', 'rest'];

function coolView() {
  const s = S();
  const u = ui();
  const st = styleOf(store.me.id);
  const steps = st === 'heat' ? HEAT_STEPS : CHASE_STEPS;
  const step = steps[Math.min(u.step ?? 0, steps.length - 1)];
  const got = store.messages.filter((m) => m.kind === 'quick' && m.from_member !== store.me.id).slice(-3);
  const sent = new Set(store.messages.filter((m) => m.kind === 'quick' && m.from_member === store.me.id).map((m) => m.body));
  const partnerChecked = checkOf(store.partner?.id, 0);
  return shell('calm', `
    <div class="timer-box">
      <p class="timer" data-timer>${mmss(Date.parse(s.cool_until) - Date.now())}</p>
      <p class="timer-say">지금은 해결 시간이 아닙니다.</p>
      <p class="timer-sub">이 시간에는 카톡으로 싸움을 이어가지 않아요.${s.extensions ? ` · ${s.extensions}번째 추가 시간` : ''}</p>
    </div>
    ${got.length ? `<ul class="got">${got.map((m) => `<li><b>${esc(nameOf(m.from_member))}</b> ${esc(m.body)} <small>${hhmm(m.created_at)}</small></li>`).join('')}</ul>` : ''}
    ${!partnerChecked ? `<p class="hint-c">${esc(nim(store.partner?.id))}은 아직 앱을 열지 않았어요.</p>` : ''}
    <section class="guide">${coolStep(step, st)}</section>
    <section class="quick">
      <p class="q-lab">지금 ${esc(nim(store.partner?.id))}에게 보낼 수 있는 말</p>
      <div class="q-row">${QUICK.map((q) => `<button class="q" data-a="quick" data-v="${esc(q)}" ${sent.has(q) ? 'data-sent' : ''}>${esc(q)}${sent.has(q) ? '<small>보냄</small>' : ''}</button>`).join('')}</div>
    </section>
    ${redLink()}
    ${store.demo ? btn('⏩ 데모: 남은 시간 건너뛰기', 'demo-skip', 'ghost') : ''}`);
}

function coolStep(step, st) {
  const p = store.partner;
  const emo = lastPriv('emotion')?.body;
  const next = (label = '다음') => btn(label, 'cool-next', 'soft');
  switch (step) {
    case 'water':
      return `<p class="g-t">지금 하고 싶은 행동을 하지 않는 게 목표예요.</p><p class="g-big">물 한 컵 마시기</p>${next('마셨어 ✓')}`;
    case 'thought':
      return `<p class="g-big">지금 떠오르는 생각은 사실일 수도 있고 아닐 수도 있어요.</p><p class="g-t">결론은 15분 후에도 내릴 수 있어요.</p>${next('알겠어')}`;
    case 'explain':
      return `<p class="g-big">지금 ${esc(nim(p?.id))}에게 설명을 더 하면 진정될까, 더 자극될까?</p>
        ${ui().explain ? `<p class="g-t">${ui().explain === 'calm' ? '그럴 수도 있어요. 그래도 지금은 15분을 먼저 지켜요. 설명은 대화 단계에서 꼭 할 수 있어요.' : '그럼 지금은 멈추는 게 맞아요. 하고 싶은 말은 사라지지 않게 적어 둘 수 있어요.'}</p>${next()}`
          : `<div class="opts">${[['calm', '진정될 것 같아'], ['worse', '더 자극될 것 같아'], ['unsure', '모르겠어']].map(([v, l]) => `<button class="opt" data-a="explain" data-v="${v}">${l}</button>`).join('')}</div>`}`;
    case 'emotion':
      return `<p class="g-big">지금 제일 큰 감정은?</p>
        <div class="chips">${EMOTIONS.map((e) => `<button data-a="emotion" data-v="${e}" aria-pressed="${emo === e}">${e}</button>`).join('')}</div>`;
    case 'vent':
      return `<p class="g-big">하고 싶은 말을 여기에 써.</p><p class="g-t">${esc(nim(p?.id))}에게 전송되지 않아요.</p>
        ${ta('vent', '예: 진짜 너무 화나고 다 때려치우고 싶다', 5, 2000)}${btn('다 썼어', 'vent-done', 'soft')}`;
    case 'save':
      return `<p class="g-big">하고 싶은 말을 여기에 적어 두세요.</p><p class="g-t">지금은 보내지 않아요. 저장해 두고 대화 단계에서 전할 수 있어요.</p>
        ${ta('save', '예: 내가 그런 뜻으로 말한 게 아니라는 걸 알아줬으면', 5, 2000)}${btn('저장', 'save-done', 'soft')}`;
    case 'reflect': {
      const text = (st === 'heat' ? lastPriv('vent') : lastPriv('save'))?.body ?? '';
      const r = reflect(text, emo);
      const rv = review(text);
      return `<div class="mirror">${r.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
          ${st === 'chase' ? `<p>이 말은 저장해 뒀어요.${rv.level === 'ok' ? ' 대화 단계에서 그대로 전할 수 있어요.' : ''}</p>` : ''}</div>
        ${r.danger ? dangerBox() : ''}${next('알겠어')}`;
    }
    case 'rest':
      return st === 'heat'
        ? `<p class="g-big">남은 시간은 그냥 지나가게 둬요.</p>
           <ul class="ideas"><li>창문 열고 숨 크게 세 번</li><li>다른 방이나 밖으로 잠깐</li><li>찬물로 세수</li></ul>
           <button class="link" data-a="cool-back" data-v="3">더 쓰고 싶으면 다시 쓰기</button>`
        : `<p class="g-big">추가 질문 대신, 마음이 놓이게 하는 말 하나만 보내 볼래요?</p>
           <p class="g-t">답이 바로 안 와도 괜찮아요. 15분 뒤에 다시 만나요.</p>
           <button class="link" data-a="cool-back" data-v="2">적어 둔 말 고치기</button>`;
  }
  return '';
}

function dangerBox() {
  const h = HELP_LINES.suicide;
  return `<div class="danger-box"><p><b>죽고 싶거나 사라지고 싶다는 생각이 든다면, 혼자 견디지 않아도 돼요.</b></p>
    <a class="call" href="tel:${h.num}">${h.num} ${h.label}</a>
    <button class="btn danger" data-a="go-red-now">안전 화면으로 가기</button></div>`;
}

// ------------------------------------------------------------------ 4) 재측정
function recheckView(round) {
  const v = state.drafts[`r${round}`] ?? null;
  const cl = state.drafts[`l${round}`] ?? null;
  return shell('calm', `
    <p class="eyebrow">${round === 1 ? '15분' : '추가 10분'}이 지났어요</p>
    ${say('지금 감정 강도는?')}
    <div class="nums" role="radiogroup" aria-label="감정 강도">${Array.from({ length: 11 }, (_, i) => `<button role="radio" aria-checked="${v === i}" data-a="re-int" data-v="${i}" class="${i <= CALM_MAX ? 'lo' : i >= 8 ? 'hi' : ''}">${i}</button>`).join('')}</div>
    <p class="say-sub q2">${esc(nim(store.partner?.id))} 말을 들을 수 있을 것 같아?</p>
    <div class="opts row">${[['yes', '가능'], ['unsure', '잘 모르겠음'], ['no', '아직 불가능']].map(([k, l]) => `<button class="opt" data-a="re-listen" data-v="${k}" aria-pressed="${cl === k}">${l}</button>`).join('')}</div>
    ${redLink()}`, btn('확인', 're-done', 'primary', v == null || !cl ? 'disabled' : ''));
}

function evalView(round) {
  const s = S();
  const e = evaluate(store.checks.filter((c) => c.session_id === s.id), round, store.members);
  if (!e.ready) {
    return shell('calm', `${say(`${esc(e.waiting.map((m) => nim(m.id)).join(', '))}의 체크를 기다리는 중이에요.`, '둘 다 체크하면 대화를 시작할 수 있는지 알려 줄게요.')}
      <p class="mine-check">내 체크: 강도 ${checkOf(store.me.id, round).intensity} · ${{ yes: '들을 수 있음', unsure: '잘 모르겠음', no: '아직 불가능' }[checkOf(store.me.id, round).can_listen]}</p>`,
      `${btn('기다리지 않고 10분 더 쉬기', 'extend', 'soft')}`);
  }
  if (e.ok) return shell('go', say('🟢 대화를 시작할 수 있습니다.'), btn('대화 시작', 'to-talk'));
  const many = s.extensions >= 2;
  return shell('wait', `
    ${say('🟡 아직 해결하려고 하면 다시 올라갈 가능성이 있습니다.', '10분만 추가할까요?')}
    <p class="pair">${e.checks.map((c) => `${esc(nameOf(c.member_id))} ${c.intensity}`).join(' · ')}</p>
    ${many ? `<p class="say-sub">벌써 ${s.extensions}번 늘렸어요. 오늘은 대화 없이 마무리하고 내일 이어서 이야기해도 괜찮아요.</p>` : ''}`,
    `${btn('10분 추가', 'extend')}${btn('오늘은 대화 없이 마무리', 'to-agree', 'soft')}`);
}

// ------------------------------------------------------------------ 5) 중재 대화
const KIND_LABEL = { hard: '가장 힘들었던 일', three: '세 문장', question: '질문', answer: '답' };
const ACK_LABEL = { yes: '이해했어', part: '일부 이해했어', no: '잘 이해되지 않아' };

function talkView() {
  const s = S();
  const [A, B] = speakers(s, store.members, store.profiles);
  const ts = talkState(store.messages, A, B);
  if (ts.done) { if (s.phase === 'talk') act(() => store.setPhase('agree')); return ''; }
  const mine = ts.next.who === store.me.id;
  const thread = store.messages.filter((m) => m.kind !== 'quick');
  const bubbles = thread.map((m) => m.kind === 'ack'
    ? `<li class="ack ${m.from_member === store.me.id ? 'me' : ''}"><span>${esc(nameOf(m.from_member))}: ${ACK_LABEL[m.ack]}</span></li>`
    : `<li class="bub ${m.from_member === store.me.id ? 'me' : ''}"><small>${esc(nameOf(m.from_member))} · ${KIND_LABEL[m.kind]}</small><p>${esc(m.body).replace(/\n/g, '<br>')}</p></li>`).join('');
  let action;
  if (state.review) action = reviewPanel();
  else if (!mine) action = `<div class="waiting"><p><b>${esc(nim(ts.next.who))} 차례예요.</b></p><p>${ts.next.kind === 'ack' ? '내 말을 읽고 있어요.' : '쓰는 중이에요.'} 기다리는 동안 숨 한 번.</p></div>`;
  else action = turnForm(ts);
  return shell('go', `
    <div class="talk-head"><p class="eyebrow">한 명씩 말해요 · ${ts.count - ts.left}/${ts.count}</p></div>
    ${thread.length ? `<ul class="thread">${bubbles}</ul>` : `<p class="say-sub">${esc(nim(A.id))}부터 이야기해요. 상대를 평가하지 말고 자신의 경험만 적어 주세요.</p>`}
    <section class="turn">${action}</section>
    ${redLink()}`);
}

function turnForm(ts) {
  const k = ts.next.kind;
  const saved = [lastPriv('save'), lastPriv('vent')].filter(Boolean);
  if (k === 'hard') {
    return `<p class="t-q">무슨 일이 가장 힘들었어?</p><p class="t-h">상대를 평가하지 말고 자신의 경험만 적어 주세요.</p>
      ${ta('hard', '예: 계속 지적받는다고 느껴지면서 인정받지 못한다는 생각이 들어 많이 화가 났어')}
      ${saved.length ? `<details class="saved"><summary>진정할 때 적어 둔 말 보기</summary>${saved.map((p) => `<p>${esc(p.body)}</p>`).join('')}<p class="t-h">그대로 보내기보다 내 경험 위주로 다시 써 보세요.</p></details>` : ''}
      ${btn('보내기 전에 확인', 'send', 'primary', 'data-k="hard"')}`;
  }
  if (k === 'three') {
    return `<p class="t-q">세 문장만 완성해 주세요.</p>
      <label class="fill">나는 ${ta('t1', '예: 내 말을 끝까지 안 들어준다고 느꼈기', 2, 300)} 때문에 화났다.</label>
      <label class="fill">그때 사실 ${ta('t2', '예: 내가 중요하지 않은 사람', 2, 300)}이 두려웠다·속상했다.</label>
      <label class="fill">다음에는 ${ta('t3', '예: 말이 끝날 때까지 기다려', 2, 300)}해줬으면 좋겠다.</label>
      ${btn('보내기 전에 확인', 'send', 'primary', 'data-k="three"')}`;
  }
  if (k === 'ack') {
    const m = ts.about;
    return `<div class="about"><small>${esc(nameOf(m.from_member))} · ${KIND_LABEL[m.kind]}</small><p>${esc(m.body).replace(/\n/g, '<br>')}</p></div>
      <p class="t-q">반박하기 전에 하나만 골라 주세요.</p>
      <div class="opts">${Object.entries(ACK_LABEL).map(([v, l]) => `<button class="opt" data-a="ack" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="t-h">"잘 이해되지 않아"를 눌러도 싸움이 되지 않아요. 질문을 하나 할 수 있어요.</p>`;
  }
  if (k === 'question') {
    return `<p class="t-q">어떤 부분이 이해가 안 됐는지, 질문 하나만 적어 주세요.</p>
      ${ta('question', '예: 내가 어떤 말을 했을 때 그렇게 느꼈는지 알려줄 수 있어?', 3, 500)}
      ${btn('보내기 전에 확인', 'send', 'primary', 'data-k="question"')}`;
  }
  if (k === 'answer') {
    return `<div class="about"><small>${esc(nameOf(ts.about.from_member))} · 질문</small><p>${esc(ts.about.body)}</p></div>
      <p class="t-q">질문에만 답해 주세요.</p>${ta('answer', '내가 느낀 것 위주로', 3, 1000)}
      ${btn('보내기 전에 확인', 'send', 'primary', 'data-k="answer"')}`;
  }
  return '';
}

function composeOf(k) {
  if (k === 'three') {
    const [a, b, c] = ['t1', 't2', 't3'].map((x) => (state.drafts[x] ?? '').trim());
    if (!a || !b || !c) return null;
    return `나는 ${a} 때문에 화났다.\n그때 사실 ${b}이 두려웠다·속상했다.\n다음에는 ${c}해줬으면 좋겠다.`;
  }
  return (state.drafts[k] ?? '').trim() || null;
}

// 보내기 전 확인: 평가·욕설·결정을 걸러 주고 나 전달법으로 바꿔 보기
function reviewPanel() {
  const { text, r, k } = state.review;
  const emo = lastPriv('emotion')?.body;
  const rw = state.drafts.rw ?? {};
  const preview = iMessage({ situation: rw.s, emotion: rw.e ?? (emo && emo !== '모르겠음' ? emo : ''), need: rw.n });
  let shown = esc(text);
  for (const w of [...new Set(r.words)].filter(Boolean)) shown = shown.split(esc(w)).join(`<mark>${esc(w)}</mark>`);
  return `<div class="review ${r.level}">
    <p class="rv-title">${r.level === 'block' ? '⚠️ 이대로는 보낼 수 없어요' : r.level === 'soft' ? '⚠️ 상대방에 대한 평가가 포함되어 있어요' : '보내기 전에 잠깐'}</p>
    <p class="rv-text">${shown.replace(/\n/g, '<br>')}</p>
    ${r.reasons.length ? `<ul class="rv-why">${[...new Set(r.reasons)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.danger ? dangerBox() : ''}
    <p class="t-q">이렇게 바꿔 볼까요?</p>
    <label class="fill">어떤 상황에서 <input data-rw="s" value="${esc(rw.s ?? '')}" placeholder="예: 계속 부족한 점을 지적받는다고 느껴질 때"></label>
    <div class="fill">나는 <div class="chips sm">${EMOTIONS.filter((e) => e !== '모르겠음').map((e) => `<button data-a="rw-emo" data-v="${e}" aria-pressed="${(rw.e ?? emo) === e}">${e}</button>`).join('')}</div>을/를 느꼈어.</div>
    <label class="fill">나는 <input data-rw="n" value="${esc(rw.n ?? '')}" placeholder="예: 잘한 것도 한 번씩 말해줬으면 좋겠어"></label>
    ${preview ? `<p class="rv-new">${esc(preview)}</p>` : ''}
    <div class="rv-acts">
      ${preview && rw.s && rw.n ? btn('이렇게 바꿔서 보내기', 'rw-send') : ''}
      ${btn('다시 쓰기', 'rw-cancel', 'soft')}
      ${r.level !== 'block' ? `<button class="link" data-a="rw-anyway">${armed('anyway', '그래도 이대로 보내기', '한 번 더 누르면 그대로 보내요')}</button>` : ''}
    </div>
  </div>`;
}

async function sendTalk(k, text) {
  const kind = k === 'question' ? 'question' : k === 'answer' ? 'answer' : k;
  await store.send({ kind, body: text });
  for (const x of ['hard', 't1', 't2', 't3', 'question', 'answer', 'rw']) delete state.drafts[x];
  state.review = null;
  store.notify('turn');
  toast(`${nim(store.partner?.id)}에게 전했어요`);
}

// ------------------------------------------------------------------ 6) 약속 · 마무리
function agreeView() {
  const s = S();
  const myC = store.commitments.find((c) => c.session_id === s.id && c.member_id === store.me.id);
  const myClose = store.closings.find((c) => c.session_id === s.id && c.member_id === store.me.id);
  const pC = store.commitments.find((c) => c.session_id === s.id && c.member_id === store.partner?.id);
  if (!myC) {
    const vague = /다시는|절대|안\s*그럴|노력|조심|잘\s*할|신경\s*쓸/.test(state.drafts.next ?? '');
    return shell('go', `
      ${say('사과와 해결책은 마지막에, 따로.')}
      <label class="field"><span>① 내가 잘못한 행동 <small>화난 것 자체가 아니라, 어떤 행동이었는지</small></span>
        ${ta('wrong', st0('wrong'), 2, 300)}</label>
      <label class="field"><span>② 다음 싸움에서 내가 할 행동 <small>지켰는지 확인할 수 있게</small></span>
        ${ta('next', st0('next'), 2, 300)}</label>
      ${vague ? '<p class="hint-w">"노력할게" 대신 <b>언제, 무엇을</b> 할지 적어 주세요. 예: 분노 6이 되면 PAUSE 누르기</p>' : ''}`,
      btn('약속 저장', 'commit', 'primary', (state.drafts.next ?? '').trim() ? '' : 'disabled'));
  }
  if (!myClose) {
    const tg = new Set(state.drafts.trig ?? []);
    const br = new Set(state.drafts.broke ?? []);
    const agreed = store.rules.filter((r) => r.agreed.length >= store.members.length);
    return shell('go', `
      ${say('오늘 기록')}
      <div class="field"><span>주요 계기 <small>여러 개 골라도 돼요</small></span>
        <div class="chips">${TRIGGERS.map((t) => `<button data-a="trig" data-v="${t}" aria-pressed="${tg.has(t)}">${t}</button>`).join('')}</div></div>
      <div class="field"><span>이번에 내가 넘은 금지 행동 <small>내 행동만 · 솔직하게</small></span>
        <div class="chips">${agreed.map((r) => `<button data-a="broke" data-v="${esc(r.text)}" aria-pressed="${br.has(r.text)}">${esc(r.text)}</button>`).join('')}
          <button data-a="broke-none" aria-pressed="${state.drafts.brokeNone === true}">없음</button></div></div>`,
      btn('저장', 'closing', 'primary', state.drafts.brokeNone || br.size ? '' : 'disabled'));
  }
  const voted = s.end_votes.includes(store.me.id);
  return shell('go', `
    ${say('🤝 오늘 싸움 종료')}
    <div class="promise"><p class="p-who">내 약속</p><p>${esc(myC.next_action)}</p></div>
    ${pC ? `<div class="promise"><p class="p-who">${esc(nim(pC.member_id))}의 약속</p><p>${esc(pC.next_action)}</p></div>` : `<p class="say-sub">${esc(nim(store.partner?.id))}은 아직 약속을 적는 중이에요.</p>`}
    ${voted ? `<p class="say-sub">${esc(nim(store.partner?.id))}이 누르면 끝나요.</p>` : ''}`,
    voted ? '' : btn('🤝 오늘 싸움 종료', 'end'));
}
const st0 = (k) => (styleOf(store.me.id) === 'heat'
  ? { wrong: '예: 화난 것 자체가 아니라 혐오스럽다고 말한 것', next: '예: 분노 6이 되면 PAUSE 누르기' }
  : { wrong: '예: 멈추고 싶다고 했는데 계속 답을 요구한 것', next: '예: PAUSE 후 15분 동안 추가 질문하지 않기' })[k];

// ------------------------------------------------------------------ RED MODE
function redView() {
  const s = S();
  const mine = s.red_by === store.me.id;
  const items = myPriv('items').flatMap((p) => p.items);
  const dieMe = items.includes(RED_ITEMS.find((x) => x.key === 'die').label) || store.privates.some((p) => review(p.body).danger);
  const p = myProfile();
  const contacts = (p?.safety_contacts ?? []).filter((c) => c.phone);
  const line = (h, strong = false) => `<a class="call ${strong ? 'strong' : ''}" href="tel:${h.num}"><b>${h.num}</b><span>${h.label}${h.sub ? `<small>${h.sub}</small>` : ''}</span></a>`;
  return shell('red', `
    ${say('🔴 지금은 관계를 해결할 단계가 아닙니다.', '서로의 안전을 확보하세요. 지금은 대면 논쟁을 계속하지 않습니다.')}
    ${mine ? '' : `<p class="red-note">${esc(nim(s.red_by))}이 지금은 안전이 먼저라고 알렸어요. 답을 받아내려 하지 않아도 돼요. 거리를 두세요.</p>`}
    <ol class="safety">
      <li><b>같은 공간에서 떨어지기</b>${p?.safety_place ? `<span>미리 정한 곳: ${esc(p.safety_place)}</span>` : '<span>다른 방이나 밖으로 잠시 나가요. 운전은 하지 않아요.</span>'}</li>
      ${contacts.length ? `<li><b>미리 정한 사람에게 연락</b>${contacts.map((c) => `<a class="call" href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}"><b>${esc(c.name)}</b><span>${esc(c.phone)}</span></a>`).join('')}</li>` : ''}
      ${p?.safety_note ? `<li><b>내 안전계획</b><span>${esc(p.safety_note)}</span></li>` : ''}
      <li><b>도움 받기</b>
        ${mine && dieMe ? line(HELP_LINES.suicide, true) : ''}
        ${line(HELP_LINES.emergency, !mine)}
        ${mine && dieMe ? '' : line(mine ? HELP_LINES.suicide : { ...HELP_LINES.suicide, sub: '' })}
        ${line(HELP_LINES.ambulance)}
        ${mine ? '' : line(HELP_LINES.women)}
      </li>
    </ol>
    <p class="say-sub">이야기는 둘 다 안전해진 뒤, 내일 이후에 해도 늦지 않아요.</p>`,
    `<button class="btn soft" data-a="red-close">${armed('redclose', '안전해졌어요 · 오늘은 여기서 멈추기', '한 번 더 누르면 오늘 PAUSE를 닫아요')}</button>`);
}

// ------------------------------------------------------------------ 기록 카드
function recordCard(s, { big = false } = {}) {
  const sm = summarize(s, store.checks, store.closings, store.members, store.rules);
  const names = store.members.map((m) => m.name);
  const roundName = (r) => (r === 0 ? '시작 감정' : r === 1 ? '15분 후' : `추가 ${(r - 1) * 10}분 후`);
  return `<article class="record ${big ? 'big' : ''}">
    <p class="r-date">${dateLabel(s.started_at)} <small>${hhmm(s.started_at)}</small></p>
    <dl>
      ${sm.rounds.map((r) => `<dt>${roundName(r.round)}</dt><dd>${r.vals.map((v, i) => `${esc(names[i])} ${v ?? '–'}`).join(' / ')}</dd>`).join('')}
      ${sm.triggers.length ? `<dt>주요 계기</dt><dd>${esc(sm.triggers.join(', '))}</dd>` : ''}
      <dt>폭언</dt><dd>${sm.verbal.length ? esc(sm.verbal.map((b) => `${b.rule}(${nameOf(b.who)})`).join(', ')) : '없음'}</dd>
      <dt>물건 파손</dt><dd>${sm.physical.length ? esc(sm.physical.map((b) => `${b.rule}(${nameOf(b.who)})`).join(', ')) : '없음'}</dd>
      <dt>PAUSE</dt><dd>${sm.red ? '🔴 안전 우선으로 멈춤' : sm.success ? `성공 ✓${sm.talked ? '' : ' · 대화 없이 마무리'}` : '진행 중'}</dd>
      ${sm.minutes ? `<dt>회복 시간</dt><dd>${sm.minutes}분</dd>` : ''}
    </dl>
  </article>`;
}

function summaryView(id) {
  const s = store.sessions.find((x) => x.id === id);
  return shell(s?.red_at ? 'red' : 'go', `${say(s?.red_at ? '오늘은 여기서 멈췄어요.' : '🤝 오늘 싸움 종료')}${s ? recordCard(s, { big: true }) : ''}
    <p class="say-sub">${s?.red_at ? '안전이 먼저였어요. 잘 멈췄어요.' : '기록이 쌓이면 "우리 좋아지고 있나?"를 느낌이 아니라 숫자로 볼 수 있어요.'}</p>`,
  btn('홈으로', 'summary-ok'));
}

// ------------------------------------------------------------------ 탭: 홈 · 기록 · 우리 규칙 · 설정
function homeView() {
  const p = myProfile();
  const mineC = store.commitments.filter((c) => c.member_id === store.me.id && c.active).slice(0, 3);
  const last = store.sessions.find((s) => s.closed_at);
  return `
  <header class="home-top"><h1 class="logo">PAUSE</h1><p>싸움이 위험해질 때, 누구든 눌러요.</p></header>
  <button class="alarm" data-a="pause">
    <span class="a-icon" aria-hidden="true">🚨</span>
    <span class="a-t">${state.armed === 'pause' ? `한 번 더 누르면 ${esc(nim(store.partner?.id))}에게 PAUSE가 가요` : '지금 싸움이 위험해지고 있어'}</span>
    <span class="a-s">${state.armed === 'pause' ? '' : `누르면 ${esc(nim(store.partner?.id))} 폰에도 떠요`}</span>
  </button>
  ${p?.signals?.length ? `<section class="card"><h2>이런 신호가 보이면 누르기</h2><p class="sig">${p.signals.map((x) => `<span>${esc(x)}</span>`).join('')}</p></section>` : ''}
  ${mineC.length ? `<section class="card"><h2>내 약속</h2><ul class="plain">${mineC.map((c) => `<li>${esc(c.next_action)}</li>`).join('')}</ul></section>` : ''}
  ${last ? `<section><h2 class="sec">지난 PAUSE</h2>${recordCard(last)}</section>` : ''}`;
}

function recordsView() {
  const done = store.sessions.filter((s) => s.closed_at);
  if (!done.length) return `<header class="page-top"><h1>기록</h1></header><p class="empty">아직 기록이 없어요. PAUSE를 한 번 끝까지 하면 여기에 쌓여요.</p>`;
  const sums = done.map((s) => ({ s, sm: summarize(s, store.checks, store.closings, store.members, store.rules) }));
  const mins = sums.filter((x) => x.sm.minutes && !x.sm.red);
  const avg = (a) => (a.length ? Math.round(a.reduce((p, x) => p + x.sm.minutes, 0) / a.length) : null);
  const recent = avg(mins.slice(0, 3)), before = avg(mins.slice(3, 6));
  let streak = 0;
  for (const x of sums) { if (x.sm.verbal.length || x.sm.physical.length || x.sm.red) break; streak++; }
  const maxM = Math.max(...mins.map((x) => x.sm.minutes), 1);
  return `
  <header class="page-top"><h1>기록</h1><p>${done.length}번 멈췄어요</p></header>
  <section class="stats">
    <div><b>${recent ?? '–'}<small>분</small></b><span>최근 3번 평균 회복</span>${recent && before ? `<em class="${recent <= before ? 'good' : ''}">이전 3번 ${before}분</em>` : ''}</div>
    <div><b>${streak}<small>번</small></b><span>연속, 폭언·파손 없이</span></div>
  </section>
  ${mins.length > 1 ? `<section class="card"><h2>회복 시간 <small>최근 순</small></h2><ul class="bars">${mins.slice(0, 10).map((x) => `<li><span>${dateLabel(x.s.started_at).replace(/ [일월화수목금토]$/, '')}</span><i style="--w:${(x.sm.minutes / maxM) * 100}%"></i><b>${x.sm.minutes}분</b></li>`).join('')}</ul></section>` : ''}
  <section>${done.map((s) => recordCard(s)).join('')}</section>`;
}

function rulesView() {
  const n = store.members.length;
  const p = myProfile() ?? { style: 'heat', signals: [] };
  const sig = new Set(p.signals);
  const examples = [...new Set([...SIGNAL_EXAMPLES[p.style], ...p.signals])];
  const partnerP = store.profiles[store.partner?.id];
  const acts = store.commitments.filter((c) => c.active);
  return `
  <header class="page-top"><h1>우리 규칙</h1><p>싸우는 순간 규칙을 협상하지 않아요. 평온할 때 정해 둬요.</p></header>
  <section class="card">
    <h2>절대 금지 행동 <small>둘 다 동의하면 합의됨</small></h2>
    <ul class="rules">${store.rules.map((r) => {
      const ok = r.agreed.length >= n;
      const me = r.agreed.includes(store.me.id);
      return `<li class="${ok ? 'ok' : ''}"><span class="r-t">${esc(r.text)}</span>
        <span class="r-who">${store.members.map((m) => `<i class="${r.agreed.includes(m.id) ? 'on' : ''}">${esc(m.name)}</i>`).join('')}</span>
        <button class="r-me" data-a="agree" data-v="${r.id}" aria-pressed="${me}">${me ? '동의함' : '동의'}</button>
        <button class="r-del" data-a="rule-del" data-v="${r.id}" aria-label="삭제">${state.armed === `del-${r.id}` ? '삭제?' : '×'}</button></li>`;
    }).join('')}</ul>
    <div class="addrow"><input data-draft="rule" id="d-rule" maxlength="60" placeholder="금지 행동 추가" value="${draft('rule')}"><button class="btn small" data-a="rule-add">추가</button></div>
  </section>
  <section class="card">
    <h2>우리의 약속 <small>다음 싸움에서 할 행동</small></h2>
    ${acts.length ? `<ul class="promises">${acts.map((c) => `<li><span class="who">${esc(nameOf(c.member_id))}</span><span>${esc(c.next_action)}${c.wrong ? `<small>지난번: ${esc(c.wrong)}</small>` : ''}</span>
      ${c.member_id === store.me.id ? `<button class="link" data-a="c-off" data-v="${c.id}">내리기</button>` : ''}</li>`).join('')}</ul>` : '<p class="hint">PAUSE를 끝까지 하면 여기에 쌓여요.</p>'}
  </section>
  <section class="card">
    <h2>나는 어떤 편이야?</h2>
    <div class="seg">${Object.values(STYLES).map((x) => `<button data-a="style" data-v="${x.key}" aria-pressed="${p.style === x.key}">${x.label}</button>`).join('')}</div>
    <p class="hint">${STYLES[p.style].sub}. 체크 항목과 진정 시간 안내가 달라져요.</p>
    <h2 class="mt">내가 폭발하기 시작할 때 신호</h2>
    <div class="chips">${examples.map((x) => `<button data-a="sig" data-v="${esc(x)}" aria-pressed="${sig.has(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="addrow"><input data-draft="sig" id="d-sig" maxlength="40" placeholder="내 신호 직접 추가" value="${draft('sig')}"><button class="btn small" data-a="sig-add">추가</button></div>
    ${partnerP?.signals?.length ? `<h2 class="mt">${esc(nim(store.partner.id))}의 신호</h2><p class="sig">${partnerP.signals.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''}
  </section>`;
}

function settingsView() {
  const p = myProfile() ?? {};
  const cs = [...(p.safety_contacts ?? [])];
  while (cs.length < 2) cs.push({ name: '', phone: '' });
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let push;
  if (store.demo) push = '<p class="hint">데모에서는 알림이 오지 않아요.</p>';
  else if (isIOS() && !isStandalone()) push = '<p class="hint">알림을 받으려면 Safari 공유 버튼 → <b>홈 화면에 추가</b> 후, 홈 화면의 PAUSE로 열어 주세요.</p>';
  else if (!('PushManager' in window)) push = '<p class="hint">이 브라우저는 알림을 지원하지 않아요. iOS 16.4 이상이 필요해요.</p>';
  else push = `<p class="hint">${perm === 'granted' ? '알림 켜져 있어요. 상대가 PAUSE를 누르면 바로 알려 줘요.' : perm === 'denied' ? '알림이 꺼져 있어요. 아이폰 설정 › 알림 › PAUSE에서 켜 주세요.' : '꼭 켜 두세요. 상대가 PAUSE를 누르면 알려 줘요.'}</p>
    <div class="row2">${perm !== 'denied' ? `<button class="btn small" data-a="push">${perm === 'granted' ? '이 기기 다시 등록' : '알림 켜기'}</button>` : ''}${perm === 'granted' ? '<button class="btn small soft" data-a="test-push">알림으로 받아보기</button>' : ''}</div>`;
  return `
  <header class="page-top"><h1>설정</h1></header>
  <section class="card">
    <h2>내 안전계획 <small>RED 화면에 나와요 · ${esc(nim(store.partner?.id))}도 볼 수 있어요</small></h2>
    <p class="hint">통제가 어려울 때 연락할 사람</p>
    ${cs.map((c, i) => `<div class="contact"><input data-c="${i}" data-f="name" value="${esc(c.name)}" placeholder="이름 (예: 형)" maxlength="20"><input data-c="${i}" data-f="phone" value="${esc(c.phone)}" placeholder="전화번호" inputmode="tel" maxlength="20"></div>`).join('')}
    <label class="field"><span>떨어져 있을 곳</span><input data-sp="safety_place" value="${esc(p.safety_place ?? '')}" maxlength="200" placeholder="예: 아파트 앞 공원 벤치"></label>
    <label class="field"><span>메모</span><textarea data-sp="safety_note" rows="2" maxlength="500" placeholder="예: 차 키는 현관 서랍에 두고 나가기">${esc(p.safety_note ?? '')}</textarea></label>
    <button class="btn small" data-a="safety-save">저장</button>
  </section>
  <section class="card"><h2>알림</h2>${push}</section>
  <section class="card"><h2>이 앱이 하는 것과 못 하는 것</h2>
    <p class="hint">말 거르기는 정해진 표현(욕설, "맨날·항상", "넌 왜…", 헤어지자 같은 결정)을 찾아 알려 주는 규칙이에요. 사람처럼 마음을 읽지는 못해요. 위험한 상황에서는 대화보다 안전이 먼저예요.</p></section>
  ${store.demo ? `<section class="card"><h2>데모</h2><p class="hint">이 기기에만 저장돼요. 탭을 하나 더 열고 한쪽을 ${esc(store.partner.name)}로 바꾸면 두 사람처럼 주고받을 수 있어요.</p>
     <div class="row2"><button class="btn small soft" data-a="demo-switch">${esc(store.partner.name)}로 보기</button><button class="btn small soft" data-a="demo-reset">예시 데이터로 초기화</button></div></section>`
    : '<section class="card"><button class="btn small soft" data-a="logout">로그아웃</button></section>'}`;
}

// ------------------------------------------------------------------ 처음 설정
function onboardingView(step) {
  const p = myProfile() ?? { style: 'heat', signals: [] };
  if (step === 0) return shell('calm', `<h1 class="logo big">PAUSE</h1>
    ${say('싸운 뒤 기록하는 앱이 아니라,<br>위험해지는 순간 켜는 앱이에요.', '폭발 → 진정 → 대화 → 회복까지 데려가요.<br>평온할 때 딱 한 번, 둘이 미리 정해 둬요.')}`, btn('시작', 'ob', 'primary', 'data-v="1"'));
  if (step === 1) return shell('calm', `${say('나는 싸울 때 어떤 편이야?')}
    <div class="opts">${Object.values(STYLES).map((x) => `<button class="opt big" data-a="ob-style" data-v="${x.key}" aria-pressed="${p.style === x.key}"><b>${x.label}</b><small>${x.sub}</small></button>`).join('')}</div>`,
    btn('다음', 'ob', 'primary', 'data-v="2"'));
  if (step === 2) {
    const sig = new Set(p.signals);
    const ex = [...new Set([...SIGNAL_EXAMPLES[p.style], ...p.signals])];
    return shell('calm', `${say('내가 폭발하기 시작할 때<br>나타나는 신호는?', '여러 개 골라도 돼요. 이 신호가 보이면 누르는 거예요.')}
      <div class="chips big">${ex.map((x) => `<button data-a="sig" data-v="${esc(x)}" aria-pressed="${sig.has(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="addrow"><input data-draft="sig" id="d-sig" maxlength="40" placeholder="직접 추가" value="${draft('sig')}"><button class="btn small" data-a="sig-add">추가</button></div>`,
      btn('다음', 'ob', 'primary', `data-v="3" ${sig.size ? '' : 'disabled'}`));
  }
  if (step === 3) return shell('calm', `${say('절대 금지 행동', '둘 다 동의해야 합의돼요. 싸우는 순간에는 협상하지 않아요.')}
    <ul class="rules ob">${store.rules.map((r) => { const me = r.agreed.includes(store.me.id); return `<li><span class="r-t">${esc(r.text)}</span><button class="r-me" data-a="agree" data-v="${r.id}" aria-pressed="${me}">${me ? '동의함' : '동의'}</button></li>`; }).join('')}</ul>`,
    btn('다음', 'ob', 'primary', 'data-v="4"'));
  return shell('calm', `${say('준비됐어요.', '안전계획(연락할 사람, 떨어져 있을 곳)은 설정에서 적어 둘 수 있어요.<br>알림도 꼭 켜 두세요.')}`, btn('홈으로', 'ob', 'primary', 'data-v="done"'));
}

// ------------------------------------------------------------------ 렌더
function sessionView() {
  const s = S();
  if (s.phase === 'red') return redView();
  if (!checkOf(store.me.id, 0)) return ui().intro ? checkView() : introView();
  if (s.phase === 'cool') {
    if (Date.now() < Date.parse(s.cool_until)) return coolView();
    const round = s.extensions + 1;
    return checkOf(store.me.id, round) ? evalView(round) : recheckView(round);
  }
  if (s.phase === 'talk') return talkView() || agreeView();
  if (s.phase === 'agree') return agreeView();
  return '';
}

function render() {
  if (!store.me) return;
  // 입력 중이던 칸과 커서 위치를 지킴 (상대 쪽 변화로 다시 그려도)
  const f = document.activeElement;
  const keep = f && f.id && $app.contains(f) ? { id: f.id, s: f.selectionStart, e: f.selectionEnd } : null;
  const scrollY = window.scrollY;
  if (store.open) state.activeId = store.open.id;
  else if (state.activeId) { state.summaryId = state.activeId; state.activeId = null; }

  let html;
  const full = state.ob != null || store.open || state.summaryId;
  document.documentElement.classList.toggle('full', Boolean(full));
  if (state.ob != null) html = onboardingView(state.ob);
  else if (store.open) html = sessionView();
  else if (state.summaryId) html = summaryView(state.summaryId);
  else {
    const tabs = [['home', '홈'], ['records', '기록'], ['rules', '우리 규칙'], ['settings', '설정']];
    const v = { home: homeView, records: recordsView, rules: rulesView, settings: settingsView }[state.tab]();
    html = `${store.demo ? demoBar() : ''}<div class="screen">${v}</div>
      <nav class="tabbar">${tabs.map(([k, l]) => `<button data-a="tab" data-v="${k}" aria-current="${state.tab === k ? 'page' : 'false'}">${l}</button>`).join('')}</nav>`;
  }
  if (!html) return;
  $app.innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch {} window.scrollTo(0, scrollY); }
  }
}

// 1초마다 타이머 숫자만 갱신, 0이 되면 다시 그림
setInterval(() => {
  const s = store.open;
  const el = document.querySelector('[data-timer]');
  if (!s || !el) return;
  const left = Date.parse(s.cool_until) - Date.now();
  el.textContent = mmss(left);
  if (left <= 0) render();
}, 1000);

// ------------------------------------------------------------------ 입력
$app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.draft) { state.drafts[t.dataset.draft] = t.value; if (['next'].includes(t.dataset.draft)) softRender(t); }
  if (t.dataset.rw) { state.drafts.rw = { ...(state.drafts.rw ?? {}), [t.dataset.rw]: t.value }; softRender(t); }
  if (t.dataset.intensity != null) { state.drafts.intensity = Number(t.value); const n = $app.querySelector('.intensity .num'); if (n) n.textContent = t.value; t.classList.remove('unset'); $app.querySelector('[data-a="check-done"]')?.removeAttribute('disabled'); }
});
// 입력하면서 미리보기만 바뀌는 곳: 살짝 늦게 다시 그림
function softRender() { clearTimeout(softRender.t); softRender.t = setTimeout(render, 350); }
$app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.item != null) {
    let items = new Set(state.drafts.items ?? []);
    const v = t.dataset.item;
    if (t.checked) { if (v === NONE_ITEM) items = new Set([NONE_ITEM]); else { items.delete(NONE_ITEM); items.add(v); } } else items.delete(v);
    state.drafts.items = [...items];
    render();
  }
});

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const v = el.dataset.v;
  const a = el.dataset.a;
  const s = S();
  switch (a) {
    // 탭 · 데모
    case 'tab': state.tab = v; state.armed = null; render(); window.scrollTo(0, 0); return;
    case 'demo-switch': store.switchMe(); state.drafts = {}; state.review = null; state.ob = myProfile() ? null : 0; render(); toast(`${store.me.name}로 보는 중`); return;
    case 'demo-reset': store.reset(); state.drafts = {}; render(); toast('초기화했어요'); return;
    case 'demo-skip': return act(() => store.skipTimer());

    // 시작
    case 'pause':
      if (!arm('pause')) return;
      return act(async () => {
        const r = await store.startPause();
        state.drafts = {};
        if (r.created) store.notify('start');
        else toast(`${nim(store.partner?.id)}이 이미 PAUSE를 눌렀어요`);
        setUi({ intro: !r.created ? false : true });
      });
    case 'intro-ok': setUi({ intro: true }); render(); return;
    case 'check-done': {
      const items = state.drafts.items ?? [];
      const red = items.some((x) => RED_ITEMS.some((r) => r.label === x));
      const intensity = state.drafts.intensity;
      if (intensity == null) return;
      return act(async () => {
        if (items.length) await store.addPrivate({ kind: 'items', items });
        await store.addCheck({ round: 0, intensity, red });
        if (red) { await store.setPhase('red'); store.notify('red'); }
        delete state.drafts.items; delete state.drafts.intensity;
      });
    }

    // 진정
    case 'cool-next': setUi({ step: (ui().step ?? 0) + 1 }); render(); return;
    case 'cool-back': setUi({ step: Number(v) }); render(); return;
    case 'explain': setUi({ explain: v }); render(); return;
    case 'emotion': return act(async () => { await store.addPrivate({ kind: 'emotion', body: v }); setUi({ step: (ui().step ?? 0) + 1 }); });
    case 'vent-done': case 'save-done': {
      const kind = a === 'vent-done' ? 'vent' : 'save';
      const text = (state.drafts[kind] ?? '').trim();
      if (!text) { setUi({ step: (ui().step ?? 0) + 2 }); render(); return; }   // 안 쓰면 넘어감
      return act(async () => { await store.addPrivate({ kind, body: text }); delete state.drafts[kind]; setUi({ step: (ui().step ?? 0) + 1 }); });
    }
    case 'quick':
      if (el.hasAttribute('data-sent')) return;
      return act(async () => { await store.send({ kind: 'quick', body: v }); store.notify('quick', { text: v }); toast('보냈어요'); });
    case 'go-red': if (!arm('red')) return;
    // fallthrough
    case 'go-red-now': return act(async () => { await store.setPhase('red'); state.review = null; store.notify('red'); });

    // 재측정
    case 're-int': state.drafts[`r${s.extensions + 1}`] = Number(v); render(); return;
    case 're-listen': state.drafts[`l${s.extensions + 1}`] = v; render(); return;
    case 're-done': {
      const round = s.extensions + 1;
      return act(() => store.addCheck({ round, intensity: state.drafts[`r${round}`], can_listen: state.drafts[`l${round}`] }));
    }
    case 'extend': return act(() => store.extend());
    case 'to-talk': return act(async () => { if (s.phase === 'cool') { await store.setPhase('talk'); store.notify('talk'); } });
    case 'to-agree': return act(() => store.setPhase('agree'));

    // 대화
    case 'send': {
      const k = el.dataset.k;
      const text = composeOf(k);
      if (!text) { toast(k === 'three' ? '세 칸을 모두 채워 주세요' : '먼저 적어 주세요'); return; }
      const r = review(text);
      if (r.level === 'ok' && !r.danger) return act(() => sendTalk(k, text));
      state.review = { k, text, r }; render(); return;
    }
    case 'rw-emo': state.drafts.rw = { ...(state.drafts.rw ?? {}), e: v }; render(); return;
    case 'rw-cancel': state.review = null; render(); return;
    case 'rw-send': {
      const rw = state.drafts.rw ?? {};
      const emo = lastPriv('emotion')?.body;
      const text = iMessage({ situation: rw.s, emotion: rw.e ?? (emo !== '모르겠음' ? emo : ''), need: rw.n });
      const r = review(text);
      if (r.level !== 'ok') { state.review = { ...state.review, text, r }; render(); toast('바꾼 문장에도 걸리는 표현이 있어요'); return; }
      return act(() => sendTalk(state.review.k, text));
    }
    case 'rw-anyway': if (!arm('anyway')) return; return act(() => sendTalk(state.review.k, state.review.text));
    case 'ack': return act(async () => { await store.send({ kind: 'ack', ack: v }); store.notify('turn'); });

    // 약속 · 마무리
    case 'commit': return act(async () => {
      await store.addCommitment({ wrong: (state.drafts.wrong ?? '').trim() || null, next_action: state.drafts.next.trim() });
      delete state.drafts.wrong; delete state.drafts.next;
    });
    case 'trig': { const t = new Set(state.drafts.trig ?? []); t.has(v) ? t.delete(v) : t.add(v); state.drafts.trig = [...t]; render(); return; }
    case 'broke': { const t = new Set(state.drafts.broke ?? []); t.has(v) ? t.delete(v) : t.add(v); state.drafts.broke = [...t]; state.drafts.brokeNone = false; render(); return; }
    case 'broke-none': state.drafts.broke = []; state.drafts.brokeNone = !state.drafts.brokeNone; render(); return;
    case 'closing': return act(async () => {
      await store.saveClosing({ triggers: state.drafts.trig ?? [], broke: state.drafts.broke ?? [] });
      delete state.drafts.trig; delete state.drafts.broke; delete state.drafts.brokeNone;
    });
    case 'end': return act(async () => { await store.voteEnd(); if (store.open) store.notify('end'); });
    case 'red-close': if (!arm('redclose')) return; return act(() => store.closeNow());
    case 'summary-ok': state.summaryId = null; state.tab = 'home'; render(); return;

    // 우리 규칙
    case 'agree': { const r = store.rules.find((x) => x.id === v); return act(() => store.agreeRule(v, !r.agreed.includes(store.me.id))); }
    case 'rule-del': if (!arm(`del-${v}`)) return; return act(() => store.deleteRule(v));
    case 'rule-add': { const t = (state.drafts.rule ?? '').trim(); if (!t) return; delete state.drafts.rule; return act(() => store.addRule(t.slice(0, 60))); }
    case 'c-off': return act(() => store.updateCommitment(v, { active: false }));
    case 'style': case 'ob-style': return act(() => store.saveProfile({ style: v }));
    case 'sig': { const p = myProfile() ?? { signals: [] }; const set = new Set(p.signals); set.has(v) ? set.delete(v) : set.add(v); return act(() => store.saveProfile({ signals: [...set] })); }
    case 'sig-add': { const t = (state.drafts.sig ?? '').trim(); if (!t) return; delete state.drafts.sig; const p = myProfile() ?? { signals: [] }; return act(() => store.saveProfile({ signals: [...new Set([...p.signals, t.slice(0, 40)])] })); }
    case 'ob':
      if (v === 'done') { state.ob = null; render(); return; }
      if (v === '1' && !myProfile()) await store.saveProfile({ style: 'heat', signals: [] }).catch(() => {});
      state.ob = Number(v); render(); window.scrollTo(0, 0); return;

    // 설정
    case 'safety-save': {
      const contacts = [...$app.querySelectorAll('.contact')].map((row) => ({ name: row.querySelector('[data-f=name]').value.trim(), phone: row.querySelector('[data-f=phone]').value.trim() }))
        .filter((c) => c.name || c.phone);
      const patch = { safety_contacts: contacts };
      $app.querySelectorAll('[data-sp]').forEach((x) => { patch[x.dataset.sp] = x.value.trim() || null; });
      return act(async () => { await store.saveProfile(patch); toast('저장했어요'); });
    }
    case 'push': return act(enablePush);
    case 'test-push': return act(async () => { const r = await store.callFn({ action: 'pause-test' }); toast(r?.sent ? '알림 보냈어요' : '등록된 기기가 없어요. 알림을 다시 켜 주세요'); });
    case 'logout': await store.signOut(); location.reload(); return;
  }
});

// ------------------------------------------------------------------ 알림
function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('알림이 허용되지 않았어요'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await store.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  toast('알림 켰어요');
}

// ------------------------------------------------------------------ 로그인 · 시작
function loginView(msg = '') {
  document.documentElement.classList.add('full');
  $app.innerHTML = `
  <div class="stage" data-tone="calm"><main class="stage-body login">
    <h1 class="logo big">PAUSE</h1>
    <p class="say-sub">싸움이 위험해질 때 켜는 앱</p>
    <form id="login">
      <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label>
      ${msg ? `<p class="error">${esc(msg)}</p>` : ''}
      <button class="btn primary" type="submit">로그인</button>
      <p class="hint">우리할일과 같은 계정이에요.</p>
    </form>
  </main></div>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    e.target.querySelector('button').disabled = true;
    try { await store.signIn(f.email.value.trim(), f.password.value); ready(); } catch (err) { loginView(err.message); }
  });
}
function ready() {
  if (!myProfile()) state.ob = 0;
  if (store.open) state.activeId = store.open.id;
  render();
}

(async function start() {
  if ('serviceWorker' in navigator && !store.demo) navigator.serviceWorker.register('sw.js').catch(() => {});
  store.onChange = () => render();
  try {
    const { needLogin } = await store.init();
    if (needLogin) loginView(); else ready();
  } catch (e) { loginView(e.message); }
})();
