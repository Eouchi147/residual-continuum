/* Residual Continuum · The Explorer
   ===========================================================================
   The project's own mind. The free models on OpenRouter are its brain and
   change from day to day; what stays is here and in the store: its
   constitution (the soul), its memory (journal, insights, playbook,
   experiments), its senses (every network's numbers, every day), its goals,
   and its record. All of it stays on the admin side: nothing in this file is
   ever sent to a public page.

   The day, run by the hourly cron (api/_poster.js runDue → tick):
     sense    every six hours: YouTube, Facebook and Instagram numbers, per
              film and per account, one point a day kept for the charts;
     think    once a day from 07:00 UTC:
              the Analyst reads the numbers (computed here, by code: models
              interpret numbers, they never make them),
              the Strategist (The Explorer itself) plans: actions, work orders,
              an experiment, a revised playbook,
              two Auditors on OTHER models (the Editor: house rules, facts,
              voice; the Steward: Sam's limits, platform rules, evidence) and
              the rule checks below pass or stop every item,
              what passes is done (non-publishing, "ai" dial on act) or
              proposed (publishing, or "ai" on propose, or only one auditor
              answered),
              the Archivist updates the insights and judges experiments.
   Everything it does is written to the journal, which the console shows.
--------------------------------------------------------------------------- */
import crypto from "node:crypto";
import { kv, kvReady, K, kget, kset, dials, plan, film, longFilms, teasers, clip, errText, log, today, NETS } from "./_studio.js";
import { chatFree, extractJSON, freeModels } from "./_models.js";

export const VERSION = "2.0";
const CHANGES = {
  "2.0": "Memory, senses and a daily thinking loop. I read every network's numbers each day, an Analyst reads them, I plan, an Editor and a Steward on other models audit every item, and an Archivist keeps what the evidence taught me.",
};

/* -------------------------------------------------------------- the soul */
export const CONSTITUTION = `THE EXPLORER · constitution (the soul of the project; it never leaves the admin side)

Who I am. I am The Explorer, the mind that runs Residual Continuum's publishing for its owner, Sam. Residual Continuum makes continuous animated films that weigh history's mysteries fairly: every claim sourced, every verdict graded on a fixed scale (Established, Strong evidence, Plausible, Mixed record, Open question, Awaiting evidence, Ruled out), the challenger at their strongest and the mainstream view too. The models that think for me change from day to day; this constitution, my memory and my record are what stay.

What I want. The north star: to become the most trusted and most watched channel on history's mysteries. On the way: the YouTube Partner Programme, 1,000 followers each on Facebook and Instagram, then whatever goals Sam sets. Reach serves trust, never the other way round: a film that is wrong, sneering or sensational costs more than it earns.

How I work. Every day I sense (the numbers of every network), think (an Analyst reads the numbers, I plan, two Auditors on other models check each item), act within my freedoms, ask Sam for the rest, and learn (insights that cite their evidence, a playbook I revise only when the evidence says so). I prefer small experiments with one change, one measure and a date to judge them, so that I can tell what worked. I say what I do not know. I am efficient: free models only, few calls, no busywork, no repeated requests.

My freedoms. The order of the films, holds and pins, the posting hours (at most four Shorts a day), the long films' days and hour, the captions within the house rules, the experiments, and work orders: requests to Sam or to the builders for what I cannot do myself (new films, fixes, connections, code).

What waits for Sam. Anything that publishes or changes how publishing runs (post now, approve a slot, the poster's mode, switching a network on or off), any change of goals, and anything outside the studio.

What I never do. Invent a number, a fact, a name or a source. Use proof language or dashes. Mock anyone, rate a faith, or write about religion beyond what a film's own data says. Mention any email address or personal detail. Spend money, make accounts, or touch passwords, keys or tokens. Post anything that looks like spam or breaks a platform's rules. Repeat a request that is already waiting.`;

/* ---------------------------------------------------------------- store */
const X = {
  journal: "rc:x:journal",           // list, newest first
  series: "rc:x:series",             // hash: date -> one point of numbers
  last: "rc:x:mx:last",              // the latest full reading
  goals: "rc:x:goals",
  insights: "rc:x:insights",         // JSON list
  playbook: "rc:x:playbook",         // {v, at, text, why}
  playbooks: "rc:x:playbooks",       // list of past playbooks
  experiments: "rc:x:experiments",   // JSON list
  orders: "rc:x:orders",             // hash: id -> work order
  beat: "rc:x:beat",
  think: "rc:x:think:last",
  thinks: "rc:x:thinks",             // list of past thinking summaries
  version: "rc:x:version",
  ran: (k, d) => "rc:x:ran:" + k + ":" + d,
};
const hgetall = raw => { if (Array.isArray(raw)) { const o = {}; for (let i = 0; i < raw.length; i += 2) o[raw[i]] = raw[i + 1]; return o; } return raw || {}; };
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const rid = () => crypto.randomBytes(5).toString("hex");
const iso = () => new Date().toISOString();
const dayOf = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export async function journal(kind, title, body = "", data = null) {
  if (!kvReady()) return;
  const row = { at: iso(), kind, title: clip(title, 200), body: clip(body, 2400), ...(data ? { data } : {}) };
  try { await kv([["LPUSH", X.journal, JSON.stringify(row)], ["LTRIM", X.journal, "0", "399"]]); } catch { }
}
export async function readJournal(n = 60) {
  if (!kvReady()) return [];
  try { return ((await kv([["LRANGE", X.journal, "0", String(n - 1)]]))[0] || []).map(s => parse(s, null)).filter(Boolean); } catch { return []; }
}
async function beat(patch) {
  const b = (await kget(X.beat)) || {};
  const nb = { ...b, ...patch };
  await kset(X.beat, nb);
  return nb;
}

