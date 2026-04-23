from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "zip" / "source" / "2025_Gaz_zcta_national" / "2025_Gaz_zcta_national.txt"
TARGET = ROOT / "data" / "zip" / "zcta-centroids.json"


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Source file not found: {SOURCE}")

    entries: dict[str, list[float]] = {}
    with SOURCE.open("r", encoding="utf-8") as handle:
        next(handle)
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) < 8:
                continue

            zip_code = parts[0]
            latitude = float(parts[6])
            longitude = float(parts[7])
            entries[zip_code] = [latitude, longitude]

    payload = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "count": len(entries),
        "entries": entries,
    }

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with TARGET.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))

    print(f"Wrote {len(entries)} ZIP centroids to {TARGET}")


if __name__ == "__main__":
    main()
