/* Residual Continuum · the Studio, shared core
   ===========================================================================
   Everything the console (admin.html), the poster and the AI share: the
   store, the session, the vault for network tokens, the dials, the plan of
   films and which of them the render farm has finished.

   Files that start with "_" are not endpoints. The one endpoint is
   api/studio.js.

   Secrets: none are written here and none are ever sent to the page.
   ADMIN_PASSWORD (Vercel env) opens the console. Network tokens won by the
   console's own Connect buttons are kept in the store, sealed with AES-GCM
   under a key derived from CRON_SECRET, so a leak of the store alone gives
   nothing usable.
--------------------------------------------------------------------------- */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { kv, kvReady } from "./_kv.js";

export { kv, kvReady };
export const env = k => String(process.env[k] || "").trim();
export const SITE = () => (env("PUBLIC_HOST") || "residual-continuum.vercel.app").replace(/^https?:\/\//, "").replace(/\/+$/, "");
export const siteUrl = () => "https://" + SITE();
export const FARM_REPO = () => env("FARM_REPO") || "Eouchi147/rc-render";
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const today = (d = new Date()) => d.toISOString().slice(0, 10);
export const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
export const errText = e => String((e && e.message) || e || "error").slice(0, 200);

/* ------------------------------------------------------------- store keys */
export const K = {
  dials: "rc:dials",
  done: "rc:done",                       // set: film ids that reached at least one network
  posted: "rc:posted",                   // hash: "<film>|<net>" -> {date, slot, id, url, at}
  skip: "rc:skip",                       // set: films held back by hand or by the AI
  pins: "rc:pins",                       // list: films to go next, in this order
  cap: id => "rc:cap:" + id,             // hash: net -> caption written for that network
  slot: (d, h) => "rc:slot:" + d + "#" + String(h).padStart(2, "0"),
  claim: (d, h) => "rc:claim:" + d + "#" + String(h).padStart(2, "0"),
  days: "rc:days",                       // sorted set: slot keys by time, for the calendar
  log: "rc:log",                         // list: newest first, capped
  tok: net => "rc:tok:" + net,           // sealed JSON
  oauth: st => "rc:oauth:" + st,         // a Connect in flight: {net, verifier}
  avail: "rc:avail",                     // cache of the farm's finished films
  runs: "rc:runs",                       // cache of the farm's recent runs
  chat: "rc:chat",                       // list: the console's conversation with the AI
  props: "rc:props",                     // hash: id -> proposal waiting for the owner
  stats: id => "rc:stats:" + id,         // hash: net -> numbers
  login: ip => "rc:login:" + ip,
  ytday: d => "rc:yt:day:" + d,
};

export async function kget(key) { const v = (await kv([["GET", key]]))[0]; if (v == null) return null; try { return JSON.parse(v); } catch { return v; } }
export async function kset(key, val, ex) {
  const c = ["SET", key, typeof val === "string" ? val : JSON.stringify(val)];
  if (ex) c.push("EX", String(ex));
  return (await kv([c]))[0];
}
export async function kdel(key) { return (await kv([["DEL", key]]))[0]; }

export async function log(what, fields = {}) {
  if (!kvReady()) return;
  const row = JSON.stringify({ at: new Date().toISOString(), what, ...fields });
  try { await kv([["LPUSH", K.log, row], ["LTRIM", K.log, "0", "499"]]); } catch { }
}
export async function readLog(n = 80) {
  if (!kvReady()) return [];
  try { return ((await kv([["LRANGE", K.log, "0", String(n - 1)]]))[0] || []).map(s => { try { return JSON.parse(s); } catch { return { what: s }; } }); }
  catch { return []; }
}

/* -------------------------------------------------------------- the vault */
function vaultKey() {
  const s = env("CRON_SECRET") || env("ADMIN_PASSWORD");
  if (!s) return null;
  return crypto.createHash("sha256").update("rc-vault|" + s).digest();
}
export function seal(obj) {
  const key = vaultKey(); if (!key) throw new Error("CRON_SECRET is not set, so tokens cannot be stored safely");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64url")).join(".");
}
export function unseal(s) {
  const key = vaultKey(); if (!key || !s) return null;
  try {
    const [iv, tag, enc] = String(s).split(".").map(x => Buffer.from(x, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));
  } catch { return null; }
}
export async function getTok(net) { if (!kvReady()) return null; try { return unseal((await kv([["GET", K.tok(net)]]))[0]); } catch { return null; } }
export async function putTok(net, obj) { await kv([["SET", K.tok(net), seal({ ...obj, savedAt: new Date().toISOString() })]]); }
export async function dropTok(net) { await kv([["DEL", K.tok(net)]]); }

/* ------------------------------------------------------------ the session */
function sessKey() { const p = env("ADMIN_PASSWORD"); return p ? crypto.createHash("sha256").update("rc-session|" + p).digest() : null; }
const SESSION_DAYS = 14;
export function makeSession() {
  const key = sessKey(); if (!key) return "";
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5, n: crypto.randomBytes(6).toString("hex") })).toString("base64url");
  const mac = crypto.createHmac("sha256", key).update(body).digest("base64url");
  return body + "." + mac;
}
export function readCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
export function isOwner(req) {
  const key = sessKey(); if (!key) return false;
  const t = readCookie(req, "rcs"); if (!t || !t.includes(".")) return false;
  const [body, mac] = t.split(".");
  const want = crypto.createHmac("sha256", key).update(body).digest("base64url");
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch { return false; }
}
export function passwordOk(given) {
  const p = env("ADMIN_PASSWORD"); if (!p || !given) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest(), b = crypto.createHash("sha256").update(p).digest();
  return crypto.timingSafeEqual(a, b);
}
export function isCron(req) {
  const s = env("CRON_SECRET");
  return !!s && String(req.headers.authorization || "") === "Bearer " + s;
}

