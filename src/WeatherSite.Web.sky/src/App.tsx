import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { clearHomeLocation, getSavedHomeLocation, loadWeatherBundle, saveHomeLocation } from "./lib/api";
import { resolveCondition } from "./lib/condition";
import { useUnits } from "./lib/use-units";
import { WeatherDashboard } from "./components/WeatherDashboard";
import { MapExplorer } from "./components/MapExplorer";
import { SkyErrorBoundary } from "./components/SkyErrorBoundary";
import { SkyHeader } from "./components/SkyHeader";
import { SkyNowHero } from "./components/SkyNowHero";
import { AviationApp } from "./aviation/AviationApp";
import { isAviationPath } from "./aviation/router";
import { readAviationFocusFromUrl } from "./aviation/cross-surface-link";
import type { SavedLocationPreference, WeatherBundle } from "./types";

type MapLayerSelection = {
  id: string;
  opacity: number;
  time?: string;
};

// Observatory backdrop is a fixed instrument chassis; theme-color stays constant.
const THEME_COLOR = "#06090D";

function getPrimaryRadarLayerId(bundle: WeatherBundle): string | undefined {
  return (
    bundle.mapConfig.layers.find((layer) => layer.id.startsWith("local-radar-"))?.id
    ?? bundle.mapConfig.layers.find((layer) => layer.id === "conus-radar")?.id
  );
}

function buildRadarPreviewLayers(bundle: WeatherBundle, primaryRadarLayerId: string): MapLayerSelection[] {
  const layers: MapLayerSelection[] = [];
  const primaryLayer = bundle.mapConfig.layers.find((layer) => layer.id === primaryRadarLayerId);
  const conusLayer = bundle.mapConfig.layers.find((layer) => layer.id === "conus-radar");
  const hazardsLayer = bundle.mapConfig.layers.find((layer) => layer.id === "hazards");

  if (conusLayer && conusLayer.id !== primaryRadarLayerId) {
    layers.push({
      id: conusLayer.id,
      opacity: 0.5,
      time: conusLayer.times.length > 0 ? conusLayer.times[conusLayer.times.length - 1] : undefined
    });
  }

  layers.push({
    id: primaryRadarLayerId,
    opacity: 0.94,
    time: primaryLayer && primaryLayer.times.length > 0
      ? primaryLayer.times[primaryLayer.times.length - 1]
      : undefined
  });

  if (hazardsLayer) {
    layers.push({
      id: hazardsLayer.id,
      opacity: 0.48
    });
  }

  return layers;
}

export default function App() {
  if (typeof window !== "undefined" && isAviationPath(window.location.pathname)) {
    return <AviationApp />;
  }
  return <ConsumerApp />;
}

