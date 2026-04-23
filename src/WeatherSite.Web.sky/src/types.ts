export type UnitSystem = "imperial" | "metric";

export interface LocationSummary {
  zip: string;
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  timeZone: string;
  isApproximate: boolean;
  radarStation?: string | null;
}

export interface SaveHomeLocationRequest {
  zip: string;
}

export interface SavedLocationPreference {
  zip: string;
  location: LocationSummary;
  savedAtUtc: string;
}

export interface SaveHomeLocationResponse {
  savedLocation: SavedLocationPreference;
  bundle: WeatherBundleResponse;
}

export interface CurrentConditionsDto {
  temperatureF: number;
  feelsLikeF: number;
  humidityPercent?: number | null;
  windSpeedMph?: number | null;
  windGustMph?: number | null;
  windDirection?: string | null;
  visibilityMiles?: number | null;
  pressureInHg?: number | null;
  summary: string;
  iconUrl?: string | null;
  source: string;
  stationName?: string | null;
  observedAtUtc: string;
  isEstimated: boolean;
}

export interface HourlyForecastPoint {
  startsAt: string;
  temperatureF: number;
  precipitationChancePercent?: number | null;
  humidityPercent?: number | null;
  windSpeedMph: number;
  windDirection: string;
  summary: string;
  iconUrl?: string | null;
  isDaytime: boolean;
}

export interface DailyForecastPoint {
  date: string;
  label: string;
  highTemperatureF: number;
  lowTemperatureF: number;
  precipitationChancePercent?: number | null;
  maxWindSpeedMph: number;
  summary: string;
  iconUrl?: string | null;
}

export interface TextForecastPeriod {
  name: string;
  startsAt: string;
  endsAt: string;
  isDaytime: boolean;
  temperatureF: number;
  precipitationChancePercent?: number | null;
  summary: string;
  detailedForecast: string;
  iconUrl?: string | null;
}

export interface AlertSummary {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description?: string | null;
  effective?: string | null;
  ends?: string | null;
  isActive: boolean;
  areaDescription?: string | null;
  instruction?: string | null;
}

export interface DataFreshness {
  forecastUpdatedAtUtc: string;
  observationUpdatedAtUtc?: string | null;
  alertsUpdatedAtUtc?: string | null;
}

export interface WeatherOverviewResponse {
  location: LocationSummary;
  current: CurrentConditionsDto;
  hourlyForecast: HourlyForecastPoint[];
  dailyForecast: DailyForecastPoint[];
  textForecast: TextForecastPeriod[];
  alerts: AlertSummary[];
  retrievedAtUtc: string;
  freshness: DataFreshness;
}

export interface MapLegendEntry {
  label: string;
  color: string;
}

export interface MapLayerDescriptor {
  id: string;
  provider: string;
  layer: string;
  title: string;
  description: string;
  tileUrlTemplate: string;
  defaultOpacity: number;
  defaultVisible: boolean;
  supportsTime: boolean;
  timeDimensionName?: string | null;
  times: string[];
  legendTitle: string;
  legend: MapLegendEntry[];
}

export interface MapConfigResponse {
  location: LocationSummary;
  centerLatitude: number;
  centerLongitude: number;
  defaultZoom: number;
  supportsGlobe: boolean;
  localBasemapAvailable: boolean;
  worldPmtilesUrl?: string | null;
  regionalPmtilesUrl?: string | null;
  layers: MapLayerDescriptor[];
}

export interface WeatherBundle {
  overview: WeatherOverviewResponse;
  mapConfig: MapConfigResponse;
}

export interface WeatherBundleResponse {
  overview: WeatherOverviewResponse;
  mapConfig: MapConfigResponse;
}

export interface MapCamera {
  latitude: number;
  longitude: number;
  zoom: number;
}

export type ProjectionMode = "mercator" | "globe";
