/**
 * Residual Continuum: what the daily discovery has already posted
 * ------------------------------------------------------------------
 * api/draft.js checks every feed candidate against these keys before the model
 * picks. Pure functions, no network: draft.js passes in the post file reader.
 *
 * Why (17 Nov 2026): index entries kept only the outlet's name in `source`, while
 * the old check read `source.url`, so no posted link was ever remembered and a
 * story stayed pickable for its days in the feeds. 26 of the first 48 posts
 * re-used a link already posted.
 */

/* A link reduced to what names the story: no scheme, no www., no trailing slash, no
   tracking tags, any case. Other query parameters stay: some sites name the story there. */
export function linkKey(u) {
  const s = String(u == null ? "" : u).trim();
  if (!s) return "";
  try {
    const x = new URL(s);
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch (_) { return s.toLowerCase(); }
}

/* A title reduced to its letters and digits: punctuation, dashes, tags and case do not count. */
export function titleKey(t) {
  return String(t == null ? "" : t).replace(/<[^>]*>/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/* Keys for every post in the index: its source link, the source's own title, the post's title. */
export function seenKeys(posts) {
  const seen = new Set();
  for (const p of posts || []) {
    if (!p) continue;
    const src = p.source && typeof p.source === "object" ? p.source : {};
    const l = linkKey(p.source_url || src.url);
    if (l) seen.add("l:" + l);
    for (const t of [p.source_title || src.title, p.title]) { const k = titleKey(t); if (k) seen.add("t:" + k); }
  }
  return seen;
}

/* True when a feed candidate is a story already posted: the same link, or the same title. */
export function isSeen(c, seen) {
  const l = linkKey(c && c.link), k = titleKey(c && c.title);
  return (l !== "" && seen.has("l:" + l)) || (k !== "" && seen.has("t:" + k));
}

/* Entries written before 17 Nov 2026 hold only the outlet's name. Recover the source link and
   title of the most recent ones from their post files, once: draft.js writes them back to the index. */
export async function recoverSources(posts, readPost, n = 40) {
  const missing = (posts || []).slice(0, n).filter((p) => p && p.id && !p.source_url);
  await Promise.all(missing.map(async (p) => {
    try {
      const s = (await readPost(p.id))?.source;
      if (s && s.url) p.source_url = s.url;
      if (s && s.title) p.source_title = s.title;
    } catch (_) { /* an unreadable post file only weakens the check for that one entry */ }
  }));
  return missing.filter((p) => p.source_url).length;
}
