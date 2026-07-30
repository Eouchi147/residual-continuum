# Residual Continuum

An independent chronological reconstruction reading climate data, archaeology, and global memory traditions as a single coherent sequence.

**Principle:** coherence is the measure, not final demonstration. No proof language. Uncertainties stated at each step.

## Deploy

Single-file `index.html`. No build step, no dependencies to install.

```
git add index.html && git commit -m "..." && git push origin main
```

Vercel auto-deploys from `main`. The file also opens correctly by double-click from the local filesystem — every asset except the two Google Fonts is embedded.

- **1.55 MB** on disk; **~1.02 MB** gzipped, which is roughly what Vercel serves.
- 7 unique WebP plates embedded as base64 data URIs, each defined exactly once.
- One inline SVG figure (the stratigraphic column), which is real text and therefore selectable, searchable, and screen-reader accessible.
- No `container://` paths. No external image or script dependencies.

## Structure

Eight views in one document, toggled by `go(page)`: `home`, `timeline`, `articles`, `data`, `method`, `persistence`, `dispatches`, `passages`. The bottom nav carries the five sacred buttons; `persistence` is reached from Home and from contextual links. Views are deep-linkable by hash (`#method`), and the document title and meta description update per view.

| View | Contents |
|---|---|
| Timeline | 8 eras in fixed order, ~778 words each, four-part shape (observe / debated / reading / anchors) |
| Articles | 2 long-form investigations, 5,617 and 5,648 body words, with sticky contents, cross-linked references |
| Data Lens | 9 evidence clusters on calibrated ordinal confidence; 8 × 7 coherence matrix |
| Method | Tiers, falsifiability, values, source audit, 128-source bibliography |
| Passages | 4 scroll-driven explainers, sticky stage + stepped captions, inline SVG |
| Dispatches | Auto-drafted notes on new results — see `SETUP.md` |
| Persistence | 5 chapters, 3,145 words — what the evidence shows, what is still open, and what work the mystery does |

## Design system — Direction C

Do not change these.

```
bg #f5f1eb   text #1a1815   muted #6a645c
accent #a87b4f   track #e8e0d3   pill #f0ebe3
```

- **Fonts:** Newsreader (titles, `opsz` 6–72 axis requested so optical sizing works) + Inter (body), `display=swap`.
- **Frosted glass:** `rgba(255,252,245,0.72)`, `backdrop-filter: blur(24px) saturate(180%)`.
- **Bottom nav:** fixed, `rgba(255,252,245,0.88)`, five `data-page` buttons, 4px accent dot for active, `env(safe-area-inset-bottom)`. Always present.
- **Footer phrase** on every view: "Coherence is the measure, not final demonstration."
- `window.go(page)` and `window.tog(id)` are global. Home entry cards are `<button type="button">`.

**One rule worth stating explicitly:** never set text in `#a87b4f`. It is 3.33:1 on bone — sufficient for a graphical object under WCAG 1.4.11, insufficient for text under 1.4.3. Use `#6d4a1e` (5.9:1) for small labels. This was a real audit failure, not a theoretical one.

## Confidence scale

The site publishes **no numeric confidence values.** A percentage on a subjective judgement implies a precision these readings do not have.

Each cluster carries two judgements, following IPCC practice:

- **evidence** — limited / medium / robust
- **agreement** — low / medium / high

Together these give an ordinal qualifier set in italics: *high* / *moderate* / *low* / *very low*, shown alongside a four-step discrete mark. **Every rating below *high* must state why it is not higher.**

The coherence matrix encodes magnitude as **bar height**, with colour as the redundant channel, so it reads in greyscale, in print, and under `forced-colors`. The ramp (`#c0a389 · #af8863 · #9b6c3c · #845011`) is lightness-monotone and derived from the accent.

## Word counts

Byline counts are **computed, never asserted.** They are generated at build time and recomputed in the browser on load using the same rule, so they cannot drift if the prose is edited by hand.

