// 말 거르기 (규칙 기반). AI 가 아니라 정해진 표현을 찾아서 알려 줌.
//   block : 욕설·모욕·관계를 끝내겠다는 결정·위협 → 고쳐야 보낼 수 있음
//   soft  : 상대에 대한 평가·일반화(맨날, 항상, 넌 왜…) → 바꿔 보기를 권하고, 그래도 보낼 수 있음
//   danger: 죽음·자해를 말함 → 안전 화면 안내

const SWEAR = /씨발|시발|ㅅㅂ|병신|ㅂㅅ|개새|개같|좆|존나|미친|미쳤|또라이|돌았|정신병|꺼져|닥쳐|쓰레기|역겨|혐오스|지랄|븅신|등신|멍청/;
const INSULT = /한심|이기적|무책임|유치|집착|급발진|피해망상|최악|수준\s*(이|하고는|봐)|인간이\s*(야|냐|니)|사람\s*새끼|구제불능/;
const DECISION = /(헤어지|헤어져|헤어질|이혼|파혼|결혼\s*(안|못|취소|그만|하지\s*말)|끝내자|끝내|끝이야|끝난\s*거|그만\s*만나|그만하자|다\s*때려\s*치|때려치|정\s*떨어|다\s*필요\s*없)/;
const THREAT = /(가만\s*안\s*둬|가만\s*안\s*있|두고\s*봐|찾아갈|부숴|던져\s*버|죽여)/;
const DANGER = /(죽고\s*싶|죽어\s*버리|죽을\s*거|죽을래|사라지고\s*싶|살기\s*싫|없어지고\s*싶|자해|목숨)/;
const YOU = /(^|\s)(넌|너는|니가|네가|너가|너도|너\s*때문|당신은|당신이)/;
const ALWAYS = /(맨날|항상|매번|(?:^|\s)늘\s|언제나|또\s*그러|또\s*저러|원래\s*그래|절대\s*안)/;
const WHY_YOU = /(왜\s*(맨날|항상|또|매번)|어떻게\s*그럴\s*수)/;
const BLAME_END = /(잖아|거잖아|아니냐|아니야\?|하냐|하니\?)\s*[.!?]*\s*$/;

const find = (re, t) => { const m = t.match(re); return m ? m[0].trim() : null; };

export function review(text) {
  const t = String(text ?? '').trim();
  const out = { level: 'ok', reasons: [], words: [], danger: false, decision: null };
  if (!t) return out;
  const hit = (level, reason, word) => {
    if (level === 'block' || out.level === 'ok') out.level = level === 'block' ? 'block' : out.level === 'block' ? 'block' : 'soft';
    out.reasons.push(reason);
    if (word) out.words.push(word);
  };
  const sw = find(SWEAR, t); if (sw) hit('block', '욕설이나 모욕하는 말이 있어요', sw);
  const th = find(THREAT, t); if (th) hit('block', '위협으로 들릴 수 있는 말이 있어요', th);
  const dc = find(DECISION, t);
  // "헤어지자는 말을 들었을 때…"처럼 들은 말을 옮기는 건 결정이 아님
  const quoted = dc && new RegExp(`${dc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.!?\n]{0,6}(말|소리|얘기|라고|다고|자고)`).test(t);
  if (dc && !quoted) { out.decision = dc; hit('block', '관계를 끝내겠다는 결정이 들어 있어요. 결정은 지금 보류해요', dc); }
  const ins = find(INSULT, t); if (ins) hit('soft', '상대를 평가하는 말이 있어요', ins);
  const al = find(ALWAYS, t); if (al) hit('soft', '"맨날·항상" 같은 일반화가 있어요', al);
  const why = find(WHY_YOU, t); if (why) hit('soft', '따지는 질문으로 들릴 수 있어요', why);
  if (YOU.test(t) && (BLAME_END.test(t) || al || ins) && !out.reasons.includes('주어가 "너"로 시작하는 비난이 있어요')) hit('soft', '주어가 "너"로 시작하는 비난이 있어요', find(YOU, t));
  if (DANGER.test(t)) { out.danger = true; }
  return out;
}

// 혼잣말에서 '감정'과 '결정'을 나눠 줌
export function reflect(text, emotion) {
  const r = review(text);
  const lines = [];
  const emo = emotion && emotion !== '모르겠음' ? emotion : null;
  lines.push(emo ? `지금 가장 큰 감정은 ${emo}${batchim(emo) ? '이에요' : '예요'}.` : '지금 감정이 아주 크다는 게 느껴져요.');
  if (r.decision) {
    lines.push(`“${sentenceWith(text, r.decision)}” — 이건 감정이 아니라 결정이에요.`);
    lines.push('결정은 지금 보류해요. 15분 뒤에도, 내일도 내릴 수 있어요.');
  } else if (r.level !== 'ok') {
    lines.push('지금 이 말을 그대로 하면 상대도 방어하게 될 가능성이 커요. 대화할 때 같이 다듬어요.');
  } else {
    lines.push('적은 말은 상대에게 가지 않아요. 꺼내 놓은 것만으로도 충분해요.');
  }
  return { lines, danger: r.danger };
}

// "나 전달법" 문장 만들기: 상황 + 감정 + 바람
export function iMessage({ situation, emotion, need }) {
  const s = (situation ?? '').trim().replace(/[.。]$/, '');
  const e = (emotion ?? '').trim();
  const n = (need ?? '').trim().replace(/[.。]$/, '');
  const parts = [];
  if (s) parts.push(`${s} 나는 ${e || '많이 힘들'}${e ? (batchim(e) ? '을' : '를') + ' 느꼈어' : '었어'}.`);
  else if (e) parts.push(`나는 ${e}${batchim(e) ? '을' : '를'} 느꼈어.`);
  if (n) parts.push(`${/^(나는|난|내가)\s/.test(n) ? '' : '나는 '}${n}.`);
  return parts.join(' ');
}

function sentenceWith(text, word) {
  const parts = String(text).split(/(?<=[.!?。\n])\s*/);
  const s = (parts.find((x) => x.includes(word)) ?? text).trim();
  return s.length > 60 ? `${s.slice(0, 58)}…` : s;
}
export function batchim(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
}
