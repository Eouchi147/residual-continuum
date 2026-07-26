# Residual Continuum

**Premium interactive historical investigation platform**

A digital archive where users explore humanity’s deep past through chronology, evidence, sources, geography, and interconnected ideas.

Live site deploys automatically from this repository via Vercel.

---

## Current Status (V0.95)

Clean multi-file structure with externalised data layer (Phase 3 foundation).

### File Structure
```
/
├── index.html          # Shell + navigation
├── styles.css          # Design system
├── app.js              # Logic + renderers
├── data/
│   ├── timeline.json   # Chronological events + fingerprints
│   ├── evidence.json   # Meters, claims, categories
│   ├── articles.json   # Full investigations + outlines
│   └── sources.json    # Central source registry
└── README.md
```

### Completed
- **Design System** (Phase 0) — Soft bone, charcoal, warm stone, Newsreader + Inter, frosted glass.
- **Navigation** — Home · Timeline · Articles · Data · Method.
- **Data Lens** (Phase 1) — Evidence Weight, Claim Inspector, Convergence Explorer.
- **Timeline Engine** — Data-driven with Evidence Fingerprints + confidence.
- **Article Framework** (Phase 2) — Full structure for 001 & 002.
- **Unified Data Layer** (Phase 3 start) — All content in JSON. One update propagates everywhere.
- **Search** — Client-side across timeline, articles, evidence.
- **Method + Source Registry**.

### Investigations
| ID  | Title                  | Status      |
|-----|------------------------|-------------|
| 001 | The Deluge Horizon     | Full draft  |
| 002 | Monumental Aftermath   | Full draft  |
| 003 | Cities of Pillars      | Outline     |
| 004 | Residual Knowledge     | Outline     |
| 005 | Parallel Horizon       | Outline     |

### Next toward stable V1
1. Source & Citation Engine (popups, automatic bibliography).
2. Image pipeline + Visual Archive.
3. Performance, SEO, basic PWA.
4. Public V1 launch with the two complete investigations.

Later: Knowledge Graph, Geographic Atlas, research tools, community contributions.

---

## Design Notes
- Soft bone background · deep charcoal text · warm stone accent
- Frosted glass panels · calm motion
- Mobile-first · bottom navigation · safe-area aware

## Technical
- Pure vanilla HTML / CSS / JavaScript
- No build step
- Data externalised in `/data`
- GitHub → Vercel

*Residual Continuum is a living research environment: digital museum + investigative journal + historical research instrument.*