The rule: prose in `p, h2, h3, h4, li, td, th, blockquote` within `.article`, excluding the byline, contents list, figure captions, pull quotes, and reference lists. Reading time at 220 wpm.

## Changelog

### Phase 15 — Passages
Four scroll-driven explainers in a second register: sticky stage, stepped captions, one idea per scene. Sea level drowning a shelf; the asymmetry of the Younger Dryas onset and recovery; how a confidence rating is built on evidence × agreement; and the direction-of-causation failure. All inline SVG, no external assets, no new research dependency — every scene visualises material already verified elsewhere on the site.

- Scene state is a single `data-active` attribute on each section, so all motion is CSS. JS only decides which step is current.
- `prefers-reduced-motion` **reveals rather than animates**: the stage unsticks, gaps collapse, and every annotation shows at once. Same information, no movement.
- Two bugs caught in build, both now asserted against:
  - The driver was inserted before the *first* `</script>`, which is the JSON-LD block — so it never executed and the structured data was corrupted. The build now targets the last `</script>` and asserts both that the driver is inside the behaviour block and that the JSON-LD still parses.
  - Inactive steps were dimmed to `opacity:.34`, which measures **1.88:1** — unreadable. Now `.75` (**5.08:1**), still clearly recessed against the active step. Asserted.

**38/38 constraints pass. Zero axe violations across all eight views.**

### Phase 14 — Dispatches, and a field-record layer
- **A seventh view, `dispatches`**, with machine-readable `<!-- DISPATCHES:START/END -->` markers. The automated writer splices entries between them, so the site stays one file and every automated change is a readable diff. Seeded with one real, verified entry.
- **`api/draft.js` + `vercel.json`** — a Vercel Function on a daily cron that researches CrossRef in the site's own beats, drafts a dispatch via OpenRouter, **verifies every DOI against CrossRef and deletes what fails**, attaches an open-licence Commons image with printed attribution, and **opens a pull request**. It never commits to `main`. Full setup in `SETUP.md`.
- The writer may pick one of four pre-approved accents derived from the locked palette. It cannot touch a Direction C token, write CSS, load a font, or alter any other view.
- **Field-record layer, deliberately restrained:** accession codes on the eight era plates, a faint inner edge on plates so they read as mounted specimens, and a hairline rule on figure captions. Catalogue, not costume — no sacred token touched.
- Validator now separates *resource dependencies* from *hyperlinks*: a DOI link is not an external dependency, but an `<img src>` is. Resource loads are restricted to Google Fonts and `upload.wikimedia.org`; outbound links to DOI and Commons.

**38/38 constraints pass. Zero axe violations across all seven views.**

### Phase 13 — the Persistence wing
A sixth view: **Persistence — why some puzzles will not die.** Five chapters, 3,145 words, 25 verified references.

The wing's thesis, which is also its correction to a naive framing: **the evidence is well constrained on what these objects were and where they travelled, and much weaker — in places absent — on the causal claim that the objects generated the stories.** The recurring failure is not fabrication but *inversion of direction*: a real material fact recruited as the origin of a belief that already existed and, where the chronology is checkable, is usually older.

Chapters: *Three questions* (method) · *Bones before biology* (the fossil trade in Chinese pharmacies, Haberer and Schlosser 1903, the alicorn) · *The inversion* (the Protoceratops–griffin critique and the term "ex post facto geomyth", after Witton and Hing 2024) · *Giants* (Cardiff 1869, the 2002 Worth1000 composite, the mound-builder myth, endocrinology and the error in skeletal stature estimation) · *The work a mystery does* (why these narratives persist, and the same standard turned back on this reconstruction).

Navigation: **the bottom nav is unchanged at its five sacred `data-page` buttons.** Home is now the hub with a fifth entry card, and contextual links close the Timeline and Articles views. The view is deep-linkable at `#persistence`.