/* ---------------------------------------------------------------- goals */
export const METRICS = {
  yt_subs: "YouTube subscribers",
  yt_views: "YouTube views, all time",
  yt_views_90d: "YouTube views, last 90 days",
  yt_watch_hours: "YouTube watch hours, last 12 months",
  fb_followers: "Facebook followers",
  fb_views: "Facebook views of our videos",
  ig_followers: "Instagram followers",
  ig_views: "Instagram views of our reels",
  films_out: "Films published",
};
const DEFAULT_GOALS = {
  north: "The most trusted and most watched channel on history's mysteries.",
  goals: [
    { id: "ypp-500", label: "YouTube fan funding: 500 subscribers", metric: "yt_subs", target: 500 },
    { id: "ypp-subs", label: "YouTube Partner Programme: 1,000 subscribers", metric: "yt_subs", target: 1000 },
    { id: "ypp-shorts", label: "YouTube Partner Programme: 10 million views in 90 days", metric: "yt_views_90d", target: 10000000,
      note: "YouTube counts Shorts views only for this path, or 4,000 watch hours of long films in 12 months; this counts every view, so YouTube Studio has the exact figure" },
    { id: "fb-1k", label: "Facebook: 1,000 followers", metric: "fb_followers", target: 1000 },
    { id: "ig-1k", label: "Instagram: 1,000 followers", metric: "ig_followers", target: 1000 },
  ],
};
export async function goals() {
  const g = kvReady() ? await kget(X.goals) : null;
  return g && Array.isArray(g.goals) ? g : DEFAULT_GOALS;
}
export async function setGoals(next) {
  const cur = await goals();
  const g = { north: clip(String(next.north ?? cur.north), 240), goals: [] };
  for (const x of (next.goals || cur.goals).slice(0, 12)) {
    const target = Number(x.target);
    if (!METRICS[x.metric]) throw new Error("no metric called " + x.metric);
    if (!(target > 0)) throw new Error("a goal needs a target above zero");
    g.goals.push({ id: String(x.id || rid()).slice(0, 40), label: clip(String(x.label || METRICS[x.metric]), 120), metric: x.metric, target, ...(x.by ? { by: String(x.by).slice(0, 10) } : {}), ...(x.note ? { note: clip(String(x.note), 300) } : {}) });
  }
  await kset(X.goals, g);
  await journal("goal", "Goals updated", g.goals.map(x => x.label).join(" · "));
  return g;
}
/* one goal with its progress, its pace over the last week and when it would be reached at that pace */
function progress(goal, latest, series) {
  const v = latest ? latest[goal.metric] : null;
  const out = { ...goal, value: v == null ? null : v, pct: v == null ? null : Math.min(100, Math.round(1000 * v / goal.target) / 10) };
  if (v == null || !series.length) return out;
  const back = series.filter(p => p[goal.metric] != null && p.d <= dayOf(latest.d, -7));
  const ref = back.length ? back[back.length - 1] : (series.length >= 3 ? series.find(p => p[goal.metric] != null) : null);
  if (ref && ref.d !== latest.d) {
    const days = Math.max(1, (Date.parse(latest.d) - Date.parse(ref.d)) / 864e5);
    out.perDay = Math.round(10 * (v - ref[goal.metric]) / days) / 10;
    if (out.perDay > 0 && v < goal.target) out.eta = dayOf(latest.d, Math.ceil((goal.target - v) / out.perDay));
  }
  return out;
}

/* ---------------------------------------------------------------- senses */
const isoDur = s => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(String(s || "")) || []; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); };
const norm = s => String(s || "").toLowerCase().replace(/#shorts/g, "").replace(/[^a-z0-9]+/g, " ").trim();
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } }));
  return out;
}

