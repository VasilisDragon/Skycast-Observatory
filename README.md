# Skycast Observatory

A self-hosted weather and aviation observation site. Civil weather for any
US ZIP code (current conditions, NWS alerts, hourly chart, 7-day trend, and
an interactive map atlas with radar, hazards, wind, clouds, and precipitation
overlays) plus a parallel aviation surface with METAR / TAF / PIREP /
AIRMET / SIGMET / CWA / winds-aloft for any US ICAO airport.

**Live**: [weather.vasilis.club](https://weather.vasilis.club)

Built as a single-source ASP.NET Core 10 + React 19 application. Tiles are
proxied server-side so the National Weather Service and NOAA upstreams see
one well-formed `User-Agent` (per NOAA's API contract) rather than every
client browser. Map basemaps ship as PMTiles archives served directly from
the API.

## What's interesting under the hood

- **One backend, two surfaces.** The same ASP.NET Core API serves the
  consumer weather UI and the `/aviation/*` subsite, sharing the cookie
  store, rate limiter, tile proxy, and design tokens.
- **Cookie-based personalization without an account system.** Home ZIP and
  home ICAO airport persist in HttpOnly Data-Protection-signed cookies. No
  user accounts, no database, no email collection.
- **Production-grade hardening.** CSP locked to `connect-src 'self'`, HSTS,
  X-Frame-Options, forwarded-headers middleware behind Cloudflare,
  per-IP rate limits split across `weather-api` (120/min) and `tile-proxy`
  (600/min), DPAPI-protected data-protection keys at rest, AllowedHosts
  restricted to the production origin.
- **Real upstream parsing, not screen-scraping.** METAR / TAF / Forecast
  Builder / Flight Category logic implemented from spec
  (`src/WeatherSite.Api/Utilities/`) — the API surface is type-safe and
  the parsers have unit tests.
- **Honest aviation disclaimer.** Every aviation surface carries
  **"Supplemental only. Not for flight planning."** as a permanent label.
  The site is for situational awareness, not dispatch.

## Architecture

```
                            Cloudflare tunnel (HTTPS termination)
                                          │
                                          ▼
                          IIS :8080  (weathersite app pool)
                                          │
                              ┌──────────────────────┐
                              │  WeatherSite.Api     │  ASP.NET Core 10
                              │  Kestrel in-process  │  C#
                              └──────────┬───────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
       NWS api.weather.gov       AWC aviationweather.gov     NDFD / OpenGeo WMS
       (forecast, alerts,        (METAR, TAF, PIREPs,        (radar, hazards,
        observations)             AIRMETs, SIGMETs,          wind, clouds,
                                   winds-aloft)              precip)

                              ┌──────────────────────┐
                              │  wwwroot/ (SPA)      │  React 19 + Vite
                              │  built by dotnet     │  TypeScript + Tailwind 3
                              │  publish via         │  MapLibre GL 5
                              │  BuildFrontendFor-   │  pmtiles 4
                              │  Publish target      │
                              └──────────────────────┘
```

The frontend is a single Vite project at `src/WeatherSite.Web/` that builds
into `src/WeatherSite.Api/wwwroot/` as part of `dotnet publish`. There's no
separate static deploy — one `dotnet publish -c Release -r win-x64` produces
the complete deployable.

## Technology

- **Backend:** ASP.NET Core .NET 10, C#
- **Frontend:** React 19, TypeScript 5.8, Vite 5.4, Tailwind 3.4
- **Maps:** MapLibre GL 5, pmtiles 4, @protomaps/basemaps 5
- **Charts:** Recharts 2.15
- **Tests:** xUnit (API + integration), Vitest + Testing Library (SPA)
- **Hosting:** Windows / IIS / Cloudflare tunnel
- **Map data:** Protomaps basemaps (PMTiles), CONUS + KLOT MRMS radar via
  NWS, NDFD WMS layers via NOAA

## Setup

Requires .NET 10 SDK, Node.js 22+, and a Windows host for IIS (or any
ASP.NET Core hosting target).

```bash
# Backend (terminal 1)
cd src/WeatherSite.Api
dotnet run                # API on http://localhost:5080

# Frontend (terminal 2)
cd src/WeatherSite.Web
npm install
npm run dev               # Vite on http://localhost:5173
```

The Vite dev proxy at `src/WeatherSite.Web/vite.config.ts` routes `/api`,
`/tiles`, and `/map-assets` to the dev API by default.

### Building a production deployable

```bash
dotnet publish WeatherSite.sln -c Release -r win-x64
```

This runs the `BuildFrontendForPublish` MSBuild target, which invokes
`npm install && npm run build` in the SPA project and mirrors the output
into the API's `wwwroot/`. The published folder under
`src/WeatherSite.Api/bin/Release/net10.0/win-x64/publish/` is the deployable.

### Map basemaps

The PMTiles basemaps (`world.pmtiles` ~44 MB and `usa.pmtiles` ~440 MB) are
not tracked in git. Rebuild or download them under `data/basemaps/` using
the scripts in `scripts/`; they're mirrored into
`wwwroot/tiles/basemaps/` during publish.

## Tests

```bash
# Backend unit tests
dotnet test tests/WeatherSite.Api.Tests

# Backend integration tests (some currently fail — see docs/TODO.md)
dotnet test tests/WeatherSite.Api.IntegrationTests

# Frontend
cd src/WeatherSite.Web && npm run test
```

## Project layout

```
src/
├── WeatherSite.Api/           ASP.NET Core API + SPA host
│   ├── Configuration/         Options binding
│   ├── Contracts/             API DTOs (Aviation + civil)
│   ├── Controllers/           Aviation, Maps, Session, Weather
│   ├── Models/                Internal models
│   ├── Services/              Airport catalog, NWS, AWC, map config, tile proxy
│   ├── Utilities/             METAR/TAF/Fb parsers, flight category, cookie codec
│   ├── Program.cs             Entry point + middleware pipeline
│   └── wwwroot/               Static assets (favicons, manifest); built SPA mirrors here
│
└── WeatherSite.Web/           React + Vite SPA
    ├── src/
    │   ├── aviation/          /aviation/* subsite, overlay controller, router
    │   ├── components/        SkyHeader, SkyNowHero, error boundary, WeatherMap, MapExplorer
    │   ├── lib/               Units, MapLibre helpers, cross-surface link
    │   └── App.tsx            Routes consumer + aviation surfaces
    └── vite.config.ts

tests/
├── WeatherSite.Api.Tests/             xUnit unit tests
└── WeatherSite.Api.IntegrationTests/  xUnit integration tests

data/                            Static data (airports.json, ZCTA centroids; PMTiles regenerated)
scripts/                         Tile prep, ZCTA generation, deploy helpers
tools/                           Bundled tool binaries (re-fetched, gitignored)

docs/
├── AVIATION_SPEC.md             Aviation feature reference (rebuild spec)
├── DEPLOY_PLAN.md               Production deploy procedure
├── TODO.md                      Deferred items not on the current path
└── perf/                        Discovery + optimization notes
```

## Acknowledgments

- [National Weather Service](https://api.weather.gov/) for the civil
  weather API
- [Aviation Weather Center](https://aviationweather.gov/) for METAR / TAF /
  PIREP / AIRMET / SIGMET / CWA / winds-aloft data
- [NOAA Open Data Dissemination](https://www.weather.gov/) for the NDFD
  and MRMS radar feeds proxied by the tile service
- [Protomaps](https://protomaps.com/) for the PMTiles format and the
  vector basemap build tooling
- [MapLibre](https://maplibre.org/) for the WebGL map renderer

## License

MIT — see [LICENSE](LICENSE).
