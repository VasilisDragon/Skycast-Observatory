using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.Models;

public sealed record ZipLocation(
    string Zip,
    double Latitude,
    double Longitude,
    bool IsApproximate,
    string? FallbackCity = null,
    string? FallbackState = null);

public sealed record PointInfo(
    double Latitude,
    double Longitude,
    string City,
    string State,
    string TimeZone,
    string? RadarStation,
    string ForecastUrl,
    string ForecastHourlyUrl,
    string ObservationStationsUrl,
    string AlertsUrl);

public sealed record ResolvedLocationContext(
    ZipLocation ZipLocation,
    PointInfo PointInfo)
{
    public LocationSummary ToLocationSummary() =>
        new(
            ZipLocation.Zip,
            ZipLocation.Latitude,
            ZipLocation.Longitude,
            PointInfo.City,
            PointInfo.State,
            PointInfo.TimeZone,
            ZipLocation.IsApproximate,
            PointInfo.RadarStation);
}

public sealed record ObservationSnapshot(
    CurrentConditionsDto Conditions,
    bool IsFresh);

public sealed record MapTileResult(
    byte[] Bytes,
    string ContentType,
    int CacheSeconds);

public sealed record AirportRecord(
    string Icao,
    string Name,
    string City,
    string State,
    double Latitude,
    double Longitude,
    int? ElevationFt);

public sealed record AirportDistance(
    AirportRecord Airport,
    double MilesFromOrigin);