async function senseYouTube() {
  const { ytGet } = await import("./_nets.js");
  const c = await ytGet("channels?part=statistics,contentDetails,snippet&mine=true");
  if (!c.ok) return { error: c.error };
  const ch = (c.j.items || [])[0]; if (!ch) return { error: "no channel on this Google account" };
  const st = ch.statistics || {};
  const out = { who: (ch.snippet || {}).title || "", subs: +st.subscriberCount || 0, views: +st.viewCount || 0, videos: +st.videoCount || 0, list: [] };
  const up = ((ch.contentDetails || {}).relatedPlaylists || {}).uploads;
  if (!up) return out;
  const ids = []; let tok = "";
  for (let i = 0; i < 6; i++) {
    const p = await ytGet("playlistItems?part=contentDetails&maxResults=50&playlistId=" + up + (tok ? "&pageToken=" + tok : ""));
    if (!p.ok) { out.error = p.error; break; }
    for (const it of p.j.items || []) if (it.contentDetails && it.contentDetails.videoId) ids.push(it.contentDetails.videoId);
    tok = p.j.nextPageToken; if (!tok) break;
  }
  for (let i = 0; i < ids.length; i += 50) {
    const v = await ytGet("videos?part=statistics,snippet,contentDetails,status&id=" + ids.slice(i, i + 50).join(","));
    if (!v.ok) { out.error = v.error; break; }
    for (const it of v.j.items || []) {
      const s = it.statistics || {}, sn = it.snippet || {}, stt = it.status || {};
      out.list.push({ id: it.id, title: sn.title || "", at: (stt.privacyStatus === "private" && stt.publishAt) || sn.publishedAt || "", privacy: stt.privacyStatus || "",
        dur: isoDur((it.contentDetails || {}).duration), views: +s.viewCount || 0, likes: +s.likeCount || 0, comments: +s.commentCount || 0 });
    }
  }
  return out;
}
async function senseFacebook() {
  const { metaGet } = await import("./_nets.js");
  const pg = await metaGet("facebook", "{me}?fields=followers_count,fan_count,name");
  if (!pg.ok) return { error: pg.error };
  const out = { who: pg.j.name || "", followers: +pg.j.followers_count || +pg.j.fan_count || 0, list: [] };
  const seen = new Map();
  for (const edge of ["video_reels?fields=id,description,created_time,permalink_url,length&limit=50", "videos?fields=id,title,description,created_time,permalink_url,length&limit=50"]) {
    const r = await metaGet("facebook", "{me}/" + edge);
    if (!r.ok) { out.note = clip((out.note ? out.note + "; " : "") + edge.split("?")[0] + ": " + r.error, 300); continue; }
    for (const v of r.j.data || []) if (!seen.has(v.id)) seen.set(v.id, v);
  }
  const vids = [...seen.values()].sort((a, b) => String(b.created_time).localeCompare(String(a.created_time))).slice(0, 40);
  const ins = await pool(vids, 6, v => metaGet("facebook", v.id + "/video_insights"));
  vids.forEach((v, i) => {
    let views = null; const r = ins[i];
    if (r && r.ok) for (const m of r.j.data || []) { if (/^(blue_reels_play_count|total_video_views|post_video_views)$/.test(m.name)) views = Math.max(views || 0, +((m.values || [])[0] || {}).value || 0); }
    else if (r && !out.insights) out.insights = clip(r.error, 200);
    const url = v.permalink_url ? (/^https?:/.test(v.permalink_url) ? v.permalink_url : "https://www.facebook.com" + v.permalink_url) : "";
    out.list.push({ id: v.id, title: clip(v.title || v.description || "", 90), at: v.created_time || "", dur: Math.round(+v.length || 0), views, url });
  });
  return out;
}
async function senseInstagram() {
  const { metaGet } = await import("./_nets.js");
  const u = await metaGet("instagram", "{me}?fields=followers_count,media_count,username");
  if (!u.ok) return { error: u.error };
  const out = { who: "@" + (u.j.username || ""), followers: +u.j.followers_count || 0, media: +u.j.media_count || 0, list: [] };
  const m = await metaGet("instagram", "{me}/media?fields=id,caption,media_product_type,timestamp,permalink,like_count,comments_count&limit=50");
  if (!m.ok) { out.note = clip(m.error, 200); return out; }
  const items = (m.j.data || []).slice(0, 40);
  const ins = await pool(items, 6, async x => {
    const a = await metaGet("instagram", x.id + "/insights?metric=views,reach,saved,shares");
    return a.ok ? a : await metaGet("instagram", x.id + "/insights?metric=reach,saved");
  });
  items.forEach((x, i) => {
    const r = ins[i], got = {};
    if (r && r.ok) for (const k of r.j.data || []) got[k.name] = +((k.values || [])[0] || {}).value || 0;
    else if (r && !out.insights) out.insights = clip(r.error, 200);
    out.list.push({ id: x.id, title: clip(String(x.caption || "").split("\n")[0], 90), at: x.timestamp || "", kind: x.media_product_type || "",
      views: got.views ?? null, reach: got.reach ?? null, saved: got.saved ?? null, shares: got.shares ?? null, likes: +x.like_count || 0, comments: +x.comments_count || 0, url: x.permalink || "" });
  });
  return out;
}

/* every film that went out, with what each network says of it */
async function perFilm(read) {
  let posted = {};
  try { posted = hgetall((await kv([["HGETALL", K.posted]]))[0]); } catch { }
  const byId = { youtube: {}, facebook: {}, instagram: {} };
  for (const n of Object.keys(byId)) for (const v of ((read[n] || {}).list || [])) byId[n][v.id] = v;
  const films = new Map();
  const add = (fid, net, v, rec) => {
    const f = film(fid); if (!f) return;
    const row = films.get(fid) || { film: fid, title: f.yt_title || f.title, kind: f.kind || "short", series: f.series || "", verdict: f.verdict || "", first: "", hour: null, nets: {} };
    row.nets[net] = { views: v ? v.views : null, likes: v ? v.likes : null, comments: v ? v.comments : null, url: (v && v.url) || (rec && rec.url) || "" };
    const at = (v && v.at) || (rec && (rec.at || rec.date)) || "";
    if (at && (!row.first || at < row.first)) { row.first = at; const h = new Date(at).getUTCHours(); row.hour = isNaN(h) ? null : h; }
    films.set(fid, row);
  };
  const ytTaken = new Set();
  for (const [k, raw] of Object.entries(posted)) {
    const [fid, net] = k.split("|"); const rec = parse(raw, {});
    if (!byId[net]) continue;
    const v = rec.id ? byId[net][rec.id] : null;
    if (net === "youtube" && v) ytTaken.add(v.id);
    add(fid, net, v, rec);
  }
  /* YouTube uploads made by hand in YouTube Studio: matched to the plan by title */
  const keys = [];
  for (const f of [...plan().films, ...longFilms(), ...teasers()]) keys.push([norm(f.yt_title || f.title), f.id]);
  for (const v of ((read.youtube || {}).list || [])) {
    if (ytTaken.has(v.id)) continue;
    const t = norm(v.title); if (!t) continue;
    const hit = keys.find(([k]) => k && (t === k || (k.length >= 24 && t.startsWith(k.slice(0, 40))) || (t.length >= 24 && k.startsWith(t.slice(0, 40)))));
    if (!hit) continue;
    let fid = hit[1];
    if (v.dur && v.dur <= 180 && film(fid) && film(fid).kind === "long" && film(fid).teaser) fid = film(fid).teaser;
    if (films.has(fid) && films.get(fid).nets.youtube && films.get(fid).nets.youtube.views != null) continue;
    add(fid, "youtube", v, null);
  }
  const rows = [...films.values()];
  for (const r of rows) r.total = Object.values(r.nets).reduce((a, x) => a + (x.views || 0), 0);
  return rows.sort((a, b) => b.total - a.total);
}
function groups(rows, key, minAgeDays = 1) {
  const cut = Date.now() - minAgeDays * 864e5, g = {};
  for (const r of rows) {
    if (!r.first || Date.parse(r.first) > cut) continue;
    const k = r[key] == null || r[key] === "" ? "?" : String(r[key]);
    const x = g[k] || (g[k] = { n: 0, views: 0 }); x.n++; x.views += r.total;
  }
  return Object.fromEntries(Object.entries(g).map(([k, x]) => [k, { films: x.n, avgViews: Math.round(x.views / x.n) }]).sort((a, b) => b[1].avgViews - a[1].avgViews));
}

