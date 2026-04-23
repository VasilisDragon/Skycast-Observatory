import type { UnitSystem } from "../../types";
import {
  formatAltimeter,
  formatCeiling,
  formatTemperature,
  formatVisibility,
  formatWind
} from "../../lib/aviation-units";
import { FlightCategoryChip } from "../primitives";
import type { MetarObservationDto, StationsBboxEntry } from "../types";

// Pure render. Pass 2 wires this into a MapLibre Popup container; the
// component itself doesn't know or care about the map. That makes it
// testable without browser, and keyboard navigation is the popup
// container's responsibility (focus trap inside the MapLibre wrapper).

export function StationPopup({
  station,
  units,
  onOpenAirport
}: {
  station: StationsBboxEntry;
  units: UnitSystem;
  onOpenAirport?: (icao: string) => void;
}) {
  const { airport, latest, metarStatus } = station;
  return (
    <div className="obs-station-popup" role="group" aria-label={`Station ${airport.icao}`}>
      <div className="obs-station-popup-head">
        <strong className="font-mono text-head">{airport.icao}</strong>
        <span className="text-muted text-xs">{airport.name}</span>
      </div>
      {metarStatus === "ok" && latest ? (
        <ObservationLines obs={latest} units={units} />
      ) : (
        <div className="obs-panel-state-nodata text-xs">
          {metarStatus === "invalid" ? "Not in catalog." : "No recent METAR."}
        </div>
      )}
      <div className="obs-station-popup-foot">
        {onOpenAirport ? (
          <button
            type="button"
            className="obs-btn obs-btn-sm"
            onClick={() => onOpenAirport(airport.icao)}
          >
            Open in /aviation/{airport.icao} →
          </button>
        ) : (
          <a
            href={`/aviation/${airport.icao}`}
            className="obs-btn obs-btn-sm"
          >
            Open in /aviation/{airport.icao} →
          </a>
        )}
      </div>
    </div>
  );
}

function ObservationLines({ obs, units }: { obs: MetarObservationDto; units: UnitSystem }) {
  return (
    <dl className="obs-station-popup-grid">
      <Row label="Cat">
        <FlightCategoryChip category={obs.flightCategory.category} />
      </Row>
      <Row label="Wind">{formatWind(obs.windDirectionDeg, obs.windSpeedKt, obs.windGustKt)}</Row>
      <Row label="Vis">{formatVisibility(obs.visibilityStatuteMiles, units)}</Row>
      <Row label="Ceil">{formatCeiling(obs.flightCategory.ceilingFt, units)}</Row>
      <Row label="T/Td">{formatTemperature(obs.temperatureC, obs.dewpointC, units)}</Row>
      <Row label="Alt">{formatAltimeter(obs.altimeterInHg, units)}</Row>
      <Row label="Age">{formatAge(obs.observedAtUtc)}</Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-dim uppercase tracking-wider">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function formatAge(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}
