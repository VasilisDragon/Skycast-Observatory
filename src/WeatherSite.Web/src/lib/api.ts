import type {
  MapConfigResponse,
  SavedLocationPreference,
  SaveHomeLocationResponse,
  SaveHomeLocationRequest,
  WeatherBundle,
  WeatherBundleResponse,
  WeatherOverviewResponse
} from "../types";

type RequestOptions = RequestInit & {
  allowNoContent?: boolean;
};

type ProblemDetails = {
  detail?: string;
  title?: string;
  errors?: Record<string, string[]>;
};

async function requestJson<T>(url: string, options?: RequestOptions): Promise<T | null> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (response.status === 204 && options?.allowNoContent) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
}

async function extractErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return `Request failed with status ${response.status}.`;
  }

  const problem = (await response.json()) as ProblemDetails;
  const validationErrors = problem.errors
    ? Object.values(problem.errors)
        .flat()
        .filter(Boolean)
    : [];

  return validationErrors[0] ?? problem.detail ?? problem.title ?? `Request failed with status ${response.status}.`;
}

export async function getSavedHomeLocation(): Promise<SavedLocationPreference | null> {
  return requestJson<SavedLocationPreference>("/api/session/home-location", {
    method: "GET",
    allowNoContent: true
  });
}

export async function saveHomeLocation(zip: string): Promise<SaveHomeLocationResponse> {
  const payload: SaveHomeLocationRequest = { zip };
  const result = await requestJson<SaveHomeLocationResponse>("/api/session/home-location", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!result) {
    throw new Error("Home location could not be saved.");
  }

  return result;
}

export async function clearHomeLocation(): Promise<void> {
  await requestJson<void>("/api/session/home-location", {
    method: "DELETE",
    allowNoContent: true
  });
}

export async function getWeatherOverview(zip: string): Promise<WeatherOverviewResponse> {
  const result = await requestJson<WeatherOverviewResponse>(`/api/weather/overview?zip=${encodeURIComponent(zip)}`, {
    method: "GET"
  });

  if (!result) {
    throw new Error("Weather overview was empty.");
  }

  return result;
}

export async function getMapConfig(zip: string): Promise<MapConfigResponse> {
  const result = await requestJson<MapConfigResponse>(`/api/maps/config?zip=${encodeURIComponent(zip)}`, {
    method: "GET"
  });

  if (!result) {
    throw new Error("Map configuration was empty.");
  }

  return result;
}

export async function loadWeatherBundle(zip: string): Promise<WeatherBundle> {
  const result = await requestJson<WeatherBundleResponse>(`/api/weather/bundle?zip=${encodeURIComponent(zip)}`, {
    method: "GET"
  });

  if (!result) {
    throw new Error("Weather bundle was empty.");
  }

  return {
    overview: result.overview,
    mapConfig: result.mapConfig
  };
}
