// JOY 저장소: Supabase(실사용) 또는 이 기기(데모)
import { CONFIG } from './config.js';
import { DEFAULT_ACTIVITIES } from './data.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ Supabase
class SupabaseStore {
  demo = false;
  me = null; settings = null; activities = []; sessions = [];
  #sb;

  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.#sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
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
    const { data: m } = await this.#sb.from('members').select('id,name').eq('id', userId).maybeSingle();
    if (!m) { await this.#sb.auth.signOut(); throw new Error('등록되지 않은 계정이에요.'); }
    this.me = m;
    await this.load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.load().then(() => this.onChange?.()).catch(() => {}); });
    return { needLogin: false };
  }
  async signOut() { await this.#sb.auth.signOut(); }

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
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const [s, a, x] = await Promise.all([
      this.#sb.from('joy_settings').select('*').eq('member_id', this.me.id).maybeSingle(),
      this.#all(() => this.#sb.from('joy_activities').select('*').eq('member_id', this.me.id).order('sort').order('id')),
      this.#all(() => this.#sb.from('joy_sessions').select('*').eq('member_id', this.me.id).gte('created_at', since).order('created_at', { ascending: false }).order('id')),
    ]);
    if (s.error) throw new Error(s.error.message);
    this.settings = s.data; this.activities = a; this.sessions = x;
  }

  async saveSettings(patch) {
    const { data, error } = await this.#sb.from('joy_settings').upsert({ member_id: this.me.id, ...patch }).select().single();
    if (error) throw new Error(error.message);
    this.settings = data;
  }
  async seedActivities() {
    if (this.activities.length) return;
    const { error } = await this.#sb.from('joy_activities').insert(DEFAULT_ACTIVITIES.map((a) => ({ ...a, member_id: this.me.id })));
    if (error) throw new Error(error.message);
    await this.load();
  }
  async saveActivity(a) {
    const row = { ...a, member_id: this.me.id };
    delete row.created_at;
    const { error } = row.id
      ? await this.#sb.from('joy_activities').update(row).eq('id', row.id)
      : await this.#sb.from('joy_activities').insert(row);
    if (error) throw new Error(error.message);
    await this.load();
  }
  async deleteActivity(id) {
    const { error } = await this.#sb.from('joy_activities').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.load();
  }

  async createSession(s) {
    const { data, error } = await this.#sb.from('joy_sessions').insert({ ...s, member_id: this.me.id }).select().single();
    if (error) throw new Error(error.message);
    this.sessions.unshift(data);
    return data;
  }
  async updateSession(id, patch) {
    const local = this.sessions.find((s) => s.id === id);
    if (local) Object.assign(local, patch);
    const { error } = await this.#sb.from('joy_sessions').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // 다음 "Still having fun?" 시각 (null 이면 이번 연속 사용 중엔 다시 안 물음)
  async setNextCheck(minutes) {
    const next = minutes == null ? null : new Date(Date.now() + minutes * 60000).toISOString();
    await this.#sb.from('joy_usage').update({ next_check_at: next, updated_at: nowIso() }).eq('member_id', this.me.id);
  }
  async savePush(sub) {
    const { error } = await this.#sb.from('push_subs').upsert({ ...sub, member_id: this.me.id, app: 'joy' });
    if (error) throw new Error(error.message);
  }
  async callFn(body) {
    const { data, error } = await this.#sb.functions.invoke('push-tick', { body });
    if (error) throw new Error(error.message);
    return data;
  }
  hookUrl() { return `${CONFIG.SUPABASE_URL}/functions/v1/push-tick`; }
}

// ------------------------------------------------------------------ 데모 (이 기기에만)
const KEY = 'joy-demo-v1';

