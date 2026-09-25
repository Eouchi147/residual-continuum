# Residual Continuum

**History is older and stranger than you were taught.** A field guide to the human past built around one pattern: rises and collapses, drowned coastlines, and knowledge lost and found. Every open question gets what is solid, the mainstream story, the challengers' case at its strongest, what would settle it, and two meters: the weight of evidence and how confident the textbooks sound.

Live: https://residual-continuum.vercel.app

## What is inside

| View | Contents |
|---|---|
| Cycles | 13 ages over 300,000 years (rise, fall, reset), an interactive chart with Greenland temperature and sea level, and a long read for each age |
| Open Cases | 57 cases in five groups: the Lost Ice Age World, Mysteries of the Earth, Impossible Megaliths, Peoples of the Sacred Texts, and Legends and Relics. Sacred-text cases also rate each text's own words line by line |
| Faiths | Twelve religious traditions in their own words: their claims (faith kept apart from testable history), how their scriptures reached us with a five-part textual record, and where they meet: 14 shared themes, 20 shared figures and 14 lineages |
| Long reads | Two full, footnoted investigations (the flood horizon, Göbekli Tepe) in their own reading room with progress and contents |
| Wonders | 24 deep dives with animated step-through drawings, counters, timelines and rated debates |
| People | 26 real people known from bones, footprints, letters and complaints |
| Witnesses | How ancient and sacred texts survived (Quran, Hebrew Bible, New Testament, Vedas, Homer, Gilgamesh and more), plus 22 texts and finds |
| How we weigh evidence | The rules, the two meters, when the experts were wrong, when the challengers were wrong, and every source |
| Map, Play, Lab | 107 map pins, a quiz and guess-the-year game, and interactive data |

Weight of evidence: Established, Strong evidence, Plausible, Mixed record, Open question, Awaiting discovery, Ruled out.

Bottom nav: Home, Cycles, Cases, Wonders, Explore (a floating dock on large screens). Everything else lives under Explore. Every card opens as a full-screen story sheet; the browser Back button closes it. Deep links work: `#articles/case-lost-civilization`, `#timeline/age-05`, `#faiths/faith-islam`, `#reads/read-2`.

## Speed and motion

Story bodies travel as inert text and are only built when opened, so a phone lays out about 14,000 elements instead of about 59,000, and switching to Cases takes about a quarter of a second instead of four seconds on a throttled phone. Motion uses a small bundle of Anime.js v4 (MIT, licence included in the page): a field of time on the home page that ripples from the centre and from your touch, headlines that rise word by word, springy navigation and cards that glide when you filter. Everything is transform and opacity only, pauses when out of sight, and switches off for people who ask their device for reduced motion.

## Deploy

Single file, no build step. Replace `index.html` (and `api/` when the assistant changes), commit to `main`, and Vercel deploys automatically. Photographs load at runtime from Wikimedia Commons with their licence checked and credited.

Environment variables for the assistant and the daily drafter are listed in SETUP.md.
