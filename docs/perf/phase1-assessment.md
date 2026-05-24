# Phase 1 — Discovery Assessment (2026-04-17)

## Stack (actual, not aspirational)

**Frontend** (`src/WeatherSite.Web/`)
- React 19 + TypeScript 5.8, Vite 5.4 build, Tailwind 3.4 + a hand-rolled `storm-*` component layer in `index.css`.
- Map library: **MapLibre GL 5.6** (not Leaflet/Mapbox/Cesium/deck.gl).
- Vector basemap: **Protomaps** vector tiles in **PMTiles 4.3** packs (`@protomaps/basemaps` styling).
- Charts: **Recharts 2.15** (used for the 48-hour forecast AreaChart).
- `clsx` for class-name merging. No router — the app is a single scrolling page with `#forecast` / `#explorer` anchors.
- Google Fonts CSS `@import` for *Space Grotesk* (render-blocking third-party).
- Vitest + Testing Library wired up; one test file (`App.test.tsx`).

**Backend** (`src/WeatherSite.Api/`)
- **ASP.NET Core .NET 10** web API. The same app ALSO serves the SPA: `UseDefaultFiles` + `UseStaticFiles` + `MapFallbackToFile("index.html")`. Not a pure static site.
- Controllers: `SessionController` (home-location cookie), `WeatherController` (overview/bundle), `MapsController` (map config + WMS tile proxy).
- Services: `ZipResolver` (embedded ZCTA centroid JSON + Open-Meteo fallback), `NwsWeatherService` (points/forecast/alerts/stations/observations, all memory-cached), `MapConfigurationService` (WMS GetCapabilities parse + layer catalog), `MapTileProxyService` (WMS raster tile cache), `MapLayerCatalog` (hard-coded layer list).
- Upstreams: `api.weather.gov`, NOAA OpenGeo WMS (`opengeo.ncep.noaa.gov`), NDFD WMS (`digital.weather.gov`), Open-Meteo geocoder. All proxied server-side, so NOAA's User-Agent contract is respected centrally.
- Memory-cache TTLs: points 24h, forecast 5m, alerts 1m, observations 2m, WMS capabilities 5m, tiles 60–300s, map config 1m.
- Security/hardening is solid: CSP, HSTS, X-Frame-Options, forwarded headers, per-IP rate limiting (`weather-api` 120/min, `tile-proxy` 600/min), Data Protection for the `weather_home_zip` cookie (HttpOnly, SameSite=Lax, Secure, 365-day lifetime).

**Deploy pipeline**
- IIS Site: `weathersite`, bound to `http://*:8080`, physical path is the published output under `src/WeatherSite.Api/bin/Release/net10.0/win-x64/publish/`.
- `weather.vasilis.club` sits behind **Cloudflare** (observed in response headers) which presumably terminates TLS and forwards to the IIS 8080 binding. The site's own `web.config` is the dotnet-publish-generated ASP.NET Core Module shim — nothing else (no `<clientCache>`, no `<rewrite>`, no `<staticContent>` MIME). All static delivery flows through Kestrel in-process.
- Build is driven by the `.csproj`: a `BuildFrontendForPublish` MSBuild target runs `npm install && npm run build` in `WeatherSite.Web`, which emits to `../WeatherSite.Api/wwwroot`; `SyncFrontendAssetsIntoPublishDirectory` mirrors that into the publish output. One command (`dotnet publish -c Release -r win-x64`) produces the full deployable.
- PMTiles basemaps are carried separately: `world.pmtiles` (44 MB) and `usa.pmtiles` (440 MB) live in `data/basemaps/`, are mirrored into `wwwroot/tiles/basemaps/`, and are served with MIME `application/octet-stream` registered at Program.cs:118.

**Routes / components**
- Single route `/`. Three top-level UI regions inside `App.tsx`: hero + local-radar preview, `WeatherDashboard` (forecast deck), `MapExplorer` (explorer). All mount together on first paint once a ZIP is resolved.
- Two distinct `WeatherMap` instances can be live at once (hero preview + explorer), each spinning up its own MapLibre WebGL context.

