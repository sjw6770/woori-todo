// PAUSE 저장소: Supabase(실사용) 또는 이 기기(데모 — 탭 두 개로 두 사람 흉내)
import { CONFIG } from './config.js';
import { DEFAULT_RULES } from './data.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const nowIso = () => new Date().toISOString();
const DAY = 86400000;

class Base {
  me = null; members = []; profiles = {}; rules = []; commitments = [];
  open = null;                 // 진행 중인 PAUSE
  sessions = []; checks = []; closings = [];   // 지난 기록 + 진행 중 (최근 1년)
  messages = []; privates = [];                // 진행 중인 PAUSE 의 말, 내 비공개 메모
  onChange = null;
  get partner() { return this.members.find((m) => m.id !== this.me?.id) ?? null; }
}

// ------------------------------------------------------------------ Supabase
class SupabaseStore extends Base {
  demo = false;
  #sb; #ch = null;

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
    const { data: ms, error } = await this.#sb.from('members').select('id,name,color').order('created_at');
    if (error) throw new Error(error.message);
    const me = ms.find((m) => m.id === userId);
    if (!me) { await this.#sb.auth.signOut(); throw new Error('등록되지 않은 계정이에요.'); }
    this.me = me; this.members = ms;
    await this.load();
    this.#subscribe();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.#reload(); });
    return { needLogin: false };
  }
  async signOut() { await this.#sb.auth.signOut(); }

  #subscribe() {
    let t;
    const reload = () => { clearTimeout(t); t = setTimeout(() => this.#reload(), 250); };
    const ch = this.#sb.channel('pause');
    for (const table of ['pause_sessions', 'pause_checks', 'pause_messages', 'pause_commitments', 'pause_closings', 'pause_rules', 'pause_profiles']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload);
    }
    this.#ch = ch.subscribe();
  }
  #reload() { return this.load().then(() => this.onChange?.()).catch(() => {}); }

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
    const since = new Date(Date.now() - 365 * DAY).toISOString();
    const [pf, rl, cm, ss] = await Promise.all([
      this.#sb.from('pause_profiles').select('*'),
      this.#sb.from('pause_rules').select('*').order('sort').order('created_at'),
      this.#sb.from('pause_commitments').select('*').order('created_at', { ascending: false }).limit(200),
      this.#all(() => this.#sb.from('pause_sessions').select('*').gte('started_at', since).order('started_at', { ascending: false }).order('id')),
    ]);
    for (const r of [pf, rl, cm]) if (r.error) throw new Error(r.error.message);
    this.profiles = Object.fromEntries(pf.data.map((p) => [p.member_id, p]));
    this.rules = rl.data; this.commitments = cm.data; this.sessions = ss;
    this.open = ss.find((s) => !s.closed_at) ?? null;
    const ids = ss.map((s) => s.id);
    const [ck, cl] = ids.length ? await Promise.all([
      this.#all(() => this.#sb.from('pause_checks').select('*').in('session_id', ids).order('created_at').order('id')),
      this.#all(() => this.#sb.from('pause_closings').select('*').in('session_id', ids).order('created_at').order('member_id')),
    ]) : [[], []];
    this.checks = ck; this.closings = cl;
    if (this.open) {
      const [ms, pv] = await Promise.all([
        this.#sb.from('pause_messages').select('*').eq('session_id', this.open.id).order('created_at').order('id'),
        this.#sb.from('pause_private').select('*').eq('session_id', this.open.id).order('created_at'),
      ]);
      this.messages = ms.data ?? []; this.privates = pv.data ?? [];
    } else { this.messages = []; this.privates = []; }
  }
  async #q(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }

