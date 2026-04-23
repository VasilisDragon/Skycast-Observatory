import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  MapConfigResponse,
  SavedLocationPreference,
  SaveHomeLocationResponse,
  WeatherBundleResponse,
  WeatherOverviewResponse
} from "./types";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private sources = new Map<string, Record<string, unknown>>();
    private layers = new Map<string, Record<string, unknown>>();

    addControl() {}

    addLayer(layer: Record<string, unknown>) {
      this.layers.set(String(layer.id), layer);
    }

    addSource(id: string, source: Record<string, unknown>) {
      this.sources.set(id, {
        ...source,
        setData: vi.fn(),
        setTiles: vi.fn()
      });
    }

    easeTo() {}

    getLayer(id: string) {
      return this.layers.get(id);
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    getStyle() {
      return {
        layers: []
      };
    }

    moveLayer() {}

    on(event: string, handler: () => void) {
      if (event === "load") {
        handler();
      }
    }

    remove() {}

    setLayoutProperty() {}

    setPaintProperty() {}

    setProjection() {}
  }

  return {
    Map: MockMap,
    addProtocol: vi.fn(),
    NavigationControl: class {}
  };
});

const savedLocation: SavedLocationPreference = {
  zip: "60601",
  location: {
    zip: "60601",
    latitude: 41.8864,
    longitude: -87.6186,
    city: "Chicago",
    state: "IL",
    timeZone: "America/Chicago",
    isApproximate: false,
    radarStation: "KLOT"
  },
  savedAtUtc: "2026-04-07T14:00:00Z"
};

const overview: WeatherOverviewResponse = {
  location: savedLocation.location,
  current: {
    temperatureF: 61,
    feelsLikeF: 61,
    humidityPercent: 70,
    windSpeedMph: 12,
    windGustMph: 18,
    windDirection: "SW",
    visibilityMiles: 10,
    pressureInHg: 29.92,
    summary: "Partly cloudy",
    iconUrl: null,
    source: "Latest observation",
    stationName: "KLOT",
    observedAtUtc: "2026-04-07T14:00:00Z",
    isEstimated: false
  },
  hourlyForecast: [
    {
      startsAt: "2026-04-07T15:00:00Z",
      temperatureF: 62,
      precipitationChancePercent: 20,
      humidityPercent: 65,
      windSpeedMph: 14,
      windDirection: "SW",
      summary: "Breezy",
      iconUrl: null,
      isDaytime: true
    }
  ],
  dailyForecast: [
    {
      date: "2026-04-07",
      label: "Today",
      highTemperatureF: 65,
      lowTemperatureF: 48,
      precipitationChancePercent: 30,
      maxWindSpeedMph: 18,
      summary: "Partly cloudy",
      iconUrl: null
    }
  ],
  textForecast: [
    {
      name: "This Afternoon",
      startsAt: "2026-04-07T17:00:00Z",
      endsAt: "2026-04-07T22:00:00Z",
      isDaytime: true,
      temperatureF: 65,
      precipitationChancePercent: 20,
      summary: "Partly cloudy",
      detailedForecast: "Partly cloudy with a light southwest breeze.",
      iconUrl: null
    }
  ],
  alerts: [
    {
      id: "alert-1",
      event: "Wind Advisory",
      severity: "Moderate",
      urgency: "Expected",
      headline: "Wind Advisory in effect.",
      description: null,
      effective: "2026-04-07T12:00:00Z",
      ends: "2026-04-08T00:00:00Z",
      isActive: true,
      areaDescription: "Cook County",
      instruction: null
    }
  ],
  retrievedAtUtc: "2026-04-07T14:00:00Z",
  freshness: {
    forecastUpdatedAtUtc: "2026-04-07T14:00:00Z",
    observationUpdatedAtUtc: "2026-04-07T14:00:00Z",
    alertsUpdatedAtUtc: "2026-04-07T13:59:00Z"
  }
};

