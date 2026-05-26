# Contributing

Architecture and conventions for contributors to Skycast Observatory.

For project overview and setup, see the [README](README.md).

## Stack

- **Backend**: ASP.NET Core .NET 10, C# (`src/WeatherSite.Api`).
  Solution: `WeatherSite.sln`. Controllers: `WeatherController`,
  `AviationController`, `MapsController`, `SessionController`.
- **Frontend**: single Vite + React 19 + TypeScript + Tailwind 3 project
  at `src/WeatherSite.Web`. Builds into `src/WeatherSite.Api/wwwroot`
  via the `BuildFrontendForPublish` MSBuild target during
  `dotnet publish`.
- **Map stack**: MapLibre GL 5, pmtiles 4, @protomaps/basemaps 5.
  Radar / hazard / wind / clouds / precipitation tile proxying via the
  API.
- **Tests**: xUnit for the API (`tests/WeatherSite.Api.Tests`,
  `tests/WeatherSite.Api.IntegrationTests`). Vitest + Testing Library
  for the SPA, colocated as `*.test.{ts,tsx}` files under
  `src/WeatherSite.Web/src/`; no separate test project. Run with
  `npm run test` from that directory.

## Deployment topology

- **Production**: `https://weather.vasilis.club`. Cloudflare tunnel
  terminates HTTPS and forwards to the Windows host. IIS site (port
  **8080**, plain HTTP by design) serves the published `WeatherSite.Api`
  with the SPA in `wwwroot`.
- **Dev API**: `dotnet run` from `src/WeatherSite.Api` starts a Kestrel
  instance on `http://localhost:5080`. Same code as production; serves
  the same routes.
- **Vite dev proxy** (`src/WeatherSite.Web/vite.config.ts`): `/api`,
  `/tiles`, `/map-assets` → `http://localhost:8080` by default. Re-point
  `apiOrigin` to `:5080` locally when iterating on in-flight API
  changes.

## Dev workflow

- `npm run dev` from `src/WeatherSite.Web` starts Vite on
  `http://localhost:5173`.
- `dotnet run` from `src/WeatherSite.Api` starts the dev API on
  `http://localhost:5080`.
- IIS runs on `:8080` and serves the production bits; do not stop or
  recycle it casually.

## Design and UX constraints

- Observatory theme: dark background (`#06090D`), phosphor green accent
  (`#86E1A0`), amber / cyan / red category colors, monospace plus
  variable sans stack (Fraunces / Inter / JetBrains Mono).
- Shared tokens with the consumer surface: `obs-*` classes, unit toggle
  (`weather_site_units` localStorage key), cross-surface link
  `/aviation/:icao ↔ /?aviation=ICAO#explorer`.
- Aviation surfaces carry a permanent disclaimer: **"Supplemental only.
  Not for flight planning."** Do not remove it.
- The seamless marquee (`index.css:605-608`) uses
  `Array.from({ length: 2 })` duplication — do not reduce to 1.

## Workflow rules

1. Read the surrounding code and understand the shape before proposing
   changes.
2. Propose a plan and wait for approval before changes larger than a
   single localized fix.
3. Never modify anything that affects production without explicit
   approval. That means:
   - Do not run `dotnet publish` against the live IIS path; publish to
     a staging directory first and copy in deliberately.
   - Do not stop, recycle, or reconfigure the IIS `weathersite` site
     on `:8080`.
   - Do not edit `appsettings.json` (prod); only
     `appsettings.Development.json`.
   - Do not re-point the Cloudflare tunnel or change bindings.

## Known state

- Phase B/C aviation overlay (stations, hazards, PIREPs, time-slice) is
  wired in `src/WeatherSite.Web/src/aviation/`.
- Three integration tests fail and pre-date the Skycast rename — cleanup
  is deferred to after Phase C ships. Do not "fix" them mid-feature.

## Lessons

- **Diagnosing UI "invisibility":** computed-style probes
  (`getComputedStyle`, `getBoundingClientRect`) confirm an element's
  CSS state but cannot detect occlusion or low perceptual contrast. An
  element can be "visible" per CSS (display / visibility / opacity all
  nominal, rect has real dimensions) while being completely covered by
  a sibling's absolutely-positioned overlay, or while its rendered
  color is indistinguishable from the surrounding paint. Pixel-level
  verification — programmatic sampling at known screen coordinates from
  a headless screenshot, or direct human inspection — catches both
  failure modes. Precedent: the 2026-04 ZIP-input occlusion bug
  (`.obs-now-radar-empty` escaping `.obs-now-telemetry` because the
  cell lacked `position: relative`) was invisible to every computed-
  style probe; only a pixel dump of the rendered page revealed a solid
  overlay painting `rgb(4,6,9)` where CSS said
  `rgba(134,225,160,0.2)` should be.
