/* Residual Continuum · the Studio, one module per network
   ===========================================================================
   Every network answers the same five questions:

     ready()            are the app's own credentials in Vercel (or none needed)?
     connectUrl(st)     where the owner goes to say yes (OAuth networks)
     exchange(code, st) the yes, traded for tokens, which go into the vault
     send(film, words)  one film out; never throws; {ok, id, url} | {pending} | {error}
     finish(pending)    a post the network was still processing last run

   Lessons carried over from the NOOR poster (api/social.js there), kept here
   because each one cost a real post once:
   - a network that answers 200 has not necessarily published: ask what became
     of the video (Facebook, Instagram, Threads, Bluesky, X, TikTok all
     process after the upload), and record `pending` rather than `ok`;
   - a pending post is finished by the next run, never sent again;
   - YouTube from an unaudited Google project uploads PRIVATE whatever was
     asked: say so on the record, do not call it published;
   - Meta fetches the video itself and wants a plain video/mp4 that does not
     redirect, so it is given this site's own door (/api/studio?action=video).
--------------------------------------------------------------------------- */
import { env, SITE, siteUrl, sleep, errText, getTok, putTok, kv, kvReady, K, videoUrl, doorUrl, clip, today, available } from "./_studio.js";

const cb = net => "https://" + SITE() + "/studio/callback/" + net;
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "")).toString();
const jfetch = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const t = await r.text().catch(() => "");
  let j = null; try { j = JSON.parse(t); } catch { }
  return { r, j, t, ok: r.ok };
};
const said = (j, t, fallback) => {
  const e = j && (j.error || j.errors);
  const m = (e && (e.message || e.error_user_msg || e.description || (Array.isArray(e) && e[0] && (e[0].message || e[0].detail)))) ||
            (j && (j.error_description || j.message || j.detail || j.title)) || "";
  return clip(String(m || fallback || t || "error").replace(/access_token=[^&\s]+/g, "access_token=***"), 220);
};

/* the film's bytes, fetched once per run and shared by every network that
   uploads them itself (YouTube, Bluesky, X, TikTok, Pinterest) */
const BYTES = new Map();
export async function filmBytes(id) {
  if (BYTES.has(id)) return BYTES.get(id);
  const r = await fetch(videoUrl(id));
  if (!r.ok) throw new Error("the film could not be fetched from the render farm (http " + r.status + ")");
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 50000) throw new Error("the film file is " + b.length + " bytes, which is not a film");
  BYTES.clear(); BYTES.set(id, b);
  return b;
}

/* A long film is never held in memory: it is read from the farm's release in
   pieces (HTTP ranges) and handed on piece by piece. The release answers with a
   redirect to a short-lived signed address, resolved here and again whenever it
   expires. */
