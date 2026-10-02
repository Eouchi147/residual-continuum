/* Residual Continuum · the Studio, the poster
   ===========================================================================
   Runs every hour (Vercel cron → /api/studio?action=due):

   1. finish   posts a network was still processing last run are asked again
               and published; nothing is ever uploaded twice for them;
   2. slot     at each slot hour (dials.slots, UTC) the next film of the plan
               is chosen. Mode "approve": it waits in the console for a yes.
               Mode "auto": it goes out to every connected network now;
   3. heal     a network that failed for a reason that can pass (a timeout, a
               5xx, a rate limit) is tried again on the next runs, three times
               at most, and never on a network that already has the film.

   A slot is claimed in the store before anything is sent (SET NX, ten
   minutes), so two runs can never send the same slot.
--------------------------------------------------------------------------- */
import { kv, kvReady, K, kget, kset, dials, film, nextFilms, nextLong, available, shape, log, today, errText, NETS } from "./_studio.js";
import { NETWORKS, filmBytes } from "./_nets.js";
import { captionsFor } from "./_director.js";

const ORDER = ["facebook", "instagram", "threads", "bluesky", "youtube", "x", "tiktok", "pinterest"].filter(n => NETS.includes(n));
const HEAL_MAX = 3;
const hh = h => String(h).padStart(2, "0");

export async function readSlot(date, hour) { return kvReady() ? await kget(K.slot(date, hour)) : null; }
async function writeSlot(rec) {
  rec.status = stateOf(rec);
  rec.updated = new Date().toISOString();
  await kv([["SET", K.slot(rec.date, rec.hour), JSON.stringify(rec)],
            ["ZADD", K.days, String(Date.parse(rec.date + "T" + hh(String(rec.hour).replace(/^[A-Z]/, "").slice(0, 2)) + ":00:00Z") || Date.now()), rec.date + "#" + rec.hour]]);
  return rec;
}
export function stateOf(rec) {
  if (rec.status === "queued" || rec.status === "rejected" || rec.status === "skipped") {
    if (!rec.results || !Object.keys(rec.results).length) return rec.status;
  }
  const rs = Object.values(rec.results || {}).filter(r => r && !r.skipped);
  if (!rs.length) return rec.results && Object.keys(rec.results).length ? "nothing" : (rec.status || "queued");
  if (rs.some(r => r.pending)) return "pending";
  if (rs.every(r => r.ok)) return "sent";
  if (rs.some(r => r.ok)) return "partial";
  return "failed";
}

async function notePosted(rec, net, r) {
  if (!r || !r.ok) return;
  await kv([["HSET", K.posted, rec.film + "|" + net, JSON.stringify({ date: rec.date, slot: rec.hour, id: r.id || "", url: r.url || "", at: new Date().toISOString(), private: !!r.private })],
            ["SADD", K.done, rec.film], ["LREM", K.pins, "0", rec.film]]);
}
export async function postedTo(filmId) {
  if (!kvReady()) return {};
  const out = {};
  for (const n of NETS) {
    const v = (await kv([["HGET", K.posted, filmId + "|" + n]]))[0];
    if (v) { try { out[n] = JSON.parse(v); } catch { } }
  }
  return out;
}

/* the words each network will carry, for this film: the AI's, when the dial
   allows it and it wrote them; the plan's otherwise */
export async function compose(f, d) {
  let custom = {};
  try { custom = (await kv([["HGETALL", K.cap(f.id)]]))[0] || {}; } catch { }
  if (Array.isArray(custom)) { const o = {}; for (let i = 0; i < custom.length; i += 2) o[custom[i]] = custom[i + 1]; custom = o; }
  if (d.aiCaptions && !Object.keys(custom).length) {
    try { custom = await captionsFor(f); } catch { custom = {}; }
  }
  const words = {};
  for (const n of NETS) words[n] = shape(f, n, custom[n]);
  return words;
}

