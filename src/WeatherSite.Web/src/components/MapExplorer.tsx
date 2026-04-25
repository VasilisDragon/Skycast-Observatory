import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import clsx from "clsx";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapCamera, MapConfigResponse, ProjectionMode } from "../types";
import type { BboxTuple } from "../aviation/types";
import { useAviationOverlay } from "../aviation/overlay-state";
import { AviationLayerToggleGroup } from "../aviation/AviationLayerToggleGroup";
import { useUnits } from "../lib/use-units";
import { clearAviationFocusFromUrl } from "../aviation/cross-surface-link";

const WeatherMap = lazy(() =>
  import("./WeatherMap").then((module) => ({ default: module.WeatherMap }))
);

// Lazy boundary for the aviation map controller. The controller statically
// imports maplibre-gl's Popup ctor, so keeping this load behind the atlas
// mount point prevents maplibre-gl from entering the consumer-app initial
// bundle (which would stall hydration on cold loads).
const AviationOverlayController = lazy(() =>
  import("../aviation/AviationOverlayController").then((module) => ({
    default: module.AviationOverlayController
  }))
);

interface MapExplorerProps {
  config: MapConfigResponse;
  // Optional cross-surface focus from /aviation/:icao → /?aviation=ICAO.
  // When set, the explorer enables the aviation overlay, centers camera on
  // the airport, and renders a halo on its station dot.
  focusedAirportIcao?: string | null;
  onFocusConsumed?: () => void;
}

type LayerSelectionState = Record<string, boolean>;
type LayerOpacityState = Record<string, number>;
type LayerTimeState = Record<string, string | undefined>;

const CHANNELS: Array<{
  id: "A" | "B" | "C" | "D" | "E";
  label: string;
  preset: "local" | "national" | "wind" | "precip" | "globe";
}> = [
  { id: "A", label: "Local", preset: "local" },
  { id: "B", label: "CONUS", preset: "national" },
  { id: "C", label: "Wind", preset: "wind" },
  { id: "D", label: "Precip", preset: "precip" },
  { id: "E", label: "Globe", preset: "globe" }
];