async function signedUrl(id, ext = ".mp4") {
  const u = ext === ".mp4" ? videoUrl(id) : videoUrl(id).replace(/\.mp4$/, ext);
  try { const h = await fetch(u, { method: "HEAD", redirect: "manual" }); const loc = h.headers.get("location"); if (loc && /^https:\/\//.test(loc)) return loc; } catch { }
  return u;
}
async function filmSize(id) {
  try { const av = await available(); if (av.films[id] && av.films[id].size) return av.films[id].size; } catch { }
  const h = await fetch(await signedUrl(id), { method: "HEAD" });
  const n = Number(h.headers.get("content-length") || 0);
  if (!n) throw new Error("the size of " + id + " could not be read from the render farm");
  return n;
}
async function readPiece(id, a, b, state) {
  for (let i = 0; i < 3; i++) {
    if (!state.src) state.src = await signedUrl(id);
    const r = await fetch(state.src, { headers: { range: `bytes=${a}-${b}` } });
    if (r.status === 206) return Buffer.from(await r.arrayBuffer());
    try { await r.body?.cancel(); } catch { }
    state.src = null;                                     // expired or refused: ask the release again
    if (r.status === 200) throw new Error("the render farm ignored the byte range");
  }
  throw new Error("the film could not be read from the render farm");
}

/* ================================================================ YouTube */
const G_TOKEN = "https://oauth2.googleapis.com/token";
const gid = () => env("GOOGLE_CLIENT_ID") || env("YT_CLIENT_ID");
const gsecret = () => env("GOOGLE_CLIENT_SECRET") || env("YT_CLIENT_SECRET");
async function ytAccess(fresh) {
  const t = await getTok("youtube"); if (!t || !t.refresh) return { ok: false, error: "YouTube is not connected" };
  if (!fresh && t.access && t.accessExp > Date.now() + 60e3) return { ok: true, token: t.access };
  const { r, j, t: txt } = await jfetch(G_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ refresh_token: t.refresh, client_id: gid(), client_secret: gsecret(), grant_type: "refresh_token" }) });
  if (!r.ok || !j || !j.access_token) return { ok: false, error: "YouTube token: " + said(j, txt, "http " + r.status), fatal: /invalid_grant/.test(txt) };
  await putTok("youtube", { ...t, access: j.access_token, accessExp: Date.now() + (Number(j.expires_in || 3600) - 90) * 1000 });
  return { ok: true, token: j.access_token };
}
const youtube = {
  label: "YouTube Shorts", kind: "oauth", vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ready: () => !!(gid() && gsecret()),
  connectUrl: st => "https://accounts.google.com/o/oauth2/v2/auth?" + form({ client_id: gid(), redirect_uri: cb("youtube"), response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: st }),
  async exchange(code) {
    const { r, j, t } = await jfetch(G_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ code, client_id: gid(), client_secret: gsecret(), redirect_uri: cb("youtube"), grant_type: "authorization_code" }) });
    if (!r.ok || !j) return { ok: false, error: said(j, t, "http " + r.status) };
    if (!j.refresh_token) return { ok: false, error: "Google gave no refresh token: remove the app at myaccount.google.com/permissions and connect again" };
    let who = "";
    try { const c = await jfetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: "Bearer " + j.access_token } });
          who = (c.j && c.j.items && c.j.items[0] && c.j.items[0].snippet.title) || ""; } catch { }
    await putTok("youtube", { refresh: j.refresh_token, access: j.access_token, accessExp: Date.now() + 3000e3, who });
    return { ok: true, who };
  },
  async send(f, w, ctx) {
    const day = today();
    if (kvReady()) { const used = Number((await kv([["GET", K.ytday(day)]]))[0] || 0); if (used >= 6) return { ok: false, error: "YouTube's daily upload quota is spent", quota: true }; }
    const tok = await ytAccess(); if (!tok.ok) return { ok: false, error: tok.error, fatal: tok.fatal };
    if (f.kind === "long") return ytLong(f, w, tok.token, ctx, null);
    let desc = w.description;
    if (f.kind === "teaser" || f.kind === "clip") desc = await teaserDesc(f, desc);
    let bytes; try { bytes = await filmBytes(f.id); } catch (e) { return { ok: false, error: errText(e) }; }
    const meta = { snippet: { title: w.title, description: desc, tags: w.tags, categoryId: "27", defaultLanguage: "en", defaultAudioLanguage: "en" },
                   status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true } };
    const bd = "rc" + Date.now().toString(36);
    const body = Buffer.concat([Buffer.from("--" + bd + "\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + bd + "\r\ncontent-type: video/mp4\r\n\r\n"), bytes, Buffer.from("\r\n--" + bd + "--\r\n")]);
    const { r, j, t } = await jfetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
      { method: "POST", headers: { authorization: "Bearer " + tok.token, "content-type": "multipart/related; boundary=" + bd, "content-length": String(body.length) }, body });
    if (!r.ok || !j || !j.id) return { ok: false, error: "YouTube refused: " + said(j, t, "http " + r.status), quota: /quota/i.test(t) };
    if (kvReady()) { try { await kv([["INCR", K.ytday(day)], ["EXPIRE", K.ytday(day), "172800"]]); } catch { } }
    const out = { ok: true, id: j.id, url: "https://youtube.com/shorts/" + j.id };
    const p = j.status && j.status.privacyStatus;
    if (p && p !== "public") { out.private = true; out.note = "YouTube kept it " + p + ": the Google project has not passed YouTube's API audit, so only you can see it"; }
    return out;
  },
  async finish(p, ctx, rec) {
    if (!p || !p.yt) return { ok: false, error: "nothing to finish" };
    const tok = await ytAccess(); if (!tok.ok) return { ok: false, pending: p, error: tok.error };
    const { film } = await import("./_studio.js");
    const f = film(rec && rec.film); if (!f) return { ok: false, error: "the film left the plan" };
    return ytLong(f, (rec.words || {}).youtube || {}, tok.token, ctx, p.yt);
  },
  async stats(ids) {
    const tok = await ytAccess(); if (!tok.ok || !ids.length) return {};
    const { j } = await jfetch("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + ids.slice(0, 50).join(","), { headers: { authorization: "Bearer " + tok.token } });
    const out = {}; for (const it of (j && j.items) || []) { const s = it.statistics || {}; out[it.id] = { views: +s.viewCount || 0, likes: +s.likeCount || 0, comments: +s.commentCount || 0 }; }
    return out;
  },
};

/* A long film goes up with YouTube's resumable upload, 32 MB at a time; if the
   run runs short of time the session is kept and the next run carries on
   from where YouTube says it stopped. */
const YT_PIECE = 32 * 1024 * 1024;                       // a multiple of 256 KiB, as YouTube asks
async function ytLong(f, w, token, ctx, state) {
  const st = state ? { ...state } : null;
  let s = st;
  try {
    if (!s) {
      const total = await filmSize(f.id);
      const meta = { snippet: { title: w.title, description: w.description, tags: w.tags, categoryId: "27", defaultLanguage: "en", defaultAudioLanguage: "en" },
                     status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true } };
      const r = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(total), "x-upload-content-type": "video/mp4" },
        body: JSON.stringify(meta) });
      const t = await r.text().catch(() => "");
      const loc = r.headers.get("location");
      if (!r.ok || !loc) { let j = null; try { j = JSON.parse(t); } catch { } return { ok: false, error: "YouTube refused: " + said(j, t, "http " + r.status), quota: /quota/i.test(t) }; }
      s = { session: loc, offset: 0, total, began: new Date().toISOString() };
      if (kvReady()) { try { await kv([["INCR", K.ytday(today())], ["EXPIRE", K.ytday(today()), "172800"]]); } catch { } }
    }
    const src = {};
    while (s.offset < s.total) {
      if (ctx && ctx.left() < 45e3) return { ok: false, pending: { yt: s }, note: "uploading the film to YouTube (" + Math.round(100 * s.offset / s.total) + "%); it carries on next run" };
      const a = s.offset, b = Math.min(s.offset + YT_PIECE, s.total) - 1;
      const buf = await readPiece(f.id, a, b, src);
      const r = await fetch(s.session, { method: "PUT", headers: { authorization: "Bearer " + token, "content-range": `bytes ${a}-${a + buf.length - 1}/${s.total}` }, body: buf });
      if (r.status === 308) { const rg = r.headers.get("range"); s.offset = rg ? Number(rg.split("-")[1]) + 1 : a + buf.length; try { await r.body?.cancel(); } catch { } continue; }
      const t = await r.text().catch(() => ""); let j = null; try { j = JSON.parse(t); } catch { }
      if (r.ok && j && j.id) {
        const out = { ok: true, id: j.id, url: "https://www.youtube.com/watch?v=" + j.id };
        const pv = j.status && j.status.privacyStatus;
        if (pv && pv !== "public") { out.private = true; out.note = "YouTube kept it " + pv + ": the Google project has not passed YouTube's API audit, so only you can see it"; }
        try { await ytThumb(j.id, f.id, token); out.thumb = true; } catch (e) { out.thumbNote = errText(e); }
        return out;
      }
      if (r.status === 404 || r.status === 410) return { ok: false, error: "YouTube dropped the upload session; it starts again on a retry" };
      return { ok: false, pending: { yt: s }, error: "YouTube upload: " + said(j, t, "http " + r.status) };
    }
    return { ok: false, pending: { yt: s }, note: "waiting for YouTube to confirm the upload" };
  } catch (e) { return s ? { ok: false, pending: { yt: s }, error: errText(e) } : { ok: false, error: errText(e) }; }
}
/* the film's own thumbnail (<id>.thumb.jpg on the release); YouTube takes it
   once the channel is verified, and refuses politely before */
async function ytThumb(videoId, id, token) {
  const r = await fetch(await signedUrl(id, ".thumb.jpg"));
  if (!r.ok) throw new Error("no thumbnail on the release");
  const img = Buffer.from(await r.arrayBuffer());
  const u = await fetch("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=" + encodeURIComponent(videoId), { method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "image/jpeg" }, body: img });
  if (!u.ok) { const t = await u.text().catch(() => ""); throw new Error("thumbnail: " + clip(t, 120)); }
}
/* a teaser's (or a chapter clip's) description points to its long film on YouTube, once it is there */
async function teaserDesc(f, desc) {
  let url = "";
  if (kvReady() && f.long) { try { const v = (await kv([["HGET", K.posted, f.long + "|youtube"]]))[0]; if (v) url = JSON.parse(v).url || ""; } catch { } }
  const d = String(desc || "");
  if (url) return d.replace("{long_url}", url);
  return d.replace(/Watch the full deep dive: \{long_url\}\s*/, "").replace("{long_url}", "").trim();
}

