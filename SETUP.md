# The daily discovery and the assistant: setup

## What runs by itself

| Piece | File | When |
|---|---|---|
| Site assistant ("Ask") | `api/ask.js` | on every question |
| Daily discovery (the blog) | `api/draft.js` | every day at 07:00 UTC (Vercel Cron, `vercel.json`) |
| Free-model picker | `api/_models.js` | used by both |

**Models are free only.** Every 30 minutes the picker reads OpenRouter's public catalogue, keeps models priced at exactly zero, leaves out specialists (safety, code, finance, music) and tiny models, and ranks the rest by lab track record, size, recency and OpenRouter's own uptime figures, then adjusts by how fast and reliable each has actually been for this site. Requests are hedged across the top few, and `openrouter/free` is the last resort. Every request also carries a price cap of zero, so OpenRouter refuses rather than bills. Check the current ranking at `https://residual-continuum.vercel.app/api/ask` (GET).

## How the daily discovery works

1. Reads the newest stories from ScienceDaily (archaeology, ancient civilizations, early humans), HeritageDaily and Phys.org, plus new journal papers from CrossRef.
2. The best free model picks the single most fascinating new find for this site.
3. The full story is read, any DOI in it is checked against CrossRef (a DOI that does not resolve is dropped).
4. The model writes the article in the site's voice. It is checked automatically: no proof language, no em dashes, no email addresses, a minimum length, a real source link. A draft that breaks the rules is thrown away and another model writes it.
5. An openly licensed Wikimedia Commons image is attached with its credit.
6. Two small files are committed to the repository: `blog/posts/<date>.json` and `blog/index.json`. Vercel redeploys and the entry appears on the Daily discovery page and on Home. `index.html` is never touched.

Every entry says it was written with a free AI model from the linked source. To correct one, edit its file in `blog/posts/` on GitHub.

## Environment variables (Vercel, Settings, Environment Variables)

| Name | What |
|---|---|
| `OPENROUTER_API_KEY` | your OpenRouter key |
| `GITHUB_TOKEN` | fine-grained token, this repository only, **Contents: Read and write** |
| `GITHUB_REPO` | `Eouchi147/residual-continuum` |
| `CRON_SECRET` | any long random string; Vercel Cron sends it back automatically |
| `CONTACT_EMAIL` | optional, used only in CrossRef's polite-pool URL, never shown |
| `FREE_MODELS_PREFER` | optional, free model ids to try first |

## Checking it

* `https://residual-continuum.vercel.app/api/draft?check=1` shows whether the feeds are reachable, the keys are present and the GitHub token can write. It reveals no secret and writes nothing.
* To run it now: Vercel, the project, Settings, Cron Jobs, **Run**.
* OpenRouter's free models allow a limited number of requests per day on an account with no credit; adding a small credit once raises that limit a lot while the models stay free.
