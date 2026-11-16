// JOY 추천 엔진
// 추천 점수 ≈ 실행 가능성(시작률) × 예상 Joy  (스펙 16장)
// 데이터가 적을 때는 활동 특성으로 만든 기본값(prior)을 쓰고, 기록이 쌓일수록 실제 기록 쪽으로 옮겨 감.

const PRIOR_N = 2;   // 기본값을 "2번 기록한 것" 만큼의 무게로

// 활동별 통계: 제안 횟수, 시작, 완료, Joy 합계
export function activityStats(sessions) {
  const st = new Map();
  const get = (id) => {
    if (!st.has(id)) st.set(id, { suggested: 0, started: 0, completed: 0, joySum: 0, joyN: 0, lastSuggested: 0, lastStarted: 0 });
    return st.get(id);
  };
  for (const s of sessions) {
    const t = Date.parse(s.created_at);
    for (const id of new Set(s.suggested ?? [])) {
      const x = get(id); x.suggested++; x.lastSuggested = Math.max(x.lastSuggested, t);
    }
    if (s.activity_id && s.started) {
      const x = get(s.activity_id);
      x.started++; x.lastStarted = Math.max(x.lastStarted, t);
      if (!(s.suggested ?? []).includes(s.activity_id)) x.suggested++;   // 직접 고른 경우도 시도 1번으로
      if (s.completed) x.completed++;
      if (typeof s.joy === 'number') { x.joySum += s.joy; x.joyN++; }
    }
  }
  return st;
}

export const startRate = (x) => (x && x.suggested ? x.started / x.suggested : null);
export const avgJoy = (x) => (x && x.joyN ? x.joySum / x.joyN : null);

// 활동 특성으로 정한 기본 시작 가능성: 필요한 에너지가 낮고, 준비·외출·긴 시간이 없을수록 높음
export function priorStart(a) {
  let p = 0.85 - 0.08 * a.energy_min;
  if (a.prep) p -= 0.08;
  if (a.place === 'out') p -= 0.05;
  if ((a.minutes ?? 0) > 60) p -= 0.05;
  return Math.min(0.9, Math.max(0.2, p));
}

// 결정적 난수 (같은 세션에서는 같은 순서 → "다른 거" 눌러도 일관됨)
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function eligible(acts, energy, desire) {
  return acts.filter((a) => a.active && a.energy_min <= energy
    && (!desire || desire === 'random' || desire === 'none' || a.desires.includes(desire)));
}

// 점수 계산 + 정렬
export function rank(acts, sessions, { energy, desire, seed = 1, now = Date.now() }) {
  const st = activityStats(sessions);
  const rnd = seeded(seed);
  return eligible(acts, energy, desire).map((a) => {
    const x = st.get(a.id);
    const p0 = priorStart(a);
    const pStart = ((x?.started ?? 0) + PRIOR_N * p0) / ((x?.suggested ?? 0) + PRIOR_N);
    const j0 = 0.8 + (a.favorite ? 0.4 : 0);
    const expJoy = ((x?.joySum ?? 0) + PRIOR_N * j0) / ((x?.joyN ?? 0) + PRIOR_N);   // -2 ~ +2
    const reward = (expJoy + 2) / 4;                                                  // 0 ~ 1
    // 지금 에너지보다 훨씬 가벼운 활동은 조금 덜 맞음 (에너지 0 에게 무거운 건 eligible 에서 이미 빠짐)
    const fit = energy > a.energy_max ? Math.max(0.45, 1 - 0.15 * (energy - a.energy_max)) : 1;
    // 최근 3시간 안에 제안했는데 안 고른 건 잠깐 뒤로
    const snub = x && now - x.lastSuggested < 3 * 3600000 && x.lastStarted < x.lastSuggested ? 0.75 : 1;
    const jitter = 1 + (rnd() - 0.5) * 0.12;
    const score = pStart * reward * fit * snub * (a.favorite ? 1.12 : 1) * jitter;
    return { a, score, pStart, expJoy, n: x?.joyN ?? 0 };
  }).sort((p, q) => q.score - p.score);
}

// "지난 7번을 보면 … 6번 기분이 나아졌어" 같은 개인화 문장 (비슷한 에너지에서 3번 이상 기록이 있을 때)
export function personalNote(a, sessions, energy) {
  const near = sessions.filter((s) => s.activity_id === a.id && typeof s.joy === 'number'
    && (s.energy == null || Math.abs(s.energy - energy) <= 1));
  if (near.length < 3) return null;
  const good = near.filter((s) => s.joy > 0).length;
  if (good / near.length < 0.5) return null;
  return { n: near.length, good };
}

// 실제로 보여줄 단계 (이미 몸을 일으켰으면 "일어나기" 단계는 건너뜀)
export function stepsFor(a, { stoodUp = false } = {}) {
  return (a.steps ?? []).filter((s) => !(stoodUp && s.up));
}
