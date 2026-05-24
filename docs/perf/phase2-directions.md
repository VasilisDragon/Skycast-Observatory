# Phase 2 — Three Design Directions (2026-04-17)

Three genuinely different philosophies — editorial-scientific, operational-console, and cinematic-experiential. Each one preserves every capability listed in the mission brief (ZIP centering, current/hourly/daily/7-day cadence, radar/hazards/wind/clouds/POP/QPF overlays, imperial/metric toggle, saved-ZIP cookie contract, explorer page) and stays within the static-Vite-into-IIS-wwwroot deploy shape. All fonts are **self-hosted** from `/fonts/`; nothing comes from `fonts.googleapis.com` or `protomaps.github.io` at runtime.

---

## Direction A — "Observatory"

> Aesthetic thesis: the site is a working meteorologist's notebook — longform editorial with widgets. Reading is the primary verb, not navigating.

### References
- Bloomberg Graphics weather features (the annotated-chart style, not the terminal).
- The Pudding's data essays.
- NYT climate interactives (2022–2025 era), especially the "A Week of Storms" stacked-small-multiples look.
- FT Climate Capital section layout.
- Edward Tufte sparkline strips inside running prose.

### Layout (single ZIP already hydrated)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STORMGLASS  ·  Chicago, IL  60601                   imperial / metric  ⌂   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Friday, April 17.  Overcast with a chance of                              │
│   afternoon showers; a southwesterly wind                                   │
│   builds into the evening.                                                  │
│                                                                             │
│      ┌────┐                                                                 │
│      │ 54°│  feels 51°   dew 42°   humidity 63%   wind SW 14 mph            │
│      └────┘  pressure 29.92" ↘    visibility 10 mi    MDW obs 13 min ago    │
│                                                                             │
│   ─── Next 48 hours ────────────────────────────────────────────────────    │
│   ▁▂▂▃▅▆▆▇▇▇▆▅▄▃▃▂▂▁▁▁▂▃▄▅▅▆▆▇ temperature (sparkline, not big chart)       │
│   · · · ·▌▌▌▐▐ · · · · · · · ·▌▌▌▌▌▐▐▐ precip probability                    │
│                                                                             │
│   ─── The week ────────────────────────────────────────────────────────     │
│   Sat  Sun  Mon  Tue  Wed  Thu  Fri                                         │
│    58   62   64   59   55   61   66   ←high row                             │
│    44   49   51   47   42   46   50   ←low row                              │
│                                                                             │
│   ─── Radar ───────────────────────────────────────────────────────────     │
│   [ wide cinemascope radar band — 21:9, MDW local reflectivity ]            │
│   A line of light returns is approaching from the southwest …               │
│                                                                             │
│   ─── Hazards & narrative ─────────────────────────────────────────────     │
│   No active hazards.                                                        │
│   Tonight · Friday night · Saturday · Saturday night · …                    │
│                                                                             │
│   ─── Lab bench (explorer) ────────────────────────────────────────────     │
│   [ full-width map with layer stack + presets, collapsed by default ]       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Narrative flows top to bottom like a longform article. Map is a band inside the article, not the hero. Explorer is at the bottom, collapsed until the user opens it.

### Type & color tokens
- **Families (self-hosted):** Fraunces (variable; display, optical sizing), Inter (variable; UI + prose), JetBrains Mono (tabular numerics).
- **Weights:** Fraunces 500/650 for heads, Inter 400/500/600, JetBrains Mono 400.
- **Palette:**

  | Token | Hex | Usage | Contrast vs bg |
  |---|---|---|---|
  | `--paper` | `#F7F3EA` | background | — |
  | `--ink` | `#0F1620` | body + head | 16.8 : 1 |
  | `--ink-soft` | `#3B4552` | secondary text | 8.9 : 1 |
  | `--rule` | `#D9D1C0` | hairlines | decorative |
  | `--accent` | `#2C4A7F` | links, active | 7.8 : 1 |
  | `--temp-cold` | `#2F6FB5` | data ramp cold | — |
  | `--temp-warm` | `#E06A2C` | data ramp warm | — |
  | `--temp-hot` | `#A51F1F` | data ramp hot | — |
  | `--precip` | `#3B7EA8` | precipitation | — |
  | `--hazard` | `#A32020` | alerts only | 5.6 : 1 |