/* ------------------------------------------------------------------ send */
export async function sendRecord(rec, opts = {}) {
  const d = await dials();
  const f = film(rec.film); if (!f) throw new Error("no film " + rec.film + " in the plan");
  const t0 = opts.began || Date.now(), budget = opts.budget || 270e3;
  const ctx = { left: () => budget - (Date.now() - t0) };
  rec.results = rec.results || {};
  if (!rec.words) rec.words = await compose(f, d);
  rec.status = "sending"; await writeSlot(rec);
  const nets = ORDER.filter(n => (opts.only ? opts.only === n : true) && (!rec.nets || rec.nets.includes(n)) && d.nets[n] !== false);
  for (const net of nets) {
    const prev = rec.results[net];
    if (prev && (prev.ok || prev.pending) && !opts.force) continue;
    if (ctx.left() < 30e3) { rec.results[net] = { ...(prev || {}), ok: false, late: true, error: "the run ran out of time; it goes on the next run" }; continue; }
    const has = (await kv([["HGET", K.posted, f.id + "|" + net]]))[0];
    if (has && !opts.force) { try { rec.results[net] = { ok: true, already: true, ...JSON.parse(has) }; } catch { } continue; }
    let r;
    try { r = await NETWORKS[net].send(f, rec.words[net], ctx); } catch (e) { r = { ok: false, error: errText(e) }; }
    if (r.pending) await log("pending", { film: f.id, net, note: r.note || "" });
    r.at = new Date().toISOString(); r.tries = ((prev && prev.tries) || 0) + 1;
    rec.results[net] = r;
    await notePosted(rec, net, r);
    await writeSlot(rec);
    if (!r.skipped) await log(r.ok ? "posted" : r.pending ? "pending" : "failed", { film: f.id, net, url: r.url || "", error: r.error || "", note: r.note || "" });
  }
  return writeSlot(rec);
}

/* -------------------------------------------------------------- finishers */
async function recentKeys(days = 3) {
  const since = Date.now() - days * 864e5;
  return (await kv([["ZRANGEBYSCORE", K.days, String(since), "+inf"]]))[0] || [];
}
export async function finishPending(ctx) {
  const out = [];
  for (const key of await recentKeys(3)) {
    if (ctx.left() < 40e3) break;
    const [date, hour] = key.split("#");
    const rec = await readSlot(date, hour); if (!rec || !rec.results) continue;
    let touched = false;
    for (const [net, r] of Object.entries(rec.results)) {
      if (!r || !r.pending || !NETWORKS[net].finish) continue;
      let n; try { n = await NETWORKS[net].finish(r.pending, ctx, rec); } catch (e) { n = { ok: false, pending: r.pending, error: errText(e) }; }
      if (n.pending && r.at && Date.now() - Date.parse(r.at) > 6 * 3600e3) n = { ok: false, error: "the network never finished processing it (6 hours)", gaveUp: true };
      rec.results[net] = { ...r, ...n, pending: n.pending || undefined, finishedAt: new Date().toISOString() };
      if (!n.pending) delete rec.results[net].pending;
      await notePosted(rec, net, rec.results[net]);
      touched = true;
      out.push({ key, net, ok: !!n.ok, pending: !!n.pending });
      if (n.ok) await log("posted", { film: rec.film, net, url: n.url || "", finished: true });
    }
    if (touched) await writeSlot(rec);
  }
  return out;
}
const healable = r => r && !r.ok && !r.pending && !r.skipped && !r.fatal && !r.gaveUp && (r.tries || 0) < HEAL_MAX &&
  (r.late || /timeout|time|5\d\d|429|rate|temporar|network|fetch|ECONN|socket|did not answer/i.test(String(r.error || "")));
