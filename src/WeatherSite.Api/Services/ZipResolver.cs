using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Models;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IZipResolver
{
    bool IsValid(string? zip);
    Task<ZipLocation> ResolveAsync(string zip, CancellationToken cancellationToken);
}

public sealed partial class ZipResolver : IZipResolver
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<ZipResolver> _logger;
    private readonly string _centroidPath;
    private readonly Lazy<IReadOnlyDictionary<string, double[]>> _lookup;

    public ZipResolver(
        IWebHostEnvironment environment,
        IOptions<WeatherSiteOptions> options,
        IHttpClientFactory httpClientFactory,
        ILogger<ZipResolver> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _centroidPath = ResolveCentroidPath(environment, options.Value.ZipCentroidsPath);
        _lookup = new Lazy<IReadOnlyDictionary<string, double[]>>(LoadLookup, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public bool IsValid(string? zip) => !string.IsNullOrWhiteSpace(zip) && ZipCodeRegex().IsMatch(zip);

    public async Task<ZipLocation> ResolveAsync(string zip, CancellationToken cancellationToken)
    {
        if (!IsValid(zip))
        {
            throw new ZipResolutionException("ZIP codes must be 5 digits.");
        }

        if (_lookup.Value.TryGetValue(zip, out var value) && value.Length >= 2)
        {
            return new ZipLocation(zip, value[0], value[1], false);
        }

        var fallback = await ResolveWithOpenMeteoAsync(zip, cancellationToken);
        if (fallback is not null)
        {
            return fallback;
        }

        throw new ZipResolutionException($"ZIP code {zip} could not be resolved.");
    }

    private IReadOnlyDictionary<string, double[]> LoadLookup()
    {
        if (!File.Exists(_centroidPath))
        {
            throw new FileNotFoundException($"ZIP centroid data file was not found at {_centroidPath}.");
        }

        using var stream = File.OpenRead(_centroidPath);
        using var document = JsonDocument.Parse(stream);
        var entriesElement = document.RootElement.GetProperty("entries");

        var result = new Dictionary<string, double[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entriesElement.EnumerateObject())
        {
            if (entry.Value.ValueKind != JsonValueKind.Array || entry.Value.GetArrayLength() < 2)
            {
                continue;
            }

            result[entry.Name] =
            [
                entry.Value[0].GetDouble(),
                entry.Value[1].GetDouble()
            ];
        }

        _logger.LogInformation("Loaded {Count} ZIP centroids from {Path}.", result.Count, _centroidPath);
        return result;
    }

    private async Task<ZipLocation?> ResolveWithOpenMeteoAsync(string zip, CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient("weather-site:generic");
        var uri =
            $"https://geocoding-api.open-meteo.com/v1/search?name={zip}&count=5&language=en&format=json&countryCode=US";

        using var response = await client.GetAsync(uri, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Open-Meteo ZIP fallback returned {StatusCode} for {Zip}.", response.StatusCode, zip);
            return null;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var root = await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken);
        var results = root?["results"]?.AsArray();
        if (results is null)
        {
            return null;
        }

        foreach (var result in results)
        {
            var postcodes = result?["postcodes"]?.AsArray()?.Select(node => node.AsString()).Where(value => value is not null);
            if (postcodes is null || !postcodes.Contains(zip, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            var latitude = result?["latitude"].AsDouble();
            var longitude = result?["longitude"].AsDouble();
            if (latitude is null || longitude is null)
            {
                continue;
            }

            return new ZipLocation(
                zip,
                latitude.Value,
                longitude.Value,
                true,
                result?["name"].AsString(),
                result?["admin1"].AsString());
        }

        return null;
    }

    private static string ResolveCentroidPath(IWebHostEnvironment environment, string configuredPath)
    {
        if (Path.IsPathRooted(configuredPath))
        {
            return configuredPath;
        }

        var contentRootCandidate = Path.Combine(environment.ContentRootPath, configuredPath);
        if (File.Exists(contentRootCandidate))
        {
            return contentRootCandidate;
        }

        return Path.Combine(AppContext.BaseDirectory, configuredPath);
    }

    [GeneratedRegex(@"^\d{5}$", RegexOptions.Compiled)]
    private static partial Regex ZipCodeRegex();
}

public sealed class ZipResolutionException : Exception
{
    public ZipResolutionException(string message)
        : base(message)
    {
    }
}
