# AVIATION_SPEC.md

Rebuild reference for the Skycast aviation feature. Written against the
`baseline before aviation rebuild` commit on `main`.

Diagnostic sweep at baseline: `dotnet build` 0 warn / 0 err; `tsc --noEmit`
clean in both frontends; `vitest run` 39/39 in `.sky`, 4/4 in `.Web`. No
compile or unit-test failures block the rebuild.

---

## 1. Live site baseline — what weather.vasilis.club ships today

Served from `src/WeatherSite.Web` (publishes to `src/WeatherSite.Api/wwwroot`,
hosted by IIS on :8080, fronted by Cloudflare tunnel).

- **One screen, one flow.** User enters a ZIP → `/api/weather/bundle` returns
  `{ overview, mapConfig }` → `WeatherDashboard` + `MapExplorer` render.
- **Home ZIP** persisted in an HTTP-only cookie via `SessionController`
  (save / get / clear).
- **Weather surfaces** (from NWS `api.weather.gov`): current conditions,
  NWS alerts, hourly chart, 7-day trend.
- **Map atlas** (MapLibre + pmtiles, tiles proxied through `/tiles/*` in the
  API): radar (CONUS composite + local KLOT MRMS), hazards polygons, wind,
  clouds, precip — all driven by `MapsController` / `MapConfigurationService`.
- **Units**: local component state, `"imperial"` default, no persistence.
- No `/aviation` route. No aviation API. No shared `obs-*` observatory
  styling. No `isAviationPath` branch.

Entry: `src/WeatherSite.Web/src/App.tsx` → single `App` component with
`ConsumerApp`-style body. No observatory chrome.

---

## 2. Dev server delta — what :5173 (WeatherSite.Web.sky) adds

The `.sky` frontend is a **superset** of the prod consumer site with an
observatory redesign layered on top plus a parallel `/aviation/*` subsite.
The Vite dev-proxy splits the traffic so the .sky shell talks to live prod
APIs on :8080 for everything non-aviation, and the in-flight dev .NET on
:5080 for `/api/aviation/*`.

### 2a. Consumer-surface redesign (still on `/`, but restyled)
- `src/components/SkyHeader.tsx` — observatory status bar with brand,
  clock, nav, ticker. Replaces prod's minimal header.
- `src/components/SkyNowHero.tsx` — "Now" hero: condition chip, ZIP form,
  radar preview, saved-location controls. Merges prod's ZIP form + current
  conditions + radar sliver into one card.
- `src/components/SkyErrorBoundary.tsx` — per-section error boundary.
- `src/lib/use-units.ts` — `weather_site_units` **localStorage** persistence
  (shared across consumer + aviation surfaces).
- `src/index.css` — `obs-*` design tokens (grid-bg, scanlines, boot,
  disclaimer-bar, flt-trend, taf-strip, etc.). Fonts via
  `@fontsource-variable/{fraunces,inter,jetbrains-mono}`.
- `src/App.tsx` — gate at top of `App()`: if `isAviationPath(pathname)`,
  return `<AviationApp />`; else `<ConsumerApp />`.

### 2b. New `/aviation/*` routes
Client-side router in `src/aviation/router.ts` (window.history + popstate;
no react-router). Routes:
- `/aviation` → `AviationIndex` (search + saved + nearest-airport picker)
- `/aviation/:ICAO` → `AviationAirport` (nearby ribbon + METAR + TAF panels)
- `/aviation/route?dep=&dest=` → `RouteStub` (Phase D placeholder)
- anything else under `/aviation/` → `NotFound`

### 2c. Cross-surface link
- `src/aviation/cross-surface-link.ts`
  - `/aviation/:icao → /?aviation=ICAO#explorer` (leaving aviation "View on map")
  - Reading `?aviation=ICAO` on the consumer side scrolls to `#explorer`,
    auto-enables the aviation overlay, and centers the map.

