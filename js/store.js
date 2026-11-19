// 데이터 저장소: Supabase(실사용) 또는 localStorage(데모)
import { CONFIG } from './config.js';
import { nowKST, addDays } from './schedule.js';
import { xpOf, questType, earnerOf } from './quest.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ------------------------------------------------------------------ Supabase
class SupabaseStore {
  demo = false;
  me = null; members = []; items = []; completions = [];
  xpTotals = {}; xpLog = []; rewards = [];
  calm = null;   // 진행 중인 진정하기 (없으면 null)
  moods = [];    // 하루 감정 기록 (최근 120일)
  moodPrivate = [];   // 내 비공개 메모 [{ day, note }]
  diaries = [];  // 하루 일기 (내 것 전부 + 상대의 '함께 보기', 최근 1년)
  bodyGoals = []; bodyLogs = [];   // 체중·인바디 (내 것 + 상대가 공개한 것)
  places = [];   // 갈 곳 목록 (카카오 장소는 id·검색어만 있음 → 화면에서 실시간 조회)
  #sb; #listeners = []; #channel = null;

  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.#sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const { data } = await this.#sb.auth.getSession();
    if (!data.session) return { needLogin: true };
    return this.#afterLogin(data.session.user.id);
  }

  async signIn(email, password) {
    const { data, error } = await this.#sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('이메일 또는 비밀번호가 맞지 않아요.');
    return this.#afterLogin(data.user.id);
  }

  async #afterLogin(userId) {
    await this.load();
    this.me = this.members.find((m) => m.id === userId) || null;
    if (!this.me) {
      await this.#sb.auth.signOut();
      throw new Error('등록되지 않은 계정이에요. setup.sql 의 구성원 등록을 확인하세요.');
    }
    this.#subscribe();
    return { needLogin: false };
  }

  async signOut() {
    if (this.#channel) this.#sb.removeChannel(this.#channel);
    await this.#sb.auth.signOut();
  }

  // Supabase 는 한 번에 최대 1000줄만 주므로 나눠서 모두 받음
  async #all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build().range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async load() {
    const since = addDays(nowKST().date, -120);
    const [m, items, comps, quest, calm, moods, places, priv, diaries, bgoals, blogs] = await Promise.all([
      this.#sb.from('members').select('*').order('created_at'),
      this.#all(() => this.#sb.from('items').select('*').order('start_date').order('id')),
      this.#all(() => this.#sb.from('completions').select('*').gte('occur_date', since).order('occur_date').order('item_id')),
      this.#loadQuest(),
      this.#sb.from('calm_sessions').select('*').is('ended_at', null).order('started_at', { ascending: false }).limit(1),
      this.#all(() => this.#sb.from('moods').select('*').gte('day', since).order('day').order('member_id')).catch(() => []),
      this.#all(() => this.#sb.from('places').select('*').order('created_at', { ascending: false }).order('id')).catch(() => []),
      this.#all(() => this.#sb.from('mood_private').select('day,note').gte('day', since).order('day')).catch(() => []),
      this.#all(() => this.#sb.from('diaries').select('*').gte('day', addDays(nowKST().date, -365)).order('day', { ascending: false }).order('member_id')).catch(() => []),
      this.#all(() => this.#sb.from('body_goals').select('*').order('member_id')).catch(() => []),
      this.#all(() => this.#sb.from('body_logs').select('*').gte('day', addDays(nowKST().date, -730)).order('day').order('member_id')).catch(() => []),
    ]);
    this.diaries = diaries;
    this.bodyGoals = bgoals; this.bodyLogs = blogs;
    this.places = places;
    this.moodPrivate = priv;   // 내 비공개 메모만 (보안 규칙상 상대 것은 안 옴)
    if (m.error) throw new Error(m.error.message);
    this.members = m.data; this.items = items; this.completions = comps;
    Object.assign(this, quest);
    this.calm = calm.error ? null : calm.data[0] ?? null;
    this.moods = moods;
    if (this.me) this.me = this.members.find((x) => x.id === this.me.id);
  }

  // 퀘스트 테이블이 아직 없어도(업데이트 직후) 앱은 그대로 동작
  async #loadQuest() {
    const [t, l, r] = await Promise.all([
      this.#sb.from('xp_totals').select('*'),
      this.#sb.from('xp_log').select('*').order('created_at', { ascending: false }).limit(100),
      this.#sb.from('rewards').select('*').order('level'),
    ]);
    if (t.error || l.error || r.error) return { xpTotals: {}, xpLog: [], rewards: [] };
    return {
      xpTotals: Object.fromEntries(t.data.map((x) => [x.member_id, x.total])),
      xpLog: l.data, rewards: r.data,
    };
  }

  #subscribe() {
    let t;
    const reload = () => { clearTimeout(t); t = setTimeout(async () => { await this.load(); this.#emit(); }, 250); };
    this.#channel = this.#sb.channel('woori')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_log' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calm_sessions' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moods' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mood_private' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diaries' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'body_goals' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'body_logs' }, reload)
      .subscribe();
    // 앱으로 돌아올 때 최신화
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
  }

  onChange(cb) { this.#listeners.push(cb); }
  #emit() { this.#listeners.forEach((cb) => cb()); }

  async saveItem(item) {
    const row = { ...item };
    delete row.created_at; delete row.updated_at;
    const q = row.id
      ? this.#sb.from('items').update(row).eq('id', row.id).select().single()
      : this.#sb.from('items').insert(row).select().single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    await this.load();
    return data;
  }

  async deleteItem(id) {
    const { error } = await this.#sb.from('items').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async toggle(itemId, date, done) {
    const r = done
      ? await this.#sb.from('completions').upsert({ item_id: itemId, occur_date: date })
      : await this.#sb.from('completions').delete().eq('item_id', itemId).eq('occur_date', date);
    if (r.error) throw new Error(r.error.message);
    await this.load();
  }

  async updateMe(patch) {
    const { error } = await this.#sb.from('members').update(patch).eq('id', this.me.id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async saveReward(rw) {
    const row = { ...rw };
    delete row.created_at;
    const { error } = row.id
      ? await this.#sb.from('rewards').update(row).eq('id', row.id)
      : await this.#sb.from('rewards').insert(row);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async deleteReward(id) {
    const { error } = await this.#sb.from('rewards').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async claimReward(id, claimed) {
    const { error } = await this.#sb.from('rewards').update({ claimed_at: claimed ? new Date().toISOString() : null }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  // 진정하기 (시작·종료 시각은 서버가 정함)
  async startCalm({ minutes, message }) {
    const { data, error } = await this.#sb.from('calm_sessions').insert({ minutes, message }).select().single();
    if (error) throw new Error(error.message);
    await this.load();
    return data;
  }
  async acceptCalm(id) {
    const { error } = await this.#sb.from('calm_sessions').update({ accepted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }
  async endCalm(id) {
    const { error } = await this.#sb.from('calm_sessions').update({ ended_at: new Date().toISOString(), ended_by: this.me.id }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  // 하루 감정 기록 (같은 날은 덮어씀)
  async saveMood({ day, emoji, scores, note, shared, privateNote }) {
    const { error } = await this.#sb.from('moods')
      .upsert({ member_id: this.me.id, day, emoji, scores, note, shared }, { onConflict: 'member_id,day' });
    if (error) throw new Error(error.message);
    const p = privateNote
      ? await this.#sb.from('mood_private').upsert({ member_id: this.me.id, day, note: privateNote }, { onConflict: 'member_id,day' })
      : await this.#sb.from('mood_private').delete().eq('member_id', this.me.id).eq('day', day);
    if (p.error) throw new Error(p.error.message);
    await this.load();
  }
  async deleteMood(day) {
    const { error } = await this.#sb.from('moods').delete().eq('member_id', this.me.id).eq('day', day);
    if (error) throw new Error(error.message);
    await this.#sb.from('mood_private').delete().eq('member_id', this.me.id).eq('day', day);
    await this.load();
  }
  async saveDiary({ day, body, shared }) {
    const { error } = await this.#sb.from('diaries').upsert({ member_id: this.me.id, day, body, shared }, { onConflict: 'member_id,day' });
    if (error) throw new Error(error.message);
    await this.load();
  }
  async deleteDiary(day) {
    const { error } = await this.#sb.from('diaries').delete().eq('member_id', this.me.id).eq('day', day);
    if (error) throw new Error(error.message);
    await this.load();
  }
  async saveBodyGoal(patch) {
    const { error } = await this.#sb.from('body_goals').upsert({ member_id: this.me.id, ...patch });
    if (error) throw new Error(error.message);
    await this.load();
  }
  async saveBodyLog(row) {
    const { error } = await this.#sb.from('body_logs').upsert({ member_id: this.me.id, ...row }, { onConflict: 'member_id,day' });
    if (error) throw new Error(error.message);
    await this.load();
  }
  async deleteBodyLog(day) {
    const { error } = await this.#sb.from('body_logs').delete().eq('member_id', this.me.id).eq('day', day);
    if (error) throw new Error(error.message);
    await this.load();
  }

  // 갈 곳
  async searchPlaces(query) { return this.callFn({ action: 'place-search', query }); }
  async lookupPlaces(list) { return (await this.callFn({ action: 'place-lookup', places: list })).info ?? {}; }
  async addPlace(r, query) {
    // 카카오 결과는 정책상 ID + 사용자가 입력한 검색어만 저장
    const row = r.source === 'kakao'
      ? { source: 'kakao', source_id: r.source_id, query }
      : { source: r.source, source_id: r.source_id, name: r.name, address: r.address, category: r.category || null, lat: r.lat, lng: r.lng, url: r.url };
    const { data, error } = await this.#sb.from('places').insert(row).select().single();
    if (error) throw new Error(error.code === '23505' ? '이미 갈 곳에 있어요' : error.message);
    await this.load();
    return data;
  }
  async addManualPlace({ name, address, memo, tags = [], lat = null, lng = null }) {
    const { data, error } = await this.#sb.from('places').insert({ source: 'manual', name, address, memo, tags, lat, lng }).select().single();
    if (error) throw new Error(error.message);
    await this.load();
    return data;
  }
  async updatePlace(id, patch) {
    const { error } = await this.#sb.from('places').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }
  async deletePlace(id) {
    const { error } = await this.#sb.from('places').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async savePush(sub) {
    const { error } = await this.#sb.from('push_subs').upsert({ ...sub, member_id: this.me.id });
    if (error) throw new Error(error.message);
  }

  async callFn(body) {
    const { data, error } = await this.#sb.functions.invoke('push-tick', { body });
    if (error) throw new Error(error.message);
    return data;
  }
}

// ------------------------------------------------------------------ 데모 (이 기기에만 저장)
const KEY = 'woori-demo-v4';

function seed() {
  const d = nowKST().date;
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  const members = [
    { id: 'm1', name: '종원', color: '#3b6fd8', brief_time: '08:00', nag_time: '21:00', mood_profile: 'emotions' },
    { id: 'm2', name: '지윤', color: '#e0607e', brief_time: '07:30', nag_time: '21:30', mood_profile: 'daily4' },
  ];
  const base = { note: '', end_date: null, weekdays: [], nag_every: 0, created_by: 'm1', difficulty: 'normal' };
  const items = [
    { ...base, id: uid(), kind: 'task', title: '분리수거 내놓기', owner: null, start_date: d, time: '20:00', repeat: 'weekly', weekdays: [wd, (wd + 3) % 7], remind_before: 0, nag_every: 60, difficulty: 'easy' },
    { ...base, id: uid(), kind: 'event', title: '웨딩홀 2차 상담', owner: null, start_date: addDays(d, 2), time: '14:00', repeat: 'none', remind_before: 1440, note: '견적서 출력해서 가기' },
    { ...base, id: uid(), kind: 'task', title: '비타민 챙겨 먹기', owner: 'm2', start_date: d, time: '09:00', repeat: 'daily', remind_before: 0, created_by: 'm2', difficulty: 'easy' },
    { ...base, id: uid(), kind: 'task', title: '세탁소에서 정장 찾기', owner: 'm1', start_date: addDays(d, -1), time: null, repeat: 'none', remind_before: null },
    { ...base, id: uid(), kind: 'task', title: '청첩장 시안 피드백 보내기', owner: 'm1', start_date: d, time: '12:30', repeat: 'none', remind_before: 0, difficulty: 'hard' },
    { ...base, id: uid(), kind: 'event', title: '저녁 데이트', owner: null, start_date: d, time: '19:00', repeat: 'none', remind_before: 60, note: '해방촌' },
    { ...base, id: uid(), kind: 'task', title: '관리비 이체', owner: 'm2', start_date: addDays(d, 5), time: '10:00', repeat: 'monthly', remind_before: 0, created_by: 'm2' },
    { ...base, id: uid(), kind: 'task', title: '장보기 (우유, 계란)', owner: null, start_date: d, time: null, repeat: 'none', remind_before: null, created_by: 'm2', difficulty: 'easy' },
    { ...base, id: uid(), kind: 'task', title: '아침 러닝 5km', owner: 'm1', start_date: addDays(d, -20), time: '07:00', repeat: 'daily', remind_before: 0, difficulty: 'hard' },
    { ...base, id: uid(), kind: 'task', title: '영어 단어 30개', owner: 'm1', start_date: addDays(d, -20), time: '22:00', repeat: 'daily', remind_before: 0 },
    { ...base, id: uid(), kind: 'task', title: '신혼집 대출 서류 제출', owner: 'm1', start_date: addDays(d, 1), time: null, repeat: 'none', remind_before: null, difficulty: 'epic' },
  ];
  const completions = [{ item_id: items[2].id, occur_date: d, done_by: 'm2' }];

  // 지난 기록 (예시): 종원 640 XP = Lv.4, 지윤 825(+오늘 10) XP = Lv.5
  const xp_log = [];
  const past = (member, list, target) => {
    let sum = 0, k = 1;
    while (sum < target) {
      for (const [title, xp, type] of list) {
        if (sum + xp > target) continue;
        xp_log.push({ id: uid(), member_id: member, item_id: null, occur_date: addDays(d, -k), title, xp, quest_type: type,
          created_at: new Date(Date.parse(addDays(d, -k) + 'T12:00:00Z')).toISOString() });
        sum += xp;
      }
      k++;
      if (k > 60) break;
    }
  };
  past('m1', [['아침 러닝 5km', 50, 'daily'], ['영어 단어 30개', 25, 'daily'], ['분리수거 내놓기', 10, 'daily']], 640);
  past('m2', [['필라테스', 50, 'daily'], ['비타민 챙겨 먹기', 10, 'daily'], ['청첩장 업체 견적 비교', 25, 'sub']], 825);
  // 오늘 이미 완료한 퀘스트
  xp_log.push({ id: uid(), member_id: 'm2', item_id: items[2].id, occur_date: d, title: items[2].title, xp: 10, quest_type: 'daily', created_at: new Date().toISOString() });

  const rw = (member_id, level, title, created_by, claimed = false) =>
    ({ id: uid(), member_id, level, title, note: null, created_by, claimed_at: claimed ? new Date().toISOString() : null });
  const rewards = [
    rw('m1', 3, '치킨 한 마리', 'm2', true),
    rw('m1', 5, '곱창 데이트', 'm2'),
    rw('m1', 10, '새 러닝화', 'm1'),
    rw('m1', 20, '제주도 주말 여행', 'm2'),
    rw('m2', 3, '스타벅스 기프티콘', 'm1', true),
    rw('m2', 6, '네일 받기', 'm1'),
    rw('m2', 12, '오마카세 디너', 'm1'),
  ];
  return { members, items, completions, xp_log, rewards, moods: seedMoods(), places: seedPlaces(), meId: 'm1' };
}

// 예시 감정 기록 30일 (항상 같은 값이 나오도록 고정 난수)
function seedMoods() {
  const d = nowKST().date;
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const clamp = (v) => Math.max(0, Math.min(10, Math.round(v)));
  const notes = ['산책하면서 이야기 많이 함', '회의가 길어서 지침', '맛있는 저녁 먹음', '청첩장 일정 때문에 조금 초조', '푹 잤음',
    '야근', '친구들 만나서 즐거웠음', '사소한 걸로 다퉜다가 화해', '운동하고 개운함', ''];
  const out = [];
  for (const [mid, base] of [['m1', { joy: 6, calm: 5, love: 7, sad: 3, anxious: 4, angry: 3 }], ['m2', { joy: 7, calm: 6, love: 8, sad: 2, anxious: 3, angry: 2 }]]) {
    const cur = { ...base };
    for (let k = 29; k >= 0; k--) {
      const day = addDays(d, -k);
      if (mid === 'm1' && k === 0) continue;   // 종원은 오늘 아직 기록 전
      if (rnd() < 0.14) continue;               // 가끔 빠진 날
      for (const key of Object.keys(cur)) cur[key] = Math.max(0, Math.min(10, cur[key] + (rnd() - 0.5) * 3 + (base[key] - cur[key]) * 0.3));
      const scores = Object.fromEntries(Object.entries(cur).map(([key, v]) => [key, clamp(v)]));
      if (mid === 'm2') {
        const h = clamp;
        out.push({ member_id: mid, day, emoji: null, shared: rnd() > 0.15,
          scores: { focus: h(scores.calm + 1), procrast: h(10 - scores.joy), mood: h(scores.joy), anxiety: h(scores.anxious) },
          note: notes[Math.floor(rnd() * notes.length)] || null });
        continue;
      }
      const good = scores.joy + scores.calm + scores.love - scores.sad - scores.anxious - scores.angry;
      const emoji = good > 12 ? (scores.love >= 8 ? '🥰' : '😆') : good > 6 ? '😊' : good > 2 ? '😌' : good > -2 ? '😐' : scores.angry >= 6 ? '😡' : scores.anxious >= 6 ? '😰' : '😔';
      out.push({ member_id: mid, day, emoji, scores, note: notes[Math.floor(rnd() * notes.length)] || null, shared: true });
    }
  }
  return out;
}

// 예시 체중·인바디 기록 (최근 6주, 가끔 빠진 날)
function seedBody() {
  const d = nowKST().date;
  const bodyLogs = [];
  for (let k = 42; k >= 1; k--) {
    if (k % 6 === 0) continue;
    const t = 42 - k;
    const wob = Math.sin(k * 1.7) * 0.35;
    bodyLogs.push({ member_id: 'm1', day: addDays(d, -k), weight: +(78.2 - t * 0.07 + wob).toFixed(1),
      smm: k % 7 === 3 ? +(33.6 + t * 0.03).toFixed(1) : null, fat_pct: k % 7 === 3 ? +(23.4 - t * 0.06).toFixed(1) : null, note: null });
    if (k % 2) bodyLogs.push({ member_id: 'm2', day: addDays(d, -k), weight: +(56.4 - t * 0.03 + wob / 2).toFixed(1),
      smm: k % 7 === 3 ? +(21.2 + t * 0.02).toFixed(1) : null, fat_pct: k % 7 === 3 ? +(28.1 - t * 0.04).toFixed(1) : null, note: null });
  }
  return {
    bodyGoals: [
      { member_id: 'm1', target_weight: 72.0, target_smm: 36.0, shared: true },
      { member_id: 'm2', target_weight: 53.0, target_smm: 22.5, shared: true },
    ],
    bodyLogs,
  };
}

// 예시 일기
function seedDiaries() {
  const d = nowKST().date;
  const at = (day) => `${day}T13:00:00.000Z`;
  return [
    { member_id: 'm1', day: addDays(d, -1), body: '퇴근하고 같이 장 봐서 파스타 해 먹음. 소스가 좀 짰는데 지윤이가 맛있다고 해 줘서 기분 좋았다.', shared: true },
    { member_id: 'm2', day: addDays(d, -1), body: '오랜만에 둘이 산책. 해방촌 골목 불빛이 예뻤다. 다음 주엔 신라호텔 뷔페!', shared: true },
    { member_id: 'm1', day: addDays(d, -2), body: '회의가 길어서 지침. 내일은 운동 꼭 가기.', shared: false },
    { member_id: 'm2', day: addDays(d, -3), body: '나만 보는 일기 (예시)', shared: false },
  ].map((x) => ({ ...x, created_at: at(x.day), updated_at: at(x.day) }));
}

// 예시 비공개 메모 (본인만 보임)
function seedPrivate() {
  const d = nowKST().date;
  return [
    { member_id: 'm1', day: addDays(d, -1), note: '사실 회의 때 한 말이 계속 마음에 걸림' },
    { member_id: 'm2', day: addDays(d, -2), note: '혼자 생각 정리할 시간이 필요했던 날' },
  ];
}

// 데모용 예시 장소 (실제 앱은 카카오/OpenStreetMap 검색)
const DEMO_PLACES = [
  ['남산서울타워', '관광명소', '서울 용산구 남산공원길 105', 37.5512, 126.9882],
  ['해방촌 신흥시장', '시장', '서울 용산구 신흥로 95-9', 37.5446, 126.9853],
  ['어니언 성수', '카페', '서울 성동구 아차산로9길 8', 37.5446, 127.0581],
  ['서울숲', '공원', '서울 성동구 뚝섬로 273', 37.5444, 127.0374],
  ['국립중앙박물관', '박물관', '서울 용산구 서빙고로 137', 37.5239, 126.9803],
  ['경복궁', '관광명소', '서울 종로구 사직로 161', 37.5796, 126.9770],
  ['익선동 한옥거리', '관광명소', '서울 종로구 익선동', 37.5742, 126.9897],
  ['성수 연무장길 카페거리', '카페거리', '서울 성동구 연무장길', 37.5427, 127.0560],
  ['해방촌 오거리 루프탑', '술집', '서울 용산구 신흥로 20', 37.5432, 126.9862],
  ['반포 한강공원', '공원', '서울 서초구 신반포로11길 40', 37.5100, 126.9958],
].map(([name, category, address, lat, lng], i) => ({
  source: 'osm', source_id: `demo/${i}`, name, category, address, lat, lng,
  url: `https://map.kakao.com/?q=${encodeURIComponent(name)}`,
}));

function seedPlaces() {
  const now = Date.now();
  return [DEMO_PLACES[2], DEMO_PLACES[4], DEMO_PLACES[9], DEMO_PLACES[0]].map((r, i) => ({
    id: uid(), ...r, query: null, memo: ['웨이팅 길다고 함, 평일 오전 추천', '특별전 12월까지', '자전거 빌려서 피크닉', null][i],
    tags: [['카페', '데이트'], ['전시'], ['산책', '데이트'], ['야경', '데이트']][i],
    visited_at: i === 3 ? new Date(now - 9 * 86400000).toISOString() : null,
    added_by: i % 2 ? 'm2' : 'm1', created_at: new Date(now - (i + 1) * 86400000).toISOString(),
  }));
}

class DemoStore {
  demo = true;
  me = null; members = []; items = []; completions = [];
  xpTotals = {}; xpLog = []; rewards = [];
  calm = null;
  moods = [];
  moodPrivate = [];
  places = [];
  #db; #listeners = [];

  #read() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
    return seed();
  }
  #write() { try { localStorage.setItem(KEY, JSON.stringify(this.#db)); } catch {} }
  #sync() {
    this.members = this.#db.members; this.items = this.#db.items; this.completions = this.#db.completions;
    this.me = this.members.find((m) => m.id === this.#db.meId);
    this.xpTotals = {};
    for (const x of this.#db.xp_log) this.xpTotals[x.member_id] = (this.xpTotals[x.member_id] ?? 0) + x.xp;
    this.xpLog = [...this.#db.xp_log].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
    this.rewards = [...this.#db.rewards].sort((a, b) => a.level - b.level);
    this.calm = this.#db.calm && !this.#db.calm.ended_at ? this.#db.calm : null;
    if (!this.#db.moods) this.#db.moods = seedMoods();   // 예전 데모 데이터에 감정 기록 추가
    this.moods = this.#db.moods.filter((x) => x.member_id === this.me.id || x.shared);
    if (!this.#db.moodPrivate) this.#db.moodPrivate = seedPrivate();
    this.moodPrivate = this.#db.moodPrivate.filter((x) => x.member_id === this.me.id);
    if (!this.#db.diaries) this.#db.diaries = seedDiaries();
    if (!this.#db.bodyGoals) Object.assign(this.#db, seedBody());
    const canSee = (mid) => mid === this.me.id || this.#db.bodyGoals.find((g) => g.member_id === mid)?.shared;
    this.bodyGoals = this.#db.bodyGoals.filter((g) => canSee(g.member_id));
    this.bodyLogs = this.#db.bodyLogs.filter((l) => canSee(l.member_id)).sort((a, b) => a.day.localeCompare(b.day));
    this.diaries = this.#db.diaries.filter((x) => x.member_id === this.me.id || x.shared).sort((a, b) => b.day.localeCompare(a.day));
    if (!this.#db.places) this.#db.places = seedPlaces();
    this.places = [...this.#db.places].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async init() { this.#db = this.#read(); this.#sync(); return { needLogin: false }; }
  async signIn() { return { needLogin: false }; }
  async signOut() {}
  async load() { this.#sync(); }
  onChange(cb) { this.#listeners.push(cb); }

  async saveItem(item) {
    if (item.id) {
      const i = this.#db.items.findIndex((x) => x.id === item.id);
      this.#db.items[i] = { ...this.#db.items[i], ...item };
    } else {
      item = { ...item, id: uid(), created_by: this.me.id };
      this.#db.items.push(item);
    }
    this.#write(); this.#sync();
    return item;
  }
  async deleteItem(id) {
    this.#db.items = this.#db.items.filter((x) => x.id !== id);
    this.#db.completions = this.#db.completions.filter((c) => c.item_id !== id);
    for (const x of this.#db.xp_log) if (x.item_id === id) x.item_id = null; // 받은 경험치는 유지
    this.#write(); this.#sync();
  }
  // 서버의 award_xp / revoke_xp 트리거와 같은 규칙
  async toggle(itemId, date, done) {
    const item = this.#db.items.find((i) => i.id === itemId);
    this.#db.completions = this.#db.completions.filter((c) => !(c.item_id === itemId && c.occur_date === date));
    this.#db.xp_log = this.#db.xp_log.filter((x) => !(x.item_id === itemId && x.occur_date === date));
    if (done) {
      this.#db.completions.push({ item_id: itemId, occur_date: date, done_by: this.me.id });
      if (item?.kind === 'task') {
        this.#db.xp_log.push({ id: uid(), member_id: earnerOf(item, this.me.id), item_id: itemId, occur_date: date,
          title: item.title, xp: xpOf(item), quest_type: questType(item), created_at: new Date().toISOString() });
      }
    }
    this.#write(); this.#sync();
  }
  async saveReward(rw) {
    if (rw.id) Object.assign(this.#db.rewards.find((x) => x.id === rw.id), rw);
    else this.#db.rewards.push({ ...rw, id: uid(), created_by: this.me.id, claimed_at: null });
    this.#write(); this.#sync();
  }
  async deleteReward(id) { this.#db.rewards = this.#db.rewards.filter((x) => x.id !== id); this.#write(); this.#sync(); }
  async claimReward(id, claimed) {
    this.#db.rewards.find((x) => x.id === id).claimed_at = claimed ? new Date().toISOString() : null;
    this.#write(); this.#sync();
  }
  async startCalm({ minutes, message }) {
    const now = Date.now();
    this.#db.calm = { id: uid(), from_member: this.me.id, minutes, message, started_at: new Date(now).toISOString(),
      ends_at: new Date(now + minutes * 60000).toISOString(), accepted_at: null, ended_at: null, ended_by: null };
    this.#write(); this.#sync();
    return this.#db.calm;
  }
  async saveMood({ day, emoji, scores, note, shared, privateNote }) {
    this.#db.moods = this.#db.moods.filter((x) => !(x.member_id === this.me.id && x.day === day));
    this.#db.moods.push({ member_id: this.me.id, day, emoji, scores, note, shared });
    this.#db.moodPrivate = this.#db.moodPrivate.filter((x) => !(x.member_id === this.me.id && x.day === day));
    if (privateNote) this.#db.moodPrivate.push({ member_id: this.me.id, day, note: privateNote });
    this.#write(); this.#sync();
  }
  async deleteMood(day) {
    this.#db.moods = this.#db.moods.filter((x) => !(x.member_id === this.me.id && x.day === day));
    this.#db.moodPrivate = this.#db.moodPrivate.filter((x) => !(x.member_id === this.me.id && x.day === day));
    this.#write(); this.#sync();
  }
  async saveDiary({ day, body, shared }) {
    const old = this.#db.diaries.find((x) => x.member_id === this.me.id && x.day === day);
    this.#db.diaries = this.#db.diaries.filter((x) => x !== old);
    const now = new Date().toISOString();
    this.#db.diaries.push({ member_id: this.me.id, day, body, shared, created_at: old?.created_at ?? now, updated_at: now });
    this.#write(); this.#sync();
  }
  async deleteDiary(day) {
    this.#db.diaries = this.#db.diaries.filter((x) => !(x.member_id === this.me.id && x.day === day));
    this.#write(); this.#sync();
  }
  async saveBodyGoal(patch) {
    const g = this.#db.bodyGoals.find((x) => x.member_id === this.me.id);
    if (g) Object.assign(g, patch); else this.#db.bodyGoals.push({ member_id: this.me.id, target_weight: null, target_smm: null, shared: false, ...patch });
    this.#write(); this.#sync();
  }
  async saveBodyLog(row) {
    this.#db.bodyLogs = this.#db.bodyLogs.filter((x) => !(x.member_id === this.me.id && x.day === row.day));
    this.#db.bodyLogs.push({ member_id: this.me.id, weight: null, smm: null, fat_pct: null, note: null, ...row });
    this.#write(); this.#sync();
  }
  async deleteBodyLog(day) {
    this.#db.bodyLogs = this.#db.bodyLogs.filter((x) => !(x.member_id === this.me.id && x.day === day));
    this.#write(); this.#sync();
  }
  // 데모 검색: 예시 장소 목록에서 찾음
  async searchPlaces(query) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    const hit = DEMO_PLACES.filter((p) => words.every((w) => `${p.name} ${p.category} ${p.address}`.includes(w)));
    return { provider: 'demo', results: hit.slice(0, 10) };
  }
  async lookupPlaces() { return {}; }
  async addPlace(r) {
    if (this.#db.places.some((p) => p.source === r.source && p.source_id === r.source_id)) throw new Error('이미 갈 곳에 있어요');
    const p = { id: uid(), source: r.source, source_id: r.source_id, query: null, name: r.name, address: r.address, category: r.category,
      lat: r.lat, lng: r.lng, url: r.url, memo: null, tags: [], visited_at: null, added_by: this.me.id, created_at: new Date().toISOString() };
    this.#db.places.push(p); this.#write(); this.#sync();
    return p;
  }
  async addManualPlace({ name, address, memo, tags = [], lat = null, lng = null }) {
    const p = { id: uid(), source: 'manual', source_id: null, query: null, name, address, category: null, lat, lng, url: null,
      memo, tags, visited_at: null, added_by: this.me.id, created_at: new Date().toISOString() };
    this.#db.places.push(p); this.#write(); this.#sync();
    return p;
  }
  async updatePlace(id, patch) { Object.assign(this.#db.places.find((p) => p.id === id), patch); this.#write(); this.#sync(); }
  async deletePlace(id) {
    this.#db.places = this.#db.places.filter((p) => p.id !== id);
    for (const i of this.#db.items) if (i.place_id === id) i.place_id = null;
    this.#write(); this.#sync();
  }
  async acceptCalm() { this.#db.calm.accepted_at = new Date().toISOString(); this.#write(); this.#sync(); }
  async endCalm() { Object.assign(this.#db.calm, { ended_at: new Date().toISOString(), ended_by: this.me.id }); this.#write(); this.#sync(); }
  async updateMe(patch) { Object.assign(this.#db.members.find((m) => m.id === this.me.id), patch); this.#write(); this.#sync(); }
  async savePush() {}
  async callFn() { return { ok: true, demo: true }; }

  // 데모 전용
  switchUser() { this.#db.meId = this.#db.meId === 'm1' ? 'm2' : 'm1'; this.#write(); this.#sync(); }
  reset() { this.#db = seed(); this.#write(); this.#sync(); }
}

export const isConfigured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
export const createStore = () => (isConfigured() ? new SupabaseStore() : new DemoStore());
