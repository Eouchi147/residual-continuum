/* Residual Continuum · The Explorer's course keeper
   ===========================================================================
   Plain arithmetic, no model: where each goal stands against its date, how
   many days of films are left before the queue runs dry, and what is broken.
   The council reads these; the console shows them; and once a day the
   Explorer files a work order when the runway is short or something needs
   Sam's hand.
--------------------------------------------------------------------------- */
import { kv, kvReady, kget, dials, plan, longFilms, available, today, K } from "./_studio.js";

const dayOf = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/* a goal against its date: the pace it needs and the pace it has */
export function courseOf(g, todayStr) {
  const out = { status: "no data" };
  if (g.value == null) return out;
  if (g.value >= g.target) return { status: "reached" };
  if (!g.by) return { status: "no date" };
  const left = Math.round((Date.parse(g.by + "T12:00:00Z") - Date.parse(todayStr + "T12:00:00Z")) / 864e5);
  if (left <= 0) return { status: "missed", daysLeft: left };
  const need = Math.round(10 * (g.target - g.value) / left) / 10;
  if (g.perDay == null) return { status: "too early", need, daysLeft: left };
  const status = g.perDay >= need ? "on track" : g.perDay >= need * 0.5 ? "behind" : "off track";
  return { status, need, daysLeft: left };
}
export function headingOf(goals) {
  const judged = goals.filter(g => ["on track", "behind", "off track", "reached", "missed"].includes(g.status));
  if (!judged.length) return { score: null, line: "Too early to judge the course: it needs a few days of numbers." };
  const pts = { reached: 1, "on track": 1, behind: 0.5, "off track": 0, missed: 0 };
  const score = Math.round(100 * judged.reduce((a, g) => a + pts[g.status], 0) / judged.length);
  const off = judged.filter(g => g.status === "off track" || g.status === "behind").map(g => g.label);
  return { score, line: off.length ? "Needs attention: " + off.join("; ") + "." : "Every goal with a date is on track." };
}

/* how long the films that are ready will last */
export async function runway() {
  const d = await dials(), av = await available();
  let done = [], skip = [];
  if (kvReady()) { try { [done, skip] = await kv([["SMEMBERS", K.done], ["SMEMBERS", K.skip]]); } catch { } }
  const D = new Set(done || []), S = new Set(skip || []);
  const t = today();
  const shortsReady = plan().films.filter(f => av.films[f.id] && !D.has(f.id) && !S.has(f.id)).length;
  const shortsUnrendered = plan().films.filter(f => !av.films[f.id] && !D.has(f.id)).length;
  const perDay = d.mode === "off" ? 0 : (d.slots || []).length;
  const longReady = longFilms().filter(f => av.films[f.id] && !D.has(f.id) && !S.has(f.id)).length;
  const perWeek = d.long && d.long.on ? (d.long.days || []).length : 0;
  const sDays = perDay ? Math.floor(shortsReady / perDay) : null, lWeeks = perWeek ? Math.floor(10 * longReady / perWeek) / 10 : null;
  return {
    shorts: { ready: shortsReady, notRendered: shortsUnrendered, perDay, days: sDays, until: sDays != null ? dayOf(t, sDays) : null },
    long: { ready: longReady, perWeek, weeks: lWeeks, until: lWeeks != null ? dayOf(t, Math.floor(lWeeks * 7)) : null },
    farmError: av.error || "",
  };
}

/* what is broken or slipping, most serious first */
export async function health(beat = {}, reading = null, lastThink = null) {
  const issues = [];
  /* title: the same words every day for the same trouble, so a work order is never filed twice */
  const add = (level, text, fix, title) => issues.push({ level, text, fix, title: title || text });
  const now = Date.now();
  const d = await dials();
  if (!beat.run || now - Date.parse(beat.run) > 2.5 * 3600e3) add("high", "The hourly runs have stopped" + (beat.run ? " (last one " + Math.round((now - Date.parse(beat.run)) / 3600e3) + " h ago)" : ""), "Check the Vercel crons for /api/studio?action=due", "The hourly runs have stopped");
  /* the last two days of posts */
  try {
    const { calendar } = await import("./_poster.js");
    const cal = await calendar(2, 0);
    const fails = {}, stuck = [];
    for (const r of cal.records || []) for (const [net, x] of Object.entries(r.results || {})) {
      if (!x) continue;
      if (x.pending && r.at && now - Date.parse(r.at) > 3 * 3600e3) stuck.push(net + " (" + r.film + ")");
      if (!x.ok && !x.pending && !x.skipped) (fails[net] = fails[net] || []).push(String(x.error || "failed").slice(0, 90));
    }
    for (const [net, list] of Object.entries(fails)) add(list.length >= 2 ? "high" : "medium", `${net}: ${list.length} failed post${list.length > 1 ? "s" : ""} in two days (${list[0]})`, /token|expired|session|permission|oauth|login/i.test(list.join(" ")) ? "Reconnect " + net + " in the console (Networks)" : "Open the Schedule and press Retry, or ask in Talk", "Posts to " + net + " keep failing");
    if (stuck.length) add("medium", "Posts still processing after three hours: " + stuck.slice(0, 4).join(", "), "Usually clears on the next run; if not, Retry in the Schedule", "Posts stuck in processing");
  } catch { }
  /* switched on but not connected */
  try {
    const { NETWORKS, netStatus } = await import("./_nets.js");
    for (const n of Object.keys(NETWORKS)) { if (d.nets[n] === false) continue; const s = await netStatus(n); if (!s.connected && n !== "tiktok") add("medium", n + " is switched on but not connected", "Connect it in the console (Networks), or switch it off", "Connect " + n + " or switch it off"); }
  } catch { }
  if (reading) for (const n of ["youtube", "facebook", "instagram"]) if (reading[n] && reading[n].error) add("low", "Cannot read " + n + "'s numbers: " + String(reading[n].error).slice(0, 120), "Usually a permission or a token; reconnect the network if it lasts");
  if (!lastThink || now - Date.parse(lastThink.at) > 30 * 3600e3) add("medium", "The Explorer has not thought for more than a day", "Press Think now in its room, or check the free models in Talk");
  else if (!lastThink.plan) add("low", "The last thinking produced no plan (" + String((lastThink.errors || [])[0] || "free models").slice(0, 100) + ")", "It tries again on the next hourly run, up to three times a day");
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + (i.level === "high" ? 35 : i.level === "medium" ? 15 : 5), 0));
  return { score, issues };
}