### 2d. New API endpoints (src/WeatherSite.Api, not specific to .sky but
consumed only by it)
All under `/api/aviation/*` in `AviationController.cs`:
| Method | Path | Controller method |
|---|---|---|
| GET | `/api/aviation/airports?query&anchorZip&anchorIcao&limit` | `SearchAsync` |
| GET | `/api/aviation/airports/{icao}` | `GetAirport` |
| GET | `/api/aviation/session/home-airport` | `GetSavedAirport` |
| POST | `/api/aviation/session/home-airport` | `SaveAirport` |
| DELETE | `/api/aviation/session/home-airport` | `ClearAirport` |
| GET | `/api/aviation/metar/{icao}?hours` | `GetMetarAsync` |
| GET | `/api/aviation/metar?ids&hours` | `GetMetarBatchAsync` |
| GET | `/api/aviation/stations/bbox?w,s,e,n,snap,limit` | `GetStationsInBboxAsync` |
| GET | `/api/aviation/taf/{icao}` | `GetTafAsync` |
| GET | `/api/aviation/hazards/{kind}` (airmet\|sigmet\|cwa) | `GetHazardsAsync` |
| GET | `/api/aviation/pireps?lat&lon&radius` | `GetPirepsAsync` |
| GET | `/api/aviation/winds-aloft?region` | `GetWindsAloftAsync` |

Backing services:
- `Services/AirportCatalog.cs` (ICAO search, nearest, in-bbox) — reads
  `data/airports/airports.json`
- `Services/AviationWeatherService.cs` — AWC upstream client, cache,
  per-bucket semaphore
- `Utilities/MetarParser.cs`, `TafParser.cs`, `FbParser.cs`,
  `FlightCategoryCalculator.cs` — payload parsing
- `Utilities/HomeAirportCookieCodec.cs` — data-protected ICAO cookie

### 2e. New map overlay (injected into the existing consumer map)
`src/aviation/AviationOverlayController.tsx` — attaches three GeoJSON
sources + six layers to the shared `MapLibreMap` in `MapExplorer.tsx`:
stations halo/dot, hazards fill/outline, PIREPs dot/glyph. Auto-fetches
as the bbox changes (snap-grid debounced) and polls hazards every 5
minutes. Controlled by toggles in `AviationLayerToggleGroup.tsx` and a
time-slice slider in `TimeSliceSlider.tsx` (1h/3h/6h horizon for hazards).

---

## 3. Feature inventory

### 3.1 `/aviation` index (airport picker)
- **Purpose.** Pick an airport to focus on, either by search or by
  proximity to the user's saved ZIP / saved airport.
- **User-facing.** "Last airport" card if one is saved; a search input
  (ICAO/name/city); a nearest-list seeded from the saved ZIP centroid.
  Selecting persists the airport cookie and navigates to `/aviation/:icao`.
- **Backend.** `SearchAsync` in `AviationController` → `AirportCatalog.Search` +
  `.Nearest`.
- **Frontend.** `src/aviation/AviationIndex.tsx` at route `/aviation`.
- **External data.** None for search — local `data/airports/airports.json`.
- **Quality read.** Looks clean. Tight component, uses `PanelState` for
  all states, no surprises.

### 3.2 Airport page
- **Purpose.** Situational awareness for one airport: current conditions,
  forecast, neighbors.
- **User-facing.** ICAO + name header, "View on map" button, nearby-station
  ribbon, METAR panel, TAF panel.
- **Backend.** `GetAirport` for metadata; children call METAR/TAF/batch.
- **Frontend.** `src/aviation/AviationAirport.tsx` at route `/aviation/:icao`.
- **External data.** AWC via children.
- **Quality read.** Looks clean. Thin shell around three children, each
  error-boundaried independently.

### 3.3 METAR (point + batch)
- **Purpose.** Current observed conditions + 6h trend strip per station;
  batch for ribbon/bbox fan-out.
- **User-facing.** Flight-category chip, temp/wind/vis/altimeter,
  ceiling with a CFR-linked tooltip, 6h trend bars, raw METAR disclosure.
