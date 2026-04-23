import { useMemo } from "react";
import clsx from "clsx";
import { SkyErrorBoundary } from "../components/SkyErrorBoundary";
import {
  AviationRouterProvider,
  useAviationRouterState
} from "./router";
import { AviationAirport } from "./AviationAirport";
import { AviationIndex } from "./AviationIndex";
import { useUnits } from "../lib/use-units";
import type { UnitSystem } from "../types";

export function AviationApp() {
  const routerState = useAviationRouterState();
  const [units, setUnits] = useUnits();
  const body = useMemo(() => {
    switch (routerState.route.kind) {
      case "airport":
        return <AviationAirport icao={routerState.route.icao} units={units} />;
      case "route":
        return <RouteStub dep={routerState.route.dep} dest={routerState.route.dest} />;
      case "index":
        return <AviationIndex />;
      default:
        return <NotFound />;
    }
  }, [routerState.route, units]);

  return (
    <AviationRouterProvider value={routerState}>
      <div className="min-h-screen" data-condition="clear-night">
        <div className="obs-grid-bg" aria-hidden="true" />
        <div className="obs-scanlines" aria-hidden="true" />
        <div className="relative w-full px-4 pb-10 pt-3 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <AviationHeader units={units} onUnitsChange={setUnits} />
          <AviationDisclaimerBar />
          <main className="mt-4">
            <SkyErrorBoundary label="Aviation dashboard">{body}</SkyErrorBoundary>
          </main>
          <footer className="mt-8 border-t border-rule/10 pt-4 pb-2 text-center font-mono text-[0.64rem] uppercase tracking-[0.22em] text-dim">
            SKYCAST · AVIATION · NOT FOR FLIGHT PLANNING · SUPPLEMENTAL SITUATIONAL AWARENESS ONLY
          </footer>
        </div>
      </div>
    </AviationRouterProvider>
  );
}

// Source attributions match what the aviation backend actually proxies.
// AWC = aviationweather.gov (METAR/TAF/AIRMET/SIGMET/CWA/PIREP).
// NOAA NWS = base service line. FAA NOTAM is on the Phase D roadmap; listed
// as roadmap so the marquee doesn't claim a feed we don't yet wire up.
// NDFD = forecast surfaces shared with the consumer side.
//
// The duplicate `Array.from({ length: 2 })` is the seamless-marquee pattern
// from `index.css:605-608` (translate -50% loop). Don't reduce to 1 — that
// re-introduces the gap between repetitions. Density of distinct labels is
// what keeps the eye from reading "the same string twice".
const TICKER_SOURCES = [
  ["DATA", "AWC · aviationweather.gov"],
  ["BASE", "NOAA NWS"],
  ["FCST", "NDFD"],
  ["RDR", "KLOT MRMS composite"],
  ["NOTAM", "FAA · roadmap"]
] as const;

function AviationHeader({ units, onUnitsChange }: { units: UnitSystem; onUnitsChange: (next: UnitSystem) => void }) {
  return (
    <header className="obs-statusbar">
      <a href="/" className="obs-statusbar-brand" aria-label="Skycast home">
        <span className="obs-statusbar-brand-glyph" aria-hidden="true">
          ◐
        </span>
        <span className="flex flex-col leading-none gap-1">
          <span className="obs-statusbar-brand-name">Skycast</span>
          <span className="obs-statusbar-brand-tag">Aviation · v1</span>
        </span>
      </a>
      <div className="obs-statusbar-center" aria-live="polite">
        <span className="text-muted">
          SUPPLEMENTAL SITUATIONAL AWARENESS · NOT APPROVED FOR FLIGHT PLANNING
        </span>
      </div>
      <nav className="obs-statusbar-nav" aria-label="Primary sections">
        <div className="obs-segment obs-units-toggle" role="group" aria-label="Display units">
          <button
            type="button"
            className={clsx(units === "imperial" && "is-active")}
            onClick={() => onUnitsChange("imperial")}
            aria-pressed={units === "imperial"}
            title="US units: °F, inHg, statute miles, feet"
          >
            °F
          </button>
          <button
            type="button"
            className={clsx(units === "metric" && "is-active")}
            onClick={() => onUnitsChange("metric")}
            aria-pressed={units === "metric"}
            title="Metric: °C, hPa, meters; winds remain in knots per ICAO"
          >
            °C
          </button>
        </div>
        <a href="/aviation" aria-current={location.pathname === "/aviation" ? "true" : undefined}>
          Airports
        </a>
        <a href="/">Consumer</a>
      </nav>
      <div className="obs-statusbar-ticker" aria-hidden="true">
        <span className="obs-ticker-track">
          {Array.from({ length: 2 }).map((_, copy) => (
            <span key={copy} className="contents">
              {TICKER_SOURCES.map(([label, value], i) => (
                <span key={`${copy}-${i}`}>
                  <span>{label}</span>
                  <b>{value}</b>
                </span>
              ))}
            </span>
          ))}
        </span>
      </div>
    </header>
  );
}

function AviationDisclaimerBar() {
  return (
    <aside className="obs-disclaimer-bar" role="complementary" aria-label="Aviation data disclaimer">
      <span>
        <strong>Supplemental only.</strong> Do not use for flight planning or dispatch. For official
        preflight briefing use{" "}
        <a href="https://aviationweather.gov/" target="_blank" rel="noreferrer noopener">
          aviationweather.gov
        </a>
        ,{" "}
        <a href="https://1800wxbrief.com/" target="_blank" rel="noreferrer noopener">
          1-800-WX-BRIEF
        </a>
        , or an approved EFB. Cached data may be stale — check timestamps before acting.
      </span>
    </aside>
  );
}

function RouteStub({ dep, dest }: { dep: string | null; dest: string | null }) {
  return (
    <div className="obs-card p-4 font-mono text-sm text-body">
      <div className="text-xs uppercase tracking-widest text-muted mb-2">Route view · Phase D</div>
      <div>
        DEP <b>{dep ?? "—"}</b> · DEST <b>{dest ?? "—"}</b>
      </div>
      <p className="text-dim text-xs mt-2 leading-relaxed">
        The route view is scheduled for Phase D (along with twilight, favorites, alternate suggestion).
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="obs-card p-4 font-mono text-sm text-muted">
      <div className="text-xs uppercase tracking-widest text-amber mb-2">Unknown path</div>
      <a href="/aviation" className="text-phos underline">
        ← Back to airport picker
      </a>
    </div>
  );
}
