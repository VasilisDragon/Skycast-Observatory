import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import clsx from "clsx";
import { WeatherMap } from "./WeatherMap";
import type { MapCamera, MapConfigResponse, ProjectionMode } from "../types";

interface MapExplorerProps {
  config: MapConfigResponse;
}

type LayerSelectionState = Record<string, boolean>;
type LayerOpacityState = Record<string, number>;
type LayerTimeState = Record<string, string | undefined>;

export function MapExplorer({ config }: MapExplorerProps) {
  const [activeLayers, setActiveLayers] = useState<LayerSelectionState>({});
  const [layerOpacities, setLayerOpacities] = useState<LayerOpacityState>({});
  const [layerTimes, setLayerTimes] = useState<LayerTimeState>({});
  const [focusedLayerId, setFocusedLayerId] = useState<string>("");
  const [projection, setProjection] = useState<ProjectionMode>("mercator");
  const [camera, setCamera] = useState<MapCamera>({
    latitude: config.centerLatitude,
    longitude: config.centerLongitude,
    zoom: config.defaultZoom
  });

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
  }, [config]);

  const focusedLayer = config.layers.find((layer) => layer.id === focusedLayerId) ?? config.layers[0];
  const visibleLayerSelections = config.layers
    .filter((layer) => activeLayers[layer.id])
    .map((layer) => ({
      id: layer.id,
      opacity: layerOpacities[layer.id] ?? layer.defaultOpacity,
      time: layerTimes[layer.id]
    }));

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

  return (
    <section id="explorer" className="space-y-6">
      <div className="storm-section-title">
        <div>
          <p className="storm-eyebrow">Map Explorer</p>
          <h2>Switch between local radar, forecast surfaces, hazards, and globe mode.</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="storm-button storm-button-secondary" onClick={() => setProjection("mercator")}>
            Flat map
          </button>
          <button type="button" className="storm-button storm-button-secondary" onClick={() => setProjection("globe")}>
            Globe
          </button>
          <button
            type="button"
            className="storm-button"
            onClick={() =>
              setCamera(homeCamera)
            }
          >
            Jump to my ZIP
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <aside className="storm-card p-5">
          <div>
            <p className="storm-eyebrow">View Presets</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <PresetButton
                label="Local radar"
                onClick={() => applyPreset([localRadarId], localRadarId, "mercator", setActiveLayers, setFocusedLayerId, setProjection, setCamera, config.centerLatitude, config.centerLongitude, 7.8)}
              />
              <PresetButton
                label="National"
                onClick={() => applyPreset(["conus-radar", "hazards"], "conus-radar", "globe", setActiveLayers, setFocusedLayerId, setProjection, setCamera, config.centerLatitude, config.centerLongitude, 3.8)}
              />
              <PresetButton
                label="Wind"
                onClick={() => applyPreset(["forecast-wind"], "forecast-wind", "mercator", setActiveLayers, setFocusedLayerId, setProjection, setCamera, 38.4, -97.2, 4)}
              />
              <PresetButton
                label="Precip"
                onClick={() => applyPreset(["forecast-pop", "hazards"], "forecast-pop", "mercator", setActiveLayers, setFocusedLayerId, setProjection, setCamera, 38.4, -97.2, 4)}
              />
              <PresetButton
                label="Globe sweep"
                onClick={() => applyPreset(["conus-radar", "hazards"], "conus-radar", "globe", setActiveLayers, setFocusedLayerId, setProjection, setCamera, 32, -98, 2.1)}
              />
            </div>
          </div>

          <div className="mt-6">
            <p className="storm-eyebrow">Layer Stack</p>
            <div className="mt-4 space-y-3">
              {config.layers.map((layer) => {
                const isActive = Boolean(activeLayers[layer.id]);
                return (
                  <div
                    key={layer.id}
                    role="button"
                    tabIndex={0}
                    className={clsx("storm-layer-row", isActive && "is-active", focusedLayerId === layer.id && "is-focused")}
                    onClick={() => {
                      setFocusedLayerId(layer.id);
                      toggleLayer(layer.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setFocusedLayerId(layer.id);
                        toggleLayer(layer.id);
                      }
                    }}
                  >
                    <div className="flex items-start gap-3 text-left">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          setFocusedLayerId(layer.id);
                          toggleLayer(layer.id, event.target.checked);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">{layer.title}</span>
                        <span className="block text-xs text-mist/60">{layer.description}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {focusedLayer ? (
            <div className="mt-6 space-y-5">
              <div>
                <p className="storm-eyebrow">Focused Layer</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{focusedLayer.title}</h3>
                <p className="mt-2 text-sm leading-6 text-mist/70">{focusedLayer.description}</p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-4 text-sm text-mist/70">
                  <span>Opacity</span>
                  <span>{Math.round((layerOpacities[focusedLayer.id] ?? focusedLayer.defaultOpacity) * 100)}%</span>
                </div>
                <input
                  className="storm-range mt-3"
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={Math.round((layerOpacities[focusedLayer.id] ?? focusedLayer.defaultOpacity) * 100)}
                  onChange={(event) =>
                    setLayerOpacities((current) => ({
                      ...current,
                      [focusedLayer.id]: Number(event.target.value) / 100
                    }))
                  }
                />
              </div>

              {focusedLayer.supportsTime && focusedLayer.times.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-4 text-sm text-mist/70">
                    <span>Timeline</span>
                    <span>{layerTimes[focusedLayer.id] ?? focusedLayer.times[focusedLayer.times.length - 1]}</span>
                  </div>
                  <input
                    className="storm-range mt-3"
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
                  />
                </div>
              ) : null}

              <div>
                <p className="storm-eyebrow">Legend</p>
                <div className="mt-3 space-y-2">
                  {focusedLayer.legend.map((entry) => (
                    <div key={entry.label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-3 text-mist/75">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
                        {entry.label}
                      </span>
                      <span className="text-mist/50">{focusedLayer.legendTitle}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        <WeatherMap
          config={config}
          projection={projection}
          camera={camera}
          layers={visibleLayerSelections}
          title="Explorer canvas"
          className="!min-h-[24rem] sm:!min-h-[30rem] lg:!min-h-[36rem] 2xl:!min-h-[42rem]"
        />
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
    zoom: config.supportsGlobe ? 3.8 : 5.4
  };
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="storm-chip-button" onClick={onClick}>
      {label}
    </button>
  );
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