/* ======================================================= Facebook + Instagram */
const GRAPH = "https://graph.facebook.com/v21.0";
const META_SCOPE = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management,read_insights,instagram_manage_insights";
const metaReady = () => !!(env("META_APP_ID") && env("META_APP_SECRET"));
const META_CONFIG = () => env("META_CONFIG_ID") || "2346928819444598";
async function metaExchange(code, net) {
  const a = await jfetch(GRAPH + "/oauth/access_token?" + form({ client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: cb(net), code }));
  if (!a.ok || !a.j || !a.j.access_token) return { ok: false, error: said(a.j, a.t, "http " + a.r.status) };
  const l = await jfetch(GRAPH + "/oauth/access_token?" + form({ grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), fb_exchange_token: a.j.access_token }));
  const user = (l.j && l.j.access_token) || a.j.access_token;
  /* a page token minted from a long-lived user token does not expire */
  const pg = await jfetch(GRAPH + "/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100", { headers: { authorization: "Bearer " + user } });
  const pages = (pg.j && pg.j.data) || [];
  const want = (env("FB_PAGE_NAME") || "Residual Continuum").toLowerCase();
  const page = pages.find(p => env("FB_PAGE_ID") ? p.id === env("FB_PAGE_ID") : String(p.name).toLowerCase() === want) || null;
  if (!page) return { ok: false, error: "no Facebook Page named \"" + (env("FB_PAGE_NAME") || "Residual Continuum") + "\" was shared with the app (pages seen: " + pages.map(p => p.name).join(", ") + ")" };
  await putTok("facebook", { pageId: page.id, token: page.access_token, who: page.name });
  const ig = page.instagram_business_account;
  if (ig && ig.id) await putTok("instagram", { igId: ig.id, token: page.access_token, who: "@" + (ig.username || "") });
  return { ok: true, who: page.name + (ig && ig.id ? " + Instagram @" + ig.username : " (no Instagram professional account is linked to this Page yet)") };
}
async function fbStatus(videoId, tok, tries = 1) {
  let last = { ok: false, pending: { fb: videoId } };
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(4000);
    const { r, j } = await jfetch(`${GRAPH}/${videoId}?fields=status,permalink_url,published`, { headers: { authorization: "Bearer " + tok } });
    if (!r.ok || !j) continue;
    const ph = String((j.status && j.status.video_status) || "").toLowerCase();
    const url = j.permalink_url ? (/^https?:/.test(j.permalink_url) ? j.permalink_url : "https://www.facebook.com" + j.permalink_url) : "";
    if (ph === "ready" || (j.published === true && ph !== "error" && ph !== "processing")) return { ok: true, id: videoId, url };
    if (ph === "error") return { ok: false, error: "Facebook could not process the reel" };
    last = { ok: false, pending: { fb: videoId }, note: "Facebook is processing the reel" };
  }
  return last;
}
const facebook = {
  label: "Facebook Reels", kind: "oauth", vars: ["META_APP_ID", "META_APP_SECRET"], also: "instagram",
  ready: metaReady,
  /* The app uses Facebook Login for Business: the permissions live in a login
     configuration ("Studio publishing"), passed as config_id. Its id is public. */
  connectUrl: st => "https://www.facebook.com/v21.0/dialog/oauth?" + form({ client_id: env("META_APP_ID"), redirect_uri: cb("facebook"), state: st, response_type: "code",
    ...(META_CONFIG() ? { config_id: META_CONFIG() } : { scope: META_SCOPE }) }),
  exchange: code => metaExchange(code, "facebook"),
  async send(f, w, ctx) {
    const t = await getTok("facebook"); if (!t) return { ok: false, skipped: "Facebook is not connected" };
    /* Reels through the API take 3 to 90 seconds: a longer vertical film (a
       chapter clip) goes up as a Page video, which Facebook shows as a reel */
    if (f.kind === "long" || Number(f.dur) > 88) return fbLong(f, w, t, ctx, null);
    const st = await jfetch(`${GRAPH}/${t.pageId}/video_reels`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token }, body: JSON.stringify({ upload_phase: "start" }) });
    if (!st.ok || !st.j || !st.j.video_id || !st.j.upload_url) return { ok: false, error: "Facebook start: " + said(st.j, st.t, "http " + st.r.status) };
    const up = await jfetch(st.j.upload_url, { method: "POST", headers: { authorization: "OAuth " + t.token, file_url: doorUrl(f.id) } });
    if (!up.ok) return { ok: false, error: "Facebook upload: " + said(up.j, up.t, "http " + up.r.status), id: st.j.video_id };
    const fin = await jfetch(`${GRAPH}/${t.pageId}/video_reels`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token },
      body: JSON.stringify({ video_id: st.j.video_id, upload_phase: "finish", video_state: "PUBLISHED", description: w.text }) });
    if (!fin.ok) return { ok: false, error: "Facebook finish: " + said(fin.j, fin.t, "http " + fin.r.status), id: st.j.video_id };
    return fbStatus(st.j.video_id, t.token, 3);
  },
  async finish(p, ctx, rec) {
    const t = await getTok("facebook"); if (!t) return { ok: false, error: "Facebook is not connected" };
    if (p && p.fbv) {
      const { film } = await import("./_studio.js");
      const f = film(rec && rec.film); if (!f) return { ok: false, error: "the film left the plan" };
      return fbLong(f, (rec.words || {}).facebook || {}, t, ctx, p.fbv);
    }
    return fbStatus(p.fb || p, t.token, 1);
  },
};
/* A long film goes to the Page as a video (Reels are for the short ones), with
   the Graph API's chunked upload: Facebook names each piece it wants next. */
