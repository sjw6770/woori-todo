// 하루 감정 기록: 감정 목록, 이모지, 그래프 그리기
import { addDays, dow } from './schedule.js';

// 좋은 감정 3 + 힘든 감정 3. 색은 순서대로 고정 (그래프 색이 감정을 따라감, 켜고 꺼도 안 바뀜)
// 키를 바꾸려면 supabase/migrations/004_mood.sql 의 valid_mood_scores 도 같이 바꾸세요.
export const EMOTIONS = [
  { key: 'joy', label: '즐거움' },
  { key: 'calm', label: '평온' },
  { key: 'love', label: '애정' },
  { key: 'sad', label: '우울' },
  { key: 'anxious', label: '불안' },
  { key: 'angry', label: '짜증' },
];
export const EMO = Object.fromEntries(EMOTIONS.map((e, i) => [e.key, { ...e, slot: i + 1 }]));

// 사람마다 기록 방식이 다름 (members.mood_profile). 키를 바꾸려면 supabase/migrations/006 의 valid_mood_scores 도 같이.
export const PROFILES = {
  emotions: {
    key: 'emotions', name: '감정 6가지 · 0~10점 · 기분 이모지', max: 10, emoji: true,
    items: EMOTIONS, defaultKeys: ['joy', 'sad'],
  },
  daily4: {
    key: 'daily4', name: '집중도·미루기·기분·불안 · 0~10점', max: 10, emoji: false,
    items: [
      { key: 'focus', label: '집중도' },
      { key: 'procrast', label: '미루기' },
      { key: 'mood', label: '기분' },
      { key: 'anxiety', label: '불안' },
    ],
    defaultKeys: ['focus', 'procrast', 'mood', 'anxiety'],
  },
};
export const profileOf = (member) => PROFILES[member?.mood_profile] ?? PROFILES.emotions;
const LABEL = Object.fromEntries(Object.values(PROFILES).flatMap((p) => p.items.map((i) => [i.key, i.label])));

export const MOOD_EMOJIS = [
  ['😆', '신남'], ['😊', '좋음'], ['🥰', '사랑'], ['😌', '편안'], ['😐', '그저 그럼'],
  ['😴', '피곤'], ['😔', '울적'], ['😢', '슬픔'], ['😰', '불안'], ['😡', '화남'],
];
export const emojiLabel = (e) => MOOD_EMOJIS.find(([x]) => x === e)?.[1] ?? '';

const W = ['일', '월', '화', '수', '목', '금', '토'];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 기간의 날짜 목록과 그날 기록
export function series(moods, memberId, endDay, n) {
  const days = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = addDays(endDay, -k);
    days.push({ day: d, entry: moods.find((m) => m.member_id === memberId && m.day === d) ?? null });
  }
  return days;
}

// 기간 평균 (기록한 날만)
export function average(days, key) {
  const v = days.map((x) => x.entry?.scores?.[key]).filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// 꺾은선 그래프 (SVG). 기록 없는 날은 선이 끊김.
// 반환: { svg, xs } — xs 는 날짜별 x 좌표 (툴팁용)
export function chartSVG(days, keys, width, { max = 10, emoji = true } = {}) {
  const n = days.length;
  const showEmoji = emoji && n <= 7;
  const weekday = n <= 7;
  const H = showEmoji ? 214 : 188;
  const m = { l: 24, r: 50, t: 10, b: showEmoji ? 50 : 24 };
  const pw = Math.max(80, width - m.l - m.r);
  const ph = H - m.t - m.b;
  const x = (i) => m.l + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v) => m.t + ((max - v) / max) * ph;
  const out = [];

  // 눈금 (0~10 은 0·5·10, 0~5 는 0·1·…·5)
  const ticks = max === 10 ? [0, 5, 10] : Array.from({ length: max + 1 }, (_, i) => i);
  for (const v of ticks) {
    out.push(`<line class="mc-grid${v === 0 ? ' base' : ''}" x1="${m.l}" x2="${m.l + pw}" y1="${y(v)}" y2="${y(v)}"/>`);
    out.push(`<text class="mc-tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  // x 축 라벨
  days.forEach((d, i) => {
    const label = weekday ? W[dow(d.day)] : (i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2)) ? `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8))}` : '';
    if (label) out.push(`<text class="mc-tick" x="${x(i)}" y="${m.t + ph + 16}" text-anchor="${!weekday && i === 0 ? 'start' : !weekday && i === n - 1 ? 'end' : 'middle'}">${label}</text>`);
    if (showEmoji && d.entry?.emoji) out.push(`<text class="mc-emoji" x="${x(i)}" y="${m.t + ph + 40}" text-anchor="middle">${esc(d.entry.emoji)}</text>`);
  });

  // 선 + 점
  const ends = [];
  for (const k of keys) {
    let path = '';
    let pen = false;
    let last = null;
    days.forEach((d, i) => {
      const v = d.entry?.scores?.[k];
      if (typeof v !== 'number') { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
      last = { i, v };
    });
    if (!path) continue;
    out.push(`<path class="mc-line" d="${path}" style="stroke:var(--emo-${k})"/>`);
    // 이어지지 않은 외딴 점도 보이도록 점 표시 (7일 보기는 모든 점, 30일은 마지막 점만)
    days.forEach((d, i) => {
      const v = d.entry?.scores?.[k];
      if (typeof v !== 'number') return;
      const prev = days[i - 1]?.entry?.scores?.[k], next = days[i + 1]?.entry?.scores?.[k];
      const lonely = typeof prev !== 'number' && typeof next !== 'number';
      if (weekday || lonely || i === last.i) out.push(`<circle class="mc-dot" cx="${x(i)}" cy="${y(v)}" r="4" style="fill:var(--emo-${k})"/>`);
    });
    ends.push({ k, y: y(last.v), x: x(last.i) });
  }
  // 선 끝 이름표 (겹치면 위아래로 밀어냄)
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  const over = ends.length ? ends[ends.length - 1].y - (m.t + ph + 4) : 0;
  if (over > 0) ends.forEach((e) => { e.y -= over; });
  for (const e of ends) out.push(`<text class="mc-end" x="${m.l + pw + 8}" y="${e.y + 4}">${LABEL[e.k]}</text>`);

  // 십자선 (툴팁용, 처음엔 숨김)
  out.push(`<line class="mc-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>`);
  const svg = `<svg class="mc-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="감정 점수 변화 그래프">${out.join('')}</svg>`;
  return { svg, xs: days.map((_, i) => x(i)), plot: { l: m.l, r: m.l + pw, t: m.t, b: m.t + ph } };
}