/* -------------------------------------------------------------- the dials */
/* Threads, Bluesky and Pinterest are written (api/_nets.js) but left out on Sam's word of 1 Oct 2026; add them back here to use them */
export const NETS = ["youtube", "tiktok", "instagram", "facebook", "x"];
export const DEFAULT_DIALS = {
  mode: "approve",            // off: nothing goes out · approve: the post waits for a yes · auto: it goes out on its own
  slots: [14, 22],            // UTC hours a film goes out (14:00 UTC = 10 am New York, 4 pm Paris; 22:00 UTC = 6 pm New York)
  nets: Object.fromEntries(NETS.map(n => [n, true])),
  ai: "propose",              // the AI: propose (every change waits for a yes) · act (it may change dials, order and captions itself)
  aiCaptions: false,          // let the AI write each network's caption before a post (the plan's own captions otherwise)
  start: "",                  // first day the poster may post (YYYY-MM-DD), empty = any day
};
export async function dials() {
  let d = {};
  if (kvReady()) { try { d = (await kget(K.dials)) || {}; } catch { } }
  return { ...DEFAULT_DIALS, ...d, nets: { ...DEFAULT_DIALS.nets, ...(d.nets || {}) } };
}
export async function setDials(patch) {
  const cur = await dials();
  const next = { ...cur, ...patch, nets: { ...cur.nets, ...((patch && patch.nets) || {}) } };
  if (!["off", "approve", "auto"].includes(next.mode)) throw new Error("mode must be off, approve or auto");
  if (!["propose", "act"].includes(next.ai)) throw new Error("ai must be propose or act");
  next.slots = [...new Set((next.slots || []).map(Number).filter(h => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, 6);
  if (next.start && !/^\d{4}-\d{2}-\d{2}$/.test(next.start)) throw new Error("start must be a date, YYYY-MM-DD");
  await kset(K.dials, next);
  return next;
}

/* --------------------------------------------------------------- the plan */
let PLAN = null;
export function plan() {
  if (PLAN) return PLAN;
  const p = path.join(process.cwd(), "studio", "plan.json");
  PLAN = JSON.parse(fs.readFileSync(p, "utf8"));
  return PLAN;
}
export const film = id => plan().films.find(f => f.id === id) || null;
export const videoUrl = id => plan().release + encodeURIComponent(id) + ".mp4";
export const doorUrl = id => siteUrl() + "/api/studio?action=video&id=" + encodeURIComponent(id);

/* What the render farm has finished: the assets of the `films` release on the
   farm's repository, read from GitHub's public API and kept ten minutes. */
async function gh(url) {
  const h = { accept: "application/vnd.github+json", "user-agent": "rc-studio" };
  if (env("GITHUB_TOKEN")) h.authorization = "Bearer " + env("GITHUB_TOKEN");
  let r = await fetch(url, { headers: h });
  if ((r.status === 401 || r.status === 403) && h.authorization) { delete h.authorization; r = await fetch(url, { headers: h }); }
  if (!r.ok) throw new Error("GitHub " + r.status);
  return r.json();
}
export async function available(opts = {}) {
  if (!opts.fresh && kvReady()) { try { const c = await kget(K.avail); if (c && c.at && Date.now() - c.at < 10 * 60e3) return c; } catch { } }
  const out = { at: Date.now(), films: {} };
  try {
    for (let page = 1; page <= 5; page++) {
      const j = await gh(`https://api.github.com/repos/${FARM_REPO()}/releases/tags/films`);
      for (const a of j.assets || []) {
        const m = /^(.+)\.mp4$/.exec(a.name || "");
        if (m) out.films[m[1]] = { size: a.size, at: a.updated_at, downloads: a.download_count };
      }
      break;          // one release answer carries every asset (up to 1,000)
    }
  } catch (e) { out.error = errText(e); }
  if (kvReady() && !out.error) { try { await kset(K.avail, out, 900); } catch { } }
  return out;
}
export async function farmRuns() {
  if (kvReady()) { try { const c = await kget(K.runs); if (c && Date.now() - c.at < 5 * 60e3) return c; } catch { } }
  const out = { at: Date.now(), runs: [] };
  try {
    const j = await gh(`https://api.github.com/repos/${FARM_REPO()}/actions/runs?per_page=12`);
    out.runs = (j.workflow_runs || []).map(r => ({ id: r.id, n: r.run_number, status: r.status, conclusion: r.conclusion,
      at: r.created_at, updated: r.updated_at, url: r.html_url, title: r.display_title }));
  } catch (e) { out.error = errText(e); }
  if (kvReady() && !out.error) { try { await kset(K.runs, out, 600); } catch { } }
  return out;
}

/* The next film: pinned ones first, then the plan's order, skipping what has
   gone out, what is held back and what the farm has not finished. */
export async function nextFilms(n = 10, opts = {}) {
  const av = opts.avail || await available();
  let done = [], skip = [], pins = [];
  if (kvReady()) {
    try { [done, skip, pins] = await kv([["SMEMBERS", K.done], ["SMEMBERS", K.skip], ["LRANGE", K.pins, "0", "-1"]]); } catch { }
  }
  const D = new Set(done || []), S = new Set(skip || []), taken = new Set(opts.taken || []);
  const ok = f => f && !D.has(f.id) && !S.has(f.id) && !taken.has(f.id) && (opts.any || av.films[f.id]);
  const out = [];
  for (const id of pins || []) { const f = film(id); if (ok(f) && !out.includes(f)) out.push(f); }
  for (const f of plan().films) { if (out.length >= n) break; if (ok(f) && !out.includes(f)) out.push(f); }
  return out.slice(0, n);
}

/* ------------------------------------------------- the words for a network */
const tagsOf = f => String(f.hashtags || "").split(/\s+/).filter(t => /^#\w/.test(t));
export function baseText(f) {
  const cap = String(f.caption || "").trim();
  return cap;
}
/* Each network gets its own words. The plan's caption already carries the
   verdict; the sources and the link are added where a network can hold them. */
export function shape(f, net, custom) {
  const link = siteUrl();
  const tags = tagsOf(f);
  const cap = String(custom || baseText(f)).replace(/\bresidualcontinuum\.com\b/g, SITE());
  const src = f.sources ? "Sources: " + f.sources : "";
  switch (net) {
    case "youtube": {
      let t = String(f.title || f.hook).replace(/\s+/g, " ").trim();
      const tail = " #Shorts";
      if (t.length + tail.length > 100) t = clip(t, 100 - tail.length);
      return { title: t + tail, description: [cap, src, "Every case, with its sources: " + link, tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 4900),
               tags: [...new Set(["Residual Continuum", "history", "archaeology", ...tags.map(x => x.slice(1))])].slice(0, 15) };
    }
    case "facebook": return { text: [cap, src, link, tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 5000) };
    case "instagram": return { text: [cap, src, "Every case, with its sources: link in bio.", tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2150) };
    case "tiktok": return { text: [cap, tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2150) };
    case "threads": {
      const t = [f.hook, f.title + ".", (f.verdict ? "Verdict: " + f.verdict + "." : ""), link].filter(Boolean).join("\n\n");
      return { text: custom ? clip(custom, 500) : clip(t, 500) };
    }
    case "x": {
      const head = custom || [f.hook, f.title + ".", (f.verdict ? "Verdict: " + f.verdict + "." : "")].filter(Boolean).join(" ");
      const tag = tags.slice(0, 2).join(" ");
      return { text: clip(head, 280 - 24 - (tag ? tag.length + 1 : 0) - 2) + (tag ? " " + tag : "") + "\n" + link };
    }
    case "bluesky": {
      const head = custom || [f.hook, f.title + ".", (f.verdict ? "Verdict: " + f.verdict + "." : "")].filter(Boolean).join(" ");
      const body = clip(head, 300 - link.length - 2) + "\n" + link;
      return { text: body, link };
    }
    case "pinterest": return { title: clip(f.title, 100), text: clip([f.hook, cap].join(" "), 500), link };
    default: return { text: cap };
  }
}

/* -------------------------------------------------------------- utilities */
export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
export function json(res, code, obj) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = code; res.end(JSON.stringify(obj));
}
export function randomState() { return crypto.randomBytes(18).toString("base64url"); }
export function pkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
