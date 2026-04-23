"""Build a static airport catalog from the OurAirports CC0 dataset.

Source: https://github.com/davidmegginson/ourairports-data (public domain, CC0-1.0).
Pin OURAIRPORTS_COMMIT to a specific upstream commit so the dataset is
reproducible across builds. Update the pin deliberately when refreshing data.

Expected local layout (download the CSV at the pinned commit):
    data/airports/source/airports.csv

The output is a compact JSON file shaped like the ZCTA centroid catalog:
    {
      "generatedAtUtc": "...",
      "sourceCommit": "<sha>",
      "count": <n>,
      "entries": {
        "KORD": { "i": "KORD", "n": "Chicago O'Hare Intl", "c": "Chicago",
                  "s": "IL", "la": 41.9786, "lo": -87.9048, "e": 672 }
      }
    }
"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path


OURAIRPORTS_COMMIT = "PIN-ME"  # e.g. "a1b2c3d4e5f67890abcdef1234567890abcdef12"

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "airports" / "source" / "airports.csv"
TARGET = ROOT / "data" / "airports" / "airports.json"

KEEP_TYPES = {"small_airport", "medium_airport", "large_airport"}


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Source file not found: {SOURCE}")

    entries: dict[str, dict[str, object]] = {}
    with SOURCE.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if row.get("iso_country") != "US":
                continue
            if row.get("type") not in KEEP_TYPES:
                continue
            ident = (row.get("ident") or "").strip().upper()
            if len(ident) != 4:
                continue
            if ident[0] not in ("K", "P"):
                continue
            try:
                lat = float(row["latitude_deg"])
                lon = float(row["longitude_deg"])
            except (KeyError, ValueError):
                continue
            elev_raw = (row.get("elevation_ft") or "").strip()
            try:
                elev = int(float(elev_raw)) if elev_raw else None
            except ValueError:
                elev = None

            entries[ident] = {
                "i": ident,
                "n": (row.get("name") or "").strip(),
                "c": (row.get("municipality") or "").strip(),
                "s": (row.get("iso_region") or "").split("-")[-1],
                "la": round(lat, 5),
                "lo": round(lon, 5),
                "e": elev,
            }

    payload = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceCommit": OURAIRPORTS_COMMIT,
        "count": len(entries),
        "entries": entries,
    }

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with TARGET.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))

    print(f"Wrote {len(entries)} airports to {TARGET}")


if __name__ == "__main__":
    main()
