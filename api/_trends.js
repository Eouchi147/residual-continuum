/* Residual Continuum · The Explorer's trend radar
   ===========================================================================
   How much the public is reading about each film's subject right now, from
   Wikipedia's public page-view counts (free, no key): the average of the
   last 7 days against the 8 weeks before. A topic in the news jumps; the
   Explorer can then pin the film about it.

   Each film is matched once to an English Wikipedia article by a search on
   its title (kept in rc:t:map, visible and correctable in the console), then
   its views are read in turns: about 40 films per reading, the films still to
   be posted first, so every film is refreshed about once a day.
--------------------------------------------------------------------------- */
import { kv, kvReady, plan, longFilms, clip, errText } from "./_studio.js";

const UA = { "user-agent": "ResidualContinuumStudio/1.0 (https://residualcontinuum.com)", accept: "application/json" };
export const T = { map: "rc:t:map2", pv: "rc:t:pv2", cursor: "rc:t:cursor2" };
const hobj = raw => { if (Array.isArray(raw)) { const o = {}; for (let i = 0; i < raw.length; i += 2) o[raw[i]] = raw[i + 1]; return o; } return raw || {}; };
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
async function getJ(url, ms = 8000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: ctl.signal }); if (!r.ok) throw new Error("http " + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: errText(e) }; } } }));
  return out;
}

/* the words to search for: the film's id names its subject plainly ("jebel-irhoud",
   "nabta-playa"), where titles are written to intrigue ("Morocco's Two Dawns");
   the title's head is the second try. The Ledger films sum up a File: no article. */
export function queryFor(f) {
  return String(f.id || "").replace(/^lf-/, "").replace(/-\d+$/, "").replace(/-/g, " ").trim();
}
const titleHead = f => { const t = String(f.yt_title || f.title || "").replace(/[“”"']/g, ""); const h = t.split(/[:?!·]/)[0].trim(); return h.length >= 4 ? h : t.slice(0, 80); };
async function search(q) {
  const j = await getJ("https://en.wikipedia.org/w/api.php?action=query&list=search&srnamespace=0&srlimit=1&srprop=&format=json&srsearch=" + encodeURIComponent(q));
  const hit = j && j.query && j.query.search && j.query.search[0];
  return hit ? hit.title : "";
}
async function resolve(f) {
  if (/ledger/.test(f.id) || /The Ledger/.test(f.title || "")) return "-";
  return (await search(queryFor(f))) || (await search(titleHead(f))) || "-";
}
async function views(article, now) {
  const end = ymd(now - 864e5), start = ymd(now - 64 * 864e5);
  const j = await getJ(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encodeURIComponent(article.replace(/ /g, "_"))}/daily/${start}00/${end}00`);
  const v = ((j && j.items) || []).map(x => +x.views || 0);
  if (!v.length) return { a: article, avg7: 0, base: 0, spike: null, last: 0 };
  const last7 = v.slice(-7), before = v.slice(0, -7);
  const avg = l => l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
  const a7 = avg(last7), b = avg(before);
  return { a: article, avg7: Math.round(a7), base: Math.round(b), spike: b > 0 ? Math.round(100 * a7 / b) / 100 : null, last: v[v.length - 1], days: v.length };
}

/* one turn of the radar; never throws */
export async function senseTrends(opts = {}) {
  if (!kvReady()) return { error: "no store" };
  const t0 = Date.now(), now = Date.now(), budget = opts.budgetMs || 25e3;
  const films = [...plan().films, ...longFilms()];
  let done = [];
  try { done = (await kv([["SMEMBERS", "rc:done"]]))[0] || []; } catch { }
  const D = new Set(done);
  const [mapRaw, pvRaw, cur] = await kv([["HGETALL", T.map], ["HGETALL", T.pv], ["GET", T.cursor]]);
  const map = hobj(mapRaw), pv = hobj(pvRaw);
  const out = { resolved: 0, read: 0, errors: [] };
  /* 1. match films that have no article yet (25 a turn) */
  const todo = films.filter(f => !map[f.id]).slice(0, 25);
  const got = await pool(todo, 5, f => resolve(f));
  const set = [];
  todo.forEach((f, i) => { const a = got[i]; if (typeof a === "string") { map[f.id] = a; set.push(f.id, a); out.resolved++; } else if (a && a.error && out.errors.length < 3) out.errors.push("search: " + a.error); });
  if (set.length) await kv([["HSET", T.map, ...set]]);
  /* 2. read views: films still to post first, then the rest, in turns */
  const order = [...films.filter(f => !D.has(f.id)), ...films.filter(f => D.has(f.id))].filter(f => map[f.id] && map[f.id] !== "-");
  const start = Number(cur || 0) % Math.max(1, order.length), batch = [];
  for (let i = 0; i < Math.min(40, order.length); i++) batch.push(order[(start + i) % order.length]);
  const byArticle = new Map(); for (const f of batch) { const a = map[f.id]; if (!byArticle.has(a)) byArticle.set(a, []); byArticle.get(a).push(f.id); }
  const arts = [...byArticle.keys()];
  const res = Date.now() - t0 < budget ? await pool(arts, 6, a => views(a, now)) : [];
  const pvSet = [];
  arts.forEach((a, i) => { const r = res[i]; if (!r || r.error) { if (r && r.error && out.errors.length < 5) out.errors.push(a + ": " + r.error); return; }
    for (const id of byArticle.get(a)) { pvSet.push(id, JSON.stringify({ ...r, at: new Date(now).toISOString() })); out.read++; } });
  if (pvSet.length) await kv([["HSET", T.pv, ...pvSet]]);
  await kv([["SET", T.cursor, String(start + batch.length)]]);
  out.ms = Date.now() - t0;
  return out;
}

/* what the council and the console see */
export async function trends() {
  if (!kvReady()) return { films: [], mapped: 0 };
  const [mapRaw, pvRaw, doneRaw, skipRaw] = await kv([["HGETALL", T.map], ["HGETALL", T.pv], ["SMEMBERS", "rc:done"], ["SMEMBERS", "rc:skip"]]);
  const map = hobj(mapRaw), pv = hobj(pvRaw), D = new Set(doneRaw || []), S = new Set(skipRaw || []);
  const films = [...plan().films, ...longFilms()];
  const rows = films.map(f => { let r = null; try { r = pv[f.id] ? JSON.parse(pv[f.id]) : null; } catch { }
    return { film: f.id, title: clip(f.yt_title || f.title, 80), kind: f.kind || "short", article: map[f.id] || "", posted: D.has(f.id), held: S.has(f.id), avg7: r ? r.avg7 : null, base: r ? r.base : null, spike: r ? r.spike : null, at: r ? r.at : "" }; });
  const measured = rows.filter(r => r.avg7 != null);
  const rising = measured.filter(r => !r.posted && !r.held && r.spike != null && r.avg7 >= 300).sort((a, b) => b.spike - a.spike).slice(0, 10);
  const biggest = measured.filter(r => !r.posted && !r.held).sort((a, b) => b.avg7 - a.avg7).slice(0, 10);
  return { mapped: rows.filter(r => r.article && r.article !== "-").length, total: rows.length, measured: measured.length, rising, biggest,
           unmatched: rows.filter(r => r.article === "-").map(r => r.film), rows };
}
export async function setTopic(filmId, article) {
  const a = String(article || "").trim().slice(0, 200);
  await kv([["HSET", T.map, filmId, a || "-"], ["HDEL", T.pv, filmId]]);
  return { ok: true };
}
