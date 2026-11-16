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
    const [m, items, comps, quest, calm] = await Promise.all([
      this.#sb.from('members').select('*').order('created_at'),
      this.#all(() => this.#sb.from('items').select('*').order('start_date').order('id')),
      this.#all(() => this.#sb.from('completions').select('*').gte('occur_date', since).order('occur_date').order('item_id')),
      this.#loadQuest(),
      this.#sb.from('calm_sessions').select('*').is('ended_at', null).order('started_at', { ascending: false }).limit(1),
    ]);
    if (m.error) throw new Error(m.error.message);
    this.members = m.data; this.items = items; this.completions = comps;
    Object.assign(this, quest);
    this.calm = calm.error ? null : calm.data[0] ?? null;
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
const KEY = 'woori-demo-v2';

function seed() {
  const d = nowKST().date;
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  const members = [
    { id: 'm1', name: '종원', color: '#3b6fd8', brief_time: '08:00', nag_time: '21:00' },
    { id: 'm2', name: '지윤', color: '#e0607e', brief_time: '07:30', nag_time: '21:30' },
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
  return { members, items, completions, xp_log, rewards, meId: 'm1' };
}

class DemoStore {
  demo = true;
  me = null; members = []; items = []; completions = [];
  xpTotals = {}; xpLog = []; rewards = [];
  calm = null;
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