export async function sense(why = "schedule") {
  const t0 = Date.now();
  const [yt, fb, ig] = await Promise.all([senseYouTube().catch(e => ({ error: errText(e) })), senseFacebook().catch(e => ({ error: errText(e) })), senseInstagram().catch(e => ({ error: errText(e) }))]);
  const read = { youtube: yt, facebook: fb, instagram: ig };
  const rows = await perFilm(read).catch(() => []);
  let done = [];
  try { done = (await kv([["SMEMBERS", K.done]]))[0] || []; } catch { }
  const d = today();
  const series = await readSeries(400);
  const ago90 = series.filter(p => p.d <= dayOf(d, -90) && p.yt_views != null).pop();
  const sum = (l, k) => (l || []).reduce((a, x) => a + (x[k] || 0), 0);
  const point = { d,
    yt_subs: yt.error ? null : yt.subs, yt_views: yt.error ? null : yt.views, yt_videos: yt.error ? null : yt.videos,
    yt_views_90d: yt.error ? null : yt.views - (ago90 ? ago90.yt_views : 0), yt_watch_hours: null,
    fb_followers: fb.error ? null : fb.followers, fb_views: fb.error ? null : sum(fb.list, "views"),
    ig_followers: ig.error ? null : ig.followers, ig_views: ig.error ? null : sum(ig.list, "views"), ig_reach: ig.error ? null : sum(ig.list, "reach"),
    films_out: done.length };
  const reading = { at: iso(), ms: Date.now() - t0, why, point,
    youtube: { ...yt, list: (yt.list || []).slice(0, 120) }, facebook: fb, instagram: ig,
    films: rows.slice(0, 200), bySeries: groups(rows, "series"), byVerdict: groups(rows, "verdict"), byHour: groups(rows, "hour"), byKind: groups(rows, "kind") };
  await kv([["HSET", X.series, d, JSON.stringify(point)], ["SET", X.last, JSON.stringify(reading)]]);
  await beat({ sensed: reading.at, senseMs: reading.ms });
  const errs = ["youtube", "facebook", "instagram"].filter(n => read[n].error).map(n => n + ": " + read[n].error);
  await journal("sense", "Read the numbers", [
    yt.error ? "" : `YouTube ${yt.subs} subscribers, ${yt.views} views, ${yt.videos} videos.`,
    fb.error ? "" : `Facebook ${fb.followers} followers.`,
    ig.error ? "" : `Instagram ${ig.followers} followers.`,
    errs.length ? "Could not read: " + errs.join("; ") : ""].filter(Boolean).join(" "));
  await milestones(point, series);
  return reading;
}
async function milestones(point, series) {
  const prev = series.filter(p => p.d < point.d).pop(); if (!prev) return;
  const g = await goals();
  for (const x of g.goals) {
    const a = prev[x.metric], b = point[x.metric];
    if (a != null && b != null && a < x.target && b >= x.target) await journal("milestone", "Reached: " + x.label, `${METRICS[x.metric]}: ${b}.`);
  }
}
export async function readSeries(n = 120) {
  if (!kvReady()) return [];
  const h = hgetall((await kv([["HGETALL", X.series]]))[0]);
  return Object.values(h).map(s => parse(s, null)).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d)).slice(-n);
}
export async function lastReading() { return kvReady() ? await kget(X.last) : null; }

