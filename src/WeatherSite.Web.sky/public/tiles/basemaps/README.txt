Place self-hosted PMTiles archives in this folder before production deployment.

Recommended files:
- world.pmtiles
- usa.pmtiles

The app will detect their presence at runtime. If they are missing, the map still loads
with weather overlays but without the self-hosted basemap context.