- **Backend.** `GetMetarAsync` (single) + `GetMetarBatchAsync` (comma ids).
  Batch preserves requested order and marks missing stations `"unavailable"`
  instead of 500-ing. Fresh TTL 5m, stale 90m.
- **Frontend.** `src/aviation/MetarPanel.tsx`; batch consumed by
  `NearbyRibbon.tsx` and the stations-in-bbox map layer.
- **External data.** `https://aviationweather.gov/api/data/metar?ids=&format=json&hours=`.
- **Quality read.** Looks clean. The CFR-linked ceiling tooltip using the
  native Popover API is a nice touch. Minor risk: `formatTimeAgo` recomputes
  only on re-render — if a panel sits idle for an hour the "5m ago" label
  lies until next state change. Not a bug, just a UX drift.

### 3.4 TAF
- **Purpose.** Forecast periods (ordered, with PROB/TEMPO/BECMG change types)
  and a synthesized hourly timeline strip for quick visual read.
- **User-facing.** Current-period category chip, "next change" pointer,
  hourly timeline bar, periods disclosure with raw TAF.
- **Backend.** `GetTafAsync`; fresh TTL 15m, stale 6h. Parser in
  `Utilities/TafParser.cs`.
- **Frontend.** `src/aviation/TafPanel.tsx`.
- **External data.** `aviationweather.gov/api/data/taf?ids=&format=json`.
- **Quality read.** Looks complex but coherent. The `buildHourlyTimeline`
  helper synthesizes a 1-hour step across the validity window from the
  period list — pragmatic, but the "find active period" inner loop is O(N·H)
  and assumes periods are ordered and cover the whole window. Holds up for
  TAFs I've seen AWC emit; could bite on unusual issuances.

### 3.5 Hazards (AIRMET / SIGMET / CWA)
- **Purpose.** Overlay active advisory polygons with a time-slice filter.
- **User-facing.** Colored polygons on the map (amber AIRMET, red SIGMET,
  gold CWA); polygons >100 sq° render outline-only to avoid basemap wash.
  Click a polygon → `HazardPopup` with type, severity, validity, raw text.
- **Backend.** `GetHazardsAsync` proxies AWC `airsigmet?type=…` or `cwa`.
  Fresh 5m, stale 60m. Polling: overlay controller re-fetches every 5m.
- **Frontend.** `AviationOverlayController.tsx` (layer), `TimeSliceSlider.tsx`
  (filter), `popups/HazardPopup.tsx` (detail).
- **External data.** `aviationweather.gov/api/data/airsigmet` + `.../cwa`.
- **Quality read.** Looks complex but coherent. Polygon-area suppression is
  clever but the threshold (100 sq°) is a magic number — tunable but not
  configurable.

### 3.6 PIREPs
- **Purpose.** Show recent pilot reports of turbulence/icing around the
  current view.
- **User-facing.** Colored dots (amber=turb, cyan=icing, green=other) with
  T/I/· glyph; severity drives dot radius; reports older than 2h fade to
  40%. Click → `PirepPopup` with raw ob.
- **Backend.** `GetPirepsAsync` — lat/lon + radius(nm) to AWC. Fresh 5m,
  stale 60m.
- **Frontend.** `AviationOverlayController.tsx` + `popups/PirepPopup.tsx`.
- **External data.** `aviationweather.gov/api/data/pirep?location=lat,lon&radialDistance=`.
- **Quality read.** Looks clean. Straight transform from upstream JSON to
  paint props.

### 3.7 Winds aloft
- **Purpose.** (Backend only at baseline.) Decoded FB forecast for a region.
- **User-facing.** **Nothing renders this yet.** No frontend component
  consumes `WindsAloftResponse`.
- **Backend.** `GetWindsAloftAsync` + `Utilities/FbParser.cs`. Fresh 1h,
  stale 6h.
- **External data.** `aviationweather.gov/api/data/windtemp?region=&fcst=06&level=low`.
- **Quality read.** Looks like a dangling endpoint. Controller, parser, DTO,
  cache TTLs are all in place; no UI, no type import in the web tree.
  Either cut it from the rebuild scope or finish the surface.

