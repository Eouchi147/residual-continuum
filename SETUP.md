# The daily discovery and the assistant: setup

## What runs by itself

| Piece | File | When |
|---|---|---|
| Site assistant ("Ask") | `api/ask.js` | on every question |
| Daily discovery (the blog) | `api/draft.js` | every day at 07:00 UTC (Vercel Cron, `vercel.json`) |
| Free-model picker | `api/_models.js` | used by both |

**Models are free only.** Every 30 minutes the picker reads OpenRouter's public catalogue, keeps models priced at exactly zero, leaves out specialists (safety, code, finance, music) and tiny models, and ranks the rest by lab track record, size, recency and OpenRouter's own uptime figures, then adjusts by how fast and reliable each has actually been for this site. Requests are hedged across the top few, and `openrouter/free` is the last resort. Every request also carries a price cap of zero, so OpenRouter refuses rather than bills. Check the current ranking at `https://residualcontinuum.com/api/ask` (GET).

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

* `https://residualcontinuum.com/api/draft?check=1` shows whether the feeds are reachable, the keys are present and the GitHub token can write. It reveals no secret and writes nothing.
* To run it now: Vercel, the project, Settings, Cron Jobs, **Run**.
* OpenRouter's free models allow a limited number of requests per day on an account with no credit; adding a small credit once raises that limit a lot while the models stay free.

# The Studio: the console and the AI social poster

`/admin` (not linked anywhere) is the owner's console: the films and the render farm, the posting schedule, every network's connection, and the Director, an AI that runs the console with you. Files: `admin.html`, `api/studio.js` (the one endpoint), `api/_studio.js` (store, session, dials, plan), `api/_nets.js` (one module per network), `api/_poster.js` (the hourly poster), `api/_director.js` (the AI), `studio/plan.json` (the 144 films in posting order, with their captions and sources).

## How it posts

Every hour Vercel Cron calls `/api/studio?action=due`. At each posting hour (UTC, set in the console) the next film is chosen: films you pinned first, then the plan's order, among the films the render farm (`Eouchi147/rc-render`, release `films`) has finished. In **Approve each** mode the post waits for your yes in the console; in **Automatic** it goes to every connected network on its own. A network still processing a video is finished on the next run, never uploaded twice. A film already on a network is never sent there again.

## What you set up once (Vercel → residual-continuum → Settings)

| What | Where |
|---|---|
| `ADMIN_PASSWORD` | Environment Variables: the console's password, long. Redeploy after. |
| A store | Storage → Create → Upstash Redis (free) → connect to this project. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` itself. |
| `CRON_SECRET`, `OPENROUTER_API_KEY` | already set for the daily discovery and the assistant |

## Each network's app keys (Environment Variables), then Connect in the console

| Network | Variables | The app |
|---|---|---|
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (web), YouTube Data API v3 on. NOOR's client works: add the redirect URI the console shows. Until Google's free API audit is passed, uploads stay private. |
| Facebook + Instagram | `META_APP_ID`, `META_APP_SECRET` | Meta app with Facebook Login; NOOR's app works. Add the redirect URI. Instagram must be a professional account linked to the Residual Continuum Page. |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET` | the Threads use case of a Meta app |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | developer.x.com app, OAuth 2.0, Web App, read and write |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | developers.tiktok.com app with Login Kit and the Content Posting API; posts stay private until TikTok audits the app |
| Pinterest | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | developers.pinterest.com app; video pins need Standard access |
| Bluesky | none | an app password, typed into the console |

Optional: `PUBLIC_HOST` (the domain links point to; set it to `residualcontinuum.com` once the domain is live), `FB_PAGE_NAME` or `FB_PAGE_ID`, `PIN_BOARD_NAME`, `FARM_REPO`.

Tokens won by Connect are kept in the store, sealed with AES-GCM under a key derived from `CRON_SECRET`; no token is ever shown in the console or sent to a page.

## The Director (the AI)

Free OpenRouter models only, through `api/_models.js`. It reads the whole studio and answers in the Director room; it can pin, hold, reorder, write captions per network and change the posting hours. While the "AI" dial reads **Proposes**, every change waits for your Approve; on **Acts** it makes non-publishing changes itself. Anything that publishes (post now, approve a slot, switching to Automatic) always waits for you.
