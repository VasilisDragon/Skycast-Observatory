# TODO

Deferred items — not blocking, not on the current path. One line each; expand when picked up.

## Upstream / third-party

- **MapLibre raster render race:** `draw_raster.ts:114` `'bind'` TypeError and `image_request.ts:200` signal TypeError fire intermittently during tile load/dispose. Not application-code; not blocking. The `image_request.ts` signal-read variant is now silenced cosmetically via `src/lib/silence-maplibre-race.ts` (registered first in `main.tsx`) so the console stays usable for real errors — root cause still deferred to a MapLibre version upgrade or raster source config rework.
