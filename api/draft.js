/**
 * Residual Continuum: automated dispatch drafter
 * ------------------------------------------------------------------
 * Runs on Vercel Cron. Researches recent literature in the site's own
 * subject areas, drafts a short dispatch, VERIFIES every citation against
 * the CrossRef register, finds an openly-licensed image, splices the entry
 * into index.html between the DISPATCHES markers, and opens a pull request
 * for human review.
 *
 * It never commits to the default branch. The one click you keep is the
 * one that protects the site's credibility.
 *
 * Required environment variables (set in Vercel → Settings → Environment
 * Variables; never in the repository):
 * OPENROUTER_API_KEY your OpenRouter key
 * GITHUB_TOKEN fine-grained PAT, Contents + Pull requests: write
 * GITHUB_REPO e.g. "Eouchi147/residual-continuum"
 * CRON_SECRET any long random string; Vercel sends it back
 * Optional:
 * OPENROUTER_MODEL default "anthropic/claude-sonnet-4.5"
 * CONTACT_EMAIL used for the CrossRef polite pool
 * GITHUB_BRANCH default "main"
 */

const GH = "https://api.github.com";
const CROSSREF = "https://api.crossref.org";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const MAILTO = process.env.CONTACT_EMAIL || "noreply@example.com";
const BRANCH = process.env.GITHUB_BRANCH || "main";

/* The AI writes only inside the site's remit. Rotating so coverage spreads
 rather than fixating on whatever is loudest this week. */
const BEATS = [
 { key: "sea-level", label: "Sea level and deglaciation",
 query: "meltwater pulse OR deglacial sea level OR shelf inundation" },
 { key: "younger-dryas", label: "Abrupt climate change",
 query: "Younger Dryas OR abrupt climate transition ice core" },
 { key: "ppna", label: "Pre-Pottery Neolithic",
 query: "Gobekli Tepe OR Tas Tepeler OR Pre-Pottery Neolithic" },
 { key: "archaeoacoustics", label: "Archaeoacoustics",
 query: "archaeoacoustics OR resonance archaeology chamber" },
 { key: "metrology", label: "Architectural metrology",
 query: "ancient metrology OR megalithic architecture survey" },
 { key: "oral-tradition", label: "Oral transmission",
 query: "oral tradition longevity OR indigenous memory landscape" },
 { key: "geomyth", label: "Geomythology",
 query: "geomythology OR fossil folklore OR palaeontology folklore" },
 { key: "dating", label: "Dating methods",
 query: "radiocarbon calibration OR luminescence dating archaeology" },
 { key: "pseudoarch", label: "Public archaeology",
 query: "pseudoarchaeology OR archaeology public perception" },
];

/* Pre-approved post accents. The AI picks one of these four and nothing
 else: Direction C stays locked. */
const ACCENTS = ["amber", "umber", "stone", "slate"];

/* Defence in depth. CONTACT_EMAIL is only ever used server-side in CrossRef
 URLs and is never rendered: but a model can echo an address it saw in a
 prompt, an abstract, or an author field. Nothing matching an email pattern
 reaches the page. */
const stripEmails = (s) =>
 String(s == null ? "": s).replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[address removed]");

const esc = (s) =>
 String(s == null ? "": s)
 .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;")
 .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
 "[address removed]");

async function j(url, opts = {}) {
 const r = await fetch(url, opts);
 if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
 return r.json();
}

/* ---------------------------------------------------------------- sources */
async function findCandidates(beat, days = 45) {
 const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
 const url =
 `${CROSSREF}/works?query.bibliographic=${encodeURIComponent(beat.query)}` +
 `&filter=from-pub-date:${since},type:journal-article` +
 `&sort=published&order=desc&rows=25&mailto=${MAILTO}`;
 const data = await j(url);
 return (data.message?.items || [])
 .filter((it) => it.DOI && it.title?.length)
 .map((it) => ({
 doi: it.DOI,
 title: it.title[0],
 container: it["container-title"]?.[0] || "",
 year: it.issued?.["date-parts"]?.[0]?.[0] || "",
 authors: (it.author || []).slice(0, 6)
 .map((a) => [a.family, a.given].filter(Boolean).join(", ")),
 abstract: (it.abstract || "").replace(/<[^>]+>/g, " ")
 .replace(/\s+/g, " ").trim().slice(0, 1400),
 volume: it.volume || "", issue: it.issue || "", page: it.page || "",
 }))
 .filter((c) => c.abstract.length > 180)
 .slice(0, 8);
}