Two accessibility fixes during the build: the decorative chapter numerals were set in `--track` (1.16:1) and are now `#9a8566` (3.15:1, passing the large-text threshold), and chapter titles were promoted from h3 to h2 to keep heading order legal. A first attempt added `opacity:.55` to the numerals, which cancels the contrast gain — axe factors opacity in.

**Zero axe violations across all six views. 37/37 constraint assertions pass.**

### Phase 12 — accessibility remediation
- Fixed all three violations `axe-core` reported against WCAG 2.2 AA + best practice: contrast on 36 cluster labels, heading order on Data and Method, and two `<nav>` landmarks sharing the name "Contents". **Now zero violations across all five views with every era expanded.**
- Measure capped in `rem` as well as `ch`, so a webfont swap cannot change line length.
- All 82 article references cross-link to their bibliography entry.
- Fixed a regression introduced in Phase 11: a `#main,.bottom-nav{position:relative}` rule had overridden the sacred `position:fixed` on the bottom nav.
- Fixed era expand/collapse: the browser coalesced two style writes in one frame, so a single `requestAnimationFrame` never started the transition. Now forces a reflow between the start and target values.

### Phase 11 — design system, reading UX, structured data
- 8pt spacing tokens (fixed inside components, fluid between blocks); dual-ratio fluid type scale; `text-box-trim` on headings behind `@supports` with retuned margins; `text-wrap: balance` on headings and `pretty` on prose; tabular figures on dates and tables.
- Frosted glass rebuilt as a three-tier shadow stack with inner highlight and shaded bottom edge. Subtle desaturated stitched-SVG grain, per surface, plus a fixed page layer using plain opacity and **no blend mode** — a blended fixed layer would force one compositing group and break `backdrop-filter` beneath it.
- Reading progress bar; sticky desktop contents with `IntersectionObserver`-free scrollspy that guarantees exactly one active item and keeps the last section reachable at the bottom of the document.
- `tog()` now animates to a measured height and then releases to `auto`, replacing the `max-height: 8000px` hack that made short eras snap.
- Views deep-linkable by hash; per-view title and description; JSON-LD (`WebSite` + two `ScholarlyArticle` nodes).
- Retired the meter count-up animation. A 2024 systematic review found no benefit for animated over static probability graphics and documented cases of animation degrading comprehension; a number that dramatises its own arrival also contradicts the site's register.
- Removed the empty `og:image` and switched the Twitter card to `summary`. **Known limitation:** a social preview image cannot be a data URI, and the single-file constraint forbids external image assets. To add one, host an image and set `og:image` to its absolute URL.

### Phase 10 — Data Lens and Method integrity
- Replaced all seven percentages with calibrated ordinal confidence. 9 clusters (was 7), splitting the flood cluster into the robust regional signal and the disputed pulse.
- Coherence matrix rebuilt as a real `<table>` with `scope`, focusable cells, geometry-plus-colour encoding, an above-table legend, and `forced-colors` / print paths.
- **Removed fabricated statistics.** The previous draft claimed "237 traditions across 6 continents", a structural similarity index of 0.62 vs 0.41, "Cohen's kappa 0.71", and a logistic regression reporting OR 3.2 (95% CI 1.9–5.4). Verification found no published dataset of that design. The Method page also described this coding exercise as the site's own procedure. All of it is gone, replaced with the honest argument that any count of flood traditions depends entirely on the definition used.
- **Fixed a citation reversal.** The source audit cited Bard et al. 2010 in support of Meltwater Pulse 1B. That paper looked for MWP-1B in the Tahiti boreholes and found "no significant change in the rate of sea-level rise", concluding such an episode is "unlikely".
- **Fixed a proxy conflation.** "YD cooling 10 °C in decades" merged two different measurements. The rapid figure is deuterium excess, a moisture-source proxy. Greenland temperature recovery took ~60 years and the onset ~213 years.

