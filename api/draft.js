/**
 * Residual Continuum: the daily discovery
 * ------------------------------------------------------------------
 * Runs once a day on Vercel Cron (see vercel.json). It:
 *   1. reads the latest discovery news from open science feeds (ScienceDaily,
 *      HeritageDaily, Phys.org) plus new journal papers from CrossRef;
 *   2. asks the best free model available right now (see _models.js) to pick
 *      the single most fascinating new find for this site;
 *   3. reads the full news story, pulls any DOIs from it and checks each one
 *      against the CrossRef register (a DOI that does not resolve is dropped);
 *   4. has the model write the article in the site's voice, then checks it
 *      automatically (no proof language, no em dashes, no email addresses,
 *      a minimum length, a real source link) before anything is published;
 *   5. finds an openly licensed image on Wikimedia Commons;
 *   6. commits two small files straight to the repository:
 *        blog/posts/<date>.json   the article
 *        blog/index.json          the list the site reads
 *      Vercel redeploys on the commit, so the article is live within minutes.
 *      index.html is never touched.
 *
 * Environment variables (Vercel, Settings, Environment Variables):
 *   OPENROUTER_API_KEY   OpenRouter key (free models only are ever called)
 *   GITHUB_TOKEN         fine-grained token, this repository only, Contents: write
 *   GITHUB_REPO          "Eouchi147/residual-continuum"
 *   CRON_SECRET          any long random string; Vercel Cron sends it back
 *   CONTACT_EMAIL        optional, only used in CrossRef's polite-pool URL
 *   GITHUB_BRANCH        optional, default "main"
 *
 * GET /api/draft?check=1 (no secret needed) reports whether the pieces are in
 * place: feeds reachable, keys present, GitHub write access. It never reveals
 * a secret or writes anything.
 */

import { chatFree, extractJSON } from "./_models.js";
import cases from "./cases.json" with { type: "json" };

const GH = "https://api.github.com";
const CROSSREF = "https://api.crossref.org";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const MAILTO = process.env.CONTACT_EMAIL || "noreply@example.com";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const UA = "ResidualContinuumBot/2.0 (+https://residualcontinuum.com)";

const FEEDS = [
  ["ScienceDaily", "https://www.sciencedaily.com/rss/fossils_ruins/archaeology.xml"],
  ["ScienceDaily", "https://www.sciencedaily.com/rss/fossils_ruins/ancient_civilizations.xml"],
  ["ScienceDaily", "https://www.sciencedaily.com/rss/fossils_ruins/early_humans.xml"],
  ["HeritageDaily", "https://www.heritagedaily.com/category/news/archaeology-news/feed"],
  ["Phys.org", "https://phys.org/rss-feed/science-news/archaeology-fossils/archaeology/"],
];

/* What the site covers, for picking and for a quick score when no model answers. */
const TOPICS = /(ancient|prehistor|neolithic|palaeolithic|paleolithic|mesolithic|bronze age|iron age|ice age|glacial|younger dryas|megalith|pyramid|egypt|giza|sphinx|temple|tomb|monument|stonehenge|g[oö]bekli|flood|sea level|drowned|submerged|comet|impact|meteor|asteroid|neanderthal|denisovan|homo |hominin|early humans?|rock art|cave art|symbol|inscription|script|writing|scroll|papyrus|tablet|myth|legend|lost city|civilization|civilisation|dna|radiocarbon|dating|astronom|solstice|maya|inca|olmec|sumer|mesopotam|indus|atlantis|shipwreck|excavat|archaeolog)/i;

/* The site's rules, enforced after the model writes. */
const BANNED = [
  [/\bprove[sn]?\b/gi, "supports"], [/\bproving\b/gi, "supporting"], [/\bproof\b/gi, "evidence"],
  [/\bundeniabl[ey]\b/gi, "striking"], [/\bdefinitely\b/gi, "clearly"], [/\birrefutabl[ey]\b/gi, "strong"],
  [/\bbeyond (any )?doubt\b/gi, "with confidence"], [/\bgroundbreaking\b/gi, "important"],
  [/\bmind-?blowing\b/gi, "remarkable"], [/\bshocking\b/gi, "surprising"],
];
const tidy = (s) => String(s == null ? "" : s)
  .replace(/\s*[—―]\s*/g, ", ")                                   /* no em dashes */
  .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "") /* no addresses */
  .replace(/<[^>]*>/g, "")                                        /* plain text only */
  .replace(/\s+/g, " ").trim();
