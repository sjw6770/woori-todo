// PAUSE 진행 규칙 (화면과 분리: 데이터만 보고 지금 누가 무엇을 할 차례인지 계산)
import { CALM_MAX } from './data.js';

// 대화 순서: 성향이 다르면 '화가 확 올라오는 편'이 먼저 (먼저 꺼내 놓아야 가라앉음), 같으면 PAUSE 누른 사람이 먼저
export function speakers(session, members, profiles) {
  const [x, y] = members;
  const sx = profiles[x.id]?.style ?? 'heat', sy = profiles[y.id]?.style ?? 'heat';
  let a = session.started_by === y.id ? y : x;
  if (sx !== sy) a = sx === 'heat' ? x : y;
  return [a, a.id === x.id ? y : x];
}

// 대화 단계: 힘들었던 일 → 상대가 이해 표시 → (반대로) → 세 문장 → 이해 표시 → (반대로)
// "잘 이해되지 않아" 면: 질문 하나 → 답 → 다시 이해 표시 (같은 말에 한 번만)
export function talkState(messages, A, B) {
  const queue = [
    { who: A.id, kind: 'hard' }, { who: B.id, kind: 'ack' },
    { who: B.id, kind: 'hard' }, { who: A.id, kind: 'ack' },
    { who: A.id, kind: 'three' }, { who: B.id, kind: 'ack' },
    { who: B.id, kind: 'three' }, { who: A.id, kind: 'ack' },
  ];
  const talk = messages.filter((m) => m.kind !== 'quick').sort((p, q) => p.created_at.localeCompare(q.created_at));
  let lastSpoken = null;              // 이해 표시 대상이 되는 마지막 말 (hard/three/answer)
  const asked = new Set();            // 질문이 이미 한 번 오간 말
  let subject = null;                 // 지금 이해 표시 중인 원래 말 (hard/three)
  for (const m of talk) {
    const want = queue[0];
    if (!want || want.who !== m.from_member || want.kind !== m.kind) continue;   // 순서에 안 맞는 건 무시
    queue.shift();
    if (m.kind === 'hard' || m.kind === 'three') { lastSpoken = m; subject = m; }
    if (m.kind === 'answer') lastSpoken = m;
    if (m.kind === 'ack' && m.ack === 'no' && subject && !asked.has(subject.id)) {
      asked.add(subject.id);
      queue.unshift({ who: m.from_member, kind: 'question' }, { who: subject.from_member, kind: 'answer' }, { who: m.from_member, kind: 'ack' });
    }
  }
  const next = queue[0] ?? null;
  return {
    done: !next,
    next,
    about: next?.kind === 'ack' ? lastSpoken : next?.kind === 'answer' ? talk.filter((m) => m.kind === 'question').at(-1) : null,
    subject,
    count: 8 + asked.size * 3,
    left: queue.length,
  };
}

// 재측정 결과: 둘 다 0~4 이고 "들을 수 있어" 면 대화 시작
export function evaluate(checks, round, members) {
  const mine = members.map((m) => checks.find((c) => c.member_id === m.id && c.round === round));
  if (mine.some((c) => !c)) return { ready: false, waiting: members.filter((_, i) => !mine[i]) };
  const ok = mine.every((c) => c.intensity <= CALM_MAX && c.can_listen === 'yes');
  return { ready: true, ok, checks: mine };
}

// 기록 한 줄 요약
export function summarize(session, checks, closings, members, rules) {
  const by = (mid, round) => checks.find((c) => c.session_id === session.id && c.member_id === mid && c.round === round)?.intensity;
  const rounds = [...new Set(checks.filter((c) => c.session_id === session.id).map((c) => c.round))].sort((a, b) => a - b);
  const cl = closings.filter((c) => c.session_id === session.id);
  const triggers = [...new Set(cl.flatMap((c) => c.triggers))];
  const broke = cl.flatMap((c) => c.broke.map((b) => ({ who: c.member_id, rule: b })));
  const end = session.closed_at ?? null;
  return {
    rounds: rounds.map((r) => ({ round: r, vals: members.map((m) => by(m.id, r)) })),
    triggers,
    broke,
    verbal: broke.filter((b) => /욕|인격|모독|헤어짐|죽겠/.test(b.rule)),
    physical: broke.filter((b) => /물건|던지|부수/.test(b.rule)),
    red: Boolean(session.red_at),
    talked: Boolean(session.talk_at),
    success: Boolean(end) && !session.red_at,
    minutes: end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(session.started_at)) / 60000)) : null,
  };
}