- All body/head copy meets WCAG 2.2 AAA (≥ 7:1) against paper.
- Dark mode is a follow-on: same tokens inverted, not a separate theme. Not in V1.

### Motion language
- Almost none. Page does not animate on scroll.
- Numbers ease 400 ms cubic(0.2, 0, 0, 1) when a value changes (e.g., imperial↔metric, refresh).
- Sparklines animate in once on first paint (800 ms path draw), never again.
- Map basemap fades in 200 ms after tiles commit; overlay frames swap with `raster-fade-duration: 120`.
- `prefers-reduced-motion` → all above become instant.

### Map & globe strategy
- **Library:** MapLibre GL 5 (same as today).
- **Surface:** one map instance, embedded as a 21:9 band mid-article. No hero-side preview (drop it). Explorer re-uses the same instance, just with expanded layer controls.
- **Basemap:** trimmed PMTiles, light editorial style. Two packs:
  - `world.pmtiles` at z0–4 (smaller than today's 44 MB — z0–4 is roughly 6–10 MB).
  - `usa.pmtiles` at z5–9 across CONUS bbox only (cut from ~440 MB to an estimated 110–140 MB).
- **Tile style:** custom Protomaps flavor ("paper"), desaturated; generated and committed into `/src/WeatherSite.Web/src/map/styles/paper.json` so we're not fetching glyphs from `protomaps.github.io`. Glyph + sprite assets copied into `/wwwroot/map-assets/` and referenced with `/map-assets/...`.
- **Code-split:** MapLibre stays dynamic-imported; triggered only when the radar band scrolls within 600 px of the viewport (`IntersectionObserver` with `rootMargin: 600px`). Explorer re-uses the same already-mounted map — no second instance.
- **Globe:** dropped as default; available only as a single "switch to globe" affordance in the explorer. Off on first visit.
- **Warm-start:** on successful `/api/weather/bundle`, preload the PMTiles header (`<link rel="preload" as="fetch" crossorigin href="/tiles/basemaps/usa.pmtiles">`) + the first overlay tile for the saved ZIP's z7 center. By the time MapLibre mounts, bytes are already in the browser cache.

### Performance budget
| Metric | Target |
|---|---|
| LCP (mobile, slow 4G) | ≤ 1.2 s |
| TTI (mobile) | ≤ 2.0 s |
| JS transferred, first paint (br) | ≤ 180 KiB |
| JS transferred, map surface warm (br) | ≤ 450 KiB |
| CSS transferred (br) | ≤ 18 KiB |
| CLS | ≤ 0.02 |

### Migration effort (rough)
- **~24–32 hours.**
- Changes: `tailwind.config.ts`, `src/index.css` (rewrite), every component in `src/components/`, `src/main.tsx` (adds IntersectionObserver), new `src/map/styles/paper.json`, new `src/sparkline.tsx` (replaces Recharts for the 48h strip — drops Recharts from the bundle entirely).
- Keeps: `src/lib/api.ts`, `src/types.ts`, entire `src/WeatherSite.Api/` surface.
- Net bundle movement: **drop Recharts** (~406 KB raw / 152 KB br gone), trim MapLibre load to on-demand only.

---

## Direction B — "Situation Room"

> Aesthetic thesis: the working ops console your current site was *trying* to be. Dense grid, real typography, disciplined color, map is the centerpiece.

### References
- Palantir Foundry dashboards (the newer 2024+ dark UI).
- Bloomberg Terminal circa the Vice President redesign.
- Grafana 11's dark theme with good data palettes.
- NASA Deep Space Network / eyes.nasa.gov (clean ops dashboards).
- Flight-ops and ATC consoles — not to copy visually, but for the information hierarchy lesson.
- Radar app "Radarscope" on macOS.

### Layout
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ WEATHER · VASILIS.CLUB        Chicago, IL 60601 · imperial ⇄ metric · saved ✓    │
├──────────┬───────────────────────────────────────────────────────────┬────────────┤
│ PRESETS  │                                                           │ NOW        │
│ · Local  │                                                           │ 54°        │
│ · CONUS  │          [  LIVE RADAR — PRIMARY MAP SURFACE  ]           │ feels 51°  │
│ · Wind   │           MapLibre, dark basemap, trimmed PMTiles          │ wind SW 14 │
│ · Precip │           radar frames playing, hazards polygons on top    │ hum 63%    │
│ · Globe  │                                                           │ vis 10 mi  │
│          │                                                           │ pres 29.92 │
│ LAYERS   │                                                           │ MDW · 13m  │
│ ☑ Radar  │                                                           ├────────────┤
│ ☑ Hazard │                                                           │ HAZARDS    │
│ ☐ Wind   │                                                           │  (none)    │
│ ☐ Clouds │                                                           │            │
│ ☐ POP    │                                                           │ TRENDS     │
│ ☐ QPF    │                                                           │ ▁▂▃▅▆▇▇▆▄ │
│          │                                                           │ 48h temp   │
├──────────┴───────────────────────────────────────────────────────────┴────────────┤
│ HOURLY STRIP · 00  03  06  09  12  15  18  21  00  03  06  09  12  15  18  21      │
│       temp    52  51  50  50  53  57  62  60  56  52  50  49  52  58  63  61      │
│       precip   5   5  10  15  20  30  40  30  20  15  10  10  15  25  35  25      │
│       wind    S10 S12 S14 SW14 SW15 SW17 SW20 SW18 SW15 SW12 SW10 ...              │
├───────────────────────────────────────────────────────────────────────────────────┤
│ WEEK · Sat 58/44 showers · Sun 62/49 clearing · Mon 64/51 sunny · Tue … · …        │
├───────────────────────────────────────────────────────────────────────────────────┤
│ NARRATIVE · Tonight · Saturday · Saturday night · Sunday · Sunday night · …        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

12-column grid. Persistent left rail (presets + layer stack). Map fills center. "NOW" column on the right. Hourly strip is small multiples (temp row, precip row, wind row), not a line chart. Week collapses to one dense row of label + high/low + summary. Narrative text lives at the bottom, collapsible.

### Type & color tokens
- **Families:** Inter Tight (variable, UI), IBM Plex Mono (variable, numerics), IBM Plex Sans Condensed (labels). All self-hosted.
- **Weights:** Inter Tight 400/500/600/700, Plex Mono 400/500, Plex Sans Condensed 500.
- **Palette:**

  | Token | Hex | Usage | Contrast |
  |---|---|---|---|
  | `--bg` | `#05080C` | chrome bg | — |
  | `--panel` | `#0B111A` | panel bg | — |
  | `--card` | `#121A26` | card bg | — |
  | `--rule` | `#1C2736` | hairlines | — |
  | `--head` | `#E8EEF5` | headings | 17.1 : 1 on bg |
  | `--body` | `#9AA3B2` | body | 7.8 : 1 on bg |
  | `--muted` | `#5E6775` | muted | 4.6 : 1 on bg (large only) |
  | `--accent` | `#4FC3F7` | interactive | 9.2 : 1 |
  | `--ok` | `#4ADE80` | values in-range | 9.7 : 1 |
  | `--warn` | `#F4B942` | advisory | 10.3 : 1 |
  | `--crit` | `#EF5B5B` | warning | 5.1 : 1 |
  | Radar dBZ ramp | exact NOAA ramp | overlay | — |
  | Temp ramp | Viridis-esque 8-step | hourly strip, week row | — |

- Strict three-level elevation (`--bg` → `--panel` → `--card`). No backdrop-blur stack — it's what was killing the feel.
- Tabular figures everywhere (`font-variant-numeric: tabular-nums`).

### Motion language
- Data-in, data-out only.
- Radar frames crossfade 280 ms cubic(0.4, 0, 0.2, 1), loop 6 frames automatically.
- Hazard polygons fade in 240 ms when they first appear; pulse (1.2s, one time) only if the severity escalates.
- Numeric value changes tween 300 ms with `Intl.NumberFormat` interpolation.
- No scroll animation. No parallax. No entrance animation for layout.
- `prefers-reduced-motion` → all above become instant.

### Map & globe strategy
- **Library:** MapLibre GL 5.
- **Surface:** one map instance, page-centered, ~60% of viewport. Both the old hero-preview and the old explorer collapse into this one live map. Kills two-WebGL-contexts-at-once.
- **Basemap:** trimmed dark PMTiles. Two packs:
  - `world.pmtiles` z0–4 (~6–10 MB).
  - `usa.pmtiles` z5–10 CONUS bbox (~130–160 MB vs today's 440).
- **Tile style:** custom "ops-dark" flavor derived from Protomaps dark, committed to `src/map/styles/ops-dark.json`. Glyphs + sprites self-hosted at `/map-assets/`.
- **Code-split:** MapLibre is dynamic-imported behind a `<MapSurface>` component that mounts immediately on the saved-ZIP path (because the map IS the page — different tradeoff from direction A). The hero-placeholder is a pre-rendered static PNG snapshot (server-generated at deploy time by a small `.csproj` target using the pmtiles CLI) that shows instantly and gets replaced the moment MapLibre hydrates. That kills the "map pop-in" feel even though MapLibre still takes ~350 KB br to download.
- **Warm-start:** preload the PMTiles header, the saved ZIP's z7 tile, and the primary radar layer's latest frame as `<link rel="preload">` embedded in `index.html` at response time (small ASP.NET Core middleware that rewrites `</head>` for hydrated sessions — not SSR, just a header injection).
- **Globe:** opt-in only. Lives behind a "Globe" button in the left rail. Loads a second style on demand.
- **Layer changes:** re-use one map, just toggle `visibility` and `raster-opacity`; no more new-source-per-change churn.
- **Route stability:** `WeatherMap.tsx`'s init effect loses `config.location.zip` from its dep list; location changes ease the camera instead of tearing down the map.

### Performance budget
| Metric | Target |
|---|---|
| LCP (mobile, slow 4G) | ≤ 1.5 s (snapshot hero paints at ~0.9s) |
| TTI (mobile) | ≤ 2.5 s |
| JS first paint (br) | ≤ 220 KiB |
| JS map-hydrated (br) | ≤ 580 KiB |
| CSS (br) | ≤ 22 KiB |
| CLS | ≤ 0.02 |

### Migration effort (rough)
- **~32–48 hours.**
- Changes: full layout rewrite, new `MapSurface` component, delete `MapExplorer` + `WeatherMap` separation, new `src/hourlyStrip.tsx` small-multiples (Recharts out), new `src/map/styles/ops-dark.json`, `Program.cs` addition for head-inject middleware + static snapshot endpoint, `.csproj` target to generate the saved-ZIP snapshot at publish time.
- Keeps: `src/lib/api.ts`, `src/types.ts`, every `WeatherSite.Api` controller + service unchanged.
- Net bundle movement: drop Recharts, consolidate to one MapLibre instance, replace backdrop-blur with flat panels.

---

## Direction C — "Sky Atlas"

> Aesthetic thesis: weather as a natural phenomenon, not a dataset. Full-bleed cinematic surface that re-paints itself with the conditions. Data is still there, but the default view is poetic.

### References
- Apple Weather (iOS 15+ — the hero state, not the list screens).
- Tenki.jp.
- Windy.com's condition-themed marketing pages.
- Fathm's weather concept reels.
- NASA "Blue Marble" landing.
- Darksky before it was eaten (the fade-to-condition landing).

### Layout
```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│                                                                               │
│                         ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                    │
│                       ▒▒  condition-reactive  ▒▒     ← full-bleed WebP bg    │
│                      ▒▒    hero backdrop       ▒▒       (sunny / cloudy /    │
│                      ▒▒                        ▒▒        rain / night)       │
│                       ▒▒                      ▒▒                             │
│                         ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                    │
│                                                                               │
│                                                                               │
│                      54°                                                      │
│                  Overcast · wind SW 14                                        │
│                  Chicago, IL · MDW · 13 min ago                               │
│                                                                               │
│   ─── hourly strip (compact) ─────────────────────────────────────────────    │
│   now   1p   2p   3p   4p   5p   6p   7p   8p   9p  10p  11p  12a  1a  2a    │
│   54°  55°  57°  60°  62°  61°  58°  55°  52°  50°  49°  48°  48°  47° 46°   │
│                                                                               │
│ ↓ scroll ↓                                                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│  THE WEEK                                                                     │
│  [ seven condition-tinted cards, one per day, each with its own palette ]     │
├───────────────────────────────────────────────────────────────────────────────┤
│  RADAR                                                                        │
│  [ inset map card, 4:3, ambient-tinted; "Open Atlas" button expands it ]      │
├───────────────────────────────────────────────────────────────────────────────┤
│  HAZARDS · NARRATIVE · FINE PRINT                                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

Full-bleed hero is the anchor. Scrolling reveals subsequent sections calmly. Map is a card, not the centerpiece; "Atlas mode" opens a fullscreen overlay.

### Type & color tokens
- **Families:** Fraunces variable (hero display, optical sizing), Inter variable (UI + prose), JetBrains Mono (tabular numerics).
- **Weights:** Fraunces 400/650/800 with `font-optical-sizing: auto`; Inter 400/500; Mono 400.
- **Palette (reactive):** not one palette — seven condition states, each a three-token set (`--sky`, `--horizon`, `--ink`). Listed below with their AA-passing ink choices.

  | State | Sky | Horizon | Ink | Ink vs sky |
  |---|---|---|---|---|
  | Clear day | `#FAD68E` | `#F28C28` | `#2A2118` | 9.1 : 1 |
  | Clear night | `#0A1024` | `#1A2F63` | `#E8EEF5` | 17.4 : 1 |
  | Overcast | `#D9DEE3` | `#6C7A87` | `#1C222B` | 11.3 : 1 |
  | Rain | `#1F2833` | `#3D6B9E` | `#E8EEF5` | 13.9 : 1 |
  | Snow | `#EAF1F6` | `#B7C6D0` | `#15202E` | 14.2 : 1 |
  | Thunderstorm | `#15171E` | `#6C5B8F` | `#F0E8D4` | 14.8 : 1 |
  | Fog | `#CFD4D7` | `#9AA3A8` | `#1B2028` | 11.1 : 1 |
- **Data overlay panels** (forecast cards, hourly strip, map card) always use a neutral token set (`#0E121A` panel, `#E8EEF5` ink → 17 : 1) so tabular data is legible regardless of the hero palette. The reactive palette only runs the hero + the card *accents*.

### Motion language
- Generous but reduced-motion-safe.
- Hero backdrop crossfades 900 ms when the condition changes.
- Temperature number eases in on hydration with optical-size morph (500 ms, `weight: 400→650, opsz: 72→110`).
- Section reveals on scroll: 220 ms fade + 6 px translate, once each.
- Radar auto-plays when the map card enters the viewport.
- Hour strip ticks roll 300 ms on imperial↔metric switch.
- `prefers-reduced-motion` → backdrops are static stills, no scroll-in, instant number swaps.

### Map & globe strategy
- **Library:** MapLibre GL 5.
- **Surface:** secondary. A 4:3 card in the middle of the scroll. "Open Atlas" expands it to a full-screen dialog.
- **Basemap:** trimmed PMTiles, hand-tinted to harmonize with the hero condition (the same 7 condition sets drive a subtle raster-saturation + raster-hue-rotate on the basemap). Pack sizes match B: `world` z0–4, `usa` z5–10 CONUS.
- **Tile style:** custom "atlas" flavor with soft land/water, low-contrast roads, prominent coastline; self-hosted.
- **Code-split:** MapLibre loads **only** when the user clicks "Open Atlas" or scrolls the radar card into view — whichever comes first. Pure on-demand. Hero never mounts a map.
- **Hero backdrop:** seven condition-specific WebP images (max 60 KB each), preloaded based on the current conditions reported in the bundle. One shows on first paint; others preload in idle time.
- **Warm-start:** same preload-header trick as B, but only when the user passes the radar card threshold.
- **Globe:** "Atlas mode" includes a globe toggle; off by default.

### Performance budget
| Metric | Target |
|---|---|
| LCP (mobile, slow 4G) | ≤ 2.0 s (hero WebP is the LCP element) |
| TTI (mobile) | ≤ 2.8 s |
| JS first paint (br) | ≤ 220 KiB |
| JS atlas-hydrated (br) | ≤ 580 KiB |
| Hero image transferred | ≤ 60 KiB |
| CSS (br) | ≤ 24 KiB |
| CLS | ≤ 0.03 |

### Migration effort (rough)
- **~40–56 hours.**
- Changes: full rewrite, new condition-detection helper (`src/lib/condition.ts` — maps NWS short forecast + solar altitude to one of 7 states), seven hero backdrops (design work), `AtlasDialog` component, `ConditionTokens` CSS variable provider, full motion system with reduced-motion gates, drops Recharts, drops static MapExplorer entirely.
- Keeps: `src/lib/api.ts`, `src/types.ts`, entire `WeatherSite.Api`.
- Net bundle movement: drop Recharts, defer MapLibre entirely, add ~60 KB image budget.

---

## Side-by-side comparison

| Dimension | A · Observatory | B · Situation Room | C · Sky Atlas |
|---|---|---|---|
| **Thesis** | Editorial longform with widgets | Working ops console, modernized | Cinematic, condition-reactive |
| **Primary surface** | Running prose + sparklines | Live map, centered | Full-bleed hero |
| **Map role** | Inset band mid-article | Centerpiece of the page | Secondary card; full-screen on demand |
| **Palette** | Warm paper, ink, one accent | True-black ops with functional ramps | Reactive; 7 condition states |
| **Type** | Fraunces / Inter / Plex Mono (editorial) | Inter Tight / Plex Mono / Plex Cond (ops) | Fraunces / Inter / Plex Mono (display) |
| **Motion** | Almost none | Data-in/-out only | Generous, reduced-motion-safe |
| **Charting** | Tufte sparklines (drop Recharts) | Small-multiples strip (drop Recharts) | Compact hourly strip (drop Recharts) |
| **Map library** | MapLibre GL | MapLibre GL | MapLibre GL |
| **Map code-split** | On intersection (600px before) | Eager after snapshot | Fully on-demand |
| **PMTiles strategy** | trimmed world + CONUS z5–9 | trimmed world + CONUS z5–10 + dark | trimmed world + CONUS z5–10 + tinted |
| **Globe mode** | Opt-in inside explorer | Opt-in from left rail | Opt-in inside Atlas dialog |
| **LCP target (mobile)** | **≤ 1.2 s** | ≤ 1.5 s | ≤ 2.0 s |
| **TTI target (mobile)** | **≤ 2.0 s** | ≤ 2.5 s | ≤ 2.8 s |
| **JS first paint (br)** | **≤ 180 KiB** | ≤ 220 KiB | ≤ 220 KiB |
| **JS fully hydrated (br)** | ≤ 450 KiB | ≤ 580 KiB | ≤ 580 KiB |
| **Bundle savings vs today** | Drop Recharts, lazy MapLibre | Drop Recharts, one MapLibre instance | Drop Recharts, defer MapLibre entirely |
| **Design-risk** | Medium (changes the *kind* of site) | Low (does what you tried to do, better) | High (condition system is new infra) |
| **Perf risk** | Lowest | Medium (map is above the fold) | Medium (hero images + motion) |
| **Migration (h)** | 24–32 | 32–48 | 40–56 |
| **Net new dependencies** | None | None | None |

---

## Recommendation — **Direction B, Situation Room**

It's the version of the site you were already trying to build. The current site's problem isn't that "command deck" is the wrong idea — it's that "command deck" was executed as eight overlapping glass cards with one font and one color ramp, and the map was an afterthought instead of the hero. B keeps the technical, data-dense intent, puts the map where the eye is, fixes all five of the Phase 1 performance problems (one MapLibre instance, eager but warm-started, dark basemap, real color system, no backdrop-blur stack), and lands inside a realistic migration budget. A is tempting for its perf ceiling but would change the category of site you have. C is the prettiest and worst-ROI — the reactive hero needs real art direction and the on-demand-map tradeoff pushes the map experience to the slowest path. If you want a hybrid, the cleanest one is **B as the chassis + A's typography discipline** (serif display for the location name and narrative, tabular Plex Mono for every numeric) — that gets you the ops console with a readable voice, without paying for a full editorial rewrite.

Waiting on your pick (or your hybrid) before Phase 3.
