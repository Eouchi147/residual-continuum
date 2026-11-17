# STATE · Residual Continuum

Where the project stands now. Rewrite this file so it is true today; do not append to it.

Last rewrite: 17 Nov 2026, from the repo. Before the two merges of 17 Nov (the repeat fix, then this install), main was at e880227 (17 Nov 2026, 04:30 UTC: the daily discovery for 17 Nov).

## What it is

A field guide to the human past built around one pattern: rises and collapses, drowned coastlines, and knowledge lost and found. Every open question gets what is solid, the mainstream story, the challengers' case at its strongest, what would settle it, and two meters: the weight of evidence and how confident the textbooks sound. One static page with no build step, plus api/ functions on Vercel: https://residualcontinuum.com.

## Where it stands

- The daily discovery: api/draft.js drafts one post a day from new archaeology news and papers on free models and commits blog/posts/<date>.json and blog/index.json to main (SETUP.md). vercel.json calls it at 04:30, 05:30, 06:30, 10:30 and 14:30 UTC, and a call that finds today's post already published skips (api/draft.js).
- 48 posts from 26 Sep to 17 Nov use 22 distinct source links: 26 posts re-used a link already posted. The fix merged on 17 Nov (PR #2, commit 7f8633f): a story already posted, by link or by title, is left out before the model picks (api/_seen.js). Its first live run is the 18 Nov post (OPEN.md, item 1).
- The site assistant (/api/ask) answers on free models only, re-picked from OpenRouter's catalogue every 30 minutes (SETUP.md).
- The studio: every hour Vercel Cron calls /api/studio?action=due; at each posting hour the next finished film from rc-render's films release goes to the connected networks, after the owner's yes in Approve each mode or on its own in Automatic mode (SETUP.md).
- The films are rendered in the separate rc-render repo.
- Two Vercel projects build every commit: residual-continuum serves residualcontinuum.com and holds the keys; residual-continuum-fdge has no keys and no domain of its own (OPEN.md, item 2).

## Not verified on 17 Nov

- The studio's posting state.
- Why the Phys.org feed returned no items in the health check of 17 Nov (OPEN.md, item 3).
