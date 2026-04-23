import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { clearHomeLocation, getSavedHomeLocation, loadWeatherBundle, saveHomeLocation } from "./lib/api";
import { describeFreshness, formatLocationTitle, formatTemperature, joinSummary } from "./lib/format";
import { WeatherDashboard } from "./components/WeatherDashboard";
import { MapExplorer } from "./components/MapExplorer";
import { WeatherMap } from "./components/WeatherMap";
import type { SavedLocationPreference, UnitSystem, WeatherBundle } from "./types";

type MapLayerSelection = {
  id: string;
  opacity: number;
  time?: string;
};

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
  const [zipInput, setZipInput] = useState("");
  const [savedLocation, setSavedLocation] = useState<SavedLocationPreference | null>(null);
  const [bundle, setBundle] = useState<WeatherBundle | null>(null);
  const [units, setUnits] = useState<UnitSystem>("imperial");
  const [isBooting, setIsBooting] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingZip, setPendingZip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const primaryRadarLayerId = bundle ? getPrimaryRadarLayerId(bundle) : undefined;
  const radarPreviewLayers = bundle && primaryRadarLayerId
    ? buildRadarPreviewLayers(bundle, primaryRadarLayerId)
    : [];
  const isInitializingDashboard = (isSaving || isRefreshing) && !bundle;
  const loadingCopy = pendingZip
    ? `Saving ${pendingZip} and loading the live forecast dashboard...`
    : "Loading the live forecast dashboard...";

  return (
    <div className="min-h-screen bg-aurora text-mist">
      <div className="storm-noise" />
      <div className="relative mx-auto max-w-[108rem] px-4 pb-16 pt-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
        <header className="storm-nav">
          <div>
            <p className="storm-eyebrow">Stormglass Weather</p>
            <h1 className="text-2xl font-semibold text-white">IIS-hosted live weather built on NOAA and the NWS.</h1>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm text-mist/70">
            <a href="#forecast" className="storm-nav-link">
              Forecast
            </a>
            <a href="#explorer" className="storm-nav-link">
              Explorer
            </a>
          </nav>
        </header>

        <main className="space-y-10">
          <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] 2xl:gap-8">
            <article className="storm-hero">
              <p className="storm-eyebrow">Public-data weather command deck</p>
              <h2 className="storm-hero-title">
                Live radar, hourly and weekly forecasts, and a map explorer that stays centered on your ZIP.
              </h2>
              <p className="storm-hero-copy">
                Forecasts, alerts, observations, and animated NOAA layers are pulled live. Save a ZIP once and the
                dashboard comes back ready on every return visit.
              </p>

              <form className="storm-form mt-8" onSubmit={handleSaveLocation}>
                <label className="storm-form-label" htmlFor="zip">
                  Home ZIP code
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    id="zip"
                    value={zipInput}
                    onChange={(event) => setZipInput(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    className="storm-input"
                    inputMode="numeric"
                    pattern="[0-9]{5}"
                    placeholder="60601"
                  />
                  <button type="submit" className="storm-button" disabled={isSaving || zipInput.length !== 5}>
                    {isSaving ? "Saving..." : savedLocation ? "Update location" : "Save ZIP"}
                  </button>
                  {savedLocation ? (
                    <button type="button" className="storm-button storm-button-secondary" onClick={handleClearLocation}>
                      Clear cookie
                    </button>
                  ) : null}
                </div>
              </form>

              {isInitializingDashboard ? <div className="storm-loader mt-4">{loadingCopy}</div> : null}
              {error ? <div className="storm-error mt-4">{error}</div> : null}

              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <FeatureCard label="Forecast cadence" value="Current, hourly, daily, and seven-day views." />
                <FeatureCard label="Live overlays" value="Animated radar, hazards, wind, clouds, POP, and QPF." />
                <FeatureCard label="Deployment fit" value="ASP.NET Core 10, static bundle into IIS-hosted wwwroot." />
              </div>

              {savedLocation ? (
                <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
                  <p className="storm-eyebrow">Saved location</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-2xl font-semibold text-white">{formatLocationTitle(savedLocation.location)}</p>
                      <p className="mt-2 text-sm text-mist/70">
                        {joinSummary([
                          savedLocation.location.zip,
                          savedLocation.location.isApproximate ? "Approximate centroid" : "Exact ZCTA centroid",
                          savedLocation.location.radarStation ? `Radar ${savedLocation.location.radarStation}` : "CONUS radar"
                        ])}
                      </p>
                    </div>
                    <p className="text-sm text-mist/60">
                      Saved {describeFreshness(savedLocation.savedAtUtc, savedLocation.location.timeZone)}
                    </p>
                  </div>
                </div>
              ) : null}
            </article>

            <article className="storm-card storm-hero-side self-start p-5 sm:p-6">
              {isBooting ? (
                <div className="storm-loader">Checking for a saved ZIP cookie...</div>
              ) : isInitializingDashboard ? (
                <div className="storm-loader">
                  <p className="storm-eyebrow">Loading weather</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">
                    {pendingZip ? `Building the dashboard for ${pendingZip}.` : "Building the dashboard."}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-mist/70">
                    Pulling the forecast, alerts, radar layers, and map configuration now.
                  </p>
                </div>
              ) : bundle && primaryRadarLayerId ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="storm-eyebrow">Local Radar Window</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">{formatLocationTitle(bundle.overview.location)}</h3>
                      <p className="mt-2 text-sm text-mist/70">{bundle.overview.current.summary}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-5xl font-semibold text-white">
                        {formatTemperature(bundle.overview.current.temperatureF, units)}
                      </div>
                      <p className="mt-2 text-sm text-mist/60">
                        {describeFreshness(bundle.overview.current.observedAtUtc, bundle.overview.location.timeZone)}
                      </p>
                    </div>
                  </div>
                  <WeatherMap
                    className="mt-5 !min-h-[15rem] sm:!min-h-[16.5rem] xl:!min-h-[17.5rem]"
                    config={bundle.mapConfig}
                    projection="mercator"
                    camera={{
                      latitude: bundle.mapConfig.centerLatitude,
                      longitude: bundle.mapConfig.centerLongitude,
                      zoom: Math.max(bundle.mapConfig.defaultZoom - 1.2, 5.8)
                    }}
                    interactive={false}
                    layers={radarPreviewLayers}
                    title="Local radar preview"
                  />
                </>
              ) : (
                <div className="storm-empty-hero">
                  <p className="storm-eyebrow">First visit</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Save a ZIP to load your forecast deck.</h3>
                  <p className="mt-3 text-sm leading-7 text-mist/70">
                    The first load pulls the public NOAA and NWS feeds for your chosen ZIP, then saves that location in
                    the `weather_home_zip` cookie so the dashboard can restore itself automatically later.
                  </p>
                </div>
              )}
            </article>
          </section>

          {isBooting ? (
            <section className="storm-loader-panel">
              <div className="storm-loader">Loading weather services...</div>
            </section>
          ) : isInitializingDashboard ? (
            <section className="storm-loader-panel">
              <div className="storm-loader">
                {pendingZip ? `Loading live weather, maps, and alerts for ${pendingZip}...` : loadingCopy}
              </div>
            </section>
          ) : bundle ? (
            <>
              <WeatherDashboard
                overview={bundle.overview}
                units={units}
                onUnitsChange={setUnits}
                onRefresh={() => refresh(bundle.overview.location.zip, savedLocation)}
                onOpenExplorer={openExplorer}
                isRefreshing={isRefreshing}
              />
              <MapExplorer config={bundle.mapConfig} />
            </>
          ) : (
            <section className="storm-card p-8">
              <p className="storm-eyebrow">Ready to initialize</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">No saved ZIP is loaded yet.</h3>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-mist/70">
                Enter any U.S. ZIP code above to validate it, store it in a secure cookie, and hydrate the forecast
                dashboard and map explorer from public weather services.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function FeatureCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 shadow-glass backdrop-blur-xl">
      <p className="text-xs uppercase tracking-[0.26em] text-rain/75">{label}</p>
      <p className="mt-3 text-sm leading-6 text-mist/80">{value}</p>
    </article>
  );
}