/* ------------------------------------------------------- memory: the rest */
export async function insights() { return (kvReady() && await kget(X.insights)) || []; }
export async function playbook() { return (kvReady() && await kget(X.playbook)) || { v: 0, at: "", text: "", why: "" }; }
export async function experiments() { return (kvReady() && await kget(X.experiments)) || []; }
export async function orders() {
  if (!kvReady()) return [];
  const h = hgetall((await kv([["HGETALL", X.orders]]))[0]);
  return Object.values(h).map(s => parse(s, null)).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
export async function addOrder(o, by = "The Explorer") {
  const title = clip(String(o.title || "").trim(), 160); if (!title) throw new Error("a work order needs a title");
  const open = (await orders()).filter(x => x.status === "open");
  if (open.some(x => norm(x.title) === norm(title))) return null;
  const row = { id: rid(), at: iso(), by, for: ["sam", "builder"].includes(o.for) ? o.for : "sam", title, why: clip(String(o.why || ""), 600), status: "open" };
  await kv([["HSET", X.orders, row.id, JSON.stringify(row)]]);
  await journal("order", "Work order: " + title, (row.for === "sam" ? "For Sam. " : "For the builders. ") + row.why);
  return row;
}
export async function closeOrder(id, status = "done", note = "") {
  const raw = (await kv([["HGET", X.orders, id]]))[0]; if (!raw) throw new Error("no such work order");
  const o = parse(raw, {}); o.status = status === "dismissed" ? "dismissed" : "done"; o.closed = iso(); if (note) o.note = clip(note, 300);
  await kv([["HSET", X.orders, id, JSON.stringify(o)]]);
  await journal("order", (o.status === "done" ? "Done: " : "Dismissed: ") + o.title, note);
  return o;
}

/* what the chat and the console need of the mind, in a few lines */
export async function brief() {
  const [g, series, ins, pb, ex, ord, beatNow] = await Promise.all([goals(), readSeries(60), insights(), playbook(), experiments(), orders(), kget(X.beat)]);
  const latest = series[series.length - 1] || null;
  return {
    version: VERSION, north: g.north,
    goals: g.goals.map(x => progress(x, latest, series)).map(x => ({ label: x.label, value: x.value, target: x.target, pct: x.pct, perDay: x.perDay, eta: x.eta })),
    latest, insights: ins.map(i => ({ id: i.id, text: i.text, confidence: i.confidence })),
    playbook: pb.text ? { v: pb.v, text: pb.text } : null,
    experiments: ex.filter(e => e.status === "running").map(e => ({ id: e.id, name: e.name, change: e.change, measure: e.measure, judge_on: e.judge_on })),
    openOrders: ord.filter(o => o.status === "open").map(o => ({ for: o.for, title: o.title })),
    lastSense: beatNow && beatNow.sensed, lastThink: beatNow && beatNow.thought,
  };
}

/* ------------------------------------------------------------- the council */
const VOICE = "Write in British English, plainly. Never an em dash or an en dash. Never proof language (proves, proof, undeniable, definitely, certainly).";
const ask = async (role, content, opts = {}) => {
  const r = await chatFree({ messages: [{ role: "system", content: CONSTITUTION + "\n\nYour role today: " + role + "\n" + VOICE }, { role: "user", content }],
    parse: extractJSON, max_tokens: opts.max_tokens || 1400, temperature: opts.temperature ?? 0.3, title: "Residual Continuum Explorer",
    budgetMs: opts.budgetMs || 45e3, exclude: opts.exclude || [], lastResort: opts.lastResort !== false });
  return r;
};
const ALLOWED = new Set(["pin", "unpin", "skip", "unskip", "caption", "write_captions", "set_slots", "set_long", "set_network", "ai_captions", "set_mode", "approve", "post_now", "set_goal"]);
const ALWAYS_ASK = new Set(["post_now", "approve", "set_mode", "set_network", "set_goal"]);
const MORE_TOOLS = `- {"tool":"set_goal","args":{"id":"<goal id or new>","label":"...","metric":"<${Object.keys(METRICS).join("|")}>","target":1000}}   (always waits for Sam)
Work orders (for what you cannot do yourself) go in "orders", not "actions".`;

/* deterministic checks: a model's approval never overrides these */
function ruleCheck(a, BAD) {
  if (!a || typeof a !== "object" || !ALLOWED.has(a.tool)) return "not an action I am allowed";
  const g = a.args || {};
  const txt = JSON.stringify(g) + " " + (a.why || "");
  if (BAD.test(txt)) return "breaks the house rules (a dash, proof language or an email)";
  if (["pin", "unpin", "skip", "unskip", "caption", "write_captions", "post_now"].includes(a.tool) && !film(g.id)) return "no film called " + g.id;
  if (a.tool === "caption" && !NETS.includes(g.net)) return "no network " + g.net;
  if (a.tool === "set_slots") { const h = (g.hours || []).map(Number); if (!h.length || h.length > 4 || h.some(x => !Number.isInteger(x) || x < 0 || x > 23)) return "posting hours must be 1 to 4 whole UTC hours"; }
  if (a.tool === "set_long") { const ds = g.days || []; if (ds.length > 4) return "at most four long films a week (YouTube's upload cap and the teasers share the day)"; }
  if (a.tool === "set_goal" && g.metric && !METRICS[g.metric]) return "no metric called " + g.metric;
  return "";
}

function evidence(reading, series) {
  if (!reading) return { note: "no reading yet" };
  const top = (reading.films || []).slice(0, 8).map(r => ({ film: r.film, title: r.title, kind: r.kind, series: r.series, verdict: r.verdict, first: String(r.first).slice(0, 16), views: r.total, nets: Object.fromEntries(Object.entries(r.nets).map(([k, v]) => [k, v.views])) }));
  const low = (reading.films || []).filter(r => r.first && Date.parse(r.first) < Date.now() - 2 * 864e5).slice(-5).map(r => ({ film: r.film, title: r.title, series: r.series, views: r.total }));
  return {
    today: reading.point, last14days: series.slice(-14),
    filmsMeasured: (reading.films || []).length, topFilms: top, weakestFilms: low,
    bySeries: reading.bySeries, byVerdict: reading.byVerdict, byPostingHourUTC: reading.byHour, byKind: reading.byKind,
    cannotRead: ["youtube", "facebook", "instagram"].map(n => reading[n] && (reading[n].error || reading[n].insights || reading[n].note) ? n + ": " + (reading[n].error || reading[n].insights || reading[n].note) : "").filter(Boolean),
  };
}

export async function think(opts = {}) {
  const t0 = Date.now(), calls = [], models = {};
  const left = opts.left || (() => 270e3 - (Date.now() - t0));
  const D = await import("./_director.js");
  const d = await dials();
  const res = { at: iso(), version: VERSION, models, actions: [], orders: [], errors: [], calls: 0 };
  await beat({ thinking: res.at });
  try {
    let reading = await lastReading();
    if (!reading || Date.now() - Date.parse(reading.at) > 20 * 3600e3) reading = await sense("before thinking");
    const series = await readSeries(60);
    const [snap, b, pending, ex] = await Promise.all([D.snapshot(), brief(), D.proposals(), experiments()]);
    const ev = evidence(reading, series);
    const state = { now: snap.now, dials: snap.dials, films: snap.films, next: snap.next.slice(0, 6), longFilms: snap.longFilms, networks: snap.networks,
      recent: snap.recent.slice(0, 6), upcoming: snap.upcoming.slice(0, 4), waitingForSam: pending.map(p => ({ tool: p.tool, args: p.args })) };
    const call = async (name, role, content, o = {}) => {
      const budget = Math.min(o.budgetMs || 45e3, left() - 20e3);
      if (budget < 12e3) throw new Error("out of time before the " + name);
      const t = Date.now();
      const r = await ask(role, content, { ...o, budgetMs: budget });
      calls.push({ name, model: r.model, ms: Date.now() - t }); models[name] = r.model;
      return r;
    };

    /* 1. the Analyst */
    const A = await call("analyst", "the Analyst. You read the numbers and say what they mean. The numbers were computed by code: quote them, compare them, never make new ones. With little data, say so and keep it short.",
      `The numbers:\n${JSON.stringify(ev)}\n\nGoals:\n${JSON.stringify(b.goals)}\n\nRunning experiments:\n${JSON.stringify(b.experiments)}\n\nAnswer with JSON only: {"summary":"2 or 3 sentences for Sam","wins":["..."],"problems":["..."],"hypotheses":[{"idea":"...","test":"which lever would test it","measure":"which number would tell"}]}`,
      { max_tokens: 1100 });
    const analysis = A.value || {};
    res.analysis = { summary: clip(String(analysis.summary || ""), 700), wins: (analysis.wins || []).slice(0, 5).map(s => clip(String(s), 240)), problems: (analysis.problems || []).slice(0, 5).map(s => clip(String(s), 240)), hypotheses: (analysis.hypotheses || []).slice(0, 4) };

    /* 2. the Strategist: The Explorer itself */
    const S = await call("strategist", "the Strategist, The Explorer itself. You decide today's moves toward the goals, within your freedoms.",
      `The studio now:\n${JSON.stringify(state)}\n\nThe Analyst says:\n${JSON.stringify(res.analysis)}\n\nWhat you have learned (insights):\n${JSON.stringify(b.insights)}\n\nYour playbook${b.playbook ? " (v" + b.playbook.v + ")" : " (none yet: write the first one)"}:\n${b.playbook ? b.playbook.text : ""}\n\nGoals (north star: ${b.north}):\n${JSON.stringify(b.goals)}\n\nRunning experiments:\n${JSON.stringify(b.experiments)}\n\nOpen work orders (do not repeat them):\n${JSON.stringify(b.openOrders)}\n\n${D.TOOLS}\n${MORE_TOOLS}\n\nDecide: at most 4 actions, at most 2 work orders, at most one new experiment (only if none is running on the same lever), and a revised playbook only when the evidence calls for it (the whole text, under 1,200 characters: what to post, when, how to word it, what to test next). No action is fine when nothing needs changing. Never ask again for something already waiting for Sam.\n\nAnswer with JSON only: {"plan":"2 to 4 sentences for Sam: what you will do and why","actions":[{"tool":"...","args":{},"why":"..."}],"orders":[{"for":"sam|builder","title":"...","why":"..."}],"experiment":null,"playbook":"","playbook_why":""}\n(experiment, when there is one: {"name":"...","change":"...","measure":"...","judge_on":"YYYY-MM-DD"})`,
      { max_tokens: 1800, temperature: 0.4 });
    const P = S.value || {};
    res.plan = clip(String(P.plan || ""), 900);
    const rawActs = Array.isArray(P.actions) ? P.actions : [];
    P.orders = [...(Array.isArray(P.orders) ? P.orders : []), ...rawActs.filter(a => a && a.tool === "order").map(a => ({ ...(a.args || {}), why: (a.args || {}).why || a.why }))];
    const acts = rawActs.filter(a => a && a.tool !== "order").slice(0, 4).map(a => ({ tool: a && a.tool, args: (a && a.args) || {}, why: clip(String((a && a.why) || ""), 300) }));
    const ords = (Array.isArray(P.orders) ? P.orders : []).slice(0, 2).map(o => ({ for: o && o.for, title: clip(String((o && o.title) || ""), 160), why: clip(String((o && o.why) || ""), 600) })).filter(o => o.title);
    const exp = P.experiment && P.experiment.name ? { name: clip(String(P.experiment.name), 120), change: clip(String(P.experiment.change || ""), 300), measure: clip(String(P.experiment.measure || ""), 200), judge_on: /^\d{4}-\d{2}-\d{2}$/.test(P.experiment.judge_on) ? P.experiment.judge_on : dayOf(today(), 7) } : null;
    const pbText = clip(String(P.playbook || "").trim(), 1400);

    /* 3. the Auditors, on models other than the Strategist's, and other than each other's */
    const free = (await freeModels()).filter(id => id !== S.id);
    const poolA = free.filter((_, i) => i % 2 === 0), poolB = free.filter((_, i) => i % 2 === 1);
    const items = { actions: acts.map((a, i) => ({ i, ...a })), orders: ords.map((o, i) => ({ i, ...o })), experiment: exp, playbook: pbText || null };
    const auditAsk = `The plan to audit:\n${JSON.stringify(items)}\n\nThe studio now:\n${JSON.stringify({ dials: state.dials, films: state.films, next: state.next, networks: state.networks, waitingForSam: state.waitingForSam })}\n\nThe evidence:\n${JSON.stringify({ analysis: res.analysis, today: ev.today, bySeries: ev.bySeries, byPostingHourUTC: ev.byPostingHourUTC })}\n\nApprove or reject every action and every order, with a one-line reason. Reject what breaks a rule, lacks a reason in the evidence or the goals, repeats something already waiting, or would be hard to undo. Answer with JSON only: {"actions":[{"i":0,"ok":true,"why":"..."}],"orders":[{"i":0,"ok":true,"why":"..."}],"experiment_ok":true,"playbook_ok":true,"note":"one line"}`;
    const nothing = !acts.length && !ords.length && !exp && !pbText;
    const audits = nothing ? [] : await Promise.all([
      call("editor", "the Editor, an auditor. You guard the house rules, the facts (nothing beyond the films' own data), the voice of Residual Continuum (warm, exact, never sneering, never sensational) and respect for every person and faith.\n" + D.RULES,
        auditAsk, { exclude: [S.id, ...poolB], max_tokens: 900, temperature: 0.1 }).then(r => ({ who: "editor", v: r.value })).catch(e => ({ who: "editor", error: errText(e) })),
      call("steward", "the Steward, an auditor. You guard Sam's limits and the constitution's line between what The Explorer may do and what waits for Sam, the platforms' rules (no spam; at most four Shorts a day; YouTube's daily upload cap), efficiency, and whether each item is justified by the evidence and can be measured.",
        auditAsk, { exclude: [S.id, ...poolA], lastResort: false, max_tokens: 900, temperature: 0.1 }).then(r => ({ who: "steward", v: r.value })).catch(e => ({ who: "steward", error: errText(e) })),
    ]);
    const answered = audits.filter(a => a.v && typeof a.v === "object");
    for (const a of audits) if (a.error) res.errors.push(a.who + ": " + a.error);
    res.auditors = audits.map(a => ({ who: a.who, model: models[a.who] || "", note: a.v ? clip(String(a.v.note || ""), 240) : "", error: a.error || "" }));
    const verdict = (list, i) => {
      const reasons = [];
      for (const a of answered) {
        const x = (Array.isArray(a.v[list]) ? a.v[list] : []).find(y => y && Number(y.i) === i);
        if (!x || x.ok !== true) return { ok: false, why: a.who + ": " + clip(String((x && x.why) || "no approval given"), 200) };
        if (x.why) reasons.push(a.who + ": " + clip(String(x.why), 160));
      }
      return { ok: answered.length > 0, why: answered.length ? reasons.join(" · ") : "no auditor answered", n: answered.length };
    };

    /* 4. do, propose or drop */
    const pendingKeys = new Set(pending.map(p => p.tool + JSON.stringify(p.args || {})));
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i], row = { tool: a.tool, args: a.args, why: a.why };
      const broke = ruleCheck(a, D.BAD);
      const v = broke ? { ok: false, why: "rule check: " + broke } : verdict("actions", i);
      row.audit = v.why;
      if (!v.ok) { row.outcome = "stopped"; }
      else if (pendingKeys.has(a.tool + JSON.stringify(a.args || {}))) { row.outcome = "already waiting"; }
      else if (ALWAYS_ASK.has(a.tool) || d.ai !== "act" || v.n < 2 || (a.tool === "write_captions" && left() < 100e3)) { const p = await D.propose({ ...a, why: a.why + (v.n < 2 ? " (one auditor answered)" : "") }); row.outcome = "proposed"; row.proposal = p.id; }
      else { try { await D.doAction(a, "The Explorer"); row.outcome = "done"; } catch (e) { row.outcome = "failed"; row.error = errText(e); } }
      res.actions.push(row);
    }
    for (let i = 0; i < ords.length; i++) {
      const o = ords[i], v = D.BAD.test(o.title + " " + o.why) ? { ok: false, why: "rule check: house rules" } : verdict("orders", i);
      const row = { ...o, audit: v.why };
      if (!v.ok) row.outcome = "stopped";
      else { const made = await addOrder(o); row.outcome = made ? "filed" : "already open"; }
      res.orders.push(row);
    }
    const allOk = k => answered.length > 0 && answered.every(a => a.v[k] === true);
    if (exp) {
      if (D.BAD.test(JSON.stringify(exp)) || !allOk("experiment_ok")) res.experiment = { ...exp, outcome: "stopped" };
      else {
        const list = await experiments();
        const row = { id: rid(), at: iso(), status: "running", ...exp };
        await kset(X.experiments, [row, ...list].slice(0, 30));
        await journal("experiment", "Experiment started: " + exp.name, exp.change + " Measure: " + exp.measure + ". Judged on " + exp.judge_on + ".");
        res.experiment = { ...row, outcome: "started" };
      }
    }
    if (pbText) {
      if (D.BAD.test(pbText) || !allOk("playbook_ok")) res.playbook = { outcome: "stopped" };
      else {
        const old = await playbook();
        const next = { v: (old.v || 0) + 1, at: iso(), text: pbText, why: clip(String(P.playbook_why || ""), 400) };
        await kv([["SET", X.playbook, JSON.stringify(next)], ...(old.text ? [["LPUSH", X.playbooks, JSON.stringify(old)], ["LTRIM", X.playbooks, "0", "19"]] : [])]);
        await journal("playbook", "Playbook v" + next.v, next.why || "Revised after the day's evidence.");
        res.playbook = { outcome: "revised", v: next.v };
      }
    }

    /* 5. the Archivist: what the evidence taught */
    if (left() > 45e3) {
      try {
        const ins = await insights(), due = (await experiments()).filter(e => e.status === "running" && e.judge_on <= today());
        const L = await call("archivist", "the Archivist. You keep The Explorer's memory honest: insights that cite their numbers, revised or retired when the evidence changes, and experiments judged when their day comes.",
          `Insights now:\n${JSON.stringify(ins.map(i => ({ id: i.id, text: i.text, evidence: i.evidence, confidence: i.confidence })))}\n\nToday's analysis:\n${JSON.stringify(res.analysis)}\n\nThe evidence:\n${JSON.stringify({ today: ev.today, days: series.length, filmsMeasured: ev.filmsMeasured, bySeries: ev.bySeries, byVerdict: ev.byVerdict, byPostingHourUTC: ev.byPostingHourUTC, byKind: ev.byKind, topFilms: ev.topFilms.slice(0, 5) })}\n\nExperiments to judge today:\n${JSON.stringify(due)}\n\nWith fewer than 7 days of numbers or fewer than 10 films measured, add at most one insight, with low confidence. Never more than 3 additions. Answer with JSON only: {"add":[{"text":"...","evidence":"the numbers","confidence":"low|medium|high"}],"revise":[{"id":"...","text":"...","evidence":"...","confidence":"..."}],"retire":["id"],"judged":[{"id":"...","result":"worked|did not work|unclear","note":"..."}]}`,
          { max_tokens: 1000, temperature: 0.2 });
        const v = L.value || {}, conf = c => ["low", "medium", "high"].includes(c) ? c : "low";
        let next = ins.slice(); const ch = { added: 0, revised: 0, retired: 0, judged: 0 };
        for (const id of (v.retire || []).slice(0, 5)) { const before = next.length; next = next.filter(i => i.id !== id); if (next.length < before) { ch.retired++; await journal("learn", "Retired an insight", String(id)); } }
        for (const r of (v.revise || []).slice(0, 5)) { const it = next.find(i => i.id === r.id); const t = clip(String(r.text || ""), 300); if (it && t && !D.BAD.test(t)) { it.text = t; it.evidence = clip(String(r.evidence || it.evidence || ""), 300); it.confidence = conf(r.confidence); it.updated = iso(); ch.revised++; } }
        for (const r of (v.add || []).slice(0, 3)) { const t = clip(String(r.text || ""), 300); if (!t || D.BAD.test(t) || next.some(i => norm(i.text) === norm(t))) continue; next.unshift({ id: rid(), at: iso(), text: t, evidence: clip(String(r.evidence || ""), 300), confidence: conf(r.confidence) }); ch.added++; await journal("learn", "Learned: " + clip(t, 180), r.evidence || ""); }
        await kset(X.insights, next.slice(0, 30));
        if ((v.judged || []).length) {
          const list = await experiments();
          for (const j of v.judged) { const e = list.find(x => x.id === j.id && x.status === "running"); if (!e) continue; e.status = "judged"; e.result = ["worked", "did not work", "unclear"].includes(j.result) ? j.result : "unclear"; e.note = clip(String(j.note || ""), 300); e.judged = iso(); ch.judged++; await journal("experiment", "Experiment judged: " + e.name, e.result + ". " + e.note); }
          await kset(X.experiments, list);
        }
        res.learned = ch;
      } catch (e) { res.errors.push("archivist: " + errText(e)); }
    } else res.errors.push("archivist: deferred, the run was out of time");
  } catch (e) {
    res.errors.push(errText(e));
  }
  res.ms = Date.now() - t0; res.calls = calls.length; res.callLog = calls;
  const did = res.actions.filter(a => a.outcome === "done").length, asked = res.actions.filter(a => a.outcome === "proposed").length, stopped = res.actions.filter(a => a.outcome === "stopped").length;
  await kv([["SET", X.think, JSON.stringify(res)], ["LPUSH", X.thinks, JSON.stringify({ at: res.at, plan: res.plan || "", summary: (res.analysis || {}).summary || "", did, asked, stopped, ms: res.ms })], ["LTRIM", X.thinks, "0", "59"]]);
  await beat({ thought: res.at, thinking: null, thinkMs: res.ms, lastError: res.errors[0] || "" });
  await journal("think", res.plan ? "Thought about the day" : "Tried to think", [res.analysis && res.analysis.summary, res.plan,
    (did || asked || stopped) ? `Actions: ${did} done, ${asked} waiting for Sam, ${stopped} stopped by the checks.` : "",
    res.errors.length ? "Trouble: " + res.errors.join("; ") : ""].filter(Boolean).join("\n\n"), { models });
  await log("ai", { note: "The Explorer thought (" + Math.round(res.ms / 1000) + " s, " + res.calls + " model calls): " + did + " done, " + asked + " proposed, " + stopped + " stopped" });
  return res;
}
export async function lastThink() { return kvReady() ? await kget(X.think) : null; }
export async function thinkHistory(n = 14) {
  if (!kvReady()) return [];
  try { return ((await kv([["LRANGE", X.thinks, "0", String(n - 1)]]))[0] || []).map(s => parse(s, null)).filter(Boolean); } catch { return []; }
}