function ConsumerApp() {
  const [zipInput, setZipInput] = useState("");
  const [savedLocation, setSavedLocation] = useState<SavedLocationPreference | null>(null);
  const [bundle, setBundle] = useState<WeatherBundle | null>(null);
  // Shared with /aviation via the weather_site_units localStorage key.
  const [units, setUnits] = useUnits();
  const [isBooting, setIsBooting] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingZip, setPendingZip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cross-surface jump from /aviation/:icao. Read once on mount.
  const [aviationFocusIcao, setAviationFocusIcao] = useState<string | null>(() =>
    readAviationFocusFromUrl()
  );

  useEffect(() => {
    let active = true;

    async function hydrateFromCookie() {
      setIsBooting(true);
      setError(null);
      try {
        const saved = await getSavedHomeLocation();
        if (!active) {
          return;
        }

        setSavedLocation(saved);
        setZipInput(saved?.zip ?? "");
        setPendingZip(saved?.zip ?? null);

        if (saved) {
          setIsBooting(false);
          await refresh(saved.zip, saved);
          return;
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load saved location.");
        }
      } finally {
        if (active) {
          setIsBooting(false);
        }
      }
    }

    void hydrateFromCookie();

    return () => {
      active = false;
    };
  }, []);

  async function refresh(
    zip: string,
    saved?: SavedLocationPreference | null,
    bundlePromise?: Promise<WeatherBundle>
  ) {
    setIsRefreshing(true);
    setError(null);

    try {
      const nextBundle = await (bundlePromise ?? loadWeatherBundle(zip));
      setBundle(nextBundle);
      setSavedLocation(
        saved
        ?? {
          zip,
          location: nextBundle.overview.location,
          savedAtUtc: new Date().toISOString()
        }
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to refresh the weather feed.");
    } finally {
      setPendingZip(null);
      setIsRefreshing(false);
    }
  }

  async function handleSaveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextZip = zipInput;
    setPendingZip(nextZip);
    setIsSaving(true);
    setError(null);

    try {
      const response = await saveHomeLocation(nextZip);
      setSavedLocation(response.savedLocation);
      setBundle({
        overview: response.bundle.overview,
        mapConfig: response.bundle.mapConfig
      });
      setZipInput(response.savedLocation.zip);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save that ZIP code.");
    } finally {
      setPendingZip(null);
      setIsSaving(false);
    }
  }

  async function handleClearLocation() {
    setError(null);

    try {
      await clearHomeLocation();
      setBundle(null);
      setSavedLocation(null);
      setPendingZip(null);
      setZipInput("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to clear the saved ZIP code.");
    }
  }

  function openExplorer() {
    document.getElementById("explorer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // When a /aviation/:icao → /?aviation=ICAO jump arrives, scroll the user to
  // the explorer once the bundle is loaded (and therefore MapExplorer is
  // mounted). MapExplorer itself handles overlay-enable + camera centering.
  useEffect(() => {
    if (!aviationFocusIcao || !bundle) return;
    // requestAnimationFrame defers until React has flushed MapExplorer mount,
    // so the scroll target exists before we scroll to it.
    const handle = window.requestAnimationFrame(() => openExplorer());
    return () => window.cancelAnimationFrame(handle);
  }, [aviationFocusIcao, bundle]);

  const condition = resolveCondition(bundle?.overview ?? null);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLOR);
    }
  }, []);

  const primaryRadarLayerId = bundle ? getPrimaryRadarLayerId(bundle) : undefined;
  const radarPreviewLayers = bundle && primaryRadarLayerId
    ? buildRadarPreviewLayers(bundle, primaryRadarLayerId)
    : [];
  const isInitializingDashboard = (isSaving || isRefreshing) && !bundle;

  return (
    <div className="min-h-screen" data-condition={condition}>
      <div className="obs-grid-bg" aria-hidden="true" />
      <div className="obs-scanlines" aria-hidden="true" />
      <div className="relative isolate w-full px-4 pb-10 pt-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <SkyHeader condition={condition} bundle={bundle} units={units} />

        <main className="space-y-6">
          <SkyNowHero
            bundle={bundle}
            savedLocation={savedLocation}
            condition={condition}
            units={units}
            zipInput={zipInput}
            onZipInputChange={setZipInput}
            onSubmitZip={handleSaveLocation}
            onClearLocation={handleClearLocation}
            onRefresh={() => {
              if (bundle) {
                void refresh(bundle.overview.location.zip, savedLocation);
              }
            }}
            isBooting={isBooting}
            isSaving={isSaving}
            isRefreshing={isRefreshing}
            pendingZip={pendingZip}
            radarPreviewLayers={radarPreviewLayers}
            primaryRadarLayerId={primaryRadarLayerId}
            error={error}
          />

          {isBooting ? (
            <BootSequence stage="hydrating" />
          ) : isInitializingDashboard ? (
            <BootSequence stage="fetching" zip={pendingZip} />
          ) : bundle ? (
            <>
              <SkyErrorBoundary
                label="Forecast deck"
                onRetry={() => refresh(bundle.overview.location.zip, savedLocation)}
              >
                <WeatherDashboard
                  overview={bundle.overview}
                  units={units}
                  onUnitsChange={setUnits}
                  onRefresh={() => refresh(bundle.overview.location.zip, savedLocation)}
                  onOpenExplorer={openExplorer}
                  isRefreshing={isRefreshing}
                />
              </SkyErrorBoundary>
              <SkyErrorBoundary label="Map atlas">
                <MapExplorer
                  config={bundle.mapConfig}
                  focusedAirportIcao={aviationFocusIcao}
                  onFocusConsumed={() => setAviationFocusIcao(null)}
                />
              </SkyErrorBoundary>
            </>
          ) : null}
        </main>

        <footer className="mt-8 border-t border-rule/10 pt-4 pb-2 text-center font-mono text-[0.64rem] uppercase tracking-[0.22em] text-dim">
          SKYCAST · OBSERVATORY EDITION · DATA NOAA / NWS · NDFD · KLOT · OPENSTREETMAP
        </footer>
      </div>
    </div>
  );
}

function BootSequence({ stage, zip }: { stage: "hydrating" | "fetching"; zip?: string | null }) {
  const lines =
    stage === "hydrating"
      ? [
          { cmd: "init observatory.v1", status: "OK" },
          { cmd: "read cookie skycast.home", status: "…" }
        ]
      : [
          { cmd: "init observatory.v1", status: "OK" },
          { cmd: `resolve geocode ${zip ?? "…"}`, status: "OK" },
          { cmd: "GET /api/weather/overview", status: "…" },
          { cmd: "GET /api/maps/config", status: "…" },
          { cmd: "decode NWS alert frame", status: "queued" }
        ];
  return (
    <div className="obs-boot" role="status" aria-live="polite">
      {lines.map((line, i) => {
        const pending = line.status !== "OK";
        return (
          <div key={i} className="obs-boot-line">
            <span className="obs-boot-prompt">&gt;</span>
            <span className="obs-boot-text">{line.cmd}</span>
            <span className={`obs-boot-status ${pending ? "is-pending" : ""}`}>
              [{line.status}]
            </span>
          </div>
        );
      })}
    </div>
  );
}
