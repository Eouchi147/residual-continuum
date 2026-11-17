# LESSONS · Residual Continuum

Every mistake and the rule it earned. Append only, dated.

Seeded on 17 Nov 2026 from AUDIT.md and the daily posts.

L1 · undated (AUDIT.md) · A backdrop blur over a flat background costs GPU time and shows nothing. Rule: blur only where the content behind it varies (the bottom nav). Source: AUDIT.md, finding 1.

L2 · undated (AUDIT.md) · text-wrap: pretty means different things in each browser engine. Rule: safe to ship, never something to depend on; balance on headings only. Source: AUDIT.md, finding 2.

L3 · undated (AUDIT.md) · Removing old code with a non-greedy regex stopped at the first `});` and left a fragment that broke the whole script. Rule: remove code with brace-balanced edits, and run node --check after every scripted edit. Source: AUDIT.md.

L4 · 17 Nov 2026 · The duplicate check read a field the writer never stored: index entries carry source as the outlet's name, the check reads source.url, so it never fired and 26 of 48 posts repeated a link. Rule: test a guard against the stored data, not against the shape the writer meant. Source: api/draft.js as it stood before PR #2 (lines 339 and 374), blog/index.json.
