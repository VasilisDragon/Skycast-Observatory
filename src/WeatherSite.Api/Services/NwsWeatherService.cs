using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Contracts;
using WeatherSite.Api.Models;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IResolvedLocationService
{
    Task<ResolvedLocationContext> GetResolvedLocationAsync(string zip, CancellationToken cancellationToken);
}

public interface IWeatherOverviewService
{
    Task<WeatherOverviewResponse> GetOverviewAsync(string zip, CancellationToken cancellationToken);
    Task<WeatherOverviewResponse> GetOverviewAsync(ResolvedLocationContext context, CancellationToken cancellationToken);
}

public sealed class NwsWeatherService : IResolvedLocationService, IWeatherOverviewService
{
    private static readonly TimeSpan PointsCacheDuration = TimeSpan.FromHours(24);
    private static readonly TimeSpan ForecastCacheDuration = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan AlertsCacheDuration = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan AlertsUpstreamTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan StationsCacheDuration = TimeSpan.FromHours(24);
    private static readonly TimeSpan ObservationCacheDuration = TimeSpan.FromMinutes(2);

    private readonly IZipResolver _zipResolver;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _timeProvider;
    private readonly WeatherSiteOptions _options;
    private readonly ILogger<NwsWeatherService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public NwsWeatherService(
        IZipResolver zipResolver,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        TimeProvider timeProvider,
        IOptions<WeatherSiteOptions> options,
        ILogger<NwsWeatherService> logger,
        IHttpContextAccessor httpContextAccessor)
    {
        _zipResolver = zipResolver;
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _timeProvider = timeProvider;
        _options = options.Value;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
    }

    private ServerTimingCollector? Timings =>
        _httpContextAccessor.HttpContext?.RequestServices.GetService<ServerTimingCollector>();

    public async Task<ResolvedLocationContext> GetResolvedLocationAsync(string zip, CancellationToken cancellationToken)
    {
        ZipLocation location;
        using (Timings?.Measure("resolve-zip"))
        {
            location = await _zipResolver.ResolveAsync(zip, cancellationToken);
        }
        var cacheKey = $"nws:points:{location.Zip}";
        var json = await GetCachedStringAsync(
            "nws-points",
            cacheKey,
            PointsCacheDuration,
            async ct =>
            {
                var requestUri =
                    $"points/{location.Latitude.ToString(CultureInfo.InvariantCulture)},{location.Longitude.ToString(CultureInfo.InvariantCulture)}";
                return await SendNwsRequestAsync(requestUri, ct);
            },
            cancellationToken);

        var pointInfo = ParsePointInfo(json, location);
        return new ResolvedLocationContext(location, pointInfo);
    }

    public async Task<WeatherOverviewResponse> GetOverviewAsync(string zip, CancellationToken cancellationToken)
    {
        var context = await GetResolvedLocationAsync(zip, cancellationToken);
        return await GetOverviewAsync(context, cancellationToken);
    }

    public async Task<WeatherOverviewResponse> GetOverviewAsync(
        ResolvedLocationContext context,
        CancellationToken cancellationToken)
    {
        var hourlyForecastTask = GetCachedStringAsync(
            "nws-hourly",
            $"nws:forecast-hourly:{context.PointInfo.ForecastHourlyUrl}",
            ForecastCacheDuration,
            ct => SendNwsRequestAsync(context.PointInfo.ForecastHourlyUrl, ct),
            cancellationToken);

        var textForecastTask = GetCachedStringAsync(
            "nws-forecast",
            $"nws:forecast:{context.PointInfo.ForecastUrl}",
            ForecastCacheDuration,
            ct => SendNwsRequestAsync(context.PointInfo.ForecastUrl, ct),
            cancellationToken);

        var alertsTask = GetAlertsWithTimeoutAsync(context, cancellationToken);

        await Task.WhenAll(hourlyForecastTask, textForecastTask, alertsTask);

        var hourlyForecastRoot = JsonNode.Parse(await hourlyForecastTask) ?? throw new InvalidOperationException("NWS hourly forecast payload was empty.");
        var textForecastRoot = JsonNode.Parse(await textForecastTask) ?? throw new InvalidOperationException("NWS forecast payload was empty.");
        var (alertsJson, alertsPartial) = await alertsTask;
        var alertsRoot = alertsJson is null ? null : JsonNode.Parse(alertsJson);

        var hourlyForecast = ParseHourlyForecast(hourlyForecastRoot).Take(48).ToArray();
        var textForecast = ParseTextForecast(textForecastRoot).ToArray();
        var dailyForecast = BuildDailyForecast(hourlyForecast).Take(7).ToArray();
        var current = await BuildCurrentConditionsAsync(context, hourlyForecast.FirstOrDefault(), cancellationToken);
        var alerts = alertsRoot is null ? Array.Empty<AlertSummary>() : ParseAlerts(alertsRoot).ToArray();

        var forecastUpdatedAt = textForecastRoot["properties"]?.GetDateTimeOffset("updateTime")
            ?? textForecastRoot["properties"]?.GetDateTimeOffset("generatedAt")
            ?? _timeProvider.GetUtcNow();
        var alertsUpdatedAt = alertsRoot?["updated"].AsDateTimeOffset();

        return new WeatherOverviewResponse(
            context.ToLocationSummary(),
            current,
            hourlyForecast,
            dailyForecast,
            textForecast,
            alerts,
            _timeProvider.GetUtcNow(),
            new DataFreshness(forecastUpdatedAt, current.ObservedAtUtc, alertsUpdatedAt, alertsPartial));
    }