### 3.8 Map overlay controller (stations / hazards / PIREPs)
- **Purpose.** Attach aviation layers to the shared MapLibre instance in
  the consumer's MapExplorer.
- **User-facing.** Layer toggles in `AviationLayerToggleGroup`, stations
  halo for focused ICAO, cooperative-gesture-safe click popups, "too many
  stations" truncation chip.
- **Backend.** `GetStationsInBboxAsync` with snap-grid (default 0.5°, clamped
  to 0.05–5°) and 50-station cap + truncation flag.
- **Frontend.** `src/aviation/AviationOverlayController.tsx` (22KB — largest
  single file in the feature), `bbox-utils.ts`, `overlay-state.ts`,
  `popup-mount.tsx`, three popup components.
- **External data.** AWC METAR batch for live flight category per station.
- **Quality read.** **Looks like where things got messy.** The controller
  owns: 3 fetch effects, 1 scaffold-layers effect, 3 data-push effects, 1
  click-handler effect with 6 event handlers + 6 cursor handlers, plus
  pure builders and a custom `deriveCenter`. It's coherent line-by-line but
  the coupling between `stations/hazards/pireps/focusedIcao/units` state
  and MapLibre side-effects is dense. Any rebuild should split this into
  (a) data hooks, (b) MapLibre adapter, (c) interaction layer.

### 3.9 Cross-surface jump (`/aviation/:ICAO ↔ /?aviation=ICAO#explorer`)
- **Purpose.** Let a user on the aviation page hop to the consumer map
  with the aviation overlay pre-focused on that ICAO.
- **User-facing.** "View on map →" button on the airport page; scrolls
  consumer to `#explorer` and pre-focuses the station halo.
- **Backend.** None — pure URL plumbing.
- **Frontend.** `src/aviation/cross-surface-link.ts` (+ test). Consumed by
  `App.tsx` on mount and `MapExplorer.tsx` for auto-enable + camera center.
- **External data.** None.
- **Quality read.** Looks clean. Small, well-tested utility.

### 3.10 Home-airport cookie
- **Purpose.** Remember the last selected airport across sessions.
- **User-facing.** Saved-airport card on `/aviation`, "Clear" control.
- **Backend.** `Utilities/HomeAirportCookieCodec.cs` (data-protected),
  3 endpoints under `/api/aviation/session/home-airport`.
- **Frontend.** `AviationIndex.tsx`.
- **Quality read.** Looks clean. Mirrors the home-ZIP cookie pattern.

### 3.11 Rate limits
- **Purpose.** Shed client abuse at the edge and upstream fan-out at AWC.
- **User-facing.** 429 responses with `Retry-After` header; no UI copy.
- **Backend.**
  - Edge (`Program.cs`): `aviation-point` 120/min/IP, `aviation-poly` 30/min/IP
    (fixed-window, configurable via `WeatherSiteOptions`).
  - Upstream (`AviationWeatherService.cs`): two `SemaphoreSlim` buckets,
    `Point` vs `Poly`, released after 60s. Timeout 6s per upstream request.
  - Graceful degradation: if the semaphore is exhausted but we have cached
    payload, returns `StaleCache` with `throttled=true` rather than 503.
- **Quality read.** Looks clean. Two-level rate-limiting is deliberate and
  the "fallback to stale cache" branch is exactly right.

### 3.12 Unit toggle (shared)
- **Purpose.** °F/°C display preference shared across consumer + aviation.
- **User-facing.** Segmented toggle in `SkyHeader` (consumer) and in the
  aviation status bar.
- **Backend.** None.
- **Frontend.** `src/lib/use-units.ts` with `weather_site_units` localStorage
  key. Formatters in `lib/aviation-units.ts` (covered by 22 unit tests).
- **Quality read.** Looks clean. One storage key, one hook, full test
  coverage on the formatters.

---

## 4. Design tokens & shared conventions to preserve

