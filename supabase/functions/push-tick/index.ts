// 우리할일 — 알림 서버 함수 (Supabase Edge Function, 이름: push-tick)
//  - action "tick"  : pg_cron 이 매분 호출 → 아침 브리핑 / 저녁 리마인드 / 항목별 알림 발송
//  - action "notify": 앱이 호출 → 상대방에게 "추가했어요 / 완료했어요" 알림
//  - action "test"  : 앱이 호출 → 내 폰으로 테스트 알림
// 필요한 Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// 대시보드에서 "Verify JWT" (Enforce JWT verification) 는 끄세요. (함수가 직접 검사)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// 새 키 체계(SUPABASE_SECRET_KEYS, JSON) 우선, 없으면 기존 service_role 키
function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      const v = obj.default ?? Object.values(obj)[0];
      if (typeof v === "string" && v) return v;
    } catch { /* 아래로 */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// 시작 시 오류가 나도 함수가 죽지 않고 원인을 응답으로 돌려주도록 첫 요청 때 초기화
// deno-lint-ignore no-explicit-any
let db: any = null;
function init() {
  if (db) return;
  const env = {
    SUPABASE_URL, VAPID_PUBLIC_KEY: Deno.env.get("VAPID_PUBLIC_KEY"),
    VAPID_PRIVATE_KEY: Deno.env.get("VAPID_PRIVATE_KEY"), SERVICE_KEY: serviceKey(),
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error("missing env: " + missing.join(", "));
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  db = createClient(SUPABASE_URL, env.SERVICE_KEY, { auth: { persistSession: false } });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- 날짜 계산 (web/js/schedule.js 와 동일 규칙)
type Item = {
  id: string; kind: "task" | "event"; title: string; owner: string | null;
  start_date: string; time: string | null; end_date: string | null;
  repeat: "none" | "daily" | "weekly" | "monthly"; weekdays: number[];
  remind_before: number | null; nag_every: number;
};
type Completion = { item_id: string; occur_date: string };
type Member = { id: string; name: string; brief_time: string; nag_time: string };

const DAY = 86400000;
const parseD = (s: string) => new Date(s + "T00:00:00Z");
const fmtD = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => fmtD(new Date(parseD(s).getTime() + n * DAY));
const dow = (s: string) => parseD(s).getUTCDay();
const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function nowKST(ms = Date.now()) {
  const k = new Date(ms + 9 * 3600000);
  return { date: fmtD(k), min: k.getUTCHours() * 60 + k.getUTCMinutes() };
}
function daysInMonth(s: string) {
  const d = parseD(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}
function occursOn(item: Item, date: string) {
  if (date < item.start_date) return false;
  if (item.end_date && date > item.end_date) return false;
  switch (item.repeat) {
    case "daily": return true;
    case "weekly": {
      const days = item.weekdays?.length ? item.weekdays : [dow(item.start_date)];
      return days.includes(dow(date));
    }
    case "monthly": {
      const want = Number(item.start_date.slice(8, 10));
      return Number(date.slice(8, 10)) === Math.min(want, daysInMonth(date));
    }
    default: return date === item.start_date;
  }
}
const isDone = (cs: Completion[], id: string, date: string) =>
  cs.some((c) => c.item_id === id && c.occur_date === date);
function fireTimes(item: Item) {
  const t = toMin(item.time);
  if (t == null || item.remind_before == null) return [];
  const out: number[] = [];
  if (t - item.remind_before >= 0) out.push(t - item.remind_before);
  if (item.kind === "task" && item.nag_every > 0) {
    for (let m = t + item.nag_every; m < 1440; m += item.nag_every) out.push(m);
  }
  return out;
}
function fireSlots(item: Item, fireDate: string) {
  const slots: { occur: string; min: number }[] = [];
  if (occursOn(item, fireDate)) for (const m of fireTimes(item)) slots.push({ occur: fireDate, min: m });
  const t = toMin(item.time);
  if (t != null && item.remind_before != null && t - item.remind_before < 0) {
    const ahead = Math.ceil((item.remind_before - t) / 1440);
    for (let k = 1; k <= ahead; k++) {
      const occ = addDays(fireDate, k);
      const m = t - item.remind_before + k * 1440;
      if (m >= 0 && m < 1440 && occursOn(item, occ)) slots.push({ occur: occ, min: m });
    }
  }
  return slots;
}
const relevant = (item: Item, memberId: string) => item.owner === null || item.owner === memberId;
const when = (item: Item) => (item.time ? item.time.slice(0, 5) : "");
function beforeLabel(min: number) {
  if (min === 0) return "지금";
  if (min % 1440 === 0) return `${min / 1440}일 뒤`;
  if (min % 60 === 0) return `${min / 60}시간 뒤`;
  return `${min}분 뒤`;
}

// ---------------------------------------------------------------- 발송
type Payload = { title: string; body: string; tag?: string; url?: string };

async function sendTo(memberId: string, payload: Payload) {
  const { data: subs } = await db.from("push_subs").select("*").eq("member_id", memberId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ url: "./", ...payload }),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push fail", code, (e as Error).message);
    }
  }
  return sent;
}

// 같은 알림이 두 번 가지 않도록 먼저 기록 (이미 있으면 false)
async function claim(key: string) {
  const { error } = await db.from("sent_log").insert({ key });
  return !error;
}

// ---------------------------------------------------------------- tick
async function tick() {
  const now = nowKST();
  const inWindow = (m: number) => m <= now.min && m > now.min - 10; // 최근 10분 (누락 대비)

  const [{ data: members }, { data: items }, { data: comps }] = await Promise.all([
    db.from("members").select("id,name,brief_time,nag_time"),
    db.from("items").select("*"),
    db.from("completions").select("item_id,occur_date").gte("occur_date", addDays(now.date, -90)),
  ]);
  const M = (members ?? []) as Member[];
  const I = (items ?? []) as Item[];
  const C = (comps ?? []) as Completion[];
  const log: string[] = [];

  const todayFor = (mid: string) =>
    I.filter((i) => relevant(i, mid) && occursOn(i, now.date))
      .sort((a, b) => (toMin(a.time) ?? 9999) - (toMin(b.time) ?? 9999));
  const overdueFor = (mid: string) =>
    I.filter((i) => relevant(i, mid) && i.kind === "task" && i.repeat === "none" &&
      i.start_date < now.date && !isDone(C, i.id, i.start_date));

  for (const m of M) {
    // 1) 아침 브리핑
    const b = toMin(m.brief_time);
    if (b != null && inWindow(b) && (await claim(`brief:${m.id}:${now.date}`))) {
      const list = todayFor(m.id);
      const od = overdueFor(m.id);
      const tasks = list.filter((i) => i.kind === "task").length;
      const events = list.length - tasks;
      const lines = list.slice(0, 6).map((i) => `${i.kind === "event" ? "📅" : "☐"} ${when(i)} ${i.title}`.replace("  ", " "));
      if (list.length > 6) lines.push(`외 ${list.length - 6}개`);
      if (od.length) lines.push(`⚠️ 밀린 할일 ${od.length}개`);
      await sendTo(m.id, {
        title: list.length ? `${m.name}님, 오늘 할일 ${tasks} · 약속 ${events}` : `${m.name}님, 오늘은 일정이 없어요`,
        body: lines.join("\n") || "여유로운 하루 보내세요 🙂",
        tag: "brief",
      });
      log.push(`brief ${m.name}`);
    }

    // 2) 저녁 미완료 리마인드
    const n = toMin(m.nag_time);
    if (n != null && inWindow(n) && (await claim(`nag:${m.id}:${now.date}`))) {
      const left = todayFor(m.id).filter((i) => i.kind === "task" && !isDone(C, i.id, now.date));
      const od = overdueFor(m.id);
      if (left.length + od.length > 0) {
        const lines = [...left, ...od].slice(0, 6).map((i) => `☐ ${i.title}`);
        await sendTo(m.id, { title: `아직 못 끝낸 할일 ${left.length + od.length}개`, body: lines.join("\n"), tag: "nag" });
        log.push(`nag ${m.name}`);
      }
    }
  }

  // 3) 항목별 알림
  for (const item of I) {
    for (const s of fireSlots(item, now.date)) {
      if (!inWindow(s.min)) continue;
      if (isDone(C, item.id, s.occur)) continue;
      if (!(await claim(`item:${item.id}:${s.occur}:${s.min}`))) continue;
      const targets = M.filter((m) => relevant(item, m.id));
      const t = toMin(item.time)!;
      const diff = t - s.min + (s.occur > now.date ? 1440 * Math.round((parseD(s.occur).getTime() - parseD(now.date).getTime()) / DAY) : 0);
      const isNag = item.kind === "task" && s.min > t;
      const who = item.owner === null ? "[공통] " : "";
      const payload: Payload = item.kind === "event"
        ? { title: `📅 ${who}${item.title}`, body: `${beforeLabel(diff)} · ${s.occur.slice(5).replace("-", "/")} ${when(item)}`, tag: `i-${item.id}` }
        : { title: `${isNag ? "🔁 아직이에요: " : "⏰ "}${who}${item.title}`, body: isNag ? "완료하면 알림이 멈춰요" : `${hhmm(t)} 할일 시간이에요`, tag: `i-${item.id}` };
      for (const m of targets) await sendTo(m.id, payload);
      log.push(`item ${item.title} @${hhmm(s.min)}`);
    }
  }

  // 4) 오래된 발송 기록 정리 (매일 03시)
  if (now.min === 180) {
    await db.from("sent_log").delete().lt("sent_at", new Date(Date.now() - 3 * DAY).toISOString());
  }
  return { ok: true, kst: `${now.date} ${hhmm(now.min)}`, sent: log };
}

// ---------------------------------------------------------------- 앱에서 호출
async function fromApp(req: Request, body: Record<string, string>) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: members } = await db.from("members").select("id,name");
  const me = (members ?? []).find((m) => m.id === user.id);
  if (!me) return json({ error: "not a member" }, 403);

  if (body.action === "test") {
    const n = await sendTo(me.id, { title: "🔔 테스트 알림", body: "알림이 잘 오고 있어요!", tag: "test" });
    return json({ ok: true, sent: n });
  }

  if (body.action === "notify") {
    const { data: item } = await db.from("items").select("*").eq("id", body.item_id).single();
    if (!item) return json({ error: "no item" }, 404);
    let sent = 0;
    for (const p of (members ?? []).filter((m) => m.id !== me.id && relevant(item as Item, m.id))) {
      const kindKo = item.kind === "event" ? "약속" : "할일";
      const date = `${item.start_date.slice(5).replace("-", "/")} ${when(item as Item)}`.trim();
      const payload: Payload = body.verb === "done"
        ? { title: `✅ ${me.name}님이 완료했어요`, body: item.title, tag: `done-${item.id}` }
        : { title: `${me.name}님이 ${item.owner === null ? "공통 " : ""}${kindKo}을 추가했어요`, body: `${item.title} · ${date}`, tag: `add-${item.id}` };
      sent += await sendTo(p.id, payload);
    }
    return json({ ok: true, sent });
  }
  return json({ error: "unknown action" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    init();
    const body = await req.json().catch(() => ({}));
    if (body.action === "tick") {
      if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
      return json(await tick());
    }
    return await fromApp(req, body);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
