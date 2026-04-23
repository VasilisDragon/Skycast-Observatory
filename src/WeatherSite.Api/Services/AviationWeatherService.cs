using System.Diagnostics;
using System.Globalization;
using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IAviationWeatherService
{
    Task<AviationFetchResult> GetMetarAsync(string icao, int hours, CancellationToken cancellationToken);
    Task<AviationFetchResult> GetMetarBatchAsync(IReadOnlyCollection<string> icaos, int hours, CancellationToken cancellationToken);
    Task<AviationFetchResult> GetTafAsync(string icao, CancellationToken cancellationToken);
    Task<AviationFetchResult> GetHazardsAsync(string type, CancellationToken cancellationToken);
    Task<AviationFetchResult> GetPirepsAsync(double latitude, double longitude, int radiusNm, CancellationToken cancellationToken);
    Task<AviationFetchResult> GetWindsAloftAsync(string region, CancellationToken cancellationToken);
}

public enum AviationBucket
{
    Point,
    Poly
}

public enum AviationSource
{
    Live,
    Cache,
    StaleCache,
    NoData,
    Error
}

public sealed record AviationFetchResult(
    AviationSource Source,
    string? Payload,
    DateTimeOffset? FetchedAtUtc,
    bool Throttled,
    string? ErrorMessage = null);

public sealed class AviationWeatherService : IAviationWeatherService, IDisposable
{
    private static readonly TimeSpan MetarFreshTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MetarStaleTtl = TimeSpan.FromMinutes(90);
    private static readonly TimeSpan TafFreshTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan TafStaleTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan HazardsFreshTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan HazardsStaleTtl = TimeSpan.FromMinutes(60);
    private static readonly TimeSpan PirepsFreshTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PirepsStaleTtl = TimeSpan.FromMinutes(60);
    private static readonly TimeSpan WindsFreshTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan WindsStaleTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan UpstreamTimeout = TimeSpan.FromSeconds(6);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AviationWeatherService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly SemaphoreSlim _pointSemaphore;
    private readonly SemaphoreSlim _polySemaphore;
    private readonly TimeSpan _releaseAfter = TimeSpan.FromSeconds(60);