### Colors (CSS tokens in `index.css` + inline in overlay controller)
- Background chassis: `#06090D`
- Phosphor accent / VFR: `#86E1A0`
- MVFR / cyan: `#7CD3FF`
- IFR / red: `#F76B6B`
- LIFR / magenta: `#D78AE0`
- Amber (AIRMET / turbulence): `#E8B770`
- Muted / unknown: `#788796`

### Typography
- Display head: Fraunces Variable
- Body: Inter Variable
- Mono: JetBrains Mono Variable
- All loaded via `@fontsource-variable/*`, not Google Fonts CDN (CSP allows
  `fonts.gstatic.com` but prod self-hosts).

### CSS class prefixes
- `obs-*` namespace: chassis (`obs-grid-bg`, `obs-scanlines`), chrome
  (`obs-statusbar`, `obs-card`, `obs-btn`, `obs-input`, `obs-disclaimer-bar`),
  content (`obs-flt-trend`, `obs-taf-strip`, `obs-nearby-ribbon`,
  `obs-nearby-chip`, `obs-airport-picker`, `obs-airport-option`),
  overlay (`obs-aviation-truncation-hint`), debug (`obs-boot`), tooltip
  (`obs-info-dot`, `obs-info-popover`).
- `data-cat="VFR|MVFR|IFR|LIFR|UNKN"` on bars/segments → category color.
- `data-condition="clear-day|clear-night|rain|…"` on the page root → drives
  the backdrop palette.

### Conventions
- **Unit toggle storage key:** `weather_site_units` (localStorage). Shared
  with consumer `App.tsx`.
- **Cross-surface URL shape:** `/aviation/:ICAO ↔ /?aviation=ICAO#explorer`.
  ICAO normalized to uppercase; validated against `/^[KP][A-Z0-9]{3}$/`.
- **Disclaimer string (permanent, do not soften):**
  > Supplemental only. Do not use for flight planning or dispatch.
- **Panel status DTO shape:** `{ source: "live"|"cache"|"stale"|"no-data"|"error", fetchedAtUtc, throttled, stale, errorMessage? }`. Every aviation
  endpoint emits this, and panels render `StalenessChip`s off it.
- **Batch endpoints preserve request order**, mark missing items
  `"unavailable"` instead of failing the whole batch.
- **Snap-grid for bbox caching:** 0.5° default (~55 km N-S at 40°N), always
  rounded outward.
- **Seamless marquee pattern** (`index.css:605-608` + `AviationApp.tsx:112`):
  `Array.from({ length: 2 })` duplication is load-bearing — do not collapse.

---

## 5. Deferred to "Phase D" (found in comments)

- **Route view.** `AviationApp.tsx:147-159` — `/aviation/route?dep=&dest=`
  renders `RouteStub`, explicitly labeled "Phase D".
- **FAA NOTAM.** `AviationApp.tsx:51-54` — ticker labels it "FAA · roadmap"
  precisely because the proxy isn't wired yet.
- **Favorites, alternate suggestion, twilight.** Listed in the RouteStub
  copy as Phase D companions.
- **Winds aloft UI.** Not labeled Phase D in comments, but backend exists
  with no consumer — effectively deferred.
- **Known stale integration tests.** 3 failing `IntegrationTests` pre-date
  the Skycast rename; intentionally deferred to post-Phase C per project
  memory. Rebuild should decide: cut or refresh.

---

## Rebuild recommendations (not a plan — just what this spec surfaces)

1. `AviationOverlayController.tsx` is the single biggest concentration of
   complexity. Splitting data-fetch / MapLibre adapter / interaction would
   reduce rebuild risk more than any other refactor.
2. Winds aloft is either cut or finished — don't carry a dangling endpoint.
3. Keep the two-bucket rate-limit + semaphore + stale-cache-fallback
   pattern in `AviationWeatherService.cs` — it is the feature's strongest
   defensive design.
4. Keep the shared `weather_site_units` key and `obs-*` token set — any
   rebuild that breaks cross-surface continuity is a regression.
5. Commit spec + next plan on `aviation-rebuild`; leave `main` as the
   frozen baseline.
