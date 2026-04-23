using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Models;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Services;

public interface IAirportCatalog
{
    bool IsValidIcao(string? icao);
    AirportRecord? TryGet(string icao);
    IReadOnlyList<AirportRecord> Search(string query, int limit);
    IReadOnlyList<AirportDistance> Nearest(double latitude, double longitude, int limit);
    BboxStationsResult InBbox(double west, double south, double east, double north, int limit);
}

public sealed record BboxStationsResult(IReadOnlyList<AirportRecord> Stations, int TotalInBbox, bool Truncated);

public sealed partial class AirportCatalog : IAirportCatalog
{
    private readonly ILogger<AirportCatalog> _logger;
    private readonly string _airportsPath;
    private readonly Lazy<IReadOnlyDictionary<string, AirportRecord>> _byIcao;

    public AirportCatalog(
        IWebHostEnvironment environment,
        IOptions<WeatherSiteOptions> options,
        ILogger<AirportCatalog> logger)
    {
        _logger = logger;
        _airportsPath = ResolveAirportsPath(environment, options.Value.AirportsPath);
        _byIcao = new Lazy<IReadOnlyDictionary<string, AirportRecord>>(
            Load,
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public bool IsValidIcao(string? icao) => !string.IsNullOrWhiteSpace(icao) && IcaoRegex().IsMatch(icao);

    public AirportRecord? TryGet(string icao)
    {
        if (string.IsNullOrWhiteSpace(icao))
        {
            return null;
        }

        return _byIcao.Value.TryGetValue(icao.Trim().ToUpperInvariant(), out var record) ? record : null;
    }

    public IReadOnlyList<AirportRecord> Search(string query, int limit)
    {
        if (string.IsNullOrWhiteSpace(query) || limit <= 0)
        {
            return Array.Empty<AirportRecord>();
        }

        var needle = query.Trim();
        if (needle.Length == 0)
        {
            return Array.Empty<AirportRecord>();
        }

        var upper = needle.ToUpperInvariant();
        var results = new List<AirportRecord>(limit);

        if (_byIcao.Value.TryGetValue(upper, out var exact))
        {
            results.Add(exact);
        }

        foreach (var record in _byIcao.Value.Values)
        {
            if (results.Count >= limit)
            {
                break;
            }

            if (record.Icao == upper)
            {
                continue;
            }

            if (record.Icao.StartsWith(upper, StringComparison.Ordinal)
                || record.Name.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || record.City.Contains(needle, StringComparison.OrdinalIgnoreCase))
            {
                results.Add(record);
            }
        }

        return results;
    }

    public IReadOnlyList<AirportDistance> Nearest(double latitude, double longitude, int limit)
    {
        if (limit <= 0)
        {
            return Array.Empty<AirportDistance>();
        }

        return _byIcao.Value.Values
            .Select(record => new AirportDistance(
                record,
                Math.Round(WeatherMath.HaversineMiles(latitude, longitude, record.Latitude, record.Longitude), 1)))
            .OrderBy(entry => entry.MilesFromOrigin)
            .Take(limit)
            .ToArray();
    }

    public BboxStationsResult InBbox(double west, double south, double east, double north, int limit)
    {
        if (limit <= 0)
        {
            return new BboxStationsResult(Array.Empty<AirportRecord>(), 0, false);
        }

        // Bbox is expressed as (west, south, east, north) in degrees. Longitudes
        // are allowed to wrap the antimeridian, in which case `west > east`
        // (e.g. Pacific sweeps). Handle both orientations.
        var normalizedSouth = Math.Min(south, north);
        var normalizedNorth = Math.Max(south, north);
        var wraps = west > east;

        bool LonInside(double lon) => wraps ? (lon >= west || lon <= east) : (lon >= west && lon <= east);

        var centerLat = (normalizedSouth + normalizedNorth) * 0.5;
        var centerLon = wraps ? NormalizeLongitude((west + east + 360.0) * 0.5) : (west + east) * 0.5;

        var matched = _byIcao.Value.Values
            .Where(r => r.Latitude >= normalizedSouth
                && r.Latitude <= normalizedNorth
                && LonInside(r.Longitude))
            .ToArray();

        if (matched.Length <= limit)
        {
            var ordered = matched
                .OrderBy(r => WeatherMath.HaversineMiles(centerLat, centerLon, r.Latitude, r.Longitude))
                .ToArray();
            return new BboxStationsResult(ordered, matched.Length, false);
        }

        // Over the cap. Return the `limit` stations nearest the bbox center so
        // the map shows the densest cluster first, and signal truncation so the
        // UI can prompt the user to zoom in.
        var trimmed = matched
            .OrderBy(r => WeatherMath.HaversineMiles(centerLat, centerLon, r.Latitude, r.Longitude))
            .Take(limit)
            .ToArray();
        return new BboxStationsResult(trimmed, matched.Length, true);
    }

    private static double NormalizeLongitude(double lon)
    {
        var wrapped = lon % 360.0;
        if (wrapped > 180.0)
        {
            wrapped -= 360.0;
        }
        else if (wrapped < -180.0)
        {
            wrapped += 360.0;
        }
        return wrapped;
    }

    private IReadOnlyDictionary<string, AirportRecord> Load()
    {
        if (!File.Exists(_airportsPath))
        {
            throw new FileNotFoundException($"Airport catalog was not found at {_airportsPath}.");
        }

        using var stream = File.OpenRead(_airportsPath);
        using var document = JsonDocument.Parse(stream);
        var entriesElement = document.RootElement.GetProperty("entries");

        var result = new Dictionary<string, AirportRecord>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entriesElement.EnumerateObject())
        {
            var value = entry.Value;
            if (value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var icao = (value.TryGetProperty("i", out var iEl) ? iEl.GetString() : entry.Name) ?? entry.Name;
            icao = icao.Trim().ToUpperInvariant();
            if (!IcaoRegex().IsMatch(icao))
            {
                continue;
            }

            var name = value.TryGetProperty("n", out var nEl) ? nEl.GetString() ?? icao : icao;
            var city = value.TryGetProperty("c", out var cEl) ? cEl.GetString() ?? string.Empty : string.Empty;
            var state = value.TryGetProperty("s", out var sEl) ? sEl.GetString() ?? string.Empty : string.Empty;
            if (!value.TryGetProperty("la", out var laEl) || !value.TryGetProperty("lo", out var loEl))
            {
                continue;
            }

            int? elev = null;
            if (value.TryGetProperty("e", out var eEl))
            {
                if (eEl.ValueKind == JsonValueKind.Number && eEl.TryGetInt32(out var elevInt))
                {
                    elev = elevInt;
                }
            }

            result[icao] = new AirportRecord(
                icao,
                name,
                city,
                state,
                laEl.GetDouble(),
                loEl.GetDouble(),
                elev);
        }

        _logger.LogInformation("Loaded {Count} airports from {Path}.", result.Count, _airportsPath);
        return result;
    }

    private static string ResolveAirportsPath(IWebHostEnvironment environment, string configuredPath)
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

    [GeneratedRegex(@"^[KP][A-Z0-9]{3}$", RegexOptions.Compiled)]
    private static partial Regex IcaoRegex();
}