export async function heal(ctx) {
  const out = [];
  const d = await dials(); if (d.mode !== "auto") return out;
  for (const key of await recentKeys(2)) {
    if (ctx.left() < 60e3) break;
    const [date, hour] = key.split("#");
    const rec = await readSlot(date, hour); if (!rec || !rec.results || rec.status === "queued") continue;
    for (const [net, r] of Object.entries(rec.results)) {
      if (!healable(r) || ctx.left() < 60e3) continue;
      await sendRecord(rec, { only: net, began: Date.now(), budget: Math.min(120e3, ctx.left() - 20e3) });
      out.push({ key, net });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- slots */
export async function claim(date, hour) {
  return (await kv([["SET", K.claim(date, hour), "1", "NX", "EX", "600"]]))[0] === "OK";
}
export async function openSlot(date, hour, opts = {}) {
  const d = await dials();
  const taken = [];
  for (const k of await recentKeys(2)) { const [dt, h] = k.split("#"); const r = await readSlot(dt, h); if (r && r.film) taken.push(r.film); }
  const pick = opts.film ? film(opts.film) : (await nextFilms(1, { taken }))[0];
  if (!pick) { await log("empty", { date, hour, note: "no finished film is waiting: the render farm has nothing new" }); return null; }
  const rec = { date, hour: String(hour).padStart(2, "0"), film: pick.id, title: pick.title, verdict: pick.verdict, status: "queued", results: {}, at: new Date().toISOString(), by: opts.by || "schedule" };
  rec.words = await compose(pick, d);
  await writeSlot(rec);
  await log("queued", { film: pick.id, date, hour: rec.hour, mode: d.mode });
  return rec;
}

/* the long films: a record "L<hour>" for the film (YouTube, Facebook) and,
   once it has gone out, a record "T<hour>" for its teaser (YouTube Shorts,
   Instagram, TikTok, X), so the teaser can point to the film */
const LONG_NETS = ["youtube", "facebook", "x"];
const TEASER_NETS = ["youtube", "instagram", "tiktok"];
export async function openLong(date, key, opts = {}) {
  const d = await dials();
  const pick = opts.film ? film(opts.film) : (await nextLong(1))[0];
  if (!pick) { await log("empty", { date, hour: key, note: "no long film is waiting" }); return null; }
  const rec = { date, hour: key, kind: "long", film: pick.id, title: pick.yt_title || pick.title, verdict: pick.verdict, nets: LONG_NETS, status: "queued", results: {}, at: new Date().toISOString(), by: opts.by || "schedule" };
  rec.words = await compose(pick, d);
  await writeSlot(rec);
  await log("queued", { film: pick.id, date, hour: key, mode: d.mode, kind: "long" });
  return rec;
}
export async function openTeaser(date, key, longId, opts = {}) {
  const d = await dials();
  const l = film(longId); const t = l && l.teaser ? film(l.teaser) : null;
  if (!t) return null;
  const av = await available();
  if (!av.films[t.id]) { await log("empty", { date, hour: key, note: "the teaser " + t.id + " is not on the release yet" }); return null; }
  const rec = { date, hour: key, kind: "teaser", film: t.id, title: t.title, verdict: t.verdict, nets: TEASER_NETS, status: "queued", results: {}, at: new Date().toISOString(), by: opts.by || "schedule" };
  rec.words = await compose(t, d);
  await writeSlot(rec);
  await log("queued", { film: t.id, date, hour: key, mode: d.mode, kind: "teaser" });
  return rec;
}
async function longDue(d, date, hour, now, ctx, out) {
  const L = d.long || {};
  if (!L.on || !(L.days || []).includes(now.getUTCDay())) return;
  const H = Number(L.hour); if (!(hour >= H && hour - H < 4)) return;
  const lk = "L" + hh(H), tk = "T" + hh(H);
  const rec = await readSlot(date, lk);
  if (!rec) {
    if (ctx.left() < 150e3 || !(await claim(date, lk))) return;
    const r = await openLong(date, lk);
    out.long = r && d.mode === "auto" ? await sendRecord(r, { began: Date.now(), budget: ctx.left() - 20e3 }) : r;
    return;
  }
  if (["queued", "sending", "pending"].includes(rec.status) || (await readSlot(date, tk))) return;
  if (ctx.left() < 90e3 || !(await claim(date, tk))) return;
  const t = await openTeaser(date, tk, rec.film);
  out.teaser = t && d.mode === "auto" ? await sendRecord(t, { began: Date.now(), budget: ctx.left() - 15e3 }) : t;
}

export async function runDue(opts = {}) {
  const began = Date.now(), budget = opts.budget || 280e3;
  const ctx = { left: () => budget - (Date.now() - began) };
  const out = { at: new Date().toISOString(), finished: [], slot: null, healed: [] };
  if (!kvReady()) return { ...out, error: "no store: connect an Upstash Redis store to the Vercel project" };
  out.finished = await finishPending(ctx);
  const d = await dials();
  const now = new Date(), date = today(now), hour = now.getUTCHours();
  if (d.mode !== "off" && (!d.start || date >= d.start)) {
    /* the latest slot hour that has come, within the last three hours: a run
       that was missed catches up, a whole missed day does not flood */
    const due = d.slots.filter(h => h <= hour && hour - h < 3).pop();
    if (due != null && !(await readSlot(date, due)) && await claim(date, due)) {
      const rec = await openSlot(date, due);
      if (rec && d.mode === "auto") out.slot = await sendRecord(rec, { began, budget });
      else out.slot = rec;
    }
    try { await longDue(d, date, hour, now, ctx, out); } catch (e) { out.longError = errText(e); await log("failed", { note: "long films: " + errText(e) }); }
  }
  if (ctx.left() > 90e3) out.healed = await heal(ctx);
  /* The Explorer's heartbeat: it reads the numbers every six hours and thinks once a day */
  if (!opts.noExplorer) {
    try { const E = await import("./_explorer.js"); out.explorer = await E.tick(ctx, now); }
    catch (e) { out.explorerError = errText(e); await log("failed", { note: "The Explorer: " + errText(e) }); }
  }
  return out;
}

/* the owner's hand (or the AI's, once approved) */
export async function approve(date, hour) {
  const rec = await readSlot(date, hour); if (!rec) throw new Error("no such slot");
  if (rec.status !== "queued") throw new Error("that slot is " + rec.status + ", not waiting");
  rec.approvedAt = new Date().toISOString();
  return sendRecord(rec);
}
export async function postNow(filmId, by = "owner") {
  const now = new Date(), date = today(now);
  const hour = hh(now.getUTCHours()) + "m" + hh(now.getUTCMinutes());
  if (!(await claim(date, hour))) throw new Error("a post is already being sent this minute");
  const f = film(filmId);
  const rec = f && f.kind === "long" ? await openLong(date, hour, { film: filmId, by })
            : f && f.kind === "teaser" ? await openTeaser(date, hour, f.long, { by })
            : await openSlot(date, hour, { film: filmId, by });
  if (!rec) throw new Error("nothing to post");
  return sendRecord(rec);
}
export async function retry(date, hour, net) {
  const rec = await readSlot(date, hour); if (!rec) throw new Error("no such slot");
  return sendRecord(rec, { only: net, force: false });
}
export async function reject(date, hour) {
  const rec = await readSlot(date, hour); if (!rec) throw new Error("no such slot");
  rec.status = "rejected"; await writeSlot(rec); return rec;
}
export async function calendar(daysBack = 7, daysAhead = 3) {
  const d = await dials();
  const keys = (await kv([["ZRANGEBYSCORE", K.days, String(Date.now() - daysBack * 864e5), "+inf"]]))[0] || [];
  const recs = [];
  for (const k of keys) { const [dt, h] = k.split("#"); const r = await readSlot(dt, h); if (r) recs.push(r); }
  /* the slots still to come, with the film each would carry today */
  const upcoming = [], taken = recs.map(r => r.film);
  const next = await nextFilms(12, { taken });
  let i = 0;
  for (let day = 0; day <= daysAhead; day++) {
    const dt = today(new Date(Date.now() + day * 864e5));
    for (const h of d.slots) {
      const at = Date.parse(dt + "T" + hh(h) + ":00:00Z");
      if (at <= Date.now() || recs.some(r => r.date === dt && Number(r.hour) === h)) continue;
      upcoming.push({ date: dt, hour: hh(h), at: new Date(at).toISOString(), film: next[i] ? next[i].id : null, title: next[i] ? next[i].title : "nothing finished yet" });
      i++;
    }
  }
  /* and the long films still to come */
  const L = d.long || {};
  if (L.on && (L.days || []).length) {
    const nl = await nextLong(6, { taken: recs.map(r => r.film) });
    let j = 0;
    for (let day = 0; day <= Math.max(daysAhead, 7) && j < nl.length; day++) {
      const when = new Date(Date.now() + day * 864e5), dt = today(when);
      if (!L.days.includes(new Date(dt + "T12:00:00Z").getUTCDay())) continue;
      const at = Date.parse(dt + "T" + hh(L.hour) + ":00:00Z");
      if (at <= Date.now() || recs.some(r => r.date === dt && r.hour === "L" + hh(L.hour))) continue;
      upcoming.push({ date: dt, hour: "L" + hh(L.hour), kind: "long", at: new Date(at).toISOString(), film: nl[j].id, title: "Long film: " + (nl[j].yt_title || nl[j].title) });
      j++;
    }
    upcoming.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return { records: recs.reverse(), upcoming };
}
export { filmBytes, available };
