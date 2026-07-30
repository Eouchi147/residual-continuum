# Automated dispatches — setup

The blog writes itself daily and **opens a pull request** instead of publishing. You merge to publish. Nothing reaches the live site without that click.

## Why it is built this way

Three constraints drove the design, and each is worth knowing:

1. **The OpenRouter key must never reach a browser.** Anything in `index.html` is readable via View Source, and scraper bots find and drain leaked keys within hours. The key lives only in a Vercel environment variable, used server-side.
2. **A static file cannot write to itself.** The function edits `index.html` through the GitHub API, between two markers, so the site stays a single file and every automated change is a readable diff.
3. **An LLM will invent citations if allowed to.** Every DOI is checked against the CrossRef register before the PR opens. References that fail are **deleted from the draft**, and the PR body lists what was cut.

## 1. Files

```
index.html          the site (unchanged in character — still one file)
api/draft.js        the serverless function
vercel.json         cron schedule + security headers
```

Commit all three. No build step, no `package.json` needed — `api/draft.js` uses only built-in `fetch`.

## 2. GitHub token

Create a **fine-grained personal access token** (Settings → Developer settings → Personal access tokens → Fine-grained):

- **Repository access:** only `Eouchi147/residual-continuum`
- **Permissions:** `Contents: Read and write`, `Pull requests: Read and write`
- Nothing else. Do not use a classic token with full `repo` scope.

## 3. Environment variables

In Vercel → your project → Settings → Environment Variables, add for **Production**:

| Name | Value |
|---|---|
| `OPENROUTER_API_KEY` | your OpenRouter key |
| `GITHUB_TOKEN` | the fine-grained PAT above |
| `GITHUB_REPO` | `Eouchi147/residual-continuum` |
| `CRON_SECRET` | any long random string — `openssl rand -hex 32` |
| `CONTACT_EMAIL` | your email (CrossRef's polite pool; improves rate limits) |
| `OPENROUTER_MODEL` | optional, defaults to `anthropic/claude-sonnet-4.5` |

`CRON_SECRET` is what stops anyone on the internet from triggering drafts and spending your credits. Vercel sends it back automatically as a bearer token; the function rejects requests without it.

## 4. Schedule

`vercel.json` runs it daily at 07:00 UTC. Change the cron expression to taste — `0 7 * * 1,4` for twice a week. Vercel's Hobby plan allows one cron per day; Pro allows more.

## 5. First run

Deploy, then trigger manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-project.vercel.app/api/draft
```

A successful run returns the PR URL:

```json
{ "ok": true, "beat": "ppna", "title": "…",
  "verified": 2, "dropped": [], "pull_request": "https://github.com/…/pull/7" }
```

It may also legitimately return `{"skipped": "…"}` — when nothing relevant published that week, or when **no citation survived verification**. A skip is the system working, not failing.

## 6. What it can and cannot change

**Can:**

- Write the dispatch — title, kicker, standfirst, body, and a closing line on how the result bears on the reconstruction
- Choose one of four pre-approved accents: `amber`, `umber`, `stone`, `slate` — all derived from the locked palette
- Attach one openly-licensed image from Wikimedia Commons, with creator and licence printed in the caption
- Cite up to six papers, each verified

**Cannot:**

- Touch any Direction C token — palette, fonts, glass, spacing, the bottom nav
- Write CSS, load a font, or alter any view other than the dispatch list
- Commit to `main`
- Publish a citation CrossRef does not recognise
- Use an image without an open licence — `findImage` requires the licence string to begin with `CC`, `CC0` or `Public domain`, and returns nothing otherwise

## 7. Editorial rules the writer is held to

The system prompt enforces the site's register: no proof language, uncertainty stated inline wherever a number appears, no invented statistics, and the comparative vocabulary that keeps the spine implicit. It may only cite papers supplied to it in the prompt — it never writes from memory.

Nine rotating beats keep coverage broad: sea level and deglaciation, abrupt climate change, Pre-Pottery Neolithic, archaeoacoustics, architectural metrology, oral transmission, geomythology, dating methods, public archaeology. The beat advances by day of month.

## 8. Reviewing a PR

The PR body gives you the standfirst, the verified sources with DOIs, and anything the citation gate removed. Read the prose for register — that is the part no automation can check. Merge to publish; Vercel redeploys in seconds.

If a draft is wrong rather than merely weak, close the PR and delete the branch. Nothing is lost; the next run is independent.

## 9. Cost

One dispatch is roughly 6–10k input tokens and 1–2k output. At current OpenRouter pricing for a mid-tier model that is a few cents per run — on the order of a dollar or two a month at daily cadence. CrossRef and the Commons API are free. Set a spend limit on your OpenRouter account regardless.

## 10. If something breaks

- **401 from the function** — `CRON_SECRET` mismatch between Vercel and your curl.
- **`DISPATCHES markers not found`** — the `<!-- DISPATCHES:START -->` / `<!-- DISPATCHES:END -->` comments were removed from `index.html`. Restore them; they are how the function finds its insertion point.
- **`missing env var …`** — set it for the Production environment specifically, then redeploy.
- **Every run skips** — usually the citation gate doing its job on a thin week. Check the `dropped` array in the response; if DOIs are being invented consistently, lower the temperature in `draft.js` or switch model.
