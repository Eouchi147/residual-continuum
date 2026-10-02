/* Residual Continuum · the visit counter, shared part
   ===========================================================================
   Counts visits to the public site without cookies and without keeping
   anything that identifies a person:
     - a page view: the route (the part after #), and for the first view of a
       page load: the kind of website that sent the visitor (instagram,
       google, ...), the country our host reports, the kind of device;
     - a leave: how many seconds the page stayed visible;
     - unique visitors a day: the IP address and the browser string are mixed
       with a secret that changes every day into a 16-character code that
       cannot be turned back, added to a HyperLogLog (which keeps no codes
       either, only an estimate of how many there were). Nothing links one
       day to the next.
   One store command per hit: a small Lua script does all the counting.
   The owner (the console's session cookie) is never counted. Browsers that
   send Global Privacy Control or Do Not Track are not counted at all.
--------------------------------------------------------------------------- */
import crypto from "node:crypto";
import { kv, kvReady } from "./_kv.js";

export const V = {
  day: d => "rc:v:" + d,                 // hash of counts for one UTC day
  uv: d => "rc:v:uv:" + d,               // HyperLogLog of the day's visitor codes
  live: "rc:v:live",                     // sorted set: visitor code -> last seen (ms)
  all: "rc:v:all",                       // hash: all-time pv, v, since
  rl: (code, m) => "rc:v:rl:" + code + ":" + m,
  sum: "rc:v:sum",                       // cache of the console's summary
};
const KEEP = 400 * 86400;                // about 13 months
export const LIMIT_PER_MIN = 40;

/* the Lua that counts a hit: one command, whatever it does */
export const COUNT_LUA = `local n = redis.call('INCR', KEYS[5])
if n == 1 then redis.call('EXPIRE', KEYS[5], 120) end
if n > tonumber(ARGV[1]) then return 0 end
for i = 2, #ARGV, 3 do
  local t, a, b = ARGV[i], ARGV[i+1], ARGV[i+2]
  if t == 'h' then redis.call('HINCRBY', KEYS[1], a, tonumber(b))
  elseif t == 'a' then redis.call('HINCRBY', KEYS[4], a, tonumber(b))
  elseif t == 's' then redis.call('HSETNX', KEYS[4], a, b)
  elseif t == 'p' then redis.call('PFADD', KEYS[2], a)
  elseif t == 'z' then redis.call('ZADD', KEYS[3], tonumber(a), b); redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, tonumber(a) - 600000)
  end
end
redis.call('EXPIRE', KEYS[1], ${KEEP})
redis.call('EXPIRE', KEYS[2], ${KEEP})
return 1`;

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|monitor|uptime|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|scrapy|phantom|selenium|playwright|puppeteer/i;
export const isBot = ua => !ua || ua.length < 20 || BOT.test(ua);

