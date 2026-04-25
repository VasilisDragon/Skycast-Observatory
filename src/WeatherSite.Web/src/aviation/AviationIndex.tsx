import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSavedHomeLocation } from "../lib/api";
import {
  clearHomeAirport,
  getSavedHomeAirport,
  saveHomeAirport,
  searchAirports
} from "./api";
import { PanelState } from "./primitives";
import { useAviationRouter } from "./router";
import type {
  AirportDto,
  AirportSearchResponse,
  SavedAirportPreference
} from "./types";

export function AviationIndex() {
  const router = useAviationRouter();
  const [query, setQuery] = useState("");
  const [anchorZip, setAnchorZip] = useState<string | null>(null);
  const [savedAirport, setSavedAirport] = useState<SavedAirportPreference | null>(null);
  const [results, setResults] = useState<AirportSearchResponse>({ matches: [], nearest: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [zipLoc, saved] = await Promise.all([getSavedHomeLocation(), getSavedHomeAirport()]);
        setAnchorZip(zipLoc?.zip ?? null);
        setSavedAirport(saved);
        if (zipLoc?.zip) {
          const initial = await searchAirports("", { zip: zipLoc.zip }, 8);
          setResults(initial);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load saved airport.");
      }
    })();
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await searchAirports(query, { zip: anchorZip }, 10);
      setResults(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(icao: string) {
    try {
      const { savedAirport } = await saveHomeAirport(icao);
      setSavedAirport(savedAirport);
      router.navigate({ kind: "airport", icao });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save airport.");
    }
  }

  async function handleClearSaved() {
    try {
      await clearHomeAirport();
      setSavedAirport(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to clear saved airport.");
    }
  }

  return (
    <div className="obs-avn-layout">
      {savedAirport ? (
        <section className="obs-airport-picker">
          <div className="obs-airport-picker-head">
            <span className="text-xs uppercase tracking-widest text-muted">Last airport</span>
            <button type="button" className="obs-btn" onClick={handleClearSaved}>
              Clear
            </button>
          </div>
          <button
            type="button"
            className="obs-airport-option"
            onClick={() => router.navigate({ kind: "airport", icao: savedAirport.icao })}
          >
            <span className="obs-airport-option-icao">{savedAirport.airport.icao}</span>
            <span>
              <div className="text-head text-sm">{savedAirport.airport.name}</div>
              <div className="obs-airport-option-meta">
                {savedAirport.airport.city}, {savedAirport.airport.state}
              </div>
            </span>
            <span className="text-muted text-xs">→</span>
          </button>
        </section>
      ) : null}

      <section className="obs-airport-picker">
        <div className="obs-airport-picker-head">
          <span className="text-xs uppercase tracking-widest text-muted">
            {anchorZip ? `Nearby ${anchorZip}` : "Find airport"}
          </span>
        </div>
        <form className="flex gap-2" onSubmit={handleSearch}>
          <input
            className="obs-input"
            type="text"
            placeholder="ICAO, name, or city — e.g. KORD or Chicago"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Airport search"
          />
          <button type="submit" className="obs-btn" disabled={loading}>
            {loading ? "…" : "Search"}
          </button>
        </form>
        {error ? (
          <PanelState kind="error" title="Search failed" detail={error} />
        ) : null}
        <AirportList
          heading={query ? "Matches" : "Nearest"}
          airports={query ? results.matches : results.nearest.map((e) => e.airport)}
          distances={query ? undefined : Object.fromEntries(results.nearest.map((e) => [e.airport.icao, e.milesFromOrigin]))}
          onSelect={handleSelect}
        />
      </section>
    </div>
  );
}

function AirportList({
  heading,
  airports,
  distances,
  onSelect
}: {
  heading: string;
  airports: AirportDto[];
  distances?: Record<string, number>;
  onSelect: (icao: string) => void;
}) {
  if (airports.length === 0) {
    return <PanelState kind="nodata" title="No airports match that query." />;
  }
  return (
    <>
      <div className="text-xs uppercase tracking-widest text-dim">{heading}</div>
      <div className="obs-airport-picker-list">
        {airports.map((a) => (
          <button
            key={a.icao}
            type="button"
            className="obs-airport-option"
            onClick={() => onSelect(a.icao)}
          >
            <span className="obs-airport-option-icao">{a.icao}</span>
            <span>
              <div className="text-head text-sm">{a.name}</div>
              <div className="obs-airport-option-meta">
                {a.city}
                {a.state ? `, ${a.state}` : ""}
              </div>
            </span>
            <span className="text-muted text-xs">
              {distances?.[a.icao] != null ? `${distances[a.icao].toFixed(0)} mi` : "→"}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
