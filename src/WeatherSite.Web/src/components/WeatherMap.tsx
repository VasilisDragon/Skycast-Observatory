import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import clsx from "clsx";
import { Protocol } from "pmtiles";
import type { MapCamera, MapConfigResponse, ProjectionMode } from "../types";
import type { BboxTuple } from "../aviation/types";

const FALLBACK_BADGE_DISMISSED_KEY = "weathersite.osm-fallback-badge-dismissed";

type LayerSelection = {
  id: string;
  opacity: number;
  time?: string;
};

interface WeatherMapProps {
  config: MapConfigResponse;
  projection: ProjectionMode;
  camera: MapCamera;
  layers: LayerSelection[];
  interactive?: boolean;
  className?: string;
  title?: string;
  mini?: boolean;
  onCameraChange?: (camera: MapCamera) => void;
  // Phase C aviation overlay attaches via these callbacks. Both are optional —
  // existing consumer callers ignore them. onMapReady fires once on `load`;
  // onBboxChange fires on every moveend (includes programmatic moves).
  onMapReady?: (map: MapLibreMap) => void;
  onBboxChange?: (bbox: BboxTuple) => void;
}

// Overlay tile sources (radar/NDFD/hazards) are CONUS-scale rasters. Their
// backing WMS renderers don't produce meaningful detail past ~zoom 9, and
// often return empty tiles at higher zooms. Capping the source here lets
// MapLibre over-zoom the zoom-9 tile in-place instead of fetching nothing.
const OVERLAY_SOURCE_MAXZOOM = 9;
// Map ceiling — overlays over-zoom gracefully up to this point.
const MAP_MAX_ZOOM = 11;

type RasterSourceLike = {
  setTiles?: (tiles: string[]) => void;
};

const locationSourceId = "saved-location";
const locationLayerId = "saved-location-layer";
const locationRingLayerId = "saved-location-ring-layer";
const basemapProtocol = new Protocol();
let pmtilesProtocolRegistered = false;