**Third-party deps worth flagging**
- `recharts` (eager import from `WeatherDashboard`): 406 KB raw / 152 KB br — big for one chart.
- `maplibre-gl`: 1.05 MB raw / 370 KB br — necessary for our use case, but eagerly triggered the moment a ZIP is saved because `WeatherMap` is statically imported by `App.tsx` and `MapExplorer`.
- `@protomaps/basemaps` + `pmtiles`: in the main chunk via static imports from `WeatherMap.tsx`.
- `fonts.googleapis.com` / `fonts.gstatic.com` / `protomaps.github.io` (glyphs + sprites) are live third-party fetches baked into CSS and `createMapStyle()`.

---

## Measured baseline

### Lighthouse 12 — https://weather.vasilis.club/ (unhydrated landing, no saved ZIP)

| Metric | Desktop | Mobile (Moto G4, 4× CPU, slow 4G) |
|---|---|---|
| Performance score | **0.98** | **0.83** |
| FCP | 0.9 s | 3.4 s |
| LCP | 0.9 s | 3.6 s |
| Speed Index | 0.9 s | 3.4 s |
| TBT | 0 ms | 0 ms |
| TTI | 0.9 s | 3.6 s |
| CLS | 0.001 | 0.011 |
| Total transfer | 303 KiB | 305 KiB |
| Accessibility | — | **1.00** |
| Best Practices | — | 0.96 |

Top Lighthouse opportunities (mobile): render-blocking resources ~720 ms, unused JS 178 KiB, unused CSS 25 KiB, missing preconnect hints 140 ms.

> **Caveat — this is the easy case.** Lighthouse lands on an empty "Save a ZIP" shell because there's no saved-location cookie. The true critical path (saved-ZIP return visit, where MapLibre, Recharts, PMTiles ranges, WMS tile proxy calls, and the weather bundle all race for first paint) cannot be scripted through Lighthouse without an encrypted cookie. I'll add a Puppeteer-based flow timing in Phase 3 once we have a local dev server running, but the static fingerprint below establishes what that path has to pay for.

### Brotli transfer fingerprint (CDN-origin GETs, `Accept-Encoding: br`)

| Path | Compressed | Raw | `Cache-Control` | Notes |
|---|---|---|---|---|
| `/` (index.html) | 372 B | — | *(none)* → Cloudflare `DYNAMIC` | No cache header from origin |
| `/assets/index-BBp59cl2.js` | 101 KiB | 270 KiB | `max-age=14400` | Main SPA chunk, eager |
| `/assets/charts-CNNS2WMx.js` | 152 KiB | 406 KiB | `max-age=14400` | Recharts, module-preloaded |
| `/assets/maplibre-gl-Be1Eb1jx.js` | 370 KiB | 1,024 KiB | `max-age=14400` | Dynamic-imported, but triggered on first map mount |
| `/assets/index-Cfk0z2oN.css` | 29 KiB | 94 KiB | `max-age=14400` | Tailwind + maplibre-gl.css + storm-* |
| `/tiles/basemaps/world.pmtiles` | — (uncompressed) | **44 MB** | *(none)* | Range-served by Kestrel |
| `/tiles/basemaps/usa.pmtiles` | — (uncompressed) | **440 MB** | *(none)* | Range-served by Kestrel |

**First-render budget for a returning user (post-hydration):** roughly **650 KiB brotli** of JS/CSS (index + charts + maplibre + css) plus parallel PMTiles range fetches plus the `/api/weather/bundle` round-trip. That is the number to beat in Phase 4.

Artifacts: `.perf/baseline.json` (desktop), `.perf/baseline-mobile.json` (mobile).

---

## Top problems, ranked by impact

### 1. MapLibre + Recharts both load on first paint of the signed-in experience
- `App.tsx` statically imports `WeatherMap`, which statically imports `@protomaps/basemaps` and `pmtiles`, and dynamically imports `maplibre-gl`.
- `WeatherDashboard` statically imports `recharts`, so the 406 KB chart bundle lands the moment the dashboard mounts — even though the chart is below the fold.
- Because `App.tsx` renders the hero-side `<WeatherMap>` as soon as a bundle resolves, **MapLibre's 1 MB chunk is pulled in on every hydrated first paint**, not when the user actually looks at the explorer.
- There are also **two live MapLibre map instances** on the same page (hero preview + explorer) — that's two WebGL contexts, two style loads, two tile pipelines. Worse: `WeatherMap`'s init effect lists `config.location.zip` in its dependency array (line 106) and calls `mapRef.current?.remove()` on teardown — every ZIP change tears down and rebuilds both maps from scratch instead of camera-panning.

