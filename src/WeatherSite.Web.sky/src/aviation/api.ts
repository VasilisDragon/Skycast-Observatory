import type {
  AirportSearchResponse,
  BboxTuple,
  HazardsResponse,
  MetarBatchResponse,
  MetarResponse,
  PirepsResponse,
  SaveHomeAirportResponse,
  SavedAirportPreference,
  StationsBboxResponse,
  TafResponse
} from "./types";

type RequestOptions = RequestInit & { allowNoContent?: boolean };

type ProblemDetails = {
  detail?: string;
  title?: string;
  errors?: Record<string, string[]>;
};

async function requestJson<T>(url: string, options?: RequestOptions): Promise<T | null> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options
  });

  if (response.status === 204) {
    return options?.allowNoContent ? null : null;
  }
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return (await response.json()) as T;
}

async function extractErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return `Request failed with status ${response.status}.`;
  }
  const problem = (await response.json()) as ProblemDetails;
  const validation = problem.errors ? Object.values(problem.errors).flat().filter(Boolean) : [];
  return validation[0] ?? problem.detail ?? problem.title ?? `Request failed with status ${response.status}.`;
}

export async function searchAirports(
  query: string,
  anchor?: { zip?: string | null; icao?: string | null } | null,
  limit = 8
): Promise<AirportSearchResponse> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  if (anchor?.zip) params.set("anchorZip", anchor.zip);
  if (anchor?.icao) params.set("anchorIcao", anchor.icao);
  const result = await requestJson<AirportSearchResponse>(`/api/aviation/airports?${params}`);
  return result ?? { matches: [], nearest: [] };
}

export async function getSavedHomeAirport(): Promise<SavedAirportPreference | null> {
  return requestJson<SavedAirportPreference>("/api/aviation/session/home-airport", { allowNoContent: true });
}

export async function saveHomeAirport(icao: string): Promise<SaveHomeAirportResponse> {
  const result = await requestJson<SaveHomeAirportResponse>("/api/aviation/session/home-airport", {
    method: "POST",
    body: JSON.stringify({ icao })
  });
  if (!result) {
    throw new Error("Home airport could not be saved.");
  }
  return result;
}

export async function clearHomeAirport(): Promise<void> {
  await requestJson<void>("/api/aviation/session/home-airport", { method: "DELETE", allowNoContent: true });
}

export async function getMetar(icao: string, hours = 6): Promise<MetarResponse> {
  const result = await requestJson<MetarResponse>(
    `/api/aviation/metar/${encodeURIComponent(icao)}?hours=${hours}`
  );
  if (!result) {
    throw new Error("METAR payload was empty.");
  }
  return result;
}

// Batch shape: one HTTP call, one upstream AWC hit, one rate-limit decrement.
// Partial failures come back as entries with status="unavailable" — callers
// must render the per-entry status rather than treat absence as a thrown error.
export async function getMetarBatch(icaos: string[], hours = 1): Promise<MetarBatchResponse> {
  const normalized = Array.from(
    new Set(icaos.map((id) => id.trim().toUpperCase()).filter(Boolean))
  );
  if (normalized.length === 0) {
    return {
      entries: [],
      status: { source: "no-data", throttled: false, stale: false }
    };
  }

  const params = new URLSearchParams({
    ids: normalized.join(","),
    hours: String(hours)
  });
  const result = await requestJson<MetarBatchResponse>(`/api/aviation/metar?${params}`);
  if (!result) {
    throw new Error("METAR batch payload was empty.");
  }
  return result;
}

export async function getStationsInBbox(
  bbox: BboxTuple,
  options?: { snap?: number; limit?: number; signal?: AbortSignal }
): Promise<StationsBboxResponse> {
  const [w, s, e, n] = bbox;
  const params = new URLSearchParams({
    w: w.toFixed(4),
    s: s.toFixed(4),
    e: e.toFixed(4),
    n: n.toFixed(4)
  });
  if (options?.snap != null) params.set("snap", options.snap.toString());
  if (options?.limit != null) params.set("limit", options.limit.toString());
  const result = await requestJson<StationsBboxResponse>(
    `/api/aviation/stations/bbox?${params}`,
    options?.signal ? { signal: options.signal } : undefined
  );
  if (!result) {
    throw new Error("Stations bbox payload was empty.");
  }
  return result;
}

export async function getTaf(icao: string): Promise<TafResponse> {
  const result = await requestJson<TafResponse>(`/api/aviation/taf/${encodeURIComponent(icao)}`);
  if (!result) {
    throw new Error("TAF payload was empty.");
  }
  return result;
}

export async function getHazards(kind: "airmet" | "sigmet" | "cwa"): Promise<HazardsResponse> {
  const result = await requestJson<HazardsResponse>(`/api/aviation/hazards/${kind}`);
  if (!result) {
    throw new Error("Hazards payload was empty.");
  }
  return result;
}

export async function getPireps(lat: number, lon: number, radius = 200): Promise<PirepsResponse> {
  const result = await requestJson<PirepsResponse>(
    `/api/aviation/pireps?lat=${lat}&lon=${lon}&radius=${radius}`
  );
  if (!result) {
    throw new Error("PIREP payload was empty.");
  }
  return result;
}
