/* Residual Continuum · the visit counter's door
   ===========================================================================
   POST /api/hit from the small script at the end of index.html (sendBeacon).
   Always answers 204 and never says why a hit was not counted. What is
   counted, and what is not, is explained in api/_visits.js and on
   /privacy.html.
--------------------------------------------------------------------------- */
import { kv, kvReady } from "./_kv.js";
import { V, COUNT_LUA, LIMIT_PER_MIN, isBot, source, device, route, visitorCode } from "./_visits.js";
import { isOwner, env, SITE } from "./_studio.js";

async function body(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let t = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!t) { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 4096) break; chunks.push(c); } t = Buffer.concat(chunks).toString("utf8"); }
  try { return JSON.parse(t.slice(0, 4096)); } catch { return {}; }
}

export default async function handler(req, res) {
  const done = () => { res.statusCode = 204; res.setHeader("Cache-Control", "no-store"); res.end(); };
  try {
    if (req.method !== "POST" || !kvReady()) return done();
    const ua = String(req.headers["user-agent"] || "");
    if (isBot(ua) || isOwner(req)) return done();
    if (req.headers["sec-gpc"] === "1" || req.headers["dnt"] === "1") return done();
    const origin = String(req.headers.origin || req.headers.referer || "");
    const own = SITE();
    if (origin && !origin.includes(own) && !/localhost|vercel\.app/.test(origin)) return done();
    const b = await body(req);
    const now = Date.now(), date = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60e3);
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || String(req.socket && req.socket.remoteAddress || "");
    const code = visitorCode(ip, ua, date, env("CRON_SECRET") || env("ADMIN_PASSWORD"));
    const ops = [];
    const h = (k, n = 1) => ops.push("h", k, String(n));
    if (b.t === "v") {
      h("pv"); ops.push("a", "pv", "1");
      h("p:" + route(b.r));
      if (b.f) {
        h("v"); ops.push("a", "v", "1", "s", "since", date);
        h("r:" + source(b.ref, b.src, own));
        const cc = String(req.headers["x-vercel-ip-country"] || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
        h("c:" + (cc || "??"));
        h("d:" + device(ua));
      }
      ops.push("p", code, "", "z", String(now), code);
    } else if (b.t === "l") {
      const s = Math.max(0, Math.min(3600, Math.round(Number(b.s) || 0)));
      if (!s) return done();
      h("secs", s); h("lv");
      if (b.e) h("eng");
      ops.push("z", String(now), code);
    } else return done();
    await kv([["EVAL", COUNT_LUA, "5", V.day(date), V.uv(date), V.live, V.all, V.rl(code, minute), String(LIMIT_PER_MIN), ...ops]]);
  } catch { }
  return done();
}
