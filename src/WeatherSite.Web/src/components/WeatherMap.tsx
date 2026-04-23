import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import clsx from "clsx";
import { Protocol } from "pmtiles";
import type { MapCamera, MapConfigResponse, ProjectionMode } from "../types";

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
}

type RasterSourceLike = {
  setTiles?: (tiles: string[]) => void;
};

const locationSourceId = "saved-location";
const locationLayerId = "saved-location-layer";
const basemapProtocol = new Protocol();
let pmtilesProtocolRegistered = false;

export function WeatherMap({
  config,
  projection,
  camera,
  layers,
  interactive = true,
  className,
  title
}: WeatherMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const hasLocalBasemap = Boolean(config.worldPmtilesUrl || config.regionalPmtilesUrl);

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
          interactive,
          maxZoom: 12,
          minZoom: 1,
          pitch: 0,
          style: createMapStyle(config),
          zoom: camera.zoom
        });

        if (interactive) {
          map.addControl(new maplibre.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
        }

        map.on("load", () => {
          ensureLocationMarker(map, config);
          syncProjection(map, projection);
          syncLayers(map, config, layers);
        });

        map.on("error", (event) => {
          if (event.error) {
            setMapError("Live map rendering is unavailable in this browser session.");
          }
        });

        mapRef.current = map;
      } catch {
        setMapError("Live map rendering is unavailable in this browser session.");
      }
    }

    void initializeMap();

    return () => {
      disposed = true;
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

  return (
    <div className={clsx("storm-map-shell", className)}>
      <div className="storm-map-topline">
        <span>{title ?? "Live Weather View"}</span>
        {hasLocalBasemap ? <span>Local basemap pack ready</span> : <span>Fallback streets basemap</span>}
      </div>
      <div ref={containerRef} className="storm-map-canvas" />
      <div className="storm-map-wash" />
      {mapError ? <div className="storm-map-empty">{mapError}</div> : null}
      {!hasLocalBasemap ? (
        <div className="storm-map-note">
          OpenStreetMap fallback is active for geographic reference until local PMTiles basemaps are installed.
        </div>
      ) : null}
    </div>
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
        "background-color": "#8dc5e8"
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
      type: "raster"
    };

    layers.push({
      id: "fallback-basemap",
      source: "fallback-basemap",
      type: "raster",
      paint: {
        "raster-opacity": 1,
        "raster-saturation": -0.18
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

function syncProjection(map: MapLibreMap, projection: ProjectionMode) {
  map.setProjection({ type: projection });
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

  if (!map.getLayer(locationLayerId)) {
    map.addLayer({
      id: locationLayerId,
      source: locationSourceId,
      type: "circle",
      paint: {
        "circle-color": "#8ef4ff",
        "circle-radius": 5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
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
        tileSize: 256
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

function ensurePmtilesProtocol(maplibre: typeof import("maplibre-gl")) {
  if (pmtilesProtocolRegistered) {
    return;
  }

  maplibre.addProtocol("pmtiles", basemapProtocol.tile);
  pmtilesProtocolRegistered = true;
}
