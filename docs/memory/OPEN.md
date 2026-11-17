# OPEN · Residual Continuum

Everything unfinished, each with its next step and whose move it is. When an item closes, delete it here, and add a line to DECISIONS.md if a decision closed it.

Seeded on 17 Nov 2026.

1. **Merge the PR that installed CLAUDE.md, docs/memory/ and .vercelignore** (branch claude/standing-instruction). Whose move: the owner.
2. **The daily discovery posts the same story again.** 48 posts from 26 Sep to 17 Nov use only 22 distinct source links: 26 posts re-used a link already posted (the German lake timbers 5 days running from 7 Oct, then 6 days running from 7 Nov on a second article; the Moroccan wall 1 to 5 Nov; the drowned Australian coast 4 times). Cause: api/draft.js line 339 reads p.source?.url from blog/index.json, but line 374 writes source there as the outlet's name, so no posted link is ever remembered and a story stays pickable for its 8 days in the feeds. Fix: PR #2 (branch claude/discovery-dedupe), 17 Nov; replayed on all 48 posts it catches 26 of 26 repeats and blocks 0 of the 22 first posts. Next: the owner merges it; then Claude reads the first live response (recovered, already_posted). Not covered by the fix: the same find told again in a new article under a new link and title (1 of 48 posts, 7 Nov). Whose move: the owner, then Claude.
3. **SETUP.md says the daily discovery runs at 07:00 UTC;** vercel.json calls it at 04:30, 05:30, 06:30, 10:30 and 14:30 UTC. Fixed in PR #2. Whose move: the owner (merge).