/* CrossRef is the arbiter. A DOI the register does not know does not ship. */
async function verifyDoi(doi) {
 try {
 const data = await j(`${CROSSREF}/works/${encodeURIComponent(doi)}` +
 `?mailto=${MAILTO}`);
 const m = data.message;
 if (!m?.title?.length) return null;
 return {
 doi: m.DOI,
 title: m.title[0],
 container: m["container-title"]?.[0] || "",
 year: m.issued?.["date-parts"]?.[0]?.[0] || "",
 authors: (m.author || []).map((a) => [a.family, a.given].filter(Boolean).join(", ")),
 volume: m.volume || "", issue: m.issue || "", page: m.page || "",
 };
 } catch { return null; }
}

function chicago(r) {
 const names = r.authors.length
 ? (r.authors.length > 3
 ? `${r.authors[0]} et al.`
 : r.authors.join("; "))
 : "";
 const bits = [names, r.year ? `${r.year}.`: "", `"${r.title}."`];
 if (r.container) bits.push(`<em>${esc(r.container)}</em>`);
 const vip = [r.volume, r.issue ? `(${r.issue})`: ""].filter(Boolean).join(" ");
 if (vip) bits.push(vip);
 if (r.page) bits.push(`: ${r.page}`);
 return bits.filter(Boolean).join(" ").replace(/\s+([:.])/g, "$1");
}

/* ---------------------------------------------------------------- images */
async function findImage(terms) {
 try {
 const url = `${COMMONS}?action=query&generator=search` +
 `&gsrsearch=${encodeURIComponent(terms + " filetype:bitmap")}` +
 `&gsrnamespace=6&gsrlimit=6&prop=imageinfo` +
 `&iiprop=url|extmetadata&iiurlwidth=1280&format=json&origin=*`;
 const data = await j(url);
 const pages = Object.values(data.query?.pages || {});
 for (const p of pages) {
 const info = p.imageinfo?.[0]; if (!info) continue;
 const meta = info.extmetadata || {};
 const licence = meta.LicenseShortName?.value || "";
 /* Open licences only. No "fair use", no unknown. */
 if (!/^(CC|Public domain|CC0)/i.test(licence)) continue;
 const artist = (meta.Artist?.value || "")
 .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
 return {
 src: info.thumburl || info.url,
 page: info.descriptionurl,
 licence,
 licenceUrl: meta.LicenseUrl?.value || "",
 credit: artist || "Wikimedia Commons",
 title: (p.title || "").replace(/^File:/, ""),
 };
 }
 } catch { /* an image is optional; a wrong licence is not */ }
 return null;
}

/* ------------------------------------------------------------------ model */
/* The model is never shown any account address, and is told so. */
const SYSTEM = `You write short dispatches for Residual Continuum, an
independent chronological reconstruction reading climate data, archaeology
and memory traditions as one sequence.

REGISTER: non-negotiable:
- Calm, precise, academic. Understated. No sensationalism, no rhetorical
 questions, no "remarkably", "stunning", "groundbreaking".
- NEVER use proof language: not "proves", "confirms", "demonstrates
 conclusively". Use "is consistent with", "constrains", "does not exclude".
 The site's principle is "coherence is the measure, not final demonstration".
- State uncertainty inline wherever a number appears: give the method and
 the caveat.
- Never invent a statistic. If a count would depend on definition, say so
 instead of giving a number.

SOURCING: absolute:
- You may ONLY cite the papers supplied to you below. Cite them by DOI.
- Do NOT invent DOIs, volumes, pages, or findings. Anything you cite is
 checked against CrossRef after you write, and unverifiable references are
 deleted from your draft.
- Do not attribute a claim to a paper whose abstract does not support it.

PRIVACY: absolute:
- Never write an email address, personal name of the site owner, account handle, or any contact detail. If a source contains one, omit it. The site is published without a personal byline.

FORBIDDEN VOCABULARY: the site deliberately keeps a comparative register:
never write Islam, Islamic, Muslim, Quran, Quranic, hadith, jinn, djinn,
Allah, Nuh, Sunnah. Use neutral terms (Mesopotamian traditions, Near Eastern
recensions).

Return ONLY valid JSON, no markdown fence, matching:
{
 "title": "sentence case, <= 80 chars, no colon-subtitle padding",
 "kicker": "2-3 word section label",
 "accent": one of ["amber","umber","stone","slate"],
 "standfirst": "1-2 sentences, <= 320 chars, what changed and why it matters",
 "body": ["<p>...</p>", "<p>...</p>", "<p>...</p>"],
 "cite_dois": ["10.xxxx/yyy"],
 "image_terms": "3-6 words for an image search, concrete and physical",
 "relates_to": "one short clause on how this bears on the reconstruction"
}
body: 3-5 paragraphs, 70-130 words each. Inline tags <em> and <strong> only.
NEVER write a bare "<": always &lt;. Never a bare "&" (always &amp;.`;

