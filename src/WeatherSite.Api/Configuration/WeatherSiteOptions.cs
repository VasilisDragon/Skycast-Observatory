using System.ComponentModel.DataAnnotations;

namespace WeatherSite.Api.Configuration;

public sealed class WeatherSiteOptions
{
    public const string SectionName = "WeatherSite";

    [Required]
    public string UserAgent { get; set; } = "WeatherSite/1.0 (+https://weather.vasilis.club; contact@vasilis.club)";

    [Required]
    public string ZipCentroidsPath { get; set; } = "App_Data/zcta-centroids.json";

    [Range(5, 180)]
    public int ObservationFreshnessMinutes { get; set; } = 45;

    [Required]
    public string CookieName { get; set; } = "weather_home_zip";

    [Range(1, 730)]
    public int CookieLifetimeDays { get; set; } = 365;

    [Required]
    public string DataProtectionKeysPath { get; set; } = "App_Data/DataProtectionKeys";

    public bool UseForwardedHeaders { get; set; } = true;

    public bool EnforceHttpsRedirection { get; set; } = true;

    [Range(10, 10_000)]
    public int ApiRequestsPerMinute { get; set; } = 120;

    [Range(60, 20_000)]
    public int TileRequestsPerMinute { get; set; } = 600;

    // Point endpoints (METAR batch, PIREP radial, bbox-stations, airport search)
    // fan out heavily: one pageview produces ~8 calls. Higher ceiling.
    [Range(10, 10_000)]
    public int AviationPointRequestsPerMinute { get; set; } = 120;

    // Polygon endpoints (AIRMET/SIGMET/CWA, winds-aloft) are expensive and
    // slow-moving. Keep headroom so a dense PIREP burst can't starve SIGMET.
    [Range(10, 10_000)]
    public int AviationPolyRequestsPerMinute { get; set; } = 30;

    [Range(1, 200)]
    public int AviationUpstreamPointRequestsPerMinute { get; set; } = 60;

    [Range(1, 100)]
    public int AviationUpstreamPolyRequestsPerMinute { get; set; } = 15;

    [Required]
    public string AirportsPath { get; set; } = "App_Data/airports.json";

    [Required]
    public string AviationCookieName { get; set; } = "weather_home_icao";

    public BasemapOptions Basemaps { get; set; } = new();
}

public sealed class BasemapOptions
{
    [Required]
    public string WorldUrl { get; set; } = "/tiles/basemaps/world.pmtiles";

    [Required]
    public string RegionalUrl { get; set; } = "/tiles/basemaps/usa.pmtiles";
}
