// 퀘스트 · 경험치 · 레벨 규칙. 서버(supabase/migrations/002_quests.sql, push-tick)와 같은 숫자를 씁니다.

// 난이도별 경험치
export const DIFF = {
  easy:   { label: '쉬움',   xp: 10 },
  normal: { label: '보통',   xp: 25 },
  hard:   { label: '어려움', xp: 50 },
  epic:   { label: '전설',   xp: 100 },
};
export const DIFF_KEYS = Object.keys(DIFF);

export const xpOf = (item) => (item.kind === 'task' ? DIFF[item.difficulty]?.xp ?? DIFF.normal.xp : 0);

// 반복하는 할일 = 데일리 퀘스트, 한 번 하는 할일 = 서브 퀘스트
export const questType = (item) => (item.repeat === 'none' ? 'sub' : 'daily');
export const QUEST_LABEL = { daily: '데일리 퀘스트', sub: '서브 퀘스트', penalty: '못 한 계획' };

// 개인 퀘스트는 담당자, 공통 퀘스트는 체크한 사람이 경험치를 받음
export const earnerOf = (item, doneBy) => item.owner ?? doneBy;

// Lv.L → Lv.L+1 에 필요한 경험치: 100, 150, 200, … (레벨마다 50씩 증가)
export const LEVEL_BASE = 100;
export const LEVEL_STEP = 50;
export const need = (L) => LEVEL_BASE + LEVEL_STEP * (L - 1);
// Lv.L 에 도달하는 데 필요한 누적 경험치
export const xpToReach = (L) => LEVEL_BASE * (L - 1) + (LEVEL_STEP * (L - 1) * (L - 2)) / 2;

export function levelInfo(total = 0) {
  total = Math.max(0, total);   // 패널티가 있어도 0 아래로는 안 내려감
  let level = 1;
  while (total >= xpToReach(level + 1)) level++;
  const into = total - xpToReach(level);
  return { level, total, into, need: need(level), toNext: need(level) - into, pct: into / need(level) };
}
