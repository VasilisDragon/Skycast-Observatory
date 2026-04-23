namespace WeatherSite.Api.Contracts;

public sealed record AirportDto(
    string Icao,
    string Name,
    string City,
    string State,
    double Latitude,
    double Longitude,
    int? ElevationFt);

public sealed record AirportWithDistanceDto(
    AirportDto Airport,
    double MilesFromOrigin);

public sealed record AirportSearchResponse(
    IReadOnlyList<AirportDto> Matches,
    IReadOnlyList<AirportWithDistanceDto> Nearest);

public sealed record SaveHomeAirportRequest(string Icao);

public sealed record SavedAirportPreference(
    string Icao,
    AirportDto Airport,
    DateTimeOffset SavedAtUtc);

public sealed record SaveHomeAirportResponse(SavedAirportPreference SavedAirport);

public sealed record FlightCategoryDto(
    string Category,
    int? CeilingFt,
    double? VisibilitySm);

public sealed record CloudLayerDto(
    string Cover,
    int? BaseFt);

public sealed record MetarObservationDto(
    string Icao,
    string? StationName,
    DateTimeOffset? ObservedAtUtc,
    double? TemperatureC,
    double? DewpointC,
    int? WindDirectionDeg,
    double? WindSpeedKt,
    double? WindGustKt,
    double? VisibilityStatuteMiles,
    double? AltimeterInHg,
    string? WeatherString,
    IReadOnlyList<CloudLayerDto> Clouds,
    string? RawText,
    FlightCategoryDto FlightCategory,
    double? Latitude,
    double? Longitude,
    int? ElevationFt);

public sealed record AviationPanelStatus(
    string Source,
    DateTimeOffset? FetchedAtUtc,
    bool Throttled,
    bool Stale,
    string? Message);

public sealed record MetarResponse(
    string Icao,
    MetarObservationDto? Latest,
    IReadOnlyList<MetarObservationDto> Trend,
    AviationPanelStatus Status);

public sealed record MetarBatchEntry(
    string Icao,
    string Status,
    MetarObservationDto? Latest);

public sealed record MetarBatchResponse(
    IReadOnlyList<MetarBatchEntry> Entries,
    AviationPanelStatus Status);

public sealed record StationsBboxEntry(
    AirportDto Airport,
    string MetarStatus,
    MetarObservationDto? Latest);

public sealed record StationsBboxResponse(
    IReadOnlyList<StationsBboxEntry> Stations,
    int TotalInBbox,
    bool Truncated,
    double SnapWest,
    double SnapSouth,
    double SnapEast,
    double SnapNorth,
    AviationPanelStatus Status);

public sealed record TafPeriodDto(
    DateTimeOffset FromUtc,
    DateTimeOffset ToUtc,
    string? ChangeType,
    int? ProbabilityPct,
    int? WindDirectionDeg,
    double? WindSpeedKt,
    double? WindGustKt,
    double? VisibilityStatuteMiles,
    string? WeatherString,
    IReadOnlyList<CloudLayerDto> Clouds,
    FlightCategoryDto FlightCategory);

public sealed record TafReportDto(
    string Icao,
    string? StationName,
    DateTimeOffset? IssuedAtUtc,
    DateTimeOffset? ValidFromUtc,
    DateTimeOffset? ValidToUtc,
    string? RawText,
    IReadOnlyList<TafPeriodDto> Periods,
    double? Latitude,
    double? Longitude);

public sealed record TafResponse(
    string Icao,
    TafReportDto? Report,
    AviationPanelStatus Status);

public sealed record HazardFeatureDto(
    string Id,
    string Kind,
    string? Hazard,
    string? Severity,
    DateTimeOffset? ValidFromUtc,
    DateTimeOffset? ValidToUtc,
    string? RawText,
    IReadOnlyList<IReadOnlyList<double>> PolygonLatLon);

public sealed record HazardsResponse(
    string Kind,
    IReadOnlyList<HazardFeatureDto> Features,
    AviationPanelStatus Status);

public sealed record PirepPointDto(
    string Id,
    double Latitude,
    double Longitude,
    DateTimeOffset? ObservedAtUtc,
    int? AltitudeFt,
    string? AircraftType,
    string? RawText,
    string? TurbulenceIntensity,
    string? IcingIntensity);

public sealed record PirepsResponse(
    IReadOnlyList<PirepPointDto> Features,
    AviationPanelStatus Status);

public sealed record WindsAloftLevelDto(
    int AltitudeFt,
    int? WindDirectionDeg,
    int? WindSpeedKt,
    int? TemperatureC);

public sealed record WindsAloftStationDto(
    string StationId,
    IReadOnlyList<WindsAloftLevelDto> Levels);

public sealed record WindsAloftResponse(
    string Region,
    DateTimeOffset? ValidFromUtc,
    DateTimeOffset? ValidToUtc,
    IReadOnlyList<WindsAloftStationDto> Stations,
    AviationPanelStatus Status);