/* the website that sent a visitor, by name only */
const NETS = [
  [/(^|\.)(instagram\.com|ig\.me)$/, "instagram"], [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)threads\.(net|com)$/, "threads"], [/(^|\.)(reddit\.com|redd\.it)$/, "reddit"], [/(^|\.)(bsky\.app|bsky\.social)$/, "bluesky"],
  [/(^|\.)pinterest\./, "pinterest"], [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/(^|\.)duckduckgo\.com$/, "duckduckgo"], [/(^|\.)(yahoo\.|yandex\.|ecosia\.org|brave\.com|qwant\.com)/, "search"],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, "ai"],
  [/(^|\.)(wikipedia\.org|wikimedia\.org)$/, "wikipedia"],
];
export function source(ref, src, ownHost) {
  const s = String(src || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  if (s) { const m = { ig: "instagram", fb: "facebook", yt: "youtube", tt: "tiktok", tw: "x", twitter: "x" }; return m[s] || s; }
  let host = "";
  try { host = new URL(String(ref || "")).hostname.toLowerCase(); } catch { return "direct"; }
  if (!host || host === ownHost || host.endsWith("." + ownHost)) return "direct";
  for (const [re, name] of NETS) if (re.test(host)) return name;
  return "other";
}
export function device(ua) {
  ua = String(ua || "");
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "mobile";
  return "desktop";
}
export function route(r) {
  const x = String(r || "").toLowerCase().replace(/^#\/?/, "").split(/[?&]/)[0].split("/").slice(0, 2).join("/").replace(/[^a-z0-9/_-]/g, "").slice(0, 60);
  return x || "home";
}
export function visitorCode(ip, ua, date, secret) {
  return crypto.createHmac("sha256", "rc-visit|" + (secret || "rc") + "|" + date).update(String(ip) + "|" + String(ua)).digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------- reading */
const hobj = raw => { if (Array.isArray(raw)) { const o = {}; for (let i = 0; i < raw.length; i += 2) o[raw[i]] = raw[i + 1]; return o; } return raw || {}; };
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

/* one day's counts, split by kind */
function shapeDay(d, h, uniques) {
  const out = { d, pv: +h.pv || 0, visits: +h.v || 0, uniques: +uniques || 0, secs: +h.secs || 0, engaged: +h.eng || 0, sources: {}, pages: {}, countries: {}, devices: {} };
  for (const [k, v] of Object.entries(h)) {
    const n = +v || 0;
    if (k.startsWith("r:")) out.sources[k.slice(2)] = n;
    else if (k.startsWith("p:")) out.pages[k.slice(2)] = n;
    else if (k.startsWith("c:")) out.countries[k.slice(2)] = n;
    else if (k.startsWith("d:")) out.devices[k.slice(2)] = n;
  }
  return out;
}
const addInto = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };
const top = (o, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

/* the last `days` UTC days (today included), with totals; cached five minutes */
export async function visitSummary(days = 30, opts = {}) {
  if (!kvReady()) return null;
  if (!opts.fresh) { try { const c = (await kv([["GET", V.sum]]))[0]; if (c) { const j = JSON.parse(c); if (j.days === days && Date.now() - j.at < 5 * 60e3) return j; } } catch { } }
  const now = Date.now(), list = [];
  for (let i = days - 1; i >= 0; i--) list.push(dayStr(now - i * 864e5));
  const cmds = [];
  for (const d of list) cmds.push(["HGETALL", V.day(d)], ["PFCOUNT", V.uv(d)]);
  cmds.push(["ZCOUNT", V.live, String(now - 5 * 60e3), "+inf"], ["HGETALL", V.all]);
  const r = await kv(cmds);
  const series = list.map((d, i) => shapeDay(d, hobj(r[2 * i]), r[2 * i + 1]));
  const live = +r[2 * list.length] || 0, all = hobj(r[2 * list.length + 1]);
  const win = n => { const s = series.slice(-n); const t = { visits: 0, uniques: 0, pv: 0, secs: 0, engaged: 0, sources: {}, pages: {}, countries: {}, devices: {} };
    for (const x of s) { t.visits += x.visits; t.uniques += x.uniques; t.pv += x.pv; t.secs += x.secs; t.engaged += x.engaged; addInto(t.sources, x.sources); addInto(t.pages, x.pages); addInto(t.countries, x.countries); addInto(t.devices, x.devices); }
    t.avgSecs = t.visits ? Math.round(t.secs / t.visits) : 0; t.engagedShare = t.visits ? Math.round(100 * t.engaged / t.visits) : 0;
    t.sources = top(t.sources); t.pages = top(t.pages, 15); t.countries = top(t.countries, 10); t.devices = top(t.devices, 3);
    return t; };
  /* complete days only for the rolling week, so the morning never looks like a drop */
  const prev7 = series.slice(-8, -1), prior7 = series.slice(-15, -8);
  const sum = (l, k) => l.reduce((a, x) => a + x[k], 0);
  const out = { at: now, days, live, today: series[series.length - 1], last7: win(7), last30: win(days), series: series.map(x => ({ d: x.d, visits: x.visits, uniques: x.uniques, pv: x.pv })),
    week: { visits: sum(prev7, "visits"), uniques: sum(prev7, "uniques"), before: { visits: sum(prior7, "visits"), uniques: sum(prior7, "uniques") },
            social: prev7.reduce((a, x) => a + ["instagram", "facebook", "youtube", "tiktok", "x", "threads"].reduce((b, n) => b + (x.sources[n] || 0), 0), 0) },
    allTime: { pv: +all.pv || 0, visits: +all.v || 0, since: all.since || "" } };
  try { await kv([["SET", V.sum, JSON.stringify(out), "EX", "300"]]); } catch { }
  return out;
}
