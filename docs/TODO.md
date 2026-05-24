# TODO

Deferred items — not blocking, not on the current path. One line each; expand when picked up.

## Upstream / third-party

- **MapLibre raster render race:** `draw_raster.ts:114` `'bind'` TypeError and `image_request.ts:200` signal TypeError fire intermittently during tile load/dispose. Not application-code; not blocking. The `image_request.ts` signal-read variant is now silenced cosmetically via `src/lib/silence-maplibre-race.ts` (registered first in `main.tsx`) so the console stays usable for real errors — root cause still deferred to a MapLibre version upgrade or raster source config rework.

## Infra / hosting

- **ASP.NET Core forwarded-headers config:** site runs HTTP behind Cloudflare tunnel; Request.IsHttps returns false in app code, so cookie Secure flag and any other protocol-conditional code paths see HTTP. Fix with UseForwardedHeaders middleware accepting XForwardedProto from tunnel IP. One integration test (SaveHomeLocation_SetsSecureCookie_AndCanBeReadBack) currently fails for this reason.
