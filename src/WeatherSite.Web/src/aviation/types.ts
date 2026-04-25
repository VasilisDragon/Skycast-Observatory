export type FlightCategoryLabel = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKN";

export type AviationPanelSource = "live" | "cache" | "stale" | "no-data" | "error";

export interface AviationPanelStatus {
  source: AviationPanelSource;
  fetchedAtUtc?: string | null;
  throttled: boolean;
  stale: boolean;
  message?: string | null;
}

export interface AirportDto {
  icao: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  elevationFt?: number | null;
}

export interface AirportWithDistanceDto {
  airport: AirportDto;
  milesFromOrigin: number;
}

export interface AirportSearchResponse {
  matches: AirportDto[];
  nearest: AirportWithDistanceDto[];
}

export interface SavedAirportPreference {
  icao: string;
  airport: AirportDto;
  savedAtUtc: string;
}

export interface SaveHomeAirportResponse {
  savedAirport: SavedAirportPreference;
}

export interface FlightCategoryDto {
  category: FlightCategoryLabel;
  ceilingFt?: number | null;
  visibilitySm?: number | null;
}

export interface CloudLayerDto {
  cover: string;
  baseFt?: number | null;
}

export interface MetarObservationDto {
  icao: string;
  stationName?: string | null;
  observedAtUtc?: string | null;
  temperatureC?: number | null;
  dewpointC?: number | null;
  windDirectionDeg?: number | null;
  windSpeedKt?: number | null;
  windGustKt?: number | null;
  visibilityStatuteMiles?: number | null;
  altimeterInHg?: number | null;
  weatherString?: string | null;
  clouds: CloudLayerDto[];
  rawText?: string | null;
  flightCategory: FlightCategoryDto;
  latitude?: number | null;
  longitude?: number | null;
  elevationFt?: number | null;
}

export interface MetarResponse {
  icao: string;
  latest?: MetarObservationDto | null;
  trend: MetarObservationDto[];
  status: AviationPanelStatus;
}

export interface TafPeriodDto {
  fromUtc: string;
  toUtc: string;
  changeType?: string | null;
  probabilityPct?: number | null;
  windDirectionDeg?: number | null;
  windSpeedKt?: number | null;
  windGustKt?: number | null;
  visibilityStatuteMiles?: number | null;
  weatherString?: string | null;
  clouds: CloudLayerDto[];
  flightCategory: FlightCategoryDto;
}

export interface TafReportDto {
  icao: string;
  stationName?: string | null;
  issuedAtUtc?: string | null;
  validFromUtc?: string | null;
  validToUtc?: string | null;
  rawText?: string | null;
  periods: TafPeriodDto[];
  latitude?: number | null;
  longitude?: number | null;
}

export interface TafResponse {
  icao: string;
  report?: TafReportDto | null;
  status: AviationPanelStatus;
}

export interface HazardFeatureDto {
  id: string;
  kind: string;
  hazard?: string | null;
  severity?: string | null;
  validFromUtc?: string | null;
  validToUtc?: string | null;
  rawText?: string | null;
  polygonLatLon: [number, number][];
}

export interface HazardsResponse {
  kind: string;
  features: HazardFeatureDto[];
  status: AviationPanelStatus;
}

export interface PirepPointDto {
  id: string;
  latitude: number;
  longitude: number;
  observedAtUtc?: string | null;
  altitudeFt?: number | null;
  aircraftType?: string | null;
  rawText?: string | null;
  turbulenceIntensity?: string | null;
  icingIntensity?: string | null;
}

export interface PirepsResponse {
  features: PirepPointDto[];
  status: AviationPanelStatus;
}

export type MetarBatchEntryStatus = "ok" | "unavailable" | "invalid";

export interface MetarBatchEntry {
  icao: string;
  status: MetarBatchEntryStatus;
  latest?: MetarObservationDto | null;
}

export interface MetarBatchResponse {
  entries: MetarBatchEntry[];
  status: AviationPanelStatus;
}

export interface StationsBboxEntry {
  airport: AirportDto;
  metarStatus: MetarBatchEntryStatus;
  latest?: MetarObservationDto | null;
}

export interface StationsBboxResponse {
  stations: StationsBboxEntry[];
  totalInBbox: number;
  truncated: boolean;
  snapWest: number;
  snapSouth: number;
  snapEast: number;
  snapNorth: number;
  status: AviationPanelStatus;
}

export type BboxTuple = readonly [west: number, south: number, east: number, north: number];