**Impact:** roughly 550 KiB brotli / 1.5 MB raw of avoidable JS on the first hydrated paint, plus the teardown/rebuild cost on any location change. This is the single biggest performance lever.

### 2. Live third-party fetches in a "static IIS" story
- `src/index.css:1` pulls Space Grotesk from Google Fonts — render-blocking, CDN, no preconnect, outside the brief's "no third-party fonts I haven't approved" rule.
- `createMapStyle()` (WeatherMap.tsx:208, 211) points MapLibre glyphs and sprites at `https://protomaps.github.io/basemaps-assets/...` — a public GitHub Pages host, cannot be relied on at scale, and the CSP already enumerates it in `font-src`.
- The basemap fallback tiles go straight to `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (WeatherMap.tsx:190), which is against the OSM Foundation Tile Usage Policy.

**Impact:** two render-blocking third-party domains on first paint, plus a non-compliant tile source that will eventually rate-limit the live site.

### 3. Giant PMTiles regional pack with no long-lived caching
- `usa.pmtiles` is **440 MB**. PMTiles uses HTTP Range requests, so a real user won't download all 440 MB — but the origin returns it without any `Cache-Control` header, which means Cloudflare edge won't hold ranges for long (and browser disk cache is weakly scoped). Every cold user session re-negotiates range requests against Kestrel.
- Kestrel does honor Range, but `UseStaticFiles` doesn't emit immutable cache headers. These files never change per deploy, they're ideal `immutable, max-age=31536000` assets.
- The USA pack at zoom 0–14 for the whole country is overkill for a ZIP-centered dashboard. Even halving the max zoom or splitting by region would cut disk, cache churn, and cold-range cost.

**Impact:** slow, inconsistent PMTiles cold-starts; noticeable basemap pop-in even on repeat visits.

### 4. Explorer defaults to globe projection → triple-work first render
- `MapExplorer.tsx:40`: `setProjection(config.supportsGlobe ? "globe" : "mercator")`, and the config always reports `supportsGlobe: true` (`MapConfigurationService.cs:102`). So the big explorer map mounts in globe mode by default, with `conus-radar + hazards` overlays active — globe projection is more expensive (perspective, more tiles in view, extra atlas work) and the user hasn't asked for it yet.
- Default preset is also "national" (CONUS radar), meaning two simultaneous WMS-proxied raster layers fire on mount.

**Impact:** globe projection adds noticeable GPU/CPU work on first visit to the explorer section, before the user has chosen to interact.

### 5. Visual design is a single aesthetic note held for too long
- Everything is wrapped in the same `storm-card` glass/backdrop-blur treatment: hero, dashboard panels, forecast cards, alert cards, narrative cards, explorer sidebar, layer rows. No hierarchy between primary ("here's what the weather is right now") and secondary ("here's a list of narrative periods") surfaces.
- Color palette is monochromatic teal/blue on dark. The only differentiation is rose/amber for alerts. There is no temperature-driven color system, no wind-speed scale, no precipitation-probability ramp — the dashboard can't convey data through color at a glance.
- Typography is one family (Space Grotesk) at four weights. Numeric displays and prose use the same face; tabular figures aren't enabled; temperatures don't have optical sizing.
- `backdrop-blur-2xl` on ~8 overlapping panels is expensive on lower-end GPUs and is a lot of the "heavy" feel you're describing even before the map comes in.

**Impact:** this is the "flat command deck" feeling. Fixing it is design-language work, not a bug fix; it's Phase 2's job.

---

## Open items worth confirming before Phase 2

- Is the Cloudflare in front of the site one you control? If so, we can ship aggressive cache rules for `/assets/*` and `/tiles/basemaps/*` at the edge without touching IIS.
- Is the expectation that the regional PMTiles pack must cover the full lower-48, or can we trim the zoom range / geography to what the dashboard actually renders?
- Is the `weathersite` → `:8080` Cloudflare tunnel terminating TLS at Cloudflare and speaking plain HTTP to origin? That would explain why the IIS binding is `http://*:8080` with no HTTPS config here.
- Confirm the server-side `EnforceHttpsRedirection: true` is safe under the Cloudflare tunnel (it should be, because of `UseForwardedHeaders`, but worth checking no redirect loops exist).

I have not modified any code. Ready for your sign-off — or a redirection — before moving to Phase 2.
