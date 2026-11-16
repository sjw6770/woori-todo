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
// ---------------------------------------------------------------- 장소 검색
const KAKAO_KEY = Deno.env.get("KAKAO_REST_KEY") ?? "";
type PlaceResult = {
  source: "kakao" | "osm"; source_id: string | null; name: string; category: string;
  address: string; phone?: string; lat: number; lng: number; url: string;
};

async function kakaoGet(path: string, params: Record<string, string>) {
  const res = await fetch(`https://dapi.kakao.com${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  if (!res.ok) throw new Error(`kakao ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
// deno-lint-ignore no-explicit-any
const kakaoPlace = (d: any): PlaceResult => ({
  source: "kakao", source_id: String(d.id), name: d.place_name,
  category: d.category_group_name || String(d.category_name ?? "").split(">").pop()!.trim(),
  address: d.road_address_name || d.address_name, phone: d.phone || undefined,
  lat: Number(d.y), lng: Number(d.x), url: d.place_url,
});
async function kakaoKeyword(q: string, page = 1) {
  const j = await kakaoGet("/v2/local/search/keyword.json", { query: q, page: String(page), size: "15" });
  return { results: (j.documents ?? []).map(kakaoPlace) as PlaceResult[], end: Boolean(j.meta?.is_end) };
}
async function kakaoAddress(q: string) {
  const j = await kakaoGet("/v2/local/search/address.json", { query: q, size: "10" });
  // deno-lint-ignore no-explicit-any
  return (j.documents ?? []).map((d: any): PlaceResult => ({
    source: "kakao", source_id: null, name: d.road_address?.building_name || d.address_name, category: "주소",
    address: d.road_address?.address_name || d.address_name, lat: Number(d.y), lng: Number(d.x),
    url: `https://map.kakao.com/link/map/${encodeURIComponent(d.address_name)},${d.y},${d.x}`,
  }));
}
async function kakaoSearch(q: string) {
  const { results } = await kakaoKeyword(q);
  return results.length ? results : await kakaoAddress(q);
}

// OSM 분류 → 한국어
const OSM_KO: Record<string, string> = {
  cafe: "카페", restaurant: "음식점", fast_food: "패스트푸드", bar: "술집", pub: "술집", bakery: "베이커리",
  ice_cream: "디저트", park: "공원", garden: "정원", museum: "박물관", gallery: "미술관", attraction: "명소",
  viewpoint: "전망대", tower: "타워", hotel: "숙소", guest_house: "숙소", motel: "숙소", cinema: "영화관",
  theatre: "공연장", mall: "쇼핑몰", department_store: "백화점", supermarket: "마트", convenience: "편의점",
  marketplace: "시장", palace: "궁궐", castle: "성", monument: "기념물", memorial: "기념물", zoo: "동물원",
  aquarium: "아쿠아리움", theme_park: "테마파크", beach: "해변", peak: "산", station: "역", hospital: "병원",
  library: "도서관", university: "대학교", school: "학교", place_of_worship: "종교시설", hairdresser: "미용실",
  clothes: "옷가게", books: "서점", street: "길", residential: "길", tertiary: "길", secondary: "길", primary: "길",
  city: "도시", town: "읍", village: "마을", suburb: "동네", neighbourhood: "동네", quarter: "동네",
};
const osmKo = (v?: string, k?: string) => OSM_KO[v ?? ""] ?? OSM_KO[k ?? ""] ?? (v && v !== "yes" ? v : k ?? "");

// OpenStreetMap 검색 (키 불필요). Photon(komoot) 먼저, 안 되면 Nominatim.
const OSM_UA = "woori-todo/1.0 (personal couple app; https://github.com/sjw6770/woori-todo)";
async function osmSearch(q: string): Promise<PlaceResult[]> {
  try {
    return await photonSearch(q);
  } catch (e) {
    console.error("photon", (e as Error).message);
    return await nominatimSearch(q);
  }
}
async function photonSearch(q: string): Promise<PlaceResult[]> {
  const res = await fetch(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: "10", bbox: "124.5,33.0,131.9,38.7" })}`,
    { headers: { "User-Agent": OSM_UA } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  // deno-lint-ignore no-explicit-any
  return ((await res.json()).features ?? []).filter((f: any) => f.properties?.name).map((f: any): PlaceResult => {
    const p = f.properties;
    const t = { N: "node", W: "way", R: "relation" }[p.osm_type as string] ?? "node";
    return {
      source: "osm", source_id: `${t}/${p.osm_id}`, name: String(p.name).replace(/[,\s]+$/, ""),
      category: osmKo(p.osm_value, p.osm_key),
      address: [p.state, p.city, p.county, p.district, p.locality, p.street, p.housenumber].filter(Boolean)
        .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(" "),
      lat: Number(f.geometry.coordinates[1]), lng: Number(f.geometry.coordinates[0]),
      url: `https://www.openstreetmap.org/${t}/${p.osm_id}`,
    };
  });
}
// Nominatim (초당 1회 이하·식별 가능한 User-Agent 필수 정책)
async function nominatimSearch(q: string): Promise<PlaceResult[]> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: "jsonv2", addressdetails: "0", limit: "10", "accept-language": "ko", countrycodes: "kr",
  })}`, { headers: { "User-Agent": OSM_UA } });
  if (!res.ok) throw new Error(`osm ${res.status}`);
  // deno-lint-ignore no-explicit-any
  return (await res.json()).map((r: any): PlaceResult => ({
    source: "osm", source_id: `${r.osm_type}/${r.osm_id}`,
    name: r.name || String(r.display_name).split(",")[0], category: osmKo(r.type, r.category),
    address: String(r.display_name).split(",").map((s: string) => s.trim()).reverse().filter((s: string) => s !== "대한민국" && !/^\d{5}$/.test(s)).join(" "),
    lat: Number(r.lat), lng: Number(r.lon), url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
  }));
}

// 레벨 규칙 (web/js/quest.js 와 동일): Lv.L→L+1 에 100 + 50(L-1) XP
const xpToReach = (L: number) => 100 * (L - 1) + (50 * (L - 1) * (L - 2)) / 2;
function levelOf(total: number) {
  let L = 1;
  while (total >= xpToReach(L + 1)) L++;
  return L;
}
const relevant = (item: Item, memberId: string) => item.owner === null || item.owner === memberId;
const when = (item: Item) => (item.time ? item.time.slice(0, 5) : "");
function beforeLabel(min: number) {
  if (min === 0) return "지금";
  if (min % 1440 === 0) return `${min / 1440}일 뒤`;
  if (min % 60 === 0) return `${min / 60}시간 뒤`;
  return `${min}분 뒤`;
}

// ---------------------------------------------------------------- JOY (스크린타임 트리거)
// 아이폰 단축어 '앱 자동화'가 지정 앱이 열림/닫힘을 알려 줌 → 연속 사용 시간 계산
const JOY_MERGE_GAP = 3 * 60000;     // 닫았다가 3분 안에 다시 열면 같은 연속 사용으로 봄
const JOY_STALE = 6 * 3600000;       // 닫힘 신호가 6시간 없으면 끝난 것으로 봄

async function joyEvent(token: string, event: string) {
  if (!token || !["open", "close"].includes(event)) return { error: "bad request", status: 400 };
  const { data: set } = await db.from("joy_settings").select("member_id,trigger_minutes").eq("hook_token", token).maybeSingle();
  if (!set) return { error: "unknown token", status: 403 };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const { data: u } = await db.from("joy_usage").select("*").eq("member_id", set.member_id).maybeSingle();
  if (event === "open") {
    const lastClose = u?.last_close_at ? Date.parse(u.last_close_at) : 0;
    const continuing = u?.started_at && (u.open || now - lastClose < JOY_MERGE_GAP) && now - Date.parse(u.last_open_at ?? u.started_at) < JOY_STALE;
    const started = continuing ? Date.parse(u!.started_at) : now;
    const next = continuing && u?.next_check_at !== undefined ? u.next_check_at : iso(started + set.trigger_minutes * 60000);
    await db.from("joy_usage").upsert({
      member_id: set.member_id, open: true, started_at: iso(started), last_open_at: iso(now),
      last_close_at: u?.last_close_at ?? null, next_check_at: next, updated_at: iso(now),
    });
    return { ok: true, continuing: Boolean(continuing), minutes: Math.round((now - started) / 60000) };
  }
  await db.from("joy_usage").upsert({
    member_id: set.member_id, open: false, started_at: u?.started_at ?? null, last_open_at: u?.last_open_at ?? null,
    last_close_at: iso(now), next_check_at: u?.next_check_at ?? null, updated_at: iso(now),
  });
  return { ok: true };
}

async function joyCheck() {
  const out: string[] = [];
  const nowIso = new Date().toISOString();
  const { data: rows } = await db.from("joy_usage").select("*").eq("open", true).lte("next_check_at", nowIso);
  for (const u of rows ?? []) {
    if (Date.now() - Date.parse(u.last_open_at ?? u.started_at) > JOY_STALE) {
      await db.from("joy_usage").update({ open: false }).eq("member_id", u.member_id);
      continue;
    }
    const { data: set } = await db.from("joy_settings").select("recheck_minutes").eq("member_id", u.member_id).maybeSingle();
    const mins = Math.round((Date.now() - Date.parse(u.started_at)) / 60000);
    // 먼저 다음 확인 시각을 미뤄서 중복 발송을 막음
    await db.from("joy_usage").update({ next_check_at: new Date(Date.now() + (set?.recheck_minutes ?? 30) * 60000).toISOString() })
      .eq("member_id", u.member_id);
    await sendTo(u.member_id, { title: "Still having fun?", body: `${mins}분째 보는 중이야. 아직 재밌어?`, tag: "joy-check", url: `./?check=${mins}` }, "joy");
    out.push(`joy-check ${mins}m`);
  }
  return out;
}

// ---------------------------------------------------------------- 발송
type Payload = { title: string; body: string; tag?: string; url?: string };

// app: 'woori'(우리할일) | 'joy'(JOY) — 각 앱에 등록한 기기로만 보냄
async function sendTo(memberId: string, payload: Payload, app: "woori" | "joy" = "woori") {
  const { data: subs } = await db.from("push_subs").select("*").eq("member_id", memberId).eq("app", app);
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
      // 오늘 감정 기록을 아직 안 했으면 같이 알림
      const { data: mood } = await db.from("moods").select("day").eq("member_id", m.id).eq("day", now.date).maybeSingle();
      const moodLine = mood ? [] : ["📝 오늘 감정 기록도 남겨 보세요"];
      if (left.length + od.length > 0) {
        const lines = [...left, ...od].slice(0, 6).map((i) => `☐ ${i.title}`);
        await sendTo(m.id, { title: `아직 못 끝낸 할일 ${left.length + od.length}개`, body: [...lines, ...moodLine].join("\n"), tag: "nag" });
        log.push(`nag ${m.name}`);
      } else if (!mood) {
        await sendTo(m.id, { title: "오늘 하루 어땠어요?", body: "감정을 기록하고 하루를 정리해 보세요", tag: "mood" });
        log.push(`mood ${m.name}`);
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

  // 6) JOY: 지정 앱을 연속으로 오래 쓰면 "Still having fun?"
  try {
    log.push(...(await joyCheck()));
  } catch (e) {
    console.error("joy", (e as Error).message);
  }

  // 5) 진정 시간 종료 알림 (둘 다에게) + 12시간 넘게 열려 있는 세션 정리
  const { data: calms } = await db.from("calm_sessions").select("id,ends_at").is("ended_at", null);
  for (const s of (calms ?? []) as { id: string; ends_at: string }[]) {
    const past = Date.now() - Date.parse(s.ends_at);
    if (past > 12 * 3600000) {
      await db.from("calm_sessions").update({ ended_at: new Date().toISOString() }).eq("id", s.id);
    } else if (past >= 0 && past < 10 * 60000 && (await claim(`calm-end:${s.id}`))) {
      for (const m of M) {
        await sendTo(m.id, { title: "🕊 진정 시간이 끝났어요", body: "준비되면 앱에서 '다시 이야기하기'를 눌러 주세요", tag: "calm" });
      }
      log.push(`calm-end ${s.id}`);
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
  const { data } = await db.from("members").select("id,name");
  const members = (data ?? []) as { id: string; name: string }[];
  const me = members.find((m) => m.id === user.id);
  if (!me) return json({ error: "not a member" }, 403);

  if (body.action === "test") {
    const n = await sendTo(me.id, { title: "🔔 테스트 알림", body: "알림이 잘 오고 있어요!", tag: "test" });
    return json({ ok: true, sent: n });
  }

  // JOY 설정 화면의 "지금 받아보기": 연속 사용 알림을 바로 한 번 보냄
  if (body.action === "joy-test") {
    const mins = Number(body.minutes) || 45;
    const n = await sendTo(me.id, { title: "Still having fun?", body: `${mins}분째 보는 중이야. 아직 재밌어?`, tag: "joy-check", url: `./?check=${mins}` }, "joy");
    return json({ ok: true, sent: n });
  }

  // 장소 검색 (카카오 키가 있으면 카카오, 없으면 OpenStreetMap)
  if (body.action === "place-search") {
    const q = String(body.query ?? "").trim().slice(0, 100);
    if (!q) return json({ provider: KAKAO_KEY ? "kakao" : "osm", results: [] });
    try {
      return json(KAKAO_KEY ? { provider: "kakao", results: await kakaoSearch(q) } : { provider: "osm", results: await osmSearch(q) });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // 저장된 카카오 장소를 실시간으로 다시 조회 (ID + 검색어만 저장하므로)
  if (body.action === "place-lookup") {
    if (!KAKAO_KEY) return json({ provider: "osm", info: {} });
    const list = (Array.isArray(body.places) ? body.places : []).slice(0, 60) as unknown as { id: string; source_id: string | null; query: string }[];
    const info: Record<string, PlaceResult | null> = {};
    const byQuery = new Map<string, { id: string; source_id: string | null }[]>();
    for (const p of list) {
      if (!p?.query) continue;
      if (!byQuery.has(p.query)) byQuery.set(p.query, []);
      byQuery.get(p.query)!.push(p);
    }
    for (const [q, ps] of byQuery) {
      const want = new Set(ps.map((p) => p.source_id).filter(Boolean));
      const found = new Map<string, PlaceResult>();
      let addrFirst: PlaceResult | null = null;
      try {
        for (let page = 1; page <= 3 && [...want].some((w) => !found.has(w!)); page++) {
          const { results, end } = await kakaoKeyword(q, page);
          for (const r of results) if (r.source_id) found.set(r.source_id, r);
          if (end) break;
        }
        if (ps.some((p) => !p.source_id)) addrFirst = (await kakaoAddress(q))[0] ?? null;
      } catch (e) {
        console.error("lookup", (e as Error).message);
      }
      for (const p of ps) info[p.id] = p.source_id ? found.get(p.source_id) ?? null : addrFirst;
    }
    return json({ provider: "kakao", info });
  }

  // 진정하기: 요청(start) → 상대에게, 수락(accept) → 요청한 사람에게, 끝(end) → 상대에게
  if (body.action === "calm") {
    const { data: s } = await db.from("calm_sessions").select("*").eq("id", body.session_id).maybeSingle();
    if (!s) return json({ error: "no session" }, 404);
    const endKst = nowKST(Date.parse(s.ends_at));
    let payload: Payload;
    if (body.event === "start") {
      if (s.from_member !== me.id) return json({ error: "forbidden" }, 403);
      payload = {
        title: `🕊 ${me.name}님이 잠시 진정하자고 해요`,
        body: s.message ? `"${s.message}"\n${s.minutes}분 쉬고 ${hhmm(endKst.min)}에 다시 이야기해요` : `${s.minutes}분 쉬고 ${hhmm(endKst.min)}에 다시 이야기해요. 앱을 열어 같이 숨 골라요`,
        tag: "calm",
      };
    } else if (body.event === "accept") {
      payload = { title: `🕊 ${me.name}님도 진정하기로 했어요`, body: `${hhmm(endKst.min)}에 다시 이야기해요`, tag: "calm" };
    } else if (body.event === "end") {
      payload = { title: `${me.name}님이 다시 이야기할 준비가 됐어요`, body: "천천히, 차분하게 이야기해요", tag: "calm" };
    } else return json({ error: "unknown event" }, 400);
    if (!(await claim(`calm-${body.event}:${s.id}:${me.id}`))) return json({ ok: true, sent: 0, duplicate: true });
    let sent = 0;
    for (const m of members.filter((x) => x.id !== me.id)) sent += await sendTo(m.id, payload);
    return json({ ok: true, sent });
  }

  // 레벨 업: 서버에서 다시 계산해서 실제로 도달했을 때만, 레벨마다 한 번만 보냄
  if (body.action === "notify" && body.verb === "levelup") {
    const target = (members ?? []).find((m) => m.id === body.member_id);
    if (!target) return json({ error: "no member" }, 404);
    const { data: tot } = await db.from("xp_totals").select("total").eq("member_id", target.id).maybeSingle();
    const want = Number(body.level);
    if (!want || levelOf(tot?.total ?? 0) < want) return json({ ok: false, reason: "level not reached" });
    if (!(await claim(`levelup:${target.id}:${want}`))) return json({ ok: true, sent: 0, duplicate: true });
    const { data: rws } = await db.from("rewards").select("title").eq("member_id", target.id).eq("level", want);
    const rw = rws?.length ? `보상: ${rws.map((r: { title: string }) => r.title).join(", ")}` : "";
    let sent = 0;
    for (const m of (members ?? []).filter((x) => x.id !== me.id)) { // 체크한 사람은 앱 화면으로 이미 봄
      sent += await sendTo(m.id, m.id === target.id
        ? { title: `🎉 Lv.${want} 달성!`, body: rw || "다음 목표 보상을 정해 보세요", tag: `lv-${target.id}` }
        : { title: `🎉 ${target.name}님이 Lv.${want} 달성!`, body: rw || "축하해 주세요", tag: `lv-${target.id}` });
    }
    return json({ ok: true, sent });
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
    // JOY: 아이폰 단축어가 보내는 지정 앱 열림/닫힘 (로그인 대신 개인 토큰)
    if (body.action === "joy-event") {
      const r = await joyEvent(String(body.token ?? ""), String(body.event ?? ""));
      return json(r, (r as { status?: number }).status ?? 200);
    }
    // 배포 확인용: 장소 검색이 실제로 되는지 (CRON_SECRET 필요)
    if (body.action === "place-test") {
      if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
      const q = String(body.query || "남산서울타워");
      const results = KAKAO_KEY ? await kakaoSearch(q) : await osmSearch(q);
      return json({ provider: KAKAO_KEY ? "kakao" : "osm", count: results.length, first: results[0] ?? null });
    }
    return await fromApp(req, body);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