async function draft(beat, candidates) {
 const supplied = candidates.map((c, i) =>
 `[${i + 1}] DOI ${c.doi}\nTitle: ${c.title}\nVenue: ${c.container} ` +
 `${c.year}\nAuthors: ${c.authors.join("; ")}\nAbstract: ${c.abstract}`).join("\n\n");

 const body = {
 model: MODEL,
 temperature: 0.4,
 max_tokens: 2200,
 messages: [
 { role: "system", content: SYSTEM },
 { role: "user", content:
 `Beat: ${beat.label}\n\nRecent papers you may cite) and ONLY ` +
 `these:\n\n${supplied}\n\nChoose the single most consequential ` +
 `result for the reconstruction and write the dispatch. If none is ` +
 `genuinely relevant, return {"skip": true, "why": "..."}.` },
 ],
 };

 const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
 method: "POST",
 headers: {
 Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
 "Content-Type": "application/json",
 "HTTP-Referer": "https://residual-continuum.vercel.app",
 "X-Title": "Residual Continuum, dispatch drafter",
 },
 body: JSON.stringify(body),
 });
 if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
 const out = await r.json();
 const text = out.choices?.[0]?.message?.content?.trim() || "";
 const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
 return JSON.parse(clean);
}

/* ------------------------------------------------------------------ render */
function render(post, refs, image, dateISO, accession) {
 const accent = ACCENTS.includes(post.accent) ? post.accent: "amber";
 const human = new Date(dateISO + "T00:00:00Z").toLocaleDateString("en-GB", {
 day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

 const fig = image ? (`<figure class="dp-fig">` +
 `<img src="${esc(image.src)}" alt="${esc(post.image_alt ||
 image.title)}" loading="lazy" decoding="async">` +
 `<figcaption class="dp-credit">${esc(image.title)}: ` +
 `${esc(image.credit)}, <a href="${esc(image.page)}" rel="noopener ` +
 `nofollow" target="_blank">Wikimedia Commons</a>, ` +
 `${esc(image.licence)}.</figcaption></figure>`): "";

 const reflist = refs.map((r) =>
 `<li>${chicago(r)} <a href="https://doi.org/${esc(r.doi)}" ` +
 `rel="noopener" target="_blank">doi:${esc(r.doi)}</a>` +
 `<span class="dp-verified">verified</span></li>`).join("");

 return (`<article class="dp" data-accent="${accent}" id="${esc(accession)}">` +
 `<div class="dp-head"><span class="dp-kicker">${esc(post.kicker)}</span>` +
 `<span class="dp-date"><span class="acc">${esc(accession)}</span>` +
 `<time datetime="${dateISO}">${human}</time></span></div>` +
 `<h2>${esc(post.title)}</h2>` +
 `<p class="dp-stand">${esc(post.standfirst)}</p>` +
 fig +
 `<div class="dp-body">${stripEmails(post.body.join(""))}` +
 (post.relates_to
 ? `<p><strong>Bearing on the reconstruction:</strong> ` +
 `${esc(post.relates_to)}</p>`: "") +
 `</div>` +
 (reflist
 ? `<div class="dp-refs"><div class="dp-refs-h">Sources</div>` +
 `<ol>${reflist}</ol></div>`: "") +
 `</article>`);
}

/* ------------------------------------------------------------------ github */
async function gh(path, opts = {}) {
 return j(`${GH}${path}`, {
 ...opts,
 headers: {
 Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
 Accept: "application/vnd.github+json",
 "X-GitHub-Api-Version": "2022-11-28",
 "Content-Type": "application/json",
 ...(opts.headers || {}),
 },
 });
}

async function openPR(html, post, refs, dropped, dateISO) {
 const repo = process.env.GITHUB_REPO;
 const file = await gh(`/repos/${repo}/contents/index.html?ref=${BRANCH}`);
 const current = Buffer.from(file.content, "base64").toString("utf8");

 const START = "<!-- DISPATCHES:START -->";
 const END = "<!-- DISPATCHES:END -->";
 const a = current.indexOf(START), b = current.indexOf(END);
 if (a < 0 || b < 0) throw new Error("DISPATCHES markers not found");

 let inner = current.slice(a + START.length, b);
 /* first real entry replaces the empty state */
 if (inner.includes("dp-empty")) inner = "";
 const updated =
 current.slice(0, a + START.length) + "\n" + html + "\n" + inner.trim() +
 "\n" + current.slice(b);

 const head = await gh(`/repos/${repo}/git/ref/heads/${BRANCH}`);
 const branch = `dispatch/${dateISO}-${Math.abs([...post.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`;

 await gh(`/repos/${repo}/git/refs`, {
 method: "POST",
 body: JSON.stringify({ ref: `refs/heads/${branch}`,
 sha: head.object.sha }),
 }).catch(() => {}); /* branch may already exist; fine */

 await gh(`/repos/${repo}/contents/index.html`, {
 method: "PUT",
 body: JSON.stringify({
 message: `dispatch: ${post.title}`,
 content: Buffer.from(updated, "utf8").toString("base64"),
 sha: file.sha,
 branch,
 }),
 });

 const droppedNote = dropped.length
 ? `\n\n### Removed by the citation gate\n` +
 dropped.map((d) => `- \`${d}\` (not found in CrossRef`).join("\n")
 : "\n\nNo references were removed; every citation verified.";

 const pr = await gh(`/repos/${repo}/pulls`, {
 method: "POST",
 body: JSON.stringify({
 title: `Dispatch) ${post.title}`,
 head: branch, base: BRANCH,
 body:
 `**${post.kicker}** · ${dateISO}\n\n${post.standfirst}\n\n` +
 `### Verified sources (${refs.length})\n` +
 refs.map((r) => `- ${r.title}, doi:${r.doi}`).join("\n") +
 droppedNote +
 `\n\n---\nDrafted automatically. Every DOI above was confirmed ` +
 `against the CrossRef register before this PR was opened. ` +
 `Review the prose for register and accuracy, then merge to publish.`,
 }),
 });
 return pr.html_url;
}

/* -------------------------------------------------------------------- main */
export default async function handler(req, res) {
 const auth = req.headers.authorization || "";
 if (process.env.CRON_SECRET &&
 auth !== `Bearer ${process.env.CRON_SECRET}`) {
 return res.status(401).json({ error: "unauthorized" });
 }
 for (const k of ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "GITHUB_REPO"]) {
 if (!process.env[k]) {
 return res.status(500).json({ error: `missing env var ${k}` });
 }
 }

 const dateISO = new Date().toISOString().slice(0, 10);
 const beat = BEATS[new Date().getUTCDate() % BEATS.length];

 try {
 const candidates = await findCandidates(beat);
 if (!candidates.length) {
 return res.status(200).json({ skipped: "no candidates", beat: beat.key });
 }

 const post = await draft(beat, candidates);
 if (post.skip) {
 return res.status(200).json({ skipped: post.why, beat: beat.key });
 }

 /* the gate: verify, then drop */
 const refs = [];
 const dropped = [];
 for (const doi of (post.cite_dois || []).slice(0, 6)) {
 const v = await verifyDoi(doi);
 if (v) refs.push(v); else dropped.push(doi);
 }
 if (!refs.length) {
 return res.status(200).json({
 skipped: "no citation survived verification",
 dropped, beat: beat.key });
 }

 const image = await findImage(post.image_terms || beat.label);
 const accession = `RC·D·${dateISO.replace(/-/g, "")}`;
 const html = render(post, refs, image, dateISO, accession);
 const url = await openPR(html, post, refs, dropped, dateISO);

 return res.status(200).json({
 ok: true, beat: beat.key, title: post.title,
 verified: refs.length, dropped, image: image?.licence || null,
 pull_request: url,
 });
 } catch (e) {
 return res.status(500).json({ error: String(e.message || e),
 beat: beat.key });
 }
}
