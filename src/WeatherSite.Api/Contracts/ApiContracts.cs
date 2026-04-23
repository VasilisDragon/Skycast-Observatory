namespace WeatherSite.Api.Contracts;

public sealed record SaveHomeLocationRequest(string Zip);

public sealed record LocationSummary(
    string Zip,
    double Latitude,
    double Longitude,
    string City,
    string State,
    string TimeZone,
    bool IsApproximate,
    string? RadarStation);

public sealed record SavedLocationPreference(
    string Zip,
    LocationSummary Location,
    DateTimeOffset SavedAtUtc);

public sealed record SaveHomeLocationResponse(
    SavedLocationPreference SavedLocation,
    WeatherBundleResponse Bundle);

public sealed record CurrentConditionsDto(
    double TemperatureF,
    double FeelsLikeF,
    int? HumidityPercent,
    double? WindSpeedMph,
    double? WindGustMph,
    string? WindDirection,
    double? VisibilityMiles,
    double? PressureInHg,
    string Summary,
    string? IconUrl,
    string Source,
    string? StationName,
    DateTimeOffset ObservedAtUtc,
    bool IsEstimated);

public sealed record HourlyForecastPoint(
    DateTimeOffset StartsAt,
    double TemperatureF,
    int? PrecipitationChancePercent,
    int? HumidityPercent,
    double WindSpeedMph,
    string WindDirection,
    string Summary,
    string? IconUrl,
    bool IsDaytime);

public sealed record DailyForecastPoint(
    DateOnly Date,
    string Label,
    double HighTemperatureF,
    double LowTemperatureF,
    int? PrecipitationChancePercent,
    double MaxWindSpeedMph,
    string Summary,
    string? IconUrl);

public sealed record TextForecastPeriod(
    string Name,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    bool IsDaytime,
    int TemperatureF,
    int? PrecipitationChancePercent,
    string Summary,
    string DetailedForecast,
    string? IconUrl);

public sealed record AlertSummary(
    string Id,
    string Event,
    string Severity,
    string Urgency,
    string Headline,
    string? Description,
    DateTimeOffset? Effective,
    DateTimeOffset? Ends,
    bool IsActive,
    string? AreaDescription,
    string? Instruction);

public sealed record DataFreshness(
    DateTimeOffset ForecastUpdatedAtUtc,
    DateTimeOffset? ObservationUpdatedAtUtc,
    DateTimeOffset? AlertsUpdatedAtUtc,
    bool AlertsPartial = false);

public sealed record WeatherOverviewResponse(
    LocationSummary Location,
    CurrentConditionsDto Current,
    IReadOnlyList<HourlyForecastPoint> HourlyForecast,
    IReadOnlyList<DailyForecastPoint> DailyForecast,
    IReadOnlyList<TextForecastPeriod> TextForecast,
    IReadOnlyList<AlertSummary> Alerts,
    DateTimeOffset RetrievedAtUtc,
    DataFreshness Freshness);

public sealed record WeatherBundleResponse(
    WeatherOverviewResponse Overview,
    MapConfigResponse MapConfig);

public sealed record MapLegendEntry(string Label, string Color);

public sealed record MapLayerDescriptor(
    string Id,
    string Provider,
    string Layer,
    string Title,
    string Description,
    string TileUrlTemplate,
    double DefaultOpacity,
    bool DefaultVisible,
    bool SupportsTime,
    string? TimeDimensionName,
    IReadOnlyList<string> Times,
    string LegendTitle,
    IReadOnlyList<MapLegendEntry> Legend);

public sealed record MapConfigResponse(
    LocationSummary Location,
    double CenterLatitude,
    double CenterLongitude,
    int DefaultZoom,
    bool SupportsGlobe,
    bool LocalBasemapAvailable,
    string? WorldPmtilesUrl,
    string? RegionalPmtilesUrl,
    IReadOnlyList<MapLayerDescriptor> Layers);
