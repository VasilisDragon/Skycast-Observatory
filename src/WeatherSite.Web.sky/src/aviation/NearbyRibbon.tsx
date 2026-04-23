import { useEffect, useState } from "react";
import { getMetarBatch, searchAirports } from "./api";
import { FlightCategoryChip, PanelState } from "./primitives";
import { useAviationRouter } from "./router";
import type { AirportWithDistanceDto, FlightCategoryLabel } from "./types";

type RibbonEntry = {
  entry: AirportWithDistanceDto;
  category: FlightCategoryLabel;
};

export function NearbyRibbon({ icao }: { icao: string }) {
  const router = useAviationRouter();
  const [entries, setEntries] = useState<RibbonEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setEntries(null);
    setErr(null);
    (async () => {
      try {
        const search = await searchAirports("", { icao }, 7);
        const near = search.nearest.slice(0, 6);
        if (near.length === 0) {
          if (active) setEntries([]);
          return;
        }
        // ONE batch fetch for all six nearest stations, not six parallel calls.
        // Previous fan-out pattern silently degraded to UNKN whenever the
        // rate limiter or upstream semaphore shed a request — which hit
        // dense areas (KORD's neighbors) much harder than sparse ones (KDTW).
        const batch = await getMetarBatch(
          near.map((n) => n.airport.icao),
          1
        );
        const byIcao = new Map(batch.entries.map((e) => [e.icao, e]));
        const mapped: RibbonEntry[] = near.map((n) => {
          const entry = byIcao.get(n.airport.icao);
          const category = (entry?.latest?.flightCategory.category ?? "UNKN") as FlightCategoryLabel;
          return { entry: n, category };
        });
        if (active) setEntries(mapped);
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : "Nearby lookup failed.");
      }
    })();
    return () => {
      active = false;
    };
  }, [icao]);

  if (err) return <PanelState kind="error" title="Nearby stations unavailable" detail={err} />;
  if (entries === null) return <PanelState kind="loading" title="Scanning nearby stations…" />;
  if (entries.length === 0) return <PanelState kind="nodata" title="No nearby reporting stations." />;

  return (
    <nav className="obs-nearby-ribbon" aria-label="Nearby reporting stations">
      {entries.map(({ entry, category }) => (
        <button
          key={entry.airport.icao}
          type="button"
          className="obs-nearby-chip"
          onClick={() => router.navigate({ kind: "airport", icao: entry.airport.icao })}
        >
          <FlightCategoryChip category={category} />
          <strong>{entry.airport.icao}</strong>
          <small>{entry.milesFromOrigin.toFixed(0)} mi</small>
        </button>
      ))}
    </nav>
  );
}
