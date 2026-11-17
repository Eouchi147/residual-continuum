# OPEN · Residual Continuum

Everything unfinished, each with its next step and whose move it is. When an item closes, delete it here, and add a line to DECISIONS.md if a decision closed it.

Seeded on 17 Nov 2026.

1. **Read the first live run of the repeat fix.** PR #2 merged on 17 Nov (commit 7f8633f). Next: after the 18 Nov post lands (the first call is at 04:30 UTC), check that its source link is new and that the entries of blog/index.json now carry source_url. Not covered by the fix: the same find told again in a new article under a new link and title (1 of 48 posts, 7 Nov). Whose move: Claude, on 18 Nov.
2. **A second Vercel project builds this repo.** residual-continuum-fdge deploys every commit with no keys and no domain of its own; residualcontinuum.com is served by the project residual-continuum. Next: the owner disconnects or deletes the spare project. Whose move: the owner.
3. **The Phys.org feed returns nothing.** The health check of 17 Nov (/api/draft?check=1) read 60, 60, 60 and 100 items from the other four feeds and 0 from Phys.org. Next: check the feed address in api/draft.js. Whose move: Claude.
