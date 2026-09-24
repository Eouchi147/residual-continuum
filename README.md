# Residual Continuum

**The human story, with receipts.** An extremely fun way to learn history through real human tales and scientific data: how everything came about, from the Big Bang to 1500 CE, with every famous legend weighed against the evidence and given an honest verdict on the Receipt Meter (Busted, No receipts yet, Hot debate, Plausible, Strong, Rock solid).

Live: https://residual-continuum.vercel.app

## What is inside

| View | Contents |
|---|---|
| Journey | 16 photo stops from the Big Bang to 1500 CE: a scene, the numbers, the big debate, recent discoveries |
| Legends | 28 legends, miracles, lost cities and relics on trial, each with a rubber-stamp verdict, plus two long Deep Dives |
| People | 26 real people known from bones, footprints, letters and complaints |
| Books | 22 ancient texts, finds and keys, with oldest copies and a history check |
| Wonders | 19 wonders with real numbers, how they were built, and the myth flipped |
| World Map | 73 pins on an Equal Earth map |
| Play | A shuffled 45-question quiz and a guess-the-year game |
| Evidence Lab | Cosmic Calendar, world population, nine dating clocks, verdict scoreboard |
| How We Know | The rules, the Receipt Meter, recent corrections, 500+ sources |
| Blueprints, Passages, Persistence, Dispatches, Support | Carried over from the earlier edition |

The bottom nav is Home, Journey, Legends, Play and Explore (a page of photo doors to every section). Every card opens as a full-screen story sheet with previous and next buttons; the browser Back button closes it.

Deep links work: `#articles/case-troy`, `#people/person-otzi`, `#library/book-gilgamesh`.

## Deploy

Single file, no build step. Replace `index.html` (and `api/` when the assistant changes), commit to `main`, and Vercel deploys automatically. Photographs load at runtime from Wikimedia Commons with their licence checked and credited; if Commons is unreachable, drawn emblems stay in place.

Design system (Direction C) is unchanged: bg #f5f1eb, text #1a1815, muted #6a645c, accent #a87b4f, frosted glass, five-button bottom nav, footer phrase "Coherence is the measure, not final demonstration."

Environment variables for the assistant and the daily drafter are listed in SETUP.md.