const GVID = "https://graph-video.facebook.com/v21.0";
async function fbLong(f, w, t, ctx, state) {
  let s = state ? { ...state } : null;
  try {
    if (!s) {
      const total = await filmSize(f.id);
      const st = await jfetch(`${GVID}/${t.pageId}/videos`, { method: "POST", headers: { authorization: "Bearer " + t.token, "content-type": "application/x-www-form-urlencoded" },
        body: form({ upload_phase: "start", file_size: String(total) }) });
      if (!st.ok || !st.j || !st.j.upload_session_id) return { ok: false, error: "Facebook start: " + said(st.j, st.t, "http " + st.r.status) };
      s = { sess: st.j.upload_session_id, vid: st.j.video_id, a: Number(st.j.start_offset), b: Number(st.j.end_offset), total };
    }
    const src = {};
    while (s.a < s.b) {
      if (ctx && ctx.left() < 40e3) return { ok: false, pending: { fbv: s }, note: "uploading the film to Facebook (" + Math.round(100 * s.a / s.total) + "%); it carries on next run" };
      const buf = await readPiece(f.id, s.a, s.b - 1, src);
      const fd = new FormData();
      fd.append("upload_phase", "transfer"); fd.append("upload_session_id", s.sess); fd.append("start_offset", String(s.a));
      fd.append("video_file_chunk", new Blob([buf], { type: "application/octet-stream" }), "piece.mp4");
      const tr = await jfetch(`${GVID}/${t.pageId}/videos`, { method: "POST", headers: { authorization: "Bearer " + t.token }, body: fd });
      if (!tr.ok || !tr.j || tr.j.start_offset == null) return { ok: false, pending: { fbv: s }, error: "Facebook transfer: " + said(tr.j, tr.t, "http " + tr.r.status) };
      s.a = Number(tr.j.start_offset); s.b = Number(tr.j.end_offset);
    }
    if (!s.finished) {
      const fin = await jfetch(`${GVID}/${t.pageId}/videos`, { method: "POST", headers: { authorization: "Bearer " + t.token, "content-type": "application/x-www-form-urlencoded" },
        body: form({ upload_phase: "finish", upload_session_id: s.sess, title: w.title || "", description: w.text || "", published: w.unpublished ? "false" : "true" }) });
      if (!fin.ok) return { ok: false, error: "Facebook finish: " + said(fin.j, fin.t, "http " + fin.r.status), id: s.vid };
      s.finished = true;
    }
    const done = await fbStatus(s.vid, t.token, 3);
    return done.pending ? { ...done, pending: { fb: s.vid } } : done;
  } catch (e) { return s ? { ok: false, pending: { fbv: s }, error: errText(e) } : { ok: false, error: errText(e) }; }
}
async function igPublish(t, cid) {
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(4000);
    const p = await jfetch(`${GRAPH}/${t.igId}/media_publish`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token }, body: JSON.stringify({ creation_id: cid }) });
    if (p.ok && p.j && p.j.id) {
      let url = ""; try { const q = await jfetch(`${GRAPH}/${p.j.id}?fields=permalink`, { headers: { authorization: "Bearer " + t.token } }); url = (q.j && q.j.permalink) || ""; } catch { }
      return { ok: true, id: p.j.id, url };
    }
    if (!/9007|not ready/i.test(p.t)) return { ok: false, error: "Instagram publish: " + said(p.j, p.t, "http " + p.r.status) };
  }
  return { ok: false, pending: { ig: cid }, note: "Instagram is still processing the reel" };
}
async function igStatus(t, cid) {
  const s = await jfetch(`${GRAPH}/${cid}?fields=status_code`, { headers: { authorization: "Bearer " + t.token } });
  return (s.j && s.j.status_code) || "";
}
const instagram = {
  label: "Instagram Reels", kind: "oauth", vars: ["META_APP_ID", "META_APP_SECRET"], via: "facebook",
  ready: metaReady,
  connectUrl: st => facebook.connectUrl(st).replace(encodeURIComponent(cb("facebook")), encodeURIComponent(cb("instagram"))),
  exchange: code => metaExchange(code, "instagram"),
  async send(f, w, ctx) {
    const t = await getTok("instagram"); if (!t) return { ok: false, skipped: "Instagram is not connected (connect Facebook with an Instagram professional account linked to the Page)" };
    const c = await jfetch(`${GRAPH}/${t.igId}/media`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token },
      body: JSON.stringify({ media_type: "REELS", video_url: doorUrl(f.id), caption: w.text, share_to_feed: true }) });
    if (!c.ok || !c.j || !c.j.id) return { ok: false, error: "Instagram container: " + said(c.j, c.t, "http " + c.r.status) };
    const cid = c.j.id, t0 = Date.now();
    while (Date.now() - t0 < 45e3 && (!ctx || ctx.left() > 25e3)) {
      await sleep(3000);
      const code = await igStatus(t, cid);
      if (code === "FINISHED") return igPublish(t, cid);
      if (code === "ERROR" || code === "EXPIRED") return { ok: false, error: "Instagram could not process the video (" + code + ")" };
    }
    return { ok: false, pending: { ig: cid }, note: "Instagram is still processing; it is published on the next run" };
  },
  async finish(p) {
    const t = await getTok("instagram"); if (!t) return { ok: false, error: "Instagram is not connected" };
    const cid = p.ig || p; const code = await igStatus(t, cid);
    if (code === "PUBLISHED") return { ok: true, id: cid };
    if (code === "FINISHED") return igPublish(t, cid);
    if (code === "ERROR" || code === "EXPIRED") return { ok: false, error: "Instagram could not process the video (" + code + ")" };
    return { ok: false, pending: p };
  },
};

/* An end-to-end test of the long-film upload to Facebook that publishes
   nothing: the film goes up unpublished, is checked, then deleted. */
export async function probeFbLong(id) {
  const t = await getTok("facebook"); if (!t) return { ok: false, error: "Facebook is not connected" };
  const t0 = Date.now();
  const r = await fbLong({ id, kind: "long" }, { title: "Studio upload test (deleted)", text: "Studio upload test", unpublished: true }, t, { left: () => 240e3 - (Date.now() - t0) }, null);
  const vid = r.id || (r.pending && (r.pending.fb || (r.pending.fbv && r.pending.fbv.vid)));
  let deleted = false;
  if (vid) { const d = await jfetch(`${GRAPH}/${vid}`, { method: "DELETE", headers: { authorization: "Bearer " + t.token } }); deleted = d.ok; }
  return { result: { ok: r.ok, pending: !!r.pending, error: r.error || "", note: r.note || "" }, video: vid ? "made" : "none", deleted, seconds: Math.round((Date.now() - t0) / 1000) };
}

