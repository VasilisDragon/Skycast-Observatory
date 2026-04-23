using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Contracts;
using WeatherSite.Api.Models;
using WeatherSite.Api.Services;

namespace WeatherSite.Api.IntegrationTests;

public sealed class WeatherSiteApplicationFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IZipResolver>();
            services.RemoveAll<IResolvedLocationService>();
            services.RemoveAll<IWeatherOverviewService>();
            services.RemoveAll<IMapConfigurationService>();
            services.RemoveAll<IMapTileProxyService>();

            services.PostConfigure<WeatherSiteOptions>(options =>
            {
                options.CookieName = "weather_home_zip";
                options.CookieLifetimeDays = 365;
            });

            services.AddSingleton<IZipResolver, StubZipResolver>();
            services.AddSingleton<IResolvedLocationService, StubResolvedLocationService>();
            services.AddSingleton<IWeatherOverviewService, StubWeatherOverviewService>();
            services.AddSingleton<IMapConfigurationService, StubMapConfigurationService>();
            services.AddSingleton<IMapTileProxyService, StubMapTileProxyService>();
        });
    }
}

internal sealed class StubZipResolver : IZipResolver
{
    public bool IsValid(string? zip) => zip is { Length: 5 } && zip.All(char.IsDigit);

    public Task<ZipLocation> ResolveAsync(string zip, CancellationToken cancellationToken) =>
        Task.FromResult(new ZipLocation(zip, 41.8864, -87.6186, false, "Chicago", "IL"));
}

internal sealed class StubResolvedLocationService : IResolvedLocationService
{
    public Task<ResolvedLocationContext> GetResolvedLocationAsync(string zip, CancellationToken cancellationToken) =>
        Task.FromResult(new ResolvedLocationContext(
            new ZipLocation(zip, 41.8864, -87.6186, false, "Chicago", "IL"),
            new PointInfo(
                41.8864,
                -87.6186,
                "Chicago",
                "IL",
                "America/Chicago",
                "KLOT",
                "https://example.com/forecast",
                "https://example.com/hourly",
                "https://example.com/stations",
                "alerts/active?point=41.8864,-87.6186")));
}

internal sealed class StubWeatherOverviewService : IWeatherOverviewService
{
    public Task<WeatherOverviewResponse> GetOverviewAsync(string zip, CancellationToken cancellationToken)
    {
        var location = new LocationSummary(zip, 41.8864, -87.6186, "Chicago", "IL", "America/Chicago", false, "KLOT");
        return Task.FromResult(new WeatherOverviewResponse(
            location,
            new CurrentConditionsDto(
                61,
                61,
                70,
                12,
                18,
                "SW",
                10,
                29.92,
                "Partly cloudy",
                null,
                "Latest observation",
                "KLOT",
                DateTimeOffset.Parse("2026-04-07T14:00:00Z"),
                false),
            [
                new HourlyForecastPoint(DateTimeOffset.Parse("2026-04-07T15:00:00Z"), 62, 20, 68, 12, "SW", "Partly cloudy", null, true),
                new HourlyForecastPoint(DateTimeOffset.Parse("2026-04-07T16:00:00Z"), 64, 25, 65, 14, "SW", "Breezy", null, true)
            ],
            [
                new DailyForecastPoint(DateOnly.Parse("2026-04-07"), "Today", 65, 48, 30, 18, "Partly cloudy", null)
            ],
            [
                new TextForecastPeriod(
                    "This Afternoon",
                    DateTimeOffset.Parse("2026-04-07T17:00:00Z"),
                    DateTimeOffset.Parse("2026-04-07T23:00:00Z"),
                    true,
                    65,
                    20,
                    "Partly cloudy",
                    "Partly cloudy with a light southwest breeze.",
                    null)
            ],
            [
                new AlertSummary(
                    "alert-1",
                    "Wind Advisory",
                    "Moderate",
                    "Expected",
                    "Wind Advisory in effect.",
                    null,
                    DateTimeOffset.Parse("2026-04-07T12:00:00Z"),
                    DateTimeOffset.Parse("2026-04-08T00:00:00Z"),
                    true,
                    "Cook County",
                    null)
            ],
            DateTimeOffset.Parse("2026-04-07T14:01:00Z"),
            new DataFreshness(
                DateTimeOffset.Parse("2026-04-07T14:00:00Z"),
                DateTimeOffset.Parse("2026-04-07T14:00:00Z"),
                DateTimeOffset.Parse("2026-04-07T13:59:00Z"))));
    }

    public Task<WeatherOverviewResponse> GetOverviewAsync(
        ResolvedLocationContext context,
        CancellationToken cancellationToken)
    {
        return GetOverviewAsync(context.ZipLocation.Zip, cancellationToken);
    }
}

internal sealed class StubMapConfigurationService : IMapConfigurationService
{
    public Task<MapConfigResponse> GetConfigAsync(string zip, CancellationToken cancellationToken)
    {
        var location = new LocationSummary(zip, 41.8864, -87.6186, "Chicago", "IL", "America/Chicago", false, "KLOT");
        return Task.FromResult(new MapConfigResponse(
            location,
            41.8864,
            -87.6186,
            7,
            true,
            false,
            null,
            null,
            [
                new MapLayerDescriptor(
                    "local-radar-klot",
                    "opengeo",
                    "local-radar-klot",
                    "KLOT Live Radar",
                    "Local live radar",
                    "/api/maps/tiles/opengeo/local-radar-klot/{z}/{x}/{y}.png",
                    0.92,
                    true,
                    true,
                    "time",
                    ["2026-04-07T14:00:00Z", "2026-04-07T14:05:00Z"],
                    "Reflectivity",
                    [new MapLegendEntry("Heavy", "#ff7a5c")]),
                new MapLayerDescriptor(
                    "hazards",
                    "opengeo",
                    "hazards",
                    "Active Hazards",
                    "Alerts overlay",
                    "/api/maps/tiles/opengeo/hazards/{z}/{x}/{y}.png",
                    0.84,
                    true,
                    false,
                    null,
                    [],
                    "Hazards",
                    [new MapLegendEntry("Watch", "#f1c96b")])
            ]));
    }

    public Task<MapConfigResponse> GetConfigAsync(ResolvedLocationContext context, CancellationToken cancellationToken)
    {
        return GetConfigAsync(context.ZipLocation.Zip, cancellationToken);
    }
}

internal sealed class StubMapTileProxyService : IMapTileProxyService
{
    private static readonly byte[] PngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9VEJ5kAAAAAASUVORK5CYII=");

    public Task<MapTileResult> GetTileAsync(string provider, string layer, int z, int x, int y, string? time, CancellationToken cancellationToken) =>
        Task.FromResult(new MapTileResult(PngBytes, "image/png", 60));
}