const clean = (s) => BANNED.reduce((t, [re, to]) => t.replace(re, to), tidy(s));

/* ------------------------------------------------------------------ helpers */
async function get(url, ms = 9000, type = "text", headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, ...headers } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return type === "json" ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#039;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&ndash;/g, "–").replace(/&mdash;/g, ", ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? decode(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : ""; };

async function readFeed([source, url]) {
  try {
    const xml = await get(url, 8000);
    return xml.split(/<item[\s>]/i).slice(1).map((it) => ({
      source, title: tag(it, "title"), link: tag(it, "link") || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "",
      summary: tag(it, "description").slice(0, 700), date: new Date(tag(it, "pubDate") || tag(it, "dc:date") || Date.now()).toISOString(),
    })).filter((x) => x.title && /^https:\/\//.test(x.link));
  } catch (_) { return []; }
}

async function crossrefRecent() {
  try {
    const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
    const d = await get(`${CROSSREF}/works?query=archaeology+ancient+prehistoric&filter=from-created-date:${since},type:journal-article,has-abstract:true` +
      `&sort=relevance&rows=15&select=DOI,title,abstract,container-title,created&mailto=${MAILTO}`, 8000, "json");
    return (d.message?.items || []).map((it) => ({
      source: it["container-title"]?.[0] || "Journal", title: decode(it.title?.[0] || ""), link: `https://doi.org/${it.DOI}`, doi: it.DOI,
      summary: decode(it.abstract || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700), date: it.created?.["date-time"] || "",
    })).filter((x) => x.title && x.summary.length > 150);
  } catch (_) { return []; }
}

async function verifyDoi(doi) {
  try {
    const m = (await get(`${CROSSREF}/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`, 6000, "json")).message;
    if (!m?.title?.length) return null;
    return { doi: m.DOI, title: decode(m.title[0]), container: m["container-title"]?.[0] || "", year: m.issued?.["date-parts"]?.[0]?.[0] || "",
      authors: (m.author || []).slice(0, 8).map((a) => [a.given, a.family].filter(Boolean).join(" ")) };
  } catch (_) { return null; }
}

/* The story page, reduced to its paragraphs, and any DOIs printed in it. */
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function readStory(url) {
  try {
    let html = await get(url, 10000, "text", { "User-Agent": BROWSER, Accept: "text/html" });
    /* keep the article body when the page marks it */
    const body = html.match(/<div[^>]+id="(?:text|story_text)"[\s\S]*?<\/div>\s*<\/div>/i) || html.match(/<article[\s\S]*?<\/article>/i)
      || html.match(/<div[^>]+class="[^"]*(?:entry-content|article-body|post-content|td-post-content)[^"]*"[\s\S]*?<\/div>/i);
    const refs = html.match(/Journal Reference[\s\S]{0,1500}/i);
    if (body && body[0].length > 1500) html = body[0] + (refs ? refs[0] : "");
    const dois = [...new Set((html.match(/10\.\d{4,9}\/[^\s"'<>&]+/g) || []).map((d) => d.replace(/[.,;)\]]+$/, "")))].slice(0, 4);
    const paras = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map((p) => decode(p.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 80 && !/cookie|subscribe|newsletter|all rights reserved|javascript/i.test(p));
    return { text: paras.join("\n").slice(0, 7000), dois };
  } catch (_) { return { text: "", dois: [] }; }
}
async function readStoryMeta(url) {
  try {
    const html = await get(url, 8000, "text", { "User-Agent": BROWSER, Accept: "text/html" });
    const m = html.match(/<meta[^>]+(?:property|name)="(?:og:description|description)"[^>]+content="([^"]+)"/i);
    return m ? decode(m[1]) : "";
  } catch (_) { return ""; }
}

async function findImage(...tries) {
  for (const t of tries.filter(Boolean)) { const im = await findImage1(t); if (im) return im; }
  return null;
}
async function findImage1(terms) {
  try {
    const d = await get(`${COMMONS}?action=query&generator=search&gsrsearch=${encodeURIComponent(terms + " filetype:bitmap")}` +
      `&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280&format=json&origin=*`, 7000, "json");
    for (const p of Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))) {
      const info = p.imageinfo?.[0]; if (!info) continue;
      const meta = info.extmetadata || {}, lic = meta.LicenseShortName?.value || "";
      if (!/^(CC|Public domain|CC0|PD)/i.test(lic)) continue;
      return { src: info.thumburl || info.url, page: info.descriptionurl, licence: lic, title: (p.title || "").replace(/^File:/, ""),
        credit: tidy(meta.Artist?.value || "").slice(0, 120) || "Wikimedia Commons" };
    }
  } catch (_) { /* optional */ }
  return null;
}

/* ------------------------------------------------------------------ model */
const VOICE = `You write the daily discovery for Residual Continuum, a site that weighs the evidence
about the deep human past (lost Ice Age coasts, megaliths, the first monuments, cataclysms, myths
that may remember real events) with two meters: how strong the evidence is, and how sure the
textbooks sound. The site's motto: coherence is the measure, not final demonstration.

VOICE: a narrator with a hook. Vivid, concrete, second person where it helps, short sentences
mixed with long ones, never sensational. Open with the most surprising concrete detail. Then what
was found, where, by whom, how it was dated or measured, what it means, what it does NOT show yet,
and what would settle it.
HONESTY, absolute: use only facts in the material supplied. Never invent a number, name, date,
quote or place. Attribute claims ("the team argues", "the study reports"). Never use proof
language: no "proves", "proof", "undeniable", "definitely", "irrefutable". No em dashes. Treat
every religion and culture with respect and never rate matters of faith. Plain text only, no
HTML, no markdown. Never write any email address or personal contact detail.
If a detail is not in the material, simply leave it out: do not write about what the source
fails to say. Keep all caveats for the "doesnt_show" field and at most one paragraph of the body.
Write for a curious reader on a phone: every paragraph should make them want the next one.`;

async function pick(cands) {
  const list = cands.map((c, i) => `[${i}] ${c.title} (${c.source}, ${c.date.slice(0, 10)})\n${c.summary.slice(0, 300)}`).join("\n\n");
  try {
    const { value } = await chatFree({
      title: "Residual Continuum, daily pick", temperature: 0.2, max_tokens: 300, budgetMs: 25_000, hedgeMs: 6_000, effort: "none",
      messages: [{ role: "system", content: VOICE },
        { role: "user", content: `Candidates:\n\n${list}\n\nPick the ONE new discovery a curious reader of this site would find most fascinating and most relevant to the deep human past, ancient monuments, lost knowledge, cataclysms or old myths. Prefer real finds and new measurements over opinion pieces, museum news or dinosaur-only stories, and prefer stories backed by a journal paper. Reply as JSON: {"i": <index>, "why": "<one sentence>"}` }],
      parse: (t) => { const o = extractJSON(t); if (!(o.i >= 0 && o.i < cands.length)) throw new Error("bad index"); return o; },
    });
    return value.i;
  } catch (_) {
    /* no model answered in time: fall back to the topic score */
    let best = 0, bs = -1;
    cands.forEach((c, i) => { const s = ((c.title + " " + c.summary).match(new RegExp(TOPICS, "gi")) || []).length; if (s > bs) { bs = s; best = i; } });
    return best;
  }
}

/* The free models answer in many shapes: the body as one string, as objects, in too few
   paragraphs. Shape it into paragraphs before judging it, so a good article is not thrown away. */
const sentences = (t) => String(t).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [String(t)];
export function shapeArticle(o, storyLen = 0) {
  if (!o || typeof o !== "object") throw new Error("no article");
  let body = o.body;
  if (typeof body === "string") body = body.split(/\n\s*\n|\n(?=\S)/);
  if (!Array.isArray(body)) throw new Error("incomplete");
  body = body.flatMap((p) => typeof p === "string" ? [p] : p && typeof p === "object" ? [p.text || p.paragraph || p.content || ""] : [])
    .map((p) => String(p).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "").trim()).filter((p) => p.length > 0);
  /* too few paragraphs but enough words: split the long ones at sentence ends */
  while (body.length < 5 && body.some((p) => p.split(/\s+/).length > 140)) {
    const k = body.reduce((m, p, i) => (p.length > body[m].length ? i : m), 0);
    const ss = sentences(body[k]); if (ss.length < 2) break;
    const half = Math.ceil(ss.length / 2);
    body.splice(k, 1, ss.slice(0, half).join("").trim(), ss.slice(half).join("").trim());
  }
  if (!o.title || body.length < 4) throw new Error("incomplete");
  const words = body.join(" ").split(/\s+/).length;
  if (words < (storyLen > 1500 ? 380 : 260)) throw new Error("too short");
  const all = [o.title, o.dek, ...body].join(" ");
  const hits = BANNED.reduce((n, [re]) => n + (all.match(re) || []).length, 0);
  if (hits > 2) throw new Error("breaks the house rules");   /* let another model write it */
  return { ...o, body };
}

async function write(item, story, refs, budgetMs = 150_000) {
  const caseList = cases.map((c) => `${c[0]}: ${c[1]}`).join("\n");
  const refTxt = refs.length ? refs.map((r) => `DOI ${r.doi}: ${r.title} (${r.container} ${r.year})`).join("\n") : "none verified";
  const { value } = await chatFree({
    title: "Residual Continuum, daily writer", temperature: 0.5, max_tokens: 4000, budgetMs, hedgeMs: 25_000, effort: "none",   /* reasoning used up the tokens: empty replies */
    messages: [{ role: "system", content: VOICE },
      { role: "user", content:
`THE DISCOVERY
Headline: ${item.title}
Source: ${item.source}, ${item.date.slice(0, 10)}, ${item.link}
Summary: ${item.summary}

FULL STORY TEXT
${story.text || "(unavailable: use the summary only, and keep the article shorter)"}

VERIFIED PAPERS (cite only these, by DOI)
${refTxt}

CASES ON THIS SITE (id: title)
${caseList}

Write the article. Return ONLY JSON:
{"title": "<= 80 chars, a hook, sentence case, no colon",
 "kicker": "2-3 words",
 "dek": "1-2 sentences, <= 240 chars",
 "body": ["5 to 8 paragraphs of plain text, 60-120 words each"],
 "doesnt_show": "1-2 sentences: what this does not show yet",
 "settle": "1 sentence: what would settle it",
 "firm": "solid | strong | plausible | contested",
 "related": ["0-3 case ids from the list that this bears on"],
 "image_terms": "3-6 concrete words for an image search (place, object, site)",
 "image_place": "1-3 words: the site or region name only, for a second image search"}` }],
    parse: (t) => shapeArticle(extractJSON(t), story.text.length),
  });
  return value;
}

/* ------------------------------------------------------------------ github */
async function gh(path, opts = {}) {
  const r = await fetch(`${GH}${path}`, { ...opts, headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": UA, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}`);
  return r.status === 204 ? null : r.json();
}

async function readIndex(repo) {
  try {
    const f = await gh(`/repos/${repo}/contents/blog/index.json?ref=${BRANCH}`);
    return JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  } catch (_) { return { posts: [] }; }
}

/* One commit with both files, via the Git data API (no size limits, no index.html). */
async function commit(repo, files, message) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${BRANCH}`);
  const head = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
  const tree = await gh(`/repos/${repo}/git/trees`, { method: "POST", body: JSON.stringify({
    base_tree: head.tree.sha, tree: files.map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) }) });
  const c = await gh(`/repos/${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await gh(`/repos/${repo}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  return c.sha;
}

/* ------------------------------------------------------------------ main */
export default async function handler(req, res) {
  const url = new URL(req.url, "https://x");
  const repo = process.env.GITHUB_REPO;

  if (url.searchParams.get("check")) {           /* health check: no secrets, no writes */
    const feeds = await Promise.all(FEEDS.map(readFeed));
    let push = null;
    try { push = !!(await gh(`/repos/${repo}`)).permissions?.push; } catch (_) { push = false; }
    return res.status(200).json({
      openrouter_key: !!process.env.OPENROUTER_API_KEY, github_repo: !!repo, github_write: push, cron_secret: !!process.env.CRON_SECRET,
      feeds: FEEDS.map((f, i) => [f[0], feeds[i].length]) });
  }

  if (process.env.CRON_SECRET && (req.headers.authorization || "") !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "unauthorized" });
  for (const k of ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GITHUB_REPO"])
    if (!process.env[k]) return res.status(500).json({ error: `missing env var ${k}` });

  const today = new Date().toISOString().slice(0, 10), t0 = Date.now();
  try {
    const index = await readIndex(repo);
    const posts = Array.isArray(index.posts) ? index.posts : [];
    if (posts.some((p) => p.date === today) && !url.searchParams.get("again"))
      return res.status(200).json({ skipped: "already published today" });
    const seen = new Set(posts.flatMap((p) => [p.source?.url, p.title].filter(Boolean)));

    const all = (await Promise.all([...FEEDS.map(readFeed), crossrefRecent()])).flat();
    const week = Date.now() - 8 * 864e5;
    const byLink = new Map();
    for (const c of all) if (!byLink.has(c.link) && !seen.has(c.link) && !seen.has(c.title) && (!c.date || Date.parse(c.date) > week)) byLink.set(c.link, c);
    let cands = [...byLink.values()].filter((c) => TOPICS.test(c.title + " " + c.summary));
    if (!cands.length) return res.status(200).json({ skipped: "no new discoveries in the feeds", read: all.length });
    cands = cands.sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0)).slice(0, 24);

    const item = cands[await pick(cands)];
    const story = item.doi ? { text: item.summary, dois: [item.doi] } : await readStory(item.link);
    if (story.text.length < 600) story.text = [story.text, await readStoryMeta(item.link)].filter(Boolean).join("\n");
    const refs = (await Promise.all(story.dois.map(verifyDoi))).filter(Boolean);

    let d;
    try { d = await write(item, story, refs); }
    catch (e) {
      console.error("draft: writer failed once:", String(e.message || e).slice(0, 200));
      const left = 285_000 - (Date.now() - t0);                 /* maxDuration 300 s */
      if (left < 60_000) throw e;
      d = await write(item, story, refs, Math.min(110_000, left - 25_000));
    }
    const body = d.body.map(clean).filter((p) => p.length > 40);
    const ids = new Set(cases.map((c) => c[0]));
    const firm = ["solid", "strong", "plausible", "contested"].includes(d.firm) ? d.firm : "plausible";
    const image = await findImage(tidy(d.image_terms || "").slice(0, 80), tidy(d.image_place || ""), tidy(item.title).split(/\s+/).filter((w) => w.length > 4).slice(0, 3).join(" "));

    const post = {
      id: today, date: today, title: clean(d.title).slice(0, 110), kicker: clean(d.kicker || "New find").slice(0, 40),
      dek: clean(d.dek).slice(0, 300), body, doesnt_show: clean(d.doesnt_show), settle: clean(d.settle), firm,
      related: (d.related || []).filter((x) => ids.has(x)).slice(0, 3),
      source: { name: item.source, url: item.link, title: tidy(item.title), date: (item.date || "").slice(0, 10) },
      refs, image, drafted: "Written with a free AI model from the source above, checked automatically for the site's rules. Report an error and it will be corrected in place, with a note.",
    };
    const entry = { id: post.id, date: post.date, title: post.title, kicker: post.kicker, dek: post.dek, firm, image: image ? { src: image.src, title: image.title } : null, source: post.source.name };
    const next = { updated: new Date().toISOString(), posts: [entry, ...posts.filter((p) => p.id !== post.id)].slice(0, 400) };

    const sha = await commit(repo, [
      [`blog/posts/${post.id}.json`, JSON.stringify(post, null, 1) + "\n"],
      ["blog/index.json", JSON.stringify(next, null, 1) + "\n"],
    ], `Daily discovery ${today}: ${post.title}`);
    return res.status(200).json({ ok: true, title: post.title, source: item.link, story_chars: story.text.length, refs: refs.length, image: !!image, commit: sha });
  } catch (e) {
    console.error("draft: failed:", String(e.message || e).slice(0, 300));
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
