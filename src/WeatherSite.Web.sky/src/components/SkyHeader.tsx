import clsx from "clsx";
import type { ConditionState } from "../lib/condition";
import { formatTemperature } from "../lib/format";
import { useActiveSection } from "../hooks/useActiveSection";
import { useClock } from "../hooks/useClock";
import type { UnitSystem, WeatherBundle } from "../types";

interface SkyHeaderProps {
  condition: ConditionState;
  bundle: WeatherBundle | null;
  units: UnitSystem;
}

const CONDITION_LABELS: Record<ConditionState, string> = {
  "clear-day": "CLEAR",
  "clear-night": "CLEAR NIGHT",
  "overcast": "OVERCAST",
  "rain": "RAIN",
  "snow": "SNOW",
  "thunderstorm": "THUNDERSTORM",
  "fog": "FOG"
};

const SECTION_IDS = ["now", "hourly", "weekly", "alerts", "explorer"] as const;
const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  now: "Now",
  hourly: "Hourly",
  weekly: "7-Day",
  alerts: "Alerts",
  explorer: "Atlas"
};

function pad(value: number, width = 2): string {
  return value.toString().padStart(width, "0");
}

function formatUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} · ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function SkyHeader({ condition, bundle, units }: SkyHeaderProps) {
  const activeSection = useActiveSection(SECTION_IDS, "now");
  const clock = useClock(1000);
  const conditionLabel = CONDITION_LABELS[condition];
  const location = bundle?.overview.location;
  const temperatureLabel = bundle ? formatTemperature(bundle.overview.current.temperatureF, units) : null;
  const uplinkOk = Boolean(bundle);

  function handleNavClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const tickerMessages = bundle
    ? [
        ["STA", bundle.overview.location.radarStation ?? "—"],
        ["OBS", bundle.overview.current.stationName ?? "—"],
        ["SRC", bundle.overview.current.source],
        ["ALT", bundle.overview.alerts.length > 0 ? `${bundle.overview.alerts.length} ACTIVE` : "NO ACTIVE ALERTS"],
        ["HUM", bundle.overview.current.humidityPercent != null ? `${Math.round(bundle.overview.current.humidityPercent)}%` : "—"],
        ["WND", bundle.overview.current.windSpeedMph != null ? `${Math.round(bundle.overview.current.windSpeedMph)} MPH ${bundle.overview.current.windDirection ?? ""}` : "—"],
        ["PRS", bundle.overview.current.pressureInHg != null ? `${bundle.overview.current.pressureInHg.toFixed(2)} inHg` : "—"],
        ["VIS", bundle.overview.current.visibilityMiles != null ? `${bundle.overview.current.visibilityMiles.toFixed(1)} mi` : "—"]
      ]
    : [
        ["SYS", "IDLE"],
        ["CMD", "ENTER ZIP TO INITIALIZE"],
        ["API", "NOAA / NWS READY"]
      ];

  return (
    <header className="obs-statusbar">
      <a
        href="#now"
        onClick={(event) => handleNavClick(event, "now")}
        className="obs-statusbar-brand"
        aria-label="Skycast home"
      >
        <span className="obs-statusbar-brand-glyph" aria-hidden="true">◐</span>
        <span className="flex flex-col leading-none gap-1">
          <span className="obs-statusbar-brand-name">Skycast</span>
          <span className="obs-statusbar-brand-tag">Observatory · v1</span>
        </span>
      </a>

      <div className="obs-statusbar-center" aria-live="polite">
        <span>
          <i className={clsx("obs-led", !uplinkOk && "obs-led-off")} aria-hidden="true" />
          <span>{uplinkOk ? "UPLINK" : "STDBY"}</span>
        </span>
        <span className="obs-statusbar-sep" aria-hidden="true">│</span>
        <span>
          UTC <b>{formatUtc(clock)}</b>
        </span>
        <span className="obs-statusbar-sep" aria-hidden="true">│</span>
        {bundle && location ? (
          <>
            <span>
              STA <b>{location.radarStation ?? "CONUS"}</b>
            </span>
            <span className="obs-statusbar-sep" aria-hidden="true">│</span>
            <span>
              POS <b>{formatCoord(location.latitude, location.longitude)}</b>
            </span>
            <span className="obs-statusbar-sep" aria-hidden="true">│</span>
            <span>
              <b>{conditionLabel}</b> <span className="text-phos">· {temperatureLabel}</span>
            </span>
          </>
        ) : (
          <span className="text-muted">AWAITING ZIP · OBSERVATORY OFFLINE</span>
        )}
      </div>

      <nav className="obs-statusbar-nav" aria-label="Primary sections">
        {SECTION_IDS.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(event) => handleNavClick(event, id)}
            className={clsx(activeSection === id && "is-active")}
            aria-current={activeSection === id ? "true" : undefined}
          >
            {SECTION_LABELS[id]}
          </a>
        ))}
        {/* Cross-route link, not an in-page anchor. Renders regardless of
            bundle state so a user with no ZIP can still reach the aviation
            picker. App.tsx's isAviationPath gate swaps to <AviationApp /> on
            full-page nav — intentional; no SPA handoff is needed. */}
        <a href="/aviation" title="Aviation briefing: METAR, TAF, hazards">
          Aviation ↗
        </a>
      </nav>

      <div className="obs-statusbar-ticker" aria-hidden="true">
        {/* Consumer status strip is static — render each message once and
            disable the seamless-marquee animation (the is-static modifier
            turns off obs-ticker so the track doesn't translate). The aviation
            header still uses the full marquee via the unmodified class. */}
        <span className="obs-ticker-track is-static">
          {tickerMessages.map(([label, value], i) => (
            <span key={`${label}-${i}`}>
              <span>{label}</span>
              <b>{value}</b>
            </span>
          ))}
        </span>
      </div>
    </header>
  );
}