    private async Task<(string? Json, bool Partial)> GetAlertsWithTimeoutAsync(
        ResolvedLocationContext context,
        CancellationToken cancellationToken)
    {
        var cacheKey = $"nws:alerts:{context.ZipLocation.Zip}";
        if (_cache.TryGetValue<string>(cacheKey, out var cached) && cached is not null)
        {
            Timings?.RecordCacheSource("nws-alerts", "cache");
            return (cached, false);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(AlertsUpstreamTimeout);
        var start = Stopwatch.GetTimestamp();
        try
        {
            var json = await SendNwsRequestAsync(context.PointInfo.AlertsUrl, timeoutCts.Token);
            Timings?.Record("nws-alerts", Stopwatch.GetElapsedTime(start));
            _cache.Set(cacheKey, json, AlertsCacheDuration);
            return (json, false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            Timings?.Record("nws-alerts", Stopwatch.GetElapsedTime(start), "timeout");
            _logger.LogWarning(
                "NWS alerts fetch exceeded {TimeoutSeconds}s for ZIP {Zip}; returning partial bundle.",
                AlertsUpstreamTimeout.TotalSeconds,
                context.ZipLocation.Zip);
            return (null, true);
        }
        catch (HttpRequestException exception)
        {
            Timings?.Record("nws-alerts", Stopwatch.GetElapsedTime(start), "error");
            _logger.LogWarning(
                exception,
                "NWS alerts fetch failed for ZIP {Zip}; returning partial bundle.",
                context.ZipLocation.Zip);
            return (null, true);
        }
    }

    private async Task<CurrentConditionsDto> BuildCurrentConditionsAsync(
        ResolvedLocationContext context,
        HourlyForecastPoint? firstHourlyForecast,
        CancellationToken cancellationToken)
    {
        try
        {
            var stationIds = await GetObservationStationsAsync(context.PointInfo, cancellationToken);
            foreach (var stationId in stationIds.Take(5))
            {
                var observationJson = await GetCachedStringAsync(
                    "nws-observation",
                    $"nws:observation:{stationId}",
                    ObservationCacheDuration,
                    ct => SendNwsRequestAsync($"stations/{stationId}/observations/latest?require_qc=true", ct),
                    cancellationToken);

                var snapshot = ParseObservation(observationJson, firstHourlyForecast);
                if (snapshot is not null)
                {
                    return snapshot.Conditions;
                }
            }
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Falling back to forecast-estimated current conditions for ZIP {Zip}.", context.ZipLocation.Zip);
        }

        if (firstHourlyForecast is not null)
        {
            return CreateEstimatedCurrent(firstHourlyForecast);
        }

        throw new InvalidOperationException("No forecast data was available to construct current conditions.");
    }

    private async Task<IReadOnlyList<string>> GetObservationStationsAsync(PointInfo pointInfo, CancellationToken cancellationToken)
    {
        var json = await GetCachedStringAsync(
            "nws-stations",
            $"nws:stations:{pointInfo.ObservationStationsUrl}",
            StationsCacheDuration,
            ct => SendNwsRequestAsync(pointInfo.ObservationStationsUrl, ct),
            cancellationToken);

        var root = JsonNode.Parse(json);
        var features = root?["features"]?.AsArray();
        if (features is null)
        {
            return Array.Empty<string>();
        }

        return features
            .Select(feature => feature?["properties"]?["stationIdentifier"].AsString())
            .Where(identifier => !string.IsNullOrWhiteSpace(identifier))
            .Cast<string>()
            .ToArray();
    }

    private PointInfo ParsePointInfo(string json, ZipLocation zipLocation)
    {
        var root = JsonNode.Parse(json) ?? throw new InvalidOperationException("Unable to parse NWS point response.");
        var properties = root["properties"]?.AsObject() ?? throw new InvalidOperationException("NWS point response is missing properties.");
        var relativeLocation = properties["relativeLocation"]?["properties"];

        var latitude = root["geometry"]?["coordinates"]?[1].AsDouble() ?? zipLocation.Latitude;
        var longitude = root["geometry"]?["coordinates"]?[0].AsDouble() ?? zipLocation.Longitude;

        var city = relativeLocation?.GetString("city") ?? zipLocation.FallbackCity ?? $"ZIP {zipLocation.Zip}";
        var state = relativeLocation?.GetString("state") ?? zipLocation.FallbackState ?? "US";
        var timeZone = properties.GetString("timeZone") ?? "America/Chicago";
        var radarStation = properties.GetString("radarStation");
        var forecastUrl = properties.GetString("forecast") ?? throw new InvalidOperationException("NWS point response did not include a forecast URL.");
        var forecastHourlyUrl = properties.GetString("forecastHourly") ?? throw new InvalidOperationException("NWS point response did not include an hourly forecast URL.");
        var stationsUrl = properties.GetString("observationStations") ?? throw new InvalidOperationException("NWS point response did not include an observation stations URL.");
        var alertsUrl =
            $"alerts/active?point={latitude.ToString(CultureInfo.InvariantCulture)},{longitude.ToString(CultureInfo.InvariantCulture)}";

        return new PointInfo(latitude, longitude, city, state, timeZone, radarStation, forecastUrl, forecastHourlyUrl, stationsUrl, alertsUrl);
    }

    private ObservationSnapshot? ParseObservation(string json, HourlyForecastPoint? fallbackHourlyForecast)
    {
        var root = JsonNode.Parse(json);
        var properties = root?["properties"];
        if (properties is null)
        {
            return null;
        }

        var temperatureC = properties["temperature"]?["value"].AsDouble();
        var observedAt = properties.GetDateTimeOffset("timestamp");
        if (temperatureC is null || observedAt is null)
        {
            return fallbackHourlyForecast is null
                ? null
                : new ObservationSnapshot(CreateEstimatedCurrent(fallbackHourlyForecast), false);
        }

        var current = new CurrentConditionsDto(
            Math.Round(WeatherMath.CelsiusToFahrenheit(temperatureC.Value), 0),
            Math.Round(
                WeatherMath.CelsiusToFahrenheit(
                    properties["heatIndex"]?["value"].AsDouble()
                    ?? properties["windChill"]?["value"].AsDouble()
                    ?? temperatureC.Value),
                0),
            properties["relativeHumidity"]?["value"].AsInt(),
            WeatherMath.KilometersPerHourToMilesPerHour(properties["windSpeed"]?["value"].AsDouble()),
            WeatherMath.KilometersPerHourToMilesPerHour(properties["windGust"]?["value"].AsDouble()),
            ToCardinalDirection(properties["windDirection"]?["value"].AsDouble()),
            WeatherMath.MetersToMiles(properties["visibility"]?["value"].AsDouble()),
            WeatherMath.PascalsToInchesHg(properties["barometricPressure"]?["value"].AsDouble()),
            properties.GetString("textDescription")
                ?? fallbackHourlyForecast?.Summary
                ?? "Conditions unavailable",
            properties.GetString("icon") ?? fallbackHourlyForecast?.IconUrl,
            "Latest observation",
            properties.GetString("stationName"),
            observedAt.Value.ToUniversalTime(),
            false);

        var freshnessWindow = TimeSpan.FromMinutes(_options.ObservationFreshnessMinutes);
        var isFresh = _timeProvider.GetUtcNow() - observedAt.Value.ToUniversalTime() <= freshnessWindow;
        if (isFresh)
        {
            return new ObservationSnapshot(current, true);
        }

        if (fallbackHourlyForecast is not null)
        {
            return new ObservationSnapshot(CreateEstimatedCurrent(fallbackHourlyForecast), false);
        }

        return new ObservationSnapshot(current with { Source = "Stale observation", IsEstimated = true }, false);
    }

    private static CurrentConditionsDto CreateEstimatedCurrent(HourlyForecastPoint forecast) =>
        new(
            forecast.TemperatureF,
            forecast.TemperatureF,
            forecast.HumidityPercent,
            forecast.WindSpeedMph,
            null,
            forecast.WindDirection,
            null,
            null,
            forecast.Summary,
            forecast.IconUrl,
            "Forecast estimate",
            null,
            forecast.StartsAt.ToUniversalTime(),
            true);

    private static IEnumerable<HourlyForecastPoint> ParseHourlyForecast(JsonNode root)
    {
        var periods = root["properties"]?.GetArray("periods");
        if (periods is null)
        {
            yield break;
        }

        foreach (var period in periods)
        {
            var startsAt = period?.GetDateTimeOffset("startTime");
            if (startsAt is null)
            {
                continue;
            }

            yield return new HourlyForecastPoint(
                startsAt.Value,
                period?.GetDouble("temperature") ?? 0d,
                period?["probabilityOfPrecipitation"]?["value"].AsInt(),
                period?["relativeHumidity"]?["value"].AsInt(),
                WeatherMath.ExtractMaxWindSpeedMph(period?.GetString("windSpeed")),
                period?.GetString("windDirection") ?? "N",
                period?.GetString("shortForecast") ?? "Unavailable",
                period?.GetString("icon"),
                period?["isDaytime"]?.GetValue<bool>() ?? false);
        }
    }

    private static IEnumerable<TextForecastPeriod> ParseTextForecast(JsonNode root)
    {
        var periods = root["properties"]?.GetArray("periods");
        if (periods is null)
        {
            yield break;
        }

        foreach (var period in periods)
        {
            var startsAt = period?.GetDateTimeOffset("startTime");
            var endsAt = period?.GetDateTimeOffset("endTime");
            if (startsAt is null || endsAt is null)
            {
                continue;
            }

            yield return new TextForecastPeriod(
                period?.GetString("name") ?? "Forecast",
                startsAt.Value,
                endsAt.Value,
                period?["isDaytime"]?.GetValue<bool>() ?? false,
                period?.GetInt("temperature") ?? 0,
                period?["probabilityOfPrecipitation"]?["value"].AsInt(),
                period?.GetString("shortForecast") ?? "Unavailable",
                period?.GetString("detailedForecast") ?? string.Empty,
                period?.GetString("icon"));
        }
    }

    private static IEnumerable<DailyForecastPoint> BuildDailyForecast(IReadOnlyList<HourlyForecastPoint> hourlyForecast)
    {
        return hourlyForecast
            .GroupBy(period => DateOnly.FromDateTime(period.StartsAt.DateTime))
            .Select((group, index) =>
            {
                var representativePeriod =
                    group.FirstOrDefault(period => period.StartsAt.Hour is >= 12 and <= 17)
                    ?? group.First();

                return new DailyForecastPoint(
                    group.Key,
                    index == 0
                        ? "Today"
                        : group.Key.ToDateTime(TimeOnly.MinValue).ToString("ddd", CultureInfo.InvariantCulture),
                    Math.Round(group.Max(period => period.TemperatureF), 0),
                    Math.Round(group.Min(period => period.TemperatureF), 0),
                    group.Max(period => period.PrecipitationChancePercent ?? 0),
                    group.Max(period => period.WindSpeedMph),
                    representativePeriod.Summary,
                    representativePeriod.IconUrl);
            });
    }

    private static IEnumerable<AlertSummary> ParseAlerts(JsonNode? root)
    {
        var features = root?["features"]?.AsArray();
        if (features is null)
        {
            yield break;
        }

        foreach (var feature in features)
        {
            var properties = feature?["properties"];
            if (properties is null)
            {
                continue;
            }

            var ends = properties.GetDateTimeOffset("ends") ?? properties.GetDateTimeOffset("expires");
            yield return new AlertSummary(
                feature?["id"].AsString() ?? Guid.NewGuid().ToString("N"),
                properties.GetString("event") ?? "Alert",
                properties.GetString("severity") ?? "Unknown",
                properties.GetString("urgency") ?? "Unknown",
                properties.GetString("headline") ?? properties.GetString("event") ?? "Alert",
                properties.GetString("description"),
                properties.GetDateTimeOffset("effective"),
                ends,
                string.Equals(properties.GetString("status"), "Actual", StringComparison.OrdinalIgnoreCase),
                properties.GetString("areaDesc"),
                properties.GetString("instruction"));
        }
    }

    private async Task<string> SendNwsRequestAsync(string relativeOrAbsoluteUrl, CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient("weather-site:nws");
        using var response = await client.GetAsync(relativeOrAbsoluteUrl, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private async Task<string> GetCachedStringAsync(
        string phaseName,
        string cacheKey,
        TimeSpan cacheDuration,
        Func<CancellationToken, Task<string>> factory,
        CancellationToken cancellationToken)
    {
        var timings = Timings;
        if (_cache.TryGetValue<string>(cacheKey, out var cached) && cached is not null)
        {
            timings?.RecordCacheSource(phaseName, "cache");
            return cached;
        }

        var start = Stopwatch.GetTimestamp();
        var result = await factory(cancellationToken);
        timings?.Record(phaseName, Stopwatch.GetElapsedTime(start));
        _cache.Set(cacheKey, result, cacheDuration);
        return result;
    }

    private static string? ToCardinalDirection(double? degrees)
    {
        if (degrees is null)
        {
            return null;
        }

        string[] points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        var index = (int)Math.Round((degrees.Value % 360d) / 45d, MidpointRounding.AwayFromZero) % points.Length;
        return points[index];
    }
}