  async saveProfile(patch) { await this.#q(this.#sb.from('pause_profiles').upsert({ member_id: this.me.id, ...patch, updated_at: nowIso() })); await this.load(); }
  async addRule(text) { await this.#q(this.#sb.from('pause_rules').insert({ text, sort: this.rules.length + 1 })); await this.load(); }
  async deleteRule(id) { await this.#q(this.#sb.from('pause_rules').delete().eq('id', id)); await this.load(); }
  async agreeRule(id, yes) { await this.#q(this.#sb.rpc('pause_rule_agree', { rid: id, yes })); await this.load(); }

  // 이미 진행 중인 게 있으면 그걸로 (둘이 동시에 눌러도 하나)
  async startPause() {
    const { data, error } = await this.#sb.from('pause_sessions').insert({}).select().single();
    if (error && error.code !== '23505') throw new Error(error.message);
    await this.load();
    return { session: this.open, created: Boolean(data) };
  }
  async addCheck(c) { await this.#q(this.#sb.from('pause_checks').upsert({ session_id: this.open.id, member_id: this.me.id, ...c }, { onConflict: 'session_id,member_id,round' })); await this.load(); }
  async addPrivate(p) { await this.#q(this.#sb.from('pause_private').insert({ session_id: this.open.id, ...p })); await this.load(); }
  async setPhase(phase) { await this.#q(this.#sb.from('pause_sessions').update({ phase }).eq('id', this.open.id)); await this.load(); }
  async extend() { await this.#q(this.#sb.from('pause_sessions').update({ extensions: this.open.extensions + 1 }).eq('id', this.open.id)); await this.load(); }
  async send(m) { await this.#q(this.#sb.from('pause_messages').insert({ session_id: this.open.id, ...m })); await this.load(); }
  async voteEnd() { await this.#q(this.#sb.rpc('pause_vote_end', { sid: this.open.id })); await this.load(); }
  async closeNow() { await this.#q(this.#sb.from('pause_sessions').update({ phase: 'closed' }).eq('id', this.open.id)); await this.load(); }
  async saveClosing(c) { await this.#q(this.#sb.from('pause_closings').upsert({ session_id: this.open.id, member_id: this.me.id, ...c })); await this.load(); }
  async addCommitment(c) { await this.#q(this.#sb.from('pause_commitments').insert({ session_id: this.open?.id ?? null, ...c })); await this.load(); }
  async updateCommitment(id, patch) { await this.#q(this.#sb.from('pause_commitments').update(patch).eq('id', id)); await this.load(); }

  async notify(event, extra = {}) {
    if (!this.open) return;
    try { await this.callFn({ action: 'pause', event, session_id: this.open.id, ...extra }); } catch {}
  }
  async savePush(sub) { await this.#q(this.#sb.from('push_subs').upsert({ ...sub, member_id: this.me.id, app: 'pause' })); }
  async callFn(body) {
    const { data, error } = await this.#sb.functions.invoke('push-tick', { body });
    if (error) throw new Error(error.message);
    return data;
  }
}

// ------------------------------------------------------------------ 데모 (이 기기에만)
// 같은 브라우저에서 탭 두 개를 열고 한쪽을 '지윤'으로 바꾸면 두 사람처럼 주고받을 수 있음
const KEY = 'pause-demo-v1';
const ME_KEY = 'pause-demo-me';

function demoSeed() {
  const members = [{ id: 'm1', name: '종원', color: '#3b6fd8' }, { id: 'm2', name: '지윤', color: '#e0607e' }];
  const t = (dAgo, h, m = 0) => { const d = new Date(Date.now() - dAgo * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const plus = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();
  const sessions = [], checks = [], closings = [], commitments = [];
  // 예시 기록: 회복 시간이 점점 짧아짐
  [[41, 23, 9, 7, [6, 5], [4, 3], 52, ['비판받는 느낌'], [{ who: 'm1', rule: '인격모독' }]],
   [27, 22, 8, 8, [5, 5], [3, 3], 38, ['답을 못 들음'], []],
   [12, 21, 9, 7, [6, 4], [3, 3], 27, ['비판받는 느낌', '말투'], []],
   [3, 20, 7, 6, [4, 3], null, 19, ['결혼 준비'], []]]
    .forEach(([d, h, a0, b0, r1, r2, mins, trig, broke], i) => {
      const id = `s${i}`, st = t(d, h);
      sessions.push({ id, started_by: i % 2 ? 'm1' : 'm2', started_at: st, cool_until: plus(st, 15), extensions: r2 ? 1 : 0, phase: 'closed',
        talk_at: plus(st, r2 ? 26 : 16), red_at: null, red_by: null, end_votes: ['m1', 'm2'], closed_at: plus(st, mins) });
      const ck = (mid, round, v, min) => checks.push({ id: uid(), session_id: id, member_id: mid, round, intensity: v, can_listen: round ? (v <= 4 ? 'yes' : 'unsure') : null, red: false, created_at: plus(st, min) });
      ck('m1', 0, a0, 0); ck('m2', 0, b0, 1); ck('m1', 1, r1[0], 15); ck('m2', 1, r1[1], 15);
      if (r2) { ck('m1', 2, r2[0], 25); ck('m2', 2, r2[1], 25); }
      closings.push({ session_id: id, member_id: 'm1', triggers: trig, broke: broke.filter((b) => b.who === 'm1').map((b) => b.rule), created_at: plus(st, mins) });
      closings.push({ session_id: id, member_id: 'm2', triggers: [], broke: [], created_at: plus(st, mins) });
    });
  commitments.push(
    { id: uid(), session_id: 's0', member_id: 'm1', wrong: '화난 것 자체가 아니라 혐오스럽다고 말한 것', next_action: '분노 6이 되면 PAUSE 누르기', active: true, created_at: t(41, 23, 50) },
    { id: uid(), session_id: 's0', member_id: 'm2', wrong: '종원이 멈추고 싶다고 했는데 계속 답을 요구한 것', next_action: 'PAUSE 후 15분 동안 추가 질문하지 않기', active: true, created_at: t(41, 23, 51) },
  );
  return {
    members,
    profiles: {
      m1: { member_id: 'm1', style: 'heat', signals: ['말투가 공격적으로 변함', '몸에 열이 남', '같은 말을 반복함'], safety_contacts: [{ name: '형', phone: '010-0000-0000' }], safety_place: '아파트 앞 공원 벤치', safety_note: '' },
      m2: { member_id: 'm2', style: 'chase', signals: ['답을 당장 받아내고 싶음', '계속 질문함'], safety_contacts: [], safety_place: '', safety_note: '' },
    },
    rules: DEFAULT_RULES.map((text, i) => ({ id: `r${i}`, text, created_by: null, agreed: i < 5 ? ['m1', 'm2'] : ['m1'], sort: i + 1, created_at: t(60, 12) })),
    sessions, checks, closings, commitments, messages: [], privates: [],
  };
}

class DemoStore extends Base {
  demo = true;
  #db;
  #read() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch {} return demoSeed(); }
  #write() { try { localStorage.setItem(KEY, JSON.stringify(this.#db)); } catch {} }
  #meId() { try { return sessionStorage.getItem(ME_KEY) || new URLSearchParams(location.search).get('as') || 'm1'; } catch { return 'm1'; } }
  #sync() {
    const db = this.#db;
    this.members = db.members; this.me = db.members.find((m) => m.id === this.#meId()) ?? db.members[0];
    this.profiles = db.profiles; this.rules = [...db.rules].sort((a, b) => a.sort - b.sort);
    this.commitments = [...db.commitments].sort((a, b) => b.created_at.localeCompare(a.created_at));
    this.sessions = [...db.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
    this.open = this.sessions.find((s) => !s.closed_at) ?? null;
    this.checks = db.checks; this.closings = db.closings;
    this.messages = this.open ? db.messages.filter((m) => m.session_id === this.open.id) : [];
    this.privates = this.open ? db.privates.filter((p) => p.session_id === this.open.id && p.member_id === this.me.id) : [];
  }
  #save() { this.#write(); this.#sync(); }
  async init() {
    this.#db = this.#read(); this.#sync();
    // 다른 탭(상대 역할)에서 바뀌면 다시 그림
    window.addEventListener('storage', (e) => { if (e.key === KEY) { this.#db = this.#read(); this.#sync(); this.onChange?.(); } });
    return { needLogin: false };
  }
  async signIn() { return { needLogin: false }; }
  async signOut() {}
  async load() { this.#db = this.#read(); this.#sync(); }
  switchMe() { try { sessionStorage.setItem(ME_KEY, this.me.id === 'm1' ? 'm2' : 'm1'); } catch {} this.#sync(); }
  reset() { this.#db = demoSeed(); this.#save(); }

  async saveProfile(patch) { this.#db.profiles[this.me.id] = { ...(this.#db.profiles[this.me.id] ?? { member_id: this.me.id, style: 'heat', signals: [], safety_contacts: [] }), ...patch }; this.#save(); }
  async addRule(text) { this.#db.rules.push({ id: uid(), text, created_by: this.me.id, agreed: [], sort: this.#db.rules.length + 1, created_at: nowIso() }); this.#save(); }
  async deleteRule(id) { this.#db.rules = this.#db.rules.filter((r) => r.id !== id); this.#save(); }
  async agreeRule(id, yes) { const r = this.#db.rules.find((x) => x.id === id); r.agreed = yes ? [...new Set([...r.agreed, this.me.id])] : r.agreed.filter((x) => x !== this.me.id); this.#save(); }

  async startPause() {
    this.#db = this.#read();
    const cur = this.#db.sessions.find((s) => !s.closed_at);
    if (cur) { this.#sync(); return { session: cur, created: false }; }
    const now = Date.now();
    this.#db.sessions.push({ id: uid(), started_by: this.me.id, started_at: new Date(now).toISOString(), cool_until: new Date(now + 15 * 60000).toISOString(),
      extensions: 0, phase: 'cool', talk_at: null, red_at: null, red_by: null, end_votes: [], closed_at: null });
    this.#save();
    return { session: this.open, created: true };
  }
  #cur() { this.#db = this.#read(); return this.#db.sessions.find((s) => s.id === this.open?.id); }
  async addCheck(c) {
    this.#db = this.#read();
    this.#db.checks = this.#db.checks.filter((x) => !(x.session_id === this.open.id && x.member_id === this.me.id && x.round === c.round));
    this.#db.checks.push({ id: uid(), session_id: this.open.id, member_id: this.me.id, can_listen: null, red: false, created_at: nowIso(), ...c });
    this.#save();
  }
  async addPrivate(p) { this.#db = this.#read(); this.#db.privates.push({ id: uid(), session_id: this.open.id, member_id: this.me.id, body: null, items: [], created_at: nowIso(), ...p }); this.#save(); }
  async setPhase(phase) {
    const s = this.#cur(); if (!s || s.closed_at) return;
    if (s.phase === 'red' && !['red', 'closed'].includes(phase)) phase = 'red';
    if (phase === 'red' && s.phase !== 'red') { s.red_at = nowIso(); s.red_by = this.me.id; }
    if (phase === 'talk' && !s.talk_at) s.talk_at = nowIso();
    if (phase === 'closed') s.closed_at = nowIso();
    s.phase = phase; this.#save();
  }
  async extend() { const s = this.#cur(); s.extensions++; s.cool_until = new Date(Date.now() + 10 * 60000).toISOString(); if (s.phase !== 'red') s.phase = 'cool'; this.#save(); }
  async send(m) { this.#db = this.#read(); this.#db.messages.push({ id: uid(), session_id: this.open.id, from_member: this.me.id, body: null, ack: null, created_at: nowIso(), ...m }); this.#save(); }
  async voteEnd() {
    const s = this.#cur();
    s.end_votes = [...new Set([...s.end_votes, this.me.id])];
    if (s.end_votes.length >= this.#db.members.length) { s.phase = 'closed'; s.closed_at = nowIso(); }
    this.#save();
  }
  async closeNow() { await this.setPhase('closed'); }
  async saveClosing(c) {
    this.#db = this.#read();
    this.#db.closings = this.#db.closings.filter((x) => !(x.session_id === this.open.id && x.member_id === this.me.id));
    this.#db.closings.push({ session_id: this.open.id, member_id: this.me.id, triggers: [], broke: [], created_at: nowIso(), ...c });
    this.#save();
  }
  async addCommitment(c) { this.#db = this.#read(); this.#db.commitments.push({ id: uid(), session_id: this.open?.id ?? null, member_id: this.me.id, wrong: null, active: true, created_at: nowIso(), ...c }); this.#save(); }
  async updateCommitment(id, patch) { this.#db = this.#read(); Object.assign(this.#db.commitments.find((c) => c.id === id), patch); this.#save(); }
  // 데모 전용: 진정 시간 건너뛰기
  async skipTimer() { const s = this.#cur(); s.cool_until = new Date(Date.now() - 1000).toISOString(); this.#save(); }

  async notify() {}
  async savePush() {}
  async callFn() { return { ok: true, demo: true }; }
}

export const createStore = () => (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY ? new SupabaseStore() : new DemoStore());