/* ================================================================ Threads */
const TH = "https://graph.threads.net/v1.0";
const thReady = () => !!(env("THREADS_APP_ID") && env("THREADS_APP_SECRET"));
const bigId = (text, key) => { const m = String(text || "").match(new RegExp('"' + key + '"\\s*:\\s*"?(\\d+)"?')); return m ? m[1] : ""; };
async function thToken() {
  const t = await getTok("threads"); if (!t) return null;
  /* a long-lived token lives sixty days; it is renewed once it is ten days old */
  if (t.at && Date.now() - t.at > 10 * 864e5 && Date.now() - t.at < 59 * 864e5) {
    const r = await jfetch("https://graph.threads.net/refresh_access_token?" + form({ grant_type: "th_refresh_token", access_token: t.token }));
    if (r.ok && r.j && r.j.access_token) { const n = { ...t, token: r.j.access_token, at: Date.now() }; await putTok("threads", n); return n; }
  }
  return t;
}
async function thStatus(t, cid) {
  const s = await jfetch(`${TH}/${cid}?fields=status,error_message`, { headers: { authorization: "Bearer " + t.token } });
  return (s.j && s.j.status) || "";
}
async function thPublish(t, cid) {
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(5000);
    const p = await jfetch(`${TH}/${t.uid}/threads_publish`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token }, body: JSON.stringify({ creation_id: cid }) });
    const id = bigId(p.t, "id");
    if (p.ok && id) {
      let url = ""; try { const q = await jfetch(`${TH}/${id}?fields=permalink`, { headers: { authorization: "Bearer " + t.token } }); url = (q.j && q.j.permalink) || ""; } catch { }
      return { ok: true, id, url };
    }
    if (!/not.*ready|does not exist|4279009/i.test(p.t)) return { ok: false, error: "Threads publish: " + said(p.j, p.t, "http " + p.r.status) };
  }
  return { ok: false, pending: { th: cid } };
}
const threads = {
  label: "Threads", kind: "oauth", vars: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  ready: thReady,
  connectUrl: st => "https://threads.net/oauth/authorize?" + form({ client_id: env("THREADS_APP_ID"), redirect_uri: cb("threads"), scope: "threads_basic,threads_content_publish,threads_manage_insights", response_type: "code", state: st }),
  async exchange(code) {
    code = String(code || "").replace(/#_$/, "");
    const a = await jfetch("https://graph.threads.net/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_id: env("THREADS_APP_ID"), client_secret: env("THREADS_APP_SECRET"), grant_type: "authorization_code", redirect_uri: cb("threads"), code }) });
    if (!a.ok || !a.j || !a.j.access_token) return { ok: false, error: said(a.j, a.t, "http " + a.r.status) };
    const uid = bigId(a.t, "user_id");
    const l = await jfetch("https://graph.threads.net/access_token?" + form({ grant_type: "th_exchange_token", client_secret: env("THREADS_APP_SECRET"), access_token: a.j.access_token }));
    const token = (l.j && l.j.access_token) || a.j.access_token;
    let who = ""; try { const m = await jfetch(TH + "/me?fields=id,username", { headers: { authorization: "Bearer " + token } }); who = m.j && m.j.username ? "@" + m.j.username : ""; } catch { }
    await putTok("threads", { token, uid, who, at: Date.now() });
    return { ok: true, who };
  },
  async send(f, w) {
    const t = await thToken(); if (!t) return { ok: false, skipped: "Threads is not connected" };
    const c = await jfetch(`${TH}/${t.uid}/threads`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + t.token },
      body: JSON.stringify({ media_type: "VIDEO", video_url: doorUrl(f.id), text: w.text }) });
    const cid = bigId(c.t, "id");
    if (!c.ok || !cid) return { ok: false, error: "Threads container: " + said(c.j, c.t, "http " + c.r.status) };
    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      const s = await thStatus(t, cid);
      if (s === "FINISHED") return thPublish(t, cid);
      if (s === "ERROR" || s === "EXPIRED") return { ok: false, error: "Threads could not process the video (" + s + ")" };
    }
    return { ok: false, pending: { th: cid }, note: "Threads is still processing; it is published on the next run" };
  },
  async finish(p) {
    const t = await thToken(); if (!t) return { ok: false, error: "Threads is not connected" };
    const cid = p.th || p, s = await thStatus(t, cid);
    if (s === "PUBLISHED") return { ok: true, id: cid };
    if (s === "FINISHED") return thPublish(t, cid);
    if (s === "ERROR" || s === "EXPIRED") return { ok: false, error: "Threads could not process the video (" + s + ")" };
    return { ok: false, pending: p };
  },
};

/* ================================================================ Bluesky */
async function bskySession(t) {
  const pds = t.pds || "https://bsky.social";
  const { r, j, t: txt } = await jfetch(pds + "/xrpc/com.atproto.server.createSession", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: t.handle, password: t.appPassword }) });
  if (!r.ok || !j || !j.accessJwt) return { ok: false, error: "Bluesky sign-in: " + said(j, txt, "http " + r.status) };
  let host = pds;
  try { const svc = (j.didDoc && j.didDoc.service || []).find(s => s.id === "#atproto_pds"); if (svc) host = svc.serviceEndpoint; } catch { }
  return { ok: true, jwt: j.accessJwt, did: j.did, handle: j.handle, pds: host };
}
async function bskyPost(s, w, blob) {
  const text = w.text, facets = [];
  if (w.link && text.includes(w.link)) {
    const pre = Buffer.byteLength(text.slice(0, text.indexOf(w.link)), "utf8");
    facets.push({ index: { byteStart: pre, byteEnd: pre + Buffer.byteLength(w.link, "utf8") }, features: [{ $type: "app.bsky.richtext.facet#link", uri: w.link }] });
  }
  for (const m of text.matchAll(/#[A-Za-z]\w*/g)) {
    const pre = Buffer.byteLength(text.slice(0, m.index), "utf8");
    facets.push({ index: { byteStart: pre, byteEnd: pre + Buffer.byteLength(m[0], "utf8") }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[0].slice(1) }] });
  }
  const record = { $type: "app.bsky.feed.post", text, facets, langs: ["en"], createdAt: new Date().toISOString(),
    embed: { $type: "app.bsky.embed.video", video: blob, aspectRatio: { width: 1080, height: 1920 } } };
  const { r, j, t } = await jfetch((s.pds || "https://bsky.social") + "/xrpc/com.atproto.repo.createRecord", { method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + s.jwt }, body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }) });
  if (!r.ok || !j || !j.uri) return { ok: false, error: "Bluesky post: " + said(j, t, "http " + r.status) };
  const rkey = j.uri.split("/").pop();
  return { ok: true, id: j.uri, url: "https://bsky.app/profile/" + s.handle + "/post/" + rkey };
}
async function bskyJob(jobId, s) {
  const { j } = await jfetch("https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=" + encodeURIComponent(jobId), { headers: s && s.vjwt ? { authorization: "Bearer " + s.vjwt } : {} });
  return (j && j.jobStatus) || {};
}
const bluesky = {
  label: "Bluesky", kind: "form", vars: [], fields: [{ k: "handle", label: "Handle (e.g. residualcontinuum.bsky.social)" }, { k: "appPassword", label: "App password (Bluesky → Settings → Privacy and security → App passwords)", secret: true }],
  ready: () => true,
  async connectForm(v) {
    const t = { handle: String(v.handle || "").replace(/^@/, "").trim(), appPassword: String(v.appPassword || "").trim() };
    if (!t.handle || !t.appPassword) return { ok: false, error: "handle and app password are both needed" };
    const s = await bskySession(t); if (!s.ok) return s;
    await putTok("bluesky", { ...t, pds: s.pds, did: s.did, who: "@" + s.handle });
    return { ok: true, who: "@" + s.handle };
  },
  async send(f, w, ctx) {
    const t = await getTok("bluesky"); if (!t) return { ok: false, skipped: "Bluesky is not connected" };
    const s = await bskySession(t); if (!s.ok) return s;
    let bytes; try { bytes = await filmBytes(f.id); } catch (e) { return { ok: false, error: errText(e) }; }
    if (bytes.length > 100e6) return { ok: false, error: "the film is over Bluesky's 100 MB limit" };
    const pdsHost = new URL(s.pds).host;
    const sa = await jfetch(s.pds + "/xrpc/com.atproto.server.getServiceAuth?" + form({ aud: "did:web:" + pdsHost, lxm: "com.atproto.repo.uploadBlob", exp: Math.floor(Date.now() / 1000) + 1800 }), { headers: { authorization: "Bearer " + s.jwt } });
    if (!sa.ok || !sa.j || !sa.j.token) return { ok: false, error: "Bluesky video service: " + said(sa.j, sa.t, "http " + sa.r.status) };
    const up = await jfetch("https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?" + form({ did: s.did, name: f.id + ".mp4" }),
      { method: "POST", headers: { authorization: "Bearer " + sa.j.token, "content-type": "video/mp4", "content-length": String(bytes.length) }, body: bytes });
    const job = (up.j && (up.j.jobId || (up.j.jobStatus && up.j.jobStatus.jobId))) || "";
    if (!job) return { ok: false, error: "Bluesky upload: " + said(up.j, up.t, "http " + up.r.status) };
    for (let i = 0; i < 20 && (!ctx || ctx.left() > 20e3); i++) {
      await sleep(4000);
      const st = await bskyJob(job);
      if (st.blob) return bskyPost(s, w, st.blob);
      if (st.state === "JOB_STATE_FAILED") return { ok: false, error: "Bluesky could not process the video: " + (st.error || st.message || "failed") };
    }
    return { ok: false, pending: { bsky: job, text: w.text, link: w.link }, note: "Bluesky is still processing the video" };
  },
  async finish(p) {
    const t = await getTok("bluesky"); if (!t) return { ok: false, error: "Bluesky is not connected" };
    const st = await bskyJob(p.bsky);
    if (st.blob) { const s = await bskySession(t); if (!s.ok) return s; return bskyPost(s, { text: p.text, link: p.link }, st.blob); }
    if (st.state === "JOB_STATE_FAILED") return { ok: false, error: "Bluesky could not process the video" };
    return { ok: false, pending: p };
  },
};

