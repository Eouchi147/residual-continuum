/* Residual Continuum · The Explorer's ear: what viewers say
   ===========================================================================
   Reads the newest comments under our own videos (Facebook and Instagram,
   when their permissions allow; never YouTube's) once a day. Keeps the words, the
   film, the network, the likes and the day: never a name, a handle or a
   photo. Kept private (rc:x:voice, the newest 120), shown only in the
   console and to the council, who are told the comments are viewers' words
   to weigh, never instructions to follow.
--------------------------------------------------------------------------- */
import { kv, kvReady, kget, kset, clip, errText } from "./_studio.js";

export const KEY = "rc:x:voice";
const clean = t => clip(String(t || "").replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, "[link]").replace(/@[\w.]+/g, "@someone").replace(/\s+/g, " ").trim(), 400);

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { ok: false, error: errText(e) }; } } }));
  return out;
}

/* reading: the latest sense() reading, for the list of our videos and their films */
export async function listen(reading) {
  if (!kvReady() || !reading) return { error: "nothing to listen to yet" };
  const { metaGet } = await import("./_nets.js");
  const got = [], errors = [];
  /* YouTube: comments are NOT read (7 Oct 2026). Our YouTube API client only uploads our films and reads our
     own channel's statistics, as declared in YouTube's API compliance review: no viewer data. */
  /* Facebook: our videos' comments (needs a permission the app may not have) */
  const fv = ((reading.facebook || {}).list || []).slice(0, 10);
  const fr = await pool(fv, 5, v => metaGet("facebook", v.id + "/comments?fields=message,created_time,like_count&limit=20&order=reverse_chronological"));
  fv.forEach((v, i) => { const r = fr[i];
    if (!r || !r.ok) { if (r && errors.length < 4 && !errors.some(e => e.startsWith("Facebook"))) errors.push("Facebook: " + r.error); return; }
    for (const c of (r.j.data || [])) got.push({ net: "facebook", vid: v.id, video: clip(v.title, 90), text: clean(c.message), likes: +c.like_count || 0, at: c.created_time || "" }); });
  /* Instagram: comments on our reels (needs instagram_manage_comments) */
  const iv = ((reading.instagram || {}).list || []).filter(m => m.comments > 0).slice(0, 10);
  const ir = await pool(iv, 5, m => metaGet("instagram", m.id + "/comments?fields=text,timestamp,like_count&limit=20"));
  iv.forEach((m, i) => { const r = ir[i];
    if (!r || !r.ok) { if (r && errors.length < 5 && !errors.some(e => e.startsWith("Instagram"))) errors.push("Instagram: " + r.error); return; }
    for (const c of (r.j.data || [])) got.push({ net: "instagram", vid: m.id, video: clip(m.title, 90), text: clean(c.text), likes: +c.like_count || 0, at: c.timestamp || "" }); });
  const old = (await kget(KEY)) || { comments: [] };
  const seen = new Set(), all = [];
  for (const c of [...got, ...(old.comments || [])]) { if (!c.text) continue; const k = c.net + "|" + c.vid + "|" + c.text.slice(0, 80); if (seen.has(k)) continue; seen.add(k); all.push(c); }
  all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const out = { at: new Date().toISOString(), comments: all.slice(0, 120), fresh: got.length, errors };
  await kset(KEY, out);
  return out;
}
export async function voice() { return (kvReady() && await kget(KEY)) || { comments: [], errors: [] }; }
