/* Residual Continuum · the Studio, the AI (The Explorer)
   ===========================================================================
   The console's AI. It reads the whole state of the studio (the plan, what
   the render farm has finished, what went out where, the dials, the
   connections) and answers the owner in plain words. It can also DO things,
   through a short list of actions, and the rule for that is simple:

     - anything that publishes (post now, approve a slot, switch the poster
       to auto) is ALWAYS a proposal: a card in the console with Approve and
       Reject, whatever the dials say;
     - everything else (order, holds, captions, slot hours, which networks)
       is a proposal too while the "ai" dial reads "propose", and is done
       directly once the owner sets it to "act".

   It runs on OpenRouter's free models only, through the site's own picker
   (api/_models.js): the key is the site's OPENROUTER_API_KEY, read on the
   server, never sent to a page.
--------------------------------------------------------------------------- */
import crypto from "node:crypto";
import { chatFree, extractJSON } from "./_models.js";
import { kv, kvReady, K, kget, kset, dials, setDials, plan, film, nextFilms, nextLong, longFilms, available, farmRuns, readLog, shape, NETS, clip, log, errText, siteUrl } from "./_studio.js";

const RULES = `House rules for every word you write for Residual Continuum:
- British spelling. Never an em dash or an en dash: use commas, colons or full stops.
- Never "proves", "proof", "undeniable", "definitely", "certainly", "debunked once and for all". Say "suggests", "the evidence points to", "established", "awaiting evidence", "ruled out by the dates".
- Dates are always hedged ("about", "around", "at least").
- The challenger is presented at their strongest; the mainstream view too. No mockery of anyone.
- Religions are treated with respect; faith is never rated. Only stones, dates, layers and skies are weighed.
- Never invent a fact, a number, a name or a source: use only what the film's own data says.
- Never mention any email address.
- Keep each film's verdict in its exact words (Established, Strong evidence, Plausible, Mixed record, Open question, Awaiting evidence, Ruled out).`;

const BAD = /[—–]|\bproves?\b|\bproof\b|undeniabl|\bdefinitely\b|\bcertainly\b|@[a-z0-9.-]+\.[a-z]{2,}/i;
const LIMIT = { youtube: 4800, facebook: 4800, instagram: 2100, tiktok: 2100, threads: 500, x: 250, bluesky: 270, pinterest: 480 };

/* ----------------------------------------------- captions, one per network */
export async function captionsFor(f) {
  const ask = `Write the post text for one short film, once per network, in the voice of Residual Continuum (a curious friend who has read everything, warm, exact, playful, never sneering).
Film data (the ONLY facts you may use):
${JSON.stringify({ title: f.title, hook: f.hook, verdict: f.verdict, caption: f.caption, hashtags: f.hashtags, sources: f.sources, claim: f.claim })}

Networks and what each wants:
- youtube: 2 short paragraphs + the verdict line. (The sources and the link are added after your text.)
- facebook: same as youtube, a touch more conversational.
- instagram: a strong first line (it is cut after ~125 characters), then 2 short paragraphs, the verdict line, then the hashtags.
- tiktok: one punchy hook line, one line of context, the verdict, the hashtags. Under 300 characters.
- x: under 200 characters, the hook and the verdict. At most one hashtag.

${RULES}

Answer with JSON only: {"youtube":"...","facebook":"...","instagram":"...","tiktok":"...","x":"..."}`;
  const { value } = await chatFree({ messages: [{ role: "user", content: ask }], parse: extractJSON, max_tokens: 1800, temperature: 0.6, title: "Residual Continuum Studio", budgetMs: 40e3 });
  const out = {};
  for (const n of NETS) {
    const t = String((value && value[n]) || "").trim();
    if (!t || BAD.test(t) || t.length > LIMIT[n]) continue;
    if (["youtube", "facebook", "instagram"].includes(n) && !t.toLowerCase().includes(String(f.verdict).toLowerCase())) continue;
    out[n] = t;
  }
  if (Object.keys(out).length && kvReady()) {
    const args = []; for (const [k, v] of Object.entries(out)) args.push(k, v);
    await kv([["HSET", K.cap(f.id), ...args], ["EXPIRE", K.cap(f.id), String(120 * 86400)]]);
  }
  return out;
}

