import { useEffect, useState } from "react";
import { SkyErrorBoundary } from "../components/SkyErrorBoundary";
import { MetarPanel } from "./MetarPanel";
import { NearbyRibbon } from "./NearbyRibbon";
import { TafPanel } from "./TafPanel";
import { PanelState } from "./primitives";
import { useAviationRouter } from "./router";
import { buildViewOnMapUrl } from "./cross-surface-link";
import type { AirportDto } from "./types";
import type { UnitSystem } from "../types";

export function AviationAirport({ icao, units }: { icao: string; units: UnitSystem }) {
  const router = useAviationRouter();
  const [airport, setAirport] = useState<AirportDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAirport(null);
    setErr(null);
    (async () => {
      try {
        const response = await fetch(`/api/aviation/airports/${encodeURIComponent(icao)}`, {
          credentials: "same-origin"
        });
        if (response.status === 404) {
          if (active) setErr(`Airport ${icao} is not in the catalog.`);
          return;
        }
        if (!response.ok) {
          throw new Error(`Airport lookup failed (${response.status}).`);
        }
        const payload = (await response.json()) as AirportDto;
        if (active) setAirport(payload);
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : "Airport lookup failed.");
      }
    })();
    return () => {
      active = false;
    };
  }, [icao]);

  if (err) {
    return (
      <div className="obs-avn-layout">
        <PanelState kind="error" title={err} detail="Try a different ICAO or return to the picker." />
        <button
          type="button"
          className="obs-btn self-start"
          onClick={() => router.navigate({ kind: "index" })}
        >
          ← Picker
        </button>
      </div>
    );
  }

  return (
    <div className="obs-avn-layout">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted">Airport</div>
          <h1 className="font-mono text-head text-2xl tracking-wider">
            {icao}
            {airport ? <span className="text-body text-base ml-3">{airport.name}</span> : null}
          </h1>
          {airport ? (
            <div className="font-mono text-xs text-muted uppercase tracking-widest">
              {airport.city}
              {airport.state ? `, ${airport.state}` : ""} ·{" "}
              {airport.elevationFt != null ? `${airport.elevationFt}ft elev` : "elev unknown"}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <a
            className="obs-btn"
            href={buildViewOnMapUrl(icao)}
            title="Open the consumer map atlas centered on this airport with the aviation overlay enabled"
          >
            View on map →
          </a>
          <button type="button" className="obs-btn" onClick={() => router.navigate({ kind: "index" })}>
            ← Picker
          </button>
        </div>
      </header>

      <SkyErrorBoundary label="Nearby stations ribbon">
        <NearbyRibbon icao={icao} />
      </SkyErrorBoundary>

      <div className="obs-avn-grid">
        <SkyErrorBoundary label="METAR panel">
          <MetarPanel icao={icao} units={units} />
        </SkyErrorBoundary>
        <SkyErrorBoundary label="TAF panel">
          <TafPanel icao={icao} units={units} />
        </SkyErrorBoundary>
      </div>
    </div>
  );
}
