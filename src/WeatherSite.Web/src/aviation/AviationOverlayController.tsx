import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Feature, Point, Polygon } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { Popup as MapLibrePopup } from "maplibre-gl";
import { getHazards, getPireps, getStationsInBbox } from "./api";
import { useSnappedDebouncedBbox } from "./bbox-utils";
import { mountAviationPopup } from "./popup-mount";
import { StationPopup } from "./popups/StationPopup";
import { HazardPopup } from "./popups/HazardPopup";
import { PirepPopup } from "./popups/PirepPopup";
import type { AviationOverlayApi } from "./overlay-state";
import type {
  BboxTuple,
  HazardFeatureDto,
  PirepPointDto,
  StationsBboxEntry,
  StationsBboxResponse
} from "./types";
import type { UnitSystem } from "../types";

// Source / layer IDs grouped so we can iterate cleanly on cleanup.
const SOURCE_STATIONS = "avn-stations-src";
const LAYER_STATIONS_HALO = "avn-stations-halo";
const LAYER_STATIONS_DOT = "avn-stations-dot";

const SOURCE_HAZARDS = "avn-hazards-src";
const LAYER_HAZARDS_FILL = "avn-hazards-fill";
const LAYER_HAZARDS_OUTLINE = "avn-hazards-outline";

const SOURCE_PIREPS = "avn-pireps-src";
const LAYER_PIREPS_DOT = "avn-pireps-dot";
const LAYER_PIREPS_GLYPH = "avn-pireps-glyph";

const ALL_LAYERS = [
  LAYER_STATIONS_HALO,
  LAYER_STATIONS_DOT,
  LAYER_HAZARDS_FILL,
  LAYER_HAZARDS_OUTLINE,
  LAYER_PIREPS_DOT,
  LAYER_PIREPS_GLYPH
];
const ALL_SOURCES = [SOURCE_STATIONS, SOURCE_HAZARDS, SOURCE_PIREPS];

// Convective SIGMETs occasionally span ~10° × 10° or more. Below that bbox
// area we keep the 12% fill that gives the polygon visual weight; above it,
// we drop to outline-only so the polygon doesn't wash the basemap. Threshold
// in square degrees — kept tunable here so we can revisit.
const LARGE_POLYGON_AREA_SQ_DEG = 100;

export interface AviationOverlayControllerProps {
  map: MapLibreMap | null;
  overlay: AviationOverlayApi;
  units: UnitSystem;
  bbox: BboxTuple | null;
  // Optional pre-focused ICAO — when set, we render an extra highlight ring
  // on that station's dot so a /aviation/KORD → "View on map" jump lands
  // with visual emphasis.
  focusedIcao?: string | null;
  // Optional MapLibre PopupCtor — defaults to runtime-imported maplibregl.Popup.
  // Tests can inject a stub.
  popupCtor?: () => unknown;
}

