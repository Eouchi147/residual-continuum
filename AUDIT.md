# Residual Continuum — audit report

Phases 8–12, from the Phase 7 "final publish candidate".

---

## What the research changed

Six research tracks ran before any code was written. Ten findings that actually altered the build:

1. **`backdrop-filter` over a flat background is a pure GPU cost with no visual output.** Blurring a uniform bone field produces a uniform bone field. Real blur is now restricted to the bottom nav, which overlaps varying content; the cards get their premium feel from a three-tier tinted shadow stack, an inner top highlight, and a shaded bottom edge instead.
2. **`text-wrap: pretty` means different things per engine** — Chrome evaluates the last four lines, Safari the whole paragraph, Firefox not at all. Safe to ship, unsafe to depend on. Applied to prose, with `balance` on headings only (it silently no-ops past 6 lines in Chromium).
3. **`text-box-trim` is the structural fix for mixed serif/sans alignment.** Half-leading is font-dependent dead space, which is why a Newsreader heading and an Inter label with identical margins look wrong together. Enabled behind `@supports` with retuned margins, since trimming removes real space.
4. **`feColorMatrix saturate=0` is not optional in SVG grain.** `feTurbulence` generates independent noise per channel, so raw output is coloured speckle that reads as JPEG artifacts. Desaturating is what makes it read as emulsion. Also `stitchTiles="stitch"`, 2 octaves, and `background-size` kept 1:1 with the SVG to avoid interpolation smear.
5. **A blended fixed overlay breaks `backdrop-filter` beneath it** by forcing the page into one compositing group. The page grain therefore uses plain opacity with no blend mode; only per-surface grain blends.
6. **A bare percentage on a subjective judgement is indefensible.** The uncertainty-visualisation literature is direct about this: unquantified concepts "cannot be visualised as integrated noise — only as separate information". Replaced with IPCC-style evidence × agreement, which never puts a number on *confidence*.
7. **Animated count-up harms credibility.** A 2024 systematic review in *JAMIA* found no strong evidence that animation beats static graphics for communicating probability, with documented cases of it degrading comprehension. It also breaks Ctrl-F, print, and `aria-live` while the tween runs. Retired.
8. **Colour alone cannot encode a heatmap accessibly.** Adjacent steps in any sequential ramp are only ~1.4:1 against each other, and under `forced-colors` background colour is overridden entirely, flattening the whole grid. The matrix now encodes magnitude as bar height with colour redundant.
9. **Base64 + brotli ≈ raw binary.** Measured across 22 encodings, `br(base64(webp))` came back within 0.07–0.56% of the original binary. The 33% base64 tax is essentially free on the wire — so size work had to target duplication and resolution, not the encoding.
10. **Lazy-loading does nothing for data URIs.** The bytes are already in the document. `content-visibility: auto` with `contain-intrinsic-size` is the mechanism that actually helps a long single-file page.

Two research expectations turned out **wrong**, and saying so mattered more than confirming them:

- I expected Nunn & Reid's oral-transmission claim to be contested in print. It is not — the literature extends it. The article's "critics argue these could be recent moral stories retrofitted" was unsourced and is gone.
- I expected the Younger Dryas impact hypothesis to be a live two-sided debate of equal weight. The most telling fact is narrower: Petaev, whose platinum anomaly is the hypothesis's most-cited evidence, is a co-author of the 2023 refutation review.

---

## Integrity findings

These mattered more than any visual work.

### The Method & Sources page had never been visible

`page-articles` was missing one closing `</div>`, nesting every later view inside it. `go('method')` set `#page-method` to `display:block`, but its ancestor was `display:none`, so it rendered at 0px. Confirmed in Chromium before being claimed. An entire page — the tiers, the falsifiability list, the values statement, the bibliography — was unreachable on the live site.

### Fabricated quantitative claims

The site presented as its own methodology:

- "237 traditions across 6 continents"
- a structural similarity index, mean 0.62 coastal vs 0.41 interior, p < 0.01 Mann-Whitney
- "two independent coders, Cohen's kappa 0.71"
- logistic regression: shelf proximity OR 3.2 (95% CI 1.9–5.4), river OR 1.4, trade OR 1.1