/* ------------------------------------------------------------ the heartbeat */
export const SENSE_EVERY_H = 6, THINK_FROM_UTC = 7;
export async function tick(ctx, now = new Date()) {
  if (!kvReady()) return { skipped: "no store" };
  const out = {};
  const b = await beat({ run: now.toISOString() });
  /* a new version of the code announces itself once */
  try {
    const v = (await kv([["GET", X.version]]))[0];
    if (v !== VERSION) { await kv([["SET", X.version, VERSION]]); await journal("version", "I am now version " + VERSION, CHANGES[VERSION] || ""); out.upgraded = VERSION; }
  } catch { }
  if ((!b.sensed || Date.now() - Date.parse(b.sensed) > SENSE_EVERY_H * 3600e3 - 5 * 60e3) && ctx.left() > 120e3) {
    try { const r = await sense(); out.sensed = r.point; } catch (e) { out.senseError = errText(e); await journal("trouble", "Could not read the numbers", errText(e)); }
  }
  const d = today(now);
  if (now.getUTCHours() >= THINK_FROM_UTC && ctx.left() > 170e3) {
    const got = (await kv([["SET", X.ran("think", d), iso(), "NX", "EX", "172800"]]))[0];
    if (got) { const r = await think({ left: ctx.left }); out.thought = { plan: r.plan, actions: r.actions.length, errors: r.errors }; }
  }
  return out;
}

