/* Residual Continuum · the Studio endpoint
   ===========================================================================
   One door for the console (admin.html), the poster's hourly cron, the
   networks' OAuth returns and the films' own bytes.

   Public:   ?action=video&id=<film>   the film as video/mp4, with ranges
             ?action=me                is the console unlocked, is it set up
             POST login                {password}
   Cron:     ?action=due               (Authorization: Bearer CRON_SECRET)
   Owner:    everything else, with the session cookie and the x-rc header.
--------------------------------------------------------------------------- */
import { Readable } from "node:stream";
import { env, kv, kvReady, K, kget, kset, json, readBody, isOwner, isCron, passwordOk, makeSession, dials, setDials, plan, film,
         available, farmRuns, readLog, nextFilms, nextLong, longFilms, videoUrl, randomState, pkce, siteUrl, errText, NETS, shape } from "./_studio.js";
import { NETWORKS, netStatus } from "./_nets.js";
import { runDue, calendar, approve, reject, retry, postNow, readSlot, postedTo, compose } from "./_poster.js";
import { chat, chatHistory, proposals, decide, doAction, captionsFor, snapshot } from "./_director.js";

const COOKIE = (v, maxAge) => `rcs=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const RELEASE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//;
const HOSTS = [/^github\.com$/, /^objects\.githubusercontent\.com$/, /^release-assets\.githubusercontent\.com$/];

async function door(req, res, id) {
  if (!film(id)) return json(res, 404, { error: "no such film" });
  let url = videoUrl(id);
  try {
    const h = await fetch(url, { method: "HEAD", redirect: "manual" });
    const loc = h.headers.get("location"); if (loc && /^https:\/\//.test(loc)) url = loc;
  } catch { }
  try { if (!HOSTS.some(re => re.test(new URL(url).hostname))) return json(res, 502, { error: "the film is not where it should be" }); } catch { return json(res, 502, { error: "bad film url" }); }
  const head = {}; if (req.headers.range) head.range = req.headers.range;
  const up = await fetch(url, { headers: head });
  if (!up.ok && up.status !== 206) return json(res, up.status === 404 ? 404 : 502, { error: "the render farm has not published this film yet (" + up.status + ")" });
  res.statusCode = up.status;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Disposition", 'inline; filename="' + id.replace(/[^A-Za-z0-9._-]/g, "") + '.mp4"');
  for (const k of ["content-length", "content-range", "etag", "last-modified"]) { const v = up.headers.get(k); if (v) res.setHeader(k, v); }
  if (req.method === "HEAD") return res.end();
  Readable.fromWeb(up.body).pipe(res);
}

async function setupState() {
  return {
    password: !!env("ADMIN_PASSWORD"), store: kvReady(), cron: !!env("CRON_SECRET"), ai: !!env("OPENROUTER_API_KEY"),
    site: siteUrl(),
  };
}

async function overview() {
  const [d, av, runs, log, props] = await Promise.all([dials(), available(), farmRuns(), readLog(60), proposals()]);
  const p = plan();
  let done = [], skip = [], pins = [], posted = {};
  if (kvReady()) {
    [done, skip, pins, posted] = await kv([["SMEMBERS", K.done], ["SMEMBERS", K.skip], ["LRANGE", K.pins, "0", "-1"], ["HGETALL", K.posted]]);
    if (Array.isArray(posted)) { const o = {}; for (let i = 0; i < posted.length; i += 2) o[posted[i]] = posted[i + 1]; posted = o; }
  }
  const perNet = Object.fromEntries(NETS.map(n => [n, 0]));
  for (const k of Object.keys(posted || {})) { const n = k.split("|")[1]; if (n in perNet) perNet[n]++; }
  const nets = []; for (const n of Object.keys(NETWORKS)) nets.push(await netStatus(n));
  const cal = kvReady() ? await calendar(10, 3) : { records: [], upcoming: [] };
  return {
    dials: d, setup: await setupState(),
    films: { planned: p.films.length, rendered: p.films.filter(f => av.films[f.id]).length, posted: p.films.filter(f => (done || []).includes(f.id)).length, held: (skip || []).length, pinned: pins || [], farmError: av.error || "" },
    long: { planned: longFilms().length, rendered: longFilms().filter(f => av.films[f.id]).length, teasers: longFilms().filter(f => f.teaser && av.films[f.teaser]).length,
            posted: longFilms().filter(f => (done || []).includes(f.id)).length, next: (await nextLong(3, { avail: av })).map(f => ({ id: f.id, title: f.yt_title || f.title })) },
    perNet, nets, calendar: cal, farm: runs, log, proposals: props,
    explorer: await import("./_explorer.js").then(async E => { const t = await E.lastThink(); return { ...(await E.brief()), summary: t ? (t.analysis || {}).summary || "" : "", plan: t ? t.plan || "" : "" }; }).catch(() => null),
  };
}

async function planView() {
  const av = await available();
  let done = [], skip = [], pins = [], posted = {};
  if (kvReady()) {
    [done, skip, pins, posted] = await kv([["SMEMBERS", K.done], ["SMEMBERS", K.skip], ["LRANGE", K.pins, "0", "-1"], ["HGETALL", K.posted]]);
    if (Array.isArray(posted)) { const o = {}; for (let i = 0; i < posted.length; i += 2) o[posted[i]] = posted[i + 1]; posted = o; }
  }
  const nets = {}; for (const k of Object.keys(posted || {})) { const [id, n] = k.split("|"); (nets[id] = nets[id] || []).push(n); }
  const D = new Set(done || []), S = new Set(skip || []);
  return plan().films.map(f => ({ order: f.order, id: f.id, code: f.code, title: f.title, hook: f.hook, verdict: f.verdict, series: f.series,
    rendered: !!av.films[f.id], size: av.films[f.id] ? av.films[f.id].size : 0, posted: D.has(f.id), nets: nets[f.id] || [], held: S.has(f.id), pinned: (pins || []).indexOf(f.id) + 1 }));
}

async function ytStats() {
  if (!kvReady()) return {};
  const cached = await kget("rc:ytstats"); if (cached && Date.now() - cached.at < 3600e3) return cached;
  let posted = (await kv([["HGETALL", K.posted]]))[0] || {};
  if (Array.isArray(posted)) { const o = {}; for (let i = 0; i < posted.length; i += 2) o[posted[i]] = posted[i + 1]; posted = o; }
  const ids = {}; for (const [k, v] of Object.entries(posted)) { if (!k.endsWith("|youtube")) continue; try { const r = JSON.parse(v); if (r.id) ids[r.id] = k.split("|")[0]; } catch { } }
  const s = await NETWORKS.youtube.stats(Object.keys(ids)).catch(() => ({}));
  const out = { at: Date.now(), films: {} };
  for (const [vid, n] of Object.entries(s)) out.films[ids[vid]] = n;
  await kset("rc:ytstats", out, 3600);
  return out;
}

export default async function handler(req, res) {
  const q = Object.fromEntries(new URL(req.url, "https://x").searchParams);
  const action = q.action || "";
  try {
    /* ----------------------------------------------------- public doors */
    if (action === "video") return await door(req, res, String(q.id || ""));
    if (action === "me") return json(res, 200, { owner: isOwner(req), setup: await setupState() });
    if (action === "login" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
      if (kvReady()) {
        const n = (await kv([["INCR", K.login(ip)], ["EXPIRE", K.login(ip), "900"]]))[0];
        if (n > 8) return json(res, 429, { error: "too many tries; wait fifteen minutes" });
      }
      const b = await readBody(req);
      if (!env("ADMIN_PASSWORD")) return json(res, 503, { error: "ADMIN_PASSWORD is not set in Vercel yet" });
      if (!passwordOk(b.password)) return json(res, 401, { error: "wrong password" });
      res.setHeader("Set-Cookie", COOKIE(makeSession(), 14 * 86400));
      return json(res, 200, { ok: true });
    }
    if (action === "logout") { res.setHeader("Set-Cookie", COOKIE("", 0)); return json(res, 200, { ok: true }); }
    if (action === "due") {
      if (!isCron(req) && !isOwner(req)) return json(res, 401, { error: "cron only" });
      return json(res, 200, await runDue());
    }

    /* ------------------------------------------------------ owner only */
    if (!isOwner(req)) return json(res, 401, { error: "locked" });
    if (req.method === "POST" && req.headers["x-rc"] !== "1") return json(res, 403, { error: "missing x-rc header" });

    if (action === "callback") {
      const st = String(q.state || ""), net = String(q.net || "");
      const saved = kvReady() ? await kget(K.oauth(st)) : null;
      const back = (msg, ok) => { res.statusCode = 302; res.setHeader("Location", "/admin#networks?" + new URLSearchParams({ net, ok: ok ? "1" : "0", msg }).toString()); res.end(); };
      if (!saved || saved.net !== net) return back("this sign-in link expired; press Connect again", false);
      await kv([["DEL", K.oauth(st)]]);
      if (q.error) return back(String(q.error_description || q.error).slice(0, 200), false);
      const r = await NETWORKS[net].exchange(String(q.code || ""), saved.pk);
      return back(r.ok ? "connected " + (r.who || "") : String(r.error || "failed"), r.ok);
    }

    if (["explorer_sense", "explorer_think", "explorer_order"].includes(action) && req.method !== "POST") return json(res, 405, { error: "POST only" });
    const b = req.method === "POST" ? await readBody(req) : {};
    const A = { ...q, ...b };
    switch (action) {
      case "overview": return json(res, 200, await overview());
      case "plan": return json(res, 200, { films: await planView() });
      case "film": {
        const f = film(String(A.id)); if (!f) return json(res, 404, { error: "no such film" });
        const d = await dials();
        return json(res, 200, { film: f, words: await compose(f, { ...d, aiCaptions: false }), posted: await postedTo(f.id), video: siteUrl() + "/api/studio?action=video&id=" + encodeURIComponent(f.id) });
      }
      case "slot": return json(res, 200, { record: await readSlot(String(A.date), String(A.hour)) });
      case "dials": return json(res, 200, { dials: req.method === "POST" ? await setDials(A.patch || {}) : await dials() });
      case "networks": { const out = []; for (const n of Object.keys(NETWORKS)) out.push(await netStatus(n)); return json(res, 200, { networks: out }); }
      case "connect": {
        const net = String(A.net); const N = NETWORKS[net]; if (!N) return json(res, 404, { error: "no such network" });
        if (N.kind !== "oauth") return json(res, 400, { error: "this network connects with a form" });
        if (!N.ready()) return json(res, 400, { error: "set " + N.vars.join(" and ") + " in Vercel first" });
        const st = randomState(), pk = pkce();
        await kset(K.oauth(st), { net, pk }, 900);
        return json(res, 200, { url: N.connectUrl(st, pk) });
      }
      case "connect_form": {
        const N = NETWORKS[String(A.net)]; if (!N || !N.connectForm) return json(res, 400, { error: "not a form network" });
        return json(res, 200, await N.connectForm(A.values || {}));
      }
      case "disconnect": { if (!NETWORKS[A.net]) return json(res, 404, { error: "no such network" }); await kv([["DEL", K.tok(A.net)]]); return json(res, 200, { ok: true }); }
      case "approve": return json(res, 200, { record: await approve(String(A.date), String(A.hour)) });
      case "reject": return json(res, 200, { record: await reject(String(A.date), String(A.hour)) });
      case "retry": return json(res, 200, { record: await retry(String(A.date), String(A.hour), String(A.net)) });
      case "post_now": return json(res, 200, { record: await postNow(String(A.id)) });
      /* a film that went out on a network by hand (YouTube Studio, while the
         API audit is pending): recorded so the poster never sends it twice */
      case "mark": {
        const f = film(String(A.id)); if (!f) return json(res, 404, { error: "no such film" });
        const net = String(A.net); if (!NETS.includes(net)) return json(res, 400, { error: "no such network" });
        await kv([["HSET", K.posted, f.id + "|" + net, JSON.stringify({ date: String(A.date || ""), slot: "hand", id: String(A.vid || ""), url: String(A.url || ""), at: new Date().toISOString(), by: "hand" })]]);
        return json(res, 200, { ok: true });
      }
      case "do": return json(res, 200, await doAction({ tool: A.tool, args: A.args || {} }, "owner"));
      case "chat": return json(res, 200, await chat(String(A.message || "")));
      case "chat_history": return json(res, 200, { chat: await chatHistory() });
      case "proposal": return json(res, 200, await decide(String(A.id), !!A.yes));
      case "captions": return json(res, 200, { captions: await captionsFor(film(String(A.id))) });
      case "stats": return json(res, 200, await ytStats());
      case "probe_fb_long": { const { probeFbLong } = await import("./_nets.js"); return json(res, 200, await probeFbLong(String(A.id || "lf-demo"))); }
      case "snapshot": return json(res, 200, await snapshot());
      /* The Explorer's room: its mind, its numbers, its record */
      case "explorer": { const E = await import("./_explorer.js"); return json(res, 200, await E.room()); }
      case "explorer_sense": { const E = await import("./_explorer.js"); await E.sense("asked by Sam"); return json(res, 200, await E.room()); }
      case "explorer_think": { const E = await import("./_explorer.js"); const r = await E.think(); return json(res, 200, { think: r }); }
      case "explorer_goals": { const E = await import("./_explorer.js"); return json(res, 200, { goals: req.method === "POST" ? await E.setGoals(A.goals || {}) : await E.goals() }); }
      case "explorer_order": { const E = await import("./_explorer.js"); return json(res, 200, { order: A.id ? await E.closeOrder(String(A.id), String(A.status || "done"), String(A.note || "")) : await E.addOrder({ for: A.for, title: A.title, why: A.why }, "Sam") }); }
      case "refresh": await available({ fresh: true }); return json(res, 200, { ok: true });
      default: return json(res, 400, { error: "unknown action" });
    }
  } catch (e) {
    return json(res, 500, { error: errText(e) });
  }
}
