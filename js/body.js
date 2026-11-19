// 체중·인바디: 숫자 계산과 그래프 (화면 코드와 분리)
import { addDays } from './schedule.js';

export const FIELDS = {
  weight: { label: '체중', unit: 'kg', target: 'target_weight', color: 'var(--body-w)' },
  smm: { label: '골격근량', unit: 'kg', target: 'target_smm', color: 'var(--body-m)' },
  fat_pct: { label: '체지방률', unit: '%', target: null, color: 'var(--body-f)' },
};

const num = (v) => (v == null || v === '' ? null : Number(v));
export const fmt = (v) => (v == null ? '–' : Number(v).toFixed(1));
export const signed = (v) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`);

// 한 사람의 기록을 날짜 오름차순으로
export const logsOf = (logs, memberId) => logs.filter((l) => l.member_id === memberId).sort((a, b) => a.day.localeCompare(b.day));

// 필드별 시작값·최근값·목표까지 진행률
export function progress(logs, key, target) {
  const xs = logs.filter((l) => num(l[key]) != null);
  if (!xs.length) return null;
  const first = xs[0], last = xs.at(-1);
  const start = num(first[key]), now = num(last[key]);
  const t = num(target);
  let pct = null, left = null, reached = false;
  if (t != null) {
    left = +(t - now).toFixed(1);
    const total = t - start;
    if (total === 0) { pct = 100; reached = true; }
    else {
      pct = Math.max(0, Math.min(100, ((now - start) / total) * 100));
      reached = total > 0 ? now >= t : now <= t;
    }
  }
  return { start, now, startDay: first.day, lastDay: last.day, change: +(now - start).toFixed(1), target: t, left, pct, reached };
}

// 7일 평균과 그 전 7일 평균의 차이 (하루하루 오르내림보다 추세를 보려고)
export function weekTrend(logs, key, today) {
  const avg = (from, to) => {
    const xs = logs.filter((l) => l.day > from && l.day <= to && num(l[key]) != null).map((l) => num(l[key]));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const now = avg(addDays(today, -7), today);
  const prev = avg(addDays(today, -14), addDays(today, -7));
  return { now, prev, diff: now != null && prev != null ? +(now - prev).toFixed(1) : null };
}

// 연속 기록 일수 (오늘 안 했으면 어제부터)
export function streak(logs, today) {
  const days = new Set(logs.map((l) => l.day));
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// 선 그래프 SVG: 한 지표 + 목표선 (점선). 축은 하나.
export function bodyChartSVG(logs, key, { target = null, width, from, to }) {
  const pts = logs.filter((l) => num(l[key]) != null && l.day >= from && l.day <= to).map((l) => ({ day: l.day, v: num(l[key]) }));
  const H = 170, m = { l: 34, r: 14, t: 12, b: 24 };
  const pw = Math.max(80, width - m.l - m.r), ph = H - m.t - m.b;
  const t0 = Date.parse(from), t1 = Date.parse(to), span = Math.max(1, t1 - t0);
  const x = (day) => m.l + ((Date.parse(day) - t0) / span) * pw;
  const vals = pts.map((p) => p.v).concat(target != null ? [num(target)] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.6, (hi - lo) * 0.15);
  lo = Math.floor((lo - pad) * 2) / 2; hi = Math.ceil((hi + pad) * 2) / 2;
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * ph;
  const out = [];
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(`<line class="mc-grid" x1="${m.l}" x2="${m.l + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    out.push(`<text class="mc-tick" x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${+v.toFixed(1)}</text>`);
  }
  const lab = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  out.push(`<text class="mc-tick" x="${m.l}" y="${H - 6}" text-anchor="start">${lab(from)}</text>`);
  out.push(`<text class="mc-tick" x="${m.l + pw}" y="${H - 6}" text-anchor="end">${lab(to)}</text>`);
  if (target != null) {
    const ty = y(num(target)).toFixed(1);
    out.push(`<line class="bc-target" x1="${m.l}" x2="${m.l + pw}" y1="${ty}" y2="${ty}"/>`);
    out.push(`<text class="bc-target-t" x="${m.l + pw}" y="${(y(num(target)) - 5).toFixed(1)}" text-anchor="end">목표 ${fmt(target)}</text>`);
  }
  if (pts.length) {
    out.push(`<path class="mc-line" style="stroke:${FIELDS[key].color}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}"/>`);
    const r = pts.length > 40 ? 2.5 : 4;
    for (const p of pts) out.push(`<circle class="mc-dot" r="${r}" cx="${x(p.day).toFixed(1)}" cy="${y(p.v).toFixed(1)}" style="fill:${FIELDS[key].color}"/>`);
  }
  out.push(`<line class="mc-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>`);
  return {
    svg: `<svg class="mc-svg" viewBox="0 0 ${m.l + pw + m.r} ${H}" width="${m.l + pw + m.r}" height="${H}" role="img" aria-label="${FIELDS[key].label} 그래프">${out.join('')}</svg>`,
    pts: pts.map((p) => ({ ...p, x: x(p.day), y: y(p.v) })),
    plot: { t: m.t },
  };
}
function niceStep(raw) {
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 20]) if (raw <= s) return s;
  return 50;
}
