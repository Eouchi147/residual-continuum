# Residual Continuum

**Premium interactive historical investigation platform**

A digital archive where users explore humanity’s deep past through chronology, evidence, sources, geography, and interconnected ideas.

Live site deploys automatically from this repository via Vercel.

---

## Current Status (V0.9 → V1)

This version implements the recommended early execution path from the Master Roadmap:

### Completed
- **Design System** (Phase 0) — Soft bone background, deep charcoal text, warm stone accent, Newsreader + Inter, frosted glass cards, organic spacing, calm premium atmosphere.
- **Navigation** — Permanent: Home · Timeline · Articles · Data · Method.
- **Data Lens** (Phase 1 core) — Evidence Weight meters, Claim Inspector, Convergence Explorer, transparent confidence statements.
- **Timeline Engine** (Phase 4 foundation) — Data-driven eras with expandable academic treatment, Evidence Fingerprints, confidence badges.
- **Investigation Article Framework** (Phase 2) — Full dissertation-style structure for the first two investigations:
  - Hero + metadata
  - Executive Summary (What is known / What is uncertain / Why it matters)
  - Main sections with evidence blocks
  - Counterargument sections
  - Selected sources / bibliography stubs
- **Search** — Client-side search across timeline, investigations, and evidence.
- **Method page** — Evidence hierarchy, categories, confidence assignment rules, and explicit non-claims.

### Investigations
| ID  | Title                  | Status        |
|-----|------------------------|---------------|
| 001 | The Deluge Horizon     | Full draft    |
| 002 | Monumental Aftermath   | Full draft    |
| 003 | Cities of Pillars      | Outline       |
| 004 | Residual Knowledge     | Outline       |
| 005 | Parallel Horizon       | Outline       |

### Next (toward stable V1)
1. External JSON data files (`data/timeline.json`, `evidence.json`, `sources.json`, `articles.json`) so content updates no longer require touching the HTML.
2. Source & Citation Engine with proper reference objects and popups.
3. Image pipeline + basic Visual Archive.
4. Performance hardening, metadata/SEO, basic PWA.
5. Deploy public V1 with the two complete investigations.

Later phases (Knowledge Graph, Geographic Atlas, advanced research tools, community contributions) remain on the master roadmap.

---

## Design Notes
- Near-black / soft bone palette with restrained warm accent
- Frosted glass panels
- Motion is calm and inevitable
- Colour used only for gentle categorical guidance (climate / archaeology / textual)
- Mobile-first, bottom navigation, safe-area aware

## Technical
- Pure vanilla HTML / CSS / JavaScript
- No build step
- Single-file for maximum portability (data layer will be externalised next)
- GitHub → Vercel deployment

---

*Residual Continuum is a living research environment: digital museum + investigative journal + historical research instrument.*