export function AviationOverlayController({
  map,
  overlay,
  units,
  bbox,
  focusedIcao
}: AviationOverlayControllerProps) {
  const stationsBbox = useSnappedDebouncedBbox(overlay.enabledStations ? bbox : null, {
    delayMs: 400
  });

  const [stations, setStations] = useState<StationsBboxResponse | null>(null);
  const [hazards, setHazards] = useState<HazardFeatureDto[]>([]);
  const [pireps, setPireps] = useState<PirepPointDto[]>([]);
  const [tooManyStations, setTooManyStations] = useState(false);

  // Stations data fetch — debounced + snap-grid keyed.
  useEffect(() => {
    if (!stationsBbox || !overlay.enabledStations) {
      setStations(null);
      setTooManyStations(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await getStationsInBbox(stationsBbox, { signal: controller.signal });
        if (cancelled) return;
        setStations(res);
        setTooManyStations(res.truncated);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Silent failure on the map surface — the layer panel UI surfaces
        // status separately. Don't pollute the map with toasts.
        if (cancelled) return;
        console.warn("Aviation stations fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [stationsBbox, overlay.enabledStations]);

  // Hazards fetch (all 3 kinds) — fired only when the layer is on. Polled at
  // 5-minute intervals to pick up new SIGMETs without forcing a manual reload.
  useEffect(() => {
    if (!overlay.enabledHazards) {
      setHazards([]);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const fetchAll = async () => {
      try {
        const [airmet, sigmet, cwa] = await Promise.all([
          getHazards("airmet").catch(() => null),
          getHazards("sigmet").catch(() => null),
          getHazards("cwa").catch(() => null)
        ]);
        if (cancelled) return;
        const all = [
          ...(airmet?.features ?? []),
          ...(sigmet?.features ?? []),
          ...(cwa?.features ?? [])
        ];
        setHazards(all);
      } catch (err) {
        if (cancelled) return;
        console.warn("Aviation hazards fetch failed", err);
      }
    };
    void fetchAll();
    timer = window.setInterval(fetchAll, 5 * 60_000);
    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [overlay.enabledHazards]);

  // PIREPs fetch — anchored to bbox center with a generous radius. Re-fires
  // when the bbox changes appreciably (snap-grid coalesces).
  const pirepAnchor = useMemo(() => deriveCenter(stationsBbox ?? bbox), [stationsBbox, bbox]);
  useEffect(() => {
    if (!overlay.enabledPireps || !pirepAnchor) {
      setPireps([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getPireps(pirepAnchor[0], pirepAnchor[1], 300);
        if (cancelled) return;
        setPireps(res.features);
      } catch (err) {
        if (cancelled) return;
        console.warn("Aviation PIREPs fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [overlay.enabledPireps, pirepAnchor]);

  // Once-on-mount layer scaffolding. Sources start empty; we update via
  // setData on each fetch so MapLibre re-renders without thrash.
  const layerScaffoldedRef = useRef(false);
  useEffect(() => {
    if (!map || layerScaffoldedRef.current) return;
    scaffoldLayers(map);
    layerScaffoldedRef.current = true;
    return () => {
      teardownLayers(map);
      layerScaffoldedRef.current = false;
    };
  }, [map]);

  // Push station data into the source whenever it changes.
  useEffect(() => {
    if (!map || !layerScaffoldedRef.current) return;
    setSourceData(map, SOURCE_STATIONS, buildStationFeatures(stations?.stations ?? [], focusedIcao ?? null));
    toggleLayers(map, [LAYER_STATIONS_HALO, LAYER_STATIONS_DOT], overlay.enabledStations);
  }, [map, stations, overlay.enabledStations, focusedIcao]);

  // Push hazard data into the source whenever data or time-slice changes.
  useEffect(() => {
    if (!map || !layerScaffoldedRef.current) return;
    const filtered = filterHazardsForTimeSlice(hazards, overlay.timeSliceHours);
    setSourceData(map, SOURCE_HAZARDS, buildHazardFeatures(filtered));
    toggleLayers(map, [LAYER_HAZARDS_FILL, LAYER_HAZARDS_OUTLINE], overlay.enabledHazards);
  }, [map, hazards, overlay.enabledHazards, overlay.timeSliceHours]);

  // Push PIREP data into the source whenever it changes.
  useEffect(() => {
    if (!map || !layerScaffoldedRef.current) return;
    setSourceData(map, SOURCE_PIREPS, buildPirepFeatures(pireps));
    toggleLayers(map, [LAYER_PIREPS_DOT, LAYER_PIREPS_GLYPH], overlay.enabledPireps);
  }, [map, pireps, overlay.enabledPireps]);

  // Click handlers — one per feature class. Effect re-runs when `units` changes
  // so popups always render with the current unit preference.
  useEffect(() => {
    if (!map || !layerScaffoldedRef.current) return;

    const stationByIcao = new Map<string, StationsBboxEntry>(
      (stations?.stations ?? []).map((s) => [s.airport.icao, s])
    );
    const hazardById = new Map<string, HazardFeatureDto>(hazards.map((h) => [h.id, h]));
    const pirepById = new Map<string, PirepPointDto>(pireps.map((p) => [p.id, p]));

    const onStationClick = (event: MapMouseEvent & { features?: Feature[] }) => {
      const feature = event.features?.[0];
      const icao = feature?.properties?.icao as string | undefined;
      if (!icao) return;
      const station = stationByIcao.get(icao);
      if (!station) return;
      mountAviationPopup({
        createPopup: makeMaplibrePopupCtor(),
        map,
        lngLat: [station.airport.longitude, station.airport.latitude],
        render: ({ onClose: _onClose }) => (
          <StationPopup station={station} units={units} />
        ),
        initialProps: {}
      });
    };

    const onHazardClick = (event: MapMouseEvent & { features?: Feature[] }) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const hazard = hazardById.get(id);
      if (!hazard) return;
      mountAviationPopup({
        createPopup: makeMaplibrePopupCtor(),
        map,
        lngLat: [event.lngLat.lng, event.lngLat.lat],
        render: ({ onClose: _onClose }) => <HazardPopup hazard={hazard} />,
        initialProps: {}
      });
    };

    const onPirepClick = (event: MapMouseEvent & { features?: Feature[] }) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const pirep = pirepById.get(id);
      if (!pirep) return;
      mountAviationPopup({
        createPopup: makeMaplibrePopupCtor(),
        map,
        lngLat: [pirep.longitude, pirep.latitude],
        render: ({ onClose: _onClose }) => <PirepPopup pirep={pirep} />,
        initialProps: {}
      });
    };

    map.on("click", LAYER_STATIONS_DOT, onStationClick);
    map.on("click", LAYER_HAZARDS_FILL, onHazardClick);
    map.on("click", LAYER_HAZARDS_OUTLINE, onHazardClick);
    map.on("click", LAYER_PIREPS_DOT, onPirepClick);

    // Cursor hint on hover. Cooperative gestures are unaffected — we only
    // change the cursor when over an interactive layer.
    const setPointer = () => map.getCanvas().style.setProperty("cursor", "pointer");
    const clearPointer = () => map.getCanvas().style.setProperty("cursor", "");
    map.on("mouseenter", LAYER_STATIONS_DOT, setPointer);
    map.on("mouseleave", LAYER_STATIONS_DOT, clearPointer);
    map.on("mouseenter", LAYER_HAZARDS_FILL, setPointer);
    map.on("mouseleave", LAYER_HAZARDS_FILL, clearPointer);
    map.on("mouseenter", LAYER_PIREPS_DOT, setPointer);
    map.on("mouseleave", LAYER_PIREPS_DOT, clearPointer);

    return () => {
      map.off("click", LAYER_STATIONS_DOT, onStationClick);
      map.off("click", LAYER_HAZARDS_FILL, onHazardClick);
      map.off("click", LAYER_HAZARDS_OUTLINE, onHazardClick);
      map.off("click", LAYER_PIREPS_DOT, onPirepClick);
      map.off("mouseenter", LAYER_STATIONS_DOT, setPointer);
      map.off("mouseleave", LAYER_STATIONS_DOT, clearPointer);
      map.off("mouseenter", LAYER_HAZARDS_FILL, setPointer);
      map.off("mouseleave", LAYER_HAZARDS_FILL, clearPointer);
      map.off("mouseenter", LAYER_PIREPS_DOT, setPointer);
      map.off("mouseleave", LAYER_PIREPS_DOT, clearPointer);
    };
  }, [map, stations, hazards, pireps, units]);

  // Truncation hint (rendered above the map by the parent if needed).
  // The component itself is otherwise headless.
  return tooManyStations ? (
    <div className="obs-aviation-truncation-hint" role="status" aria-live="polite">
      ▲ Too many stations ({stations?.totalInBbox} in view, showing top {stations?.stations.length}). Zoom in for the rest.
    </div>
  ) : null;
}

// ---------------------------------------------------------------------------
// MapLibre helpers — mostly source/layer add/setData orchestration.

function scaffoldLayers(map: MapLibreMap) {
  const anchor = findAviationAnchorId(map);

  // Sources — empty FeatureCollections, populated via setData.
  if (!map.getSource(SOURCE_STATIONS)) {
    map.addSource(SOURCE_STATIONS, { type: "geojson", data: emptyFc() });
  }
  if (!map.getSource(SOURCE_HAZARDS)) {
    map.addSource(SOURCE_HAZARDS, { type: "geojson", data: emptyFc() });
  }
  if (!map.getSource(SOURCE_PIREPS)) {
    map.addSource(SOURCE_PIREPS, { type: "geojson", data: emptyFc() });
  }

  // Hazards underneath stations/PIREPs so the colored polygons read as a
  // backdrop, not foreground noise.
  if (!map.getLayer(LAYER_HAZARDS_FILL)) {
    map.addLayer({
      id: LAYER_HAZARDS_FILL,
      source: SOURCE_HAZARDS,
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["get", "fillOpacity"]
      }
    }, anchor);
  }
  if (!map.getLayer(LAYER_HAZARDS_OUTLINE)) {
    map.addLayer({
      id: LAYER_HAZARDS_OUTLINE,
      source: SOURCE_HAZARDS,
      type: "line",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.5,
        "line-opacity": 0.85
      }
    }, anchor);
  }

  // Stations — halo for the focused ICAO sits below the regular dot so it
  // reads as a ring around it.
  if (!map.getLayer(LAYER_STATIONS_HALO)) {
    map.addLayer({
      id: LAYER_STATIONS_HALO,
      source: SOURCE_STATIONS,
      type: "circle",
      filter: ["==", ["get", "focused"], true],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": 12,
        "circle-stroke-color": "#86E1A0",
        "circle-stroke-opacity": 0.85,
        "circle-stroke-width": 2
      }
    }, anchor);
  }
  if (!map.getLayer(LAYER_STATIONS_DOT)) {
    map.addLayer({
      id: LAYER_STATIONS_DOT,
      source: SOURCE_STATIONS,
      type: "circle",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3, 3,
          7, 5,
          10, 7
        ],
        "circle-stroke-color": "#06090D",
        "circle-stroke-width": 1.2
      }
    }, anchor);
  }

  // PIREPs — backing dot + glyph (T/I/*). Symbol layer requires a sprite for
  // the glyph; we render text instead via text-field which uses the basemap
  // glyphs already loaded by the protomaps style.
  if (!map.getLayer(LAYER_PIREPS_DOT)) {
    map.addLayer({
      id: LAYER_PIREPS_DOT,
      source: SOURCE_PIREPS,
      type: "circle",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["get", "radius"],
        "circle-opacity": ["get", "ageOpacity"],
        "circle-stroke-color": "#06090D",
        "circle-stroke-width": 1
      }
    }, anchor);
  }
  if (!map.getLayer(LAYER_PIREPS_GLYPH)) {
    map.addLayer({
      id: LAYER_PIREPS_GLYPH,
      source: SOURCE_PIREPS,
      type: "symbol",
      layout: {
        "text-field": ["get", "glyph"],
        "text-size": 9,
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: {
        "text-color": "#06090D",
        "text-opacity": ["get", "ageOpacity"]
      }
    }, anchor);
  }
}

function teardownLayers(map: MapLibreMap) {
  // Teardown runs in a React cleanup. If the parent unmount disposed the
  // MapLibre instance first (map.remove() nulls map.style internally), any
  // subsequent getLayer/getSource call reaches through undefined and throws
  // "Cannot read properties of undefined (reading 'getLayer')". Layers and
  // sources are gone with the map in that case — nothing left to clean up —
  // so swallow and exit. Race-proof; a liveness check between guard and call
  // could still lose to an async dispose.
  try {
    for (const layerId of ALL_LAYERS) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    for (const sourceId of ALL_SOURCES) {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  } catch {
    // See comment above.
  }
}

function setSourceData(map: MapLibreMap, sourceId: string, data: FeatureCollection) {
  const source = map.getSource(sourceId) as { setData?: (data: FeatureCollection) => void } | undefined;
  source?.setData?.(data);
}

function toggleLayers(map: MapLibreMap, layerIds: string[], visible: boolean) {
  for (const id of layerIds) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

// Anchor: aviation overlay sits ABOVE existing consumer overlays (radar,
// hazards, wind, clouds, precip — all of which are inserted before the first
// symbol layer of the basemap by `findOverlayAnchorId`) but BELOW the basemap
// symbol layers (place names, road labels). We pin to the same first-symbol
// anchor as consumer layers; ordering between consumer and aviation is then
// controlled by add-order — aviation is added after, so it stacks on top.
function findAviationAnchorId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

function emptyFc(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// ---------------------------------------------------------------------------
// Feature builders — pure transforms from API DTOs to GeoJSON paint props.

const CATEGORY_COLOR: Record<string, string> = {
  VFR: "#86E1A0",
  MVFR: "#7CD3FF",
  IFR: "#F76B6B",
  LIFR: "#D78AE0",
  UNKN: "#788796"
};

function buildStationFeatures(
  stations: StationsBboxEntry[],
  focusedIcao: string | null
): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const s of stations) {
    const cat = s.latest?.flightCategory.category ?? "UNKN";
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [s.airport.longitude, s.airport.latitude]
      },
      properties: {
        icao: s.airport.icao,
        category: cat,
        color: CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.UNKN,
        focused: focusedIcao === s.airport.icao
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function buildHazardFeatures(hazards: HazardFeatureDto[]): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const h of hazards) {
    if (h.polygonLatLon.length < 3) continue;
    const ring = h.polygonLatLon.map(([lat, lon]) => [lon, lat] as [number, number]);
    // Close ring if upstream didn't.
    if (ring.length > 0) {
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    }
    const isLargeArea = polygonAreaSqDeg(ring) > LARGE_POLYGON_AREA_SQ_DEG;
    const tone = hazardTone(h.kind);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: h.id,
        kind: h.kind,
        color: tone.color,
        // Cap fill on very large polygons so a CONUS-wide convective SIGMET
        // doesn't dominate the basemap. Outline is always drawn at full
        // opacity so the shape still reads.
        fillOpacity: isLargeArea ? 0 : tone.fillOpacity
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function hazardTone(kind: string): { color: string; fillOpacity: number } {
  const upper = (kind ?? "").toUpperCase();
  if (upper === "SIGMET") return { color: "#F76B6B", fillOpacity: 0.12 };
  if (upper === "CWA")    return { color: "#E8B770", fillOpacity: 0.06 };
  // Default / AIRMET — uses the warn token (amber-leaning, distinct from CWA's pure amber).
  return { color: "#E8B770", fillOpacity: 0.08 };
}

function polygonAreaSqDeg(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return Math.max(0, (east - west) * (north - south));
}

function buildPirepFeatures(pireps: PirepPointDto[]): FeatureCollection<Point> {
  const now = Date.now();
  const features: Feature<Point>[] = [];
  for (const p of pireps) {
    const ageMin = ageMinutes(p.observedAtUtc, now);
    const fresh = ageMin == null || ageMin <= 120;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      properties: {
        id: p.id,
        glyph: pirepGlyph(p),
        color: pirepColor(p),
        radius: pirepRadius(p),
        // Stale (>2h) PIREPs render at 40% opacity per spec. Don't drop them —
        // the user wants to see the historical context.
        ageOpacity: fresh ? 1.0 : 0.4
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function pirepGlyph(p: PirepPointDto): string {
  if (p.turbulenceIntensity) return "T";
  if (p.icingIntensity) return "I";
  return "·";
}

function pirepColor(p: PirepPointDto): string {
  if (p.turbulenceIntensity) return "#E8B770"; // amber
  if (p.icingIntensity) return "#7CD3FF";       // cyan
  return "#86E1A0";                              // phos green
}

function pirepRadius(p: PirepPointDto): number {
  // Intensity → radius. Severity codes from AWC: LGT, MOD, SEV (with ranges).
  const intensity = (p.turbulenceIntensity ?? p.icingIntensity ?? "").toUpperCase();
  if (intensity.includes("SEV")) return 7;
  if (intensity.includes("MOD")) return 5;
  if (intensity.includes("LGT")) return 4;
  return 3.5;
}

function ageMinutes(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60_000));
}

// Filter hazards whose validity window intersects [now, now+timeSliceHours].
// Hazards without a valid-from default to "starts now"; without a valid-to,
// we keep them in-window (better to show than to drop on missing metadata).
function filterHazardsForTimeSlice(hazards: HazardFeatureDto[], hours: number): HazardFeatureDto[] {
  const now = Date.now();
  const horizon = now + hours * 3_600_000;
  return hazards.filter((h) => {
    const from = h.validFromUtc ? new Date(h.validFromUtc).getTime() : now;
    const to = h.validToUtc ? new Date(h.validToUtc).getTime() : Number.POSITIVE_INFINITY;
    if (Number.isNaN(from) || Number.isNaN(to)) return true;
    return from <= horizon && to >= now;
  });
}

function deriveCenter(bbox: BboxTuple | null): [number, number] | null {
  if (!bbox) return null;
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every(Number.isFinite)) return null;
  // Returns [lat, lon] because /api/aviation/pireps takes lat,lon.
  return [(s + n) / 2, (w + e) / 2];
}

// MapLibre's Popup ctor — pulled in directly because this controller is
// always rendered alongside WeatherMap, which already loads maplibre-gl into
// the same chunk. No bundle penalty.
function makeMaplibrePopupCtor() {
  return () =>
    new MapLibrePopup({
      closeButton: true,
      closeOnClick: true,
      focusAfterOpen: true,
      maxWidth: "26rem",
      offset: 12
    });
}