export function MapExplorer({ config, focusedAirportIcao, onFocusConsumed }: MapExplorerProps) {
  const [activeLayers, setActiveLayers] = useState<LayerSelectionState>({});
  const [layerOpacities, setLayerOpacities] = useState<LayerOpacityState>({});
  const [layerTimes, setLayerTimes] = useState<LayerTimeState>({});
  const [focusedLayerId, setFocusedLayerId] = useState<string>("");
  const [projection, setProjection] = useState<ProjectionMode>("mercator");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [activeChannel, setActiveChannel] = useState<"A" | "B" | "C" | "D" | "E">("B");
  const [camera, setCamera] = useState<MapCamera>({
    latitude: config.centerLatitude,
    longitude: config.centerLongitude,
    zoom: config.defaultZoom
  });
  // Aviation overlay state — the master toggle defaults to OFF so consumer
  // users loading the atlas don't see aviation features unless they ask.
  const overlay = useAviationOverlay();
  const [units] = useUnits();
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [bbox, setBbox] = useState<BboxTuple | null>(null);
  // Live zoom tracks the map's animating zoom frame-by-frame so the scale
  // and zoom readouts follow the easeTo animation instead of snapping to
  // the target the moment camera state commits. `null` until the map is
  // ready; consumers fall back to `camera.zoom`.
  const [liveZoom, setLiveZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => setLiveZoom(mapInstance.getZoom());
    mapInstance.on("zoom", handler);
    setLiveZoom(mapInstance.getZoom());
    return () => {
      mapInstance.off("zoom", handler);
    };
  }, [mapInstance]);

  const displayZoom = liveZoom ?? camera.zoom;

  useEffect(() => {
    const nextActiveLayers = buildDefaultActiveLayers(config);
    const nextLayerOpacities = Object.fromEntries(
      config.layers.map((layer) => [layer.id, layer.defaultOpacity])
    ) as LayerOpacityState;
    const nextLayerTimes = Object.fromEntries(
      config.layers.map((layer) => [layer.id, layer.times[layer.times.length - 1]])
    ) as LayerTimeState;

    setActiveLayers(nextActiveLayers);
    setLayerOpacities(nextLayerOpacities);
    setLayerTimes(nextLayerTimes);
    setFocusedLayerId(getDefaultFocusedLayerId(config));
    setProjection(config.supportsGlobe ? "globe" : "mercator");
    setCamera(getDefaultExplorerCamera(config));
    setActiveChannel("B");
  }, [config]);

  // Cross-surface focus: when /aviation/:icao → /?aviation=ICAO arrives, fetch
  // the airport once, jump camera to it, and enable the stations overlay so
  // the dot is visible. Hazards/PIREPs stay opt-in to keep the jump light.
  useEffect(() => {
    if (!focusedAirportIcao) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/aviation/airports/${encodeURIComponent(focusedAirportIcao)}`,
          { credentials: "same-origin" }
        );
        if (!response.ok || cancelled) return;
        const airport = await response.json() as { latitude: number; longitude: number };
        if (cancelled) return;
        setCamera({ latitude: airport.latitude, longitude: airport.longitude, zoom: 8.5 });
        overlay.toggleLayer("stations", true);
        // Drop the URL param so a refresh doesn't re-jump; preserve scroll.
        clearAviationFocusFromUrl();
        onFocusConsumed?.();
      } catch {
        /* silent — non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedAirportIcao]);

  const focusedLayer =
    config.layers.find((layer) => layer.id === focusedLayerId) ?? config.layers[0];
  // Memoized: WeatherMap's layer-sync effect uses this array in its deps.
  // A fresh reference on every render would re-fire that effect and could
  // indirectly interrupt user gestures.
  const visibleLayerSelections = useMemo(
    () =>
      config.layers
        .filter((layer) => activeLayers[layer.id])
        .map((layer) => ({
          id: layer.id,
          opacity: layerOpacities[layer.id] ?? layer.defaultOpacity,
          time: layerTimes[layer.id]
        })),
    [config.layers, activeLayers, layerOpacities, layerTimes]
  );

  const focusedTimeIndex =
    focusedLayer?.times.findIndex((time) => time === layerTimes[focusedLayer.id]) ?? -1;

  const localRadarId =
    config.layers.find((layer) => layer.id.startsWith("local-radar-"))?.id ?? "conus-radar";
  const homeCamera = getDefaultExplorerCamera(config);

  function toggleLayer(layerId: string, nextValue?: boolean) {
    setActiveLayers((current) => ({
      ...current,
      [layerId]: nextValue ?? !current[layerId]
    }));
  }

  const applyChannel = useCallback(
    (channel: "A" | "B" | "C" | "D" | "E") => {
      setActiveChannel(channel);
      switch (channel) {
        case "A":
          applyPreset(
            [localRadarId],
            localRadarId,
            "mercator",
            setActiveLayers,
            setFocusedLayerId,
            setProjection,
            setCamera,
            config.centerLatitude,
            config.centerLongitude,
            7.8
          );
          break;
        case "B":
          applyPreset(
            ["conus-radar", "hazards"],
            "conus-radar",
            "mercator",
            setActiveLayers,
            setFocusedLayerId,
            setProjection,
            setCamera,
            config.centerLatitude,
            config.centerLongitude,
            4.2
          );
          break;
        case "C":
          applyPreset(
            ["forecast-wind"],
            "forecast-wind",
            "mercator",
            setActiveLayers,
            setFocusedLayerId,
            setProjection,
            setCamera,
            38.4,
            -97.2,
            4
          );
          break;
        case "D":
          applyPreset(
            ["forecast-pop", "hazards"],
            "forecast-pop",
            "mercator",
            setActiveLayers,
            setFocusedLayerId,
            setProjection,
            setCamera,
            38.4,
            -97.2,
            4
          );
          break;
        case "E":
          applyPreset(
            ["conus-radar", "hazards"],
            "conus-radar",
            "globe",
            setActiveLayers,
            setFocusedLayerId,
            setProjection,
            setCamera,
            32,
            -98,
            2.1
          );
          break;
      }
    },
    [
      localRadarId,
      config.centerLatitude,
      config.centerLongitude
    ]
  );

  return (
    <section id="explorer" className="obs-atlas scroll-mt-28">
      <div className="obs-atlas-head">
        <div className="obs-atlas-title">
          <h2>Map Atlas</h2>
          <p>
            <span className="text-phos">● </span>
            KLOT live radar · CONUS composite · forecast surfaces · active hazards · globe mode
          </p>
        </div>
        <div className="obs-section-controls">
          <div className="obs-segment" role="group" aria-label="Map projection">
            <button
              type="button"
              className={clsx(projection === "mercator" && "is-active")}
              onClick={() => setProjection("mercator")}
              aria-pressed={projection === "mercator"}
            >
              Flat
            </button>
            <button
              type="button"
              className={clsx(projection === "globe" && "is-active")}
              onClick={() => setProjection("globe")}
              disabled={!config.supportsGlobe}
              aria-pressed={projection === "globe"}
            >
              Globe
            </button>
          </div>
          <button
            type="button"
            className="obs-btn"
            onClick={() => {
              setCamera(homeCamera);
              setActiveChannel("B");
            }}
          >
            ⌘ Jump to ZIP
          </button>
        </div>
      </div>

      <div className="obs-atlas-stage">
        <Suspense fallback={<div className="obs-atlas-canvas" aria-hidden="true" />}>
          <WeatherMap
            className="obs-atlas-canvas"
            config={config}
            projection={projection}
            camera={camera}
            layers={visibleLayerSelections}
            title="Atlas canvas"
            onCameraChange={setCamera}
            onMapReady={setMapInstance}
            onBboxChange={setBbox}
          />
        </Suspense>

        {/* Only mount the overlay controller once the map instance is ready.
            The Suspense fallback is `null` because the controller itself is
            headless (its UI manifests through MapLibre layers, not DOM). */}
        {mapInstance ? (
          <Suspense fallback={null}>
            <AviationOverlayController
              map={mapInstance}
              overlay={overlay}
              units={units}
              bbox={bbox}
              focusedIcao={focusedAirportIcao ?? null}
            />
          </Suspense>
        ) : null}

        <div className="obs-atlas-channels" role="group" aria-label="Map channel selector">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={clsx("obs-channel", activeChannel === ch.id && "is-active")}
              onClick={() => applyChannel(ch.id)}
              aria-pressed={activeChannel === ch.id}
            >
              <span className="obs-channel-prefix">CH·{ch.id}</span>
              <span>{ch.label}</span>
            </button>
          ))}
        </div>

        <div className="obs-atlas-coord" aria-hidden="true">
          <span>LAT · LON</span>
          <b>{config.centerLatitude.toFixed(3)}° · {config.centerLongitude.toFixed(3)}°</b>
          <span>ZOOM · PROJ</span>
          <b>{displayZoom.toFixed(1)} · {projection.toUpperCase()}</b>
        </div>

        <div className="obs-atlas-scale" aria-label="Map scale">
          <span>Scale</span>
          <div className="obs-atlas-scale-bar" />
          <span>~{approximateScaleKm(displayZoom, camera.latitude)} km</span>
        </div>

        <aside className={clsx("obs-atlas-panel", isPanelOpen ? "is-open" : "is-collapsed")}>
          <header className="obs-atlas-panel-head">
            <span className="obs-label obs-label-phos">│ Layer Stack</span>
            <button
              type="button"
              className="obs-atlas-panel-toggle"
              aria-label={isPanelOpen ? "Collapse layer panel" : "Expand layer panel"}
              aria-expanded={isPanelOpen}
              aria-controls="obs-atlas-panel-body"
              onClick={() => setIsPanelOpen((prev) => !prev)}
            >
              {isPanelOpen ? "–" : "+"}
            </button>
          </header>

          {isPanelOpen ? (
            <div id="obs-atlas-panel-body" className="obs-atlas-panel-body">
              {config.layers.map((layer) => {
                const isActive = Boolean(activeLayers[layer.id]);
                const isFocused = focusedLayerId === layer.id;
                return (
                  <button
                    key={layer.id}
                    type="button"
                    className={clsx(
                      "obs-layer-row",
                      isActive && "is-active",
                      isFocused && "is-focused"
                    )}
                    aria-pressed={isActive}
                    onClick={() => {
                      setFocusedLayerId(layer.id);
                      toggleLayer(layer.id);
                    }}
                  >
                    <span className="obs-layer-check" aria-hidden="true">
                      {isActive ? "✓" : ""}
                    </span>
                    <span className="obs-layer-meta">
                      <span className="obs-layer-title">{layer.title}</span>
                      <span className="obs-layer-desc">{layer.description}</span>
                    </span>
                  </button>
                );
              })}

              {focusedLayer ? (
                <div className="obs-focus">
                  <div className="obs-focus-row">
                    <div className="obs-focus-row-label">
                      <span>Opacity</span>
                      <b>
                        {Math.round(
                          (layerOpacities[focusedLayer.id] ?? focusedLayer.defaultOpacity) *
                            100
                        )}%
                      </b>
                    </div>
                    <input
                      className="obs-range"
                      type="range"
                      min="10"
                      max="100"
                      step="1"
                      value={Math.round(
                        (layerOpacities[focusedLayer.id] ?? focusedLayer.defaultOpacity) * 100
                      )}
                      onChange={(event) =>
                        setLayerOpacities((current) => ({
                          ...current,
                          [focusedLayer.id]: Number(event.target.value) / 100
                        }))
                      }
                      aria-label={`${focusedLayer.title} opacity`}
                    />
                  </div>

                  {focusedLayer.supportsTime && focusedLayer.times.length > 0 ? (
                    <div className="obs-focus-row">
                      <div className="obs-focus-row-label">
                        <span>Timeline</span>
                        <b>{layerTimes[focusedLayer.id] ?? focusedLayer.times[focusedLayer.times.length - 1]}</b>
                      </div>
                      <input
                        className="obs-range"
                        type="range"
                        min="0"
                        max={Math.max(focusedLayer.times.length - 1, 0)}
                        step="1"
                        value={Math.max(focusedTimeIndex, 0)}
                        onChange={(event) => {
                          const nextIndex = Number(event.target.value);
                          setLayerTimes((current) => ({
                            ...current,
                            [focusedLayer.id]: focusedLayer.times[nextIndex]
                          }));
                        }}
                        aria-label={`${focusedLayer.title} timeline`}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {focusedLayer && focusedLayer.legend.length > 0 ? (
                <div className="obs-legend">
                  <span className="obs-label">{focusedLayer.legendTitle ?? "Legend"}</span>
                  <ul className="obs-legend-list">
                    {focusedLayer.legend.map((entry) => (
                      <li key={entry.label} className="obs-legend-item">
                        <span
                          className="obs-legend-swatch"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span>{entry.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <AviationLayerToggleGroup overlay={overlay} />
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function buildDefaultActiveLayers(config: MapConfigResponse): LayerSelectionState {
  const defaultIds = new Set<string>();
  if (config.layers.some((layer) => layer.id === "conus-radar")) {
    defaultIds.add("conus-radar");
  }

  if (config.layers.some((layer) => layer.id === "hazards")) {
    defaultIds.add("hazards");
  }

  if (defaultIds.size === 0) {
    const fallbackLayer =
      config.layers.find((layer) => layer.id.startsWith("local-radar-"))
      ?? config.layers.find((layer) => layer.defaultVisible)
      ?? config.layers[0];

    if (fallbackLayer) {
      defaultIds.add(fallbackLayer.id);
    }
  }

  return Object.fromEntries(
    config.layers.map((layer) => [layer.id, defaultIds.has(layer.id)])
  ) as LayerSelectionState;
}

function getDefaultFocusedLayerId(config: MapConfigResponse): string {
  return (
    config.layers.find((layer) => layer.id === "conus-radar")?.id
    ?? config.layers.find((layer) => layer.id === "hazards")?.id
    ?? config.layers.find((layer) => layer.id.startsWith("local-radar-"))?.id
    ?? config.layers[0]?.id
    ?? ""
  );
}

function getDefaultExplorerCamera(config: MapConfigResponse): MapCamera {
  return {
    latitude: config.centerLatitude,
    longitude: config.centerLongitude,
    zoom: config.supportsGlobe ? 4.2 : 5.4
  };
}

function approximateScaleKm(zoom: number, latitude: number): number {
  // Mercator ground resolution for a 5rem (~80px) scale bar
  const earthCirc = 40075.017; // km at equator
  const metersPerPx = (earthCirc * 1000 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom + 8);
  const km = (metersPerPx * 80) / 1000;
  if (km < 1) return Number((km * 10).toFixed(0)) / 10;
  if (km < 10) return Number(km.toFixed(1));
  return Math.round(km);
}

function applyPreset(
  ids: string[],
  focusedId: string,
  projection: ProjectionMode,
  setActiveLayers: Dispatch<SetStateAction<LayerSelectionState>>,
  setFocusedLayerId: Dispatch<SetStateAction<string>>,
  setProjection: Dispatch<SetStateAction<ProjectionMode>>,
  setCamera: Dispatch<SetStateAction<MapCamera>>,
  latitude: number,
  longitude: number,
  zoom: number
) {
  setActiveLayers((current) => {
    const nextEntries = Object.keys(current).map((key) => [key, ids.includes(key)] as const);
    return Object.fromEntries(nextEntries) as LayerSelectionState;
  });
  setFocusedLayerId(focusedId);
  setProjection(projection);
  setCamera({ latitude, longitude, zoom });
}