function demoSeed() {
  const activities = DEFAULT_ACTIVITIES.map((a) => ({ ...a, id: uid() }));
  const by = (n) => activities.find((a) => a.name === n);
  const sessions = [];
  const day = 86400000;
  const add = (dAgo, h, act, extra) => {
    const t = new Date(Date.now() - dAgo * day);
    t.setHours(h, 10, 0, 0);
    sessions.push({ id: uid(), created_at: t.toISOString(), trigger: 'help', usage_minutes: null, situation: 'lying', energy: 1, desire: 'fresh',
      suggested: [act.id], activity_id: act.id, activity_name: act.name, activity_emoji: act.emoji, transition_done: true,
      steps_done: act.steps.length, steps_total: act.steps.length, started: true, completed: true, finished_at: t.toISOString(), ...extra });
  };
  // 예시 기록: 샤워·차가운 물은 자주 성공, 홈요가는 잘 시작 못함
  [[1, 23, '샤워', 2], [2, 22, '차가운 물 마시기', 1], [3, 23, '샤워', 1], [4, 21, '강아지 쓰다듬기', 2], [5, 23, '샤워', 2],
   [6, 22, '차가운 물 마시기', 1], [7, 15, '커피 만들기', 1, 2, 'enjoy'], [8, 23, '책 1페이지 읽기', 0], [9, 22, '샤워', 1],
   [0, 13, '커피 만들기', 1, 2, 'enjoy'], [0, 9, '창문 열고 공기 쐬기', 1, 0, 'vent']]
    .forEach(([d, h, n, joy, energy = 1, desire = 'fresh']) => add(d, h, by(n), { joy, energy, desire, trigger: d % 3 ? 'help' : 'screen', usage_minutes: d % 3 ? null : 52 }));
  const yoga = by('간단한 홈요가');
  for (let i = 0; i < 4; i++) sessions.push({ id: uid(), created_at: new Date(Date.now() - (i + 2) * day).toISOString(), trigger: 'manual', energy: 3, desire: 'fresh',
    suggested: [yoga.id], activity_id: null, started: false, completed: false, steps_done: 0, steps_total: 0, joy: null });
  sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    settings: { trigger_apps: ['Instagram', 'YouTube'], trigger_minutes: 45, recheck_minutes: 30, hook_token: 'demo-token', onboarded: true },
    activities, sessions,
  };
}

class DemoStore {
  demo = true;
  me = { id: 'demo', name: '지윤' };
  settings = null; activities = []; sessions = [];
  #db;
  #read() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch {} return demoSeed(); }
  #write() { try { localStorage.setItem(KEY, JSON.stringify(this.#db)); } catch {} }
  #sync() { this.settings = this.#db.settings; this.activities = [...this.#db.activities].sort((a, b) => a.sort - b.sort); this.sessions = this.#db.sessions; }
  async init() { this.#db = this.#read(); this.#sync(); return { needLogin: false }; }
  async signIn() { return { needLogin: false }; }
  async signOut() {}
  async load() { this.#sync(); }
  async saveSettings(p) { this.#db.settings = { ...(this.#db.settings ?? {}), ...p }; this.#write(); this.#sync(); }
  async seedActivities() {}
  async saveActivity(a) {
    if (a.id) Object.assign(this.#db.activities.find((x) => x.id === a.id), a);
    else this.#db.activities.push({ ...a, id: uid(), sort: this.#db.activities.length });
    this.#write(); this.#sync();
  }
  async deleteActivity(id) { this.#db.activities = this.#db.activities.filter((a) => a.id !== id); this.#write(); this.#sync(); }
  async createSession(s) { const r = { id: uid(), created_at: nowIso(), suggested: [], steps_done: 0, steps_total: 0, started: false, completed: false, joy: null, ...s }; this.#db.sessions.unshift(r); this.#write(); this.#sync(); return r; }
  async updateSession(id, p) { Object.assign(this.#db.sessions.find((s) => s.id === id) ?? {}, p); this.#write(); }
  async setNextCheck() {}
  async savePush() {}
  async callFn() { return { ok: true, demo: true }; }
  hookUrl() { return 'https://(프로젝트).supabase.co/functions/v1/push-tick'; }
  reset() { this.#db = demoSeed(); this.#write(); this.#sync(); }
}

export const createStore = () => (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY ? new SupabaseStore() : new DemoStore());