/* ------------------------------------------------------------- the state */
export async function snapshot() {
  const d = await dials();
  const av = await available();
  const p = plan();
  let done = [], skip = [], pins = [];
  if (kvReady()) { try { [done, skip, pins] = await kv([["SMEMBERS", K.done], ["SMEMBERS", K.skip], ["LRANGE", K.pins, "0", "-1"]]); } catch { } }
  const { NETWORKS, netStatus } = await import("./_nets.js");
  const nets = []; for (const n of Object.keys(NETWORKS)) nets.push(await netStatus(n));
  const { calendar } = await import("./_poster.js");
  const cal = kvReady() ? await calendar(5, 2) : { records: [], upcoming: [] };
  const runs = await farmRuns();
  return {
    now: new Date().toISOString(), site: siteUrl(), dials: d,
    films: { planned: p.films.length, rendered: Object.keys(av.films).length, posted: (done || []).length, held: skip || [], pinned: pins || [] },
    next: (await nextFilms(8, { avail: av })).map(f => ({ id: f.id, title: f.title, verdict: f.verdict, order: f.order })),
    waitingForRender: p.films.filter(f => !av.films[f.id]).slice(0, 12).map(f => f.id),
    longFilms: { planned: longFilms().length, onRelease: longFilms().filter(f => av.films[f.id]).length, teasersOnRelease: longFilms().filter(f => f.teaser && av.films[f.teaser]).length,
                 next: (await nextLong(4, { avail: av })).map(f => ({ id: f.id, title: f.yt_title || f.title, verdict: f.verdict })),
                 schedule: "UTC weekdays " + (d.long.days || []).join(",") + " (0 = Sunday) at " + d.long.hour + ":00: the film to YouTube and Facebook, then its teaser to YouTube Shorts, Instagram and TikTok" },
    networks: nets.map(n => ({ net: n.net, connected: n.connected, who: n.who, appReady: n.ready, on: d.nets[n.net] !== false })),
    recent: cal.records.slice(0, 10).map(r => ({ date: r.date, hour: r.hour, film: r.film, status: r.status,
      nets: Object.fromEntries(Object.entries(r.results || {}).map(([k, v]) => [k, v.ok ? "ok" + (v.private ? " (private)" : "") : v.pending ? "pending" : v.skipped ? "not connected" : "failed: " + clip(v.error || "", 80)])) })),
    upcoming: cal.upcoming.slice(0, 6),
    farm: (runs.runs || []).slice(0, 5).map(r => ({ n: r.n, status: r.status, conclusion: r.conclusion, at: r.at })),
  };
}

/* ---------------------------------------------------------------- actions */
const PUBLISHING = new Set(["post_now", "approve", "set_mode"]);
const TOOLS = `Actions you may ask for (each with a short "why"):
- {"tool":"pin","args":{"id":"<film id>"}}            put a film next in line
- {"tool":"unpin","args":{"id":"<film id>"}}
- {"tool":"skip","args":{"id":"<film id>"}}           hold a film back
- {"tool":"unskip","args":{"id":"<film id>"}}
- {"tool":"caption","args":{"id":"<film id>","net":"<network>","text":"..."}}   set a network's words for a film
- {"tool":"write_captions","args":{"id":"<film id>"}} have the AI write every network's words for a film
- {"tool":"set_slots","args":{"hours":[14,22]}}       posting hours, UTC
- {"tool":"set_long","args":{"on":true,"days":[1,3,6],"hour":18}}   the long films' weekdays (UTC, 0 = Sunday) and hour
- {"tool":"set_network","args":{"net":"<network>","on":true}}
- {"tool":"ai_captions","args":{"on":true}}           AI writes captions before each post
- {"tool":"set_mode","args":{"mode":"off|approve|auto"}}   (always waits for the owner)
- {"tool":"approve","args":{"date":"YYYY-MM-DD","hour":"HH"}}  send a queued slot (always waits for the owner)
- {"tool":"post_now","args":{"id":"<film id>"}}       post a film right now (always waits for the owner)
Networks: youtube, tiktok, instagram, facebook, x.`;

export async function doAction(a, by = "owner") {
  const args = a.args || {};
  const P = await import("./_poster.js");
  const need = id => { if (!film(id)) throw new Error("no film called " + id); return id; };
  switch (a.tool) {
    case "pin": await kv([["LREM", K.pins, "0", need(args.id)], ["RPUSH", K.pins, args.id], ["SREM", K.skip, args.id]]); break;
    case "unpin": await kv([["LREM", K.pins, "0", String(args.id)]]); break;
    case "skip": await kv([["SADD", K.skip, need(args.id)], ["LREM", K.pins, "0", args.id]]); break;
    case "unskip": await kv([["SREM", K.skip, String(args.id)]]); break;
    case "caption": {
      need(args.id); if (!NETS.includes(args.net)) throw new Error("no network " + args.net);
      const t = String(args.text || "").trim(); if (!t) throw new Error("empty caption");
      if (BAD.test(t)) throw new Error("the caption breaks the house rules (dash, proof language or an email)");
      if (t.length > LIMIT[args.net]) throw new Error("too long for " + args.net);
      await kv([["HSET", K.cap(args.id), args.net, t]]); break;
    }
    case "write_captions": { const f = film(need(args.id)); const out = await captionsFor(f); await log("ai", { note: "wrote captions for " + f.id + " (" + Object.keys(out).join(", ") + ")" }); return { ok: true, wrote: Object.keys(out) }; }
    case "set_slots": await setDials({ slots: args.hours }); break;
    case "set_long": { const cur = (await dials()).long; await setDials({ long: { on: args.on == null ? cur.on : !!args.on, days: args.days || cur.days, hour: args.hour == null ? cur.hour : args.hour } }); break; }
    case "set_network": await setDials({ nets: { [args.net]: !!args.on } }); break;
    case "ai_captions": await setDials({ aiCaptions: !!args.on }); break;
    case "set_mode": await setDials({ mode: args.mode }); break;
    case "approve": return { ok: true, record: await P.approve(args.date, args.hour) };
    case "post_now": return { ok: true, record: await P.postNow(need(args.id), by) };
    default: throw new Error("unknown action " + a.tool);
  }
  await log("action", { tool: a.tool, args, by });
  return { ok: true };
}