export function WeatherMap({
  config,
  projection,
  camera,
  layers,
  interactive = true,
  className,
  title,
  mini = false,
  onCameraChange,
  onMapReady,
  onBboxChange
}: WeatherMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const didInitializeRef = useRef(false);
  const projectionRef = useRef<ProjectionMode>(projection);
  projectionRef.current = projection;
  const [mapError, setMapError] = useState<string | null>(null);
  const hasLocalBasemap = Boolean(config.worldPmtilesUrl || config.regionalPmtilesUrl);
  const [isFallbackBadgeDismissed, setIsFallbackBadgeDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(FALLBACK_BADGE_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let disposed = false;

    async function initializeMap() {
      if (!containerRef.current || mapRef.current) {
        return;
      }

      try {
        const maplibre = await import("maplibre-gl");
        if (disposed || !containerRef.current) {
          return;
        }

        ensurePmtilesProtocol(maplibre);

        const map = new maplibre.Map({
          attributionControl: false,
          center: [camera.longitude, camera.latitude],
          container: containerRef.current,
          cooperativeGestures: interactive,
          interactive,
          maxZoom: MAP_MAX_ZOOM,
          minZoom: 1,
          pitch: 0,
          style: createMapStyle(config),
          zoom: Math.min(camera.zoom, MAP_MAX_ZOOM)
        });

        if (interactive) {
          map.addControl(
            new maplibre.NavigationControl({ showCompass: true, visualizePitch: true }),
            "top-right"
          );
        }

        map.on("load", () => {
          ensureLocationMarker(map, config);
          syncProjection(map, projection);
          syncLayers(map, config, layers);
          didInitializeRef.current = true;
          onMapReady?.(map);
          if (onBboxChange) {
            onBboxChange(currentBbox(map));
          }
        });

        if (onBboxChange) {
          map.on("moveend", () => {
            onBboxChange(currentBbox(map));
          });
        }

        // Re-evaluate the projection as the user zooms — stay on globe for
        // low-zoom overviews and swap to mercator as soon as we cross the
        // threshold, so the canvas doesn't blank out mid-zoom.
        map.on("zoom", () => {
          syncProjection(map, projectionRef.current);
        });

        if (onCameraChange) {
          // Only fire for user-driven moves (mouse, touch, scroll) — not
          // programmatic easeTo calls that originate from camera-prop changes.
          // MapLibre populates `originalEvent` only for input-driven events.
          map.on("moveend", (event: { originalEvent?: Event }) => {
            if (!event.originalEvent) {
              return;
            }
            const center = map.getCenter();
            onCameraChange({
              latitude: center.lat,
              longitude: center.lng,
              zoom: map.getZoom()
            });
          });
        }

        // Only fire the unavailable banner on initialization failures.
        // Tile 404s and transient fetch errors should not poison the UX —
        // MapLibre emits these continuously for out-of-range radar tiles.
        map.on("error", (event) => {
          if (didInitializeRef.current) {
            return; // swallow post-init tile errors
          }
          const message = event.error?.message ?? "";
          // Ignore non-fatal messages
          if (/abort|network|tile/i.test(message)) {
            return;
          }
          setMapError("Basemap unavailable — falling back to offline terrain.");
        });

        mapRef.current = map;
      } catch {
        setMapError("Basemap unavailable — falling back to offline terrain.");
      }
    }

    void initializeMap();

    return () => {
      disposed = true;
      didInitializeRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [
    config.location.zip,
    config.localBasemapAvailable,
    config.worldPmtilesUrl,
    config.regionalPmtilesUrl,
    interactive
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    syncProjection(map, projection);
    ensureLocationMarker(map, config);
    map.easeTo({
      center: [camera.longitude, camera.latitude],
      duration: 900,
      essential: true,
      pitch: 0,
      zoom: camera.zoom
    });
    syncLayers(map, config, layers);
  }, [camera.latitude, camera.longitude, camera.zoom, config, layers, projection]);

  // Mini mode: bare canvas. Parent supplies top/bottom strips + crosshair.
  // Full mode: canvas plus corner badges (fallback / error).
  return (
    <>
      <div
        ref={containerRef}
        className={clsx(className, mini && "obs-atlas-canvas")}
        aria-label={title ?? (mini ? "Radar preview" : "Weather map")}
      />
      {mapError ? (
        <div className="obs-map-badge is-crit" role="status">
          <span aria-hidden="true">!</span>
          <span>{mapError}</span>
        </div>
      ) : null}
      {!mini && !hasLocalBasemap && !isFallbackBadgeDismissed && !mapError ? (
        <div className="obs-map-badge" role="status">
          <span aria-hidden="true">◎</span>
          <span>OSM fallback</span>
          <button
            type="button"
            aria-label="Dismiss fallback notice"
            onClick={() => {
              setIsFallbackBadgeDismissed(true);
              try {
                window.sessionStorage.setItem(FALLBACK_BADGE_DISMISSED_KEY, "1");
              } catch {
                /* ignore */
              }
            }}
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}

function createMapStyle(config: MapConfigResponse): StyleSpecification {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const sources: NonNullable<StyleSpecification["sources"]> = {};
  const flavor = namedFlavor("light");
  const layers: LayerSpecification[] = [
    {
      id: "background",
      type: "background",
      paint: {
        // Dark slate so the radar pops against a terminal-ink basemap
        "background-color": "#0A0E13"
      }
    }
  ];

  if (config.worldPmtilesUrl) {
    sources["basemap-world"] = {
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
      type: "vector",
      url: `pmtiles://${origin}${config.worldPmtilesUrl}`
    };
    layers.push(...decorateBasemapLayers("basemap-world", "world", flavor, { maxzoom: 6.25 }));
  }

  if (config.regionalPmtilesUrl) {
    sources["basemap-regional"] = {
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
      type: "vector",
      url: `pmtiles://${origin}${config.regionalPmtilesUrl}`
    };
    layers.push(
      ...decorateBasemapLayers("basemap-regional", "regional", flavor, {
        minzoom: config.worldPmtilesUrl ? 5.75 : undefined
      })
    );
  }

  if (!config.worldPmtilesUrl && !config.regionalPmtilesUrl) {
    sources["fallback-basemap"] = {
      attribution: "© OpenStreetMap contributors",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      type: "raster",
      minzoom: 0,
      maxzoom: 19
    };

    layers.push({
      id: "fallback-basemap",
      source: "fallback-basemap",
      type: "raster",
      paint: {
        "raster-opacity": 0.85,
        "raster-saturation": -0.55,
        "raster-contrast": -0.15,
        "raster-brightness-min": 0.02,
        "raster-brightness-max": 0.62
      }
    });
  }

  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    layers,
    sources,
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light"
  };
}

// Globe rendering begins to tear and wash to a blank canvas past ~zoom 6 in
// several MapLibre builds. Force mercator whenever we're zoomed in past that
// threshold so the basemap and overlays stay visible; the user can still
// toggle back to globe at low zooms.
const GLOBE_MAX_ZOOM = 6;
const appliedProjections = new WeakMap<MapLibreMap, ProjectionMode>();

function syncProjection(map: MapLibreMap, projection: ProjectionMode) {
  try {
    const effective: ProjectionMode =
      projection === "globe" && map.getZoom() > GLOBE_MAX_ZOOM ? "mercator" : projection;
    if (appliedProjections.get(map) === effective) {
      return;
    }
    map.setProjection({ type: effective });
    appliedProjections.set(map, effective);
  } catch {
    /* some builds lack globe support; silently skip */
  }
}

function ensureLocationMarker(map: MapLibreMap, config: MapConfigResponse) {
  const featureCollection: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [config.centerLongitude, config.centerLatitude]
        },
        properties: {}
      }
    ]
  };

  if (!map.getSource(locationSourceId)) {
    map.addSource(locationSourceId, {
      data: featureCollection,
      type: "geojson"
    });
  } else {
    const source = map.getSource(locationSourceId) as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(featureCollection);
  }

  if (!map.getLayer(locationRingLayerId)) {
    map.addLayer({
      id: locationRingLayerId,
      source: locationSourceId,
      type: "circle",
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": 14,
        "circle-stroke-color": "#86E1A0",
        "circle-stroke-opacity": 0.7,
        "circle-stroke-width": 1
      }
    });
  }

  if (!map.getLayer(locationLayerId)) {
    map.addLayer({
      id: locationLayerId,
      source: locationSourceId,
      type: "circle",
      paint: {
        "circle-color": "#86E1A0",
        "circle-radius": 4,
        "circle-stroke-color": "#06090D",
        "circle-stroke-width": 1.5
      }
    });
  }
}