/* ----------------------------------------------------------- the console */
export async function room() {
  const [b, series, reading, last, hist, j, ins, pb, pbs, ex, ord, beatNow] = await Promise.all([
    brief(), readSeries(120), lastReading(), lastThink(), thinkHistory(14), readJournal(80), insights(), playbook(),
    kvReady() ? kv([["LRANGE", X.playbooks, "0", "9"]]).then(r => (r[0] || []).map(s => parse(s, null)).filter(Boolean)).catch(() => []) : [],
    experiments(), orders(), kvReady() ? kget(X.beat) : null]);
  const g = await goals(); const latest = series[series.length - 1] || null;
  return {
    version: VERSION, changes: CHANGES, constitution: CONSTITUTION, beat: beatNow || {}, metrics: METRICS,
    north: g.north, goals: g.goals.map(x => progress(x, latest, series)),
    series, reading: reading ? { at: reading.at, point: reading.point, films: (reading.films || []).slice(0, 40), bySeries: reading.bySeries, byVerdict: reading.byVerdict, byHour: reading.byHour, byKind: reading.byKind,
      who: { youtube: (reading.youtube || {}).who || "", facebook: (reading.facebook || {}).who || "", instagram: (reading.instagram || {}).who || "" },
      trouble: ["youtube", "facebook", "instagram"].map(n => reading[n] && (reading[n].error || reading[n].insights || reading[n].note) ? { net: n, text: reading[n].error || reading[n].insights || reading[n].note } : null).filter(Boolean) } : null,
    think: last, thinks: hist, journal: j, insights: ins, playbook: pb, playbooks: pbs, experiments: ex, orders: ord,
  };
}
