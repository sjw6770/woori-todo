// 날짜·반복 계산 (KST 기준). 서버 함수(push-tick)와 같은 규칙을 씁니다.

const DAY = 86400000;

// "YYYY-MM-DD" ↔ UTC 자정 Date (시간대 영향 없이 날짜만 다룸)
export const parseD = (s) => new Date(s + 'T00:00:00Z');
export const fmtD = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fmtD(new Date(parseD(s).getTime() + n * DAY));
export const dow = (s) => parseD(s).getUTCDay();

// 현재 한국 시각 { date: 'YYYY-MM-DD', min: 하루 중 분 }
export function nowKST(ms = Date.now()) {
  const k = new Date(ms + 9 * 3600000);
  return { date: fmtD(k), min: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

export const toMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function daysInMonth(s) {
  const d = parseD(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// 이 항목이 해당 날짜에 발생하는가
export function occursOn(item, date) {
  if (date < item.start_date) return false;
  if (item.end_date && date > item.end_date) return false;
  switch (item.repeat) {
    case 'daily':
      return true;
    case 'weekly': {
      const days = item.weekdays && item.weekdays.length ? item.weekdays : [dow(item.start_date)];
      return days.includes(dow(date));
    }
    case 'monthly': {
      const want = Number(item.start_date.slice(8, 10));
      return Number(date.slice(8, 10)) === Math.min(want, daysInMonth(date));
    }
    default:
      return date === item.start_date;
  }
}

export const isDone = (completions, itemId, date) =>
  completions.some((c) => c.item_id === itemId && c.occur_date === date);

// 지난 날짜의 미완료 단발성 할일 (오늘 화면의 "밀린 할일")
export function overdue(items, completions, today) {
  return items.filter(
    (i) => i.kind === 'task' && i.repeat === 'none' && i.start_date < today &&
      !isDone(completions, i.id, i.start_date)
  );
}

// 해당 날짜의 알림 시각 목록 (분 단위, 같은 날 안에서만)
//  - 기본 알림: time - remind_before
//  - 다시 알림: 할일이면 time 이후 nag_every 분마다 (23:59 까지)
export function fireTimes(item, date) {
  const t = toMin(item.time);
  if (t == null || item.remind_before == null) return [];
  const out = [];
  const first = t - item.remind_before;
  if (first >= 0) out.push(first);
  if (item.kind === 'task' && item.nag_every > 0) {
    for (let m = t + item.nag_every; m < 1440; m += item.nag_every) out.push(m);
  }
  return out;
}

// 하루 전 등 날짜를 넘어가는 약속 알림: (발생일, 알림이 울리는 날짜, 분)
export function fireSlots(item, fireDate) {
  const slots = [];
  // 오늘 발생 → 오늘 울림
  if (occursOn(item, fireDate)) {
    for (const m of fireTimes(item, fireDate)) slots.push({ occur: fireDate, min: m });
  }
  // 내일(혹은 그 이후) 발생 → 오늘 울림 (remind_before 가 하루 이상인 경우)
  const t = toMin(item.time);
  if (t != null && item.remind_before != null && t - item.remind_before < 0) {
    const daysAhead = Math.ceil((item.remind_before - t) / 1440);
    for (let k = 1; k <= daysAhead; k++) {
      const occ = addDays(fireDate, k);
      const m = t - item.remind_before + k * 1440;
      if (m >= 0 && m < 1440 && occursOn(item, occ)) slots.push({ occur: occ, min: m });
    }
  }
  return slots;
}

export const repeatLabel = (item) => {
  const W = ['일', '월', '화', '수', '목', '금', '토'];
  switch (item.repeat) {
    case 'daily': return '매일';
    case 'weekly': {
      const days = item.weekdays && item.weekdays.length ? item.weekdays : [dow(item.start_date)];
      return days.length === 7 ? '매일' : '매주 ' + [...days].sort().map((d) => W[d]).join('·');
    }
    case 'monthly': return `매월 ${Number(item.start_date.slice(8, 10))}일`;
    default: return '';
  }
};