/* ====================================================================== X */
const X_API = "https://api.x.com/2";
const xReady = () => !!(env("X_CLIENT_ID") && env("X_CLIENT_SECRET"));
const xBasic = () => "Basic " + Buffer.from(env("X_CLIENT_ID") + ":" + env("X_CLIENT_SECRET")).toString("base64");
async function xAccess() {
  const t = await getTok("x"); if (!t) return { ok: false, skipped: "X is not connected" };
  if (t.access && t.accessExp > Date.now() + 60e3) return { ok: true, token: t.access };
  const { r, j, t: txt } = await jfetch(X_API + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: xBasic() },
    body: form({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: env("X_CLIENT_ID") }) });
  if (!r.ok || !j || !j.access_token) return { ok: false, error: "X token: " + said(j, txt, "http " + r.status), fatal: r.status === 400 };
  await putTok("x", { ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, accessExp: Date.now() + (Number(j.expires_in || 7200) - 90) * 1000 });
  return { ok: true, token: j.access_token };
}
async function xMediaState(tok, mid) {
  const { j } = await jfetch(X_API + "/media/upload?" + form({ command: "STATUS", media_id: mid }), { headers: { authorization: "Bearer " + tok } });
  return (j && j.data && j.data.processing_info) || (j && j.processing_info) || null;
}
async function xTweet(tok, text, mid) {
  const { r, j, t } = await jfetch(X_API + "/tweets", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ text, media: { media_ids: [mid] } }) });
  if (!r.ok || !j || !j.data || !j.data.id) return { ok: false, error: "X post: " + said(j, t, "http " + r.status) };
  return { ok: true, id: j.data.id, url: "https://x.com/i/web/status/" + j.data.id };
}
const x = {
  label: "X", kind: "oauth", vars: ["X_CLIENT_ID", "X_CLIENT_SECRET"], pkce: true,
  ready: xReady,
  connectUrl: (st, pk) => "https://x.com/i/oauth2/authorize?" + form({ response_type: "code", client_id: env("X_CLIENT_ID"), redirect_uri: cb("x"),
    scope: "tweet.read tweet.write users.read media.write offline.access", state: st, code_challenge: pk.challenge, code_challenge_method: "S256" }),
  async exchange(code, pk) {
    const { r, j, t } = await jfetch(X_API + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: xBasic() },
      body: form({ grant_type: "authorization_code", code, redirect_uri: cb("x"), code_verifier: pk.verifier, client_id: env("X_CLIENT_ID") }) });
    if (!r.ok || !j || !j.access_token) return { ok: false, error: said(j, t, "http " + r.status) };
    let who = ""; try { const m = await jfetch(X_API + "/users/me", { headers: { authorization: "Bearer " + j.access_token } }); who = m.j && m.j.data ? "@" + m.j.data.username : ""; } catch { }
    await putTok("x", { access: j.access_token, refresh: j.refresh_token, accessExp: Date.now() + (Number(j.expires_in || 7200) - 90) * 1000, who });
    return { ok: true, who };
  },
  async send(f, w, ctx) {
    const a = await xAccess(); if (!a.ok) return a;
    let bytes; try { bytes = await filmBytes(f.id); } catch (e) { return { ok: false, error: errText(e) }; }
    const H = { authorization: "Bearer " + a.token };
    const init = await jfetch(X_API + "/media/upload/initialize", { method: "POST", headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.length, media_category: "amplify_video" }) });
    const mid = init.j && init.j.data && (init.j.data.id || init.j.data.media_id_string);
    if (!init.ok || !mid) return { ok: false, error: "X media init: " + said(init.j, init.t, "http " + init.r.status) };
    const CH = 4 * 1024 * 1024;
    for (let i = 0, k = 0; i < bytes.length; i += CH, k++) {
      const fd = new FormData();
      fd.append("segment_index", String(k));
      fd.append("media", new Blob([bytes.subarray(i, i + CH)], { type: "application/octet-stream" }), "chunk");
      const ap = await jfetch(X_API + "/media/upload/" + mid + "/append", { method: "POST", headers: H, body: fd });
      if (!ap.ok) return { ok: false, error: "X media append: " + said(ap.j, ap.t, "http " + ap.r.status) };
    }
    const fin = await jfetch(X_API + "/media/upload/" + mid + "/finalize", { method: "POST", headers: H });
    if (!fin.ok) return { ok: false, error: "X media finalize: " + said(fin.j, fin.t, "http " + fin.r.status) };
    for (let i = 0; i < 15 && (!ctx || ctx.left() > 15e3); i++) {
      const p = (fin.j && fin.j.data && fin.j.data.processing_info) && i === 0 ? fin.j.data.processing_info : await xMediaState(a.token, mid);
      if (!p || p.state === "succeeded") return xTweet(a.token, w.text, mid);
      if (p.state === "failed") return { ok: false, error: "X could not process the video: " + ((p.error && p.error.message) || "failed") };
      await sleep(Math.min(10, Number(p.check_after_secs || 4)) * 1000);
    }
    return { ok: false, pending: { x: mid, text: w.text }, note: "X is still processing the video" };
  },
  async finish(p) {
    const a = await xAccess(); if (!a.ok) return a;
    const st = await xMediaState(a.token, p.x);
    if (!st || st.state === "succeeded") return xTweet(a.token, p.text, p.x);
    if (st.state === "failed") return { ok: false, error: "X could not process the video" };
    return { ok: false, pending: p };
  },
};