### Phase 9 — content expansion
- Timeline: 2,361 → 6,221 body words (~778 per era).
- Article 01 "The Deluge Horizon": 1,589 → 5,617 body words, 9 sections, 40 references. Restructured as a two-part reading — the robust gradual-plus-regional evidence first, then the MWP-1B dispute as its own section.
- Article 02 "Monumental Aftermath": 1,247 → 5,648 body words, 12 sections, 42 references, 13-row comparative table with per-site publication status.
- Incorporated the excavation team's own retractions: ritual backfilling, and Schmidt's tripartite layer scheme (Clare 2020). States plainly that any Göbekli–Andean pillar continuity is convergent invention, not transmission.
- Bibliography merged and deduplicated to **128 entries** with anchor ids. Entries cited by the two investigations were checked against publisher records; inherited entries not cited there are retained in their original wording and are marked as not independently re-verified.

### Phase 8 — structural repair
The Phase 7 file was not publish-ready. Verified in Chromium, not inferred:

- **`page-articles` was missing one `</div>`,** so every later view nested inside it. The **entire Method & Sources page rendered at 0px height and had never been reachable.** The tag belongs immediately before the `<!-- ARTICLE 2 -->` comment; appending it at the end of the page balances the file but leaves Article 02 nested inside Article 01.
- Duplicate IDs: `page-data` ×3, `page-articles` ×2, plus `clusters` / `matrix` / `matrix-tip` ×2. Two of those blocks still contained live Phase-2 stub copy ("Phase 2 keeps skeleton. Phase 4 will expand to 4200+ words") shipping in the publish candidate.
- **9 unescaped `<` before numerals** were silently deleting prose. `<500 yr` opens a bogus tag and the browser discards everything to the next `>`. One instance lost the entire clause "rate 28–45 mm/yr, 10× modern rate. This is perceptible within a lifetime: 3–4 m per generation". Restored.
- 20 bare `&` escaped.
- **Invisible-spine violations removed from 5 places** — era 07 body text, its source anchors, its tag chip, Article 01 §6, and a bibliography entry.
- **2.28 MB of byte-identical duplicated base64** eliminated. Plates are now defined once as CSS rules and rendered as `role="img"` elements, which also allows per-context aspect ratios.
- Plates re-encoded at 1500px wide (1200px portrait), WebP q80.
- **Replaced the stratigraphic raster with a bespoke SVG.** The original carried a fabricated "CORE 22-07" designation, a depth axis running 0→40→40→30→30→20→20→10 (non-monotonic, with duplicated labels), a flood horizon dated ~4.2 ka BP while its caption claimed MWP-1B at ~11.6 ka, an "oversain" typo, and a duplicated "Scientific" render artifact. It was also being cropped to 16/10 by `object-fit: cover`, so most of it was never visible. The replacement is stratigraphically ordered for a drowning shelf, with the transgressive lag below the marine clay it introduces.
- Era headers are now real `<button>` elements (with a chrome reset, or the conversion is a visual regression rather than an a11y upgrade).
- Corrected the `<title>`, removed the empty `og:image`, enabled `font-optical-sizing`, removed a permanent `will-change: max-height` on all eight eras.
- **7.87 MB → 1.31 MB.**

## Verification

`validate.py` asserts 37 constraints — palette values, glass, font axes, nav position and order, footer phrase on every view, `go`/`tog` globals, entry-card element types, era count and exact order, plate deduplication, absence of spine terms, absence of fabricated statistics, absence of numeric confidence, markup hygiene, ID uniqueness, and a navigation smoke test requiring every view to render visibly. Plus `axe-core` against WCAG 2.2 AA and `node --check` on the script block.

Current state: **37/37 pass, zero axe violations, no console errors.**

### One limitation of this environment

`fonts.googleapis.com` is unreachable from the build sandbox and Newsreader/Inter are not installed locally, so screenshots render with the fallback stack (`Georgia, serif` / `system-ui, sans-serif`). Layout, contrast, and behaviour were verified; **exact typographic rendering was not.** Check the deployed page for optical sizing, the display scale, and the pull-quote hanging indent.