function syncLayers(map: MapLibreMap, config: MapConfigResponse, selections: LayerSelection[]) {
  const selectionLookup = new Map(selections.map((selection) => [selection.id, selection]));
  const overlayAnchorId = findOverlayAnchorId(map);

  for (const descriptor of config.layers) {
    const sourceId = `source-${descriptor.id}`;
    const layerId = `layer-${descriptor.id}`;
    const selection = selectionLookup.get(descriptor.id);

    if (!selection) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }

      continue;
    }

    const tileUrl = applyTime(descriptor.tileUrlTemplate, selection.time, descriptor.timeDimensionName);
    const existingSource = map.getSource(sourceId) as RasterSourceLike | undefined;

    if (!existingSource) {
      map.addSource(sourceId, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: OVERLAY_SOURCE_MAXZOOM
      });

      map.addLayer({
        id: layerId,
        source: sourceId,
        type: "raster",
        paint: {
          "raster-fade-duration": 0,
          "raster-opacity": selection.opacity
        }
      }, overlayAnchorId);
    } else if (typeof existingSource.setTiles === "function") {
      existingSource.setTiles([tileUrl]);
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          source: sourceId,
          type: "raster",
          paint: {
            "raster-fade-duration": 0,
            "raster-opacity": selection.opacity
          }
        }, overlayAnchorId);
      }
    }

    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "visible");
      map.setPaintProperty(layerId, "raster-opacity", selection.opacity);
      if (overlayAnchorId) {
        map.moveLayer(layerId, overlayAnchorId);
      } else {
        map.moveLayer(layerId);
      }
    }
  }

  if (map.getLayer(locationRingLayerId)) {
    map.moveLayer(locationRingLayerId);
  }
  if (map.getLayer(locationLayerId)) {
    map.moveLayer(locationLayerId);
  }
}

function applyTime(tileUrlTemplate: string, time?: string, timeDimensionName?: string | null): string {
  const base = tileUrlTemplate.replace("{z}", "{z}").replace("{x}", "{x}").replace("{y}", "{y}");
  if (!time || !timeDimensionName) {
    return base;
  }

  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${encodeURIComponent(timeDimensionName)}=${encodeURIComponent(time)}`;
}

function decorateBasemapLayers(
  sourceName: string,
  prefix: string,
  flavor: ReturnType<typeof namedFlavor>,
  zoomRange: { minzoom?: number; maxzoom?: number }
): LayerSpecification[] {
  return protomapsLayers(sourceName, flavor, { lang: "en" }).map((layer) => ({
    ...layer,
    id: `${prefix}-${layer.id}`,
    ...(zoomRange.maxzoom === undefined ? {} : { maxzoom: zoomRange.maxzoom }),
    ...(zoomRange.minzoom === undefined ? {} : { minzoom: zoomRange.minzoom })
  }));
}

function findOverlayAnchorId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

function currentBbox(map: MapLibreMap): BboxTuple {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as const;
}

function ensurePmtilesProtocol(maplibre: typeof import("maplibre-gl")) {
  if (pmtilesProtocolRegistered) {
    return;
  }

  maplibre.addProtocol("pmtiles", basemapProtocol.tile);
  pmtilesProtocolRegistered = true;
}