const mapConfig: MapConfigResponse = {
  location: savedLocation.location,
  centerLatitude: 41.8864,
  centerLongitude: -87.6186,
  defaultZoom: 7,
  supportsGlobe: true,
  localBasemapAvailable: false,
  worldPmtilesUrl: null,
  regionalPmtilesUrl: null,
  layers: [
    {
      id: "local-radar-klot",
      provider: "opengeo",
      layer: "local-radar-klot",
      title: "KLOT Live Radar",
      description: "Local live radar",
      tileUrlTemplate: "/api/maps/tiles/opengeo/local-radar-klot/{z}/{x}/{y}.png",
      defaultOpacity: 0.92,
      defaultVisible: true,
      supportsTime: true,
      timeDimensionName: "time",
      times: ["2026-04-07T14:00:00Z", "2026-04-07T14:05:00Z"],
      legendTitle: "Reflectivity",
      legend: [{ label: "Heavy", color: "#ff7a5c" }]
    }
  ]
};

const weatherBundle: WeatherBundleResponse = {
  overview,
  mapConfig
};

const saveResponse: SaveHomeLocationResponse = {
  savedLocation,
  bundle: weatherBundle
};

describe("App", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("shows the first-visit prompt when no cookie is present", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<App />);

    expect(await screen.findByText(/No saved ZIP is loaded yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Home ZIP code/i)).toBeInTheDocument();
  });

  it("saves a ZIP and renders the forecast dashboard", async () => {
    fetchMock.mockImplementation(buildFetchHandler({
      bundle: weatherBundle,
      savedLocation,
      startupCookieStatus: 204
    }));

    render(<App />);

    await userEvent.type(screen.getByLabelText(/Home ZIP code/i), "60601");
    await userEvent.click(screen.getAllByRole("button", { name: /Save ZIP/i })[0]);

    expect(await screen.findByText(/Current conditions, hourly motion/i)).toBeInTheDocument();
    expect(screen.getAllByText("Chicago, IL").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session/home-location",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("auto-loads the saved location on return visits", async () => {
    fetchMock.mockImplementation(buildFetchHandler({
      bundle: weatherBundle,
      savedLocation,
      startupCookieStatus: 200
    }));

    render(<App />);

    expect(await screen.findByText(/Current conditions, hourly motion, and the next seven days\./i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByDisplayValue("60601")).toBeInTheDocument();
    });
  });

  it("switches out of cookie-check mode as soon as the saved ZIP is found", async () => {
    const bundleDeferred = createDeferred<Response>();

    fetchMock.mockImplementation(buildFetchHandler({
      bundle: bundleDeferred.promise,
      savedLocation,
      startupCookieStatus: 200
    }));

    render(<App />);

    expect(await screen.findByText(/Loading live weather, maps, and alerts for 60601/i)).toBeInTheDocument();
    expect(screen.queryByText(/Checking for a saved ZIP cookie/i)).not.toBeInTheDocument();

    bundleDeferred.resolve(jsonResponse(weatherBundle));

    expect(await screen.findByText(/Current conditions, hourly motion, and the next seven days\./i)).toBeInTheDocument();
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function buildFetchHandler(options: {
  bundle: WeatherBundleResponse | Promise<Response>;
  savedLocation: SavedLocationPreference;
  startupCookieStatus: 200 | 204;
}) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/session/home-location" && method === "GET") {
      return Promise.resolve(
        options.startupCookieStatus === 204
          ? new Response(null, { status: 204 })
          : jsonResponse(options.savedLocation)
      );
    }

    if (url === "/api/session/home-location" && method === "POST") {
      return Promise.resolve(jsonResponse(saveResponse));
    }

    if (url.startsWith("/api/weather/bundle")) {
      return Promise.resolve(
        options.bundle instanceof Promise
          ? options.bundle
          : jsonResponse(options.bundle)
      );
    }

    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  };
}
