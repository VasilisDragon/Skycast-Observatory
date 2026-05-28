# TODO

Deferred items — not blocking, not on the current path. One line each; expand when picked up.

## Upstream / third-party

- **MapLibre raster render race:** `draw_raster.ts:114` `'bind'` TypeError and `image_request.ts:200` signal TypeError fire intermittently during tile load/dispose. Not application-code; not blocking. The `image_request.ts` signal-read variant is now silenced cosmetically via `src/lib/silence-maplibre-race.ts` (registered first in `main.tsx`) so the console stays usable for real errors — root cause still deferred to a MapLibre version upgrade or raster source config rework.

## Infra / hosting

- **`SaveHomeLocation_SetsSecureCookie_AndCanBeReadBack` integration test:** Production forwarded-headers config now applied (`WeatherSite:TrustedProxies` in appsettings.json drives `KnownProxies` in `Program.cs`, and `UseForwardedHeaders` middleware runs when the option is enabled), so Request.IsHttps resolves correctly behind the Cloudflare tunnel. The integration test still fails because WebApplicationFactory's TestServer doesn't set `X-Forwarded-Proto`, so Request.IsHttps stays false and the Secure cookie flag is dropped in-test. Either inject the header in the test setup or scope the Secure-flag assertion to the production transport.
