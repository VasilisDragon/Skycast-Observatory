using System.Diagnostics;
using System.Text;
using System.Xml.Linq;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Contracts;
using WeatherSite.Api.Models;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IMapConfigurationService
{
    Task<MapConfigResponse> GetConfigAsync(string zip, CancellationToken cancellationToken);
    Task<MapConfigResponse> GetConfigAsync(ResolvedLocationContext context, CancellationToken cancellationToken);
}

public sealed class MapConfigurationService : IMapConfigurationService
{
    private static readonly TimeSpan CapabilitiesCacheDuration = TimeSpan.FromHours(6);
    private static readonly TimeSpan ConfigCacheDuration = TimeSpan.FromMinutes(1);

    private readonly IResolvedLocationService _resolvedLocationService;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly IWebHostEnvironment _environment;
    private readonly WeatherSiteOptions _options;
    private readonly ILogger<MapConfigurationService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public MapConfigurationService(
        IResolvedLocationService resolvedLocationService,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        IWebHostEnvironment environment,
        IOptions<WeatherSiteOptions> options,
        ILogger<MapConfigurationService> logger,
        IHttpContextAccessor httpContextAccessor)
    {
        _resolvedLocationService = resolvedLocationService;
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _environment = environment;
        _options = options.Value;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
    }

    private ServerTimingCollector? Timings =>
        _httpContextAccessor.HttpContext?.RequestServices.GetService<ServerTimingCollector>();

    public async Task<MapConfigResponse> GetConfigAsync(string zip, CancellationToken cancellationToken)
    {
        var context = await _resolvedLocationService.GetResolvedLocationAsync(zip, cancellationToken);
        return await GetConfigAsync(context, cancellationToken);
    }

    public async Task<MapConfigResponse> GetConfigAsync(
        ResolvedLocationContext context,
        CancellationToken cancellationToken)
    {
        var timings = Timings;
        var cacheKey = $"map:config:{context.ZipLocation.Zip}";
        if (_cache.TryGetValue<MapConfigResponse>(cacheKey, out var cachedConfig) && cachedConfig is not null)
        {
            timings?.RecordCacheSource("map-config", "cache");
            return cachedConfig;
        }

        var definitions = MapLayerCatalog.BuildForLocation(context.PointInfo.RadarStation);
        var capabilitiesTasks = definitions
            .Where(definition => definition.SupportsTime)
            .Select(definition => definition.ServiceUrl)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                serviceUrl => serviceUrl,
                serviceUrl => GetCapabilitiesXmlAsync(serviceUrl, cancellationToken),
                StringComparer.OrdinalIgnoreCase);

        var capStart = Stopwatch.GetTimestamp();
        await Task.WhenAll(capabilitiesTasks.Values);
        timings?.Record("map-capabilities", Stopwatch.GetElapsedTime(capStart));

        var layers = definitions
            .Select(definition => new MapLayerDescriptor(
                definition.Id,
                definition.Provider,
                definition.Layer,
                definition.Title,
                definition.Description,
                $"/api/maps/tiles/{definition.Provider}/{definition.Layer}/{{z}}/{{x}}/{{y}}.png",
                definition.DefaultOpacity,
                definition.DefaultVisible,
                definition.SupportsTime,
                definition.TimeDimensionName,
                definition.SupportsTime
                    ? ParseTimes(
                        capabilitiesTasks[definition.ServiceUrl].Result,
                        definition.WmsLayerName,
                        definition.TimeDimensionName)
                    : Array.Empty<string>(),
                definition.LegendTitle,
                definition.Legend))
            .ToArray();

        var worldExists = TryResolveStaticAsset(_options.Basemaps.WorldUrl, out _);
        var regionalExists = TryResolveStaticAsset(_options.Basemaps.RegionalUrl, out _);

        var config = new MapConfigResponse(
            context.ToLocationSummary(),
            context.PointInfo.Latitude,
            context.PointInfo.Longitude,
            7,
            true,
            worldExists || regionalExists,
            worldExists ? _options.Basemaps.WorldUrl : null,
            regionalExists ? _options.Basemaps.RegionalUrl : null,
            layers);

        // MapConfigResponse is a small composed record; payload bytes are
        // dominated by the layer descriptors and capabilities times. ~4 KB
        // is generous for the largest realistic config; a static estimate
        // avoids the cost of round-tripping through serialization.
        _cache.Set(cacheKey, config, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ConfigCacheDuration,
            Size = 4
        });
        return config;
    }

    private async Task<string> GetCapabilitiesXmlAsync(string serviceUrl, CancellationToken cancellationToken)
    {
        var cacheKey = $"map:capabilities:{serviceUrl}";
        if (_cache.TryGetValue<string>(cacheKey, out var cached) && cached is not null)
        {
            return cached;
        }

        try
        {
            var requestUri = $"{serviceUrl}?service=WMS&version=1.3.0&request=GetCapabilities";
            var client = _httpClientFactory.CreateClient("weather-site:generic");
            var xml = await client.GetStringAsync(requestUri, cancellationToken);
            _cache.Set(cacheKey, xml, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = CapabilitiesCacheDuration,
                Size = Math.Max(1, Encoding.UTF8.GetByteCount(xml) / 1024)
            });
            return xml;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Unable to load WMS capabilities from {ServiceUrl}.", serviceUrl);
            return string.Empty;
        }
    }

    private static IReadOnlyList<string> ParseTimes(string xml, string layerName, string? dimensionName)
    {
        if (string.IsNullOrWhiteSpace(xml) || string.IsNullOrWhiteSpace(dimensionName))
        {
            return Array.Empty<string>();
        }

        var document = XDocument.Parse(xml);
        var layer = document
            .Descendants()
            .FirstOrDefault(element =>
                element.Name.LocalName == "Layer"
                && string.Equals(
                    element.Elements().FirstOrDefault(child => child.Name.LocalName == "Name")?.Value,
                    layerName,
                    StringComparison.OrdinalIgnoreCase));

        if (layer is null)
        {
            return Array.Empty<string>();
        }

        var dimension = layer
            .Descendants()
            .FirstOrDefault(element =>
                (element.Name.LocalName == "Dimension" || element.Name.LocalName == "Extent")
                && string.Equals(element.Attribute("name")?.Value, dimensionName, StringComparison.OrdinalIgnoreCase));

        if (dimension is null || string.IsNullOrWhiteSpace(dimension.Value))
        {
            return Array.Empty<string>();
        }

        return dimension.Value
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .TakeLast(24)
            .ToArray();
    }

    private bool TryResolveStaticAsset(string relativeUrl, out string fullPath)
    {
        var normalized = relativeUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var webRoot = _environment.WebRootPath ?? Path.Combine(_environment.ContentRootPath, "wwwroot");
        fullPath = Path.Combine(webRoot, normalized);
        return File.Exists(fullPath);
    }
}
