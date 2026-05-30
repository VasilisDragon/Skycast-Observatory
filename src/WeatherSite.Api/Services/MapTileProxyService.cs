using System.Net;
using Microsoft.Extensions.Caching.Memory;
using WeatherSite.Api.Models;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IMapTileProxyService
{
    Task<MapTileResult> GetTileAsync(
        string provider,
        string layer,
        int z,
        int x,
        int y,
        string? time,
        CancellationToken cancellationToken);
}

public sealed class MapTileProxyService : IMapTileProxyService
{
    private const int MaxTileBytes = 1_048_576;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly ILogger<MapTileProxyService> _logger;

    public MapTileProxyService(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        ILogger<MapTileProxyService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _logger = logger;
    }

    public async Task<MapTileResult> GetTileAsync(
        string provider,
        string layer,
        int z,
        int x,
        int y,
        string? time,
        CancellationToken cancellationToken)
    {
        WebMercatorTileMath.ValidateTileCoordinates(z, x, y);
        var definition = MapLayerCatalog.Resolve(provider, layer)
            ?? throw new KeyNotFoundException($"Map layer {provider}/{layer} is not registered.");

        var cacheKey = $"tile:{provider}:{layer}:{z}:{x}:{y}:{time}";
        if (_cache.TryGetValue<MapTileResult>(cacheKey, out var cached) && cached is not null)
        {
            return cached;
        }

        var requestUri = BuildRequestUri(definition, z, x, y, time);
        var client = _httpClientFactory.CreateClient("weather-site:generic");
        using var response = await client.GetAsync(requestUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Tile request to {Uri} failed with {StatusCode}.",
                requestUri,
                response.StatusCode);
            throw new HttpRequestException(
                $"Upstream tile request failed with status {(int)response.StatusCode}.",
                null,
                response.StatusCode);
        }

        var bytes = await ReadBoundedContentAsync(response.Content, MaxTileBytes, cancellationToken);
        var result = new MapTileResult(
            bytes,
            response.Content.Headers.ContentType?.MediaType ?? "image/png",
            definition.TileCacheSeconds);

        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(definition.TileCacheSeconds),
            Size = Math.Max(1, bytes.Length / 1024)
        });
        return result;
    }

    private static async Task<byte[]> ReadBoundedContentAsync(
        HttpContent content,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is long contentLength && contentLength > maxBytes)
        {
            throw new HttpRequestException("Upstream tile response exceeded the maximum allowed size.");
        }

        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var scratch = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(scratch, cancellationToken);
            if (read == 0)
            {
                return buffer.ToArray();
            }

            if (buffer.Length + read > maxBytes)
            {
                throw new HttpRequestException("Upstream tile response exceeded the maximum allowed size.");
            }

            buffer.Write(scratch, 0, read);
        }
    }

    private static string BuildRequestUri(WmsLayerDefinition definition, int z, int x, int y, string? time)
    {
        var parameters = new Dictionary<string, string?>
        {
            ["service"] = "WMS",
            ["version"] = "1.3.0",
            ["request"] = "GetMap",
            ["layers"] = definition.WmsLayerName,
            ["styles"] = string.Empty,
            ["format"] = "image/png",
            ["transparent"] = "true",
            ["width"] = "256",
            ["height"] = "256",
            ["crs"] = "EPSG:3857",
            ["bbox"] = WebMercatorTileMath.GetBoundingBox(z, x, y),
            ["tiled"] = "true"
        };

        if (definition.SupportsTime && !string.IsNullOrWhiteSpace(time))
        {
            parameters[definition.TimeDimensionName!] = time;
        }

        var queryString = string.Join(
            "&",
            parameters.Select(pair => $"{WebUtility.UrlEncode(pair.Key)}={WebUtility.UrlEncode(pair.Value)}"));

        return $"{definition.ServiceUrl}?{queryString}";
    }
}