    public AviationWeatherService(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        TimeProvider timeProvider,
        IOptions<WeatherSiteOptions> options,
        ILogger<AviationWeatherService> logger,
        IHttpContextAccessor httpContextAccessor)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _timeProvider = timeProvider;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
        var pointPerMinute = Math.Max(1, options.Value.AviationUpstreamPointRequestsPerMinute);
        var polyPerMinute = Math.Max(1, options.Value.AviationUpstreamPolyRequestsPerMinute);
        _pointSemaphore = new SemaphoreSlim(pointPerMinute, pointPerMinute);
        _polySemaphore = new SemaphoreSlim(polyPerMinute, polyPerMinute);
    }

    public Task<AviationFetchResult> GetMetarAsync(string icao, int hours, CancellationToken cancellationToken)
    {
        var safeIcao = icao.Trim().ToUpperInvariant();
        var clampedHours = Math.Clamp(hours, 1, 24);
        var url = $"metar?ids={safeIcao}&format=json&hours={clampedHours.ToString(CultureInfo.InvariantCulture)}";
        var cacheKey = $"awc:metar:{safeIcao}:{clampedHours}";
        return FetchAsync("awc-metar", cacheKey, url, MetarFreshTtl, MetarStaleTtl, AviationBucket.Point, cancellationToken);
    }

    public Task<AviationFetchResult> GetMetarBatchAsync(IReadOnlyCollection<string> icaos, int hours, CancellationToken cancellationToken)
    {
        // Ordered, de-duplicated, uppercase — so the cache key is stable regardless
        // of client ordering. AWC accepts comma-separated ids natively.
        var normalized = icaos
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim().ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();

        if (normalized.Length == 0)
        {
            return Task.FromResult(new AviationFetchResult(AviationSource.NoData, null, _timeProvider.GetUtcNow(), false));
        }

        var clampedHours = Math.Clamp(hours, 1, 24);
        var joined = string.Join(",", normalized);
        var url = $"metar?ids={joined}&format=json&hours={clampedHours.ToString(CultureInfo.InvariantCulture)}";
        var cacheKey = $"awc:metar-batch:{joined}:{clampedHours}";
        return FetchAsync("awc-metar-batch", cacheKey, url, MetarFreshTtl, MetarStaleTtl, AviationBucket.Point, cancellationToken);
    }

    public Task<AviationFetchResult> GetTafAsync(string icao, CancellationToken cancellationToken)
    {
        var safeIcao = icao.Trim().ToUpperInvariant();
        var url = $"taf?ids={safeIcao}&format=json";
        var cacheKey = $"awc:taf:{safeIcao}";
        return FetchAsync("awc-taf", cacheKey, url, TafFreshTtl, TafStaleTtl, AviationBucket.Point, cancellationToken);
    }

    public Task<AviationFetchResult> GetHazardsAsync(string type, CancellationToken cancellationToken)
    {
        var normalized = (type ?? "airmet").Trim().ToLowerInvariant();
        var (path, cacheFragment) = normalized switch
        {
            "sigmet" => ("airsigmet?format=json&type=sigmet", "sigmet"),
            "cwa" => ("cwa?format=json", "cwa"),
            _ => ("airsigmet?format=json&type=airmet", "airmet")
        };
        var cacheKey = $"awc:hazards:{cacheFragment}";
        return FetchAsync($"awc-{cacheFragment}", cacheKey, path, HazardsFreshTtl, HazardsStaleTtl, AviationBucket.Poly, cancellationToken);
    }

    public Task<AviationFetchResult> GetPirepsAsync(double latitude, double longitude, int radiusNm, CancellationToken cancellationToken)
    {
        var safeRadius = Math.Clamp(radiusNm, 25, 500);
        var lat = latitude.ToString("0.###", CultureInfo.InvariantCulture);
        var lon = longitude.ToString("0.###", CultureInfo.InvariantCulture);
        var url = $"pirep?format=json&radialDistance={safeRadius}&location={lat},{lon}";
        var cacheKey = $"awc:pirep:{lat},{lon}:{safeRadius}";
        return FetchAsync("awc-pirep", cacheKey, url, PirepsFreshTtl, PirepsStaleTtl, AviationBucket.Point, cancellationToken);
    }

    public Task<AviationFetchResult> GetWindsAloftAsync(string region, CancellationToken cancellationToken)
    {
        var safeRegion = (region ?? "us").Trim().ToLowerInvariant();
        var url = $"windtemp?region={safeRegion}&fcst=06&level=low";
        var cacheKey = $"awc:winds:{safeRegion}";
        return FetchAsync("awc-winds", cacheKey, url, WindsFreshTtl, WindsStaleTtl, AviationBucket.Poly, cancellationToken);
    }

    private async Task<AviationFetchResult> FetchAsync(
        string phaseName,
        string cacheKey,
        string relativeUrl,
        TimeSpan freshTtl,
        TimeSpan staleTtl,
        AviationBucket bucket,
        CancellationToken cancellationToken)
    {
        var timings = Timings;

        if (_cache.TryGetValue<CachedEntry>(cacheKey, out var cached) && cached is not null)
        {
            var age = _timeProvider.GetUtcNow() - cached.FetchedAtUtc;
            if (age <= freshTtl)
            {
                timings?.RecordCacheSource(phaseName, "cache");
                return new AviationFetchResult(AviationSource.Cache, cached.Payload, cached.FetchedAtUtc, false);
            }
        }

        var semaphore = bucket == AviationBucket.Poly ? _polySemaphore : _pointSemaphore;
        if (!await semaphore.WaitAsync(TimeSpan.Zero, cancellationToken))
        {
            timings?.RecordCacheSource(phaseName, "awc-throttled");
            if (cached is not null)
            {
                return new AviationFetchResult(AviationSource.StaleCache, cached.Payload, cached.FetchedAtUtc, true);
            }
            return new AviationFetchResult(AviationSource.Error, null, null, true, "Upstream rate limit reached and no cache was available.");
        }

        _ = ScheduleReleaseAsync(semaphore);

        try
        {
            var start = Stopwatch.GetTimestamp();
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(UpstreamTimeout);

            var client = _httpClientFactory.CreateClient("weather-site:awc");
            using var response = await client.GetAsync(relativeUrl, timeoutCts.Token);

            if (response.StatusCode == HttpStatusCode.NoContent)
            {
                timings?.Record(phaseName, Stopwatch.GetElapsedTime(start), "no-data");
                return new AviationFetchResult(AviationSource.NoData, null, _timeProvider.GetUtcNow(), false);
            }

            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync(timeoutCts.Token);
            timings?.Record(phaseName, Stopwatch.GetElapsedTime(start));

            var entry = new CachedEntry(body, _timeProvider.GetUtcNow());
            _cache.Set(cacheKey, entry, staleTtl);
            return new AviationFetchResult(AviationSource.Live, body, entry.FetchedAtUtc, false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            timings?.RecordCacheSource(phaseName, "timeout");
            _logger.LogWarning("AWC upstream timed out for {Url}.", relativeUrl);
            return cached is not null
                ? new AviationFetchResult(AviationSource.StaleCache, cached.Payload, cached.FetchedAtUtc, false, "Upstream timed out.")
                : new AviationFetchResult(AviationSource.Error, null, null, false, "Upstream timed out.");
        }
        catch (HttpRequestException exception)
        {
            timings?.RecordCacheSource(phaseName, "error");
            _logger.LogWarning(exception, "AWC upstream failed for {Url}.", relativeUrl);
            return cached is not null
                ? new AviationFetchResult(AviationSource.StaleCache, cached.Payload, cached.FetchedAtUtc, false, exception.Message)
                : new AviationFetchResult(AviationSource.Error, null, null, false, exception.Message);
        }
    }

    private async Task ScheduleReleaseAsync(SemaphoreSlim semaphore)
    {
        try
        {
            await Task.Delay(_releaseAfter);
        }
        finally
        {
            semaphore.Release();
        }
    }

    private ServerTimingCollector? Timings =>
        _httpContextAccessor.HttpContext?.RequestServices.GetService<ServerTimingCollector>();

    public void Dispose()
    {
        _pointSemaphore.Dispose();
        _polySemaphore.Dispose();
    }

    private sealed record CachedEntry(string Payload, DateTimeOffset FetchedAtUtc);
}
