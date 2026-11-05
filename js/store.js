// 데이터 저장소: Supabase(실사용) 또는 localStorage(데모)
import { CONFIG } from './config.js';
import { nowKST, addDays } from './schedule.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ------------------------------------------------------------------ Supabase
class SupabaseStore {
  demo = false;
  me = null; members = []; items = []; completions = [];
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

  async load() {
    const since = addDays(nowKST().date, -120);
    const [m, i, c] = await Promise.all([
      this.#sb.from('members').select('*').order('created_at'),
      this.#sb.from('items').select('*').order('start_date'),
      this.#sb.from('completions').select('*').gte('occur_date', since),
    ]);
    for (const r of [m, i, c]) if (r.error) throw new Error(r.error.message);
    this.members = m.data; this.items = i.data; this.completions = c.data;
    if (this.me) this.me = this.members.find((x) => x.id === this.me.id);
  }

  #subscribe() {
    let t;
    const reload = () => { clearTimeout(t); t = setTimeout(async () => { await this.load(); this.#emit(); }, 250); };
    this.#channel = this.#sb.channel('woori')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, reload)
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
const KEY = 'woori-demo-v1';

function seed() {
  const d = nowKST().date;
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  const members = [
    { id: 'm1', name: '종원', color: '#3b6fd8', brief_time: '08:00', nag_time: '21:00' },
    { id: 'm2', name: '지윤', color: '#e0607e', brief_time: '07:30', nag_time: '21:30' },
  ];
  const base = { note: '', end_date: null, weekdays: [], nag_every: 0, created_by: 'm1' };
  const items = [
    { ...base, id: uid(), kind: 'task', title: '분리수거 내놓기', owner: null, start_date: d, time: '20:00', repeat: 'weekly', weekdays: [wd, (wd + 3) % 7], remind_before: 0, nag_every: 60 },
    { ...base, id: uid(), kind: 'event', title: '웨딩홀 2차 상담', owner: null, start_date: addDays(d, 2), time: '14:00', repeat: 'none', remind_before: 1440, note: '견적서 출력해서 가기' },
    { ...base, id: uid(), kind: 'task', title: '비타민 챙겨 먹기', owner: 'm2', start_date: d, time: '09:00', repeat: 'daily', remind_before: 0, created_by: 'm2' },
    { ...base, id: uid(), kind: 'task', title: '세탁소에서 정장 찾기', owner: 'm1', start_date: addDays(d, -1), time: null, repeat: 'none', remind_before: null },
    { ...base, id: uid(), kind: 'task', title: '청첩장 시안 피드백 보내기', owner: 'm1', start_date: d, time: '12:30', repeat: 'none', remind_before: 0 },
    { ...base, id: uid(), kind: 'event', title: '저녁 데이트', owner: null, start_date: d, time: '19:00', repeat: 'none', remind_before: 60, note: '해방촌' },
    { ...base, id: uid(), kind: 'task', title: '관리비 이체', owner: 'm2', start_date: addDays(d, 5), time: '10:00', repeat: 'monthly', remind_before: 0, created_by: 'm2' },
    { ...base, id: uid(), kind: 'task', title: '장보기 (우유, 계란)', owner: null, start_date: d, time: null, repeat: 'none', remind_before: null, created_by: 'm2' },
  ];
  const completions = [{ item_id: items[2].id, occur_date: d, done_by: 'm2' }];
  return { members, items, completions, meId: 'm1' };
}

class DemoStore {
  demo = true;
  me = null; members = []; items = []; completions = [];
  #db; #listeners = [];

  #read() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
    return seed();
  }
  #write() { try { localStorage.setItem(KEY, JSON.stringify(this.#db)); } catch {} }
  #sync() {
    this.members = this.#db.members; this.items = this.#db.items; this.completions = this.#db.completions;
    this.me = this.members.find((m) => m.id === this.#db.meId);
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
    this.#write(); this.#sync();
  }
  async toggle(itemId, date, done) {
    this.#db.completions = this.#db.completions.filter((c) => !(c.item_id === itemId && c.occur_date === date));
    if (done) this.#db.completions.push({ item_id: itemId, occur_date: date, done_by: this.me.id });
    this.#write(); this.#sync();
  }
  async updateMe(patch) { Object.assign(this.#db.members.find((m) => m.id === this.me.id), patch); this.#write(); this.#sync(); }
  async savePush() {}
  async callFn() { return { ok: true, demo: true }; }

  // 데모 전용
  switchUser() { this.#db.meId = this.#db.meId === 'm1' ? 'm2' : 'm1'; this.#write(); this.#sync(); }
  reset() { this.#db = seed(); this.#write(); this.#sync(); }
}

export const isConfigured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
export const createStore = () => (isConfigured() ? new SupabaseStore() : new DemoStore());