A kappa of 0.71 implies a formal two-coder reliability exercise; odds ratios with confidence intervals imply a coded sample and a fitted model. Two independent CrossRef sweeps found no flood-myth study of that design; the canonical compilations (Dundes, Frazer, Berezkin's motif catalogue) are interpretive collections and motif indexes, not hypothesis-testing datasets.

On a site whose stated value is "we report what we observe, including replication failures", invented precision is the costliest possible error. Removed and replaced with the honest argument: any count of flood traditions depends entirely on the definition used, and that definitional dependence is itself the point.

### A citation cited for the opposite of its finding

The source audit listed **Bard et al. 2010** in support of Meltwater Pulse 1B. That paper drilled Tahiti specifically to look for MWP-1B and reported "no significant change in the rate of sea-level rise could be detected", making such an episode "unlikely".

The pulse is genuinely contested. Abdul et al. 2016 reassert 14 ± 2 m at rates reaching 40 mm/yr from Barbados; Bard et al. 2016 object on three grounds — cores spliced across different reef environments and possibly different tectonic segments, *Acropora palmata*'s ~5 m depth tolerance during rapid rise, and glacio-isostatic differences preventing direct comparison. The honest bound: Tahiti excludes a ~15 m step but cannot exclude one below its own ~6 m resolution. Both the era and the article now treat it as open, and the article devotes a named section to it.

### A conflated proxy

"YD cooling 10 °C in decades" merged two different measurements. The celebrated rapid figure is deuterium excess — a *moisture-source* proxy, i.e. where the snow came from. Greenland *temperature* recovery took ~60 years and the onset ~213 years. Onset and termination are strongly asymmetric, which is more interesting than the myth.

### Content that was written but invisible

Nine unescaped `<` characters before numerals were silently deleting prose. `<500 yr` opens a bogus tag and the HTML parser discards everything to the next `>`. One instance destroyed the clause *"rate 28–45 mm/yr, 10× modern rate. This is perceptible within a lifetime: 3–4 m per generation, plus storm surge and salinization of wells."* All restored.

### A fabricated figure

The stratigraphic diagram carried a "CORE 22-07" designation for a core that does not exist, a depth axis running 0→40→40→30→30→20→20→10 with duplicated labels, a flood horizon dated ~4.2 ka BP while its caption claimed MWP-1B at ~11.6 ka, an "oversain" typo, and a duplicated "Scientific" render artifact. It was also cropped to 16/10 by `object-fit: cover`, so most of it never appeared. Replaced with a purpose-built SVG, stratigraphically ordered for a drowning shelf, with the transgressive lag below the marine clay it introduces.

### Word counts that were not true

Bylines claimed 4,280 and 4,520 words against real bodies of ~1,400 and ~1,250; the footer claimed "8800+ words" against a true total of ~2,700. Counts are now generated from the text at build time and recomputed in the browser, so they cannot drift again.

### The invisible spine was visible

Five places named the frame the project explicitly keeps as subtext — era 07's body text, its source anchors, its tag chip, Article 01 §6, and a bibliography entry. All neutralised to comparative terms. The validator now fails the build on eleven terms.

---

## Performance

| | Phase 7 | Now |
|---|---|---|
| File on disk | 7.87 MB | **1.49 MB** (−81%) |
| Gzipped (≈ wire) | ~5.9 MB | **1.00 MB** |
| Base64 payload | 7.75 MB (98.5%) | 1.20 MB (81%) |
| Actual code | 115 KB | 281 KB |
| Embedded images | 11 payloads, 8 unique | **7, each defined once** |
| Duplicated bytes | 2.28 MB | **0** |

Where it came from: eliminating byte-identical duplicates (2.28 MB), re-encoding at 1500px/q80 (~4.0 MB), and replacing the raster diagram with a 4 KB SVG (~0.4 MB). Quality was checked before committing — the diagram's labels were legible even at q76, so q80 leaves comfortable margin.

Code grew from 115 KB to 281 KB because the site now contains roughly four times the prose: 16,500 words against ~4,000.

---

## Content

| | Phase 7 | Now |
|---|---|---|
| Timeline, 8 eras | 2,361 words (~295/era) | **6,221** (~778/era) |
| Article 01 | 1,589 | **5,617** body words, 9 sections, 40 refs |
| Article 02 | 1,247 | **5,648** body words, 12 sections, 42 refs |
| Bibliography | 51 entries | **128**, deduplicated, anchored, cross-linked |

Every reference in both articles was verified against publisher records or CrossRef metadata. Where a volume or page number could not be seen, it was omitted rather than reconstructed. Inherited entries not cited by the two investigations are retained in their original wording and marked as not independently re-verified — stated on the page, not just here.

---

## Verification

- **37/37 constraint assertions pass** — palette values, glass, font axes, nav position and button order, footer phrase on every view, `go`/`tog` globals, entry-card element types, era count and exact order, plate deduplication, no spine terms, no fabricated statistics, no numeric confidence, markup hygiene, ID uniqueness, and a smoke test requiring every view to render visibly.
- **`axe-core`: zero violations** against WCAG 2.2 AA + best practice, across all five views with every era expanded. It found three real failures first, all now fixed:
  - contrast on 36 cluster labels — I had set text in `#a87b4f` (3.33:1 on bone), which my own research brief had warned against
  - heading order, h1 → h3 on Data and Method
  - two `<nav>` landmarks both named "Contents"
- **`node --check`** gates the script block on every build.
- No console or page errors in Chromium at 390px and 1440px.

Three bugs I introduced and caught during verification, worth recording because each would have shipped silently:

1. A blunt `re.sub(r"\s*—\s*Phase \d[^<.]*", "")` consumed the header comment's `-->`, leaving an unterminated comment that swallowed the entire document. The build now asserts `count('<!--') == count('-->')`.
2. Removing the old meter code with a non-greedy regex stopped at the first `});` and left a dangling fragment — a parse error that killed the whole script including `go()`. Replaced with brace-balanced removal plus the `node --check` gate.
3. A `#main,.bottom-nav{position:relative}` rule silently overrode `position:fixed` on the sacred bottom nav. Caught only because the validator asserts computed position rather than the presence of a declaration.

---

## Known limitations

- **No social preview image.** `og:image` cannot be a data URI, and the single-file rule forbids external image assets. The empty tag has been removed and the Twitter card set to `summary`. To add one: host an image and set `og:image` to its absolute URL.
- **Typography is unverified.** `fonts.googleapis.com` is unreachable from the build sandbox and neither font is installed locally, so all screenshots render with the fallback stack. Layout, contrast, and behaviour were verified; optical sizing, the display scale, and the pull-quote hanging indent should be checked on the deployed page.
- **Lighthouse was not run.** It needs a Chrome instance with network access to the fonts, which this environment cannot provide. The underlying audits were run directly instead — axe-core for accessibility, `node --check` for script validity, and manual checks for the SEO items Lighthouse tests (title, meta description, viewport, `lang`, crawlability, valid structured data). Reported scores would have been guesses, so none are given.
- **Single-URL indexing.** Views are `display:none` divs, so a crawler sees all five views' text under one URL and one canonical title. Hash deep-links make views shareable but do not create separate indexable documents. Real per-view indexing would need either separate files or a router with server-side routes — both of which break the single-file constraint. This is a deliberate trade, not an oversight.
- **The matrix scrolls horizontally on narrow screens** with sticky row headers, rather than reflowing into per-era small multiples. Small multiples read better on a phone; they would also duplicate the data into a second markup tree that can silently diverge. One source of truth was judged the better trade for a table whose values are edited by hand.
- **Eras 01, 02 and 08 were not covered by the two research briefs.** Their source anchors retain the inherited citations, supplemented only with brief-verified items. Their prose was expanded; their references were not independently re-verified.