/* ================================================================= TikTok */
const TT = "https://open.tiktokapis.com/v2";
const ttReady = () => !!(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET"));
async function ttAccess() {
  const t = await getTok("tiktok"); if (!t) return { ok: false, skipped: "TikTok is not connected" };
  if (t.access && t.accessExp > Date.now() + 60e3) return { ok: true, token: t.access };
  const { r, j, t: txt } = await jfetch(TT + "/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: t.refresh }) });
  if (!r.ok || !j || !j.access_token) return { ok: false, error: "TikTok token: " + said(j, txt, "http " + r.status) };
  await putTok("tiktok", { ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, accessExp: Date.now() + (Number(j.expires_in || 86400) - 120) * 1000 });
  return { ok: true, token: j.access_token };
}
async function ttStatus(tok, pid) {
  const { j } = await jfetch(TT + "/post/publish/status/fetch/", { method: "POST", headers: { "content-type": "application/json; charset=UTF-8", authorization: "Bearer " + tok }, body: JSON.stringify({ publish_id: pid }) });
  return (j && j.data) || {};
}
const tiktok = {
  label: "TikTok", kind: "oauth", vars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  ready: ttReady,
  connectUrl: st => "https://www.tiktok.com/v2/auth/authorize/?" + form({ client_key: env("TIKTOK_CLIENT_KEY"), scope: "user.info.basic,video.publish,video.upload", response_type: "code", redirect_uri: cb("tiktok"), state: st }),
  async exchange(code) {
    const { r, j, t } = await jfetch(TT + "/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), code, grant_type: "authorization_code", redirect_uri: cb("tiktok") }) });
    if (!r.ok || !j || !j.access_token) return { ok: false, error: said(j, t, "http " + r.status) };
    let who = ""; try { const m = await jfetch(TT + "/user/info/?fields=display_name,username", { headers: { authorization: "Bearer " + j.access_token } }); who = m.j && m.j.data && m.j.data.user ? "@" + (m.j.data.user.username || m.j.data.user.display_name) : ""; } catch { }
    await putTok("tiktok", { access: j.access_token, refresh: j.refresh_token, accessExp: Date.now() + (Number(j.expires_in || 86400) - 120) * 1000, who });
    return { ok: true, who };
  },
  async send(f, w, ctx) {
    const a = await ttAccess(); if (!a.ok) return a;
    const H = { "content-type": "application/json; charset=UTF-8", authorization: "Bearer " + a.token };
    const ci = await jfetch(TT + "/post/publish/creator_info/query/", { method: "POST", headers: H, body: "{}" });
    const opts = (ci.j && ci.j.data && ci.j.data.privacy_level_options) || [];
    const privacy = opts.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : (opts[0] || "SELF_ONLY");
    let bytes; try { bytes = await filmBytes(f.id); } catch (e) { return { ok: false, error: errText(e) }; }
    const CH = 10 * 1024 * 1024, n = Math.max(1, Math.floor(bytes.length / CH));
    const init = await jfetch(TT + "/post/publish/video/init/", { method: "POST", headers: H, body: JSON.stringify({
      post_info: { title: w.text.slice(0, 2150), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 2500 },
      source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: n === 1 ? bytes.length : CH, total_chunk_count: n } }) });
    const d = init.j && init.j.data;
    if (!init.ok || !d || !d.upload_url) return { ok: false, error: "TikTok init: " + said(init.j && init.j.error, init.t, "http " + init.r.status) };
    for (let k = 0; k < n; k++) {
      const s = k * CH, e = k === n - 1 ? bytes.length : s + CH;
      const up = await fetch(d.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes ${s}-${e - 1}/${bytes.length}`, "content-length": String(e - s) }, body: bytes.subarray(s, e) });
      if (!up.ok && up.status !== 206 && up.status !== 201) return { ok: false, error: "TikTok upload chunk " + (k + 1) + ": http " + up.status };
    }
    const note = privacy !== "PUBLIC_TO_EVERYONE" ? "TikTok posted it as " + privacy + ": the TikTok app has not passed TikTok's audit yet" : undefined;
    for (let i = 0; i < 10 && (!ctx || ctx.left() > 15e3); i++) {
      await sleep(5000);
      const st = await ttStatus(a.token, d.publish_id);
      if (st.status === "PUBLISH_COMPLETE") return { ok: true, id: (st.publicaly_available_post_id && st.publicaly_available_post_id[0]) || d.publish_id, note, private: !!note };
      if (st.status === "FAILED") return { ok: false, error: "TikTok refused: " + (st.fail_reason || "failed") };
    }
    return { ok: false, pending: { tt: d.publish_id }, note: note || "TikTok is still processing" };
  },
  async finish(p) {
    const a = await ttAccess(); if (!a.ok) return a;
    const st = await ttStatus(a.token, p.tt);
    if (st.status === "PUBLISH_COMPLETE") return { ok: true, id: (st.publicaly_available_post_id && st.publicaly_available_post_id[0]) || p.tt };
    if (st.status === "FAILED") return { ok: false, error: "TikTok refused: " + (st.fail_reason || "failed") };
    return { ok: false, pending: p };
  },
};

/* ============================================================== Pinterest */
const PIN = "https://api.pinterest.com/v5";
const pinReady = () => !!(env("PINTEREST_APP_ID") && env("PINTEREST_APP_SECRET"));
const pinBasic = () => "Basic " + Buffer.from(env("PINTEREST_APP_ID") + ":" + env("PINTEREST_APP_SECRET")).toString("base64");
async function pinAccess() {
  const t = await getTok("pinterest"); if (!t) return { ok: false, skipped: "Pinterest is not connected" };
  if (t.access && t.accessExp > Date.now() + 60e3) return { ok: true, token: t.access, t };
  const { r, j, t: txt } = await jfetch(PIN + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: pinBasic() }, body: form({ grant_type: "refresh_token", refresh_token: t.refresh }) });
  if (!r.ok || !j || !j.access_token) return { ok: false, error: "Pinterest token: " + said(j, txt, "http " + r.status) };
  const n = { ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, accessExp: Date.now() + (Number(j.expires_in || 2592000) - 300) * 1000 };
  await putTok("pinterest", n);
  return { ok: true, token: j.access_token, t: n };
}
async function pinBoard(tok) {
  const H = { authorization: "Bearer " + tok, "content-type": "application/json" };
  const l = await jfetch(PIN + "/boards?page_size=100", { headers: H });
  const name = env("PIN_BOARD_NAME") || "Residual Continuum: the past, weighed";
  const b = ((l.j && l.j.items) || []).find(x => x.name === name);
  if (b) return b.id;
  const c = await jfetch(PIN + "/boards", { method: "POST", headers: H, body: JSON.stringify({ name, description: "History's mysteries, weighed fairly. Every claim sourced, every verdict graded.", privacy: "PUBLIC" }) });
  return c.j && c.j.id;
}
async function pinCreate(tok, board, mid, w) {
  const { r, j, t } = await jfetch(PIN + "/pins", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ board_id: board, title: w.title, description: w.text, link: w.link, media_source: { source_type: "video_id", media_id: mid, cover_image_key_frame_time: 3 } }) });
  if (!r.ok || !j || !j.id) return { ok: false, error: "Pinterest pin: " + said(j, t, "http " + r.status) };
  return { ok: true, id: j.id, url: "https://www.pinterest.com/pin/" + j.id + "/" };
}
const pinterest = {
  label: "Pinterest", kind: "oauth", vars: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  ready: pinReady,
  connectUrl: st => "https://www.pinterest.com/oauth/?" + form({ client_id: env("PINTEREST_APP_ID"), redirect_uri: cb("pinterest"), response_type: "code", scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read", state: st }),
  async exchange(code) {
    const { r, j, t } = await jfetch(PIN + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: pinBasic() }, body: form({ grant_type: "authorization_code", code, redirect_uri: cb("pinterest") }) });
    if (!r.ok || !j || !j.access_token) return { ok: false, error: said(j, t, "http " + r.status) };
    let who = ""; try { const m = await jfetch(PIN + "/user_account", { headers: { authorization: "Bearer " + j.access_token } }); who = m.j && m.j.username ? "@" + m.j.username : ""; } catch { }
    await putTok("pinterest", { access: j.access_token, refresh: j.refresh_token, accessExp: Date.now() + (Number(j.expires_in || 2592000) - 300) * 1000, who });
    return { ok: true, who };
  },
  async send(f, w, ctx) {
    const a = await pinAccess(); if (!a.ok) return a;
    const H = { authorization: "Bearer " + a.token, "content-type": "application/json" };
    const reg = await jfetch(PIN + "/media", { method: "POST", headers: H, body: JSON.stringify({ media_type: "video" }) });
    if (!reg.ok || !reg.j || !reg.j.upload_url) return { ok: false, error: "Pinterest media: " + said(reg.j, reg.t, "http " + reg.r.status) };
    let bytes; try { bytes = await filmBytes(f.id); } catch (e) { return { ok: false, error: errText(e) }; }
    const fd = new FormData();
    for (const [k, v] of Object.entries(reg.j.upload_parameters || {})) fd.append(k, v);
    fd.append("file", new Blob([bytes], { type: "video/mp4" }), f.id + ".mp4");
    const up = await fetch(reg.j.upload_url, { method: "POST", body: fd });
    if (!up.ok && up.status !== 204) return { ok: false, error: "Pinterest upload: http " + up.status };
    const board = await pinBoard(a.token); if (!board) return { ok: false, error: "no Pinterest board to pin to" };
    for (let i = 0; i < 12 && (!ctx || ctx.left() > 15e3); i++) {
      await sleep(5000);
      const s = await jfetch(PIN + "/media/" + reg.j.media_id, { headers: H });
      const st = s.j && s.j.status;
      if (st === "succeeded") return pinCreate(a.token, board, reg.j.media_id, w);
      if (st === "failed") return { ok: false, error: "Pinterest could not process the video" };
    }
    return { ok: false, pending: { pin: reg.j.media_id, board, w }, note: "Pinterest is still processing the video" };
  },
  async finish(p) {
    const a = await pinAccess(); if (!a.ok) return a;
    const s = await jfetch(PIN + "/media/" + p.pin, { headers: { authorization: "Bearer " + a.token } });
    const st = s.j && s.j.status;
    if (st === "succeeded") return pinCreate(a.token, p.board, p.pin, p.w);
    if (st === "failed") return { ok: false, error: "Pinterest could not process the video" };
    return { ok: false, pending: p };
  },
};

export const ALL_NETWORKS = { youtube, tiktok, instagram, facebook, threads, x, bluesky, pinterest };
import { NETS as LIVE } from "./_studio.js";
export const NETWORKS = Object.fromEntries(LIVE.map(n => [n, ALL_NETWORKS[n]]));
export const callbackUrl = cb;

/* what the console shows for a network: never a token */
export async function netStatus(net) {
  const n = NETWORKS[net]; const t = await getTok(net);
  return { net, label: n.label, kind: n.kind, ready: n.ready(), vars: n.vars, fields: n.fields || null, via: n.via || null,
           connected: !!t, who: (t && t.who) || "", since: (t && t.savedAt) || "", callback: n.kind === "oauth" ? cb(net) : "" };
}

/* ------------------------------------------------ The Explorer's senses
   Read-only calls with the tokens the console's Connect buttons won. They
   never write anything and never return a token. */
export async function ytGet(path) {
  const tok = await ytAccess(); if (!tok.ok) return { ok: false, error: tok.error };
  const { r, j, t } = await jfetch("https://www.googleapis.com/youtube/v3/" + path, { headers: { authorization: "Bearer " + tok.token } });
  return r.ok && j ? { ok: true, j } : { ok: false, error: said(j, t, "http " + r.status) };
}
export async function metaGet(net, path) {
  const tk = await getTok(net); if (!tk) return { ok: false, error: net + " is not connected" };
  const me = net === "instagram" ? tk.igId : tk.pageId;
  const { r, j, t } = await jfetch(GRAPH + "/" + String(path).replace("{me}", me), { headers: { authorization: "Bearer " + tk.token } });
  return r.ok && j && !j.error ? { ok: true, j } : { ok: false, error: said(j, t, "http " + r.status) };
}