export async function proposals() {
  if (!kvReady()) return [];
  const raw = (await kv([["HGETALL", K.props]]))[0] || [];
  const list = [];
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) { try { list.push(JSON.parse(raw[i + 1])); } catch { } } }
  else for (const v of Object.values(raw)) { try { list.push(JSON.parse(v)); } catch { } }
  return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
async function propose(a) {
  const id = crypto.randomBytes(6).toString("hex");
  const p = { id, tool: a.tool, args: a.args || {}, why: clip(a.why || "", 300), at: new Date().toISOString() };
  await kv([["HSET", K.props, id, JSON.stringify(p)]]);
  return p;
}
export async function decide(id, yes) {
  const v = (await kv([["HGET", K.props, id]]))[0]; if (!v) throw new Error("no such proposal");
  await kv([["HDEL", K.props, id]]);
  const p = JSON.parse(v);
  if (!yes) { await log("ai", { note: "proposal rejected: " + p.tool }); return { ok: true, rejected: true }; }
  return doAction(p, "AI, approved by owner");
}

/* ------------------------------------------------------------------- chat */
export async function chat(message) {
  const d = await dials();
  let history = [];
  try { history = ((await kv([["LRANGE", K.chat, "0", "13"]]))[0] || []).map(s => JSON.parse(s)).reverse(); } catch { }
  const snap = await snapshot();
  const sys = `You are The Explorer, the AI of the Residual Continuum studio: you run the publishing with its owner, Sam, so that he never has to post anything by hand. Residual Continuum publishes continuous animated films that weigh history's mysteries fairly (every claim sourced, every verdict graded): short films (vertical, about 2 minutes) twice a day to every connected network, and long deep dives (16:9, about 10 minutes) on set weekdays to YouTube and Facebook, each followed by its vertical teaser on YouTube Shorts, Instagram and TikTok.

What you do: answer Sam clearly and briefly; spot problems (a network failing, nothing rendered, a token expired, a slot empty) and say what to do; plan the posting order for reach (strong hooks first, variety of Files, a ledger film after the last case of its File); write and fix captions; and act through the actions below. Never claim a post went out unless the state says ok. Never invent numbers.

${RULES}

${TOOLS}

The "ai" dial is "${d.ai}": ${d.ai === "act" ? "your non-publishing actions are carried out at once; publishing ones wait for Sam" : "every action you ask for becomes a proposal card that Sam approves or rejects"}.

The studio right now:
${JSON.stringify(snap)}

Answer with JSON only: {"reply":"<your answer to Sam, plain text, short paragraphs or a short list>","actions":[...]}. Use an empty list when no action is needed. Ask for an action only when Sam asked for it or it clearly fixes a problem you named.`;
  const messages = [{ role: "system", content: sys }, ...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: String(message || "").slice(0, 4000) }];
  const { value, model } = await chatFree({ messages, parse: extractJSON, max_tokens: 1400, temperature: 0.3, title: "Residual Continuum Studio", budgetMs: 45e3 });
  const reply = String((value && value.reply) || "").trim() || "(no answer)";
  const done = [], props = [];
  for (const a of (Array.isArray(value && value.actions) ? value.actions : []).slice(0, 6)) {
    if (!a || !a.tool) continue;
    try {
      if (PUBLISHING.has(a.tool) || d.ai !== "act") props.push(await propose(a));
      else { await doAction(a, "AI"); done.push({ tool: a.tool, args: a.args }); }
    } catch (e) { done.push({ tool: a.tool, error: errText(e) }); }
  }
  if (kvReady()) {
    await kv([["LPUSH", K.chat, JSON.stringify({ role: "user", content: String(message).slice(0, 4000), at: new Date().toISOString() })],
              ["LPUSH", K.chat, JSON.stringify({ role: "assistant", content: reply, at: new Date().toISOString(), model, done, props: props.map(p => p.id) })],
              ["LTRIM", K.chat, "0", "59"]]);
  }
  return { reply, model, done, proposals: props };
}
export async function chatHistory() {
  if (!kvReady()) return [];
  try { return ((await kv([["LRANGE", K.chat, "0", "39"]]))[0] || []).map(s => JSON.parse(s)).reverse(); } catch { return []; }
}
